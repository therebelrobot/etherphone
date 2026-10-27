/**
 * Canvas overlay rendering: the mirrored webcam frame plus the hand skeleton.
 */
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { LANDMARK_DOT_RADIUS } from "../config/constants";
import type { CanvasPoint, CoverRect } from "../types";

/**
 * Computes a "cover" crop in source-video pixel space: the largest centred
 * rectangle matching the destination's aspect ratio, so the video fills the
 * screen with zero stretch.
 */
export function computeCoverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CoverRect {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (srcRatio > dstRatio) {
    const sHeight = srcH;
    const sWidth = srcH * dstRatio;
    return { sx: (srcW - sWidth) / 2, sy: 0, sWidth, sHeight };
  }

  const sWidth = srcW;
  const sHeight = srcW / dstRatio;
  return { sx: 0, sy: (srcH - sHeight) / 2, sWidth, sHeight };
}

/**
 * Maps a normalised landmark onto the canvas, mirroring it the way the frame is.
 *
 * {@link drawFrame} draws inside a horizontally flipped transform, so a
 * landmark's on-screen position is the mirror of its cover-cropped position.
 * Anything that has to line up with the drawn skeleton — the menu cursor, and
 * the hit-testing behind it — must come through here rather than using raw
 * normalised values, or the menu will select the option on the opposite side.
 */
export function landmarkToCanvas(
  point: { readonly x: number; readonly y: number },
  srcW: number,
  srcH: number,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  const canvasX = ((point.x * srcW - sx) / sWidth) * canvasWidth;
  const canvasY = ((point.y * srcH - sy) / sHeight) * canvasHeight;

  return { x: canvasWidth - canvasX, y: canvasY };
}

/**
 * Draws one frame: the mirrored, cover-cropped video, then a dot per landmark.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  results: HandLandmarkerResult,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return;

  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.translate(canvasWidth, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#ffffff80";
  for (const landmarks of results.landmarks) {
    for (const point of landmarks) {
      const videoPx = point.x * srcW;
      const videoPy = point.y * srcH;
      const canvasX = ((videoPx - sx) / sWidth) * canvasWidth;
      const canvasY = ((videoPy - sy) / sHeight) * canvasHeight;

      ctx.beginPath();
      ctx.arc(canvasX, canvasY, LANDMARK_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
