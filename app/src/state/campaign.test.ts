import {
  isCampaign,
  LEGACY_MAP_BACKGROUND,
  migrateCampaign,
  newCampaign,
  summarize,
  type Campaign,
} from "./campaign";
import { defaultGridSettings, SCHEMA_VERSION } from "./model";
import { initialSharedState } from "./shared";

describe("campaign document", () => {
  it("newCampaign stamps the schema version, timestamps and name", () => {
    const c = newCampaign("Strahd", { id: "c1", now: 1234 });
    expect(c).toEqual({
      schemaVersion: SCHEMA_VERSION,
      id: "c1",
      name: "Strahd",
      createdAt: 1234,
      updatedAt: 1234,
      state: { ...initialSharedState(), campaignName: "Strahd" },
    });
    expect(isCampaign(c)).toBe(true);
  });

  it("newCampaign generates distinct ids by default", () => {
    expect(newCampaign("a").id).not.toBe(newCampaign("a").id);
  });

  it("name wins over the campaign name inside a provided state", () => {
    const c = newCampaign("Given", {
      state: { ...initialSharedState(), campaignName: "Ignored" },
    });
    expect(c.state.campaignName).toBe("Given");
  });

  it("summarize drops the state", () => {
    const c = newCampaign("S", { id: "x", now: 5 });
    expect(summarize(c)).toEqual({ id: "x", name: "S", createdAt: 5, updatedAt: 5 });
    expect("state" in summarize(c)).toBe(false);
  });

  it("isCampaign rejects other versions and broken shapes", () => {
    const c = newCampaign("S");
    expect(isCampaign({ ...c, schemaVersion: SCHEMA_VERSION + 1 })).toBe(false);
    expect(isCampaign({ ...c, state: { campaignName: "S" } })).toBe(false);
    expect(isCampaign({ ...c, id: "" })).toBe(false);
    expect(isCampaign({ ...c, createdAt: "yesterday" })).toBe(false);
    expect(isCampaign(null)).toBe(false);
  });

  it("migrateCampaign passes current documents through untouched", () => {
    const c: Campaign = newCampaign("S", { id: "c1", now: 1 });
    expect(migrateCampaign(c)).toEqual({ ok: true, campaign: c, migrated: false });
  });

  /** The flat grid shape written by schema v1 and v2. */
  const legacyGrid = {
    cellSize: 64,
    offsetX: 3,
    offsetY: 9,
    visible: false,
    color: "#ff0000",
    opacity: 0.5,
  };
  const migratedGrid = {
    cellSize: 64,
    offsetX: 3,
    offsetY: 9,
    dm: { visible: false, color: "#ff0000", opacity: 0.5 },
    player: { visible: false, color: "#ff0000", opacity: 0.5 },
  };
  const legacyMap = (overrides: Record<string, unknown> = {}) => ({
    id: "m1",
    name: "Crypt",
    imageAssetId: "img",
    width: 100,
    height: 80,
    grid: legacyGrid,
    fogMaskAssetId: null,
    tokens: [],
    annotations: [],
    ...overrides,
  });
  const document = (schemaVersion: number, map: Record<string, unknown>) => ({
    schemaVersion,
    id: "c1",
    name: "Old",
    createdAt: 1,
    updatedAt: 2,
    state: { campaignName: "Old", maps: [map], activeMapId: "m1" },
  });

  it("migrateCampaign brings a v1 document (maps without backgroundColor, flat grid) to the current schema", () => {
    const v1Map = legacyMap();
    const raw = document(1, v1Map);
    const result = migrateCampaign(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.campaign.state.maps[0]).toEqual({
      ...v1Map,
      backgroundColor: LEGACY_MAP_BACKGROUND,
      grid: migratedGrid,
      fogOps: [],
      fogOpsFrom: 0,
    });
    expect(isCampaign(result.campaign)).toBe(true);
    // Input untouched.
    expect("backgroundColor" in raw.state.maps[0]).toBe(false);
    expect(raw.state.maps[0].grid).toEqual(legacyGrid);
  });

  it("migrateCampaign v2 -> v3 copies the single grid style into both views (ADR 0010)", () => {
    const v2Map = legacyMap({ backgroundColor: "#123456" });
    const result = migrateCampaign(document(2, v2Map));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    const grid = result.campaign.state.maps[0].grid;
    expect(grid).toEqual(migratedGrid);
    expect(grid.dm).not.toBe(grid.player);
    expect(result.campaign.state.maps[0].backgroundColor).toBe("#123456");
    // Keys of the flat style are gone from the geometry level.
    expect("visible" in grid).toBe(false);
    expect(isCampaign(result.campaign)).toBe(true);
  });

  it("migrateCampaign v2 -> v3 rejects a document whose grid is unusable", () => {
    const result = migrateCampaign(
      document(2, legacyMap({ backgroundColor: "#000", grid: { cellSize: 50 } }))
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("migrateCampaign v3 -> v4 gives every map an empty fog log at history index 0 (ADR 0012)", () => {
    const v3Map = legacyMap({ backgroundColor: "#000", grid: migratedGrid });
    const result = migrateCampaign(document(3, v3Map));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.campaign.state.maps[0]).toEqual({ ...v3Map, fogOps: [], fogOpsFrom: 0 });
    expect(isCampaign(result.campaign)).toBe(true);
    expect("fogOps" in v3Map).toBe(false);

    // A log already present (however the version got there) is kept.
    const ops = [{ type: "fill", mode: "reveal" }];
    const kept = migrateCampaign(
      document(3, legacyMap({ backgroundColor: "#000", grid: migratedGrid, fogOps: ops, fogOpsFrom: 5 }))
    );
    expect(kept.ok && kept.campaign.state.maps[0].fogOps).toEqual(ops);
    expect(kept.ok && kept.campaign.state.maps[0].fogOpsFrom).toBe(5);
  });

  it("migrateCampaign leaves a current-shape grid alone even if the version says 2", () => {
    const grid = defaultGridSettings();
    const result = migrateCampaign(document(2, legacyMap({ backgroundColor: "#000", grid })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaign.state.maps[0].grid).toEqual(grid);
  });

  it("migrateCampaign v4 -> v5 keeps the state as is (ADR 0013: only the fog op vocabulary grew)", () => {
    const v4Map = {
      ...legacyMap({ backgroundColor: "#000", grid: migratedGrid }),
      fogOps: [{ type: "shape", mode: "reveal", shape: { kind: "rect", x: 0, y: 0, width: 1, height: 1 } }],
      fogOpsFrom: 2,
    };
    const result = migrateCampaign(document(4, v4Map));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.campaign.state.maps[0]).toEqual(v4Map);
    expect(isCampaign(result.campaign)).toBe(true);
  });

  it("migrateCampaign v5 -> v6 gives the campaign a null splash image (ADR 0014)", () => {
    const v5Map = { ...legacyMap({ backgroundColor: "#000", grid: migratedGrid }), fogOps: [], fogOpsFrom: 0 };
    const raw = document(5, v5Map);
    const result = migrateCampaign(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.campaign.state).toEqual({ ...raw.state, splashImageAssetId: null });
    expect(isCampaign(result.campaign)).toBe(true);
    expect("splashImageAssetId" in raw.state).toBe(false);

    // A splash image already present is kept.
    const kept = migrateCampaign({
      ...document(5, v5Map),
      state: { ...raw.state, splashImageAssetId: "splash" },
    });
    expect(kept.ok && kept.campaign.state.splashImageAssetId).toBe("splash");
  });

  it("migrateCampaign refuses documents from a newer schema", () => {
    const c = { ...newCampaign("S"), schemaVersion: SCHEMA_VERSION + 1 };
    expect(migrateCampaign(c)).toEqual({ ok: false, reason: "newer-schema" });
  });

  it("migrateCampaign reports invalid documents without throwing", () => {
    for (const raw of [null, 42, {}, { schemaVersion: "1" }, { schemaVersion: 0 }]) {
      expect(migrateCampaign(raw)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(migrateCampaign({ ...newCampaign("S"), state: {} })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
