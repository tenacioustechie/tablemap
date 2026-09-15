/**
 * The Walls tab, driven through `DmView` (T101, T102): the sixth tab, the
 * counts, and **Clear walls** behind an inline confirm that dispatches one
 * `map/walls-clear`; the confirm folds away on Cancel, on a map switch and
 * when the walls change under it. Then the tools (T102): **Wall** and
 * **Door** arm the tool on the canvas (mutually exclusive with the other
 * tools, with the toolbar chip saying so), clicks on the stage draw a
 * polyline of snapped segments, a drag draws a door, Esc and a double-click
 * end a polyline without a dangling segment, **Snap to grid** and Shift,
 * selection by a click on a wall or a door's name in the list (the panel
 * shows its kind and length), **Delete** / the Delete key, a dragged end
 * handle, and a map switch. Doors in play (T103): the **Doors** list with
 * each door's state, its toggle and the canvas click as one
 * `map/door-set-open`, the list and the canvas agreeing, and a door's name
 * selecting it and centring the canvas on it.
 *
 * Under jsdom the stage's viewport is the identity (zero-size container),
 * so screen pixels are map pixels; the blank map's grid starts at (0, 0)
 * with 50 px cells. Konva cannot hit-test under jsdom, so segment clicks
 * and handle drags are fired on the Konva nodes themselves.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import Konva from "konva";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState, type SharedOp } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { createDoor, createWall, type WallSegment } from "../state/walls";
import { openTab } from "../test/dmTabs";
import { DmView } from "./DmView";
import type { PlayerWindowController } from "./playerWindow";
import { describeDoor, describeWallKind, describeWallLength } from "./WallsPanel";

const noWindow: PlayerWindowController = {
  open: () => null,
  close: () => {},
  isOpen: () => false,
  isFullscreen: () => false,
  toggleFullscreen: async () => "not-open",
  getHandle: () => null,
};

const segments: WallSegment[] = [
  createWall({ id: "w1", x1: 0, y1: 0, x2: 100, y2: 0 }),
  createWall({ id: "w2", x1: 100, y1: 0, x2: 100, y2: 100 }),
  createDoor({ id: "d1", x1: 40, y1: 0, x2: 60, y2: 0 }),
];

function storeWithMaps(wallsOnA: WallSegment[] = segments, activeMapId: string | null = "a") {
  const a = { ...createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 }), walls: wallsOnA };
  const b = createBlankMapScene({ id: "b", name: "B", columns: 4, rows: 4, cellSize: 50 });
  return createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId });
}

function renderWalls(store: TableStore) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} />
    </MemoryRouter>
  );
  openTab("walls");
}

const wallsOf = (store: TableStore, id = "a") => store.getState().shared.maps.find((m) => m.id === id)!.walls;
const clear = () => screen.getByTestId("walls-clear") as HTMLButtonElement;
const confirm = () => screen.queryByTestId("walls-clear-confirm");
const surface = () => screen.getByTestId("dm-canvas-surface");
const chip = () => screen.queryByTestId("tool-status");
const wallButton = () => screen.getByTestId("wall-tool-wall");
const doorButton = () => screen.getByTestId("wall-tool-door");
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");
const stageContent = () => screen.getByTestId("dm-map-stage").querySelector(".konvajs-content")!;
const lastStage = () => Konva.stages[Konva.stages.length - 1];
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

/**
 * Konva reports a double-click on any release within 400 ms of the last one
 * (a global, real-time window); jsdom tests click far faster than that.
 * Clearing it makes the next click a slow, single one.
 */
function letClickWindowPass() {
  (Konva as unknown as { _mouseInDblClickWindow: boolean })._mouseInDblClickWindow = false;
}

/** A click on the stage; Konva fires a double-click on the second release within its window. */
function click(x: number, y: number, init: Partial<MouseEventInit> = {}) {
  fireEvent.mouseDown(stageContent(), { clientX: x, clientY: y, ...init });
  fireEvent.mouseUp(stageContent(), { clientX: x, clientY: y, ...init });
}
function drag(points: [number, number][], init: Partial<MouseEventInit> = {}) {
  const [first, ...rest] = points;
  fireEvent.mouseDown(stageContent(), { clientX: first[0], clientY: first[1], ...init });
  for (const [x, y] of rest) fireEvent.mouseMove(stageContent(), { clientX: x, clientY: y, ...init });
  const last = points[points.length - 1];
  fireEvent.mouseUp(stageContent(), { clientX: last[0], clientY: last[1], ...init });
}
const ends = (w: WallSegment) => [w.x1, w.y1, w.x2, w.y2];

