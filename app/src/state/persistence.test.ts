// @vitest-environment node
//
// Node rather than jsdom: jsdom's Blob is not structured-cloneable by
// fake-indexeddb, whereas Node's Blob is, and Blob storage is the point.
import { nanoid } from "nanoid";
import { newCampaign, type Campaign } from "./campaign";
import { TableMapDb } from "./db";
import { defaultGridSettings, SCHEMA_VERSION, type MapScene } from "./model";
import {
  CampaignLoadError,
  createCampaign,
  deleteCampaign,
  getAsset,
  getLastCampaignId,
  listAssetIds,
  listCampaigns,
  loadCampaign,
  putAsset,
  renameCampaign,
  resolveStartupCampaign,
  saveCampaign,
  saveCampaignState,
  setLastCampaignId,
} from "./persistence";
import { initialSharedState, type SharedState } from "./shared";

let db: TableMapDb;

beforeEach(() => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
});

afterEach(async () => {
  await db.delete();
});

const sceneWith = (imageAssetId: string | null): MapScene => ({
  id: "m1",
  name: "Crypt",
  imageAssetId,
  backgroundColor: "#000000",
  width: 1200,
  height: 900,
  grid: defaultGridSettings(),
  fogMaskAssetId: null,
  tokens: [],
  annotations: [],
});

function holdsBlob(value: unknown): boolean {
  if (value instanceof Blob) return true;
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(holdsBlob);
}

describe("campaign persistence", () => {
  it("round-trips a campaign document exactly", async () => {
    const state: SharedState = {
      campaignName: "Curse of Strahd",
      maps: [sceneWith(null)],
      activeMapId: "m1",
    };
    const created = await createCampaign(db, "Curse of Strahd", { state, now: 10 });
    const loaded = await loadCampaign(db, created.id);
    expect(loaded).toEqual(created);
    expect(loaded).not.toBe(created);
  });

  it("round-trips per-view grid settings", async () => {
    const grid = {
      cellSize: 48.25,
      offsetX: 12,
      offsetY: -7,
      dm: { visible: true, color: "#ff0000", opacity: 0.6 },
      player: { visible: false, color: "#00ff00", opacity: 0.2 },
    };
    const state: SharedState = {
      campaignName: "G",
      maps: [{ ...sceneWith(null), grid }],
      activeMapId: "m1",
    };
    const created = await createCampaign(db, "G", { state });
    const loaded = await loadCampaign(db, created.id);
    expect(loaded?.state.maps[0].grid).toEqual(grid);
  });

  it("writes the schema version into the stored record", async () => {
    const created = await createCampaign(db, "S");
    const raw = await db.campaigns.get(created.id);
    expect(raw?.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("returns undefined for an unknown id", async () => {
    expect(await loadCampaign(db, "nope")).toBeUndefined();
  });

  it("saveCampaignState replaces the state, syncs the name and bumps updatedAt", async () => {
    const created = await createCampaign(db, "Old", { now: 100 });
    const next: SharedState = { ...created.state, campaignName: "New" };
    expect(await saveCampaignState(db, created.id, next, 200)).toBe(true);
    const loaded = await loadCampaign(db, created.id);
    expect(loaded).toEqual({
      ...created,
      name: "New",
      updatedAt: 200,
      state: next,
    });
    expect(loaded?.createdAt).toBe(100);
  });

  it("saveCampaignState reports a missing campaign instead of resurrecting it", async () => {
    expect(await saveCampaignState(db, "gone", initialSharedState())).toBe(false);
    expect(await db.campaigns.count()).toBe(0);
  });

  it("saveCampaign writes a whole document", async () => {
    const c: Campaign = newCampaign("Whole", { id: "w", now: 1 });
    const saved = await saveCampaign(db, c, 50);
    expect(saved.updatedAt).toBe(50);
    expect(await loadCampaign(db, "w")).toEqual(saved);
  });

  it("lists summaries, most recently updated first, without state", async () => {
    await createCampaign(db, "A", { id: "a", now: 1 });
    await createCampaign(db, "B", { id: "b", now: 3 });
    await createCampaign(db, "C", { id: "c", now: 2 });
    const list = await listCampaigns(db);
    expect(list.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(list[0]).toEqual({ id: "b", name: "B", createdAt: 3, updatedAt: 3 });
  });

  it("renames both the record name and the state's campaign name", async () => {
    const c = await createCampaign(db, "Before", { now: 1 });
    expect(await renameCampaign(db, c.id, "After", 9)).toBe(true);
    const loaded = await loadCampaign(db, c.id);
    expect(loaded?.name).toBe("After");
    expect(loaded?.state.campaignName).toBe("After");
    expect(loaded?.updatedAt).toBe(9);
    expect(await renameCampaign(db, "missing", "x")).toBe(false);
  });

  it("deleting a campaign removes its assets and the last-opened pointer", async () => {
    const c = await createCampaign(db, "Doomed");
    const other = await createCampaign(db, "Kept");
    await putAsset(db, { campaignId: c.id, kind: "map-image", blob: new Blob(["x"]) });
    const keptAsset = await putAsset(db, {
      campaignId: other.id,
      kind: "map-image",
      blob: new Blob(["y"]),
    });
    await setLastCampaignId(db, c.id);

    await deleteCampaign(db, c.id);

    expect(await loadCampaign(db, c.id)).toBeUndefined();
    expect(await listAssetIds(db, c.id)).toEqual([]);
    expect(await listAssetIds(db, other.id)).toEqual([keptAsset]);
    expect(await getLastCampaignId(db)).toBeNull();
  });

  it("rejects documents saved by a newer schema", async () => {
    const c = newCampaign("Future", { id: "f" });
    await db.campaigns.put({ ...c, schemaVersion: SCHEMA_VERSION + 1 });
    await expect(loadCampaign(db, "f")).rejects.toBeInstanceOf(CampaignLoadError);
    await expect(loadCampaign(db, "f")).rejects.toMatchObject({
      campaignId: "f",
      reason: "newer-schema",
    });
  });

  it("rejects corrupt documents", async () => {
    // Bypass the types: this is exactly the "someone hand-edited IndexedDB" case.
    await db.campaigns.put({ id: "bad", schemaVersion: SCHEMA_VERSION } as Campaign);
    await expect(loadCampaign(db, "bad")).rejects.toMatchObject({
      reason: "invalid",
    });
  });
});

describe("assets", () => {
  it("stores images as Blobs in IndexedDB and keeps them out of the JSON document", async () => {
    const image = new Blob([new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3])], {
      type: "image/png",
    });
    const campaign = await createCampaign(db, "With map");
    const assetId = await putAsset(db, {
      campaignId: campaign.id,
      kind: "map-image",
      blob: image,
    });
    await saveCampaignState(db, campaign.id, {
      ...campaign.state,
      maps: [sceneWith(assetId)],
      activeMapId: "m1",
    });

    // The document only carries the reference...
    const loaded = await loadCampaign(db, campaign.id);
    expect(loaded?.state.maps[0].imageAssetId).toBe(assetId);
    expect(holdsBlob(loaded)).toBe(false);
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded);
    const rawRecord = await db.campaigns.get(campaign.id);
    expect(holdsBlob(rawRecord)).toBe(false);

    // ...and the bytes live in the assets table as a real Blob.
    const asset = await getAsset(db, assetId);
    expect(asset?.blob).toBeInstanceOf(Blob);
    expect(asset?.blob.type).toBe("image/png");
    expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3])
    );
    expect(asset).toMatchObject({ campaignId: campaign.id, kind: "map-image" });
  });

  it("returns undefined for unknown assets", async () => {
    expect(await getAsset(db, "nope")).toBeUndefined();
  });
});

