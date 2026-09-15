// @vitest-environment node
//
// Node rather than jsdom: image tokens store Blobs in IndexedDB and jsdom's
// Blob is not structured-cloneable by fake-indexeddb.
import { nanoid } from "nanoid";
import { TableMapDb } from "./db";
import { MapImportError } from "./mapActions";
import { createBlankMapScene } from "./maps";
import type { Token } from "./model";
import {
  createCampaign,
  getAsset,
  listAssetIds,
  loadCampaign,
  putAsset,
  saveCampaignState,
} from "./persistence";
import { initialSharedState, type SharedOp } from "./shared";
import { createTableStore, type TableStore } from "./store";
import { createTokenActions } from "./tokenActions";
import { TOKEN_PALETTE } from "./tokens";

let db: TableMapDb;
let store: TableStore;
let ops: SharedOp[];

/** 500 x 400 map px, 50 px cells. */
const scene = () => createBlankMapScene({ id: "m", columns: 10, rows: 8, cellSize: 50 });

beforeEach(async () => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
  store = createTableStore();
  store.getState().openCampaign(await createCampaign(db, "C", { id: "camp" }));
  store.getState().dispatch({ kind: "map/add", map: scene() }, { kind: "map/set-active", id: "m" });
  ops = [];
  store.onOps((o) => ops.push(...o));
});

