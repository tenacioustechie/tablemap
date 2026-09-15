import { act, fireEvent, render, screen } from "@testing-library/react";
import Konva from "konva";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import type { FogOp } from "../state/fog";
import { createFogActions } from "../state/fogActions";
import { createBlankMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { initialSharedState, type SharedOp } from "../state/shared";
import { createTableStore } from "../state/store";
import { createToken } from "../state/tokens";
import { createVisionActions, visionRevealOp } from "../state/visionActions";
import { createDoor, createWall } from "../state/walls";
import { openTab } from "../test/dmTabs";
import { DmView, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from "./DmView";
import { FILL_TOO_LARGE_MESSAGE, FOG_BRUSH_RADIUS } from "./fogTool";
import type { FullscreenResult, PlayerWindowController } from "./playerWindow";
import { MOUSE_GESTURES, SHORTCUTS } from "./shortcuts";
import { DM_TABS, SIDEBAR_STORAGE_KEY, TAB_STORAGE_KEY, type TabStorage } from "./SidebarTabs";

function fakeController(
  overrides: Partial<PlayerWindowController> = {}
): PlayerWindowController & { state: { open: boolean; fullscreen: boolean } } {
  const state = { open: false, fullscreen: false };
  return {
    state,
    open: vi.fn(() => {
      state.open = true;
      return null;
    }),
    close: vi.fn(() => {
      state.open = false;
      state.fullscreen = false;
    }),
    isOpen: () => state.open,
    isFullscreen: () => state.fullscreen,
    toggleFullscreen: vi.fn(async (): Promise<FullscreenResult> => {
      if (!state.open) return "not-open";
      state.fullscreen = !state.fullscreen;
      return state.fullscreen ? "entered" : "exited";
    }),
    getHandle: () => null,
    ...overrides,
  };
}

function renderDm(ctl: PlayerWindowController) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <DmView playerWindow={ctl} />
    </MemoryRouter>
  );
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: TabStorage & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
  return storage;
}

/** A store with one 500 x 400 map, and an injected tab memory. */
function renderWithMap(storage: TabStorage | null = fakeStorage()) {
  const map = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 });
  const store = createTableStore({ ...initialSharedState(), maps: [map], activeMapId: "a" });
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  const utils = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={fakeController()} tabStorage={storage} />
    </MemoryRouter>
  );
  return { ...utils, store };
}

const surface = () => screen.getByTestId("dm-canvas-surface");
const tabpanel = () => screen.getByTestId("dm-tabpanel");
const chip = () => screen.queryByTestId("tool-status");

const openButton = () => screen.getByRole("button", { name: "Open player view" });
const closeButton = () =>
  screen.getByRole("button", { name: "Close player view" });
const fullscreenButton = () =>
  screen.getByRole("button", { name: /player fullscreen|fullscreen player/i });
const statusText = () => screen.getByTestId("player-window-status").textContent;

