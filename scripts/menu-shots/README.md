# Menu shots

Renders the gesture menu without a camera, so it can be photographed.

The menu is the one part of the instrument a browser cannot screenshot by opening
the app: it is driven by hands, and a hand is the one thing a headless browser does
not have. So this harness plays the part `app.ts` plays — it supplies the clusters
and the cursor — and draws with the **real** code: `MenuController`,
`drawMenuBackdrop`, `drawCluster`, `drawMappingDiagram` and every cluster builder
are the ones the instrument ships. Nothing here is a mockup.

The state is reached the way a player reaches it: the controller is opened with a
held gesture, the cursor is pushed out at the option to hover, and the frame is
taken part-way through the dwell — so the ring in a shot is a ring that was
actually filling.

## Capturing

```bash
npm run shots:menu          # serves the steps on http://localhost:5198
```

Then, with Chrome running headless, one shot per step:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for step in edit-map which-hand poses kinds chords; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1280,820 --virtual-time-budget=6000 \
    --screenshot="docs/screenshots/map-editor/$step.png" "http://localhost:5198/?step=$step"
done
```

`?step=` names the frame; the names are the keys of `STEPS` in `main.ts`. An
unknown name throws with the list, which is quicker than reading the file.

`--virtual-time-budget` is what makes this work: the drawing is synchronous but
the module that does it is not, so a screenshot taken at the load event catches an
empty canvas.
