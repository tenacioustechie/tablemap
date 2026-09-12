import {
  isCampaign,
  migrateCampaign,
  newCampaign,
  summarize,
  type Campaign,
} from "./campaign";
import { SCHEMA_VERSION } from "./model";
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
