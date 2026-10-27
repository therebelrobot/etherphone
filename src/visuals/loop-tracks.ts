/**
 * The loop's tracks, drawn as lanes along a timeline.
 *
 * A looper that only says "Looping · 4 bars" tells you nothing about what is on
 * the loop. Once there is more than one track — a chord bed with a melody over
 * it — you need to see which layers exist, where their notes fall, and where the
 * playhead is between them. This is that view: one lane per track, its notes as
 * blocks along the bar, and a playhead sweeping across.
 *
 * Everything is positioned in beats, so the lanes read against the same grid
 * the transport keeps — the picture and the timing cannot disagree.
 */
import { SCALE_COLORS } from "../config/music";
import type { ChordNumeral, InstrumentMode, TakeEvent } from "../types";

/** A stretch of the loop that one event holds, in beats. */
export interface TrackSegment {
  readonly startBeat: number;
  readonly endBeat: number;
  readonly kind: "chord" | "note";
  /** The chord's numeral, for the colour. `null` for a note. */
  readonly numeral: ChordNumeral | null;
}

/** One track, as the view needs it. */
export interface TrackLane {
  readonly label: string;
  readonly mode: InstrumentMode;
  readonly segments: readonly TrackSegment[];
  readonly isRecording: boolean;
  readonly isEmpty: boolean;
  /** A muted lane is drawn faded and struck through, so the state reads at a glance. */
  readonly muted: boolean;
}

export interface LoopTracksFrame {
  readonly lanes: readonly TrackLane[];
  /** Where the playhead is, in beats from the loop's start. */
  readonly positionBeats: number;
  readonly loopBeats: number;
  readonly isPlaying: boolean;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

const GOLD = "#e8a13d";
const STEEL = "#7fa8c9";
const PANEL_BG = "rgba(10, 10, 10, 0.74)";
const LANE_BG = "rgba(255, 255, 255, 0.05)";
const BORDER = "#3a3428";
const PLAYHEAD = "#fff6e6";

const LANE_HEIGHT = 26;
const LANE_GAP = 6;
const LABEL_WIDTH = 76;
const PANEL_PADDING = 12;
const MAX_PANEL_WIDTH = 760;
const MIN_PANEL_WIDTH = 320;
/** Clearance from the bottom, so the lanes sit above the energy ribbon. */
const BOTTOM_OFFSET = 104;

/**
 * Turns a track's events into the blocks to draw.
 *
 * An event holds until the next one, so a chord that lasts two bars is one
 * block two bars wide rather than a tick. Rests hold nothing, which is what
 * leaves a gap in the lane rather than a block coloured like silence.
 */
export function trackSegments(events: readonly TakeEvent[], loopBeats: number): TrackSegment[] {
  const sorted = [...events].sort((a, b) => a.beat - b.beat);
  const segments: TrackSegment[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index];
    if (event.kind === "rest") continue;

    const next = sorted[index + 1];
    const startBeat = Math.max(0, event.beat);
    const endBeat = Math.min(next ? next.beat : loopBeats, loopBeats);
    if (endBeat <= startBeat) continue;

    segments.push({
      startBeat,
      endBeat,
      kind: event.kind,
      numeral: event.kind === "chord" ? event.numeral : null,
    });
  }

  return segments;
}

/** A rounded rectangle, without depending on `ctx.roundRect` support. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** The colour a chord segment is drawn in, from the scale palette. */
function segmentColor(segment: TrackSegment): string {
  if (segment.kind === "note") return STEEL;

  const numeral = segment.numeral?.toUpperCase();
  const rgb = numeral ? SCALE_COLORS[numeral as keyof typeof SCALE_COLORS] : undefined;

  return rgb ? `rgb(${rgb})` : GOLD;
}

/**
 * Draws the tracks panel.
 *
 * Called every frame from the render loop, in screen coordinates — outside the
 * mirrored transform the camera frame is drawn in — so labels read the right way
 * round.
 */
export function drawLoopTracks(ctx: CanvasRenderingContext2D, frame: LoopTracksFrame): void {
  if (frame.lanes.length === 0) return;

  const panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, frame.canvasWidth - 40));
  const panelHeight =
    PANEL_PADDING * 2 + frame.lanes.length * LANE_HEIGHT + (frame.lanes.length - 1) * LANE_GAP;

  const panelX = (frame.canvasWidth - panelWidth) / 2;
  const panelY = frame.canvasHeight - BOTTOM_OFFSET - panelHeight;

  const timelineX = panelX + PANEL_PADDING + LABEL_WIDTH;
  const timelineWidth = panelWidth - PANEL_PADDING * 2 - LABEL_WIDTH;

  ctx.save();

  // The panel itself.
  roundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 8);
  ctx.fillStyle = PANEL_BG;
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  const playheadX =
    timelineX + (frame.positionBeats / Math.max(1, frame.loopBeats)) * timelineWidth;

  frame.lanes.forEach((lane, index) => {
    const laneY = panelY + PANEL_PADDING + index * (LANE_HEIGHT + LANE_GAP);

    // The lane's own strip, tinted while it is the one being recorded.
    roundedRect(ctx, timelineX, laneY, timelineWidth, LANE_HEIGHT, 4);
    ctx.fillStyle = lane.isRecording ? "rgba(232, 84, 61, 0.18)" : LANE_BG;
    ctx.fill();

    if (lane.isEmpty && !lane.isRecording) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(232, 161, 61, 0.35)";
      roundedRect(ctx, timelineX, laneY, timelineWidth, LANE_HEIGHT, 4);
      ctx.stroke();
      ctx.restore();
    }

    // The events, as blocks that run until the next one.
    for (const segment of lane.segments) {
      const startX = timelineX + (segment.startBeat / Math.max(1, frame.loopBeats)) * timelineWidth;
      const endX = timelineX + (segment.endBeat / Math.max(1, frame.loopBeats)) * timelineWidth;
      const soundsNow = !lane.muted && playheadX >= startX && playheadX < endX;

      ctx.globalAlpha = lane.muted ? 0.16 : soundsNow ? 0.95 : 0.5;
      ctx.fillStyle = segmentColor(segment);
      roundedRect(ctx, startX, laneY + 4, Math.max(2, endX - startX - 2), LANE_HEIGHT - 8, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The track's name, coloured like its notes.
    const labelX = panelX + PANEL_PADDING;
    const labelY = laneY + LANE_HEIGHT / 2;
    const isDim = lane.muted || (lane.isEmpty && !lane.isRecording);

    ctx.fillStyle = isDim ? "rgba(232, 161, 61, 0.45)" : GOLD;
    ctx.font = "13px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(lane.label, labelX, labelY);

    // A muted lane is struck through, so "off" is not just "quieter".
    if (lane.muted) {
      const width = ctx.measureText(lane.label).width;
      ctx.strokeStyle = "rgba(232, 84, 61, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(labelX, labelY);
      ctx.lineTo(labelX + width, labelY);
      ctx.stroke();
    }
  });

  // The playhead, drawn last so it reads across every lane.
  if (frame.isPlaying) {
    const top = panelY + PANEL_PADDING;
    const bottom = panelY + panelHeight - PANEL_PADDING;

    ctx.strokeStyle = PLAYHEAD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, top);
    ctx.lineTo(playheadX, bottom);
    ctx.stroke();
  }

  ctx.restore();
}
