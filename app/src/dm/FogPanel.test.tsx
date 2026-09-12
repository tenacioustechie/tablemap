/**
 * Fog panel and the rectangle reveal tool, driven through `DmView` so the
 * panel, the canvas and the store are exercised together (the raster maths
 * and the mask bookkeeping have their own unit tests under `map/`).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createFogActions } from "../state/fogActions";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
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
  const fogActions = createFogActions(store, db, {
    bake: async () => new Blob(["png"], { type: "image/png" }),
  });
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} fogActions={fogActions} />
    </MemoryRouter>
  );
}

function storeWithMaps() {
  const a = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 });
  const b = createBlankMapScene({ id: "b", name: "B", columns: 4, rows: 4, cellSize: 50 });
  return createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId: "a" });
}

const fogOf = (store: TableStore, id = "a") =>
  store.getState().shared.maps.find((m) => m.id === id)!.fogOps;
const stageContent = () =>
  screen.getByTestId("dm-map-stage").querySelector(".konvajs-content")!;
const surface = () => screen.getByTestId("dm-canvas-surface");

describe("FogPanel", () => {
  it("asks for a map when none is shown", () => {
    renderDm(createTableStore());
    expect(screen.getByTestId("fog-panel").textContent).toMatch(/show a map/i);
    expect(screen.queryByTestId("fog-reveal-rect-button")).toBeNull();
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

  it("the rectangle tool turns a drag on the canvas into a reveal op and stays on", () => {
    const store = storeWithMaps();
    renderDm(store);
    const button = screen.getByTestId("fog-reveal-rect-button");
    expect(surface().dataset.fogging).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(screen.getByTestId("dm-map-stage").dataset.tool).toBe("active");
    expect(screen.getByTestId("fog-hint")).toBeTruthy();

    // Zero-size container => identity viewport, so screen px == map px.
    fireEvent.mouseDown(stageContent(), { clientX: 120, clientY: 80 });
    fireEvent.mouseMove(stageContent(), { clientX: 200, clientY: 150 });
    fireEvent.mouseUp(stageContent(), { clientX: 20, clientY: 150 });
    expect(fogOf(store)).toEqual([
      {
        type: "shape",
        mode: "reveal",
        shape: { kind: "rect", x: 20, y: 80, width: 100, height: 70 },
      },
    ]);
    expect(surface().dataset.fogging).toBe("reveal");

    // A click (no drag) is not a rectangle.
    fireEvent.mouseDown(stageContent(), { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(stageContent(), { clientX: 11, clientY: 10 });
    expect(fogOf(store)).toHaveLength(1);

    // Esc mid-drag abandons the rectangle; Esc otherwise leaves the tool.
    fireEvent.mouseDown(stageContent(), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(stageContent(), { clientX: 60, clientY: 60 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(stageContent(), { clientX: 60, clientY: 60 });
    expect(fogOf(store)).toHaveLength(1);
    expect(surface().dataset.fogging).toBe("reveal");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.fogging).toBe("false");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("the fog tool and the alignment tool exclude each other, and a map switch ends them", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("fog-reveal-rect-button"));
    expect(surface().dataset.fogging).toBe("reveal");
    fireEvent.click(screen.getByTestId("align-grid-button"));
    expect(surface().dataset.aligning).toBe("true");
    expect(surface().dataset.fogging).toBe("false");
    fireEvent.click(screen.getByTestId("fog-reveal-rect-button"));
    expect(surface().dataset.aligning).toBe("false");
    expect(surface().dataset.fogging).toBe("reveal");

    act(() => store.getState().dispatch({ kind: "map/set-active", id: "b" }));
    expect(surface().dataset.fogging).toBe("false");
    expect(screen.getByTestId("dm-map-stage").dataset.mapId).toBe("b");
    expect(screen.getByTestId("fog-op-count").textContent).toBe("0");
  });
});
