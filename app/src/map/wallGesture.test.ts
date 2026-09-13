/**
 * The wall and door gesture machine (T102): every transition of both tools,
 * the preview, snapping to grid corners within the threshold, the Shift
 * bypass, and the double-click rule that tells a quick second corner from
 * an end.
 */
import { GRID_FIXTURE } from "../test/gridFixture";
import { nearestGridCorner } from "./grid";
import type { Point } from "./viewport";
import {
  IDLE_WALL_GESTURE,
  reduceWallGesture,
  snapWallPoint,
  wallGesturePreview,
  type NewWallSegment,
  type WallGestureConfig,
  type WallGestureEvent,
  type WallGestureState,
} from "./wallGesture";

const grid = GRID_FIXTURE.geometry; // 50 px cells, offset (12, 7)
const wallConfig: WallGestureConfig = { tool: "wall", grid, snapThreshold: 6, minDrag: 3 };
const doorConfig: WallGestureConfig = { ...wallConfig, tool: "door" };
const noSnap: WallGestureConfig = { ...wallConfig, grid: null };

const p = (x: number, y: number): Point => ({ x, y });
/** Corner (column, row) of the fixture grid. */
const corner = (column: number, row: number): Point =>
  p(grid.offsetX + column * grid.cellSize, grid.offsetY + row * grid.cellSize);

/** Runs the events in order, collecting every committed segment. */
function run(
  events: WallGestureEvent[],
  config = wallConfig,
  start: WallGestureState = IDLE_WALL_GESTURE
): { state: WallGestureState; segments: NewWallSegment[] } {
  const segments: NewWallSegment[] = [];
  let state = start;
  for (const event of events) {
    const step = reduceWallGesture(state, event, config);
    state = step.state;
    if (step.segment) segments.push(step.segment);
  }
  return { state, segments };
}

