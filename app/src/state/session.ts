/**
 * Glue between storage and the DM store (ADR 0007): opening a stored campaign
 * into the store and choosing what to open on start. Pure async logic with
 * the store and database injected; the React side lives in `dm/DmRoute.tsx`.
 */
import type { TableMapDb } from "./db";
import {
  loadCampaign,
  resolveStartupCampaign,
  setLastCampaignId,
} from "./persistence";
import type { TableStore } from "./store";

/** Loads `id`, makes it the store's campaign and remembers it as last opened. */
export async function openStoredCampaign(
  store: TableStore,
  db: TableMapDb,
  id: string
): Promise<boolean> {
  const campaign = await loadCampaign(db, id);
  if (!campaign) return false;
  store.getState().openCampaign(campaign);
  await setLastCampaignId(db, campaign.id);
  return true;
}

const inFlight = new WeakMap<TableStore, Promise<void>>();

/**
 * Load-on-start. Does nothing when the store already has a campaign open
 * (e.g. the campaign manager opened one before navigating here). Concurrent
 * calls for the same store share one promise, so React StrictMode's double
 * effect cannot create two default campaigns.
 */
export function bootstrapCampaign(
  store: TableStore,
  db: TableMapDb
): Promise<void> {
  if (store.getState().campaignId !== null) return Promise.resolve();
  const existing = inFlight.get(store);
  if (existing) return existing;
  const run = (async () => {
    const campaign = await resolveStartupCampaign(db);
    if (store.getState().campaignId === null) {
      store.getState().openCampaign(campaign);
    }
    const opened = store.getState().campaignId ?? campaign.id;
    await setLastCampaignId(db, opened);
  })().finally(() => inFlight.delete(store));
  inFlight.set(store, run);
  return run;
}
