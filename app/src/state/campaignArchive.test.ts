// @vitest-environment node
//
// Node rather than jsdom: the round trip stores Blobs in fake-indexeddb, and
// jsdom's Blob is not structured-cloneable (see persistence.test.ts).
import JSZip from "jszip";
import { nanoid } from "nanoid";
import {
  ARCHIVE_DOCUMENT_PATH,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  archiveFileName,
  CampaignImportError,
  exportCampaign,
  importCampaign,
  type ArchiveEnvelope,
  type ImportFailure,
} from "./campaignArchive";
import { newCampaign, type Campaign } from "./campaign";
import { TableMapDb } from "./db";
import type { FogOp } from "./fog";
import { defaultGridSettings, SCHEMA_VERSION, type MapScene } from "./model";
import {
  createCampaign,
  getAsset,
  listAssetIds,
  loadCampaign,
  putAsset,
  saveCampaignState,
} from "./persistence";
import type { SharedState } from "./shared";

let db: TableMapDb;
let dbName: string;

beforeEach(() => {
  dbName = `tablemap-test-${nanoid()}`;
  db = new TableMapDb(dbName);
});

afterEach(async () => {
  await db.delete();
});

// ---- fixtures -------------------------------------------------------------

/** A few distinct bytes per "image"; the magic number is irrelevant to the archive. */
function bytes(seed: number, length = 64): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (seed * 31 + i * 7) & 0xff;
  return out;
}

const blob = (seed: number, type: string) => new Blob([bytes(seed)], { type });

async function sha256(b: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const FIXTURE_ASSETS = [
  { id: "img-1", kind: "map-image", type: "image/png", seed: 1 },
  { id: "fog-1", kind: "fog-mask", type: "image/png", seed: 2 },
  { id: "tok-1", kind: "token-image", type: "image/jpeg", seed: 3 },
  { id: "splash-1", kind: "splash-image", type: "image/webp", seed: 4 },
] as const;

const fogOps: FogOp[] = [
  { type: "fill", mode: "hide" },
  {
    type: "shape",
    mode: "reveal",
    shape: { kind: "rect", x: 10, y: 20, width: 300, height: 200 },
    feather: 8,
  },
];

const imageMap: MapScene = {
  id: "m1",
  name: "Crypt",
  imageAssetId: "img-1",
  backgroundColor: "#000000",
  width: 1200,
  height: 900,
  grid: { ...defaultGridSettings(), cellSize: 48.5, offsetX: 12, offsetY: -7 },
  fogMaskAssetId: "fog-1",
  fogOps,
  fogOpsFrom: 3,
  tokens: [
    {
      id: "t1",
      name: "Strahd",
      appearance: { type: "image", assetId: "tok-1" },
      badge: "S",
      x: 97,
      y: 41,
      size: 2,
      snapToGrid: true,
      hidden: false,
    },
    {
      id: "t2",
      name: "Goblin",
      appearance: { type: "disc", color: "#00ff00" },
      badge: "1",
      x: 0,
      y: 0,
      size: 1,
      snapToGrid: false,
      hidden: true,
    },
  ],
  annotations: [
    { id: "n1", kind: "note", x: 5, y: 6, text: "The vampire\nsleeps here", visibility: "dm" },
    {
      id: "d1",
      kind: "drawing",
      points: [1, 2, 3, 4, 5.5, 6.25],
      color: "#ff0000",
      strokeWidth: 4,
      visibility: "all",
    },
  ],
};

const blankMap: MapScene = {
  id: "m2",
  name: "Blank",
  imageAssetId: null,
  backgroundColor: "#3b3b3b",
  width: 700,
  height: 350,
  grid: defaultGridSettings(),
  fogMaskAssetId: null,
  fogOps: [],
  fogOpsFrom: 0,
  tokens: [],
  annotations: [],
};

const fixtureState: SharedState = {
  campaignName: "Curse of Strahd",
  maps: [imageMap, blankMap],
  activeMapId: "m1",
  splashImageAssetId: "splash-1",
};

/** A campaign with every kind of asset, fog, tokens and annotations. */
async function seedCampaign(target: TableMapDb, id = "cos"): Promise<Campaign> {
  const created = await createCampaign(target, "Curse of Strahd", { id, now: 1_700_000_000_000 });
  for (const a of FIXTURE_ASSETS) {
    await putAsset(target, { id: a.id, campaignId: id, kind: a.kind, blob: blob(a.seed, a.type) });
  }
  await saveCampaignState(target, id, fixtureState, 1_700_000_000_500);
  const loaded = await loadCampaign(target, created.id);
  if (!loaded) throw new Error("fixture not stored");
  return loaded;
}

/** Hashes of every asset of a campaign, by id. */
async function assetHashes(target: TableMapDb, campaignId: string) {
  const out: Record<string, { kind: string; type: string; hash: string }> = {};
  for (const id of await listAssetIds(target, campaignId)) {
    const record = (await getAsset(target, id))!;
    out[id] = { kind: record.kind, type: record.blob.type, hash: await sha256(record.blob) };
  }
  return out;
}

/** Drops the database and opens a fresh, empty one under the same name. */
async function wipeDatabase(): Promise<void> {
  await db.delete();
  db = new TableMapDb(dbName);
}

/** Builds an archive by hand, for import edge cases. */
async function buildArchive(
  envelope: unknown,
  files: Record<string, Uint8Array> = {}
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    ARCHIVE_DOCUMENT_PATH,
    typeof envelope === "string" ? envelope : JSON.stringify(envelope)
  );
  for (const [path, data] of Object.entries(files)) zip.file(path, data, { binary: true });
  return zip.generateAsync({ type: "uint8array" });
}