describe("DmView", () => {
  it("lays out a toolbar, a tools sidebar and a canvas area", () => {
    renderDm(fakeController());
    expect(screen.getByTestId("dm-controls")).toBeTruthy();
    expect(screen.getByTestId("dm-sidebar")).toBeTruthy();
    expect(screen.getByTestId("dm-canvas")).toBeTruthy();
  });

  it("starts with the player window closed and controls disabled", () => {
    renderDm(fakeController());
    expect(statusText()).toBe("Player view: closed");
    expect((fullscreenButton() as HTMLButtonElement).disabled).toBe(true);
    expect((closeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the player window and enables fullscreen/close controls", () => {
    const ctl = fakeController();
    renderDm(ctl);
    fireEvent.click(openButton());
    expect(ctl.open).toHaveBeenCalledTimes(1);
    expect(statusText()).toBe("Player view: open");
    expect((fullscreenButton() as HTMLButtonElement).disabled).toBe(false);
    expect((closeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("toggles fullscreen through the retained handle", async () => {
    const ctl = fakeController();
    renderDm(ctl);
    fireEvent.click(openButton());
    await act(async () => {
      fireEvent.click(fullscreenButton());
    });
    expect(ctl.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(statusText()).toBe("Player view: fullscreen");
    expect(
      screen.getByRole("button", { name: "Exit player fullscreen" })
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(fullscreenButton());
    });
    expect(statusText()).toBe("Player view: open");
  });

  it("shows a hint when the browser denies cross-window fullscreen", async () => {
    const ctl = fakeController({
      toggleFullscreen: vi.fn(async () => "denied" as const),
    });
    renderDm(ctl);
    fireEvent.click(openButton());
    expect(screen.queryByTestId("fullscreen-hint")).toBeNull();
    await act(async () => {
      fireEvent.click(fullscreenButton());
    });
    expect(screen.getByTestId("fullscreen-hint").textContent).toMatch(
      /press F in the player window/i
    );
  });

  it("closes the player window", () => {
    const ctl = fakeController();
    renderDm(ctl);
    fireEvent.click(openButton());
    fireEvent.click(closeButton());
    expect(ctl.close).toHaveBeenCalledTimes(1);
    expect(statusText()).toBe("Player view: closed");
  });

  it("notices when the player window was closed externally", () => {
    vi.useFakeTimers();
    try {
      const ctl = fakeController();
      renderDm(ctl);
      fireEvent.click(openButton());
      expect(statusText()).toBe("Player view: open");
      ctl.state.open = false;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(statusText()).toBe("Player view: closed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DmView sidebar tabs (T016)", () => {
  it("mounts one tab's panels at a time, Maps first, and keeps the toolbar controls on every tab", () => {
    renderWithMap();
    expect(tabpanel().dataset.tab).toBe("maps");
    expect(screen.getByTestId("campaign-name-input")).toBeTruthy();
    expect(screen.getByTestId("map-panel")).toBeTruthy();
    expect(screen.getByTestId("grid-panel")).toBeTruthy();
    expect(screen.queryByTestId("fog-panel")).toBeNull();
    expect(screen.queryByTestId("token-panel")).toBeNull();
    expect(screen.queryByTestId("annotation-panel")).toBeNull();
    expect(screen.queryByTestId("calibration-status")).toBeNull();

    const everywhere = () => {
      expect(screen.getByTestId("blackout-toggle")).toBeTruthy();
      expect(screen.getByTestId("splash-toggle")).toBeTruthy();
      expect(openButton()).toBeTruthy();
      expect(screen.getByTestId("player-window-status")).toBeTruthy();
    };
    everywhere();

    openTab("fog");
    expect(screen.getByTestId("fog-panel")).toBeTruthy();
    expect(screen.queryByTestId("map-panel")).toBeNull();
    expect(screen.queryByTestId("campaign-name-input")).toBeNull();
    everywhere();

    openTab("tokens");
    expect(screen.getByTestId("token-panel")).toBeTruthy();
    expect(screen.queryByTestId("fog-panel")).toBeNull();
    everywhere();

    openTab("draw");
    expect(screen.getByTestId("annotation-panel")).toBeTruthy();
    expect(screen.queryByTestId("token-panel")).toBeNull();
    everywhere();

    openTab("walls");
    expect(screen.getByTestId("walls-panel")).toBeTruthy();
    expect(screen.queryByTestId("annotation-panel")).toBeNull();
    everywhere();

    openTab("table");
    expect(screen.getByTestId("calibration-status")).toBeTruthy();
    expect(screen.getByTestId("player-viewport-info")).toBeTruthy();
    expect(screen.getByTestId("splash-thumb")).toBeTruthy();
    expect(screen.queryByTestId("walls-panel")).toBeNull();
    everywhere();
  });

  it("an armed fog brush survives a trip to the Tokens tab and back, with the chip saying so throughout", () => {
    const { store } = renderWithMap();
    expect(chip()).toBeNull();
    openTab("fog");
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    expect(surface().dataset.fogging).toBe("reveal");
    expect(chip()?.textContent).toContain("Fog · reveal brush");
    expect(chip()?.dataset.tab).toBe("fog");

    openTab("tokens");
    expect(screen.queryByTestId("fog-panel")).toBeNull();
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.fogTool).toBe("brush");
    expect(chip()?.textContent).toContain("Fog · reveal brush");
    fireEvent.click(screen.getByTestId("token-add"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Orc" } });
    expect(store.getState().shared.maps[0].tokens[0].name).toBe("Orc");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(chip()?.textContent).toContain("Fog · reveal brush");

    openTab("fog");
    expect(screen.getByTestId("fog-tool-brush").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("fog-stop")).toBeTruthy();
    expect(chip()?.textContent).toContain("Fog · reveal brush");
  });

  it("the chip's Stop ends the tool like Esc, and its name opens the owning tab", () => {
    renderWithMap();
    openTab("fog");
    fireEvent.click(screen.getByTestId("fog-mode-hide"));
    fireEvent.click(screen.getByTestId("fog-tool-rect"));
    expect(chip()?.textContent).toContain("Fog · hide rectangle");
    openTab("table");
    fireEvent.click(screen.getByTestId("tool-status-name"));
    expect(tabpanel().dataset.tab).toBe("fog");
    expect(screen.getByTestId("fog-tool-rect").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId("tool-stop"));
    expect(chip()).toBeNull();
    expect(surface().dataset.fogging).toBe("false");
    expect(screen.getByTestId("fog-tool-rect").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("fog-stop")).toBeNull();

    // Every other tool has a chip too, and Esc clears it as before.
    openTab("maps");
    fireEvent.click(screen.getByTestId("align-grid-button"));
    expect(chip()?.textContent).toContain("Align grid");
    expect(chip()?.dataset.tab).toBe("maps");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(chip()).toBeNull();

    openTab("draw");
    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    expect(chip()?.textContent).toContain("Draw · pen");
    fireEvent.click(screen.getByTestId("draw-mode-erase"));
    expect(chip()?.textContent).toContain("Draw · eraser");
    fireEvent.click(screen.getByTestId("note-tool"));
    expect(chip()?.textContent).toContain("Place note");
    openTab("tokens");
    fireEvent.click(screen.getByTestId("tool-status-name"));
    expect(tabpanel().dataset.tab).toBe("draw");
    expect(screen.getByTestId("note-tool").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("tool-stop"));
    expect(chip()).toBeNull();
    expect(surface().dataset.noteTool).toBe("none");
  });

  it("tool settings and the selection outlive a tab switch; the tab is remembered and restored", () => {
    const storage = fakeStorage();
    const first = renderWithMap(storage);
    openTab("fog");
    fireEvent.click(screen.getByTestId("fog-mode-hide"));
    fireEvent.change(screen.getByTestId("fog-brush-radius"), { target: { value: "77" } });
    fireEvent.click(screen.getByTestId("fog-snap"));
    openTab("tokens");
    fireEvent.click(screen.getByTestId("token-add"));
    const tokenId = first.store.getState().shared.maps[0].tokens[0].id;
    expect(screen.getByTestId("token-editor").dataset.tokenId).toBe(tokenId);
    openTab("fog");
    expect(screen.getByTestId("fog-mode-hide").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("fog-brush-radius-value").textContent).toBe("77");
    expect((screen.getByTestId("fog-snap") as HTMLInputElement).checked).toBe(true);
    openTab("tokens");
    expect(screen.getByTestId("token-editor").dataset.tokenId).toBe(tokenId);
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("tokens");
    first.unmount();

    // "Reload": a fresh view over the same storage opens where it left off.
    renderWithMap(storage);
    expect(tabpanel().dataset.tab).toBe("tokens");
  });
});

// ---- T019: sidebar collapse, toolbar facts ------------------------------------

describe("DmView sidebar collapse (T019)", () => {
  const view = () => screen.getByTestId("dm-view");
  const sidebar = () => screen.getByTestId("dm-sidebar");
  const toggle = () => screen.getByTestId("sidebar-toggle");
  const columns = () => view().style.gridTemplateColumns;

  it("opens 300 px wide; the toggle collapses it to the tab strip and the canvas column grows", () => {
    renderWithMap();
    expect(SIDEBAR_WIDTH).toBe(300);
    expect(columns()).toBe(`${SIDEBAR_WIDTH}px 1fr`);
    expect(sidebar().style.width).toBe(`${SIDEBAR_WIDTH}px`);
    expect(view().dataset.sidebar).toBe("expanded");
    expect(sidebar().dataset.collapsed).toBe("false");

    fireEvent.click(toggle());
    expect(columns()).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px 1fr`);
    expect(sidebar().style.width).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`);
    expect(view().dataset.sidebar).toBe("collapsed");
    expect(sidebar().dataset.collapsed).toBe("true");
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    expect(screen.queryByTestId("map-panel")).toBeNull();
    // The canvas and the toolbar are untouched.
    expect(screen.getByTestId("dm-canvas-surface")).toBeTruthy();
    expect(screen.getByTestId("blackout-toggle")).toBeTruthy();

    fireEvent.click(toggle());
    expect(columns()).toBe(`${SIDEBAR_WIDTH}px 1fr`);
    expect(tabpanel().dataset.tab).toBe("maps");
    expect(screen.getByTestId("map-panel")).toBeTruthy();
  });

  it("the collapsed state survives a reload next to the tab, under tablemap.dm.sidebar", () => {
    const storage = fakeStorage();
    const first = renderWithMap(storage);
    openTab("tokens");
    fireEvent.click(toggle());
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("collapsed");
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("tokens");
    first.unmount();

    const second = renderWithMap(storage);
    expect(columns()).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px 1fr`);
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    expect(screen.getByTestId("dm-tab-tokens").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(toggle());
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("expanded");
    expect(tabpanel().dataset.tab).toBe("tokens");
    second.unmount();

    renderWithMap(storage);
    expect(columns()).toBe(`${SIDEBAR_WIDTH}px 1fr`);
  });

  it("a tab click, a tab key, the tool chip's name and the calibration chip all expand it; tool keys only pick the tab", () => {
    const storage = fakeStorage({ [SIDEBAR_STORAGE_KEY]: "collapsed" });
    renderWithMap(storage);
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();

    fireEvent.click(screen.getByTestId("dm-tab-fog"));
    expect(tabpanel().dataset.tab).toBe("fog");
    fireEvent.click(toggle());
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();

    press("3");
    expect(tabpanel().dataset.tab).toBe("tokens");
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("expanded");
    fireEvent.click(toggle());

    // A tool key arms the tool and records its tab without opening the sidebar.
    press("b");
    expect(chip()?.dataset.tool).toBe("fog");
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("fog");
    expect(surface().dataset.fogging).toBe("reveal");
    fireEvent.click(screen.getByTestId("tool-status-name"));
    expect(tabpanel().dataset.tab).toBe("fog");
    expect(surface().dataset.fogging).toBe("reveal");
    fireEvent.click(toggle());

    fireEvent.click(screen.getByTestId("calibration-chip"));
    expect(tabpanel().dataset.tab).toBe("table");
    expect(screen.getByTestId("calibration-status")).toBeTruthy();
  });
});

describe("DmView toolbar facts (T019)", () => {
  const mapName = () => screen.getByTestId("active-map-name");
  const calibrationChip = () => screen.getByTestId("calibration-chip");
  const tv = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };

  it("shows the active map's name between the splash switch and the status, live through renames and switches", () => {
    const { store } = renderWithMap();
    expect(mapName().textContent).toBe("A");
    expect(mapName().dataset.mapId).toBe("a");
    const toolbar = screen.getByTestId("dm-controls");
    const order = Array.from(toolbar.querySelectorAll("[data-testid]")).map(
      (el) => (el as HTMLElement).dataset.testid
    );
    expect(order.indexOf("splash-toggle")).toBeLessThan(order.indexOf("active-map-name"));
    expect(order.indexOf("active-map-name")).toBeLessThan(order.indexOf("calibration-chip"));
    expect(order.indexOf("calibration-chip")).toBeLessThan(order.indexOf("player-window-status"));

    act(() => store.getState().dispatch({ kind: "map/rename", id: "a", name: "Crypt of Ages" }));
    expect(mapName().textContent).toBe("Crypt of Ages");
    act(() => store.getState().dispatch({ kind: "map/set-active", id: null }));
    expect(mapName().textContent).toBe("No map shown");
    expect(mapName().dataset.mapId).toBe("");
    act(() => store.getState().dispatch({ kind: "map/set-active", id: "a" }));
    expect(mapName().textContent).toBe("Crypt of Ages");
  });

  it("the calibration chip reads the current calibration and cell unit live, or says Not calibrated", () => {
    const { store } = renderWithMap();
    expect(calibrationChip().textContent).toBe("Not calibrated");
    expect(calibrationChip().dataset.calibrated).toBe("false");

    act(() => {
      store.getState().setPlayerDisplay(tv);
      store.getState().setPresentation({
        calibration: { pxPerInch: 96, method: "diagonal", updatedAt: 1 },
      });
    });
    expect(calibrationChip().textContent).toBe("1 inch = 96 px/in");
    expect(calibrationChip().dataset.calibrated).toBe("true");
    act(() => store.getState().setPresentation({ cellUnit: "mm25" }));
    expect(calibrationChip().textContent).toBe("25 mm = 96 px/in");
    act(() =>
      store.getState().setPresentation({
        calibration: { pxPerInch: 40.25, method: "square", updatedAt: 2 },
      })
    );
    expect(calibrationChip().textContent).toBe("25 mm = 40.3 px/in");

    // The player moves to an unknown display: uncalibrated again, at once.
    act(() => store.getState().setPlayerDisplay({ ...tv, left: 0 }));
    expect(calibrationChip().textContent).toBe("Not calibrated");
    expect(calibrationChip().dataset.calibrated).toBe("false");
  });

  it("the calibration chip opens the Table tab from anywhere", () => {
    renderWithMap();
    openTab("draw");
    fireEvent.click(calibrationChip());
    expect(tabpanel().dataset.tab).toBe("table");
    expect(screen.getByTestId("calibration-status")).toBeTruthy();
  });
});

// ---- T018: shortcuts, the cheat sheet and the pan override -------------------

const stageContent = () =>
  screen.getByTestId("dm-map-stage").querySelector(".konvajs-content")!;
const stage = () => screen.getByTestId("dm-map-stage");
const press = (
  key: string,
  init: Partial<KeyboardEventInit> = {},
  target: Element | Document | Window = document.body
) => fireEvent.keyDown(target, { key, ...init });
const fogOps = (store: ReturnType<typeof renderWithMap>["store"]) =>
  store.getState().shared.maps[0].fogOps;

describe("DmView keyboard shortcuts (T018)", () => {
  it("1–5 open the tabs in order; V stops the tool without changing the tab", () => {
    renderWithMap();
    DM_TABS.forEach((t, i) => {
      press(String(i + 1));
      expect(tabpanel().dataset.tab).toBe(t.id);
    });
    press("B");
    expect(chip()?.dataset.tool).toBe("fog");
    press("3");
    expect(tabpanel().dataset.tab).toBe("tokens");
    press("V");
    expect(chip()).toBeNull();
    expect(surface().dataset.fogging).toBe("false");
    expect(tabpanel().dataset.tab).toBe("tokens");
  });

  it("fog keys arm the fog tool with that mode / tool, open the Fog tab and show the key in the chip", () => {
    renderWithMap();
    expect(tabpanel().dataset.tab).toBe("maps");
    press("b");
    expect(tabpanel().dataset.tab).toBe("fog");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.fogTool).toBe("brush");
    expect(chip()?.textContent).toContain("Fog · reveal brush");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("B");
    expect(screen.getByTestId("fog-tool-brush").getAttribute("aria-pressed")).toBe("true");

    // A second press keeps the tool armed (keys arm, they do not toggle).
    press("B");
    expect(surface().dataset.fogging).toBe("reveal");

    press("H");
    expect(surface().dataset.fogging).toBe("hide");
    expect(surface().dataset.fogTool).toBe("brush");
    press("X");
    expect(surface().dataset.fogTool).toBe("rect");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("X");
    press("L");
    expect(surface().dataset.fogTool).toBe("lasso");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("L");
    press("R");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(chip()?.textContent).toContain("Fog · reveal lasso");

    // A mode key from another tab, with the tool stopped, arms it and comes back to Fog.
    press("V");
    openTab("table");
    press("h");
    expect(tabpanel().dataset.tab).toBe("fog");
    expect(surface().dataset.fogging).toBe("hide");
    expect(surface().dataset.fogTool).toBe("lasso");
  });

  it("[ and ] step the brush radius within its bounds without arming or switching tabs", () => {
    renderWithMap();
    openTab("fog");
    const value = () => Number(screen.getByTestId("fog-brush-radius-value").textContent);
    expect(value()).toBe(FOG_BRUSH_RADIUS.default);
    press("]");
    expect(value()).toBe(FOG_BRUSH_RADIUS.default + FOG_BRUSH_RADIUS.step);
    press("[");
    press("[");
    expect(value()).toBe(FOG_BRUSH_RADIUS.default - FOG_BRUSH_RADIUS.step);
    expect(chip()).toBeNull();
    for (let i = 0; i < 100; i++) press("[");
    expect(value()).toBe(FOG_BRUSH_RADIUS.min);
    for (let i = 0; i < 100; i++) press("]");
    expect(value()).toBe(FOG_BRUSH_RADIUS.max);
    openTab("tokens");
    press("[");
    expect(tabpanel().dataset.tab).toBe("tokens");
    openTab("fog");
    expect(value()).toBe(FOG_BRUSH_RADIUS.max - FOG_BRUSH_RADIUS.step);
  });

  it("P / E arm the pen / eraser, N the note tool, G the alignment tool, each opening its tab", () => {
    renderWithMap();
    press("p");
    expect(tabpanel().dataset.tab).toBe("draw");
    expect(surface().dataset.drawing).toBe("draw");
    expect(chip()?.textContent).toContain("Draw · pen");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("P");
    expect(screen.getByTestId("draw-mode-draw").getAttribute("aria-pressed")).toBe("true");
    press("E");
    expect(surface().dataset.drawing).toBe("erase");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("E");

    openTab("maps");
    press("n");
    expect(tabpanel().dataset.tab).toBe("draw");
    expect(surface().dataset.noteTool).toBe("placing");
    expect(surface().dataset.drawing).toBe("false");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("N");
    expect(screen.getByTestId("note-tool").getAttribute("aria-pressed")).toBe("true");

    press("G");
    expect(tabpanel().dataset.tab).toBe("maps");
    expect(surface().dataset.aligning).toBe("true");
    expect(surface().dataset.noteTool).toBe("none");
    expect(chip()?.textContent).toContain("Align grid");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("G");
    expect(screen.getByTestId("align-grid-button").getAttribute("aria-pressed")).toBe("true");
  });

  it("W / D arm the wall / door tool and open the Walls tab; they put the other tools down and vice versa (T102)", () => {
    const { store } = renderWithMap();
    press("w");
    expect(tabpanel().dataset.tab).toBe("walls");
    expect(surface().dataset.wallTool).toBe("wall");
    expect(chip()?.textContent).toContain("Walls · wall");
    expect(chip()?.dataset.tool).toBe("wall");
    expect(chip()?.dataset.tab).toBe("walls");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("W");
    expect(screen.getByTestId("wall-tool-wall").getAttribute("aria-pressed")).toBe("true");
    expect(stage().dataset.tool).toBe("active");
    expect(surface().dataset.tokenTool).toBe("none");

    // Keys arm, they do not toggle; D switches to the door within the same tool.
    press("W");
    expect(surface().dataset.wallTool).toBe("wall");
    press("d");
    expect(surface().dataset.wallTool).toBe("door");
    expect(chip()?.textContent).toContain("Walls · door");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("D");
    expect(screen.getByTestId("wall-tool-door").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("wall-tool-wall").getAttribute("aria-pressed")).toBe("false");

    // Exclusive with every other tool.
    press("b");
    expect(surface().dataset.wallTool).toBe("none");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(tabpanel().dataset.tab).toBe("fog");
    press("w");
    expect(surface().dataset.fogging).toBe("false");
    expect(surface().dataset.wallTool).toBe("wall");
    expect(tabpanel().dataset.tab).toBe("walls");
    press("g");
    expect(surface().dataset.wallTool).toBe("none");
    expect(surface().dataset.aligning).toBe("true");
    press("d");
    expect(surface().dataset.aligning).toBe("false");
    expect(surface().dataset.wallTool).toBe("door");

    // The chip's Stop, V and Esc all put it down; the tab stays.
    fireEvent.click(screen.getByTestId("tool-stop"));
    expect(chip()).toBeNull();
    expect(surface().dataset.wallTool).toBe("none");
    expect(surface().dataset.tokenTool).toBe("active");
    press("w");
    press("v");
    expect(surface().dataset.wallTool).toBe("none");
    press("d");
    press("Escape");
    expect(surface().dataset.wallTool).toBe("none");
    expect(tabpanel().dataset.tab).toBe("walls");
    expect(store.getState().shared.maps[0].walls).toEqual([]);
  });

  it("a click on a door opens or closes it with the fog brush, the pen or a note armed, and the tool paints nothing (T103)", () => {
    const { store } = renderWithMap();
    act(() => {
      store.getState().dispatch({
        kind: "map/wall-set",
        id: "a",
        segment: createDoor({ id: "d1", x1: 100, y1: 100, x2: 150, y2: 100 }),
      });
    });
    const scene = () => store.getState().shared.maps[0];
    const doorOpen = () => {
      const door = scene().walls[0];
      return door.kind === "door" && door.open;
    };
    /**
     * A click on the door as Konva delivers one (it cannot hit-test under
     * jsdom): the pointer over it, then the press, release and click fired
     * on its node, bubbling to the stage and its tool.
     */
    const clickDoor = () => {
      fireEvent.mouseMove(stageContent(), { clientX: 125, clientY: 100 });
      const konvaStage = Konva.stages.find((s) => stage().contains(s.container()))!;
      const node = konvaStage.findOne<Konva.Line>("#wall-d1")!;
      act(() => {
        for (const type of ["mousedown", "mouseup", "click"]) {
          node.fire(type, { evt: new MouseEvent(type, { clientX: 125, clientY: 100 }) }, true);
        }
      });
    };

    // The fog brush: a click on the map paints a dot…
    press("b");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.doorsClickable).toBe("true");
    fireEvent.mouseDown(stageContent(), { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(stageContent(), { clientX: 300, clientY: 300 });
    expect(fogOps(store)).toHaveLength(1);
    // …a click on the door opens it and paints nothing; the brush stays armed; a second click closes it.
    clickDoor();
    expect(doorOpen()).toBe(true);
    expect(fogOps(store)).toHaveLength(1);
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.fogGesture).toBe("idle");
    clickDoor();
    expect(doorOpen()).toBe(false);
    expect(fogOps(store)).toHaveLength(1);

    // The pen: no stroke. A note being placed: no note, and the tool is still placing.
    press("p");
    expect(surface().dataset.drawing).not.toBe("false");
    clickDoor();
    expect(doorOpen()).toBe(true);
    expect(surface().dataset.drawGesture).toBe("idle");
    expect(scene().annotations).toHaveLength(0);
    press("n");
    expect(surface().dataset.noteTool).toBe("placing");
    clickDoor();
    expect(doorOpen()).toBe(false);
    expect(scene().annotations).toHaveLength(0);
    expect(surface().dataset.noteTool).toBe("placing");

    // No tool armed: the click toggles and selects nothing.
    press("v");
    clickDoor();
    expect(doorOpen()).toBe(true);
    expect(surface().dataset.wallSelected).toBe("");

    // Not under the tools that click on grid corners, where doors end: the wall tools and alignment.
    press("w");
    expect(surface().dataset.doorsClickable).toBe("false");
    press("g");
    expect(surface().dataset.doorsClickable).toBe("false");
    press("v");
    expect(surface().dataset.doorsClickable).toBe("true");
    expect(fogOps(store)).toHaveLength(1);
  });

  it("no key fires inside the campaign-name input or a note textarea; modifiers are left alone", () => {
    const { store } = renderWithMap();
    const input = screen.getByTestId("campaign-name-input");
    for (const s of SHORTCUTS) press(s.key, {}, input);
    expect(tabpanel().dataset.tab).toBe("maps");
    expect(chip()).toBeNull();
    expect(screen.queryByTestId("shortcut-help")).toBeNull();

    // A note's textarea, open on the canvas.
    press("n");
    fireEvent.mouseDown(stageContent(), { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(stageContent(), { clientX: 100, clientY: 100 });
    const textarea = screen.getByTestId("note-text");
    expect(surface().dataset.noteOpen).not.toBe("");
    openTab("tokens");
    for (const s of SHORTCUTS) press(s.key, {}, textarea);
    expect(tabpanel().dataset.tab).toBe("tokens");
    expect(chip()).toBeNull();
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    expect(store.getState().shared.maps[0].annotations).toHaveLength(1);

    // Ctrl / Cmd / Alt + a shortcut key does nothing here either.
    press("b", { ctrlKey: true });
    press("b", { metaKey: true });
    press("b", { altKey: true });
    press("B", { shiftKey: true });
    expect(chip()).toBeNull();
  });

  it("tool keys need a map, like the buttons; tab keys and ? do not", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DmView
          store={createTableStore()}
          db={new TableMapDb(`tablemap-test-${nanoid()}`)}
          playerWindow={fakeController()}
          tabStorage={fakeStorage()}
        />
      </MemoryRouter>
    );
    press("b");
    press("g");
    press("n");
    press("w");
    press("d");
    expect(chip()).toBeNull();
    expect(tabpanel().dataset.tab).toBe("maps");
    press("2");
    expect(tabpanel().dataset.tab).toBe("fog");
    press("?");
    expect(screen.getByTestId("shortcut-help")).toBeTruthy();
  });
});

describe("DmView shortcut cheat sheet (T018)", () => {
  const rows = () =>
    Array.from(
      screen.getByTestId("shortcut-help").querySelectorAll("[data-testid=shortcut-row]")
    ).map((row) => ({
      key: row.getAttribute("data-key"),
      label: row.querySelector("[data-testid=shortcut-label]")?.textContent,
    }));

  it("? opens a modal listing every shortcut and gesture exactly as the table has them; ? again closes it", () => {
    renderWithMap();
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    press("?", { shiftKey: true });
    const sheet = screen.getByTestId("shortcut-help");
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(sheet);
    expect(rows()).toEqual(SHORTCUTS.map((s) => ({ key: s.key, label: s.label })));
    const gestures = Array.from(sheet.querySelectorAll("[data-testid=gesture-row]")).map((row) => ({
      gesture: row.getAttribute("data-gesture"),
      label: row.querySelector("[data-testid=gesture-label]")?.textContent,
    }));
    expect(gestures).toEqual(MOUSE_GESTURES.map((g) => ({ gesture: g.gesture, label: g.label })));
    expect(screen.getByTestId("shortcut-help-button").getAttribute("aria-pressed")).toBe("true");

    press("?", { shiftKey: true }, sheet);
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    expect(screen.getByTestId("shortcut-help-button").getAttribute("aria-pressed")).toBe("false");
  });

  it("the ? toolbar button and the Close button open and close it; a click on the backdrop closes it", () => {
    renderWithMap();
    fireEvent.click(screen.getByTestId("shortcut-help-button"));
    expect(screen.getByTestId("shortcut-help")).toBeTruthy();
    fireEvent.click(screen.getByTestId("shortcut-help-close"));
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    fireEvent.click(screen.getByTestId("shortcut-help-button"));
    fireEvent.mouseDown(screen.getByTestId("shortcut-help-backdrop"));
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    // A press inside the sheet is not a backdrop click.
    fireEvent.click(screen.getByTestId("shortcut-help-button"));
    fireEvent.mouseDown(screen.getByTestId("shortcut-help"));
    expect(screen.getByTestId("shortcut-help")).toBeTruthy();
  });

  it("Esc closes the sheet and only the sheet: an armed tool stays armed, and the next Esc stops it", () => {
    renderWithMap();
    press("b");
    expect(surface().dataset.fogging).toBe("reveal");
    press("?");
    const sheet = screen.getByTestId("shortcut-help");
    // Other shortcuts do nothing behind the open sheet.
    press("x", {}, sheet);
    press("3", {}, sheet);
    expect(surface().dataset.fogTool).toBe("brush");
    expect(tabpanel().dataset.tab).toBe("fog");

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    expect(surface().dataset.fogging).toBe("reveal");
    expect(chip()?.textContent).toContain("Fog · reveal brush");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(surface().dataset.fogging).toBe("false");
    expect(chip()).toBeNull();
  });
});

describe("DmView pan override (T018)", () => {
  /** A drag on the stage through screen points (identity viewport under jsdom). */
  function drag(points: [number, number][], button = 0) {
    const [first, ...rest] = points;
    fireEvent.mouseDown(stageContent(), { clientX: first[0], clientY: first[1], button });
    for (const [x, y] of rest) {
      fireEvent.mouseMove(stageContent(), { clientX: x, clientY: y, button });
    }
    const last = points[points.length - 1];
    fireEvent.mouseUp(stageContent(), { clientX: last[0], clientY: last[1], button });
  }
  const viewportX = () => Number(stage().dataset.viewportX);
  const viewportY = () => Number(stage().dataset.viewportY);

  it("with the brush armed, a Space-drag pans the canvas without painting, and brushing resumes on release", () => {
    const { store } = renderWithMap();
    press("b");
    expect(surface().dataset.fogging).toBe("reveal");
    expect(surface().dataset.panOverride).toBe("none");
    const x0 = viewportX();
    const y0 = viewportY();

    fireEvent.mouseEnter(surface());
    fireEvent.keyDown(document.body, { key: " " });
    expect(surface().dataset.panOverride).toBe("space");
    expect(surface().style.cursor).toBe("grab");
    expect(stage().dataset.tool).toBe("active");

    fireEvent.mouseDown(stageContent(), { clientX: 100, clientY: 100 });
    expect(stage().dataset.panning).toBe("true");
    expect(surface().dataset.fogGesture).toBe("idle");
    // The pan follows the pointer even off the stage.
    fireEvent.mouseMove(window, { clientX: 160, clientY: 140 });
    expect(viewportX()).toBeCloseTo(x0 + 60, 1);
    expect(viewportY()).toBeCloseTo(y0 + 40, 1);
    fireEvent.mouseMove(stageContent(), { clientX: 180, clientY: 130 });
    expect(viewportX()).toBeCloseTo(x0 + 80, 1);
    expect(viewportY()).toBeCloseTo(y0 + 30, 1);
    fireEvent.mouseUp(window, { clientX: 180, clientY: 130 });
    expect(stage().dataset.panning).toBe("false");
    expect(fogOps(store)).toHaveLength(0);

    fireEvent.keyUp(document.body, { key: " " });
    expect(surface().dataset.panOverride).toBe("none");
    expect(surface().style.cursor).toBe("crosshair");
    expect(surface().dataset.fogging).toBe("reveal");

    // Released: a normal drag paints again.
    drag([
      [120, 120],
      [200, 120],
    ]);
    expect(fogOps(store)).toHaveLength(1);
    expect(fogOps(store)[0]).toMatchObject({ type: "shape", mode: "reveal" });
  });

  it("a middle-button drag pans under any tool with no key held; the tool never sees it", () => {
    const { store } = renderWithMap();
    press("x");
    expect(surface().dataset.fogTool).toBe("rect");
    const x0 = viewportX();
    drag(
      [
        [50, 50],
        [90, 70],
      ],
      1
    );
    expect(viewportX()).toBeCloseTo(x0 + 40, 1);
    expect(fogOps(store)).toHaveLength(0);
    expect(surface().dataset.fogGesture).toBe("idle");
    expect(surface().dataset.fogging).toBe("reveal");

    // The pen too: a middle drag draws nothing.
    press("p");
    drag(
      [
        [50, 50],
        [90, 70],
      ],
      1
    );
    expect(store.getState().shared.maps[0].annotations).toHaveLength(0);
    expect(viewportX()).toBeCloseTo(x0 + 80, 1);

    // And a left drag still draws.
    drag([
      [50, 50],
      [90, 70],
    ]);
    expect(store.getState().shared.maps[0].annotations).toHaveLength(1);
  });

  it("Space is ignored inside text fields and released on window blur; its default is only stopped over the canvas", () => {
    renderWithMap();
    const input = screen.getByTestId("campaign-name-input");
    fireEvent.keyDown(input, { key: " " });
    expect(surface().dataset.panOverride).toBe("none");

    // Over the sidebar the key keeps its default (a focused button clicks).
    fireEvent.mouseLeave(surface());
    const outside = fireEvent.keyDown(document.body, { key: " " });
    expect(outside).toBe(true);
    expect(surface().dataset.panOverride).toBe("space");
    fireEvent.keyUp(document.body, { key: " " });

    fireEvent.mouseEnter(surface());
    const over = fireEvent.keyDown(document.body, { key: " " });
    expect(over).toBe(false);
    expect(surface().dataset.panOverride).toBe("space");
    fireEvent.blur(window);
    expect(surface().dataset.panOverride).toBe("none");
  });

  it("tokens and the player-view handle stand aside while Space is held", () => {
    renderWithMap();
    expect(surface().dataset.tokenTool).toBe("active");
    fireEvent.keyDown(document.body, { key: " " });
    expect(surface().dataset.tokenTool).toBe("none");
    expect(surface().dataset.playerDraggable).toBe("false");
    fireEvent.keyUp(document.body, { key: " " });
    expect(surface().dataset.tokenTool).toBe("active");
  });
});

describe("DmView vision (T106)", () => {
  const disc = { type: "disc" as const, color: "#f00" };

  /**
   * A 500 x 400 map: a walled room (50, 50)-(250, 250) whose right wall has a
   * closed door (y 125–175), two seeing tokens inside and a blind one
   * outside; the vision actions are injected over an `apply` the test watches.
   */
  function renderVision() {
    const map: MapScene = {
      ...createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 }),
      walls: [
        createWall({ id: "top", x1: 50, y1: 50, x2: 250, y2: 50 }),
        createWall({ id: "left", x1: 50, y1: 50, x2: 50, y2: 250 }),
        createWall({ id: "bottom", x1: 50, y1: 250, x2: 250, y2: 250 }),
        createWall({ id: "right-a", x1: 250, y1: 50, x2: 250, y2: 125 }),
        createDoor({ id: "door", x1: 250, y1: 125, x2: 250, y2: 175 }),
        createWall({ id: "right-b", x1: 250, y1: 175, x2: 250, y2: 250 }),
      ],
      tokens: [
        createToken({ id: "seer", x: 100, y: 100, appearance: disc, vision: 6 }),
        createToken({ id: "scout", x: 150, y: 150, appearance: disc, vision: 2 }),
        createToken({ id: "blind", x: 350, y: 300, appearance: disc }),
      ],
    };
    const store = createTableStore({ ...initialSharedState(), maps: [map], activeMapId: "a" });
    const apply = vi.fn((mapId: string, ...ops: FogOp[]) =>
      store.getState().dispatch(...ops.map((op): SharedOp => ({ kind: "map/fog-op", id: mapId, op })))
    );
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DmView
          store={store}
          db={db}
          playerWindow={fakeController()}
          tabStorage={fakeStorage()}
          visionActions={createVisionActions(store, { apply })}
        />
      </MemoryRouter>
    );
    return { store, apply, scene: () => store.getState().shared.maps[0] };
  }

  const tokenNode = (id: string) =>
    Konva.stages.find((s) => stage().contains(s.container()))!.findOne<Konva.Group>(`#token-${id}`)!;
  /** A drag as Konva delivers one (it cannot hit-test under jsdom): the start, then a move to (x, y). */
  const startDrag = (id: string, x: number, y: number) =>
    act(() => {
      const node = tokenNode(id);
      node.fire("dragstart", { evt: new MouseEvent("mousedown") });
      node.position({ x, y });
      node.fire("dragmove", { evt: new MouseEvent("mousemove") });
    });
  const dropToken = (id: string) =>
    act(() => {
      tokenNode(id).fire("dragend", { evt: new MouseEvent("mouseup") });
    });
  /** The reveal follows its trigger in a microtask. */
  const settle = () => act(async () => {});
  const nextFrame = () =>
    act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const undo = () => fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  const maxX = (op: FogOp) =>
    op.type === "shape" && op.shape.kind === "polygon"
      ? Math.max(...op.shape.points.filter((_, i) => i % 2 === 0))
      : NaN;

  it("a seeing token previews while dragged and, dropped, reveals the room through the injected actions in a dispatch of its own; Ctrl+Z undoes it", async () => {
    const { store, apply, scene } = renderVision();
    const seq = store.getState().seq;
    startDrag("seer", 160, 110); // lands on (150, 100)
    await nextFrame();
    expect(Number(surface().dataset.visionPreview)).toBeGreaterThanOrEqual(3);
    expect(store.getState().seq).toBe(seq);

    dropToken("seer");
    expect(surface().dataset.visionPreview).toBe("0");
    expect(scene().tokens[0]).toMatchObject({ x: 150, y: 100 });
    await settle();
    const op = visionRevealOp(scene(), scene().tokens[0])!;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("a", op);
    expect(scene().fogOps).toEqual([op]);
    expect(store.getState().seq).toBe(seq + 2); // the move, then the reveal
    expect(maxX(op)).toBeLessThanOrEqual(250 + 1e-6); // nothing beyond the closed door

    undo();
    expect(scene().fogOps).toEqual([]);
  });

  it("a blind token shows no preview and its drop reveals nothing; a vision typed into the token editor reveals at once", async () => {
    const { apply, scene } = renderVision();
    startDrag("blind", 410, 310);
    await nextFrame();
    expect(surface().dataset.visionPreview).toBe("0");
    dropToken("blind");
    await settle();
    expect(scene().tokens[2]).toMatchObject({ x: 400, y: 300 });
    expect(apply).not.toHaveBeenCalled();
    expect(scene().fogOps).toEqual([]);

    openTab("tokens");
    expect(screen.getByTestId("token-editor").dataset.tokenId).toBe("blind"); // the drag selected it
    fireEvent.change(screen.getByTestId("token-vision"), { target: { value: "4" } });
    await settle();
    expect(scene().tokens[2].vision).toBe(4);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(scene().fogOps).toEqual([visionRevealOp(scene(), scene().tokens[2])]);
  });

  it("a door toggle reveals for both seeing tokens in one dispatch and one undo step; closing the door hides nothing", async () => {
    const { store, apply, scene } = renderVision();
    openTab("walls");
    const seq = store.getState().seq;
    fireEvent.click(screen.getByTestId("door-toggle"));
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]).toHaveLength(3); // the map, then one op per seeing token
    expect(store.getState().seq).toBe(seq + 2); // the toggle, then one reveal
    expect(scene().fogOps).toHaveLength(2);
    expect(maxX(scene().fogOps[0])).toBeGreaterThan(250); // through the open door

    fireEvent.click(screen.getByTestId("door-toggle"));
    await settle();
    expect(scene().fogOps).toHaveLength(4);
    expect(scene().fogOps.every((op) => op.mode === "reveal")).toBe(true);

    undo();
    expect(scene().fogOps).toHaveLength(2);
    undo();
    expect(scene().fogOps).toHaveLength(0);
  });
});

describe("DmView room fill (T108)", () => {
  /**
   * A 500 x 400 map with two rooms side by side — A over cells (1..3, 1..3),
   * B over (4..6, 1..3) — sharing a wall at x = 200 with a closed door across
   * row 2 (y 100–150). The fog actions are the real ones, spied on.
   */
  const twoRooms = (): MapScene => ({
    ...createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 }),
    walls: [
      createWall({ id: "top", x1: 50, y1: 50, x2: 350, y2: 50 }),
      createWall({ id: "right", x1: 350, y1: 50, x2: 350, y2: 200 }),
      createWall({ id: "bottom", x1: 350, y1: 200, x2: 50, y2: 200 }),
      createWall({ id: "left", x1: 50, y1: 200, x2: 50, y2: 50 }),
      createWall({ id: "mid-top", x1: 200, y1: 50, x2: 200, y2: 100 }),
      createDoor({ id: "door", x1: 200, y1: 100, x2: 200, y2: 150 }),
      createWall({ id: "mid-bottom", x1: 200, y1: 150, x2: 200, y2: 200 }),
    ],
  });

  function renderFill(map: MapScene = twoRooms()) {
    const store = createTableStore({ ...initialSharedState(), maps: [map], activeMapId: map.id });
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    const fogActions = createFogActions(store, db, {
      bake: async () => new Blob(["png"], { type: "image/png" }),
    });
    const reveal = vi.spyOn(fogActions, "reveal");
    const hide = vi.spyOn(fogActions, "hide");
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DmView
          store={store}
          db={db}
          playerWindow={fakeController()}
          tabStorage={fakeStorage()}
          fogActions={fogActions}
        />
      </MemoryRouter>
    );
    return { store, reveal, hide, scene: () => store.getState().shared.maps[0] };
  }

  /** A click on the map (zero-size container: screen px = map px). */
  const click = (x: number, y: number) => {
    fireEvent.mouseDown(stageContent(), { clientX: x, clientY: y });
    fireEvent.mouseUp(stageContent(), { clientX: x, clientY: y });
  };
  const rects = (...r: number[]) => ({ kind: "rects", rects: r });
  const ROOM_A = rects(50, 50, 150, 50, 50, 100, 150, 50, 50, 150, 150, 50);
  const ROOM_B = rects(200, 50, 150, 50, 200, 100, 150, 50, 200, 150, 150, 50);

  it("F arms the fill; a click in a room is one unfeathered rects op through the injected fog actions — one seq, one undo step — and H hides the same way", () => {
    const { store, reveal, hide, scene } = renderFill();
    press("f");
    expect(tabpanel().dataset.tab).toBe("fog");
    expect(surface().dataset.fogTool).toBe("fill");
    expect(chip()?.textContent).toContain("Fog · reveal fill");
    expect(screen.getByTestId("tool-status-key").textContent).toBe("F");

    const seq = store.getState().seq;
    click(75, 175);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith("a", ROOM_A, undefined);
    expect(hide).not.toHaveBeenCalled();
    expect(scene().fogOps).toEqual([{ type: "shape", mode: "reveal", shape: ROOM_A }]);
    expect(store.getState().seq).toBe(seq + 1);

    // One undo step; redo puts the same rects back.
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(scene().fogOps).toEqual([]);
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(scene().fogOps).toEqual([{ type: "shape", mode: "reveal", shape: ROOM_A }]);

    press("h");
    expect(chip()?.textContent).toContain("Fog · hide fill");
    click(325, 75);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledWith("a", ROOM_B, undefined);
    expect(scene().fogOps).toEqual([
      { type: "shape", mode: "reveal", shape: ROOM_A },
      { type: "shape", mode: "hide", shape: ROOM_B },
    ]);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("with the fill armed a click on the door opens it and fills nothing; the next fill reaches both rooms and stops at the outer walls", () => {
    const { reveal, hide, scene } = renderFill();
    press("f");
    fireEvent.mouseMove(stageContent(), { clientX: 75, clientY: 125 });
    expect(surface().dataset.fillPreview).toBe("room");

    // The door clicked as Konva delivers it (no hit-testing under jsdom): press, release and click on its node.
    const konvaStage = Konva.stages.find((s) => stage().contains(s.container()))!;
    const door = konvaStage.findOne<Konva.Line>("#wall-door")!;
    act(() => {
      for (const type of ["mousedown", "mouseup", "click"]) {
        door.fire(type, { evt: new MouseEvent(type, { clientX: 200, clientY: 125 }) }, true);
      }
    });
    expect(scene().walls.find((w) => w.id === "door")).toMatchObject({ kind: "door", open: true });
    expect(reveal).not.toHaveBeenCalled();
    expect(scene().fogOps).toEqual([]);
    expect(surface().dataset.fogTool).toBe("fill");

    click(75, 125);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith("a", rects(50, 50, 300, 50, 50, 100, 300, 50, 50, 150, 300, 50), undefined);
    expect(hide).not.toHaveBeenCalled();
    expect(scene().fogOps).toHaveLength(1);
  });

  it("an oversized fill calls no fog action and warns in the Fog panel", () => {
    // 22 500 cells of 2 px and no walls: over the limit wherever it is clicked.
    const { reveal, hide, scene } = renderFill(
      createBlankMapScene({ id: "big", name: "Big", columns: 150, rows: 150, cellSize: 2 })
    );
    press("f");
    click(150, 150);
    expect(reveal).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    expect(scene().fogOps).toEqual([]);
    expect(screen.getByTestId("fog-fill-warning").textContent).toBe(FILL_TOO_LARGE_MESSAGE);
  });
});
