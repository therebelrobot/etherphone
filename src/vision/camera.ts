/**
 * Webcam access.
 *
 * Note that `getUserMedia` requires a secure context: HTTPS, or `localhost` for
 * local development. This matters when self-hosting the Docker image.
 */
import { CAMERA_CONSTRAINTS } from "../config/constants";

/**
 * Shown when the page is not a secure context.
 *
 * `getUserMedia` is gated on HTTPS or `localhost`, and a self-hosted Docker
 * image served over plain HTTP is the usual way to meet the gate. Browsers do
 * not offer a camera to such a page at all, so there is no error to read — the
 * device is simply absent.
 */
export const INSECURE_CONTEXT_MESSAGE =
  "The camera needs a secure page. This one is served over plain HTTP, and " +
  "browsers refuse camera access there — open the https:// address instead.";

/**
 * Whether this page may ask for the camera.
 *
 * Checked before the request rather than after, because a refusal in an
 * insecure context is indistinguishable from a missing camera.
 */
export function hasSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

/**
 * Turns a camera failure into something a player can act on.
 *
 * `secure` is passed in rather than read here so the mapping is a pure function
 * of the two things it depends on, and can be tested without a browser.
 */
export function describeCameraError(error: unknown, secure: boolean): string {
  if (!secure) return INSECURE_CONTEXT_MESSAGE;

  const name = error instanceof Error ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return (
        "Camera permission is blocked. Allow it for this site in the address " +
        "bar, then reload the page."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Connect one, then reload the page.";
    case "NotReadableError":
      return "The camera is already in use by another application. Close it, then reload the page.";
    default:
      return "The camera could not be started. Reload the page and allow camera access.";
  }
}

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