function envelopeFor(campaign: unknown, assets: unknown[] = []): Record<string, unknown> {
  return {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exportedAt: 1,
    campaign,
    assets,
  };
}

async function expectImportFailure(source: Uint8Array, reason: ImportFailure) {
  const before = { campaigns: await db.campaigns.count(), assets: await db.assets.count() };
  let caught: unknown;
  try {
    await importCampaign(db, source);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CampaignImportError);
  expect((caught as CampaignImportError).reason).toBe(reason);
  expect((caught as CampaignImportError).message.length).toBeGreaterThan(10);
  // A failed import writes nothing.
  expect(await db.campaigns.count()).toBe(before.campaigns);
  expect(await db.assets.count()).toBe(before.assets);
}

// ---- export ---------------------------------------------------------------

describe("exportCampaign", () => {
  it("writes campaign.json plus one portable file per referenced asset under assets/", async () => {
    const campaign = await seedCampaign(db);
    // An asset nothing references is not exported.
    await putAsset(db, { id: "orphan", campaignId: "cos", kind: "map-image", blob: blob(9, "image/png") });

    const result = await exportCampaign(db, "cos", { now: 42 });
    expect(result.blob.type).toBe("application/zip");
    expect(result.fileName).toBe("Curse-of-Strahd.tablemap.zip");
    expect(result.assetCount).toBe(4);
    expect(result.missingAssetIds).toEqual([]);

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toEqual([
      "assets/0001-map-image.png",
      "assets/0002-fog-mask.png",
      "assets/0003-token-image.jpg",
      "assets/0004-splash-image.webp",
      "campaign.json",
    ]);
    // Cross-OS safe names: ASCII, forward slashes, no traversal, no absolute paths.
    for (const name of names) {
      expect(name).toMatch(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/);
      expect(name).not.toContain("..");
    }

    const envelope = JSON.parse(await zip.file("campaign.json")!.async("string")) as ArchiveEnvelope;
    expect(envelope.format).toBe(ARCHIVE_FORMAT);
    expect(envelope.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(envelope.exportedAt).toBe(42);
    expect(envelope.campaign).toEqual(campaign);
    expect(envelope.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(envelope.assets).toEqual([
      { id: "img-1", kind: "map-image", type: "image/png", path: "assets/0001-map-image.png" },
      { id: "fog-1", kind: "fog-mask", type: "image/png", path: "assets/0002-fog-mask.png" },
      { id: "tok-1", kind: "token-image", type: "image/jpeg", path: "assets/0003-token-image.jpg" },
      { id: "splash-1", kind: "splash-image", type: "image/webp", path: "assets/0004-splash-image.webp" },
    ]);
    // The files hold the exact bytes.
    expect(await zip.file("assets/0001-map-image.png")!.async("uint8array")).toEqual(bytes(1));
    expect(await zip.file("assets/0004-splash-image.webp")!.async("uint8array")).toEqual(bytes(4));
  });

  it("reports referenced assets that are missing from storage and exports the rest", async () => {
    await seedCampaign(db);
    await db.assets.delete("tok-1");
    const result = await exportCampaign(db, "cos");
    expect(result.missingAssetIds).toEqual(["tok-1"]);
    expect(result.assetCount).toBe(3);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => n.startsWith("assets/") && !zip.files[n].dir)).toHaveLength(3);
  });

  it("fails clearly for an unknown campaign", async () => {
    await expect(exportCampaign(db, "nope")).rejects.toThrow(/no longer exists/);
  });
});

