import {
  createPlayerWindowController,
  PLAYER_WINDOW_FEATURES,
  PLAYER_WINDOW_NAME,
  resolvePlayerUrl,
  type PlayerWindowDeps,
} from "./playerWindow";

interface FakeWindow {
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  document: {
    fullscreenElement: Element | null;
    exitFullscreen: ReturnType<typeof vi.fn>;
    documentElement: { requestFullscreen: ReturnType<typeof vi.fn> };
  };
}

function fakeWindow(): FakeWindow {
  const win: FakeWindow = {
    closed: false,
    close: vi.fn(() => {
      win.closed = true;
    }),
    focus: vi.fn(),
    document: {
      fullscreenElement: null,
      exitFullscreen: vi.fn(async () => {
        win.document.fullscreenElement = null;
      }),
      documentElement: {
        requestFullscreen: vi.fn(async () => {
          win.document.fullscreenElement = {} as Element;
        }),
      },
    },
  };
  return win;
}

function setup(win: FakeWindow | null = fakeWindow()) {
  const deps: PlayerWindowDeps = {
    openWindow: vi.fn(() => win as unknown as Window | null),
    playerUrl: () => "http://localhost/#/player",
  };
  return { win, deps, ctl: createPlayerWindowController(deps) };
}

describe("resolvePlayerUrl", () => {
  it("replaces the hash of the current document URL", () => {
    expect(resolvePlayerUrl("http://localhost:5173/#/dm")).toBe(
      "http://localhost:5173/#/player"
    );
  });

  it("keeps a sub-path when served from a folder", () => {
    expect(resolvePlayerUrl("https://x.test/tablemap/index.html#/")).toBe(
      "https://x.test/tablemap/index.html#/player"
    );
  });
});

describe("createPlayerWindowController", () => {
  it("starts closed", () => {
    const { ctl } = setup();
    expect(ctl.isOpen()).toBe(false);
    expect(ctl.isFullscreen()).toBe(false);
    expect(ctl.getHandle()).toBeNull();
  });

  it("opens the player route in a named popup and keeps the handle", () => {
    const { ctl, deps, win } = setup();
    const handle = ctl.open();
    expect(deps.openWindow).toHaveBeenCalledWith(
      "http://localhost/#/player",
      PLAYER_WINDOW_NAME,
      PLAYER_WINDOW_FEATURES
    );
    expect(handle).toBe(win);
    expect(ctl.isOpen()).toBe(true);
    expect(ctl.getHandle()).toBe(win);
  });

  it("focuses instead of re-opening when already open", () => {
    const { ctl, deps, win } = setup();
    ctl.open();
    ctl.open();
    expect(deps.openWindow).toHaveBeenCalledTimes(1);
    expect(win!.focus).toHaveBeenCalledTimes(1);
  });

  it("re-opens after the user closed the window themselves", () => {
    const { ctl, deps, win } = setup();
    ctl.open();
    win!.closed = true;
    expect(ctl.isOpen()).toBe(false);
    ctl.open();
    expect(deps.openWindow).toHaveBeenCalledTimes(2);
  });

  it("close() closes the window and drops the handle", () => {
    const { ctl, win } = setup();
    ctl.open();
    ctl.close();
    expect(win!.close).toHaveBeenCalledTimes(1);
    expect(ctl.isOpen()).toBe(false);
    expect(ctl.getHandle()).toBeNull();
  });

  it("close() is a no-op when nothing is open", () => {
    const { ctl } = setup();
    expect(() => ctl.close()).not.toThrow();
  });

  it("tolerates a blocked popup (window.open returned null)", () => {
    const { ctl } = setup(null);
    expect(ctl.open()).toBeNull();
    expect(ctl.isOpen()).toBe(false);
  });

  it("toggleFullscreen reports not-open without a window", async () => {
    const { ctl } = setup();
    await expect(ctl.toggleFullscreen()).resolves.toBe("not-open");
  });

  it("toggleFullscreen enters then exits fullscreen on the player document", async () => {
    const { ctl, win } = setup();
    ctl.open();
    await expect(ctl.toggleFullscreen()).resolves.toBe("entered");
    expect(win!.document.documentElement.requestFullscreen).toHaveBeenCalled();
    expect(ctl.isFullscreen()).toBe(true);
    await expect(ctl.toggleFullscreen()).resolves.toBe("exited");
    expect(win!.document.exitFullscreen).toHaveBeenCalled();
    expect(ctl.isFullscreen()).toBe(false);
  });

  it("toggleFullscreen reports denied when the browser rejects the request", async () => {
    const { ctl, win } = setup();
    win!.document.documentElement.requestFullscreen.mockRejectedValueOnce(
      new TypeError("Permissions check failed")
    );
    ctl.open();
    await expect(ctl.toggleFullscreen()).resolves.toBe("denied");
    expect(ctl.isFullscreen()).toBe(false);
  });
});
