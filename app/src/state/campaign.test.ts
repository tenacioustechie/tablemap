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

  it("migrateCampaign brings a v1 document (maps without backgroundColor) to the current schema", () => {
    const v1Map = {
      id: "m1",
      name: "Crypt",
      imageAssetId: "img",
      width: 100,
      height: 80,
      grid: defaultGridSettings(),
      fogMaskAssetId: null,
      tokens: [],
      annotations: [],
    };
    const raw = {
      schemaVersion: 1,
      id: "c1",
      name: "Old",
      createdAt: 1,
      updatedAt: 2,
      state: { campaignName: "Old", maps: [v1Map], activeMapId: "m1" },
    };
    const result = migrateCampaign(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.campaign.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.campaign.state.maps[0]).toEqual({
      ...v1Map,
      backgroundColor: LEGACY_MAP_BACKGROUND,
    });
    expect(isCampaign(result.campaign)).toBe(true);
    // Input untouched.
    expect("backgroundColor" in raw.state.maps[0]).toBe(false);
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
