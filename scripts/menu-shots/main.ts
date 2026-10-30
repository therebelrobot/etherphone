/**
 * Renders the gesture menu's steps without a camera, so they can be photographed.
 *
 * The menu is the one part of the instrument that cannot be screenshotted by
 * opening the app: it is driven by hands, and a hand is the one thing a headless
 * browser does not have. So this harness plays the part `app.ts` plays — it
 * supplies the clusters and the cursor — and then draws with the *real* drawing
 * code. Nothing here is a mockup: `MenuController`, `drawMenuBackdrop`,
 * `drawCluster` and every cluster builder are the ones the instrument ships.
 *
 * The state is reached the way a player reaches it, too: the controller is opened
 * with a held gesture, the cursor is pushed out at the option to hover, and the
 * frame is taken part-way through the dwell — so the ring in the picture is a
 * ring that was actually filling.
 *
 * `?step=<name>` picks which frame to render; the names are in {@link STEPS}.
 * See `docs/screenshots/map-editor/README.md` for the capture command.
 */
import { CONTROL } from "../../src/config/constants";
import { CUSTOM_MAP_SLOTS, describeSlotTarget, slotsFromMap } from "../../src/music/custom-map";
import {
  DEFAULT_EXPRESSION_MAP,
  EXPRESSION_POSES,
  describePose,
  poseShape,
} from "../../src/music/expression-map";
import { GESTURE_MAPS, OPEN_HAND } from "../../src/music/gesture-map";
import { MenuController, menuTopicsFor } from "../../src/ui/menu-controller";
import type { MenuCluster, MenuInput, MenuUpdate } from "../../src/ui/menu-controller";
import {
  EDIT_MAP_ID,
  MAP_TARGET_KINDS_ID,
  expressionKindsCluster,
  expressionPosesCluster,
  mapEditorCluster,
  mapTargetCluster,
  poseFromOptionId,
  poseOptionId,
  vocabularyCluster,
} from "../../src/ui/menu-clusters";
import { diagramSizeFor, drawMappingDiagram } from "../../src/ui/mapping-diagram";
import {
  MENUS_STYLE,
  OPTIONS_STYLE,
  listBandLeft,
  listBandWidth,
  drawCluster,
  drawMenuBackdrop,
} from "../../src/ui/radial-menu";
import type { DiagramHand } from "../../src/ui/mapping-diagram";
import type { CanvasPoint, HandShape } from "../../src/types";

const WIDTH = 1280;
const HEIGHT = 820;

/** How far a ring reaches from its anchor: its radius plus an option's. */
const RING_REACH = 244;

/** Where the menu hand rests, and where the option hand starts: its own dead zone. */
const MENU_ANCHOR: CanvasPoint = { x: 330, y: 600 };
const OPTION_REST: CanvasPoint = { x: WIDTH / 2, y: HEIGHT / 2 };

/** Long enough for the menu to open, then long enough to fill half a dwell. */
const OPENED_AT = 600;
const HOVER_AT = 700;
const DWELL_FRACTION = 0.5;

interface Step {
  readonly cluster: () => MenuCluster;
  /** Which option the shot shows being dwelt on. */
  readonly hover: string;
  /**
   * The two hands, drawn as the app draws them for this step.
   *
   * Passed in rather than derived, because in the app this is `App`'s job: it is
   * what knows which hand is which, which pose is hovered, and what that pose
   * plays. The harness supplies the same answers for one frame.
   */
  readonly diagram: (hovered: string | null) => readonly DiagramHand[];
}

const POSE = poseShape(EXPRESSION_POSES[5]);
const MAPS = GESTURE_MAPS.map((map) => ({ id: map.id, label: map.label }));

/** Steps with nothing to draw beside them: the ring menus, which have no pose. */
const NO_DIAGRAM = () => [];

/** The two hands: the one being edited bright and in pose, the other at rest. */
const hands = (subject: DiagramHand, other: DiagramHand): readonly DiagramHand[] => [
  subject,
  other,
];

const chordHand: DiagramHand = {
  pose: OPEN_HAND,
  mirror: false,
  caption: "which chord",
  rest: true,
};

const kindHand = (pose: HandShape, caption: string): DiagramHand => ({
  pose,
  mirror: true,
  caption,
});

