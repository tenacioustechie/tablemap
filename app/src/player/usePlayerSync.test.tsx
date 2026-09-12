import { act, render, screen, waitFor } from "@testing-library/react";
import { lockedScale, type DisplayInfo } from "../state/calibration";
import { startDmSync, type AssetSource } from "../state/dmSync";
import { createBlankMapScene, createImageMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { decodeMessage } from "../state/sync";
import { createMemoryHub } from "../state/transport";
import { PlayerView } from "./PlayerView";
import { DISPLAY_POLL_MS } from "./usePlayerSync";

const view = () => screen.getByTestId("player-view");
const tv: DisplayInfo = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };
const laptop: DisplayInfo = { width: 1440, height: 900, pixelRatio: 2, left: 0, top: 25 };

describe("PlayerView + sync", () => {
  it("starts connecting, then mirrors the DM snapshot and deltas", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), campaignName: "Strahd" });
    startDmSync(dm, hub.connect());

    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(view().dataset.syncStatus).toBe("synced");
    expect(view().dataset.syncSeq).toBe("0");
    expect(screen.getByTestId("player-campaign-name").textContent).toBe(
      "Strahd"
    );

    act(() => {
      dm.getState().dispatch({ kind: "campaign/set-name", name: "Tomb" });
    });
    expect(view().dataset.syncSeq).toBe("1");
    expect(screen.getByTestId("player-campaign-name").textContent).toBe("Tomb");

    act(() => {
      dm.getState().dispatch({ kind: "campaign/set-name", name: "" });
    });
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
  });

  it("shows nothing and reports connecting while no DM is present", () => {
    const hub = createMemoryHub();
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(view().dataset.syncStatus).toBe("connecting");
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
    expect(view().children).toHaveLength(0);
  });

  it("only sends hello messages", () => {
    const hub = createMemoryHub();
    render(<PlayerView createTransport={() => hub.connect()} />);
    const dm = createTableStore();
    act(() => {
      startDmSync(dm, hub.connect());
      dm.getState().dispatch({ kind: "campaign/set-name", name: "x" });
    });
    const fromPlayer = hub.log.filter((e) => e.from === 0);
    expect(fromPlayer.length).toBeGreaterThan(0);
    for (const e of fromPlayer) {
      const r = decodeMessage(e.raw);
      expect(r.ok && r.message.type).toBe("hello");
    }
  });

  it("stays chrome-free with a campaign name shown", () => {
    const hub = createMemoryHub();
    startDmSync(createTableStore({ ...initialSharedState(), campaignName: "Title" }), hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders the active map on a stage instead of the idle title", () => {
    const hub = createMemoryHub();
    const blank = createBlankMapScene({ id: "b", name: "Arena", columns: 2, rows: 2 });
    const dm = createTableStore({
      ...initialSharedState(),
      campaignName: "Strahd",
      maps: [blank],
      activeMapId: null,
    });
    startDmSync(dm, hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(screen.getByTestId("player-campaign-name")).toBeTruthy();
    expect(view().dataset.activeMapId).toBe("");

    act(() => {
      dm.getState().dispatch({ kind: "map/set-active", id: "b" });
    });
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
    expect(view().dataset.activeMapId).toBe("b");
    const stage = screen.getByTestId("player-map-stage");
    expect(stage.dataset.mapId).toBe("b");
    expect(stage.dataset.mapName).toBe("Arena");
    expect(stage.dataset.imageStatus).toBe("none");
    expect(screen.queryByRole("button")).toBeNull();

    act(() => {
      dm.getState().dispatch({ kind: "map/set-active", id: null });
    });
    expect(screen.queryByTestId("player-map-stage")).toBeNull();
    expect(screen.getByTestId("player-campaign-name")).toBeTruthy();
  });

  it("waits for the map image asset, then loads it once the DM pushes it", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
      const hub = createMemoryHub();
      const scene = createImageMapScene({
        id: "m",
        name: "Crypt",
        imageAssetId: "img",
        width: 10,
        height: 10,
      });
      const dm = createTableStore({
        ...initialSharedState(),
        maps: [scene],
        activeMapId: "m",
      });
      const blob = new Blob(["png"], { type: "image/png" });
      const assets: AssetSource = async (id) =>
        id === "img" ? { kind: "map-image", blob } : undefined;

      const { unmount } = render(<PlayerView createTransport={() => hub.connect()} />);
      await act(async () => {
        startDmSync(dm, hub.connect(), { assets });
      });
      const stage = () => screen.getByTestId("player-map-stage");
      expect(stage().dataset.mapId).toBe("m");
      await waitFor(() => expect(stage().dataset.imageStatus).toBe("loading"));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
      unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    } finally {
      Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
    }
  });

  it("disconnects on unmount", () => {
    const hub = createMemoryHub();
    const { unmount } = render(
      <PlayerView createTransport={() => hub.connect()} />
    );
    unmount();
    const before = hub.log.length;
    startDmSync(createTableStore(), hub.connect());
    // The unmounted player must not have answered or re-requested anything.
    expect(hub.log.slice(before).every((e) => e.from !== 0)).toBe(true);
  });
});

