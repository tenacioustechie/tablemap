import { act, render, screen, waitFor } from "@testing-library/react";
import { nanoid } from "nanoid";
import { createAnnotationActions } from "../state/annotationActions";
import { lockedScale, type DisplayInfo } from "../state/calibration";
import { startDmSync, type AssetSource } from "../state/dmSync";
import { createBlankMapScene, createImageMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createToken } from "../state/tokens";
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

  it("never holds or draws a note or a DM-only drawing; shared drawings are drawn; pings play and expire (T011)", () => {
    const { hub, dm } = setup();
    const actions = createAnnotationActions(dm, { newId: () => nanoid() });
    act(() => {
      actions.addNote("fine", { x: 10, y: 10 }, "SECRET-DOOR");
      actions.addDrawing("fine", { points: [0, 0, 5, 5], color: "#f00", strokeWidth: 2, visibility: "dm" });
    });
    expect(stage().dataset.annotations).toBe("0");
    expect(stage().dataset.annotationsShown).toBe("0");
    expect(document.body.innerHTML).not.toContain("SECRET-DOOR");
    expect(hub.log.map((e) => e.raw).join("")).not.toContain("SECRET-DOOR");

    act(() => {
      actions.addDrawing("fine", { points: [0, 0, 5, 5], color: "#0f0", strokeWidth: 2, visibility: "all" });
    });
    expect(stage().dataset.annotations).toBe("1");
    expect(stage().dataset.annotationsShown).toBe("1");

    act(() => {
      actions.ping("fine", { x: 3, y: 4 });
    });
    expect(stage().dataset.pings).toBe("1");
    act(() => {
      actions.ping("coarse", { x: 3, y: 4 }); // another map: not drawn here
    });
    expect(stage().dataset.pings).toBe("1");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("re-announces with the new display when the window moves to another screen (T006)", () => {
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

describe("PlayerView viewport, rotation, blackout and splash (T009)", () => {
  const calibration = { pxPerInch: 100, method: "square" as const, updatedAt: 1 };
  /** 500 x 400 map px, 50 px cells: calibrated scale 2. */
  const arena = createBlankMapScene({ id: "arena", name: "Arena", columns: 10, rows: 8, cellSize: 50 });
  const stage = () => screen.getByTestId("player-map-stage");

  function setup(activeMapId: string | null = "arena", assets?: AssetSource) {
    const hub = createMemoryHub();
    const dm = createTableStore({
      ...initialSharedState(),
      campaignName: "Curse of Strahd",
      maps: [arena],
      activeMapId,
    });
    startDmSync(dm, hub.connect(), { assets });
    render(<PlayerView createTransport={() => hub.connect()} readDisplay={() => tv} />);
    return { hub, dm };
  }

  it("pans to the DM's centre while calibrated, and reports it", () => {
    const { dm } = setup();
    expect(view().dataset.viewCenter).toBe("250,200"); // the map's centre
    // Uncalibrated: the whole map fits, so a centre is ignored.
    act(() => dm.getState().setPresentation({ center: { x: 100, y: 50 } }));
    expect(view().dataset.viewCenter).toBe("250,200");

    act(() => dm.getState().setPresentation({ calibration }));
    expect(view().dataset.viewCenter).toBe("100,50");
    expect(stage().dataset.scale).toBe("2.0000");
    // jsdom container is 0x0: the transform puts the centre at (0, 0).
    expect(stage().dataset.viewportX).toBe("-200.00");
    expect(stage().dataset.viewportY).toBe("-100.00");

    // Clamped onto the map; null recentres.
    act(() => dm.getState().setPresentation({ center: { x: -50, y: 9000 } }));
    expect(view().dataset.viewCenter).toBe("0,400");
    act(() => dm.getState().setPresentation({ center: null }));
    expect(view().dataset.viewCenter).toBe("250,200");
  });

  it("rotates the stage in quarter turns without changing the locked scale", () => {
    const { dm } = setup();
    act(() => dm.getState().setPresentation({ calibration, center: { x: 100, y: 50 } }));
    expect(view().dataset.rotation).toBe("0");
    expect(stage().dataset.rotation).toBe("0");

    act(() => dm.getState().setPresentation({ rotation: 90 }));
    expect(view().dataset.rotation).toBe("90");
    expect(stage().dataset.rotation).toBe("90");
    expect(stage().dataset.scale).toBe("2.0000");
    expect(view().dataset.viewMode).toBe("calibrated");
    // rotate90((100, 50) * 2) = (-100, 200); the display centre is (0, 0).
    expect(stage().dataset.viewportX).toBe("100.00");
    expect(stage().dataset.viewportY).toBe("-200.00");

    act(() => dm.getState().setPresentation({ rotation: 180 }));
    expect(stage().dataset.viewportX).toBe("200.00");
    expect(stage().dataset.viewportY).toBe("100.00");
    expect(stage().dataset.scale).toBe("2.0000");

    // The idle title turns with the view too.
    act(() => dm.getState().dispatch({ kind: "map/set-active", id: null }));
    const title = screen.getByTestId("player-campaign-name");
    expect(title.parentElement?.dataset.rotation).toBe("180");
    expect(title.parentElement?.style.transform).toBe("rotate(180deg)");
  });

  it("blackout covers everything with an opaque black layer, at once, and lifts again", () => {
    const { dm } = setup();
    expect(screen.queryByTestId("player-blackout")).toBeNull();
    expect(view().dataset.blackout).toBe("false");

    act(() => dm.getState().setPresentation({ blackout: true, splash: true, target: 96 }));
    const blackout = screen.getByTestId("player-blackout");
    expect(view().dataset.blackout).toBe("true");
    expect(blackout.style.background).toBe("rgb(0, 0, 0)");
    expect(blackout.style.opacity).toBe("1");
    expect(blackout.style.inset).toBe("0");
    // It is the topmost child: after the ruler screen and the splash.
    expect(view().lastElementChild).toBe(blackout);
    expect(screen.getByTestId("calibration-screen")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    act(() => dm.getState().setPresentation({ blackout: false, splash: false, target: null }));
    expect(screen.queryByTestId("player-blackout")).toBeNull();
    expect(view().dataset.blackout).toBe("false");
    expect(stage().dataset.mapId).toBe("arena");
  });

  it("splash shows the default artwork over the scene (also with no map), turned with the view (T015)", () => {
    const { dm } = setup();
    expect(screen.queryByTestId("player-splash")).toBeNull();
    act(() => dm.getState().setPresentation({ splash: true, rotation: 270 }));
    const splash = screen.getByTestId("player-splash");
    expect(view().dataset.splash).toBe("true");
    expect(splash.dataset.splashKind).toBe("default");
    // The artwork is a bundled static asset loaded by URL, never an asset message.
    const artwork = screen.getByTestId("player-splash-image") as HTMLImageElement;
    expect(artwork.getAttribute("src")).toMatch(/splash-default[^/]*\.png$/);
    expect(artwork.getAttribute("src")).not.toMatch(/^blob:/);
    expect(artwork.style.objectFit).toBe("contain");
    expect(artwork.parentElement?.dataset.rotation).toBe("270");
    expect(screen.queryByTestId("player-splash-title")).toBeNull();
    expect(splash.style.background).toBe("rgb(0, 0, 0)");
    // The scene stays mounted underneath, fog mask and all.
    expect(stage().dataset.mapId).toBe("arena");
    expect(splash.compareDocumentPosition(stage()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    act(() => dm.getState().dispatch({ kind: "map/set-active", id: null }));
    expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("default");
    // The idle screen underneath still shows the campaign title.
    expect(screen.getByTestId("player-campaign-name").textContent).toBe("Curse of Strahd");

    // The ruler screen hides it (the DM wants to see the square).
    act(() => dm.getState().setPresentation({ target: 50 }));
    expect(screen.queryByTestId("player-splash")).toBeNull();
    act(() => dm.getState().setPresentation({ target: null, splash: false }));
    expect(screen.queryByTestId("player-splash")).toBeNull();
    expect(view().dataset.splash).toBe("false");
  });

  it("splash shows the campaign title when the DM chose the title card, turned with the view", () => {
    const { dm } = setup();
    act(() => {
      dm.getState().dispatch({ kind: "campaign/set-splash-title-card", on: true });
      dm.getState().setPresentation({ splash: true, rotation: 270 });
    });
    const splash = screen.getByTestId("player-splash");
    expect(splash.dataset.splashKind).toBe("title");
    expect(screen.getByTestId("player-splash-title").textContent).toBe("Curse of Strahd");
    expect(screen.getByTestId("player-splash-title").parentElement?.dataset.rotation).toBe("270");
    expect(screen.queryByTestId("player-splash-image")).toBeNull();

    act(() => dm.getState().dispatch({ kind: "campaign/set-name", name: "Tomb" }));
    expect(screen.getByTestId("player-splash-title").textContent).toBe("Tomb");
    act(() => dm.getState().dispatch({ kind: "map/set-active", id: null }));
    expect(screen.getByTestId("player-splash-title").textContent).toBe("Tomb");

    // Back to the artwork when the DM picks the default again.
    act(() => dm.getState().dispatch({ kind: "campaign/set-splash-title-card", on: false }));
    expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("default");
    expect(screen.queryByTestId("player-splash-title")).toBeNull();
  });

  it("splash shows the campaign's image once the DM has pushed it, and returns to the chosen source when cleared", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:splash");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const RealImage = globalThis.Image;
    // jsdom never loads images: an Image whose `src` setter reports success.
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private url = "";
      get src() {
        return this.url;
      }
      set src(value: string) {
        this.url = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
    try {
      const blob = new Blob(["png"], { type: "image/png" });
      const assets: AssetSource = async (id) =>
        id === "cover" ? { kind: "splash-image", blob } : undefined;
      const { dm } = setup(null, assets);
      act(() => dm.getState().setPresentation({ splash: true }));
      expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("default");

      await act(async () => {
        dm.getState().dispatch({ kind: "campaign/set-splash-image", assetId: "cover" });
      });
      await waitFor(() => expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("image"));
      const img = screen.getByTestId("player-splash-image") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("blob:splash");
      expect(img.style.objectFit).toBe("contain");
      expect(screen.queryByTestId("player-splash-title")).toBeNull();

      // The chosen image wins over the title-card choice.
      act(() => dm.getState().dispatch({ kind: "campaign/set-splash-title-card", on: true }));
      expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("image");

      // Cleared: back to whichever source is chosen — the title card now...
      await act(async () => {
        dm.getState().dispatch({ kind: "campaign/set-splash-image", assetId: null });
      });
      expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("title");
      expect(screen.getByTestId("player-splash-title").textContent).toBe("Curse of Strahd");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:splash");

      // ...and the artwork once the default is chosen again.
      act(() => dm.getState().dispatch({ kind: "campaign/set-splash-title-card", on: false }));
      expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("default");
      expect(screen.getByTestId("player-splash-image").getAttribute("src")).toMatch(/splash-default/);
    } finally {
      globalThis.Image = RealImage;
      Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
    }
  });

  it("splash shows the title as the placeholder while a chosen image has not arrived, whatever the source choice", () => {
    // No asset source: the DM never pushes the image, so the player keeps waiting.
    const { dm } = setup(null);
    act(() => {
      dm.getState().setPresentation({ splash: true });
      dm.getState().dispatch({ kind: "campaign/set-splash-image", assetId: "missing" });
    });
    expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("title");
    expect(screen.getByTestId("player-splash-title").textContent).toBe("Curse of Strahd");
    act(() => dm.getState().dispatch({ kind: "campaign/set-splash-title-card", on: true }));
    expect(screen.getByTestId("player-splash").dataset.splashKind).toBe("title");
  });
});

describe("PlayerView tokens (T010)", () => {
  const stage = () => screen.getByTestId("player-map-stage");
  const orc = createToken({ id: "orc", x: 20, y: 20, appearance: { type: "disc", color: "#f00" }, badge: "O" });

  it("draws only tokens the players may see: not hidden ones, none while the fog base is still on its way", () => {
    const hub = createMemoryHub();
    // A map whose fog base PNG the player does not have: fully fogged (waiting).
    const arena = { ...createBlankMapScene({ id: "m", columns: 4, rows: 4, cellSize: 20 }), fogMaskAssetId: "mask" };
    const dm = createTableStore({ ...initialSharedState(), maps: [arena], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    act(() => {
      dm.getState().dispatch({ kind: "map/token-add", id: "m", token: orc });
      dm.getState().dispatch({ kind: "map/token-add", id: "m", token: { ...orc, id: "ghost", hidden: true } });
    });
    expect(stage().dataset.fogStatus).toBe("waiting");
    expect(stage().dataset.tokens).toBe("2");
    expect(stage().dataset.tokensShown).toBe("0");
    expect(stage().dataset.tokensFogged).toBe("1");
    expect(stage().dataset.tokensHidden).toBe("1");

    // Back to a base-less map: under jsdom's blank canvas every pixel reads
    // as revealed, so the hidden flag is what keeps the ghost off the screen.
    act(() => {
      dm.getState().dispatch({ kind: "map/fog-compact", id: "m", baseAssetId: null, opCount: 0 });
    });
    expect(stage().dataset.fogStatus).toBe("ready");
    expect(stage().dataset.tokensShown).toBe("1");
    expect(stage().dataset.tokensHidden).toBe("1");
    act(() => {
      dm.getState().dispatch({ kind: "map/token-update", id: "m", tokenId: "ghost", patch: { hidden: false } });
    });
    expect(stage().dataset.tokensShown).toBe("2");
    act(() => {
      dm.getState().dispatch({ kind: "map/token-remove", id: "m", tokenId: "orc" });
    });
    expect(stage().dataset.tokens).toBe("1");
    expect(stage().dataset.tokensShown).toBe("1");
    // The player never gets a token tool.
    expect(stage().dataset.tokenSelected).toBe("");
  });
});
