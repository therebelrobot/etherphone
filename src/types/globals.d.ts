export {};

declare global {
  interface Window {
    /** Safari's prefixed AudioContext constructor. */
    webkitAudioContext?: typeof AudioContext;
  }
}
