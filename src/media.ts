/**
 * Permission failures, for the two devices the instrument asks for.
 *
 * The camera and the microphone fail in the same *shapes* — refused, absent,
 * busy — and the difference is only what to call the thing and what to suggest.
 * Sharing the mapping keeps the two from drifting into inconsistent wording,
 * which is the sort of drift a player reads as two unrelated bugs.
 *
 * `secure` is a parameter rather than a read, so the mapping stays a pure
 * function of what it depends on and can be tested without a browser;
 * {@link hasSecureContext} is the read.
 */

/**
 * Whether this page may ask for a device at all.
 *
 * Checked *before* the request rather than after, because a refusal in an
 * insecure context is indistinguishable from a missing device.
 */
export function hasSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

/** The two devices the instrument asks permission for. */
export type MediaDevice = "camera" | "microphone";

/**
 * Shown when the page is not a secure context.
 *
 * `getUserMedia` is gated on HTTPS or `localhost`, and a self-hosted Docker
 * image served over plain HTTP is the usual way to meet the gate. Browsers do
 * not offer the device to such a page at all, so there is no error to read — the
 * hardware is simply absent.
 */
export const INSECURE_CONTEXT_MESSAGES: Record<MediaDevice, string> = {
  camera:
    "The camera needs a secure page. This one is served over plain HTTP, and " +
    "browsers refuse camera access there — open the https:// address instead.",
  microphone:
    "The microphone needs a secure page. This one is served over plain HTTP, and " +
    "browsers refuse microphone access there — open the https:// address instead.",
};

/**
 * Turns a `getUserMedia` failure into something a player can act on.
 *
 * A refusal in an insecure context is indistinguishable from a missing device,
 * which is why that case is answered from the context rather than from the error.
 */
export function describeDeviceError(error: unknown, secure: boolean, device: MediaDevice): string {
  if (!secure) return INSECURE_CONTEXT_MESSAGES[device];

  const name = error instanceof Error ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return (
        `${device === "camera" ? "Camera" : "Microphone"} permission is blocked. ` +
        "Allow it for this site in the address bar, then reload the page."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${device} was found. Connect one, then reload the page.`;
    case "NotReadableError":
      return (
        `The ${device} is already in use by another application. ` +
        "Close it, then reload the page."
      );
    default:
      return `The ${device} could not be started. Reload the page and allow access.`;
  }
}
