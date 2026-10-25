/**
 * Canvas overlay rendering: the mirrored webcam frame plus the hand skeleton.
 */
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { LANDMARK_DOT_RADIUS } from "../config/constants";
import type { CoverRect } from "../types";

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
