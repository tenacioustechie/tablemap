/**
 * Fog panel and the fog tools, driven through `DmView` so the panel, the
 * canvas and the store are exercised together (the raster maths, the
 * gesture machine, snapping and the undo log have their own unit tests).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createFogActions } from "../state/fogActions";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState, type SharedOp } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { createToken } from "../state/tokens";
import { openTab } from "../test/dmTabs";
import { DmView } from "./DmView";
import { describeVisionDim } from "./FogPanel";
import { fogFeatherPx, FOG_BRUSH_RADIUS } from "./fogTool";
import type { PlayerWindowController } from "./playerWindow";

const noWindow: PlayerWindowController = {
  open: () => null,
  close: () => {},
  isOpen: () => false,
  isFullscreen: () => false,
  toggleFullscreen: async () => "not-open",
  getHandle: () => null,
};

function renderDm(store: TableStore) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  const fogActions = createFogActions(store, db, {
    bake: async () => new Blob(["png"], { type: "image/png" }),
  });
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} fogActions={fogActions} />
    </MemoryRouter>
  );
  openTab("fog");
}

const CELL = 50;
function storeWithMaps() {
  const a = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: CELL });
  const b = createBlankMapScene({ id: "b", name: "B", columns: 4, rows: 4, cellSize: CELL });
  return createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId: "a" });
}

const fogOf = (store: TableStore, id = "a") =>
  store.getState().shared.maps.find((m) => m.id === id)!.fogOps;
const stageContent = () =>
  screen.getByTestId("dm-map-stage").querySelector(".konvajs-content")!;
const surface = () => screen.getByTestId("dm-canvas-surface");
const feather = fogFeatherPx(CELL);

/** Zero-size container => identity viewport, so screen px == map px. */
function drag(points: [number, number][]) {
  const [first, ...rest] = points;
  fireEvent.mouseDown(stageContent(), { clientX: first[0], clientY: first[1] });
  for (const [x, y] of rest) fireEvent.mouseMove(stageContent(), { clientX: x, clientY: y });
  const last = points[points.length - 1];
  fireEvent.mouseUp(stageContent(), { clientX: last[0], clientY: last[1] });
}