/**
 * Clicks a segment's node as Konva would deliver it (Konva cannot hit-test
 * under jsdom): a wall is selected, a door opened or closed (T103).
 */
function clickSegment(id: string, altKey = false) {
  const node = lastStage().findOne<Konva.Line>(`#wall-${id}`)!;
  act(() => {
    node.fire("click", { evt: new MouseEvent("click", { altKey }) }, true);
  });
}

/** Selects a door through its name in the panel's door list (T103). */
function selectDoor(id: string) {
  const item = screen.getAllByTestId("door-item").find((li) => li.dataset.doorId === id)!;
  fireEvent.click(item.querySelector("[data-testid=door-select]")!);
}

/** Drags an end handle of the selected segment to `to`, as Konva would report it. */
function dragHandle(id: string, end: "start" | "end", to: { x: number; y: number }, shiftKey = false) {
  const handle = lastStage().findOne<Konva.Circle>(`#wall-handle-${id}-${end}`)!;
  act(() => {
    handle.position(to);
    handle.fire("dragmove", { evt: new MouseEvent("mousemove", { shiftKey }) }, true);
    handle.fire("dragend", { evt: new MouseEvent("mouseup", { shiftKey }) }, true);
  });
  return handle;
}

describe("WallsPanel", () => {
  it("is the sixth tab, after Draw, and shows the counts of the active map", () => {
    renderWalls(storeWithMaps());
    const tabs = screen.getAllByRole("tab").map((t) => t.dataset.testid);
    expect(tabs.indexOf("dm-tab-walls")).toBe(tabs.indexOf("dm-tab-draw") + 1);
    expect(screen.getByTestId("dm-tabpanel").dataset.tab).toBe("walls");
    expect(screen.getByTestId("walls-panel")).toBeTruthy();
    expect(screen.getByTestId("wall-count").textContent).toBe("(3)");
    const summary = screen.getByTestId("wall-summary");
    expect(summary.dataset.walls).toBe("2");
    expect(summary.dataset.doors).toBe("1");
    expect(summary.textContent).toBe("2 walls, 1 door.");
    expect(clear().textContent).toBe("Clear walls (3)");
    expect(clear().disabled).toBe(false);
    // The canvas draws them (the layer has its own test); the surface reports them.
    expect(surface().dataset.walls).toBe("3");
    expect(surface().dataset.wallSegments).toBe("wall:0,0,100,0;wall:100,0,100,100;door:40,0,60,0:closed");
  });

  it("Clear walls asks for confirmation, then dispatches one map/walls-clear for the active map", () => {
    const store = storeWithMaps();
    const dispatched: SharedOp[][] = [];
    store.onOps((ops) => dispatched.push([...ops]));
    renderWalls(store);
    expect(confirm()).toBeNull();

    fireEvent.click(clear());
    expect(confirm()).toBeTruthy();
    expect(screen.queryByTestId("walls-clear")).toBeNull();
    expect(wallsOf(store)).toHaveLength(3);
    expect(dispatched).toEqual([]);

    fireEvent.click(confirm()!);
    expect(dispatched).toEqual([[{ kind: "map/walls-clear", id: "a" }]]);
    expect(wallsOf(store)).toEqual([]);
    expect(wallsOf(store, "b")).toEqual([]);
    expect(confirm()).toBeNull();
    expect(screen.getByTestId("wall-count").textContent).toBe("(0)");
    expect(screen.getByTestId("wall-summary").textContent).toBe("No walls on this map yet.");
    expect(clear().disabled).toBe(true);
    expect(clear().textContent).toBe("Clear walls");
    expect(surface().dataset.walls).toBe("0");
    expect(surface().dataset.wallSegments).toBe("");
  });

  it("Cancel keeps the walls; a map switch or a change to the walls folds a pending confirm away", () => {
    const store = storeWithMaps();
    renderWalls(store);
    fireEvent.click(clear());
    fireEvent.click(screen.getByTestId("walls-clear-cancel"));
    expect(confirm()).toBeNull();
    expect(wallsOf(store)).toHaveLength(3);

    fireEvent.click(clear());
    expect(confirm()).toBeTruthy();
    act(() => {
      store.getState().dispatch({ kind: "map/wall-remove", id: "a", segmentId: "w2" });
    });
    expect(confirm()).toBeNull();
    expect(screen.getByTestId("wall-count").textContent).toBe("(2)");
    expect(screen.getByTestId("wall-summary").textContent).toBe("1 wall, 1 door.");

    fireEvent.click(clear());
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: "b" });
    });
    expect(confirm()).toBeNull();
    expect(screen.getByTestId("wall-count").textContent).toBe("(0)");
    expect(clear().disabled).toBe(true);
    expect(wallsOf(store)).toHaveLength(2);
  });

  it("without an active map it says so and offers no tools and nothing to clear", () => {
    renderWalls(storeWithMaps(segments, null));
    expect(screen.getByTestId("walls-panel").textContent).toContain("Show a map");
    expect(screen.queryByTestId("walls-clear")).toBeNull();
    expect(screen.queryByTestId("wall-count")).toBeNull();
    expect(screen.queryByTestId("wall-tool-wall")).toBeNull();
    expect(screen.queryByTestId("wall-snap")).toBeNull();
    // The keys need a map too.
    press("w");
    expect(chip()).toBeNull();
  });

  it("the 5 key opens the Walls tab and 6 the Table tab (T018's tab keys extend)", () => {
    renderWalls(storeWithMaps());
    openTab("maps");
    fireEvent.keyDown(window, { key: "5" });
    expect(screen.getByTestId("dm-tabpanel").dataset.tab).toBe("walls");
    fireEvent.keyDown(window, { key: "6" });
    expect(screen.getByTestId("dm-tabpanel").dataset.tab).toBe("table");
  });
});

