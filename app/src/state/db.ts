/**
 * IndexedDB schema via Dexie (ADR 0007).
 *
 * - `campaigns`: one `Campaign` document per row (JSON only, no Blobs).
 * - `assets`: binary data referenced from documents by `AssetId` — map
 *   images, token images, fog-mask PNGs — stored as Blobs so large images are
 *   never serialised into the JSON document.
 * - `settings`: small key/value pairs (last opened campaign; later, per-display
 *   calibration).
 *
 * Bumping the Dexie `version(n)` is for *index* changes. Changes to the
 * document shape are handled by `SCHEMA_VERSION` + `migrateCampaign`.
 */
import Dexie, { type EntityTable } from "dexie";
import type { Campaign } from "./campaign";
import type { AssetId, AssetKind } from "./model";

export const DB_NAME = "tablemap";

export type { AssetKind } from "./model";

export interface AssetRecord {
  id: AssetId;
  /** Owning campaign; assets are deleted with it. */
  campaignId: string;
  kind: AssetKind;
  blob: Blob;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class TableMapDb extends Dexie {
  campaigns!: EntityTable<Campaign, "id">;
  assets!: EntityTable<AssetRecord, "id">;
  settings!: EntityTable<SettingRecord, "key">;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      campaigns: "id, name, updatedAt",
      assets: "id, campaignId",
      settings: "key",
    });
  }
}

let appDb: TableMapDb | undefined;

/** The app-wide database. Tests construct their own `TableMapDb` per test. */
export function getDb(): TableMapDb {
  appDb ??= new TableMapDb();
  return appDb;
}
