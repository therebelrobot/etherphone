# Capture spike — protocol and results (RFC #12)

RFC #12 asks for the live capture path to be measured before it is committed to,
"the way #11 measured pitch shifting". This is that measurement.

## Running it

```bash
npm run spike:capture
```

That serves `index.html` on <http://localhost:5199>. `localhost` counts as a
secure context, so the camera works.

The page composites a real camera image with a synthetic hand overlay and an
energy ribbon, records it through `MediaRecorder` with
`CanvasCaptureMediaStreamTrack` at 30 fps plus an audio track, and reports a
JSON block to copy. It also times an `OfflineAudioContext` render of a four-layer
graph — chord bed, melody, kit, voice loop — because the RFC's third question is
how an offline export compares to the take's own length.

### What the RFC asks for

1. `MediaRecorder` CPU and memory overhead for a **5-minute** composite at
   **720p and 1080p**, in **Chrome, Firefox, and Safari**.
2. Whether `CanvasCaptureMediaStreamTrack` at **30 fps** keeps up with the camera
   and overlay on a laptop that is **also running MediaPipe inference**.
3. **Offline render time for a 5-minute take** relative to its length.

### How to take the three measurements honestly

| Measurement       | How                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Overhead       | 5-minute runs, both sizes, in each browser. Keep `compositeFps`, `megabytesPerMinute`, `heapBeforeMb` → `heapAfterMb`.                                                        |
| 2. Inference load | Run the instrument itself (<http://localhost:5173>) in a second tab while this page records. **Do not** record from that tab — the point is to load the machine, not the tab. |
| 3. Offline render | Reported automatically as `offlineRenderMs` / `offlineRenderRatio`. The ratio is the number that matters: 1.0 means a 5-minute export takes 5 minutes.                        |

A 5-minute run at 1080p is roughly 40–150 MB in the recorder's buffer, which is
the RFC's own "length and memory" question. Watch for it.

## Results

Nothing here yet. The spike has no numbers because it needs a human in front of
three browsers on a laptop running the instrument — which is the point of
committing the harness rather than a claim.

Paste each browser's JSON below as it is taken.

### Chrome

```json

```

### Firefox

```json

```

### Safari

```json

```

## What this decides

The RFC's first open question is _which renderer leads_ — live capture, or the
deterministic offline render. It proposes live first because video is the point
of a social clip.

The answer turns on measurement 2. If live 1080p cannot hold frame rate on a
mid-range laptop while MediaPipe is inferring, the order flips: offline audio
first, and video as an option rather than the default. `compositeFps` against
the 30 fps target, with the instrument running in the other tab, is the number
to read.