describe("WallsPanel tools (T102)", () => {
  it("Wall and Door arm the tool (one at a time, a second click disarms), with the chip, the hint and Stop; Esc stops", () => {
    renderWalls(storeWithMaps([]));
    expect(surface().dataset.wallTool).toBe("none");
    expect(surface().dataset.wallSnap).toBe("true");
    expect(screen.queryByTestId("wall-stop")).toBeNull();
    expect(screen.getByTestId("wall-selection-hint").textContent).toMatch(/click a wall on the canvas to select it; pick a door by its name/i);

    fireEvent.click(wallButton());
    expect(pressed(wallButton())).toBe("true");
    expect(pressed(doorButton())).toBe("false");
    expect(surface().dataset.wallTool).toBe("wall");
    expect(surface().dataset.wallGesture).toBe("idle");
    expect(surface().style.cursor).toBe("crosshair");
    expect(screen.getByTestId("dm-map-stage").dataset.tool).toBe("active");
    expect(chip()?.textContent).toContain("Walls · wall");
    expect(chip()?.dataset.tool).toBe("wall");
    expect(chip()?.dataset.tab).toBe("walls");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("W");
    expect(screen.getByTestId("wall-hint").textContent).toMatch(/click each corner/i);
    expect(screen.getByTestId("wall-hint").textContent).toContain("Shift");
    expect(screen.getByTestId("wall-selection-hint").textContent).toMatch(/click each corner/i);
    expect(screen.getByTestId("wall-stop")).toBeTruthy();

    fireEvent.click(doorButton());
    expect(pressed(wallButton())).toBe("false");
    expect(pressed(doorButton())).toBe("true");
    expect(surface().dataset.wallTool).toBe("door");
    expect(chip()?.textContent).toContain("Walls · door");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("D");
    expect(screen.getByTestId("wall-hint").textContent).toMatch(/drag across the doorway/i);

    fireEvent.click(doorButton());
    expect(pressed(doorButton())).toBe("false");
    expect(surface().dataset.wallTool).toBe("none");
    expect(chip()).toBeNull();
    expect(screen.queryByTestId("wall-hint")).toBeNull();
    expect(surface().style.cursor).toBe("");

    fireEvent.click(wallButton());
    fireEvent.click(screen.getByTestId("wall-stop"));
    expect(surface().dataset.wallTool).toBe("none");
    fireEvent.click(wallButton());
    press("Escape");
    expect(surface().dataset.wallTool).toBe("none");
    expect(pressed(wallButton())).toBe("false");
  });

  it("is exclusive with the other canvas tools: arming fog or the pen puts it down, and W puts those down", () => {
    renderWalls(storeWithMaps([]));
    fireEvent.click(wallButton());
    press("b");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.wallTool).toBe("none");
    openTab("walls");
    expect(pressed(wallButton())).toBe("false");
    press("w");
    expect(surface().dataset.fogging).toBe("false");
    expect(surface().dataset.wallTool).toBe("wall");
    press("p");
    expect(surface().dataset.drawing).toBe("draw");
    expect(surface().dataset.wallTool).toBe("none");
    press("d");
    expect(surface().dataset.drawing).toBe("false");
    expect(surface().dataset.wallTool).toBe("door");
    press("n");
    expect(surface().dataset.noteTool).toBe("placing");
    expect(surface().dataset.wallTool).toBe("none");
    press("g");
    expect(surface().dataset.aligning).toBe("true");
    press("w");
    expect(surface().dataset.aligning).toBe("false");
    expect(surface().dataset.wallTool).toBe("wall");
    // Tokens stand aside while the tool runs, like under every other tool.
    expect(surface().dataset.tokenTool).toBe("none");
    press("v");
    expect(surface().dataset.tokenTool).toBe("active");
  });

  it("clicks draw a polyline of segments snapped to grid corners; Esc ends it with nothing dangling and keeps the tool", () => {
    const store = storeWithMaps([]);
    const dispatched: SharedOp[] = [];
    store.onOps((ops) => dispatched.push(...ops));
    renderWalls(store);
    fireEvent.click(wallButton());

    click(52, 48); // → (50, 50)
    expect(surface().dataset.wallGesture).toBe("drawing");
    expect(wallsOf(store)).toHaveLength(0);
    click(148, 53); // → (150, 50)
    expect(wallsOf(store)).toHaveLength(1);
    expect(wallsOf(store)[0]).toMatchObject({ kind: "wall", x1: 50, y1: 50, x2: 150, y2: 50 });
    click(152, 148); // → (150, 150)
    click(47, 152); // → (50, 150)
    click(52, 48); // back to (50, 50)
    expect(wallsOf(store).map(ends)).toEqual([
      [50, 50, 150, 50],
      [150, 50, 150, 150],
      [150, 150, 50, 150],
      [50, 150, 50, 50],
    ]);
    expect(surface().dataset.wallGesture).toBe("drawing");
    expect(screen.getByTestId("wall-hint").textContent).toContain("Esc ends this one");
    expect(screen.getByTestId("wall-count").textContent).toBe("(4)");
    expect(screen.getByTestId("wall-summary").textContent).toBe("4 walls, 0 doors.");

    press("Escape");
    expect(surface().dataset.wallGesture).toBe("idle");
    expect(surface().dataset.wallTool).toBe("wall");
    expect(wallsOf(store)).toHaveLength(4);
    expect(dispatched).toHaveLength(4);
    expect(dispatched.every((op) => op.kind === "map/wall-set" && op.id === "a")).toBe(true);
    const ids = wallsOf(store).map((w) => w.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    press("Escape");
    expect(surface().dataset.wallTool).toBe("none");
  });

  it("a double-click on the last corner ends the polyline; a drag draws one segment; a click that repeats the last corner adds nothing", () => {
    const store = storeWithMaps([]);
    renderWalls(store);
    fireEvent.click(wallButton());
    click(50, 50);
    click(100, 50);
    click(100, 50); // Konva reports a double-click on this release: the polyline ends.
    expect(wallsOf(store).map(ends)).toEqual([[50, 50, 100, 50]]);
    expect(surface().dataset.wallGesture).toBe("idle");
    expect(surface().dataset.wallTool).toBe("wall");

    drag([
      [200, 200],
      [230, 210],
      [252, 198],
    ]);
    expect(wallsOf(store).map(ends)).toEqual([
      [50, 50, 100, 50],
      [200, 200, 250, 200],
    ]);
    expect(surface().dataset.wallGesture).toBe("drawing");
    letClickWindowPass();
    click(251, 201); // the same corner again, slowly: nothing is added and the polyline goes on
    expect(wallsOf(store)).toHaveLength(2);
    expect(surface().dataset.wallGesture).toBe("drawing");
    click(250, 250);
    expect(wallsOf(store).map(ends)[2]).toEqual([250, 200, 250, 250]);
    // Two quick clicks on two corners are two corners, not an end.
    click(300, 250);
    click(300, 300);
    expect(wallsOf(store)).toHaveLength(5);
    expect(surface().dataset.wallGesture).toBe("drawing");
    press("Escape");
  });

  it("Snap to grid off, or Shift, places points exactly where the pointer is", () => {
    const store = storeWithMaps([]);
    renderWalls(store);
    fireEvent.click(wallButton());
    click(52, 48, { shiftKey: true });
    click(148, 53);
    expect(wallsOf(store).map(ends)).toEqual([[52, 48, 150, 50]]);
    press("Escape");

    fireEvent.click(screen.getByTestId("wall-snap"));
    expect(surface().dataset.wallSnap).toBe("false");
    click(52, 48);
    click(148, 53);
    expect(wallsOf(store).map(ends)[1]).toEqual([52, 48, 148, 53]);
    press("Escape");
    fireEvent.click(screen.getByTestId("wall-snap"));
    expect(surface().dataset.wallSnap).toBe("true");
  });

  it("the door tool drags one closed door between snapped ends; a click makes none", () => {
    const store = storeWithMaps([]);
    renderWalls(store);
    fireEvent.click(doorButton());
    drag([
      [148, 52],
      [150, 80],
      [152, 97],
    ]);
    expect(surface().dataset.wallGesture).toBe("idle");
    expect(wallsOf(store)).toEqual([
      { id: expect.any(String), kind: "door", open: false, x1: 150, y1: 50, x2: 150, y2: 100 },
    ]);
    expect(screen.getByTestId("wall-summary").textContent).toBe("0 walls, 1 door.");
    click(200, 200);
    expect(wallsOf(store)).toHaveLength(1);
    // Esc mid-drag abandons the door and keeps the tool.
    fireEvent.mouseDown(stageContent(), { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(stageContent(), { clientX: 300, clientY: 200 });
    expect(surface().dataset.wallGesture).toBe("dragging");
    press("Escape");
    expect(surface().dataset.wallGesture).toBe("idle");
    expect(surface().dataset.wallTool).toBe("door");
    fireEvent.mouseUp(stageContent(), { clientX: 300, clientY: 200 });
    expect(wallsOf(store)).toHaveLength(1);
  });

  it("with no tool armed a click on a wall selects it (a door from the list): the panel names it, Delete removes it, Esc deselects", () => {
    const store = storeWithMaps();
    renderWalls(store);
    expect(surface().dataset.wallSelected).toBe("");
    expect(screen.queryByTestId("wall-selected")).toBeNull();

    clickSegment("w1");
    expect(surface().dataset.wallSelected).toBe("w1");
    const selected = screen.getByTestId("wall-selected");
    expect(selected.dataset.wallId).toBe("w1");
    expect(selected.dataset.wallKind).toBe("wall");
    expect(screen.getByTestId("wall-selected-kind").textContent).toBe("wall");
    expect(screen.getByTestId("wall-selected-length").textContent).toBe("2 cells");
    expect(screen.queryByTestId("wall-selection-hint")).toBeNull();
    // The canvas highlights it and offers its two end handles.
    const stage = lastStage();
    expect(stage.find(".wall-highlight")).toHaveLength(1);
    expect(stage.findOne<Konva.Circle>("#wall-handle-w1-start")!.position()).toEqual({ x: 0, y: 0 });
    expect(stage.findOne<Konva.Circle>("#wall-handle-w1-end")!.position()).toEqual({ x: 100, y: 0 });

    // A click on a door opens or closes it instead (T103) and leaves the selection alone; the list selects it.
    clickSegment("d1");
    expect(surface().dataset.wallSelected).toBe("w1");
    expect(wallsOf(store)[2]).toMatchObject({ id: "d1", open: true });
    clickSegment("d1");
    expect(wallsOf(store)[2]).toMatchObject({ id: "d1", open: false });
    selectDoor("d1");
    expect(surface().dataset.wallSelected).toBe("d1");
    expect(screen.getByTestId("wall-selected-kind").textContent).toBe("door (closed)");
    expect(screen.getByTestId("wall-selected-length").textContent).toBe("0.4 cells");
    expect(lastStage().find(".wall-handle")).toHaveLength(2);
    expect(lastStage().findOne("#wall-handle-w1-start")).toBeUndefined();

    // An Alt-click is a ping, not a selection.
    clickSegment("w2", true);
    expect(surface().dataset.wallSelected).toBe("d1");

    press("Escape");
    expect(surface().dataset.wallSelected).toBe("");
    expect(lastStage().find(".wall-handle")).toHaveLength(0);

    clickSegment("w2");
    press("Delete");
    expect(wallsOf(store).map((w) => w.id)).toEqual(["w1", "d1"]);
    expect(surface().dataset.wallSelected).toBe("");
    selectDoor("d1");
    press("Backspace");
    expect(wallsOf(store).map((w) => w.id)).toEqual(["w1"]);
    // The panel's button does the same.
    clickSegment("w1");
    fireEvent.click(screen.getByTestId("wall-delete"));
    expect(wallsOf(store)).toEqual([]);
    expect(surface().dataset.wallSelected).toBe("");
    expect(surface().dataset.walls).toBe("0");
  });

  it("Delete leaves text fields alone, and a selection is dropped when a tool is armed, the segment goes or the map changes", () => {
    const store = storeWithMaps();
    renderWalls(store);
    clickSegment("w1");
    openTab("maps");
    fireEvent.keyDown(screen.getByTestId("campaign-name-input"), { key: "Backspace" });
    fireEvent.keyDown(document.body, { key: "Delete", ctrlKey: true });
    expect(wallsOf(store)).toHaveLength(3);
    expect(surface().dataset.wallSelected).toBe("w1");

    press("b");
    expect(surface().dataset.wallSelected).toBe("");
    press("v");
    clickSegment("w1");
    expect(surface().dataset.wallSelected).toBe("w1");
    act(() => {
      store.getState().dispatch({ kind: "map/wall-remove", id: "a", segmentId: "w1" });
    });
    expect(surface().dataset.wallSelected).toBe("");
    clickSegment("w2");
    expect(surface().dataset.wallSelected).toBe("w2");
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: "b" });
    });
    expect(surface().dataset.wallSelected).toBe("");
    press("Delete");
    expect(wallsOf(store)).toHaveLength(2);
  });

  it("dragging an end handle moves that end through one map/wall-set, snapped unless Shift is held", () => {
    const store = storeWithMaps();
    const dispatched: SharedOp[] = [];
    store.onOps((ops) => dispatched.push(...ops));
    renderWalls(store);
    clickSegment("w1");

    const handle = dragHandle("w1", "end", { x: 203, y: 47 });
    expect(handle.position()).toEqual({ x: 200, y: 50 });
    expect(wallsOf(store)[0]).toEqual({ id: "w1", kind: "wall", x1: 0, y1: 0, x2: 200, y2: 50 });
    expect(dispatched).toEqual([
      { kind: "map/wall-set", id: "a", segment: { id: "w1", kind: "wall", x1: 0, y1: 0, x2: 200, y2: 50 } },
    ]);
    expect(surface().dataset.wallSelected).toBe("w1");
    expect(screen.getByTestId("wall-selected-length").textContent).toBe("4.1 cells");

    dragHandle("w1", "start", { x: 23, y: 27 }, true);
    expect(wallsOf(store)[0]).toMatchObject({ x1: 23, y1: 27, x2: 200, y2: 50 });
    expect(dispatched).toHaveLength(2);

    // A door keeps its kind and state through a move.
    selectDoor("d1");
    dragHandle("d1", "end", { x: 98, y: 2 });
    expect(wallsOf(store)[2]).toEqual({ id: "d1", kind: "door", open: false, x1: 40, y1: 0, x2: 100, y2: 0 });
    // Dropping an end where it already is dispatches nothing.
    dragHandle("d1", "start", { x: 40, y: 0 }, true);
    expect(dispatched).toHaveLength(3);
    // Near a corner the drop snaps to it (40, 0) → (50, 0); with Shift it lands where dropped.
    dragHandle("d1", "start", { x: 41, y: 1 });
    expect(wallsOf(store)[2]).toMatchObject({ x1: 50, y1: 0 });
    dragHandle("d1", "start", { x: 41, y: 1 }, true);
    expect(wallsOf(store)[2]).toMatchObject({ x1: 41, y1: 1 });
    expect(dispatched).toHaveLength(5);
  });

  it("segments are only interactive while no tool is armed and Space is up", () => {
    renderWalls(storeWithMaps());
    const nodes = () => lastStage().find<Konva.Line>(".wall");
    expect(nodes().every((n) => n.listening())).toBe(true);
    expect(lastStage().findOne<Konva.Group>(".walls")!.listening()).toBe(true);
    fireEvent.click(wallButton());
    expect(nodes().every((n) => !n.listening())).toBe(true);
    press("Escape");
    expect(nodes().every((n) => n.listening())).toBe(true);
    fireEvent.keyDown(document.body, { key: " " });
    expect(nodes().every((n) => !n.listening())).toBe(true);
    fireEvent.keyUp(document.body, { key: " " });
    expect(nodes().every((n) => n.listening())).toBe(true);
  });

  it("switching maps ends the tool and any polyline in progress", () => {
    const store = storeWithMaps([]);
    renderWalls(store);
    fireEvent.click(wallButton());
    click(50, 50);
    click(100, 50);
    expect(surface().dataset.wallGesture).toBe("drawing");
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: "b" });
    });
    expect(surface().dataset.wallTool).toBe("none");
    expect(surface().dataset.wallGesture).toBe("idle");
    expect(chip()).toBeNull();
    expect(wallsOf(store)).toHaveLength(1);
    expect(wallsOf(store, "b")).toHaveLength(0);
    // Back on the first map the tool is still down; the walls are still there.
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: "a" });
    });
    expect(surface().dataset.wallTool).toBe("none");
    expect(surface().dataset.walls).toBe("1");
  });
});

