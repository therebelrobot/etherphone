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
    synth-engine.ts        Oscillators -> waveshaper -> lowpass filter -> gain.

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

### Adding to it

- **A new voicing:** add one entry to `MAJOR_VOICINGS` or `MINOR_VOICINGS` in `src/music/voicings.ts`. The label and the notes come from the same object.
- **A new key:** add its tonic frequency to the `<select id="keySelect">` in `index.html` and its scale to `MAJOR_SCALE` in `src/config/music.ts`.
- **A new synth stage:** insert it in `SynthEngine.ensureContext()`; the graph order is documented there.
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