const STEPS: Record<string, Step> = {
  // The entry point: the vocabulary ring, with the way into the editor last.
  "edit-map": {
    cluster: () => vocabularyCluster(MAPS, "classic"),
    hover: EDIT_MAP_ID,
    diagram: NO_DIAGRAM,
  },
  // The step the editor was missing: which hand's map.
  "which-hand": {
    cluster: () => mapTargetCluster("Left"),
    hover: MAP_TARGET_KINDS_ID,
    diagram: () => [
      { pose: OPEN_HAND, mirror: false, caption: "which chord", rest: true },
      { pose: OPEN_HAND, mirror: true, caption: "what kind" },
    ],
  },
  // The diagram following the cursor from pose to pose.
  poses: {
    cluster: () => expressionPosesCluster(DEFAULT_EXPRESSION_MAP),
    hover: poseOptionId(POSE),
    diagram: (hovered) => {
      const pose = poseFromOptionId(hovered ?? "") ?? OPEN_HAND;

      return hands(
        // The pose's name only, as the app captions it: what it plays is on the
        // readout beside the row being dwelt on, and saying it twice is what made
        // the two captions collide.
        kindHand(pose, describePose(pose)),
        chordHand,
      );
    },
  },
  kinds: {
    cluster: () => expressionKindsCluster(DEFAULT_EXPRESSION_MAP, POSE),
    hover: "sus4",
    diagram: () => hands(kindHand(POSE, describePose(POSE)), chordHand),
  },
  // For comparison: the chord hand's own editor.
  chords: {
    cluster: () => mapEditorCluster(slotsFromMap(GESTURE_MAPS[0]), null),
    hover: "count-2",
    diagram: (hovered) => {
      const slot = CUSTOM_MAP_SLOTS.find((candidate) => candidate.id === hovered);

      return hands(
        {
          pose: slot?.shape ?? OPEN_HAND,
          mirror: false,
          caption: slot
            ? `${slot.label} → ${describeSlotTarget(slot.read(slotsFromMap(GESTURE_MAPS[0])))}`
            : "which chord",
        },
        kindHand(OPEN_HAND, "what kind"),
      );
    },
  },
};

/**
 * Where to put the option cursor to hover a given option.
 *
 * Read off the frame the controller just laid out, so the shot hovers whatever
 * the real hit-testing would hit rather than a coordinate this file guessed.
 */
function cursorFor(frame: MenuUpdate, id: string): CanvasPoint {
  const slot = frame.options.slots.find((candidate) => candidate.id === id);
  if (slot) return { x: slot.x, y: slot.y };

  const row = frame.options.rows.find((candidate) => candidate.id === id);
  if (row) return { x: WIDTH / 2, y: row.y };

  throw new Error(`the step has no option "${id}" to hover`);
}

function render(step: Step, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const controller = new MenuController();
  const input = (optionCursor: CanvasPoint): MenuInput => ({
    menus: { layout: "radial", items: menuTopicsFor(true), activeId: "vocabulary" },
    options: step.cluster(),
    bothClosed: true,
    menuCursor: MENU_ANCHOR,
    optionCursor,
    canvasWidth: WIDTH,
    canvasHeight: HEIGHT,
  });

  controller.update(input(OPTION_REST), 0);
  const opened = controller.update(input(OPTION_REST), OPENED_AT);
  const cursor = cursorFor(opened, step.hover);

  controller.update(input(cursor), HOVER_AT);
  const update = controller.update(input(cursor), HOVER_AT + CONTROL.dwellMs * DWELL_FRACTION);

  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawMenuBackdrop(ctx, update.elapsedMs);

  // Placed exactly as the app places it: in the band the ring and the list leave.
  const ringX = update.menus.centerX;
  const listLeft = listBandLeft(WIDTH, listBandWidth(WIDTH), { x: ringX, y: 0 });
  const [bandStart, bandEnd] =
    ringX < WIDTH / 2
      ? [ringX + RING_REACH, listLeft]
      : [listLeft + listBandWidth(WIDTH), ringX - RING_REACH];
  const band = Math.max(0, bandEnd - bandStart);
  const hands = step.diagram(update.options.hoveredId);

  drawMappingDiagram(ctx, {
    x: bandStart + band / 2,
    y: HEIGHT * 0.5,
    size: Math.max(110, Math.min(200, diagramSizeFor(band, hands.length))),
    hands,
    colour: "#e8a13d",
  });
  drawCluster(ctx, update.menus, MENUS_STYLE);
  // Told where the ring is, exactly as the app tells it, so the shot shows what
  // the instrument shows rather than what the harness would prefer.
  drawCluster(ctx, update.options, OPTIONS_STYLE, {
    x: update.menus.centerX,
    y: update.menus.centerY,
  });
}

const canvas = document.querySelector<HTMLCanvasElement>("#shot");
if (!canvas) throw new Error("no canvas");

canvas.width = WIDTH;
canvas.height = HEIGHT;

const name = new URLSearchParams(window.location.search).get("step") ?? "poses";
const step = STEPS[name];
if (!step) throw new Error(`unknown step "${name}"; try ${Object.keys(STEPS).join(", ")}`);

render(step, canvas);

// A hook for a capture script that wants to wait for the drawing rather than for
// the load event: the drawing is synchronous, but the module that does it is not.
(window as unknown as { shotReady: boolean }).shotReady = true;
