import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DmView } from "./DmView";
import type { FullscreenResult, PlayerWindowController } from "./playerWindow";

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