// ---- round trip -----------------------------------------------------------

describe("export -> wipe IndexedDB -> import", () => {
  it("restores the campaign byte-equivalent: state deep-equal, blobs hash-equal", async () => {
    const original = await seedCampaign(db);
    const originalHashes = await assetHashes(db, "cos");
    expect(Object.keys(originalHashes)).toHaveLength(4);

    const { blob: archive } = await exportCampaign(db, "cos");

    await wipeDatabase();
    expect(await db.campaigns.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);

    const result = await importCampaign(db, archive);
    expect(result).toMatchObject({ idChanged: false, remappedAssetIds: 0, assetCount: 4 });
    expect(result.campaign).toEqual(original);

    const restored = await loadCampaign(db, "cos");
    expect(restored).toEqual(original);
    expect(restored?.state).toEqual(fixtureState);
    expect(await db.campaigns.count()).toBe(1);

    const restoredHashes = await assetHashes(db, "cos");
    expect(restoredHashes).toEqual(originalHashes);
    for (const id of Object.keys(originalHashes)) {
      expect((await getAsset(db, id))?.campaignId).toBe("cos");
    }
  });

  it("accepts the archive as a Blob, an ArrayBuffer or a Uint8Array", async () => {
    const original = await seedCampaign(db);
    const { blob: archive } = await exportCampaign(db, "cos");
    const buffer = await archive.arrayBuffer();

    for (const source of [archive, buffer, new Uint8Array(buffer)]) {
      await wipeDatabase();
      const { campaign } = await importCampaign(db, source);
      expect(campaign).toEqual(original);
      expect(await assetHashes(db, "cos")).toEqual(
        Object.fromEntries(
          await Promise.all(
            FIXTURE_ASSETS.map(async (a) => [
              a.id,
              { kind: a.kind, type: a.type, hash: await sha256(blob(a.seed, a.type)) },
            ])
          )
        )
      );
    }
  });

  it("survives the archive being re-read from disk bytes (no reliance on the exporting Blob)", async () => {
    await seedCampaign(db);
    const { blob: archive } = await exportCampaign(db, "cos");
    // Copy the bytes as a file transfer between machines would.
    const copy = new Uint8Array(await archive.arrayBuffer()).slice();
    await wipeDatabase();
    const { campaign } = await importCampaign(db, copy);
    expect(campaign.state.maps[0].annotations).toEqual(imageMap.annotations);
    expect(campaign.state.maps[0].fogOps).toEqual(fogOps);
  });
});

// ---- id clashes -----------------------------------------------------------

describe("importCampaign id clashes", () => {
  it("imports as a copy under a new id when the campaign already exists, leaving the original alone", async () => {
    const original = await seedCampaign(db);
    const { blob: archive } = await exportCampaign(db, "cos");
    await saveCampaignState(db, "cos", { ...fixtureState, campaignName: "Renamed since" }, 5);

    let n = 0;
    const result = await importCampaign(db, archive, { newId: () => `new-${++n}` });
    expect(result.idChanged).toBe(true);
    expect(result.campaign.id).toBe("new-1");
    // Every asset id clashed with the original's, so all four are re-keyed...
    expect(result.remappedAssetIds).toBe(4);
    const state = result.campaign.state;
    expect(state.maps[0].imageAssetId).toBe("new-2");
    expect(state.maps[0].fogMaskAssetId).toBe("new-3");
    expect(state.maps[0].tokens[0].appearance).toEqual({ type: "image", assetId: "new-4" });
    expect(state.splashImageAssetId).toBe("new-5");
    // ...and nothing else about the state changed.
    expect({ ...state, maps: [{ ...state.maps[0], imageAssetId: "img-1", fogMaskAssetId: "fog-1", tokens: [{ ...state.maps[0].tokens[0], appearance: { type: "image", assetId: "tok-1" } }, state.maps[0].tokens[1]] }, state.maps[1]], splashImageAssetId: "splash-1" }).toEqual(fixtureState);
    expect(await loadCampaign(db, "new-1")).toEqual({ ...original, id: "new-1", state });

    // The copy's blobs are the exported ones, owned by the copy.
    const copyHashes = await assetHashes(db, "new-1");
    expect(Object.keys(copyHashes).sort()).toEqual(["new-2", "new-3", "new-4", "new-5"]);
    expect(copyHashes["new-2"].hash).toBe(await sha256(blob(1, "image/png")));
    expect(copyHashes["new-4"]).toEqual({ kind: "token-image", type: "image/jpeg", hash: await sha256(blob(3, "image/jpeg")) });

    // The original is untouched.
    const kept = await loadCampaign(db, "cos");
    expect(kept?.state.campaignName).toBe("Renamed since");
    expect(kept?.state.maps[0].imageAssetId).toBe("img-1");
    expect(Object.keys(await assetHashes(db, "cos")).sort()).toEqual(["fog-1", "img-1", "splash-1", "tok-1"]);
    expect(await db.campaigns.count()).toBe(2);
  });

  it("keeps the campaign id but re-keys assets whose ids another campaign already uses", async () => {
    await seedCampaign(db);
    const { blob: archive } = await exportCampaign(db, "cos");
    await wipeDatabase();
    await createCampaign(db, "Other", { id: "other" });
    await putAsset(db, { id: "img-1", campaignId: "other", kind: "map-image", blob: blob(77, "image/png") });

    const result = await importCampaign(db, archive, { newId: () => "fresh" });
    expect(result).toMatchObject({ idChanged: false, remappedAssetIds: 1, assetCount: 4 });
    expect(result.campaign.id).toBe("cos");
    expect(result.campaign.state.maps[0].imageAssetId).toBe("fresh");
    expect(result.campaign.state.maps[0].fogMaskAssetId).toBe("fog-1");

    const fresh = await getAsset(db, "fresh");
    expect(fresh).toMatchObject({ campaignId: "cos", kind: "map-image" });
    expect(await sha256(fresh!.blob)).toBe(await sha256(blob(1, "image/png")));
    // The other campaign's asset is exactly as it was.
    const theirs = await getAsset(db, "img-1");
    expect(theirs?.campaignId).toBe("other");
    expect(await sha256(theirs!.blob)).toBe(await sha256(blob(77, "image/png")));
  });
});