describe("FogPanel", () => {
  it("asks for a map when none is shown", () => {
    renderDm(createTableStore());
    expect(screen.getByTestId("fog-panel").textContent).toMatch(/show a map/i);
    expect(screen.queryByTestId("fog-tool-brush")).toBeNull();
  });

  it("hide all / reveal all append fill ops to the active map and show the count", () => {
    const store = storeWithMaps();
    renderDm(store);
    expect(screen.getByTestId("fog-op-count").textContent).toBe("0");
    fireEvent.click(screen.getByTestId("fog-reveal-all"));
    fireEvent.click(screen.getByTestId("fog-hide-all"));
    expect(fogOf(store)).toEqual([
      { type: "fill", mode: "reveal" },
      { type: "fill", mode: "hide" },
    ]);
    expect(fogOf(store, "b")).toEqual([]);
    expect(screen.getByTestId("fog-op-count").textContent).toBe("2");
    expect(screen.getByTestId("dm-map-stage").dataset.fogOps).toBe("2");
    expect(screen.getByTestId("dm-map-stage").dataset.fogStatus).toBe("ready");
  });

  it("the brush turns a drag into one feathered stroke op with the slider's radius, and stays on", () => {
    const store = storeWithMaps();
    renderDm(store);
    const brush = screen.getByTestId("fog-tool-brush");
    expect(surface().dataset.fogging).toBe("false");
    expect(surface().dataset.fogTool).toBe("none");
    fireEvent.click(brush);
    expect(brush.getAttribute("aria-pressed")).toBe("true");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.fogTool).toBe("brush");
    expect(screen.getByTestId("dm-map-stage").dataset.tool).toBe("active");
    expect(screen.getByTestId("fog-hint").textContent).toMatch(/reveal with the brush/i);

    fireEvent.change(screen.getByTestId("fog-brush-radius"), { target: { value: "25" } });
    expect(screen.getByTestId("fog-brush-radius-value").textContent).toBe("25");

    drag([
      [100, 100],
      [101, 100], // under the minimum step: not a vertex
      [140, 100],
      [140, 150],
    ]);
    expect(fogOf(store)).toEqual([
      {
        type: "shape",
        mode: "reveal",
        shape: { kind: "stroke", points: [100, 100, 140, 100, 140, 150], radius: 25 },
        feather,
      },
    ]);
    expect(surface().dataset.fogging).toBe("reveal");

    // A click paints a dot.
    drag([[10, 10]]);
    expect(fogOf(store)[1]).toMatchObject({ shape: { kind: "stroke", points: [10, 10], radius: 25 } });

    // Esc mid-drag abandons the stroke; Esc otherwise leaves the tool.
    fireEvent.mouseDown(stageContent(), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(stageContent(), { clientX: 60, clientY: 60 });
    expect(surface().dataset.fogGesture).toBe("dragging");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.fogGesture).toBe("idle");
    fireEvent.mouseUp(stageContent(), { clientX: 60, clientY: 60 });
    expect(fogOf(store)).toHaveLength(2);
    expect(surface().dataset.fogging).toBe("reveal");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.fogging).toBe("false");
    expect(brush.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("fog-hint")).toBeNull();
  });

  it("hide mode, the rectangle and the lasso; feather off gives hard edges; clicking the active tool stops it", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("fog-mode-hide"));
    expect(screen.getByTestId("fog-mode-hide").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("fog-feather"));
    expect((screen.getByTestId("fog-feather") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId("fog-tool-rect"));
    expect(surface().dataset.fogging).toBe("hide");
    expect(surface().dataset.fogTool).toBe("rect");
    drag([
      [120, 80],
      [200, 150],
      [20, 150],
    ]);
    expect(fogOf(store)).toEqual([
      { type: "shape", mode: "hide", shape: { kind: "rect", x: 20, y: 80, width: 100, height: 70 } },
    ]);
    // A click (no drag) is not a rectangle.
    drag([
      [10, 10],
      [11, 10],
    ]);
    expect(fogOf(store)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("fog-tool-lasso"));
    expect(surface().dataset.fogTool).toBe("lasso");
    expect(screen.getByTestId("fog-tool-rect").getAttribute("aria-pressed")).toBe("false");
    drag([
      [10, 10],
      [60, 10],
      [60, 60],
      [10, 60],
    ]);
    expect(fogOf(store)[1]).toEqual({
      type: "shape",
      mode: "hide",
      shape: { kind: "polygon", points: [10, 10, 60, 10, 60, 60, 10, 60] },
    });
    // Reveal mode with feather back on: the same lasso, feathered.
    fireEvent.click(screen.getByTestId("fog-mode-reveal"));
    fireEvent.click(screen.getByTestId("fog-feather"));
    drag([
      [10, 10],
      [60, 10],
      [10, 60],
    ]);
    expect(fogOf(store)[2]).toEqual({
      type: "shape",
      mode: "reveal",
      shape: { kind: "polygon", points: [10, 10, 60, 10, 10, 60] },
      feather,
    });

    // Clicking the active tool turns it off; Stop does too.
    fireEvent.click(screen.getByTestId("fog-tool-lasso"));
    expect(surface().dataset.fogging).toBe("false");
    fireEvent.click(screen.getByTestId("fog-tool-lasso"));
    fireEvent.click(screen.getByTestId("fog-stop"));
    expect(surface().dataset.fogging).toBe("false");
    expect(screen.queryByTestId("fog-stop")).toBeNull();
  });

  it("snap to grid expands every tool's shape to whole cells (one rects op, never feathered)", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("fog-snap"));
    fireEvent.click(screen.getByTestId("fog-tool-rect"));
    expect(screen.getByTestId("fog-hint").textContent).toMatch(/whole cells/);
    drag([
      [60, 60],
      [130, 80],
    ]); // touches cells (1..2, 1)
    expect(fogOf(store)).toEqual([
      { type: "shape", mode: "reveal", shape: { kind: "rects", rects: [50, 50, 100, 50] } },
    ]);
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    fireEvent.change(screen.getByTestId("fog-brush-radius"), { target: { value: "10" } });
    drag([[225, 225]]); // a dot of radius 10 in the middle of cell (4, 4)
    expect(fogOf(store)[1]).toEqual({
      type: "shape",
      mode: "reveal",
      shape: { kind: "rects", rects: [200, 200, 50, 50] },
    });
    fireEvent.click(screen.getByTestId("fog-tool-lasso"));
    drag([
      [10, 10],
      [90, 10],
      [10, 90],
    ]); // a triangle over cells (0,0), (1,0), (0,1)
    expect(fogOf(store)[2]).toEqual({
      type: "shape",
      mode: "reveal",
      shape: { kind: "rects", rects: [0, 0, 100, 50, 0, 50, 50, 50] },
    });
    // A gesture touching no cell (a click with the rectangle) is nothing.
    fireEvent.click(screen.getByTestId("fog-tool-rect"));
    drag([[10, 10]]);
    expect(fogOf(store)).toHaveLength(3);
  });

  it("undo / redo buttons and shortcuts walk the map's log; new ops discard redo", () => {
    const store = storeWithMaps();
    renderDm(store);
    const undo = screen.getByTestId("fog-undo");
    const redo = screen.getByTestId("fog-redo");
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("fog-reveal-all"));
    fireEvent.click(screen.getByTestId("fog-hide-all"));
    expect((undo as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(undo);
    expect(fogOf(store)).toEqual([{ type: "fill", mode: "reveal" }]);
    expect((redo as HTMLButtonElement).disabled).toBe(false);
    expect(redo.textContent).toBe("Redo (1)");
    fireEvent.click(redo);
    expect(fogOf(store)).toHaveLength(2);
    expect((redo as HTMLButtonElement).disabled).toBe(true);

    // Keyboard: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (and Cmd on a Mac).
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(fogOf(store)).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(fogOf(store)).toHaveLength(2);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(fogOf(store)).toHaveLength(2);
    // Not from a text field (the campaign name field is on the Maps tab).
    openTab("maps");
    fireEvent.keyDown(screen.getByTestId("campaign-name-input"), { key: "z", ctrlKey: true });
    expect(fogOf(store)).toHaveLength(2);
    openTab("fog");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.click(screen.getByTestId("fog-reveal-all")); // a new op: redo is gone
    expect((redo as HTMLButtonElement).disabled).toBe(true);
    expect(fogOf(store)).toEqual([
      { type: "fill", mode: "reveal" },
      { type: "fill", mode: "reveal" },
    ]);
    expect(screen.getByTestId("fog-op-count").textContent).toBe("2");
  });

  it("the fog tool and the alignment tool exclude each other, and a map switch ends them", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    expect(surface().dataset.fogging).toBe("reveal");
    openTab("maps");
    fireEvent.click(screen.getByTestId("align-grid-button"));
    expect(surface().dataset.aligning).toBe("true");
    expect(surface().dataset.fogging).toBe("false");
    openTab("fog");
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    expect(surface().dataset.aligning).toBe("false");
    expect(surface().dataset.fogging).toBe("reveal");

    act(() => store.getState().dispatch({ kind: "map/set-active", id: "b" }));
    expect(surface().dataset.fogging).toBe("false");
    expect(screen.getByTestId("dm-map-stage").dataset.mapId).toBe("b");
    expect(screen.getByTestId("fog-op-count").textContent).toBe("0");
    // Undo works on the newly active map only.
    fireEvent.click(screen.getByTestId("fog-hide-all"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(fogOf(store, "b")).toEqual([]);
    expect(fogOf(store, "a")).toEqual([]);
  });

  it("the vision dim select dispatches map/set-vision-dim for the active map, and the hint follows the tokens (T105)", () => {
    const store = storeWithMaps();
    renderDm(store);
    const dispatched: SharedOp[] = [];
    store.onOps((ops) => dispatched.push(...ops));
    const select = () => screen.getByTestId("vision-dim") as HTMLSelectElement;
    const hint = () => screen.getByTestId("vision-dim-hint");
    const disc = { type: "disc" as const, color: "#f00" };

    expect(screen.getByLabelText("Dim unseen areas on the TV")).toBe(select());
    expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([
      ["auto", "Auto"],
      ["on", "On"],
      ["off", "Off"],
    ]);
    expect(select().value).toBe("auto");
    expect(hint().textContent).toBe("Off: no token on this map has vision.");
    expect(hint().dataset.usesVision).toBe("false");

    // Auto follows the tokens: one with vision turns it on, a hidden one still counts.
    act(() => {
      store.getState().dispatch({ kind: "map/token-add", id: "a", token: createToken({ id: "t1", x: 0, y: 0, appearance: disc }) });
    });
    expect(hint().dataset.usesVision).toBe("false");
    act(() => {
      store.getState().dispatch({ kind: "map/token-update", id: "a", tokenId: "t1", patch: { vision: 6 } });
    });
    expect(hint().textContent).toBe("On: 1 token on this map has vision.");
    expect(hint().dataset.usesVision).toBe("true");
    act(() => {
      store.getState().dispatch({
        kind: "map/token-add",
        id: "a",
        token: createToken({ id: "t2", x: 50, y: 0, appearance: disc, vision: 2, hidden: true }),
      });
    });
    expect(hint().textContent).toBe("On: 2 tokens on this map have vision.");
    dispatched.length = 0;

    // Off and On: one op each, for the active map only.
    fireEvent.change(select(), { target: { value: "off" } });
    expect(dispatched).toEqual([{ kind: "map/set-vision-dim", id: "a", visionDim: "off" }]);
    expect(store.getState().shared.maps.map((m) => m.visionDim)).toEqual(["off", "auto"]);
    expect(select().value).toBe("off");
    expect(hint().textContent).toBe("Always off for this map.");
    expect(hint().dataset.usesVision).toBe("false");
    fireEvent.change(select(), { target: { value: "on" } });
    expect(dispatched[1]).toEqual({ kind: "map/set-vision-dim", id: "a", visionDim: "on" });
    expect(hint().textContent).toBe("Always on for this map.");
    expect(hint().dataset.usesVision).toBe("true");

    // Another map shows its own value; nothing touched the fog.
    act(() => store.getState().dispatch({ kind: "map/set-active", id: "b" }));
    expect(select().value).toBe("auto");
    expect(hint().dataset.usesVision).toBe("false");
    fireEvent.change(select(), { target: { value: "on" } });
    expect(dispatched.slice(2)).toEqual([
      { kind: "map/set-active", id: "b" },
      { kind: "map/set-vision-dim", id: "b", visionDim: "on" },
    ]);
    expect(store.getState().shared.maps.map((m) => m.visionDim)).toEqual(["on", "on"]);
    expect(fogOf(store)).toEqual([]);
    expect(fogOf(store, "b")).toEqual([]);
  });

  it("the brush radius slider is bounded", () => {
    renderDm(storeWithMaps());
    const slider = screen.getByTestId("fog-brush-radius") as HTMLInputElement;
    expect(slider.min).toBe(String(FOG_BRUSH_RADIUS.min));
    expect(slider.max).toBe(String(FOG_BRUSH_RADIUS.max));
    expect(slider.value).toBe(String(FOG_BRUSH_RADIUS.default));
  });
});

describe("describeVisionDim", () => {
  it("says what the setting resolves to on the map", () => {
    expect(describeVisionDim("auto", 0)).toBe("Off: no token on this map has vision.");
    expect(describeVisionDim("auto", 1)).toBe("On: 1 token on this map has vision.");
    expect(describeVisionDim("auto", 3)).toBe("On: 3 tokens on this map have vision.");
    expect(describeVisionDim("on", 0)).toBe("Always on for this map.");
    expect(describeVisionDim("off", 2)).toBe("Always off for this map.");
  });
});
