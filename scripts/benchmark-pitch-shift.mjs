#!/usr/bin/env node
/**
 * The #11 substrate spike, committed.
 *
 * RFC #11 asks whether tuned voice loops (detect a captured loop's pitch, then
 * transpose it without changing its timing) should be Rust-over-WASM. The
 * answer recorded in that issue is no — plain JS in a Web Worker — and the
 * argument rested on measurements that lived only in the issue's prose. This
 * script is those measurements, so the decision is reproducible instead of
 * asserted.
 *
 *   node scripts/benchmark-pitch-shift.mjs
 *
 * It measures two jobs on a 2-second, 48 kHz signal:
 *
 *   1. YIN pitch detection over one 2048-sample window, and over the whole loop.
 *   2. A phase-vocoder time-stretch plus a resample, which is how a pitch shift
 *      that keeps its duration is built.
 *
 * The tolerances asserted at the end are *correctness* ones (detected pitch
 * within a few cents of the truth, output length preserved). Timing is printed
 * but only asserted against a deliberately loose real-time budget, because
 * wall-clock numbers on a shared CI runner are not a stable thing to fail on.
 *
 * The implementations are deliberately straightforward, matching the spike that
 * produced the original numbers. Quality is a separate question: a
 * phase vocoder of this shape smears transients, and the real engineering in
 * #11 is phase locking or WSOLA, not speed.
 *
 * Exit code is non-zero when an assertion fails, so CI can run it.
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48000;
const LOOP_SECONDS = 2;
const WINDOW = 2048;
/** 220 Hz — the pitch the issue reports, so the number is comparable. */
const TRUE_HZ = 220;
/** Transpose up a whole tone, a modest and realistic key change. */
const SHIFT_RATIO = 9 / 8;

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

/**
 * A harmonic tone, which is what a hummed line roughly is.
 *
 * A pure sine would flatter the detector: the harmonics are what make YIN pick
 * the fundamental rather than an octave up, so they are worth having.
 */
function harmonicTone(frequency, seconds, sampleRate, partials = 8) {
  const length = Math.round(seconds * sampleRate);
  const buffer = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    let value = 0;

    for (let h = 1; h <= partials; h += 1) {
      if (frequency * h >= sampleRate / 2) break;
      value += Math.sin(2 * Math.PI * frequency * h * t) / h;
    }

    buffer[i] = value * 0.5;
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// YIN
// ---------------------------------------------------------------------------

/**
 * The YIN difference function, then its cumulative-mean normalisation.
 *
 * Returns the normalised curve; the first dip below the threshold is the
 * period. `tau` is a lag in samples.
 */
function yinNormalisedDifference(buffer, tauMax) {
  const difference = new Float64Array(tauMax + 1);

  for (let tau = 1; tau <= tauMax; tau += 1) {
    let sum = 0;

    for (let j = 0; j + tau < buffer.length; j += 1) {
      const delta = buffer[j] - buffer[j + tau];
      sum += delta * delta;
    }

    difference[tau] = sum;
  }

  const normalised = new Float64Array(tauMax + 1);
  normalised[0] = 1;
  let running = 0;

  for (let tau = 1; tau <= tauMax; tau += 1) {
    running += difference[tau];
    normalised[tau] = running === 0 ? 1 : (difference[tau] * tau) / running;
  }

  return normalised;
}

/** Finds the fundamental of `buffer`, in Hz, or `null` when it is silent. */
function yinPitch(buffer, sampleRate, { threshold = 0.1, minHz = 50, maxHz = 1000 } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(buffer.length / 2), Math.floor(sampleRate / minHz));
  const curve = yinNormalisedDifference(buffer, tauMax);

  let tau = tauMin;

  while (tau <= tauMax) {
    if (curve[tau] < threshold) {
      // Walk to the bottom of this dip before interpolating.
      while (tau + 1 <= tauMax && curve[tau + 1] < curve[tau]) tau += 1;
      break;
    }
    tau += 1;
  }

  if (tau > tauMax) return null;

  // Parabolic interpolation around the minimum, for sub-sample accuracy.
  const left = curve[tau - 1];
  const centre = curve[tau];
  const right = curve[tau + 1] ?? centre;
  const denominator = 2 * (2 * centre - right - left);
  const offset = denominator === 0 ? 0 : (right - left) / denominator;

  return sampleRate / (tau + offset);
}

