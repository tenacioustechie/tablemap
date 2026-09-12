import { fixtureSquareCorners, GRID_FIXTURE } from "../test/gridFixture";
import {
  alignmentBox,
  IDLE_ALIGNMENT,
  reduceAlignment,
  type AlignmentEvent,
  type AlignmentState,
} from "./alignment";

const [A, B] = fixtureSquareCorners(2, 1);
const up = (point = B, minDrag = 3): AlignmentEvent => ({ type: "up", point, minDrag });

function run(events: AlignmentEvent[], from: AlignmentState = IDLE_ALIGNMENT) {
  let state = from;
  const results = [];
  for (const event of events) {
    const step = reduceAlignment(state, event);
    state = step.state;
    if (step.result) results.push(step.result);
  }
  return { state, results };
}

describe("alignment tool state machine", () => {
  it("drag from one corner to the opposite corner completes with the grid", () => {
    const { state, results } = run([
      { type: "down", point: A },
      { type: "move", point: { x: 100, y: 100 } },
      { type: "move", point: B },
      up(B),
    ]);
    expect(state).toEqual(IDLE_ALIGNMENT);
    expect(results).toEqual([{ first: A, second: B, geometry: GRID_FIXTURE.geometry }]);
  });

  it("a press-release without travel is a click: waits for the second click", () => {
    const first = run([{ type: "down", point: A }, up({ x: A.x + 1, y: A.y - 1 })]);
    expect(first.results).toEqual([]);
    expect(first.state).toEqual({ phase: "second", first: A, current: null });

    const hover = reduceAlignment(first.state, { type: "move", point: { x: 90, y: 90 } });
    expect(hover.state).toEqual({ phase: "second", first: A, current: { x: 90, y: 90 } });
    expect(hover.result).toBeUndefined();

    const done = reduceAlignment(hover.state, { type: "down", point: B });
    expect(done.state).toEqual(IDLE_ALIGNMENT);
    expect(done.result).toEqual({ first: A, second: B, geometry: GRID_FIXTURE.geometry });
  });

  it("the click threshold scales: travel below minDrag is a click, at or above is a drag", () => {
    const short = run([{ type: "down", point: A }, up({ x: A.x + 4, y: A.y }, 5)]);
    expect(short.state.phase).toBe("second");
    const long = run([{ type: "down", point: A }, up({ x: A.x + 5, y: A.y }, 5)]);
    expect(long.state).toEqual(IDLE_ALIGNMENT);
    expect(long.results).toHaveLength(1);
  });

  it("previews the box while dragging and after the first click", () => {
    const dragging = run([{ type: "down", point: A }, { type: "move", point: B }]).state;
    expect(alignmentBox(dragging)).toEqual({ first: A, second: B });
    expect(alignmentBox(IDLE_ALIGNMENT)).toBeNull();
    expect(alignmentBox({ phase: "second", first: A, current: null })).toBeNull();
    expect(alignmentBox({ phase: "second", first: A, current: B })).toEqual({ first: A, second: B });
  });

  it("a release that happened off-stage does not get the tool stuck", () => {
    // Button went down, the pointer left, the browser never sent us the up.
    const { state, results } = run([{ type: "down", point: A }, { type: "down", point: B }]);
    expect(state).toEqual(IDLE_ALIGNMENT);
    expect(results).toHaveLength(1);
  });

  it("reports a null geometry (and resets) when the box is too small", () => {
    const { state, results } = run([
      { type: "down", point: A },
      up({ x: A.x + 2, y: A.y + 2 }, 1),
    ]);
    expect(state).toEqual(IDLE_ALIGNMENT);
    expect(results[0].geometry).toBeNull();
  });

  it("cancel returns to idle from any phase; moves and ups while idle are ignored", () => {
    expect(reduceAlignment({ phase: "dragging", first: A, current: B }, { type: "cancel" }).state).toEqual(IDLE_ALIGNMENT);
    expect(reduceAlignment({ phase: "second", first: A, current: null }, { type: "cancel" }).state).toEqual(IDLE_ALIGNMENT);
    expect(reduceAlignment(IDLE_ALIGNMENT, { type: "move", point: A }).state).toBe(IDLE_ALIGNMENT);
    expect(reduceAlignment(IDLE_ALIGNMENT, up()).state).toBe(IDLE_ALIGNMENT);
    const waiting: AlignmentState = { phase: "second", first: A, current: null };
    expect(reduceAlignment(waiting, up()).state).toBe(waiting);
  });
});
