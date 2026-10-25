# Gesture Synth

A camera-based musical instrument that lets you control chords, tone, and expression using hand gestures.

## Demo

🎥 Watch the Gesture Synth tutorial on Instagram:
https://www.instagram.com/p/DbH1BACxNCG/

## Features

- Left hand controls chord selection
- Right hand controls voicing and expression
- Real-time hand tracking with MediaPipe
- Web Audio API synthesis
- A picker of instruments: oscillators, wavetables, and sampled sounds
- Load your own wavetables and samples as new instruments

## Built With

- TypeScript
- MediaPipe Hand Landmarker
- Web Audio API
- Vite

## Getting Started

```bash
npm install
npm run dev
```

Open the dev server URL, click the start overlay to grant audio, and allow camera access. The camera only works on `localhost` or over HTTPS — browsers block `getUserMedia` on plain HTTP.

### Scripts

| Script              | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload       |
| `npm run build`     | Typecheck, then build to `dist/`      |
| `npm run preview`   | Serve the production build locally    |
| `npm run typecheck` | `tsc --noEmit`                        |
| `npm run lint`      | ESLint (and `lint:fix` to autofix)    |
| `npm run format`    | Prettier (and `format:check` for CI)  |
| `npm test`          | Vitest, single run (and `test:watch`) |
| `npm run coverage`  | Vitest with a V8 coverage report      |
| `npm run samples`   | Regenerate the bundled sample WAVs    |

## Architecture

The instrument is a pipeline. Each stage is its own module, and only `src/app.ts` knows about all of them at once:

```
camera ──▶ landmarks ──▶ musical intent ──▶ stabiliser ──▶ audio
                                                   └────▶ visuals
```

```
src/
  main.ts                  Entry point: mount the app, report startup failures.
  app.ts                   The only module that wires the layers together. Owns the
                           per-frame state and the requestAnimationFrame loop.

  types.ts                 Shared vocabulary (Hand, ChordNumeral, ChordState, ...).
  types/globals.d.ts       Ambient declaration for Safari's prefixed AudioContext.

  config/
    constants.ts           Cross-cutting tunables: timing windows, camera settings,
                           tilt travel, filter response.
    music.ts               Music-theory tables: scales, semitone offsets, palette.

  vision/
    camera.ts              getUserMedia, resolving when the video has metadata.
    hand-tracking.ts       MediaPipe HandLandmarker construction.
    gestures.ts            Landmark interpretation: finger extension, tilt, volume,
                           chord classification. Pure functions, no DOM.
    overlay.ts             Cover-crop maths and canvas frame drawing.

  music/
    harmony.ts             Roman numeral + tonic -> note names and frequencies.
    voicings.ts            The four right-hand voicings per mode, each with a label
                           and a note selector, so readout and audio cannot drift.
    stabilizer.ts          Temporal smoothing: holds a chord before committing it,
                           and rides out brief dropouts.

  audio/
    synth-engine.ts        Voice -> waveshaper -> lowpass filter -> master gain.
                           Owns the shared chain and the AudioContext; the notes
                           themselves belong to whichever voice is loaded.
    voice.ts               The Voice interface, the instrument registry, and the
                           frequency key voices use to skip unchanged frames.
    wavetable.ts           Harmonic spectra: the bundled tables and the analysis
                           of a loaded cycle. Pure arithmetic.
    sampler.ts             Playback-rate maths, the loop crossfade, and the list
                           of bundled recordings. Pure arithmetic.
    user-voices.ts         Turns a file you loaded into a registrable instrument.

    voices/
      bank.ts              Shared lifecycle for one-oscillator-per-note voices.
      oscillator-voice.ts  Plain waveforms, one instrument per shape.
      wavetable-voice.ts   A spectrum, played through a PeriodicWave.
      sampler-voice.ts     One recording pitched across the keyboard.
      index.ts             Registers the built-in instruments, in picker order.

  visuals/
    energy.ts              The jittering "energy ribbon" behind the chord readout.

  ui/
    dom.ts                 The full list of ids and classes the app expects.
    hud.ts                 Chord, quality, and filter readouts.
    volume-meter.ts        The eight-segment volume meter.
    gesture-guide.ts       The scale-degree cheat sheet.
    help-modal.ts          The "how to play" modal.
    start-overlay.ts       The click-to-enable-audio gate.
```

### How the gestures map to music

**Left hand — chord**

| Input                 | Result           |
| --------------------- | ---------------- |
| 1–5 fingers           | Scale degree I–V |
| Index + pinky         | VI               |
| Index + pinky + thumb | VII              |
| Tilt inward / outward | Major / minor    |

**Right hand — voicing and expression**

| Input                 | Result                                          |
| --------------------- | ----------------------------------------------- |
| 1–4 fingers           | Root position, 1st inversion, 7th, dominant/dim |
| Thumb in / out        | Drop the voicing an octave / leave it           |
| Tilt inward / outward | Close the filter / open it                      |
| Height                | Louder the higher the hand                      |

The chord hand feeds `ChordStabilizer`, which requires a new chord to hold for 100ms before it is committed and tolerates a 50ms dropout. That is why the instrument does not flicker between chords when MediaPipe loses a hand for a frame.

