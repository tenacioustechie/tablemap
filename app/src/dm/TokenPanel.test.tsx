/**
 * The token panel, driven through `DmView` with a real store and the real
 * token actions for disc tokens (they never touch storage); image tokens go
 * through injected fakes (the pipeline is tested in `state/tokenActions.test`).
 * Dragging a token on the canvas needs Konva hit testing, which jsdom cannot
 * do; the drop maths (`placeToken`) has its own unit tests.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { MapImportError } from "../state/mapActions";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { createTokenActions, type TokenActions } from "../state/tokenActions";
import { createToken } from "../state/tokens";
import { tokenImageAssetIds } from "./DmCanvas";
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

/** 500 x 400 map px with 50 px cells, plus a small second map. */
function storeWithMaps(activeMapId: string | null = "a") {
  const a = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 });
  const b = createBlankMapScene({ id: "b", name: "B", columns: 4, rows: 4, cellSize: 50 });
  return createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId });
}

function renderDm(store: TableStore, tokenActions?: TokenActions) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  let n = 0;
  const actions = tokenActions ?? createTokenActions(store, db, { newId: () => `t${++n}` });
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} tokenActions={actions} />
    </MemoryRouter>
  );
  return actions;
}

const tokens = (store: TableStore, mapId = "a") =>
  store.getState().shared.maps.find((m) => m.id === mapId)!.tokens;
const items = () => screen.queryAllByTestId("token-item");
const stage = () => screen.getByTestId("dm-map-stage");
const surface = () => screen.getByTestId("dm-canvas-surface");
const editor = () => screen.getByTestId("token-editor");