afterEach(async () => {
  await db.delete();
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngFile = (name = "orc.png") => new File([PNG_BYTES], name, { type: "image/png" });
const tokens = () => store.getState().shared.maps[0].tokens;
const ids = (...list: string[]) => ({ newId: () => list.shift()! });

describe("token actions (T010)", () => {
  it("adds a disc token at the map centre with default name, badge and palette colour, snapped", () => {
    const actions = createTokenActions(store, db, ids("t1", "t2"));
    const first = actions.addDisc("m");
    expect(first).toEqual<Token>({
      id: "t1",
      name: "Token 1",
      badge: "1",
      appearance: { type: "disc", color: TOKEN_PALETTE[0] },
      // Centre (250, 200) → top-left (225, 175) → snapped to (250, 200).
      x: 250,
      y: 200,
      size: 1,
      snapToGrid: true,
      hidden: false,
      vision: 0,
    });
    expect(ops).toEqual([{ kind: "map/token-add", id: "m", token: first }]);
    const second = actions.addDisc("m", { size: 2, name: "Ogre", badge: "O", hidden: true, snapToGrid: false });
    expect(second).toMatchObject({
      id: "t2",
      name: "Ogre",
      badge: "O",
      appearance: { type: "disc", color: TOKEN_PALETTE[1] },
      x: 200,
      y: 150,
      size: 2,
      snapToGrid: false,
      hidden: true,
    });
    expect(tokens().map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("places a new token around a requested centre, clamped to the map", () => {
    const actions = createTokenActions(store, db, ids("t1", "t2", "t3"));
    expect(actions.addDisc("m", { at: { x: 112, y: 63 } })).toMatchObject({ x: 100, y: 50 });
    expect(actions.addDisc("m", { at: { x: 112, y: 63 }, snapToGrid: false })).toMatchObject({ x: 87, y: 38 });
    expect(actions.addDisc("m", { at: { x: -500, y: 900 }, size: 2 })).toMatchObject({ x: -50, y: 350 });
    expect(actions.addDisc("nope")).toBeUndefined();
    expect(ops).toHaveLength(3);
  });

  it("stores an image token's file as a token-image asset referenced by the token", async () => {
    const actions = createTokenActions(store, db, ids("img-1", "t1"));
    const token = await actions.addImage("m", pngFile(), { badge: "G" });
    expect(token).toMatchObject({ id: "t1", appearance: { type: "image", assetId: "img-1" }, badge: "G" });
    expect(tokens()).toEqual([token]);
    const record = await getAsset(db, "img-1");
    expect(record).toMatchObject({ campaignId: "camp", kind: "token-image" });
    expect(record?.blob.type).toBe("image/png");
    expect(record?.blob.size).toBe(PNG_BYTES.length);
    // The extension fallback of map import applies here too.
    await actions.addImage("m", new File([PNG_BYTES], "Goblin.JPG", { type: "" }));
    expect(tokens()).toHaveLength(2);
  });

  it("rejects other file types and unknown maps without writing anything", async () => {
    const actions = createTokenActions(store, db);
    await expect(
      actions.addImage("m", new File(["x"], "notes.txt", { type: "text/plain" }))
    ).rejects.toBeInstanceOf(MapImportError);
    await expect(actions.addImage("nope", pngFile())).rejects.toThrow(/unknown map/i);
    expect(tokens()).toEqual([]);
    expect(await listAssetIds(db, "camp")).toEqual([]);
    const closed = createTableStore();
    await expect(createTokenActions(closed, db).addImage("m", pngFile())).rejects.toThrow(/campaign/i);
  });

  it("update patches fields, re-snaps when snapping is turned on, and skips no-ops", () => {
    const actions = createTokenActions(store, db, ids("t1"));
    actions.addDisc("m", { snapToGrid: false, at: { x: 112, y: 63 } }); // top-left (87, 38)
    ops.length = 0;
    actions.update("m", "t1", { name: "Orc", badge: "O", hidden: true });
    expect(tokens()[0]).toMatchObject({ name: "Orc", badge: "O", hidden: true, x: 87, y: 38 });
    actions.update("m", "t1", { name: "Orc" }); // no change: nothing is dispatched
    expect(ops).toHaveLength(1);
    expect(store.getState().seq).toBe(4); // open campaign, add+activate, addDisc, update

    actions.update("m", "t1", { snapToGrid: true });
    expect(tokens()[0]).toMatchObject({ snapToGrid: true, x: 100, y: 50 });
    actions.update("m", "t1", { size: 3 });
    expect(tokens()[0]).toMatchObject({ size: 3, x: 100, y: 50 });
    actions.update("m", "t1", { appearance: { type: "disc", color: "#00ff00" } });
    expect(tokens()[0].appearance).toEqual({ type: "disc", color: "#00ff00" });
    actions.update("m", "missing", { name: "x" });
    actions.update("nope", "t1", { name: "x" });
    expect(tokens()[0].name).toBe("Orc");
  });

  it("move clamps to the map and snaps according to the token", () => {
    const actions = createTokenActions(store, db, ids("snap", "free"));
    actions.addDisc("m");
    actions.addDisc("m", { snapToGrid: false });
    ops.length = 0;
    actions.move("m", "snap", { x: 312, y: 63 });
    expect(tokens()[0]).toMatchObject({ x: 300, y: 50 });
    actions.move("m", "free", { x: 312, y: 63 });
    expect(tokens()[1]).toMatchObject({ x: 312, y: 63 });
    actions.move("m", "free", { x: 5000, y: -5000 });
    expect(tokens()[1]).toMatchObject({ x: 475, y: -25 });
    expect(ops).toEqual([
      { kind: "map/token-update", id: "m", tokenId: "snap", patch: { x: 300, y: 50 } },
      { kind: "map/token-update", id: "m", tokenId: "free", patch: { x: 312, y: 63 } },
      { kind: "map/token-update", id: "m", tokenId: "free", patch: { x: 475, y: -25 } },
    ]);
    actions.move("m", "missing", { x: 0, y: 0 });
    expect(ops).toHaveLength(3);
  });

  it("remove drops the token and its image asset unless something else still uses it", async () => {
    const actions = createTokenActions(store, db, ids("img-1", "t1", "t2"));
    await actions.addImage("m", pngFile());
    // A second token sharing the image (a duplicated map would do this).
    store.getState().dispatch({
      kind: "map/token-add",
      id: "m",
      token: { ...tokens()[0], id: "t2" },
    });
    await actions.remove("m", "t1");
    expect(tokens().map((t) => t.id)).toEqual(["t2"]);
    expect(await getAsset(db, "img-1")).toBeDefined();
    await actions.remove("m", "t2");
    expect(tokens()).toEqual([]);
    expect(await getAsset(db, "img-1")).toBeUndefined();
    const seq = store.getState().seq;
    await actions.remove("m", "t2");
    expect(store.getState().seq).toBe(seq);
  });

  it("removing a map deletes its tokens' images with it (mapActions), and duplicates share them", async () => {
    const actions = createTokenActions(store, db, ids("img-1", "t1"));
    await actions.addImage("m", pngFile());
    await putAsset(db, { id: "other", campaignId: "camp", kind: "map-image", blob: new Blob([PNG_BYTES]) });
    const { createMapActions } = await import("./mapActions");
    const maps = createMapActions(store, db, { newId: () => "copy" });
    await maps.duplicate("m");
    expect(store.getState().shared.maps[1].tokens[0].appearance).toEqual({ type: "image", assetId: "img-1" });
    await maps.remove("m");
    expect(await getAsset(db, "img-1")).toBeDefined(); // the copy still uses it
    await maps.remove("copy");
    expect(await getAsset(db, "img-1")).toBeUndefined();
    expect(await getAsset(db, "other")).toBeDefined();
  });

  it("tokens persist in the campaign document and load back unchanged", async () => {
    const actions = createTokenActions(store, db, ids("img-1", "t1", "t2"));
    await actions.addImage("m", pngFile(), { name: "Goblin", badge: "G", size: 2 });
    actions.addDisc("m", { name: "Orc", hidden: true, snapToGrid: false, at: { x: 33, y: 44 } });
    const state = store.getState().shared;
    expect(await saveCampaignState(db, "camp", state)).toBe(true);

    const loaded = await loadCampaign(db, "camp");
    expect(loaded?.state.maps[0].tokens).toEqual(state.maps[0].tokens);
    expect(loaded?.state.maps[0].tokens).toHaveLength(2);
    expect(loaded?.state).toEqual(state);
    // And the document still validates as a whole (the guard sees the tokens).
    const fresh = createTableStore(initialSharedState());
    fresh.getState().openCampaign(loaded!);
    expect(fresh.getState().shared.maps[0].tokens.map((t) => t.name)).toEqual(["Goblin", "Orc"]);
  });
});
