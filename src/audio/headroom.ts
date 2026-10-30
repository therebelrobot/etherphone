/**
 * Keeping the instrument under full scale.
 *
 * Every voice sounds a chord's notes at full level each, which is right for one
 * note and wrong for four: four full-scale waves add up to as much as four times
 * what the output can carry, and what it cannot carry it clips. Clipping is the
 * harsh, buzzing edge a chord had — measured, a Warm Synth chord at a mid-frame
 * hand peaked at almost twice full scale and clipped about an eighth of the time.
 *
 * Two fixes, both here so the live engine and the offline render share them:
 *
 * - {@link chordLevel} scales a chord by how many notes it has, so no chord can
 *   reach full scale however its waves line up. A single note is untouched.
 * - {@link sharedOutput} is a limiter every engine on a context plays through, for
 *   the one sum a chord's level cannot see: the live hands and the loop's layers
 *   playing at once.
 */

/**
 * The loudest a chord may peak, as a fraction of full scale.
 *
 * Short of 1, so a chord on its own never reaches the limiter: the limiter is for
 * layers stacking up, and a limiter working on every chord is a squashed sound.
 */
export const CHORD_PEAK = 0.9;

/** The level a chord of `noteCount` notes plays at, so it cannot clip. */
export function chordLevel(noteCount: number): number {
  return noteCount <= 1 ? 1 : CHORD_PEAK / noteCount;
}

const outputs = new WeakMap<BaseAudioContext, AudioNode>();

/**
 * The context's one way out: a limiter, then the speakers.
 *
 * One per context rather than one per engine, because it is the *sum* of the
 * engines that can exceed full scale, and only something every engine feeds can
 * see the sum.
 */
export function sharedOutput(ctx: BaseAudioContext): AudioNode {
  const existing = outputs.get(ctx);
  if (existing) return existing;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  outputs.set(ctx, limiter);
  return limiter;
}
