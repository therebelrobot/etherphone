/**
 * The "energy ribbon": a flowing, jittering set of lines behind the chord
 * readout. Every parameter of the drawing comes from the player's hands.
 *
 * - Voicing picks how many lines are drawn.
 * - Volume picks how thick they are.
 * - Filter tilt picks how chaotic the jitter is.
 * - Scale degree picks the hue; major/minor picks the brightness.
 */
import { DEFAULT_CHORD_COLOR_RGB, IDLE_COLOR_RGB, SCALE_COLORS } from "../config/music";
import type { ChordNumeral, Numeral } from "../types";

/** Distance from the bottom of the canvas to the ribbon's baseline, in pixels. */
const BASELINE_OFFSET = 56;
/** Vertical gap between lines when more than one is drawn, in pixels. */
const LINE_STACK_SPACING = 12;
/** Line width at full volume, in pixels. */
const MAX_EXTRA_THICKNESS = 8;
/** Peak jitter amplitude at maximum chaos, in pixels. */
const CHAOS_AMPLITUDE = 25;
/** Jitter frequency at zero chaos. */
const CHAOS_FREQUENCY_BASE = 0.05;
/** Additional jitter frequency at maximum chaos. */
const CHAOS_FREQUENCY_RANGE = 0.15;
/** Horizontal step between sampled points, in pixels. */
const X_STEP = 10;

/** Picks the palette entry for a chord, falling back to the brand gold. */
function colorForChord(chordStr: string): string {
  const upper = chordStr.toUpperCase() as Numeral;
  return SCALE_COLORS[upper] ?? DEFAULT_CHORD_COLOR_RGB;
}

/**
 * Draws one frame of the ribbon.
 *
 * @param volume01 - Master volume, 0..1.
 * @param qualityIndex - Right-hand finger count, 0..4. Zero draws nothing.
 * @param tiltFactor - Right-hand filter tilt, -1..1.
 * @param chord - The current chord numeral, or `null` when nothing is playing.
 */
export function drawEnergy(
  ctx: CanvasRenderingContext2D | null,
  volume01: number,
  qualityIndex: number,
  tiltFactor: number,
  chord: ChordNumeral | null,
): void {
  if (!ctx) return;
  if (qualityIndex === 0) return;

  const lineCount = qualityIndex;

  try {
    const centerY = ctx.canvas.height - BASELINE_OFFSET;
    const canvasWidth = ctx.canvas.width;

    const maxThickness = 1 + volume01 * MAX_EXTRA_THICKNESS;

    // Tilt (-1..1) becomes a chaos scale (0..1): centred hands are calm.
    const chaosScale = (tiltFactor + 1) / 2;
    const shakinessAmp = chaosScale * CHAOS_AMPLITUDE;
    const shakinessFreq = CHAOS_FREQUENCY_BASE + chaosScale * CHAOS_FREQUENCY_RANGE;

    const isChordActive = chord !== null;

    let baseColorRGB = IDLE_COLOR_RGB;
    let isMajor = false;

    if (chord) {
      isMajor = chord === chord.toUpperCase();
      baseColorRGB = colorForChord(chord);
    }

    // Major chords glow at full strength; minor chords sit back a little.
    const brightnessAlpha = isChordActive ? (isMajor ? 1 : 0.7) : 0.3;

    ctx.save();

    // Drives the left-to-right scrolling motion from frame to frame.
    const time = performance.now() * 0.004;

    const [r, g, b] = baseColorRGB.split(",").map((channel) => parseInt(channel, 10));

    ctx.shadowBlur = 10 + volume01 * 20;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.5 * brightnessAlpha})`;

    for (let l = 0; l < lineCount; l++) {
      ctx.beginPath();

      // Fan the lines out around the baseline so they read as one ribbon.
      const lineYOffset = centerY + (l - (lineCount - 1) / 2) * LINE_STACK_SPACING;

      for (let x = 0; x <= canvasWidth; x += X_STEP) {
        const baseSine = Math.sin(x * 0.005 + time + l * 0.5) * 20;

        // Random noise, scaled entirely by the right hand's tilt.
        const jitter = (Math.random() - 0.5) * shakinessAmp * Math.sin(x * shakinessFreq + time);

        const y = lineYOffset + baseSine + jitter;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${brightnessAlpha})`;
      ctx.lineWidth = Math.max(1, maxThickness - l * 0.5);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    ctx.restore();
  } catch (error) {
    console.error("Wave animation failed:", error);
  }
}