describe("WallsPanel doors in play (T103)", () => {
  const doorSegments: WallSegment[] = [
    createWall({ id: "w1", x1: 0, y1: 0, x2: 100, y2: 0 }),
    createDoor({ id: "d1", x1: 100, y1: 0, x2: 150, y2: 0 }),
    createDoor({ id: "d2", x1: 0, y1: 50, x2: 0, y2: 100, open: true }),
  ];
  const items = () => screen.getAllByTestId("door-item");
  const labels = () => items().map((li) => li.querySelector("[data-testid=door-select]")!.textContent);
  const toggles = () => screen.getAllByTestId("door-toggle");

  it("lists the doors with their state; a toggle is one map/door-set-open, and the list and the canvas agree", () => {
    const store = storeWithMaps(doorSegments);
    const dispatched: SharedOp[] = [];
    store.onOps((ops) => dispatched.push(...ops));
    renderWalls(store);
    expect(items().map((li) => li.dataset.doorId)).toEqual(["d1", "d2"]);
    expect(labels()).toEqual(["Door 1 · closed", "Door 2 · open"]);
    expect(toggles().map((b) => b.textContent)).toEqual(["Open", "Close"]);
    expect(toggles().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(screen.getByTestId("door-list").dataset.doorsOpen).toBe("1");
    expect(surface().dataset.doorsOpen).toBe("1");
    expect(lastStage().find(".door-leaf")).toHaveLength(1);

    // The panel's toggle: one op, seen by `store.onOps` listeners (T106 re-runs vision there).
    fireEvent.click(toggles()[0]);
    expect(dispatched).toEqual([{ kind: "map/door-set-open", id: "a", segmentId: "d1", open: true }]);
    expect(wallsOf(store)[1]).toEqual({ ...doorSegments[1], open: true });
    expect(labels()).toEqual(["Door 1 · open", "Door 2 · open"]);
    expect(items()[0].dataset.open).toBe("true");
    expect(toggles()[0].textContent).toBe("Close");
    expect(screen.getByTestId("wall-summary").textContent).toBe("1 wall, 2 doors.");
    expect(surface().dataset.doorsOpen).toBe("2");
    expect(surface().dataset.wallSegments).toContain("door:100,0,150,0:open");
    expect(lastStage().find(".door-leaf")).toHaveLength(2);

    // A click on that door on the canvas closes it again; the list follows.
    clickSegment("d1");
    expect(dispatched[1]).toEqual({ kind: "map/door-set-open", id: "a", segmentId: "d1", open: false });
    expect(labels()).toEqual(["Door 1 · closed", "Door 2 · open"]);
    expect(surface().dataset.wallSegments).toContain("door:100,0,150,0:closed");
    expect(lastStage().find(".door-leaf")).toHaveLength(1);
    // A change arriving any other way (a dispatch from elsewhere) shows in both too.
    act(() => {
      store.getState().dispatch({ kind: "map/door-set-open", id: "a", segmentId: "d2", open: false });
    });
    expect(labels()).toEqual(["Door 1 · closed", "Door 2 · closed"]);
    expect(surface().dataset.doorsOpen).toBe("0");
    expect(lastStage().find(".door-leaf")).toHaveLength(0);
    // Toggling selects nothing and adds no other op.
    expect(surface().dataset.wallSelected).toBe("");
    expect(dispatched.map((op) => op.kind)).toEqual(["map/door-set-open", "map/door-set-open", "map/door-set-open"]);
  });

  it("a door's name selects it and centres the canvas on it without opening it; with no doors there is no list", () => {
    // A measurable container, so the canvas has a middle to centre on (jsdom reports no size).
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const store = storeWithMaps(doorSegments);
      renderWalls(store);
      const stageEl = () => screen.getByTestId("dm-map-stage");
      const onScreen = (x: number, y: number) => {
        const scale = Number(stageEl().dataset.scale);
        return { x: Number(stageEl().dataset.viewportX) + x * scale, y: Number(stageEl().dataset.viewportY) + y * scale };
      };

      selectDoor("d2");
      expect(surface().dataset.wallSelected).toBe("d2");
      expect(items().map((li) => li.dataset.selected)).toEqual(["false", "true"]);
      expect(screen.getByTestId("wall-selected-kind").textContent).toBe("door (open)");
      expect(lastStage().find(".wall-handle")).toHaveLength(2);
      expect(wallsOf(store)[2]).toEqual(doorSegments[2]);
      // d2's middle (0, 75) is in the middle of the 800 × 600 canvas.
      expect(onScreen(0, 75).x).toBeCloseTo(400, 0);
      expect(onScreen(0, 75).y).toBeCloseTo(300, 0);

      selectDoor("d1");
      expect(surface().dataset.wallSelected).toBe("d1");
      expect(onScreen(125, 0).x).toBeCloseTo(400, 0);
      expect(onScreen(125, 0).y).toBeCloseTo(300, 0);
      expect(wallsOf(store)[1]).toEqual(doorSegments[1]);

      act(() => {
        store.getState().dispatch({ kind: "map/wall-remove", id: "a", segmentId: "d1" });
        store.getState().dispatch({ kind: "map/wall-remove", id: "a", segmentId: "d2" });
      });
      expect(screen.queryByTestId("door-list")).toBeNull();
      expect(screen.queryAllByTestId("door-item")).toHaveLength(0);
      expect(screen.getByTestId("wall-summary").textContent).toBe("1 wall, 0 doors.");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });
});

describe("describeDoor (T103)", () => {
  it("numbers the door and names its state", () => {
    expect(describeDoor(1, false)).toBe("Door 1 · closed");
    expect(describeDoor(12, true)).toBe("Door 12 · open");
  });
});

describe("describeWallKind / describeWallLength", () => {
  it("name the kind, a door's state, and the length in cells to one decimal", () => {
    expect(describeWallKind(createWall({ id: "w", x1: 0, y1: 0, x2: 1, y2: 0 }))).toBe("wall");
    expect(describeWallKind(createDoor({ id: "d", x1: 0, y1: 0, x2: 1, y2: 0 }))).toBe("door (closed)");
    expect(describeWallKind(createDoor({ id: "d", x1: 0, y1: 0, x2: 1, y2: 0, open: true }))).toBe("door (open)");
    const w = createWall({ id: "w", x1: 0, y1: 0, x2: 30, y2: 40 });
    expect(describeWallLength(w, 50)).toBe("1 cell");
    expect(describeWallLength(w, 25)).toBe("2 cells");
    expect(describeWallLength(w, 70)).toBe("0.7 cells");
    expect(describeWallLength(w, 0)).toBe("50 px");
  });
});
