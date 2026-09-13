/**
 * The player-view panel, the toolbar's blackout / splash switches and the
 * canvas's viewport rectangle, driven through `DmView` with a real store
 * (T009). The rectangle <-> transform maths has its own unit tests
 * (`map/playerView.test.ts`); dragging the rectangle needs Konva hit
 * testing, which jsdom cannot do, so it is covered by `e2e/player-view.spec.ts`.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { MapImportError } from "../state/mapActions";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import type { SplashActions } from "../state/splashActions";
import { createTableStore, type TableStore } from "../state/store";
import { tvTopEdgePoints } from "./DmCanvas";
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

const tv = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };
const calibration = { pxPerInch: 100, method: "square" as const, updatedAt: 1 };

function fakeSplash(store: TableStore) {
  const chosen: string[] = [];
  const actions: SplashActions & { chosen: string[] } = {
    chosen,
    async setImage(file) {
      if (!file.type.startsWith("image/")) throw new MapImportError("unsupported-type", file.name);
      chosen.push(file.name);
      store.getState().dispatch({ kind: "campaign/set-splash-image", assetId: `asset-${file.name}` });
      return `asset-${file.name}`;
    },
    async clearImage() {
      store.getState().dispatch({ kind: "campaign/set-splash-image", assetId: null });
    },
  };
  return actions;
}

function renderDm(store: TableStore) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  const splash = fakeSplash(store);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} splashActions={splash} />
    </MemoryRouter>
  );
  return splash;
}

/** 500 x 400 map px with 50 px cells. */
function storeWithMap(activeMapId: string | null = "a") {
  const a = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 });
  const b = createBlankMapScene({ id: "b", name: "B", columns: 4, rows: 4, cellSize: 50 });
  return createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId });
}

const presentation = (store: TableStore) => store.getState().presentation;
const surface = () => screen.getByTestId("dm-canvas-surface");
const blackout = () => screen.getByTestId("blackout-toggle") as HTMLButtonElement;
const splashToggle = () => screen.getByTestId("splash-toggle") as HTMLButtonElement;

