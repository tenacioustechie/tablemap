// @vitest-environment node
//
// Node rather than jsdom: the import pipeline stores Blobs in IndexedDB and
// jsdom's Blob is not structured-cloneable by fake-indexeddb.
import { nanoid } from "nanoid";
import { TableMapDb } from "./db";
import {
  createMapActions,
  imageMimeType,
  importMapImage,
  isSupportedImageFile,
  MapImportError,
  mapNameFromFile,
  type MeasureImage,
} from "./mapActions";
import { createBlankMapScene } from "./maps";
import { createCampaign, getAsset, listAssetIds, putAsset } from "./persistence";
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
const pngFile = (name = "dungeon.png") =>
  new File([PNG_BYTES], name, { type: "image/png" });
const measure1920: MeasureImage = async () => ({ width: 1920, height: 1080 });

describe("file type detection", () => {
  it("accepts PNG, JPEG and WebP by MIME type", () => {
    expect(imageMimeType({ type: "image/png", name: "a.png" })).toBe("image/png");
    expect(imageMimeType({ type: "image/jpeg", name: "a.jpg" })).toBe("image/jpeg");
    expect(imageMimeType({ type: "image/webp", name: "a.webp" })).toBe("image/webp");
    expect(imageMimeType({ type: "IMAGE/PNG", name: "a" })).toBe("image/png");
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(imageMimeType({ type: "", name: "Map.JPG" })).toBe("image/jpeg");
    expect(imageMimeType({ type: "", name: "map.jpeg" })).toBe("image/jpeg");
    expect(imageMimeType({ type: "", name: "map.webp" })).toBe("image/webp");
    expect(imageMimeType({ type: "", name: "map.gif" })).toBeNull();
    expect(imageMimeType({ type: "", name: "noext" })).toBeNull();
  });

  it("rejects other types even with an image extension", () => {
    expect(imageMimeType({ type: "image/gif", name: "a.png" })).toBeNull();
    expect(imageMimeType({ type: "text/plain", name: "a.png" })).toBeNull();
    expect(isSupportedImageFile({ type: "application/pdf", name: "map.pdf" })).toBe(false);
    expect(isSupportedImageFile({ type: "image/png", name: "map.png" })).toBe(true);
  });

  it("derives a map name from the file name", () => {
    expect(mapNameFromFile("Dungeon Level 1.png")).toBe("Dungeon Level 1");
    expect(mapNameFromFile("crypt.tar.webp")).toBe("crypt.tar");
    expect(mapNameFromFile(".png")).toBe("Imported map");
    expect(mapNameFromFile("")).toBe("Imported map");
  });
});