/** Median pitch across several windows, because a sung note has vibrato. */
function medianPitch(buffer, sampleRate, windows = 5) {
  const readouts = [];

  for (let i = 0; i < windows; i += 1) {
    const start = Math.floor((i * (buffer.length - WINDOW)) / windows);
    const readout = yinPitch(buffer.subarray(start, start + WINDOW), sampleRate);
    if (readout !== null) readouts.push(readout);
  }

  if (readouts.length === 0) return null;

  readouts.sort((a, b) => a - b);
  return readouts[Math.floor(readouts.length / 2)];
}

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/** Iterative radix-2 Cooley-Tukey. Length must be a power of two. */
function fft(real, imaginary) {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;

    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = length >> 1;

    for (let start = 0; start < n; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;

      for (let k = 0; k < half; k += 1) {
        const even = start + k;
        const odd = even + half;

        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;

        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;

        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  return { real, imaginary };
}

function inverseFft(real, imaginary) {
  const n = real.length;
  for (let i = 0; i < n; i += 1) imaginary[i] = -imaginary[i];
  fft(real, imaginary);
  for (let i = 0; i < n; i += 1) {
    real[i] /= n;
    imaginary[i] = -imaginary[i] / n;
  }
  return { real, imaginary };
}

// ---------------------------------------------------------------------------
// Phase vocoder
// ---------------------------------------------------------------------------

function hann(length) {
  const window = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return window;
}

/** Wraps a phase difference into (-pi, pi]. */
function wrapPhase(phase) {
  return phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
}

/**
 * Time-stretches by `factor`, keeping the pitch.
 *
 * Analysis and synthesis hops differ by `factor`, which is what changes the
 * duration; the phase advance is scaled to keep each partial continuous, which
 * is what keeps the pitch where it was.
 */
function timeStretch(input, factor, { frame = WINDOW, overlap = 4 } = {}) {
  const analysisHop = frame / overlap;
  const synthesisHop = Math.round(analysisHop * factor);
  const window = hann(frame);
  const outputLength = Math.ceil((input.length / analysisHop) * synthesisHop) + frame;
  const output = new Float64Array(outputLength);
  const windowSum = new Float64Array(outputLength);

  const bins = frame / 2 + 1;
  const previousPhase = new Float64Array(bins);
  const synthesisPhase = new Float64Array(bins);
  const expected = new Float64Array(bins);
  for (let b = 0; b < bins; b += 1) {
    expected[b] = (2 * Math.PI * analysisHop * b) / frame;
  }

  const real = new Float64Array(frame);
  const imaginary = new Float64Array(frame);
  let frameIndex = 0;

  for (let start = 0; start + frame <= input.length; start += analysisHop) {
    for (let i = 0; i < frame; i += 1) {
      real[i] = input[start + i] * window[i];
      imaginary[i] = 0;
    }

    fft(real, imaginary);

    const magnitude = new Float64Array(frame);
    const phase = new Float64Array(frame);
    for (let b = 0; b < frame; b += 1) {
      magnitude[b] = Math.hypot(real[b], imaginary[b]);
      phase[b] = Math.atan2(imaginary[b], real[b]);
    }

    for (let b = 0; b < bins; b += 1) {
      if (frameIndex === 0) {
        synthesisPhase[b] = phase[b];
      } else {
        // How far this bin's true frequency sits from its centre, in bins.
        const deviation = wrapPhase(phase[b] - previousPhase[b] - expected[b]);
        const trueBin = b + (deviation * frame) / (2 * Math.PI * analysisHop);
        synthesisPhase[b] += (2 * Math.PI * synthesisHop * trueBin) / frame;
      }

      previousPhase[b] = phase[b];
    }

    // Mirrored bins keep the signal real after the inverse transform.
    for (let b = 0; b < frame; b += 1) {
      const source = b <= frame / 2 ? b : frame - b;
      const angle = synthesisPhase[source];
      real[b] = magnitude[b] * Math.cos(angle);
      imaginary[b] = magnitude[b] * Math.sin(angle);
    }

    inverseFft(real, imaginary);

    const writeAt = frameIndex * synthesisHop;
    for (let i = 0; i < frame; i += 1) {
      if (writeAt + i >= outputLength) break;
      output[writeAt + i] += real[i] * window[i];
      windowSum[writeAt + i] += window[i] * window[i];
    }

    frameIndex += 1;
  }

  for (let i = 0; i < outputLength; i += 1) {
    if (windowSum[i] > 1e-8) output[i] /= windowSum[i];
  }

  return output;
}

/** Reads `input` back faster or slower, which is what moves the pitch. */
function resample(input, ratio) {
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }

  return output;
}

/**
 * Shifts the pitch of `input` by `ratio`, keeping its duration.
 *
 * Stretch by the ratio, then read it back at the ratio: the two cancel for
 * timing and compound for pitch. This is the two-stage shift RFC #11
 * describes, and it is the piece that replaces `playbackRateFor` on the
 * pitched path — rate alone couples pitch to time.
 */
function pitchShift(input, ratio) {
  return resample(timeStretch(input, ratio), ratio);
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------

function cents(detected, truth) {
  return 1200 * Math.log2(detected / truth);
}

function milliseconds(task) {
  const started = performance.now();
  const value = task();
  return { value, ms: performance.now() - started };
}

function main() {
  const signal = harmonicTone(TRUE_HZ, LOOP_SECONDS, SAMPLE_RATE);
  const failures = [];
  const check = (label, ok, detail) => {
    if (!ok) failures.push(`${label}: ${detail}`);
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}  ${detail}`);
  };

  console.log(`Signal: ${TRUE_HZ} Hz, ${LOOP_SECONDS}s, ${SAMPLE_RATE} Hz`);
  console.log(`Truth:  ${TRUE_HZ} Hz  |  shift ratio ${SHIFT_RATIO.toFixed(3)} (~200 cents)\n`);

  console.log("Detection (YIN)");

  const oneWindow = milliseconds(() => yinPitch(signal.subarray(0, WINDOW), SAMPLE_RATE));
  const wholeLoop = milliseconds(() => medianPitch(signal, SAMPLE_RATE));

  console.log(
    `  one ${WINDOW}-sample window : ${oneWindow.ms.toFixed(2)} ms -> ${oneWindow.value.toFixed(1)} Hz`,
  );
  console.log(
    `  whole ${LOOP_SECONDS}s loop      : ${wholeLoop.ms.toFixed(2)} ms -> ${wholeLoop.value.toFixed(1)} Hz (median)`,
  );
  console.log();

  console.log("Shift (time-stretch + resample)");

  const stretch = milliseconds(() => timeStretch(signal, SHIFT_RATIO));
  const shifted = milliseconds(() => pitchShift(signal, SHIFT_RATIO));
  const shiftedHz = medianPitch(shifted.value, SAMPLE_RATE);
  const realTimeBudget = LOOP_SECONDS * 1000;

  console.log(`  time-stretch ${SHIFT_RATIO.toFixed(3)}     : ${stretch.ms.toFixed(1)} ms`);
  console.log(
    `  full shift of a ${LOOP_SECONDS}s loop : ${shifted.ms.toFixed(1)} ms ` +
      `(${((shifted.ms / realTimeBudget) * 100).toFixed(1)}% of the loop's own length)`,
  );
  console.log(`  detected after shift  : ${shiftedHz === null ? "none" : shiftedHz.toFixed(1)} Hz`);
  console.log();

  console.log("Assertions");

  const budgetMs = Number(process.env.PITCH_SHIFT_BUDGET_MS ?? 2000);

  check(
    "one-window detection is accurate",
    Math.abs(cents(oneWindow.value, TRUE_HZ)) < 20,
    `${cents(oneWindow.value, TRUE_HZ).toFixed(1)} cents from truth`,
  );
  check(
    "whole-loop detection is accurate",
    wholeLoop.value !== null && Math.abs(cents(wholeLoop.value, TRUE_HZ)) < 20,
    `${wholeLoop.value === null ? "none" : cents(wholeLoop.value, TRUE_HZ).toFixed(1)} cents from truth`,
  );
  check(
    "shift transposes by the requested ratio",
    shiftedHz !== null && Math.abs(cents(shiftedHz, TRUE_HZ * SHIFT_RATIO)) < 35,
    `${shiftedHz === null ? "none" : shiftedHz.toFixed(1)} Hz, wanted ${(TRUE_HZ * SHIFT_RATIO).toFixed(1)} Hz`,
  );
  check(
    "duration is preserved",
    shifted.value.length >= signal.length * 0.9 && shifted.value.length <= signal.length * 1.1,
    `${shifted.value.length} samples out, ${signal.length} in`,
  );
  check(
    "the whole loop shifts in well under real time",
    shifted.ms < budgetMs,
    `${shifted.ms.toFixed(1)} ms against a ${budgetMs} ms budget`,
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nAll assertions passed.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