### Instruments

The picker lists every instrument, and each one is a **voice**: a small module
that turns a list of frequencies into sound. `SynthEngine` owns the shared chain —
`voice → waveshaper → lowpass filter → master gain` — and the `AudioContext`. A
voice owns only its own nodes.

```
SynthEngine.playNotes(freqs) ──▶ voice.play(freqs) ──▶ waveshaper ──▶ filter ──▶ gain
```

`playNotes` is the whole interface. It never learns what kind of voice it is
talking to, so swapping an oscillator for a sampler is a registry lookup.

Three kinds ship in the box:

| Kind       | What it does                                                                      |
| ---------- | --------------------------------------------------------------------------------- |
| Oscillator | Plain waveforms: Warm, Bright, and Retro Synth.                                   |
| Wavetable  | A single cycle written as harmonic coefficients, played through a `PeriodicWave`. |
| Sampler    | One recording pitched across the keyboard, looped with a crossfaded seam.         |

**Load Wavetable…** reads a `.wav` holding a single cycle and rebuilds it as a
wavetable; **Load Sample…** reads any recording and pitches it across the
keyboard. Both register a new instrument and switch to it, down the same path the
built-in ones take — the picker cannot tell them apart.

Two caveats about loaded files, both deliberate:

- A wavetable file must be **one cycle**. A file holding many cycles analyses as a
  smeared spectrum, not the timbre you recorded.
- A sample's pitch is **assumed to be A2 (110 Hz)**, since nothing here detects
  it. A recording at another pitch is heard transposed by the interval between the
  two.

The bundled samples are generated rather than sourced: `npm run samples` writes
them into `public/samples/` from `scripts/generate-samples.mjs`, so the repository
owns their licence and the recipe is reviewable.

### Adding to it

- **A new instrument:** implement `Voice` — or reuse `OscillatorBank` — and register a `VoiceDefinition` in `src/audio/voices/index.ts`. It shows up in the picker; nothing else changes.
- **A new wavetable:** add an entry to `WAVETABLE_PRESETS` in `src/audio/wavetable.ts`.
- **A new sample:** drop a `.wav` into `public/samples/` and add it to `BUNDLED_SAMPLES` in `src/audio/sampler.ts`.
- **A new voicing:** add one entry to `MAJOR_VOICINGS` or `MINOR_VOICINGS` in `src/music/voicings.ts`. The label and the notes come from the same object.
- **A new key:** add its tonic frequency to the `<select id="keySelect">` in `index.html` and its scale to `MAJOR_SCALE` in `src/config/music.ts`.
- **A new synth stage:** insert it into the shared chain in `SynthEngine.ensureContext()`; the graph order is documented there.
- **A new gesture:** add a pure function to `src/vision/gestures.ts` and cover it in `gestures.test.ts`.

## Self-Hosting with Docker

The repo publishes a multi-arch (amd64 + arm64) image to GitHub Container Registry:

```bash
docker run -p 8080:80 ghcr.io/therebelrobot/gesture-synth-plus:latest
```

Or with Compose:

```bash
docker compose up -d
```

Then open <http://localhost:8080>.

> **Camera access requires a secure context.** `localhost` counts as secure, so the command above works. On any other hostname you must serve the container over HTTPS and proxy to it — put Caddy, Traefik, or a cloud load balancer in front, or terminate TLS inside nginx.

To build the image yourself:

```bash
npm run docker:build
```

> **First publish:** a new GHCR package starts private. On the package page, go to Package settings → Change visibility → Public, otherwise the compose file will fail to pull anonymously.

Verify a published image:

```bash
docker buildx imagetools inspect ghcr.io/therebelrobot/gesture-synth-plus:latest
gh attestation verify oci://ghcr.io/therebelrobot/gesture-synth-plus:latest --owner therebelrobot
```

## Deployment

| Target           | Workflow                                        | Required setup                                                                                                                                                                  |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Pages     | `.github/workflows/deploy-pages.yml`            | Settings → Pages → Source = "GitHub Actions". The build is given a `/<repo>/` base path automatically.                                                                          |
| Cloudflare Pages | `.github/workflows/deploy-cloudflare-pages.yml` | Create a Pages project, set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets, and a `CLOUDFLARE_PAGES_PROJECT` variable. The job is skipped until that variable exists. |
| GHCR image       | `.github/workflows/ghcr-publish.yml`            | Nothing — uses the built-in `GITHUB_TOKEN`.                                                                                                                                     |

Any other static host works too — the build output in `dist/` is plain HTML, CSS, and JS. [Vercel](https://vercel.com), for example, auto-detects Vite and serves `dist/`.

CI (`.github/workflows/ci.yml`) runs formatting, linting, typechecking, tests, and a build on every push to `main` and every pull request.

To cut a release (which tags and triggers the multi-arch image build):

```bash
npm run release:patch   # or release:minor / release:major
```

## License

Gesture Synth is free to use, modify, and share for educational and non-commercial purposes.
If you build upon this project, please credit the original creator.

See [LICENSE](./LICENSE) for the full text.

Gesture Synth was created by [Eric Wei](https://indecisiveeric.com).
