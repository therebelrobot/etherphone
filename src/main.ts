/**
 * Application entry point.
 */
import "./styles/main.css";
import { GestureSynthApp } from "./app";

const app = new GestureSynthApp();

app.start().catch((error) => console.error(error));

/**
 * A handle for the browser console while developing.
 *
 * Development only — the production build drops it. It is what lets a scripted
 * check drive the instrument (hand the app synthetic landmarks) without a camera
 * and without the app knowing it is being tested.
 */
if (import.meta.env.DEV) {
  (window as unknown as { etherphone?: GestureSynthApp }).etherphone = app;
}