describe("PlayerViewPanel + toolbar overrides", () => {
  it("rotates the player view in quarter turns either way", () => {
    const store = storeWithMap();
    renderDm(store);
    expect(screen.getByTestId("rotation-value").textContent).toBe("0°");
    fireEvent.click(screen.getByRole("button", { name: "Rotate player view clockwise" }));
    expect(presentation(store).rotation).toBe(90);
    expect(screen.getByTestId("rotation-value").textContent).toBe("90°");
    fireEvent.click(screen.getByRole("button", { name: "Rotate player view clockwise" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate player view clockwise" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate player view clockwise" }));
    expect(presentation(store).rotation).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Rotate player view counter-clockwise" }));
    expect(presentation(store).rotation).toBe(270);
    expect(surface().dataset.playerRotation).toBe("270");
  });

  it("blackout and splash toggle from the toolbar and show their state", () => {
    const store = storeWithMap();
    renderDm(store);
    expect(blackout().getAttribute("aria-pressed")).toBe("false");
    expect(blackout().textContent).toBe("Blackout");
    fireEvent.click(blackout());
    expect(presentation(store).blackout).toBe(true);
    expect(blackout().getAttribute("aria-pressed")).toBe("true");
    expect(blackout().textContent).toBe("End blackout");
    fireEvent.click(blackout());
    expect(presentation(store).blackout).toBe(false);

    expect(splashToggle().textContent).toBe("Show splash");
    fireEvent.click(splashToggle());
    expect(presentation(store).splash).toBe(true);
    expect(splashToggle().getAttribute("aria-pressed")).toBe("true");
    expect(splashToggle().textContent).toBe("Hide splash");
    fireEvent.click(splashToggle());
    expect(presentation(store).splash).toBe(false);
  });

  it("splash on switch: the preference raises the splash when the shown map changes", () => {
    const store = storeWithMap();
    renderDm(store);
    const pref = screen.getByTestId("splash-on-switch") as HTMLInputElement;
    expect(pref.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show B" }));
    expect(presentation(store).splash).toBe(false);

    fireEvent.click(pref);
    expect(presentation(store).splashOnSwitch).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show A" }));
    expect(presentation(store).splash).toBe(true);
    expect(splashToggle().textContent).toBe("Hide splash");
    fireEvent.click(splashToggle());
    expect(presentation(store).splash).toBe(false);
  });

  it("draws the player viewport rectangle: fitted (not draggable) until calibrated, then locked and draggable", () => {
    const store = storeWithMap();
    renderDm(store);
    // No player display yet: a 1080p one is assumed. Fit 500x400 into 1920x1080: scale 2.7.
    expect(screen.getByTestId("player-viewport-info").textContent).toMatch(/fits the whole map/);
    expect(surface().dataset.playerCenter).toBe("250,200");
    expect(surface().dataset.playerRect).toBe("-106,0,711,400");
    expect(surface().dataset.playerDraggable).toBe("false");
    // The rectangle's handle (an underlay layer beneath the tokens) and the
    // controls layer (its frame, above the fog) are two extra canvases over
    // image, grid, tokens, annotations and fog (T013).
    expect(screen.getByTestId("dm-map-stage").querySelectorAll("canvas")).toHaveLength(7);

    act(() => {
      store.getState().setPlayerDisplay(tv);
      store.getState().setPresentation({ calibration });
    });
    // Locked scale 2: the display shows 960 x 540 map px around the centre.
    expect(surface().dataset.playerRect).toBe("-230,-70,960,540");
    expect(surface().dataset.playerDraggable).toBe("true");
    expect(screen.getByTestId("player-viewport-info").textContent).toMatch(/1920×1080 display/);
    expect(screen.getByTestId("player-viewport-info").textContent).not.toMatch(/assumed/);

    act(() => store.getState().setPresentation({ center: { x: 100, y: 50 }, rotation: 90 }));
    expect(surface().dataset.playerCenter).toBe("100,50");
    expect(surface().dataset.playerRect).toBe("-170,-430,540,960");
    expect(surface().dataset.playerRotation).toBe("90");

    // Overview un-locks it again (whole map, centred).
    act(() => store.getState().setPresentation({ overview: true }));
    expect(surface().dataset.playerDraggable).toBe("false");
    expect(surface().dataset.playerCenter).toBe("250,200");

    // A running canvas tool takes the pointer instead.
    act(() => store.getState().setPresentation({ overview: false }));
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    expect(surface().dataset.playerDraggable).toBe("false");
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    expect(surface().dataset.playerDraggable).toBe("true");
  });

  it("recentre clears the pan centre; a scene switch does too", () => {
    const store = storeWithMap();
    renderDm(store);
    const recentre = () => screen.getByTestId("recentre-player-view") as HTMLButtonElement;
    expect(recentre().disabled).toBe(true);
    act(() => store.getState().setPresentation({ calibration, center: { x: 10, y: 10 } }));
    expect(recentre().disabled).toBe(false);
    fireEvent.click(recentre());
    expect(presentation(store).center).toBeNull();
    expect(recentre().disabled).toBe(true);

    act(() => store.getState().setPresentation({ center: { x: 10, y: 10 } }));
    fireEvent.click(screen.getByRole("button", { name: "Show B" }));
    expect(presentation(store).center).toBeNull();
    expect(surface().dataset.playerCenter).toBe("100,100");
  });

  it("asks for a map before the viewport can be positioned", () => {
    renderDm(storeWithMap(null));
    expect(screen.getByTestId("player-viewport-info").textContent).toMatch(/show a map/i);
    expect(screen.queryByTestId("dm-canvas-surface")?.dataset.playerCenter).toBe("");
  });

  it("splash source (T015): the radio chooses the artwork or the title card, and the thumbnail shows what is in effect", () => {
    const store = storeWithMap();
    act(() => store.getState().dispatch({ kind: "campaign/set-name", name: "Curse of Strahd" }));
    renderDm(store);
    const defaultRadio = screen.getByTestId("splash-source-default") as HTMLInputElement;
    const titleRadio = screen.getByTestId("splash-source-title") as HTMLInputElement;
    const thumb = () => screen.getByTestId("splash-thumb");

    // A new campaign shows the artwork; the thumbnail is the bundled file.
    expect(defaultRadio.checked).toBe(true);
    expect(titleRadio.checked).toBe(false);
    expect(thumb().dataset.splashKind).toBe("default");
    expect(thumb().getAttribute("src")).toMatch(/splash-default[^/]*\.png$/);
    expect(screen.queryByTestId("clear-splash-image")).toBeNull();

    fireEvent.click(titleRadio);
    expect(store.getState().shared.splashTitleCard).toBe(true);
    expect(titleRadio.checked).toBe(true);
    expect(defaultRadio.checked).toBe(false);
    expect(thumb().dataset.splashKind).toBe("title");
    expect(thumb().textContent).toBe("Curse of Strahd");
    expect(thumb().getAttribute("src")).toBeNull();

    fireEvent.click(defaultRadio);
    expect(store.getState().shared.splashTitleCard).toBe(false);
    expect(defaultRadio.checked).toBe(true);
    expect(thumb().dataset.splashKind).toBe("default");

    // The choice made elsewhere (another window, a loaded campaign) is reflected.
    act(() => store.getState().dispatch({ kind: "campaign/set-splash-title-card", on: true }));
    expect(titleRadio.checked).toBe(true);
    expect(thumb().dataset.splashKind).toBe("title");
  });

  it("splash image: picks a file through the actions, shows the clear control, reports bad files", async () => {
    const store = storeWithMap();
    const splash = renderDm(store);
    const input = screen.getByTestId("splash-file-input") as HTMLInputElement;
    expect(screen.queryByTestId("clear-splash-image")).toBeNull();
    expect(screen.getByTestId("splash-thumb").dataset.splashKind).toBe("default");

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["png"], "cover.png", { type: "image/png" })] },
      });
    });
    expect(splash.chosen).toEqual(["cover.png"]);
    expect(store.getState().shared.splashImageAssetId).toBe("asset-cover.png");
    await waitFor(() => expect(screen.getByTestId("clear-splash-image")).toBeTruthy());
    expect(screen.getByTestId("splash-thumb").dataset.splashKind).toBe("image");
    // The image is in effect whatever the source radio says; the radio itself stays usable.
    fireEvent.click(screen.getByTestId("splash-source-title"));
    expect(store.getState().shared.splashTitleCard).toBe(true);
    expect(screen.getByTestId("splash-thumb").dataset.splashKind).toBe("image");

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("splash-error").textContent).toMatch(/notes\.txt.*PNG, JPEG and WebP/)
    );
    expect(store.getState().shared.splashImageAssetId).toBe("asset-cover.png");

    await act(async () => {
      fireEvent.click(screen.getByTestId("clear-splash-image"));
    });
    expect(store.getState().shared.splashImageAssetId).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("clear-splash-image")).toBeNull());
    expect(screen.queryByTestId("splash-error")).toBeNull();
    // Cleared: the thumbnail is back to the chosen source (the title card here).
    expect(screen.getByTestId("splash-thumb").dataset.splashKind).toBe("title");
    fireEvent.click(screen.getByTestId("splash-source-default"));
    expect(screen.getByTestId("splash-thumb").dataset.splashKind).toBe("default");
  });

  it("marks the map edge that is at the top of the TV", () => {
    const rect = { x: 0, y: 0, width: 30, height: 20 };
    expect(tvTopEdgePoints(rect, 0)).toEqual([0, 0, 30, 0]);
    expect(tvTopEdgePoints(rect, 90)).toEqual([0, 0, 0, 20]);
    expect(tvTopEdgePoints(rect, 180)).toEqual([0, 20, 30, 20]);
    expect(tvTopEdgePoints(rect, 270)).toEqual([30, 0, 30, 20]);
  });
});
