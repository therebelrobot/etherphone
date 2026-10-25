#!/usr/bin/env node
/**
 * Generates the bundled samples in `public/samples/`.
 *
 * The instrument ships two sustained, loopable tones rather than recordings of
 * unknown provenance, so the repository owns the licence and the recipe is
 * reviewable. Regenerate with:
 *
 *     node scripts/generate-samples.mjs
 *
 * Everything here is strictly harmonic and rendered over a whole number of
 * cycles, so the end of the file lands back on the start of the waveform and the
 * sampler's loop crossfade only has the usual half-sample to tidy up.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;

/** A2, matching the instrument's own tonic and the sampler's assumed root. */
const ROOT_FREQUENCY = 110;

/** Cycles per file: long enough to sound steady, short enough to stay small. */
const CYCLES = 96;

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");

/**
 * Renders a sum of harmonics over an exact number of cycles.
 *
 * Each partial is a sine at `harmonic × root`, so the result repeats exactly
 * after `CYCLES` cycles and the wrap is continuous.
 */
function renderTone(harmonics) {
  const length = Math.round((CYCLES * SAMPLE_RATE) / ROOT_FREQUENCY);
  const samples = new Float32Array(length);

  for (let n = 0; n < length; n += 1) {
    let value = 0;
    for (const { harmonic, amplitude, phase = 0 } of harmonics) {
      value += amplitude * Math.sin((2 * Math.PI * harmonic * CYCLES * n) / length + phase);
    }
    samples[n] = value;
  }

  return normalise(samples, 0.9);
}

/** Scales a buffer so its loudest sample sits at `peak`. */
function normalise(samples, peak) {
  let loudest = 0;
  for (const sample of samples) {
    loudest = Math.max(loudest, Math.abs(sample));
  }

  if (loudest === 0) return samples;

  const scale = peak / loudest;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] *= scale;
  }

  return samples;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Encodes mono 16-bit PCM as a `.wav` byte stream. */
function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * bytesPerSample, Math.round(clamped * 32767), true);
  }

  return new Uint8Array(buffer);
}

/** Mellow, rolled-off partials: the classic analog pad. */
const PAD = Array.from({ length: 12 }, (_unused, index) => {
  const harmonic = index + 1;
  return { harmonic, amplitude: 1 / harmonic ** 1.5, phase: index * 0.4 };
});

/** Drawbar-style registration: strong octaves, a couple of upper partials. */
const ORGAN = [
  { harmonic: 1, amplitude: 1 },
  { harmonic: 2, amplitude: 0.5 },
  { harmonic: 3, amplitude: 0.75 },
  { harmonic: 4, amplitude: 0.25 },
  { harmonic: 6, amplitude: 0.4 },
  { harmonic: 8, amplitude: 0.2 },
  { harmonic: 12, amplitude: 0.15 },
];

const FILES = [
  { name: "pad-a2.wav", harmonics: PAD },
  { name: "organ-a2.wav", harmonics: ORGAN },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, harmonics } of FILES) {
  const samples = renderTone(harmonics);
  const wav = encodeWav(samples, SAMPLE_RATE);
  writeFileSync(join(OUT_DIR, name), wav);

  const seconds = (samples.length / SAMPLE_RATE).toFixed(2);
  process.stdout.write(`${name}: ${samples.length} samples (${seconds}s), ${wav.length} bytes\n`);
}
