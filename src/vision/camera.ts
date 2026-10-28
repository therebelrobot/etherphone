/**
 * Webcam access.
 *
 * Note that `getUserMedia` requires a secure context: HTTPS, or `localhost` for
 * local development. This matters when self-hosting the Docker image.
 */
import { CAMERA_CONSTRAINTS } from "../config/constants";
import { describeDeviceError, hasSecureContext, INSECURE_CONTEXT_MESSAGES } from "../media";

/**
 * Shown when the page is not a secure context.
 *
 * `getUserMedia` is gated on HTTPS or `localhost`, and a self-hosted Docker
 * image served over plain HTTP is the usual way to meet the gate. Browsers do
 * not offer a camera to such a page at all, so there is no error to read — the
 * device is simply absent.
 */
export const INSECURE_CONTEXT_MESSAGE = INSECURE_CONTEXT_MESSAGES.camera;

/**
 * Turns a camera failure into something a player can act on.
 *
 * A thin call into the shared device mapping, kept under this name because the
 * camera is where the failure was first worth explaining and it is the one the
 * instrument's own docs point at.
 */
export function describeCameraError(error: unknown, secure: boolean): string {
  return describeDeviceError(error, secure, "camera");
}

export { hasSecureContext };

/**
 * Requests the webcam and resolves once the video element has metadata, so
 * callers can safely read `videoWidth` / `videoHeight`.
 *
 * The stream is intentionally never stopped: the instrument keeps the camera
 * for the lifetime of the page.
 */
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (!hasSecureContext()) throw new Error(INSECURE_CONTEXT_MESSAGE);

  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      void video.play();
      resolve();
    };
  });
}
