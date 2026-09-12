/**
 * The fog tools' pointer gesture (T008): brush paths are thinned and become
 * strokes, rectangles need a minimum drag, lassos close into polygons, the
 * preview equals what a release commits, and Esc cancels.
 */
import {
  finalizeFogGesture,
  gestureShape,
  IDLE_FOG_GESTURE,
  reduceFogGesture,
  type FogGestureConfig,
  type FogGestureEvent,
  type FogGestureState,
} from "./fogGesture";

const config = (tool: FogGestureConfig["tool"]): FogGestureConfig => ({
  tool,
  radius: 7,
  minStep: 3,
  minDrag: 2,
});

function run(cfg: FogGestureConfig, events: FogGestureEvent[]) {
  let state: FogGestureState = IDLE_FOG_GESTURE;
  const shapes = [];
  const previews = [];
  for (const event of events) {
    const step = reduceFogGesture(state, event, cfg);
    state = step.state;
    previews.push(gestureShape(state, cfg));
    if (step.shape) shapes.push(step.shape);
  }
  return { state, shapes, previews };
}

const p = (x: number, y: number) => ({ x, y });

describe("fog gesture", () => {
  it("brush: the drag path becomes one stroke; points closer than minStep are skipped", () => {
    const { state, shapes } = run(config("brush"), [
      { type: "down", point: p(0, 0) },
      { type: "move", point: p(1, 1) }, // too close to (0, 0)
      { type: "move", point: p(4, 0) },
      { type: "move", point: p(5, 1) }, // too close to (4, 0)
      { type: "move", point: p(4, 5) },
      { type: "up", point: p(4, 6) }, // too close: the release point is not added
    ]);
    expect(state).toEqual(IDLE_FOG_GESTURE);
    expect(shapes).toEqual([{ kind: "stroke", points: [0, 0, 4, 0, 4, 5], radius: 7 }]);
  });

  it("brush: a click is a one-point stroke (a dot); a release far from the last point is kept", () => {
    expect(run(config("brush"), [{ type: "down", point: p(3, 4) }, { type: "up", point: p(3, 4) }]).shapes).toEqual([
      { kind: "stroke", points: [3, 4], radius: 7 },
    ]);
    expect(run(config("brush"), [{ type: "down", point: p(0, 0) }, { type: "up", point: p(10, 0) }]).shapes).toEqual([
      { kind: "stroke", points: [0, 0, 10, 0], radius: 7 },
    ]);
  });

  it("rect: the box between press and release, normalised; a short drag is a click", () => {
    expect(
      run(config("rect"), [
        { type: "down", point: p(10, 10) },
        { type: "move", point: p(50, 50) },
        { type: "up", point: p(2, 30) },
      ]).shapes
    ).toEqual([{ kind: "rect", x: 2, y: 10, width: 8, height: 20 }]);
    expect(
      run(config("rect"), [{ type: "down", point: p(10, 10) }, { type: "up", point: p(11, 30) }]).shapes
    ).toEqual([]);
    expect(
      run(config("rect"), [{ type: "down", point: p(10, 10) }, { type: "up", point: p(11.9, 11.9) }]).shapes
    ).toEqual([]);
  });

  it("lasso: the thinned path closes into a polygon; too few points or a tiny box is nothing", () => {
    expect(
      run(config("lasso"), [
        { type: "down", point: p(0, 0) },
        { type: "move", point: p(10, 0) },
        { type: "move", point: p(10, 1) }, // skipped
        { type: "move", point: p(10, 10) },
        { type: "up", point: p(0, 10) },
      ]).shapes
    ).toEqual([{ kind: "polygon", points: [0, 0, 10, 0, 10, 10, 0, 10] }]);
    // Two kept points only.
    expect(run(config("lasso"), [{ type: "down", point: p(0, 0) }, { type: "up", point: p(10, 0) }]).shapes).toEqual([]);
    // Three points on a line: a degenerate (zero-height) box.
    expect(
      run(config("lasso"), [
        { type: "down", point: p(0, 0) },
        { type: "move", point: p(10, 0) },
        { type: "up", point: p(20, 0) },
      ]).shapes
    ).toEqual([]);
  });

  it("the preview is exactly what a release at the current point would commit", () => {
    const cfg = config("lasso");
    const { previews } = run(cfg, [
      { type: "down", point: p(0, 0) },
      { type: "move", point: p(10, 0) },
      { type: "move", point: p(10, 10) },
    ]);
    expect(previews[0]).toBeNull(); // one point
    expect(previews[1]).toBeNull(); // two points: not a polygon yet
    expect(previews[2]).toEqual({ kind: "polygon", points: [0, 0, 10, 0, 10, 10] });
    const state: FogGestureState = {
      phase: "dragging",
      tool: "lasso",
      start: p(0, 0),
      current: p(10, 10),
      points: [0, 0, 10, 0, 10, 10],
    };
    expect(finalizeFogGesture(state, p(0, 10), cfg)).toEqual({
      kind: "polygon",
      points: [0, 0, 10, 0, 10, 10, 0, 10],
    });
    expect(finalizeFogGesture(IDLE_FOG_GESTURE, p(0, 10), cfg)).toBeNull();
    expect(gestureShape(IDLE_FOG_GESTURE, cfg)).toBeNull();
  });

  it("cancel drops the gesture; moves and releases while idle do nothing", () => {
    const cfg = config("brush");
    const { state, shapes } = run(cfg, [
      { type: "down", point: p(0, 0) },
      { type: "move", point: p(10, 0) },
      { type: "cancel" },
      { type: "move", point: p(20, 0) },
      { type: "up", point: p(20, 0) },
    ]);
    expect(state).toEqual(IDLE_FOG_GESTURE);
    expect(shapes).toEqual([]);
  });

  it("the tool in effect at the press is the one that finishes the gesture", () => {
    const step = reduceFogGesture(IDLE_FOG_GESTURE, { type: "down", point: p(0, 0) }, config("rect"));
    const moved = reduceFogGesture(step.state, { type: "move", point: p(20, 20) }, config("brush"));
    const done = reduceFogGesture(moved.state, { type: "up", point: p(20, 20) }, config("brush"));
    expect(done.shape).toEqual({ kind: "rect", x: 0, y: 0, width: 20, height: 20 });
  });
});
