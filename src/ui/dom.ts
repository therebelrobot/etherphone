/**
 * DOM lookups.
 *
 * Gathered in one place so the markup contract is discoverable: this is the
 * complete list of ids and classes `index.html` must provide.
 */

/** Everything the app needs from the page, already typed and non-nullable. */
export interface AppElements {
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly chordDisplay: HTMLElement;
  readonly qualityDisplay: HTMLElement;
  readonly filterDisplay: HTMLElement;
  readonly volumeBars: readonly HTMLElement[];
  readonly keySelect: HTMLSelectElement;
  readonly modeSelect: HTMLSelectElement;
  readonly monoStyleSelect: HTMLSelectElement;
  readonly gestureMapSelect: HTMLSelectElement;
  readonly instrumentSelect: HTMLSelectElement;
  readonly loadWavetable: HTMLButtonElement;
  readonly loadSample: HTMLButtonElement;
  readonly wavetableFile: HTMLInputElement;
  readonly sampleFile: HTMLInputElement;
  readonly guideToggle: HTMLButtonElement;
  readonly gestureGuide: HTMLElement;
  readonly tempoSelect: HTMLSelectElement;
  readonly barsSelect: HTMLSelectElement;
  readonly recordButton: HTMLButtonElement;
  readonly playButton: HTMLButtonElement;
  readonly stopButton: HTMLButtonElement;
  readonly clearButton: HTMLButtonElement;
  readonly transportDisplay: HTMLElement;
  readonly layerControls: HTMLElement;
  readonly helpButton: HTMLButtonElement;
  readonly helpModal: HTMLElement;
  readonly closeHelp: HTMLButtonElement;
  readonly helpGestureRows: HTMLElement;
  readonly startOverlay: HTMLElement;
}

import { PROJECT_NAME } from "../config/constants";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`${PROJECT_NAME}: required element "${selector}" is missing from the page`);
  }
  return el;
}

/** Resolves every element the app depends on, failing loudly if the markup drifts. */
export function getAppElements(): AppElements {
  const canvas = requireElement<HTMLCanvasElement>("#overlay");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(`${PROJECT_NAME}: 2D canvas context unavailable on "#overlay"`);
  }

  return {
    video: requireElement<HTMLVideoElement>("#webcam"),
    canvas,
    ctx,
    chordDisplay: requireElement("#chordDisplay"),
    qualityDisplay: requireElement("#qualityDisplay"),
    filterDisplay: requireElement("#distortionDisplay"),
    volumeBars: Array.from(document.querySelectorAll<HTMLElement>(".vol-bar")),
    keySelect: requireElement<HTMLSelectElement>("#keySelect"),
    modeSelect: requireElement<HTMLSelectElement>("#modeSelect"),
    monoStyleSelect: requireElement<HTMLSelectElement>("#monoStyleSelect"),
    gestureMapSelect: requireElement<HTMLSelectElement>("#gestureMapSelect"),
    instrumentSelect: requireElement<HTMLSelectElement>("#instrumentSelect"),
    loadWavetable: requireElement<HTMLButtonElement>("#loadWavetable"),
    loadSample: requireElement<HTMLButtonElement>("#loadSample"),
    wavetableFile: requireElement<HTMLInputElement>("#wavetableFile"),
    sampleFile: requireElement<HTMLInputElement>("#sampleFile"),
    guideToggle: requireElement<HTMLButtonElement>("#guideToggle"),
    gestureGuide: requireElement("#gestureGuide"),
    tempoSelect: requireElement<HTMLSelectElement>("#tempoSelect"),
    barsSelect: requireElement<HTMLSelectElement>("#barsSelect"),
    recordButton: requireElement<HTMLButtonElement>("#recordButton"),
    playButton: requireElement<HTMLButtonElement>("#playButton"),
    stopButton: requireElement<HTMLButtonElement>("#stopButton"),
    clearButton: requireElement<HTMLButtonElement>("#clearButton"),
    transportDisplay: requireElement("#transportDisplay"),
    layerControls: requireElement("#layerControls"),
    helpButton: requireElement<HTMLButtonElement>("#helpButton"),
    helpModal: requireElement("#helpModal"),
    closeHelp: requireElement<HTMLButtonElement>("#closeHelp"),
    helpGestureRows: requireElement("#helpGestureRows"),
    startOverlay: requireElement("#startOverlay"),
  };
}

/** Matches the canvas backing store to the window, in device-independent pixels. */
export function resizeCanvasToWindow(canvas: HTMLCanvasElement): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
