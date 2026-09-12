/**
 * Campaign persistence on top of `TableMapDb` (ADR 0007). Plain async
 * functions; every one takes the database so tests can use a throwaway one.
 *
 * Documents go in as-is and come out through `migrateCampaign`, so callers
 * only ever see the current `SCHEMA_VERSION`. Migrated documents are written
 * back immediately.
 */
import { nanoid } from "nanoid";
import {
  isCellUnit,
  isDisplayCalibration,
  type CellUnit,
  type DisplayCalibration,
} from "./calibration";
import {
  DEFAULT_CAMPAIGN_NAME,
  migrateCampaign,
  newCampaign,
  summarize,
  type Campaign,
  type CampaignSummary,
  type MigrationFailure,
  type NewCampaignOptions,
} from "./campaign";
import type { AssetKind, AssetRecord, TableMapDb } from "./db";
import type { AssetId } from "./model";
import type { SharedState } from "./shared";

export class CampaignLoadError extends Error {
  constructor(
    public readonly campaignId: string,
    public readonly reason: MigrationFailure
  ) {
    super(
      reason === "newer-schema"
        ? `Campaign ${campaignId} was saved by a newer version of TableMap.`
        : `Campaign ${campaignId} is corrupt.`
    );
    this.name = "CampaignLoadError";
  }
}

const LAST_CAMPAIGN_KEY = "lastCampaignId";

// ---- campaigns ------------------------------------------------------------

/** Most recently updated first. */
export async function listCampaigns(
  db: TableMapDb
): Promise<CampaignSummary[]> {
  const rows = await db.campaigns.orderBy("updatedAt").reverse().toArray();
  return rows.map(summarize);
}

export async function createCampaign(
  db: TableMapDb,
  name: string,
  options?: NewCampaignOptions
): Promise<Campaign> {
  const campaign = newCampaign(name, options);
  await db.campaigns.add(campaign);
  return campaign;
}

/** Resolves undefined when there is no such campaign. Throws `CampaignLoadError` on bad documents. */
export async function loadCampaign(
  db: TableMapDb,
  id: string
): Promise<Campaign | undefined> {
  const raw: unknown = await db.campaigns.get(id);
  if (raw === undefined) return undefined;
  const result = migrateCampaign(raw);
  if (!result.ok) throw new CampaignLoadError(id, result.reason);
  if (result.migrated) await db.campaigns.put(result.campaign);
  return result.campaign;
}

/** Writes the whole document, stamping `updatedAt`. */
export async function saveCampaign(
  db: TableMapDb,
  campaign: Campaign,
  now: number = Date.now()
): Promise<Campaign> {
  const saved: Campaign = {
    ...campaign,
    name: campaign.state.campaignName,
    updatedAt: now,
  };
  await db.campaigns.put(saved);
  return saved;
}

/**
 * Replaces the state of an existing document (what autosave does). Resolves
 * false if the campaign no longer exists, e.g. it was deleted while open.
 */
export async function saveCampaignState(
  db: TableMapDb,
  id: string,
  state: SharedState,
  now: number = Date.now()
): Promise<boolean> {
  const updated = await db.campaigns.update(id, {
    state,
    name: state.campaignName,
    updatedAt: now,
  });
  return updated > 0;
}

export async function renameCampaign(
  db: TableMapDb,
  id: string,
  name: string,
  now: number = Date.now()
): Promise<boolean> {
  return db.transaction("rw", db.campaigns, async () => {
    const existing = await db.campaigns.get(id);
    if (!existing) return false;
    await db.campaigns.put({
      ...existing,
      name,
      updatedAt: now,
      state: { ...existing.state, campaignName: name },
    });
    return true;
  });
}

/** Removes the document, all its assets, and the last-opened pointer if it matched. */
export async function deleteCampaign(
  db: TableMapDb,
  id: string
): Promise<void> {
  await db.transaction(
    "rw",
    [db.campaigns, db.assets, db.settings],
    async () => {
      await db.assets.where("campaignId").equals(id).delete();
      await db.campaigns.delete(id);
      const last = await db.settings.get(LAST_CAMPAIGN_KEY);
      if (last?.value === id) await db.settings.delete(LAST_CAMPAIGN_KEY);
    }
  );
}

