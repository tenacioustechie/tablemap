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

/** One step of the migration chain: rewrites a version-`from` state to `from + 1`. */
const MIGRATION_STEPS: ReadonlyArray<{ from: number; migrate: (state: unknown) => unknown }> = [
  { from: 1, migrate: migrateStateV1toV2 },
  { from: 2, migrate: migrateStateV2toV3 },
  { from: 3, migrate: migrateStateV3toV4 },
  { from: 4, migrate: migrateStateV4toV5 },
  { from: 5, migrate: migrateStateV5toV6 },
  { from: 6, migrate: migrateStateV6toV7 },
];

/**
 * Brings a stored document up to `SCHEMA_VERSION`. Never throws. Add a step
 * to `MIGRATION_STEPS` per historical version when the schema changes; the
 * steps run in order, each rewriting version N to N+1.
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
  for (const step of MIGRATION_STEPS) {
    if (doc.schemaVersion === step.from) {
      doc.state = step.migrate(doc.state);
      doc.schemaVersion = step.from + 1;
    }
  }
  if (!isCampaign(doc)) return { ok: false, reason: "invalid" };
  return { ok: true, campaign: doc, migrated };
}

/** Colour given to maps written before `backgroundColor` existed. */
export const LEGACY_MAP_BACKGROUND = "#3b3b3b";

function mapMaps(state: unknown, f: (map: Record<string, unknown>) => unknown): unknown {
  if (!isRecord(state) || !Array.isArray(state.maps)) return state;
  return {
    ...state,
    maps: state.maps.map((map: unknown) => (isRecord(map) ? f(map) : map)),
  };
}

/** v1 -> v2: every map gains `backgroundColor`. Unknown shapes pass through untouched. */
function migrateStateV1toV2(state: unknown): unknown {
  return mapMaps(state, (map) =>
    "backgroundColor" in map ? map : { ...map, backgroundColor: LEGACY_MAP_BACKGROUND }
  );
}

/**
 * v2 -> v3 (ADR 0010): the single grid style (`visible`, `color`, `opacity`
 * on `grid`) becomes one style per view, `grid.dm` and `grid.player`, both
 * starting from the old values. Grids that already have the new shape pass
 * through untouched.
 */
function migrateStateV2toV3(state: unknown): unknown {
  return mapMaps(state, (map) => {
    const grid = map.grid;
    if (!isRecord(grid) || ("dm" in grid && "player" in grid)) return map;
    const { visible, color, opacity, ...geometry } = grid;
    const style = { visible, color, opacity };
    return { ...map, grid: { ...geometry, dm: style, player: { ...style } } };
  });
}

/**
 * v3 -> v4 (ADR 0012): every map gains the fog operation log `fogOps` and its
 * history index `fogOpsFrom`. Older maps never had fog ops, so the log
 * starts empty at index 0; their `fogMaskAssetId` (always null before T007)
 * stays the base. Maps that already have a log pass through untouched.
 */
function migrateStateV3toV4(state: unknown): unknown {
  return mapMaps(state, (map) =>
    "fogOps" in map ? map : { ...map, fogOps: [], fogOpsFrom: 0 }
  );
}

/**
 * v4 -> v5 (ADR 0013): the fog op vocabulary grew (`stroke` and `rects`
 * shapes, optional `feather`). Every v4 document is already a valid v5
 * document; the bump only exists so a v4 build refuses v5 documents as
 * `newer-schema` instead of reporting them invalid.
 */
function migrateStateV4toV5(state: unknown): unknown {
  return state;
}

/**
 * v5 -> v6 (ADR 0014): the campaign gains `splashImageAssetId`. Older
 * campaigns had no splash image, so it starts null (the title card). A state
 * that already has the field passes through untouched.
 */
function migrateStateV5toV6(state: unknown): unknown {
  if (!isRecord(state) || "splashImageAssetId" in state) return state;
  return { ...state, splashImageAssetId: null };
}

/**
 * v6 -> v7 (ADR 0019): the campaign gains `splashTitleCard`. Before T015 a
 * campaign without a splash image showed the title card; from T015 it shows
 * the default artwork unless the DM asks for the title card, and older
 * campaigns get the new default (false) like new ones. A state that already
 * has the field passes through untouched.
 */
function migrateStateV6toV7(state: unknown): unknown {
  if (!isRecord(state) || "splashTitleCard" in state) return state;
  return { ...state, splashTitleCard: false };
}