describe("last opened campaign", () => {
  it("is null until set, and can be cleared", async () => {
    expect(await getLastCampaignId(db)).toBeNull();
    await setLastCampaignId(db, "c1");
    expect(await getLastCampaignId(db)).toBe("c1");
    await setLastCampaignId(db, null);
    expect(await getLastCampaignId(db)).toBeNull();
  });
});

describe("resolveStartupCampaign", () => {
  it("prefers the last opened campaign", async () => {
    await createCampaign(db, "Newer", { id: "n", now: 5 });
    await createCampaign(db, "Last", { id: "l", now: 1 });
    await setLastCampaignId(db, "l");
    expect((await resolveStartupCampaign(db)).id).toBe("l");
  });

  it("falls back to the most recently updated campaign", async () => {
    await createCampaign(db, "Old", { id: "o", now: 1 });
    await createCampaign(db, "Recent", { id: "r", now: 9 });
    await setLastCampaignId(db, "deleted");
    expect((await resolveStartupCampaign(db)).id).toBe("r");
  });

  it("creates a default campaign when there are none", async () => {
    const c = await resolveStartupCampaign(db);
    expect(c.name).toBe("Untitled campaign");
    expect(await loadCampaign(db, c.id)).toEqual(c);
    expect(await db.campaigns.count()).toBe(1);
  });

  it("skips unreadable documents rather than failing start-up", async () => {
    await db.campaigns.put({
      ...newCampaign("Future", { id: "f", now: 9 }),
      schemaVersion: SCHEMA_VERSION + 1,
    });
    await createCampaign(db, "Fine", { id: "ok", now: 1 });
    await setLastCampaignId(db, "f");
    expect((await resolveStartupCampaign(db)).id).toBe("ok");
  });
});