// ---- assets ---------------------------------------------------------------

export interface PutAssetInput {
  id?: AssetId;
  campaignId: string;
  kind: AssetKind;
  blob: Blob;
}

/** Stores a Blob and returns its id. Documents reference assets by this id only. */
export async function putAsset(
  db: TableMapDb,
  { id = nanoid(), campaignId, kind, blob }: PutAssetInput
): Promise<AssetId> {
  await db.assets.put({ id, campaignId, kind, blob });
  return id;
}

export async function getAsset(
  db: TableMapDb,
  id: AssetId
): Promise<AssetRecord | undefined> {
  return db.assets.get(id);
}

export async function deleteAsset(db: TableMapDb, id: AssetId): Promise<void> {
  await db.assets.delete(id);
}

export async function listAssetIds(
  db: TableMapDb,
  campaignId: string
): Promise<AssetId[]> {
  return db.assets.where("campaignId").equals(campaignId).primaryKeys();
}

// ---- settings -------------------------------------------------------------

export async function getLastCampaignId(
  db: TableMapDb
): Promise<string | null> {
  const row = await db.settings.get(LAST_CAMPAIGN_KEY);
  return typeof row?.value === "string" ? row.value : null;
}

export async function setLastCampaignId(
  db: TableMapDb,
  id: string | null
): Promise<void> {
  if (id === null) await db.settings.delete(LAST_CAMPAIGN_KEY);
  else await db.settings.put({ key: LAST_CAMPAIGN_KEY, value: id });
}

// ---- calibration (T006, ADR 0011) ------------------------------------------

const CALIBRATION_KEY_PREFIX = "calibration:";
const CELL_UNIT_KEY = "cellUnit";

/** Settings key for one display's calibration (`displayKey` of the display). */
export function calibrationSettingKey(displayKey: string): string {
  return CALIBRATION_KEY_PREFIX + displayKey;
}

/** Null when the display has never been calibrated (or the record is unreadable). */
export async function getDisplayCalibration(
  db: TableMapDb,
  displayKey: string
): Promise<DisplayCalibration | null> {
  const row = await db.settings.get(calibrationSettingKey(displayKey));
  return isDisplayCalibration(row?.value) ? row.value : null;
}

export async function setDisplayCalibration(
  db: TableMapDb,
  displayKey: string,
  calibration: DisplayCalibration | null
): Promise<void> {
  const key = calibrationSettingKey(displayKey);
  if (calibration === null) await db.settings.delete(key);
  else await db.settings.put({ key, value: { ...calibration } });
}

/** The physical cell size preference; "inch" until set. */
export async function getCellUnit(db: TableMapDb): Promise<CellUnit> {
  const row = await db.settings.get(CELL_UNIT_KEY);
  return isCellUnit(row?.value) ? row.value : "inch";
}

export async function setCellUnit(db: TableMapDb, unit: CellUnit): Promise<void> {
  await db.settings.put({ key: CELL_UNIT_KEY, value: unit });
}

// ---- start-up -------------------------------------------------------------

/**
 * The campaign the DM view opens on start: the last opened one if it still
 * exists, else the most recently updated, else a brand-new default campaign.
 * Corrupt/newer documents are skipped rather than blocking start-up; the
 * campaign manager surfaces them.
 */
export async function resolveStartupCampaign(
  db: TableMapDb
): Promise<Campaign> {
  const lastId = await getLastCampaignId(db);
  const candidates = [
    ...(lastId ? [lastId] : []),
    ...(await listCampaigns(db)).map((c) => c.id),
  ];
  for (const id of candidates) {
    try {
      const campaign = await loadCampaign(db, id);
      if (campaign) return campaign;
    } catch (error) {
      if (!(error instanceof CampaignLoadError)) throw error;
    }
  }
  return createCampaign(db, DEFAULT_CAMPAIGN_NAME);
}
