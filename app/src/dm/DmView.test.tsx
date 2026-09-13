import { act, fireEvent, render, screen } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { openTab } from "../test/dmTabs";
import { DmView } from "./DmView";
import type { FullscreenResult, PlayerWindowController } from "./playerWindow";
import { TAB_STORAGE_KEY, type TabStorage } from "./SidebarTabs";

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
