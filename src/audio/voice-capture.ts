/**
 * Capturing the microphone into a loop, through an `AudioWorklet`.
 *
 * RFC #9 offers two ways in — an `AudioWorklet` writing raw samples into a loop
 * window, or `MediaRecorder` giving a compressed blob — and asks which to keep.
 * **Decided: the worklet only.** A loop has to line up with the grid, and
 * MediaRecorder is built for "record a phrase", not for "record exactly one bar".
 * One path also means one set of failure modes to explain.
 *
 * Two things about this module are worth stating plainly:
 *
 * **Nothing is monitored.** The node has no outputs and is connected to nothing
 * but a port, so the microphone is never routed back to the speakers. That is the
 * safe default and the reason there is no latency compensation anywhere: with no
 * monitor path there is nothing to compensate for. Headphone monitoring would
 * need a latency measurement and feedback protection, for a feature most players
 * will not use.
 *
 * **The processor is a string, built into a blob URL.** A static build has no
 * bundler step for worklets, and a blob URL keeps the whole instrument a set of
 * files with no build-time knowledge of them — the same reason the samples are
 * generated into `public/` rather than imported.
 */
import { assembleChannel } from "./voice-loop";

/** The processor, as source. Kept a string so there is no second build step. */
export const VOICE_CAPTURE_PROCESSOR = `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];

    if (channel) {
      // The audio thread reuses this buffer between calls, so it has to be
      // copied before it leaves the thread — otherwise every chunk posted would
      // be the same array, and the last one at that.
      this.port.postMessage(channel.slice(0));
    }

    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
`;

/** The name the processor registers itself under. */
const PROCESSOR_NAME = "voice-capture";

/** What to capture, and from where in time. */
export interface CaptureOptions {
  /** Frames one pass of the loop is, from `loopFrameCount`. */
  readonly frameCount: number;
  /**
   * Frames to discard before the window starts.
   *
   * The caller works this out from the transport, which is what makes a capture
   * begun mid-bar still *begin* on the bar line.
   */
  readonly skipFrames?: number;
  /** Called with 0..1 as the window fills. */
  readonly onProgress?: (progress: number) => void;
}

/**
 * Records exactly one pass of the loop from `stream`.
 *
 * Resolves with a one-channel buffer of exactly `frameCount` frames, which is
 * what the looper's grid expects. Rejects if the worklet cannot be loaded at all,
 * rather than resolving with a short recording.
 */
export async function recordVoiceLoop(
  ctx: AudioContext,
  stream: MediaStream,
  options: CaptureOptions,
): Promise<AudioBuffer> {
  if (!ctx.audioWorklet) {
    throw new Error(
      "This browser cannot capture audio accurately enough for a loop. " +
        "AudioWorklet is required, and it is not available here.",
    );
  }

  const url = URL.createObjectURL(new Blob([VOICE_CAPTURE_PROCESSOR], { type: "text/javascript" }));

  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    // The module is loaded once it resolves; the URL is not needed again.
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfOutputs: 0 });

  const chunks: Float32Array[] = [];
  let received = 0;
  const target = options.frameCount + (options.skipFrames ?? 0);

  const recorded = await new Promise<Float32Array>((resolve) => {
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = event.data;
      chunks.push(chunk);
      received += chunk.length;

      options.onProgress?.(Math.min(1, received / target));

      if (received >= target) {
        node.port.onmessage = null;
        resolve(assembleChannel(chunks, options.frameCount, options.skipFrames ?? 0));
      }
    };

    source.connect(node);
  });

  // The microphone is released by the caller, not here: the same stream may be
  // about to record another layer, and stopping it would flash the indicator.
  source.disconnect();
  node.disconnect();

  const buffer = ctx.createBuffer(1, recorded.length, ctx.sampleRate);
  // Written through the channel view rather than `copyToChannel`, which TS now
  // types against a non-shared `ArrayBuffer` — a Float32Array's buffer is
  // `ArrayBufferLike`, and this is a copy either way.
  buffer.getChannelData(0).set(recorded);

  return buffer;
}
