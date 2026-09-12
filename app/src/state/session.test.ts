// @vitest-environment node
import { nanoid } from "nanoid";
import { TableMapDb } from "./db";
import {
  createCampaign,
  getLastCampaignId,
  listCampaigns,
  setLastCampaignId,
} from "./persistence";
import { bootstrapCampaign, openStoredCampaign } from "./session";
import { createTableStore } from "./store";

let db: TableMapDb;

beforeEach(() => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
});

afterEach(async () => {
  await db.delete();
});

describe("openStoredCampaign", () => {
  it("loads into the store and remembers the id", async () => {
    const c = await createCampaign(db, "Strahd", { id: "c1" });
    const store = createTableStore();
    expect(await openStoredCampaign(store, db, "c1")).toBe(true);
    expect(store.getState().campaignId).toBe("c1");
    expect(store.getState().shared).toEqual(c.state);
    expect(await getLastCampaignId(db)).toBe("c1");
  });

  it("reports an unknown id and leaves the store alone", async () => {
    const store = createTableStore();
    expect(await openStoredCampaign(store, db, "nope")).toBe(false);
    expect(store.getState().campaignId).toBeNull();
    expect(store.getState().seq).toBe(0);
  });
});

describe("bootstrapCampaign", () => {
  it("opens the last campaign on a fresh store", async () => {
    const c = await createCampaign(db, "Resume me", { id: "r" });
    await setLastCampaignId(db, "r");
    const store = createTableStore();
    await bootstrapCampaign(store, db);
    expect(store.getState().campaignId).toBe("r");
    expect(store.getState().shared).toEqual(c.state);
  });

  it("creates and remembers a default campaign when storage is empty", async () => {
    const store = createTableStore();
    await bootstrapCampaign(store, db);
    const id = store.getState().campaignId;
    expect(id).not.toBeNull();
    expect(store.getState().shared.campaignName).toBe("Untitled campaign");
    expect(await getLastCampaignId(db)).toBe(id);
    expect(await listCampaigns(db)).toHaveLength(1);
  });

  it("is a no-op when a campaign is already open", async () => {
    const store = createTableStore();
    const c = await createCampaign(db, "Already", { id: "a" });
    store.getState().openCampaign(c);
    await bootstrapCampaign(store, db);
    expect(store.getState().campaignId).toBe("a");
    expect(store.getState().seq).toBe(1);
  });

  it("shares one run between concurrent callers (StrictMode double effect)", async () => {
    const store = createTableStore();
    await Promise.all([bootstrapCampaign(store, db), bootstrapCampaign(store, db)]);
    expect(await listCampaigns(db)).toHaveLength(1);
    expect(store.getState().seq).toBe(1);
  });
});