const click = (point: Point, shift?: boolean): WallGestureEvent[] => [
  { type: "down", point, shift },
  { type: "up", point, shift },
];
const wall = (a: Point, b: Point): NewWallSegment => ({ kind: "wall", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
const door = (a: Point, b: Point): NewWallSegment => ({ kind: "door", x1: a.x, y1: a.y, x2: b.x, y2: b.y });

describe("nearestGridCorner", () => {
  it("rounds to the lattice of the grid's corners, on or off the map", () => {
    expect(nearestGridCorner(p(60, 60), grid)).toEqual(corner(1, 1));
    expect(nearestGridCorner(p(86, 31), grid)).toEqual(corner(1, 0)); // 86 is nearer 62 than 112
    expect(nearestGridCorner(p(88, 33), grid)).toEqual(corner(2, 1));
    expect(nearestGridCorner(p(-5, -5), grid)).toEqual(p(12, 7));
    expect(nearestGridCorner(p(-30, -30), grid)).toEqual(p(-38, -43));
    expect(nearestGridCorner(p(1000, 1000), grid)).toEqual(corner(20, 20));
  });

  it("leaves the point alone for a degenerate cell size", () => {
    expect(nearestGridCorner(p(33, 44), { cellSize: 0, offsetX: 0, offsetY: 0 })).toEqual(p(33, 44));
  });
});

describe("snapWallPoint", () => {
  it("snaps to the nearest corner within the threshold and no further", () => {
    expect(snapWallPoint(p(64, 55), wallConfig)).toEqual(corner(1, 1));
    expect(snapWallPoint(p(66, 61), wallConfig)).toEqual(corner(1, 1)); // hypot(4, 4) ≈ 5.7 ≤ 6
    expect(snapWallPoint(p(68, 57), wallConfig)).toEqual(corner(1, 1)); // exactly 6 away
    expect(snapWallPoint(p(69, 57), wallConfig)).toEqual(p(69, 57)); // 7 away: stays
    expect(snapWallPoint(p(87, 82), wallConfig)).toEqual(p(87, 82)); // mid-cell
  });

  it("does not snap with Shift held, nor without a grid", () => {
    expect(snapWallPoint(p(64, 55), wallConfig, true)).toEqual(p(64, 55));
    expect(snapWallPoint(p(64, 55), noSnap)).toEqual(p(64, 55));
    expect(snapWallPoint(p(64, 55), noSnap, true)).toEqual(p(64, 55));
  });

  it("returns a copy, never the input point", () => {
    const point = p(87, 82);
    expect(snapWallPoint(point, wallConfig)).not.toBe(point);
  });
});

describe("the wall tool", () => {
  it("is idle until a press; moves, releases and double-clicks in idle do nothing", () => {
    for (const event of [
      { type: "move", point: p(1, 1) },
      { type: "up", point: p(1, 1) },
      { type: "double", point: p(1, 1) },
      { type: "cancel" },
    ] as WallGestureEvent[]) {
      expect(reduceWallGesture(IDLE_WALL_GESTURE, event, wallConfig)).toEqual({ state: IDLE_WALL_GESTURE });
    }
  });

  it("a press places the first vertex (snapped) and starts the preview from it", () => {
    const step = reduceWallGesture(IDLE_WALL_GESTURE, { type: "down", point: p(64, 55) }, wallConfig);
    expect(step.segment).toBeUndefined();
    expect(step.state).toEqual({
      phase: "drawing",
      vertices: [corner(1, 1)],
      current: corner(1, 1),
      pressed: p(64, 55),
      lastPressPlaced: true,
    });
    const moved = reduceWallGesture(step.state, { type: "move", point: p(110, 60) }, wallConfig);
    expect(wallGesturePreview(moved.state)).toEqual({ from: corner(1, 1), to: corner(2, 1) });
    expect(moved.segment).toBeUndefined();
  });

  it("click, click, click: each click after the first commits one segment from the last vertex", () => {
    const { state, segments } = run([
      ...click(p(64, 55)),
      { type: "move", point: p(100, 60) },
      ...click(p(160, 58)),
      ...click(p(163, 160)),
    ]);
    expect(segments).toEqual([wall(corner(1, 1), corner(3, 1)), wall(corner(3, 1), corner(3, 3))]);
    expect(state.phase).toBe("drawing");
    if (state.phase !== "drawing") throw new Error();
    expect(state.vertices).toEqual([corner(1, 1), corner(3, 1), corner(3, 3)]);
    expect(state.pressed).toBeNull();
  });

  it("a drag draws one segment: the release far from its press places the second vertex", () => {
    const { state, segments } = run([
      { type: "down", point: p(64, 55) },
      { type: "move", point: p(90, 56) },
      { type: "up", point: p(110, 58) },
    ]);
    expect(segments).toEqual([wall(corner(1, 1), corner(2, 1))]);
    if (state.phase !== "drawing") throw new Error();
    expect(state.vertices).toEqual([corner(1, 1), corner(2, 1)]);
    expect(state.lastPressPlaced).toBe(true);
    // And the polyline continues from there.
    const next = run(click(p(110, 108)), wallConfig, state);
    expect(next.segments).toEqual([wall(corner(2, 1), corner(2, 2))]);
  });

  it("a release within minDrag of its press is a click and places nothing more", () => {
    const { state, segments } = run([
      { type: "down", point: p(64, 55) },
      { type: "move", point: p(65, 56) },
      { type: "up", point: p(66, 56) },
    ]);
    expect(segments).toEqual([]);
    if (state.phase !== "drawing") throw new Error();
    expect(state.vertices).toEqual([corner(1, 1)]);
  });

  it("a vertex that repeats the last one (within minDrag, or snapped to the same corner) is ignored", () => {
    const { state, segments } = run([
      ...click(p(64, 55)),
      ...click(p(60, 59)), // the same corner
      ...click(p(112, 57)),
      ...click(p(113, 58)), // 1.4 px away, unsnapped would still be the same vertex
    ], noSnap);
    expect(segments).toEqual([wall(p(64, 55), p(60, 59)), wall(p(60, 59), p(112, 57))]);
    if (state.phase !== "drawing") throw new Error();
    expect(state.vertices).toEqual([p(64, 55), p(60, 59), p(112, 57)]);
    const snapped = run([...click(p(64, 55)), ...click(p(60, 59))]);
    expect(snapped.segments).toEqual([]);
    if (snapped.state.phase !== "drawing") throw new Error();
    expect(snapped.state.vertices).toEqual([corner(1, 1)]);
    expect(snapped.state.lastPressPlaced).toBe(false);
  });

  it("a double-click on the last vertex ends the polyline with nothing dangling", () => {
    const { state, segments } = run([
      ...click(p(62, 57)),
      ...click(p(112, 57)),
      // The browser's double-click: a second press and release on the same spot, then dblclick.
      ...click(p(113, 56)),
      { type: "double", point: p(113, 56) },
    ]);
    expect(segments).toEqual([wall(corner(1, 1), corner(2, 1))]);
    expect(state).toEqual({ phase: "idle", endedAt: p(113, 56) });
    expect(wallGesturePreview(state)).toBeNull();
  });

  it("the press and release the browser sends after a double-click start nothing; a press elsewhere, or a later one there, does", () => {
    const ended = run([
      ...click(p(62, 57)),
      ...click(p(112, 57)),
      ...click(p(113, 56)),
      { type: "double", point: p(113, 56) },
    ]).state;
    // The double-click's own trailing press / release pair (a single click, then a double-click, is three clicks).
    const tail = run([...click(p(114, 57)), { type: "double", point: p(114, 57) }], wallConfig, ended);
    expect(tail.segments).toEqual([]);
    expect(tail.state).toEqual(IDLE_WALL_GESTURE);
    expect(wallGesturePreview(tail.state)).toBeNull();
    // Only the first press is swallowed: the next one there starts a polyline.
    const again = run(click(p(113, 56)), wallConfig, tail.state);
    expect(again.state.phase).toBe("drawing");
    // A press anywhere else starts one at once.
    const elsewhere = run(click(p(162, 157)), wallConfig, ended);
    expect(elsewhere.state.phase).toBe("drawing");
    if (elsewhere.state.phase !== "drawing") throw new Error();
    expect(elsewhere.state.vertices).toEqual([corner(3, 3)]);
    // The door tool does not care where a polyline ended.
    expect(reduceWallGesture(ended, { type: "down", point: p(113, 56) }, doorConfig).state.phase).toBe("dragging");
  });

  it("a double-click whose press placed a new corner is two quick clicks, not an end", () => {
    const { state, segments } = run([
      ...click(p(62, 57)),
      ...click(p(112, 57)),
      { type: "double", point: p(112, 57) },
      ...click(p(112, 107)),
    ]);
    expect(segments).toEqual([wall(corner(1, 1), corner(2, 1)), wall(corner(2, 1), corner(2, 2))]);
    expect(state.phase).toBe("drawing");
  });

  it("a fresh polyline started within the click window of the last end is kept, not swallowed", () => {
    const { state, segments } = run([
      ...click(p(62, 57)),
      ...click(p(112, 57)),
      ...click(p(112, 57)),
      { type: "double", point: p(112, 57) },
      // Straight on to the next wall: Konva still reports a double-click on this release.
      ...click(p(162, 157)),
      { type: "double", point: p(162, 157) },
      ...click(p(212, 157)),
    ]);
    expect(segments).toEqual([wall(corner(1, 1), corner(2, 1)), wall(corner(3, 3), corner(4, 3))]);
    if (state.phase !== "drawing") throw new Error();
    expect(state.vertices).toEqual([corner(3, 3), corner(4, 3)]);
  });

  it("cancel (Esc) ends the polyline at once; committed segments are the caller's", () => {
    const { state, segments } = run([
      ...click(p(62, 57)),
      ...click(p(112, 57)),
      { type: "move", point: p(150, 150) },
      { type: "cancel" },
    ]);
    expect(segments).toEqual([wall(corner(1, 1), corner(2, 1))]);
    expect(state).toEqual(IDLE_WALL_GESTURE);
    // Mid-press too.
    expect(run([{ type: "down", point: p(62, 57) }, { type: "cancel" }]).state).toEqual(IDLE_WALL_GESTURE);
  });

  it("a closed room: four corners and back to the first are four segments", () => {
    const { segments } = run([
      ...click(corner(1, 1)),
      ...click(corner(3, 1)),
      ...click(corner(3, 3)),
      ...click(corner(1, 3)),
      ...click(corner(1, 1)),
      { type: "cancel" },
    ]);
    expect(segments).toEqual([
      wall(corner(1, 1), corner(3, 1)),
      wall(corner(3, 1), corner(3, 3)),
      wall(corner(3, 3), corner(1, 3)),
      wall(corner(1, 3), corner(1, 1)),
    ]);
  });

  it("Shift places the point exactly where the pointer is, for that point only", () => {
    const { segments, state } = run([
      ...click(p(64, 55), true),
      ...click(p(114, 56)),
      { type: "move", point: p(160, 60), shift: true },
    ]);
    expect(segments).toEqual([wall(p(64, 55), corner(2, 1))]);
    expect(wallGesturePreview(state)).toEqual({ from: corner(2, 1), to: p(160, 60) });
    const unshifted = reduceWallGesture(state, { type: "move", point: p(160, 60) }, wallConfig);
    expect(wallGesturePreview(unshifted.state)).toEqual({ from: corner(2, 1), to: corner(3, 1) });
  });

  it("without a grid nothing snaps", () => {
    const { segments } = run([...click(p(64, 55)), ...click(p(114, 56))], noSnap);
    expect(segments).toEqual([wall(p(64, 55), p(114, 56))]);
  });

  it("is pure: the input state is never mutated", () => {
    const start = reduceWallGesture(IDLE_WALL_GESTURE, { type: "down", point: p(62, 57) }, wallConfig).state;
    const frozen = JSON.parse(JSON.stringify(start)) as WallGestureState;
    reduceWallGesture(start, { type: "up", point: p(112, 57) }, wallConfig);
    reduceWallGesture(start, { type: "down", point: p(112, 57) }, wallConfig);
    reduceWallGesture(start, { type: "move", point: p(112, 57) }, wallConfig);
    expect(start).toEqual(frozen);
  });
});

describe("the door tool", () => {
  it("press, drag, release commits one closed door between the snapped ends", () => {
    const { state, segments } = run(
      [
        { type: "down", point: p(160, 60) },
        { type: "move", point: p(161, 80) },
        { type: "up", point: p(163, 105) },
      ],
      doorConfig
    );
    expect(segments).toEqual([door(corner(3, 1), corner(3, 2))]);
    expect(state).toEqual(IDLE_WALL_GESTURE);
  });

  it("previews from the press to the pointer while dragging", () => {
    const down = reduceWallGesture(IDLE_WALL_GESTURE, { type: "down", point: p(160, 60) }, doorConfig);
    expect(down.state).toEqual({ phase: "dragging", start: corner(3, 1), current: corner(3, 1) });
    const moved = reduceWallGesture(down.state, { type: "move", point: p(140, 90) }, doorConfig);
    expect(wallGesturePreview(moved.state)).toEqual({ from: corner(3, 1), to: p(140, 90) });
    const nearer = reduceWallGesture(moved.state, { type: "move", point: p(163, 104) }, doorConfig);
    expect(wallGesturePreview(nearer.state)).toEqual({ from: corner(3, 1), to: corner(3, 2) });
  });

  it("a click (release within minDrag of the press) makes no door", () => {
    const { state, segments } = run(
      [
        { type: "down", point: p(140, 90) },
        { type: "up", point: p(141, 91) },
      ],
      doorConfig
    );
    expect(segments).toEqual([]);
    expect(state).toEqual(IDLE_WALL_GESTURE);
    // Two ends that snap to the same corner are a click too.
    expect(run([{ type: "down", point: p(160, 60) }, { type: "up", point: p(164, 55) }], doorConfig).segments).toEqual([]);
  });

  it("moves, releases and double-clicks while idle do nothing; a double-click mid-drag is ignored", () => {
    for (const event of [
      { type: "move", point: p(1, 1) },
      { type: "up", point: p(1, 1) },
      { type: "double", point: p(1, 1) },
    ] as WallGestureEvent[]) {
      expect(reduceWallGesture(IDLE_WALL_GESTURE, event, doorConfig)).toEqual({ state: IDLE_WALL_GESTURE });
    }
    const dragging = reduceWallGesture(IDLE_WALL_GESTURE, { type: "down", point: p(160, 60) }, doorConfig).state;
    expect(reduceWallGesture(dragging, { type: "double", point: p(160, 60) }, doorConfig)).toEqual({ state: dragging });
  });

  it("cancel drops the drag without a door", () => {
    const { state, segments } = run(
      [{ type: "down", point: p(160, 60) }, { type: "move", point: p(160, 110) }, { type: "cancel" }],
      doorConfig
    );
    expect(segments).toEqual([]);
    expect(state).toEqual(IDLE_WALL_GESTURE);
  });

  it("Shift skips snapping for the end it is held on", () => {
    const { segments } = run(
      [
        { type: "down", point: p(160, 60), shift: true },
        { type: "up", point: p(163, 105) },
      ],
      doorConfig
    );
    expect(segments).toEqual([door(p(160, 60), corner(3, 2))]);
  });
});

describe("tool changes", () => {
  it("a state of the other tool's shape is treated as idle", () => {
    const drawing = reduceWallGesture(IDLE_WALL_GESTURE, { type: "down", point: p(62, 57) }, wallConfig).state;
    expect(reduceWallGesture(drawing, { type: "move", point: p(100, 100) }, doorConfig)).toEqual({ state: IDLE_WALL_GESTURE });
    const dragging = reduceWallGesture(IDLE_WALL_GESTURE, { type: "down", point: p(62, 57) }, doorConfig).state;
    const step = reduceWallGesture(dragging, { type: "up", point: p(112, 57) }, wallConfig);
    expect(step).toEqual({ state: IDLE_WALL_GESTURE });
  });
});
