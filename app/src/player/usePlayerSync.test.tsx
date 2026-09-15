import { act, render, screen, waitFor } from "@testing-library/react";
import Konva from "konva";
import { nanoid } from "nanoid";
import { createAnnotationActions } from "../state/annotationActions";
import { TURN_RING_WIDTH_PX } from "../map/TokenLayer";
import { lockedScale, type DisplayInfo, type PresentationState } from "../state/calibration";
import { startDmSync, type AssetSource } from "../state/dmSync";
import { createInitiativeEntry, type Initiative } from "../state/initiative";
import { createBlankMapScene, createImageMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { initialSharedState, type SharedOp } from "../state/shared";
import { createToken } from "../state/tokens";
import { createTableStore } from "../state/store";
import { decodeMessage } from "../state/sync";
import { createMemoryHub } from "../state/transport";
import { tokenVisionPolygon } from "../state/vision";
import { createDoor, createWall } from "../state/walls";
import { INITIATIVE_STRIP_VMIN } from "./InitiativeStrip";
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

describe("PlayerView vision dim (T107)", () => {
  const stage = () => screen.getByTestId("player-map-stage");
  const konvaStage = () => Konva.stages.find((s) => stage().contains(s.container()))!;
  /** The polygons the player cut out of its dim layer. */
  const cuts = () => konvaStage().find<Konva.Line>(".dim-visible").map((line) => line.points());
  const xsOf = (points: readonly number[]) => points.filter((_, i) => i % 2 === 0);

  it("derives the dim from the synced walls and tokens: data-dim and the bright area follow token, door and setting deltas", () => {
    const hub = createMemoryHub();
    // 10 x 8 cells of 20 px, cut at x = 100 by two walls and a closed door (y 60–100) between them.
    const map: MapScene = {
      ...createBlankMapScene({ id: "m", columns: 10, rows: 8, cellSize: 20 }),
      walls: [
        createWall({ id: "w1", x1: 100, y1: 0, x2: 100, y2: 60 }),
        createDoor({ id: "door", x1: 100, y1: 60, x2: 100, y2: 100 }),
        createWall({ id: "w2", x1: 100, y1: 100, x2: 100, y2: 160 }),
      ],
      tokens: [createToken({ id: "orc", x: 40, y: 70, appearance: { type: "disc", color: "#f00" } })],
    };
    const dm = createTableStore({ ...initialSharedState(), maps: [map], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    const dispatch = (op: SharedOp) =>
      act(() => {
        dm.getState().dispatch(op);
      });
    /** What the DM's own state says the token sees. */
    const dmSees = () => {
      const scene = dm.getState().shared.maps[0];
      return tokenVisionPolygon(scene, scene.tokens[0]);
    };
    expect(stage().dataset.dim).toBe("false");
    expect(stage().dataset.dimPolygons).toBe("0");
    expect(cuts()).toEqual([]);

    // Vision 4 (80 px) from (50, 80): dimmed, bright up to the closed door.
    dispatch({ kind: "map/token-update", id: "m", tokenId: "orc", patch: { vision: 4 } });
    expect(stage().dataset.dim).toBe("true");
    expect(stage().dataset.dimPolygons).toBe("1");
    expect(cuts()).toEqual([dmSees()]);
    expect(Math.max(...xsOf(cuts()[0]))).toBeLessThanOrEqual(100 + 1e-6);

    // Moved: the bright area follows.
    const before = cuts()[0];
    dispatch({ kind: "map/token-update", id: "m", tokenId: "orc", patch: { x: 20 } });
    expect(cuts()).toEqual([dmSees()]);
    expect(cuts()[0]).not.toEqual(before);

    // The door opened: wider at once, with no fog op behind it.
    const fogOps = stage().dataset.fogOps;
    dispatch({ kind: "map/door-set-open", id: "m", segmentId: "door", open: true });
    expect(cuts()).toEqual([dmSees()]);
    expect(Math.max(...xsOf(cuts()[0]))).toBeGreaterThan(100);
    expect(stage().dataset.fogOps).toBe(fogOps);

    // The per-map setting: off removes the dim, on forces it even with nobody seeing.
    dispatch({ kind: "map/set-vision-dim", id: "m", visionDim: "off" });
    expect(stage().dataset.dim).toBe("false");
    expect(cuts()).toEqual([]);
    dispatch({ kind: "map/set-vision-dim", id: "m", visionDim: "on" });
    dispatch({ kind: "map/token-update", id: "m", tokenId: "orc", patch: { vision: 0 } });
    expect(stage().dataset.dim).toBe("true");
    expect(stage().dataset.dimPolygons).toBe("0");
    dispatch({ kind: "map/set-vision-dim", id: "m", visionDim: "auto" });
    expect(stage().dataset.dim).toBe("false");
  });
});

describe("PlayerView initiative strip and turn ring (T111)", () => {
  const disc = { type: "disc" as const, color: "#f00" };
  const entry = (id: string, name: string, value: number, tokenId: string | null = null) =>
    createInitiativeEntry({ id, name, value, tokenId });
  /** Goblin (linked to a 1 × 1 token at 50, 50), Ogre (a 2 × 2 at 150, 50), Xan (unlinked). */
  const order = (turn: number | null = null, round = 1): Initiative => ({
    entries: [entry("g", "Goblin", 18, "gob"), entry("o", "Ogre", 12, "ogre"), entry("x", "Xan", 7)],
    turn,
    round,
  });
  const strip = () => screen.queryByTestId("player-initiative-strip");
  const chips = () => screen.queryAllByTestId("player-initiative-entry");
  const names = () => chips().map((chip) => chip.textContent);
  const currents = () => chips().map((chip) => chip.dataset.current);
  const round = () => screen.getByTestId("player-initiative-round").textContent;
  const stage = () => screen.getByTestId("player-map-stage");
  const ring = () =>
    Konva.stages.find((s) => stage().contains(s.container()))?.findOne<Konva.Circle>("#turn-ring");

  function setup({ initiative = order(), fogBase = null }: { initiative?: Initiative; fogBase?: string | null } = {}) {
    const hub = createMemoryHub();
    const arena: MapScene = {
      ...createBlankMapScene({ id: "m", name: "Arena", columns: 6, rows: 4, cellSize: 50 }),
      fogMaskAssetId: fogBase,
      tokens: [
        createToken({ id: "gob", x: 50, y: 50, appearance: disc, name: "Goblin" }),
        createToken({ id: "ogre", x: 150, y: 50, size: 2, appearance: disc, name: "Ogre" }),
      ],
    };
    const dm = createTableStore({
      ...initialSharedState(),
      campaignName: "Strahd",
      maps: [arena],
      activeMapId: "m",
      initiative,
    });
    startDmSync(dm, hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} readDisplay={() => tv} />);
    const dispatch = (...ops: SharedOp[]) =>
      act(() => {
        dm.getState().dispatch(...ops);
      });
    const present = (patch: Partial<PresentationState>) =>
      act(() => {
        dm.getState().setPresentation(patch);
      });
    return { dm, dispatch, present };
  }

  it("the DM's toggle shows and hides the strip; the chips follow the list, the turn and the round within one delta", () => {
    const { dm, dispatch, present } = setup();
    expect(view().dataset.initiativeStrip).toBe("false");
    expect(strip()).toBeNull();

    present({ initiativeStrip: true });
    expect(view().dataset.initiativeStrip).toBe("true");
    expect(names()).toEqual(["Goblin", "Ogre", "Xan"]);
    expect(currents()).toEqual(["false", "false", "false"]);
    expect(round()).toBe("Round 1");

    const seq = Number(view().dataset.syncSeq);
    dispatch({ kind: "initiative/next" });
    expect(Number(view().dataset.syncSeq)).toBe(seq + 1);
    expect(currents()).toEqual(["true", "false", "false"]);
    expect(chips()[0].getAttribute("aria-current")).toBe("step");
    dispatch({ kind: "initiative/next" });
    expect(currents()).toEqual(["false", "true", "false"]);
    // Past the last entry: back to the top, next round — in one delta.
    dispatch({ kind: "initiative/next" }, { kind: "initiative/next" });
    expect(Number(view().dataset.syncSeq)).toBe(seq + 3);
    expect(currents()).toEqual(["true", "false", "false"]);
    expect(round()).toBe("Round 2");
    expect(strip()!.dataset.round).toBe("2");

    // An edit and a sort show as they land; the current entry stays current.
    dispatch({ kind: "initiative/update", id: "x", patch: { name: "Xan the Bold", value: 30 } });
    dispatch({ kind: "initiative/sort" });
    expect(names()).toEqual(["Xan the Bold", "Goblin", "Ogre"]);
    expect(currents()).toEqual(["false", "true", "false"]);

    // Nothing to press: still chrome-free.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    present({ initiativeStrip: false });
    expect(strip()).toBeNull();
    expect(view().dataset.initiativeStrip).toBe("false");
    expect(dm.getState().shared.initiative.entries).toHaveLength(3);
  });

  it("an empty list hides the strip although it is on; the first entry brings it back", () => {
    const { dispatch, present } = setup({ initiative: { entries: [], turn: null, round: 1 } });
    present({ initiativeStrip: true });
    expect(strip()).toBeNull();
    expect(screen.queryByTestId("player-initiative-layer")).toBeNull();
    expect(view().dataset.initiativeStrip).toBe("false");

    dispatch({ kind: "initiative/add", entry: entry("x", "Xan", 7) });
    expect(names()).toEqual(["Xan"]);
    expect(view().dataset.initiativeStrip).toBe("true");
    dispatch({ kind: "initiative/clear" });
    expect(strip()).toBeNull();
  });

  it("runs along the top of the turned view, beneath the splash and the blackout, not on the ruler screen; the overview badge steps aside", () => {
    const { present } = setup({ initiative: order(0) });
    present({ initiativeStrip: true, rotation: 90 });
    const rotated = strip()!.parentElement!;
    expect(rotated.dataset.rotation).toBe("90");
    expect(rotated.style.transform).toBe("rotate(90deg)");
    expect(strip()!.style.top).toBe("0px");
    expect(strip()!.style.height).toBe(`${INITIATIVE_STRIP_VMIN}vmin`);
    present({ rotation: 270 });
    expect(strip()!.parentElement!.dataset.rotation).toBe("270");
    expect(strip()!.parentElement!.style.transform).toBe("rotate(270deg)");

    // Over the stage, under the splash and the blackout, and still there beneath them.
    const layer = screen.getByTestId("player-initiative-layer");
    present({ splash: true, blackout: true });
    const splash = screen.getByTestId("player-splash");
    const blackout = screen.getByTestId("player-blackout");
    expect(Number(layer.style.zIndex)).toBeGreaterThan(0);
    expect(Number(layer.style.zIndex)).toBeLessThan(Number(splash.style.zIndex));
    expect(Number(splash.style.zIndex)).toBeLessThan(Number(blackout.style.zIndex));
    expect(layer.compareDocumentPosition(stage()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(layer.compareDocumentPosition(splash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view().lastElementChild).toBe(blackout);
    expect(strip()).toBeTruthy();
    present({ splash: false, blackout: false });

    // The ruler screen is the DM's measuring tool: no strip over it.
    present({ target: 96 });
    expect(strip()).toBeNull();
    present({ target: null });
    expect(strip()).toBeTruthy();

    // The overview badge moves out from under the strip, and back once the strip goes.
    present({ calibration: { pxPerInch: 40, method: "square", updatedAt: 1 }, overview: true });
    expect(screen.getByTestId("player-overview-badge").style.marginTop).toBe(`${INITIATIVE_STRIP_VMIN}vmin`);
    present({ initiativeStrip: false });
    expect(screen.getByTestId("player-overview-badge").style.marginTop).toBe("");
  });

  it("rings the current entry's token only while the players can see it, with or without the strip", () => {
    // The fog base never arrives: every token counts as fogged.
    const { dispatch } = setup({ initiative: order(0), fogBase: "mask" });
    expect(stage().dataset.fogStatus).toBe("waiting");
    expect(stage().dataset.turnRing).toBe("");
    expect(ring()).toBeFalsy();

    // A base-less map: jsdom's blank mask reads as revealed, so the goblin is drawn — and ringed.
    dispatch({ kind: "map/fog-compact", id: "m", baseAssetId: null, opCount: 0 });
    expect(stage().dataset.tokensShown).toBe("2");
    expect(stage().dataset.turnRing).toBe("gob");
    expect([ring()!.x(), ring()!.y()]).toEqual([75, 75]);
    expect(ring()!.strokeWidth()).toBe(TURN_RING_WIDTH_PX.player);

    // Hidden by the DM: no ring on the TV (the entry stays in the list).
    dispatch({ kind: "map/token-update", id: "m", tokenId: "gob", patch: { hidden: true } });
    expect(stage().dataset.turnRing).toBe("");
    expect(ring()).toBeFalsy();
    dispatch({ kind: "map/token-update", id: "m", tokenId: "gob", patch: { hidden: false } });
    expect(stage().dataset.turnRing).toBe("gob");

    // The next turn moves it round the ogre; an unlinked entry has none.
    dispatch({ kind: "initiative/next" });
    expect(stage().dataset.turnRing).toBe("ogre");
    expect([ring()!.x(), ring()!.y()]).toEqual([200, 100]);
    dispatch({ kind: "initiative/next" });
    expect(stage().dataset.turnRing).toBe("");
    expect(ring()).toBeFalsy();

    // The current entry's token removed: unlinked, no ring.
    dispatch({ kind: "initiative/set-turn", id: "g" });
    expect(stage().dataset.turnRing).toBe("gob");
    dispatch({ kind: "map/token-remove", id: "m", tokenId: "gob" });
    expect(stage().dataset.turnRing).toBe("");
    expect(ring()).toBeFalsy();
  });
});
