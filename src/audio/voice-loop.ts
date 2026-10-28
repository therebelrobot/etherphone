/**
 * Assembling a captured voice loop.
 *
 * Everything here is pure arithmetic over sample arrays, which is deliberate:
 * the interesting part of a capture is *where the window starts and how long it
 * is*, and that is exactly what cannot be checked by listening. The audio-thread
 * plumbing lives in `./voice-capture`, and it does nothing but hand chunks here.
 *
 * RFC #9's point is that a loop has to line up with the grid, so the recorder
 * does not start its window when the samples happen to arrive — the caller says
 * how many frames to *discard* first, which is how a capture begun mid-bar still
 * begins on the bar line.
 */

/**
 * How many frames one pass of the loop is, at this tempo.
 *
 * Rounded rather than truncated, and then used as the authority everywhere else:
 * a loop that is a fraction of a sample short of the grid drifts against the
 * layers underneath it, and the drift is only audible once it has accumulated.
 */
export function loopFrameCount(loopBeats: number, bpm: number, sampleRate: number): number {
  const seconds = (loopBeats * 60) / bpm;

  return Math.max(1, Math.round(seconds * sampleRate));
}

/** How many frames to drop when a capture begins early, before `startAt`. */
export function framesToSkip(
  nowSeconds: number,
  startAtSeconds: number,
  sampleRate: number,
): number {
  return Math.max(0, Math.round((startAtSeconds - nowSeconds) * sampleRate));
}

/**
 * Joins captured chunks into exactly `frameCount` samples.
 *
 * Trims past the end and pads short with silence, because a capture is stopped by
 * a frame count and the audio thread stops on its own schedule — so the last
 * chunk generally overshoots and the total is occasionally a chunk short of the
 * target. A loop that is quietly the wrong length is worse than one that ends in
 * silence.
 */
export function assembleChannel(
  chunks: readonly Float32Array[],
  frameCount: number,
  skipFrames = 0,
): Float32Array {
  const out = new Float32Array(frameCount);
  let written = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      if (skipped < skipFrames) {
        skipped += 1;
        continue;
      }

      if (written >= frameCount) return out;

      out[written] = chunk[i];
      written += 1;
    }
  }

  return out;
}

/**
 * How loud a capture is, as the mean absolute sample.
 *
 * Used to refuse a loop that recorded nothing — a muted input, a denied device
 * that resolved anyway, or a player who stayed silent — because silently
 * registering a silent instrument is worse than saying so.
 */
export function meanLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let total = 0;
  for (const sample of samples) total += Math.abs(sample);

  return total / samples.length;
}

/** Whether a capture holds anything worth keeping. */
export function isSilentCapture(samples: Float32Array): boolean {
  return meanLevel(samples) < 0.0005;
}
