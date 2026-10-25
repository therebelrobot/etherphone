/**
 * MediaPipe hand-landmarker setup.
 *
 * The landmarker is created once and reused for every frame; construction is
 * expensive because it downloads and compiles the model.
 */
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import {
  HAND_LANDMARKER_MODEL_URL,
  HAND_LANDMARKER_WASM_URL,
  NUM_HANDS,
} from "../config/constants";

/** Downloads the WASM runtime and model, and returns a VIDEO-mode landmarker. */
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(HAND_LANDMARKER_WASM_URL);

  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_LANDMARKER_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: NUM_HANDS,
  });
}