describe("importMapImage (file -> blob -> map record)", () => {
  it("stores the bytes as a map-image asset and returns a scene of the decoded size", async () => {
    const measured: Blob[] = [];
    const scene = await importMapImage(db, "camp", pngFile("Crypt.png"), {
      id: "m1",
      measureImage: async (blob) => {
        measured.push(blob);
        return { width: 640, height: 480 };
      },
    });
    expect(scene).toMatchObject({
      id: "m1",
      name: "Crypt",
      width: 640,
      height: 480,
      fogMaskAssetId: null,
      fogOps: [],
      fogOpsFrom: 0,
      tokens: [],
      annotations: [],
    });
    expect(scene.imageAssetId).toEqual(expect.any(String));
    expect(measured).toHaveLength(1);

    const asset = await getAsset(db, scene.imageAssetId!);
    expect(asset).toMatchObject({ campaignId: "camp", kind: "map-image" });
    expect(asset!.blob.type).toBe("image/png");
    expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("gives a typeless file the MIME type from its extension", async () => {
    const file = new File([PNG_BYTES], "untyped.webp", { type: "" });
    const scene = await importMapImage(db, "camp", file, { measureImage: measure1920 });
    expect((await getAsset(db, scene.imageAssetId!))!.blob.type).toBe("image/webp");
  });

  it("rejects unsupported files before touching storage", async () => {
    const file = new File(["%PDF"], "map.pdf", { type: "application/pdf" });
    await expect(
      importMapImage(db, "camp", file, { measureImage: measure1920 })
    ).rejects.toMatchObject({ name: "MapImportError", reason: "unsupported-type" });
    expect(await listAssetIds(db, "camp")).toEqual([]);
  });

  it("rejects images that cannot be decoded, writing nothing", async () => {
    const failing: MeasureImage = async () => {
      throw new Error("bad image");
    };
    await expect(
      importMapImage(db, "camp", pngFile(), { measureImage: failing })
    ).rejects.toBeInstanceOf(MapImportError);
    const zero: MeasureImage = async () => ({ width: 0, height: 0 });
    await expect(
      importMapImage(db, "camp", pngFile(), { measureImage: zero })
    ).rejects.toMatchObject({ reason: "undecodable" });
    expect(await listAssetIds(db, "camp")).toEqual([]);
  });
});

describe("createMapActions", () => {
  const ids = () => store.getState().shared.maps.map((m) => m.id);

  it("importImage adds the map and makes it active in one dispatch", async () => {
    let n = 0;
    const actions = createMapActions(store, db, {
      measureImage: measure1920,
      newId: () => `id-${++n}`,
    });
    const seqBefore = store.getState().seq;
    const scene = await actions.importImage(pngFile("Cave.png"));
    expect(scene.id).toBe("id-1");
    expect(ids()).toEqual(["id-1"]);
    expect(store.getState().shared.activeMapId).toBe("id-1");
    expect(store.getState().seq).toBe(seqBefore + 1);
    expect(await listAssetIds(db, "camp")).toEqual([scene.imageAssetId]);
  });

  it("importImage refuses when no campaign is open", async () => {
    const closed = createTableStore();
    const actions = createMapActions(closed, db, { measureImage: measure1920 });
    await expect(actions.importImage(pngFile())).rejects.toThrow(/No campaign/);
  });

  it("createBlank adds a blank gridded map and activates it", () => {
    const actions = createMapActions(store, db, { newId: () => "blank-1" });
    const scene = actions.createBlank({ columns: 10, rows: 5, cellSize: 40, color: "#abcdef" });
    expect(scene).toEqual(
      createBlankMapScene({ id: "blank-1", columns: 10, rows: 5, cellSize: 40, color: "#abcdef" })
    );
    expect(ids()).toEqual(["blank-1"]);
    expect(store.getState().shared.activeMapId).toBe("blank-1");
  });

  it("duplicate inserts a copy after the original, copying the fog mask asset", async () => {
    let n = 0;
    const actions = createMapActions(store, db, {
      measureImage: measure1920,
      newId: () => `id-${++n}`,
    });
    const first = await actions.importImage(pngFile("A.png")); // id-1
    actions.createBlank({ columns: 1, rows: 1 }); // id-2
    const fogId = await putAsset(db, {
      id: "fog-1",
      campaignId: "camp",
      kind: "fog-mask",
      blob: new Blob(["mask"], { type: "image/png" }),
    });
    store.getState().dispatch({
      kind: "campaign/replace",
      state: {
        ...store.getState().shared,
        maps: store.getState().shared.maps.map((m) =>
          m.id === first.id ? { ...m, fogMaskAssetId: fogId } : m
        ),
      },
    });

    const copy = await actions.duplicate(first.id);
    expect(copy).toBeDefined();
    expect(ids()).toEqual(["id-1", copy!.id, "id-2"]);
    expect(copy!.name).toBe("A (copy)");
    expect(copy!.imageAssetId).toBe(first.imageAssetId);
    expect(copy!.fogMaskAssetId).not.toBeNull();
    expect(copy!.fogMaskAssetId).not.toBe(fogId);
    expect(await (await getAsset(db, copy!.fogMaskAssetId!))!.blob.text()).toBe("mask");
    expect(store.getState().shared.activeMapId).toBe(copy!.id);
    expect(await actions.duplicate("nope")).toBeUndefined();
  });

  it("rename and setActive dispatch the matching ops", () => {
    const actions = createMapActions(store, db, { newId: () => "b" });
    actions.createBlank({ columns: 1, rows: 1 });
    actions.rename("b", "Arena");
    expect(store.getState().shared.maps[0].name).toBe("Arena");
    actions.setActive(null);
    expect(store.getState().shared.activeMapId).toBeNull();
    actions.setActive("b");
    expect(store.getState().shared.activeMapId).toBe("b");
  });

  it("setGrid replaces the map's grid settings in one op", () => {
    const actions = createMapActions(store, db, { newId: () => "b" });
    actions.createBlank({ columns: 1, rows: 1 });
    const before = store.getState().seq;
    const grid = {
      cellSize: 48,
      offsetX: 12,
      offsetY: 7,
      dm: { visible: true, color: "#ff0000", opacity: 0.6 },
      player: { visible: false, color: "#00ff00", opacity: 0.2 },
    };
    actions.setGrid("b", grid);
    expect(store.getState().shared.maps[0].grid).toEqual(grid);
    expect(store.getState().seq).toBe(before + 1);
    actions.setGrid("nope", grid);
    expect(store.getState().seq).toBe(before + 2); // dispatched, applied as a no-op
  });

  it("remove deletes the map and only the assets nothing else references", async () => {
    let n = 0;
    const actions = createMapActions(store, db, {
      measureImage: measure1920,
      newId: () => `id-${++n}`,
    });
    const a = await actions.importImage(pngFile("A.png"));
    const b = await actions.importImage(pngFile("B.png"));
    const aCopy = (await actions.duplicate(a.id))!; // shares a's image

    await actions.remove(a.id);
    expect(ids()).toEqual([aCopy.id, b.id]);
    // a's image is still used by the copy.
    expect((await listAssetIds(db, "camp")).sort()).toEqual(
      [a.imageAssetId, b.imageAssetId].sort()
    );

    await actions.remove(aCopy.id); // the active map: the player goes idle
    expect(await listAssetIds(db, "camp")).toEqual([b.imageAssetId]);
    expect(store.getState().shared.activeMapId).toBeNull();

    actions.setActive(b.id);
    await actions.remove(b.id);
    expect(ids()).toEqual([]);
    expect(store.getState().shared.activeMapId).toBeNull();
    expect(await listAssetIds(db, "camp")).toEqual([]);
  });
});
