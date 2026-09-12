/**
 * The persisted campaign document (ADR 0007): metadata + the `SharedState`
 * the DM store holds at runtime. This is exactly what IndexedDB stores and
 * what a zip export will carry as `campaign.json`.
 *
 * Every document records the `SCHEMA_VERSION` it was written with.
 * `migrateCampaign` brings older documents forward and refuses newer ones, so
 * an old build never silently loads a document it does not understand.
 */
import { nanoid } from "nanoid";
import { SCHEMA_VERSION, isFiniteNumber, isNonEmptyString } from "./model";
import { initialSharedState, isSharedState, type SharedState } from "./shared";

export interface Campaign {
  schemaVersion: number;
  id: string;
  /** Denormalised copy of `state.campaignName`, indexed for listing. */
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  state: SharedState;
}

/** What the campaign manager lists; never carries the state. */
export interface CampaignSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_CAMPAIGN_NAME = "Untitled campaign";

export interface NewCampaignOptions {
  id?: string;
  now?: number;
  state?: SharedState;
}

/** Builds a fresh campaign document. `name` wins over `state.campaignName`. */
export function newCampaign(
  name: string,
  { id = nanoid(), now = Date.now(), state }: NewCampaignOptions = {}
): Campaign {
  const base = state ?? initialSharedState();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    state: { ...base, campaignName: name },
  };
}

export function summarize(campaign: Campaign): CampaignSummary {
  const { id, name, createdAt, updatedAt } = campaign;
  return { id, name, createdAt, updatedAt };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Structural check of a campaign document at the current schema version. */
export function isCampaign(x: unknown): x is Campaign {
  return (
    isRecord(x) &&
    x.schemaVersion === SCHEMA_VERSION &&
    isNonEmptyString(x.id) &&
    typeof x.name === "string" &&
    isFiniteNumber(x.createdAt) &&
    isFiniteNumber(x.updatedAt) &&
    isSharedState(x.state)
  );
}

export type MigrationFailure = "invalid" | "newer-schema";

export type MigrationResult =
  | { ok: true; campaign: Campaign; migrated: boolean }
  | { ok: false; reason: MigrationFailure };

/**
 * Brings a stored document up to `SCHEMA_VERSION`. Never throws. Add a
 * `case N:` block per historical version when the schema changes; each block
 * rewrites version N to N+1 and falls through to the next.
 */
export function migrateCampaign(raw: unknown): MigrationResult {
  if (!isRecord(raw) || !isFiniteNumber(raw.schemaVersion)) {
    return { ok: false, reason: "invalid" };
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, reason: "newer-schema" };
  }
  const migrated = raw.schemaVersion < SCHEMA_VERSION;
  const doc: Record<string, unknown> = { ...raw };
  switch (doc.schemaVersion) {
    case 1:
      doc.state = migrateStateV1toV2(doc.state);
      doc.schemaVersion = 2;
    // falls through
  }
  if (!isCampaign(doc)) return { ok: false, reason: "invalid" };
  return { ok: true, campaign: doc, migrated };
}

/** Colour given to maps written before `backgroundColor` existed. */
export const LEGACY_MAP_BACKGROUND = "#3b3b3b";

/** v1 -> v2: every map gains `backgroundColor`. Unknown shapes pass through untouched. */
function migrateStateV1toV2(state: unknown): unknown {
  if (!isRecord(state) || !Array.isArray(state.maps)) return state;
  return {
    ...state,
    maps: state.maps.map((map: unknown) =>
      isRecord(map) && !("backgroundColor" in map)
        ? { ...map, backgroundColor: LEGACY_MAP_BACKGROUND }
        : map
    ),
  };
}
