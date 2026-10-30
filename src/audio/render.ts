/**
 * Rendering a take to a file, faster than real time.
 *
 * RFC #2 lists this under Persistence: "Rendering a take to a WAV offline
 * (`OfflineAudioContext`) is a natural extension and shares machinery with
 * exporting a finished performance." It is built here rather than in #12 so
 * there is one renderer, and #12's audio path can call it.
 *
 * The split matters: {@link scheduleTake} turns a take into absolute-time notes
 * and is **pure**, so the interesting part — where each note lands and what it
 * sounds like — is testable without a browser. {@link renderTakeToWav} is the
 * thin part that only a browser can do.
 */
import type { Take } from "../types";
import { resolveTakeEvent } from "../music/take";
import { chordLevel, sharedOutput } from "./headroom";
import { getVoice } from "./voice";
import { AUDIO, TRANSPORT } from "../config/constants";

/** One note of a take, resolved and placed on a timeline in seconds. */
export interface ScheduledNote {
  readonly notes: number[];
  readonly volume: number;
  readonly tilt: number;
  /** Seconds from the start of the render. */
  readonly when: number;
}

/** One layer to render: what it plays, how loud, and with which instrument. */
export interface RenderLayer {
  readonly take: Take;
  /** The layer's own level, 0..1. */
  readonly gain: number;
  /** The registered voice id to play it through. */
  readonly voiceId: string;
}

export interface RenderOptions {
  readonly layers: readonly RenderLayer[];
  readonly bpm: number;
  /** The loop's length in beats, so the render is exactly one pass of it. */
  readonly loopBeats: number;
  /** The tonic the take is resolved against, which is what makes it transpose. */
  readonly tonicFrequency: number;
}

/**
 * Places a take's events on a timeline in seconds.
 *
 * Each event is resolved against the *current* tonic, so a render transposes
 * with the key exactly as playback does — the same function the live path uses,
 * which is what makes a render sound like the take rather than like a
 * re-performance of it.
 */
export function scheduleTake(
  take: Take,
  tonicFrequency: number,
  secondsPerBeat: number,
): ScheduledNote[] {
  return take.events.map((event) => ({
    ...resolveTakeEvent(event, tonicFrequency),
    when: event.beat * secondsPerBeat,
  }));
}

/** How long a render should be, including the tail a last note needs to decay. */
export function renderSeconds(loopBeats: number, bpm: number, tailSeconds: number): number {
  return (loopBeats * 60) / bpm + tailSeconds;
}

/**
 * Encodes channel data as a 16-bit PCM WAV.
 *
 * Sixteen bit rather than float: the target is something a person can play, and
 * every player reads this. Kept pure — channels in, bytes out — so the header
 * arithmetic is testable, which is the part that is silently wrong when it is
 * wrong.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  const channelCount = Math.max(1, channels.length);
  const frameCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frameCount * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      // Clamped before scaling, because a summed mix can exceed 1 and wrapping
      // it round is the one failure mode of this format that sounds like damage.
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));

      // Scaled by 32768 rather than 32767 so the range is symmetric — a half is
      // +16384 and -16384, not +16384 and -16383. Full scale then overshoots the
      // signed 16-bit maximum by one, so the result is clamped again.
      const scaled = Math.round(sample * 32768);
      view.setInt16(offset, Math.max(-32768, Math.min(32767, scaled)), true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Renders every layer of a take to a WAV, offline and faster than real time.
 *
 * Each layer gets its own voice and its own gain and filter, which is the same
 * shape as playback: the layers were separate channel strips when they were
 * recorded, so they have to be separate here or the mix would not match.
 *
 * The voices are driven with `playAt`, which is the same call the live scheduler
 * uses — an offline context has no "now" that moves, so absolute times are the
 * only way to place a note at all.
 */
export async function renderTakeToWav(options: RenderOptions): Promise<Blob> {
  const { layers, bpm, loopBeats, tonicFrequency } = options;
  const secondsPerBeat = 60 / bpm;
  const seconds = renderSeconds(loopBeats, bpm, AUDIO.renderTailSeconds);
  const sampleRate = AUDIO.renderSampleRate;
  const frames = Math.ceil(seconds * sampleRate);

  const offline = new OfflineAudioContext(2, frames, sampleRate);

  const master = offline.createGain();
  master.gain.value = 1;
  // Through the same limiter, and below, the same chord level, as playback: a
  // take renders the way it sounded, clipping included if it ever did — which
  // now it does not.
  master.connect(sharedOutput(offline));

  for (const layer of layers) {
    const definition = getVoice(layer.voiceId);
    if (!definition) continue;

    const chordBus = offline.createGain();
    const gain = offline.createGain();
    const filter = offline.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = AUDIO.filterBaseQ;

    const voice = definition.create();
    // The offline context is a `BaseAudioContext` with every node factory the
    // voices use; the cast is for the one member they do not (`resume`).
    voice.connect(offline as unknown as AudioContext, chordBus);
    chordBus.connect(gain).connect(filter).connect(master);

    const notes = scheduleTake(layer.take, tonicFrequency, secondsPerBeat);

    for (const note of notes) {
      gain.gain.setValueAtTime(note.volume * layer.gain, note.when);
      filter.frequency.setValueAtTime(
        AUDIO.filterBaseFrequency + note.tilt * AUDIO.brightFrequencyRise,
        note.when,
      );

      if (note.notes.length === 0) {
        voice.release();
        continue;
      }

      chordBus.gain.setValueAtTime(chordLevel(note.notes.length), note.when);

      if (voice.playAt) voice.playAt(note.notes, note.when);
      else voice.play(note.notes);
    }
  }

  const rendered = await offline.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) =>
    rendered.getChannelData(index),
  );

  return encodeWav(channels, rendered.sampleRate);
}

/** The tempo a take was recorded at, as a guard against a mismatched grid. */
export function takeSecondsPerBeat(take: Take): number {
  return 60 / (take.bpm || TRANSPORT.defaultBpm);
}
