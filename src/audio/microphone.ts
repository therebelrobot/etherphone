/**
 * Microphone access.
 *
 * Requested **separately** from the camera, and only when a voice layer is first
 * armed. RFC #9 asks the question directly — "Same `getUserMedia` call as the
 * camera, or a separate one?" — and the answer is separate for a reason worth
 * restating: the two failures are then independent, so a denied microphone
 * leaves a playable instrument rather than a dark one, and the camera module
 * stays about the camera.
 *
 * The prompt is asked *when it is needed* rather than at startup, because a
 * permission dialog before a player has asked for anything is a dialog that gets
 * dismissed reflexively — and a dismissed prompt is expensive to recover from.
 *
 * Nothing here ever leaves the machine. What is captured goes into an
 * `AudioBuffer` and is played back locally; there is no upload, no server, and
 * no analytics, which the UI says plainly rather than leaving to be assumed.
 */
import { MIC_CONSTRAINTS } from "../config/constants";
import { describeDeviceError, hasSecureContext } from "../media";

/**
 * Whether this page can ask for the microphone.
 *
 * Both halves matter: an insecure page cannot, and a browser without
 * `mediaDevices` cannot either — and neither case surfaces an error worth
 * reading, so both are answered before the request.
 */
export function canRequestMicrophone(): boolean {
  return (
    hasSecureContext() &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Requests the microphone, audio only.
 *
 * The stream is the caller's to stop: a capture connection is not the lifetime of
 * the page, so the caller decides when the indicator light goes out.
 *
 * A failure is thrown as an `Error` whose message is already the player-facing
 * sentence, so the caller does nothing but show it.
 */
export async function startMicrophone(): Promise<MediaStream> {
  const secure = hasSecureContext();

  try {
    return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    // The original is kept as the cause: the message is for the player, and the
    // error's own name is what a bug report needs.
    throw new Error(describeDeviceError(error, secure, "microphone"), { cause: error });
  }
}
