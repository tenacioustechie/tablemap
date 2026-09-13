import { act, fireEvent, render, screen } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { openTab } from "../test/dmTabs";
import { DmView } from "./DmView";
import { FOG_BRUSH_RADIUS } from "./fogTool";
import type { FullscreenResult, PlayerWindowController } from "./playerWindow";
import { MOUSE_GESTURES, SHORTCUTS } from "./shortcuts";
import { DM_TABS, TAB_STORAGE_KEY, type TabStorage } from "./SidebarTabs";

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

    openTab("table");
    expect(screen.getByTestId("calibration-status")).toBeTruthy();
    expect(screen.getByTestId("player-viewport-info")).toBeTruthy();
    expect(screen.getByTestId("splash-thumb")).toBeTruthy();
    expect(screen.queryByTestId("annotation-panel")).toBeNull();
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