describe("TokenPanel via DmView (T010)", () => {
  it("asks for a map when none is shown", () => {
    renderDm(storeWithMaps(null));
    expect(screen.getByTestId("token-panel").textContent).toMatch(/show a map/i);
    expect(screen.queryByTestId("token-add")).toBeNull();
  });

  it("adds disc tokens in the middle of the player view, selects the new one and shows it on the canvas", () => {
    const store = storeWithMaps();
    renderDm(store);
    expect(screen.getByTestId("token-count").textContent).toBe("(0)");
    expect(items()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("token-add"));
    expect(tokens(store)).toHaveLength(1);
    // The player view is the whole (fitted) map, centred at (250, 200): a 1x1 token snaps to (250, 200).
    expect(tokens(store)[0]).toMatchObject({ id: "t1", name: "Token 1", badge: "1", x: 250, y: 200, size: 1, snapToGrid: true, hidden: false });
    expect(screen.getByTestId("token-count").textContent).toBe("(1)");
    expect(items()).toHaveLength(1);
    expect(items()[0].dataset.selected).toBe("true");
    expect(editor().dataset.tokenId).toBe("t1");
    expect(stage().dataset.tokens).toBe("1");
    expect(stage().dataset.tokensShown).toBe("1");
    expect(stage().dataset.tokenSelected).toBe("t1");
    expect(surface().dataset.tokenTool).toBe("active");

    fireEvent.click(screen.getByTestId("token-add"));
    expect(tokens(store).map((t) => t.badge)).toEqual(["1", "2"]);
    expect(items()[1].dataset.selected).toBe("true");
    expect(items()[0].dataset.selected).toBe("false");
  });

  it("edits the selected token's name, badge, colour, size, snapping and hidden flag", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("token-add"));

    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Orc chief" } });
    fireEvent.change(screen.getByTestId("token-badge"), { target: { value: "OC" } });
    fireEvent.change(screen.getByTestId("token-color"), { target: { value: "#00ff00" } });
    expect(tokens(store)[0]).toMatchObject({ name: "Orc chief", badge: "OC", appearance: { type: "disc", color: "#00ff00" } });
    expect(within(items()[0]).getByRole("button").textContent).toContain("Orc chief");

    fireEvent.change(screen.getByTestId("token-size"), { target: { value: "3" } });
    expect(tokens(store)[0]).toMatchObject({ size: 3, x: 250, y: 200 });
    expect(within(items()[0]).getByRole("button").textContent).toContain("3×3");

    fireEvent.click(screen.getByTestId("token-hidden"));
    expect(tokens(store)[0].hidden).toBe(true);
    expect(items()[0].dataset.hidden).toBe("true");
    expect(stage().dataset.tokensHidden).toBe("1");
    expect(stage().dataset.tokensShown).toBe("1"); // the DM still sees it
    fireEvent.click(screen.getByTestId("token-hidden"));
    expect(tokens(store)[0].hidden).toBe(false);

    fireEvent.click(screen.getByTestId("token-snap"));
    expect(tokens(store)[0].snapToGrid).toBe(false);
    // Off-grid position (as a drag would leave it), then snapping back on re-snaps.
    act(() => {
      store.getState().dispatch({ kind: "map/token-update", id: "a", tokenId: "t1", patch: { x: 112, y: 63 } });
    });
    fireEvent.click(screen.getByTestId("token-snap"));
    expect(tokens(store)[0]).toMatchObject({ snapToGrid: true, x: 100, y: 50 });
    // Badges are capped at three characters.
    fireEvent.change(screen.getByTestId("token-badge"), { target: { value: "ABCDE" } });
    expect(tokens(store)[0].badge).toBe("ABC");
  });

  it("selects from the list (toggling), deselects with Done, and removes the selected token", async () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("token-add"));
    fireEvent.click(screen.getByTestId("token-add"));
    fireEvent.click(screen.getByRole("button", { name: "Select Token 1" }));
    expect(editor().dataset.tokenId).toBe("t1");
    expect(stage().dataset.tokenSelected).toBe("t1");
    fireEvent.click(screen.getByRole("button", { name: "Select Token 1" }));
    expect(screen.queryByTestId("token-editor")).toBeNull();
    expect(stage().dataset.tokenSelected).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Select Token 2" }));
    fireEvent.click(screen.getByTestId("token-deselect"));
    expect(screen.queryByTestId("token-editor")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select Token 2" }));
    fireEvent.click(screen.getByTestId("token-remove"));
    await waitFor(() => expect(tokens(store).map((t) => t.id)).toEqual(["t1"]));
    expect(screen.queryByTestId("token-editor")).toBeNull();
    expect(items()).toHaveLength(1);
    expect(stage().dataset.tokens).toBe("1");
  });

  it("the selection follows the map: switching maps clears it, and each map lists its own tokens", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("token-add"));
    expect(editor().dataset.tokenId).toBe("t1");
    fireEvent.click(screen.getByRole("button", { name: "Show B" }));
    expect(screen.queryByTestId("token-editor")).toBeNull();
    expect(items()).toHaveLength(0);
    expect(screen.getByTestId("token-count").textContent).toBe("(0)");
    fireEvent.click(screen.getByTestId("token-add"));
    expect(tokens(store, "b")).toHaveLength(1);
    expect(tokens(store, "b")[0]).toMatchObject({ x: 100, y: 100 }); // centre of the 200x200 map
    fireEvent.click(screen.getByRole("button", { name: "Show A" }));
    expect(items()).toHaveLength(1);
    expect(tokens(store, "a")).toHaveLength(1);
  });

  it("a selection that disappears from under the panel (an external remove) clears itself", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("token-add"));
    act(() => {
      store.getState().dispatch({ kind: "map/token-remove", id: "a", tokenId: "t1" });
    });
    expect(screen.queryByTestId("token-editor")).toBeNull();
    expect(stage().dataset.tokenSelected).toBe("");
  });

  it("tokens are not interactive while a canvas tool runs, so the tool gets every press", () => {
    const store = storeWithMaps();
    renderDm(store);
    fireEvent.click(screen.getByTestId("token-add"));
    expect(surface().dataset.tokenTool).toBe("active");
    fireEvent.click(screen.getByTestId("fog-tool-rect"));
    expect(surface().dataset.tokenTool).toBe("none");
    expect(stage().dataset.tokenSelected).toBe("");
    // The selection itself survives in the panel.
    expect(editor().dataset.tokenId).toBe("t1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.tokenTool).toBe("active");
    expect(stage().dataset.tokenSelected).toBe("t1");
    fireEvent.click(screen.getByRole("button", { name: /align grid/i }));
    expect(surface().dataset.tokenTool).toBe("none");
  });

  it("adds image tokens through the picker and reports failures", async () => {
    const store = storeWithMaps();
    const real = createTokenActions(store, createTableStoreDb(), { newId: () => "t-img" });
    const addImage = vi.fn(async (mapId: string, file: File) => {
      if (!file.type.startsWith("image/")) throw new MapImportError("unsupported-type", file.name);
      const token = createToken({ id: "t-img", x: 0, y: 0, appearance: { type: "image", assetId: `asset-${file.name}` }, badge: "G" });
      store.getState().dispatch({ kind: "map/token-add", id: mapId, token });
      return token;
    });
    renderDm(store, { ...real, addImage });

    const input = screen.getByTestId("token-image-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "goblin.png", { type: "image/png" })] } });
    });
    await waitFor(() => expect(tokens(store)).toHaveLength(1));
    expect(addImage).toHaveBeenCalledWith("a", expect.any(File), expect.objectContaining({ at: { x: 250, y: 200 } }));
    expect(tokens(store)[0].appearance).toEqual({ type: "image", assetId: "asset-goblin.png" });
    await waitFor(() => expect(editor().dataset.tokenId).toBe("t-img"));
    expect(within(items()[0]).getByRole("button").textContent).toContain("img");
    expect(screen.queryByTestId("token-color")).toBeNull(); // no colour for an image token

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    });
    await waitFor(() => expect(screen.getByTestId("token-error").textContent).toMatch(/only PNG, JPEG and WebP/));
    expect(tokens(store)).toHaveLength(1);
  });
});

function createTableStoreDb() {
  return new TableMapDb(`tablemap-test-${nanoid()}`);
}

describe("tokenImageAssetIds", () => {
  it("lists each image asset once, sorted, ignoring discs", () => {
    const disc = createToken({ id: "d", x: 0, y: 0, appearance: { type: "disc", color: "#000" } });
    const a = createToken({ id: "a", x: 0, y: 0, appearance: { type: "image", assetId: "img-b" } });
    const b = createToken({ id: "b", x: 0, y: 0, appearance: { type: "image", assetId: "img-a" } });
    const c = createToken({ id: "c", x: 0, y: 0, appearance: { type: "image", assetId: "img-b" } });
    expect(tokenImageAssetIds({ tokens: [disc, a, b, c] })).toEqual(["img-a", "img-b"]);
    expect(tokenImageAssetIds(undefined)).toEqual([]);
  });
});
