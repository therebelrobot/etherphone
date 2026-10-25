/**
 * Webcam access.
 *
 * Note that `getUserMedia` requires a secure context: HTTPS, or `localhost` for
 * local development. This matters when self-hosting the Docker image.
 */
import { CAMERA_CONSTRAINTS } from "../config/constants";

/**
 * Requests the webcam and resolves once the video element has metadata, so
 * callers can safely read `videoWidth` / `videoHeight`.
 *
 * The stream is intentionally never stopped: the instrument keeps the camera
 * for the lifetime of the page.
 */
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      void video.play();
      resolve();
    };
  });
}
