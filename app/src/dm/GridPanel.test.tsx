/**
 * Grid settings panel and the alignment tool, driven through `DmView` so the
 * panel, the canvas and the store are exercised together (the alignment
 * maths and state machine have their own unit tests under `map/`).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createMapActions } from "../state/mapActions";
import { createBlankMapScene } from "../state/maps";
import { defaultGridSettings } from "../state/model";
import { initialSharedState } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { fixtureSquareCorners, GRID_FIXTURE } from "../test/gridFixture";
import { DmView } from "./DmView";
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
  const actions = createMapActions(store, db);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} mapActions={actions} />
    </MemoryRouter>
  );
}

/** A blank map the size of the grid fixture, with its default 70 px grid. */
function storeWithMap() {
  const map = createBlankMapScene({ id: "m", name: "Fixture", columns: 1, rows: 1, cellSize: 1 });
  const scene = { ...map, width: GRID_FIXTURE.width, height: GRID_FIXTURE.height, grid: defaultGridSettings() };
  return createTableStore({ ...initialSharedState(), maps: [scene], activeMapId: "m" });
}

const grid = (store: TableStore) => store.getState().shared.maps[0].grid;
const stageContent = () =>
  screen.getByTestId("dm-map-stage").querySelector(".konvajs-content")!;

describe("GridPanel", () => {
  it("asks for a map when none is shown", () => {
    renderDm(createTableStore());
    expect(screen.getByTestId("grid-panel").textContent).toMatch(/show a map/i);
    expect(screen.queryByTestId("align-grid-button")).toBeNull();
  });

  it("edits cell size and offset through the store", () => {
    const store = storeWithMap();
    renderDm(store);
    fireEvent.change(screen.getByLabelText("Grid cell size"), { target: { value: "52.5" } });
    fireEvent.change(screen.getByLabelText("Grid offset X"), { target: { value: "-3" } });
    fireEvent.change(screen.getByLabelText("Grid offset Y"), { target: { value: "9" } });
    expect(grid(store)).toMatchObject({ cellSize: 52.5, offsetX: -3, offsetY: 9 });
    expect(store.getState().seq).toBe(3);
  });

  it("ignores empty or invalid cell sizes while typing without snapping the field back", () => {
    const store = storeWithMap();
    renderDm(store);
    const input = screen.getByLabelText("Grid cell size") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "-4" } });
    expect(grid(store).cellSize).toBe(70);
    expect(store.getState().seq).toBe(0);
    fireEvent.change(input, { target: { value: "45" } });
    expect(grid(store).cellSize).toBe(45);
  });

  it("changes visibility, colour and opacity independently for DM and player views", () => {
    const store = storeWithMap();
    renderDm(store);
    fireEvent.click(screen.getByLabelText("Show grid (Player view)"));
    expect(grid(store).player.visible).toBe(false);
    expect(grid(store).dm.visible).toBe(true);

    fireEvent.change(screen.getByLabelText("Grid colour (DM view)"), { target: { value: "#ff0000" } });
    expect(grid(store).dm.color).toBe("#ff0000");
    expect(grid(store).player.color).toBe("#ffffff");

    fireEvent.change(screen.getByLabelText("Grid opacity (Player view)"), { target: { value: "0.8" } });
    expect(grid(store).player.opacity).toBe(0.8);
    expect(grid(store).dm.opacity).toBe(0.3);

    // The DM canvas follows the DM style.
    fireEvent.click(screen.getByLabelText("Show grid (DM view)"));
    expect(screen.getByTestId("dm-map-stage").dataset.gridVisible).toBe("false");
    fireEvent.click(screen.getByLabelText("Show grid (DM view)"));
    expect(screen.getByTestId("dm-map-stage").dataset.gridVisible).toBe("true");
  });
});