describe("PlayerView calibration (T006)", () => {
  const calibration = { pxPerInch: 40, method: "square" as const, updatedAt: 1 };
  /** Two maps of the same size with very different cell sizes. */
  const fine = createBlankMapScene({ id: "fine", name: "Fine", columns: 20, rows: 10, cellSize: 20 });
  const coarse = createBlankMapScene({ id: "coarse", name: "Coarse", columns: 4, rows: 2, cellSize: 100 });
  const stage = () => screen.getByTestId("player-map-stage");

  function setup(activeMapId: string | null = "fine") {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), maps: [fine, coarse], activeMapId });
    startDmSync(dm, hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} readDisplay={() => tv} />);
    return { hub, dm };
  }

  it("reports its display in the hello and starts uncalibrated (fit to window)", () => {
    const { hub, dm } = setup();
    const hellos = hub.log
      .filter((e) => e.from === 1)
      .map((e) => decodeMessage(e.raw))
      .map((r) => (r.ok ? r.message : null));
    expect(hellos).toEqual([expect.objectContaining({ type: "hello", display: tv })]);
    expect(dm.getState().presentation.playerDisplay).toEqual(tv);
    expect(view().dataset.viewMode).toBe("uncalibrated");
    // jsdom containers are 0×0, so "fit" degenerates to scale 1.
    expect(stage().dataset.scale).toBe("1.0000");
  });

  it("locks the stage scale so a cell is pxPerInch * cellInches px whatever the map's cell size", () => {
    const { dm } = setup();
    act(() => dm.getState().setPresentation({ calibration }));
    expect(view().dataset.viewMode).toBe("calibrated");
    expect(Number(stage().dataset.scale)).toBeCloseTo(lockedScale(40, "inch", 20), 4);
    expect(20 * Number(stage().dataset.scale)).toBeCloseTo(40, 2);

    act(() => dm.getState().dispatch({ kind: "map/set-active", id: "coarse" }));
    expect(Number(stage().dataset.scale)).toBeCloseTo(lockedScale(40, "inch", 100), 4);
    expect(100 * Number(stage().dataset.scale)).toBeCloseTo(40, 2);

    act(() => dm.getState().setPresentation({ cellUnit: "mm25" }));
    expect(100 * Number(stage().dataset.scale)).toBeCloseTo(40 * (25 / 25.4), 2);
  });

  it("overview un-locks the scale and shows a visible not-to-scale badge", () => {
    const { dm } = setup();
    act(() => dm.getState().setPresentation({ calibration }));
    expect(screen.queryByTestId("player-overview-badge")).toBeNull();
    act(() => dm.getState().setPresentation({ overview: true }));
    expect(view().dataset.viewMode).toBe("overview");
    expect(stage().dataset.scale).toBe("1.0000");
    expect(screen.getByTestId("player-overview-badge").textContent).toMatch(/not to scale/i);
    expect(screen.queryByRole("button")).toBeNull();
    act(() => dm.getState().setPresentation({ overview: false }));
    expect(view().dataset.viewMode).toBe("calibrated");
    expect(screen.queryByTestId("player-overview-badge")).toBeNull();
  });

  it("shows the ruler screen with a square of exactly the requested CSS pixels, then the map again", () => {
    const { dm } = setup();
    act(() => dm.getState().setPresentation({ target: 96.5, cellUnit: "mm25" }));
    expect(view().dataset.viewMode).toBe("calibrating");
    expect(screen.queryByTestId("player-map-stage")).toBeNull();
    const target = screen.getByTestId("calibration-target");
    expect(target.style.width).toBe("96.5px");
    expect(target.style.height).toBe("96.5px");
    expect(screen.getByTestId("calibration-screen").textContent).toMatch(/25 mm/);
    expect(screen.queryByRole("button")).toBeNull();

    act(() => dm.getState().setPresentation({ target: null }));
    expect(screen.queryByTestId("calibration-target")).toBeNull();
    expect(stage().dataset.mapId).toBe("fine");
  });

  it("shows the ruler screen even with no active map", () => {
    const { dm } = setup(null);
    act(() => dm.getState().setPresentation({ target: 50 }));
    expect(screen.getByTestId("calibration-target").style.width).toBe("50px");
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
  });

  it("re-announces with the new display when the window moves to another screen", () => {
    vi.useFakeTimers();
    try {
      const hub = createMemoryHub();
      const dm = createTableStore();
      startDmSync(dm, hub.connect());
      let display = laptop;
      render(<PlayerView createTransport={() => hub.connect()} readDisplay={() => display} />);
      expect(dm.getState().presentation.playerDisplay).toEqual(laptop);
      const hellosFromPlayer = () => hub.log.filter((e) => e.from === 1).length;
      expect(hellosFromPlayer()).toBe(1);

      act(() => {
        vi.advanceTimersByTime(DISPLAY_POLL_MS * 2);
      });
      expect(hellosFromPlayer()).toBe(1); // same screen: quiet

      display = tv;
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(hellosFromPlayer()).toBe(2);
      expect(dm.getState().presentation.playerDisplay).toEqual(tv);

      display = laptop;
      act(() => {
        vi.advanceTimersByTime(DISPLAY_POLL_MS);
      });
      expect(hellosFromPlayer()).toBe(3);
      expect(dm.getState().presentation.playerDisplay).toEqual(laptop);
    } finally {
      vi.useRealTimers();
    }
  });
});
