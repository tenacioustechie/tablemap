/**
 * The Walls tab placeholder (T101), driven through `DmView`: the sixth tab,
 * the counts, and **Clear walls** behind an inline confirm that dispatches
 * one `map/walls-clear`; the confirm folds away on Cancel, on a map switch
 * and when the walls change under it.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    // The canvas draws them (the layer has its own test); the surface reports the count.
    expect(screen.getByTestId("dm-canvas-surface").dataset.walls).toBe("3");
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
    expect(screen.getByTestId("dm-canvas-surface").dataset.walls).toBe("0");
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

  it("without an active map it says so and offers nothing to clear", () => {
    renderWalls(storeWithMaps(segments, null));
    expect(screen.getByTestId("walls-panel").textContent).toContain("Show a map");
    expect(screen.queryByTestId("walls-clear")).toBeNull();
    expect(screen.queryByTestId("wall-count")).toBeNull();
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
