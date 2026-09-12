// @vitest-environment node
//
// Node rather than jsdom: the actions store Blobs in IndexedDB and jsdom's
// Blob is not structured-cloneable by fake-indexeddb.
import { nanoid } from "nanoid";
import { TableMapDb } from "./db";
import { MapImportError } from "./mapActions";
import { createBlankMapScene } from "./maps";
import { createCampaign, getAsset, listAssetIds, putAsset } from "./persistence";
import { createSplashActions } from "./splashActions";
import { createTableStore, type TableStore } from "./store";

let db: TableMapDb;
let store: TableStore;

beforeEach(async () => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
  store = createTableStore();
  store.getState().openCampaign(await createCampaign(db, "C", { id: "camp" }));
});

afterEach(async () => {
  await db.delete();
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngFile = (name = "title.png") => new File([PNG_BYTES], name, { type: "image/png" });

describe("splash actions (T009)", () => {
  it("stores the file as a splash-image asset and selects it through one op", async () => {
    const ids = ["s1", "s2"];
    const actions = createSplashActions(store, db, { newId: () => ids.shift()! });
    const ops: unknown[] = [];
    store.onOps((o) => ops.push(...o));

    const id = await actions.setImage(pngFile());
    expect(id).toBe("s1");
    expect(store.getState().shared.splashImageAssetId).toBe("s1");
    expect(ops).toEqual([{ kind: "campaign/set-splash-image", assetId: "s1" }]);
    const record = await getAsset(db, "s1");
    expect(record).toMatchObject({ campaignId: "camp", kind: "splash-image" });
    expect(record?.blob.type).toBe("image/png");
    expect(record?.blob.size).toBe(PNG_BYTES.length);
  });

  it("choosing another image deletes the previous one; clearing goes back to the title", async () => {
    const ids = ["s1", "s2"];
    const actions = createSplashActions(store, db, { newId: () => ids.shift()! });
    await actions.setImage(pngFile("a.png"));
    await actions.setImage(pngFile("b.png"));
    expect(store.getState().shared.splashImageAssetId).toBe("s2");
    expect(await listAssetIds(db, "camp")).toEqual(["s2"]);

    await actions.clearImage();
    expect(store.getState().shared.splashImageAssetId).toBeNull();
    expect(await listAssetIds(db, "camp")).toEqual([]);

    // Clearing with nothing set dispatches nothing.
    const seq = store.getState().seq;
    await actions.clearImage();
    expect(store.getState().seq).toBe(seq);
  });

  it("keeps an image a map still uses (the DM may choose a map image as the splash)", async () => {
    const scene = createBlankMapScene({ id: "m", columns: 1, rows: 1 });
    await putAsset(db, { id: "img", campaignId: "camp", kind: "map-image", blob: new Blob([PNG_BYTES]) });
    store.getState().dispatch({ kind: "map/add", map: { ...scene, imageAssetId: "img" } });
    store.getState().dispatch({ kind: "campaign/set-splash-image", assetId: "img" });
    const actions = createSplashActions(store, db);
    await actions.clearImage();
    expect(await getAsset(db, "img")).toBeDefined();
  });

  it("rejects other file types without writing anything, and falls back to the extension", async () => {
    const actions = createSplashActions(store, db, { newId: () => "s1" });
    await expect(actions.setImage(new File(["x"], "notes.txt", { type: "text/plain" }))).rejects.toBeInstanceOf(
      MapImportError
    );
    expect(store.getState().shared.splashImageAssetId).toBeNull();
    expect(await listAssetIds(db, "camp")).toEqual([]);

    await actions.setImage(new File([PNG_BYTES], "Cover.JPG", { type: "" }));
    expect((await getAsset(db, "s1"))?.blob.type).toBe("image/jpeg");
  });

  it("needs an open campaign", async () => {
    const closed = createTableStore();
    await expect(createSplashActions(closed, db).setImage(pngFile())).rejects.toThrow(/campaign/i);
  });
});