describe("grid alignment tool", () => {
  /** Stage pixel for a map point under the canvas' current viewport. */
  function toScreen(point: { x: number; y: number }) {
    const stage = screen.getByTestId("dm-map-stage");
    // The canvas fits the map on mount; under jsdom the container has no
    // size, so the viewport stays at the identity transform.
    expect(stage.dataset.scale).toBe("1.0000");
    return { clientX: point.x, clientY: point.y };
  }

  it("is off by default; the button and Esc toggle it; it is disabled with no map", () => {
    const store = storeWithMap();
    renderDm(store);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.aligning).toBe("false");
    expect(screen.getByTestId("dm-map-stage").dataset.tool).toBe("none");

    fireEvent.click(screen.getByTestId("align-grid-button"));
    expect(surface.dataset.aligning).toBe("true");
    expect(screen.getByTestId("dm-map-stage").dataset.tool).toBe("active");
    expect(screen.getByTestId("align-hint").textContent).toMatch(/drag across one map square/i);
    expect(screen.getByTestId("align-grid-button").textContent).toMatch(/cancel/i);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface.dataset.aligning).toBe("false");
    expect(screen.queryByTestId("align-hint")).toBeNull();
    expect(store.getState().seq).toBe(0);
  });

  it("dragging across one square sets the grid to the fixture geometry (±1 px) and syncs", () => {
    const store = storeWithMap();
    const deltas: unknown[] = [];
    store.onOps((ops) => deltas.push(...ops));
    renderDm(store);
    fireEvent.click(screen.getByTestId("align-grid-button"));
    const [a, b] = fixtureSquareCorners(2, 1);
    const content = stageContent();
    fireEvent.mouseDown(content, toScreen(a));
    fireEvent.mouseMove(content, toScreen({ x: 150, y: 120 }));
    fireEvent.mouseUp(content, toScreen(b));

    const result = grid(store);
    const expected = GRID_FIXTURE.geometry;
    expect(Math.abs(result.cellSize - expected.cellSize)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.offsetX - expected.offsetX)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.offsetY - expected.offsetY)).toBeLessThanOrEqual(1);
    // Styles untouched, tool ends, one op left the store for the player.
    expect(result.dm).toEqual(defaultGridSettings().dm);
    expect(result.player).toEqual(defaultGridSettings().player);
    expect(screen.getByTestId("dm-canvas-surface").dataset.aligning).toBe("false");
    expect(deltas).toEqual([{ kind: "map/set-grid", id: "m", grid: result }]);
  });

  it("clicking two opposite corners works too, with a hint in between", () => {
    const store = storeWithMap();
    renderDm(store);
    fireEvent.click(screen.getByTestId("align-grid-button"));
    const [a, b] = fixtureSquareCorners(0, 0);
    const content = stageContent();
    fireEvent.mouseDown(content, toScreen(a));
    fireEvent.mouseUp(content, toScreen({ x: a.x + 1, y: a.y }));
    expect(screen.getByTestId("align-hint").textContent).toMatch(/opposite corner/i);
    expect(grid(store).cellSize).toBe(70);
    fireEvent.mouseMove(content, toScreen({ x: 30, y: 30 }));
    fireEvent.mouseDown(content, toScreen(b));
    expect(grid(store)).toMatchObject(GRID_FIXTURE.geometry);
    expect(screen.getByTestId("dm-canvas-surface").dataset.aligning).toBe("false");
  });

  it("refuses a box too small to be a cell and stays active for another try", () => {
    const store = storeWithMap();
    renderDm(store);
    fireEvent.click(screen.getByTestId("align-grid-button"));
    const content = stageContent();
    fireEvent.mouseDown(content, toScreen({ x: 100, y: 100 }));
    fireEvent.mouseUp(content, toScreen({ x: 102, y: 130 }));
    expect(screen.getByTestId("align-error").textContent).toMatch(/too small/i);
    expect(screen.getByTestId("dm-canvas-surface").dataset.aligning).toBe("true");
    expect(store.getState().seq).toBe(0);

    const [a, b] = fixtureSquareCorners(1, 1);
    fireEvent.mouseDown(content, toScreen(a));
    fireEvent.mouseUp(content, toScreen(b));
    expect(grid(store)).toMatchObject(GRID_FIXTURE.geometry);
  });

  it("ends when the active map changes", () => {
    const store = storeWithMap();
    renderDm(store);
    fireEvent.click(screen.getByTestId("align-grid-button"));
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: null });
    });
    expect(screen.getByTestId("grid-panel").textContent).toMatch(/show a map/i);
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: "m" });
    });
    expect(screen.getByTestId("dm-canvas-surface").dataset.aligning).toBe("false");
  });
});