// ---- migration ------------------------------------------------------------

describe("importCampaign migration", () => {
  it("brings a schema v1 archive forward to the current schema", async () => {
    const v1Campaign = {
      schemaVersion: 1,
      id: "old",
      name: "Old",
      createdAt: 1,
      updatedAt: 2,
      state: {
        campaignName: "Old",
        maps: [
          {
            id: "m1",
            name: "Crypt",
            imageAssetId: "img",
            width: 100,
            height: 80,
            grid: { cellSize: 64, offsetX: 3, offsetY: 9, visible: false, color: "#ff0000", opacity: 0.5 },
            fogMaskAssetId: null,
            tokens: [],
            annotations: [],
          },
        ],
        activeMapId: "m1",
      },
    };
    const archive = await buildArchive(
      envelopeFor(v1Campaign, [{ id: "img", kind: "map-image", type: "image/png", path: "assets/0001-map-image.png" }]),
      { "assets/0001-map-image.png": bytes(5) }
    );

    const { campaign } = await importCampaign(db, archive);
    expect(campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(campaign.state.splashImageAssetId).toBeNull();
    expect(campaign.state.maps[0]).toMatchObject({
      backgroundColor: expect.any(String),
      grid: {
        cellSize: 64,
        offsetX: 3,
        offsetY: 9,
        dm: { visible: false, color: "#ff0000", opacity: 0.5 },
        player: { visible: false, color: "#ff0000", opacity: 0.5 },
      },
      fogOps: [],
      fogOpsFrom: 0,
    });
    expect(await loadCampaign(db, "old")).toEqual(campaign);
    const asset = await getAsset(db, "img");
    expect(asset).toMatchObject({ campaignId: "old", kind: "map-image" });
    expect(asset?.blob.type).toBe("image/png");
    expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(bytes(5));
  });
});

// ---- errors ---------------------------------------------------------------

describe("importCampaign errors (clear, typed, nothing written)", () => {
  const current = () => newCampaign("Fine", { id: "fine", now: 1 });

  it("a file that is not a zip", async () => {
    await expectImportFailure(new TextEncoder().encode("definitely not a zip"), "not-a-zip");
    await expectImportFailure(new Uint8Array(0), "not-a-zip");
    await expectImportFailure(bytes(3, 2048), "not-a-zip");
  });

  it("a zip without campaign.json", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "hello");
    await expectImportFailure(await zip.generateAsync({ type: "uint8array" }), "no-document");
  });

  it("a campaign.json that is not JSON", async () => {
    await expectImportFailure(await buildArchive("{ nope"), "bad-json");
  });

  it("a JSON file that is not a TableMap export", async () => {
    await expectImportFailure(await buildArchive({ hello: 1 }), "not-a-campaign");
    await expectImportFailure(await buildArchive(current()), "not-a-campaign");
    await expectImportFailure(await buildArchive([1, 2]), "not-a-campaign");
    await expectImportFailure(
      await buildArchive({ ...envelopeFor(current()), formatVersion: "1" }),
      "not-a-campaign"
    );
  });

  it("an archive from a newer format version", async () => {
    await expectImportFailure(
      await buildArchive({ ...envelopeFor(current()), formatVersion: ARCHIVE_FORMAT_VERSION + 1 }),
      "newer-format"
    );
  });

  it("a campaign saved by a newer schema", async () => {
    await expectImportFailure(
      await buildArchive(envelopeFor({ ...current(), schemaVersion: SCHEMA_VERSION + 1 })),
      "newer-schema"
    );
  });

  it("a corrupt campaign document", async () => {
    await expectImportFailure(await buildArchive(envelopeFor({ schemaVersion: SCHEMA_VERSION, id: "x" })), "invalid");
    await expectImportFailure(await buildArchive(envelopeFor(null)), "invalid");
    await expectImportFailure(
      await buildArchive(envelopeFor({ ...current(), state: { campaignName: 1 } })),
      "invalid"
    );
  });

  it("a manifest with path tricks or unknown kinds", async () => {
    const entry = (path: string, kind = "map-image") => ({ id: "a", kind, type: "image/png", path });
    for (const path of [
      "../evil.png",
      "assets/../campaign.json",
      "assets/sub/x.png",
      "assets\\x.png",
      "/etc/passwd",
      "C:\\x.png",
      "assets/.hidden",
      "assets/",
      "x.png",
      "assets/ünïcode.png",
    ]) {
      // The manifest is rejected before any file is looked up, so no file is planted.
      await expectImportFailure(await buildArchive(envelopeFor(current(), [entry(path)])), "bad-manifest");
    }
    await expectImportFailure(
      await buildArchive(envelopeFor(current(), [entry("assets/0001-x.png", "virus")])),
      "bad-manifest"
    );
    await expectImportFailure(await buildArchive({ ...envelopeFor(current()), assets: "none" }), "bad-manifest");
    // Duplicate ids or paths.
    await expectImportFailure(
      await buildArchive(envelopeFor(current(), [entry("assets/1.png"), entry("assets/2.png")]), {
        "assets/1.png": bytes(1),
        "assets/2.png": bytes(2),
      }),
      "bad-manifest"
    );
  });

  it("a manifest naming a file the archive does not contain", async () => {
    await expectImportFailure(
      await buildArchive(envelopeFor(current(), [{ id: "a", kind: "map-image", type: "image/png", path: "assets/0001-map-image.png" }])),
      "missing-asset"
    );
  });

  it("a corrupted zip (CRC mismatch)", async () => {
    await seedCampaign(db);
    const { blob: archive } = await exportCampaign(db, "cos");
    await wipeDatabase();
    const corrupt = new Uint8Array(await archive.arrayBuffer());
    // Flip bytes inside the first stored asset (the local header is ~30 bytes + name).
    for (let i = 60; i < 80; i++) corrupt[i] ^= 0xff;
    let caught: unknown;
    try {
      await importCampaign(db, corrupt);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CampaignImportError);
    expect(await db.campaigns.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
  });
});

// ---- names ----------------------------------------------------------------

describe("archiveFileName", () => {
  it("reduces the campaign name to a portable file name", () => {
    expect(archiveFileName("Curse of Strahd")).toBe("Curse-of-Strahd.tablemap.zip");
    expect(archiveFileName("  Tomb   of Annihilation ")).toBe("Tomb-of-Annihilation.tablemap.zip");
    expect(archiveFileName("Löwen/héros: éé?")).toBe("Lowenheros-ee.tablemap.zip");
    expect(archiveFileName("../../etc\\passwd")).toBe("etcpasswd.tablemap.zip");
    expect(archiveFileName("")).toBe("campaign.tablemap.zip");
    expect(archiveFileName("日本語")).toBe("campaign.tablemap.zip");
    expect(archiveFileName("---")).toBe("campaign.tablemap.zip");
  });

  it("avoids Windows reserved base names and very long names", () => {
    expect(archiveFileName("CON")).toBe("campaign-CON.tablemap.zip");
    expect(archiveFileName("lpt1")).toBe("campaign-lpt1.tablemap.zip");
    const long = archiveFileName("x".repeat(200));
    expect(long).toBe(`${"x".repeat(60)}.tablemap.zip`);
  });
});
