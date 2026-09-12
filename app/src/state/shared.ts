/**
 * The state that is shared DM -> player. This is the *only* state the player
 * window ever sees; DM-only data (notes, UI state, window handles) never goes
 * in here.
 *
 * Changes to shared state are expressed as operations (`SharedOp`). The DM
 * store applies ops locally and the sync layer forwards the same ops to the
 * player as deltas, so both sides run the identical reducer (`applyOp`).
 * Later tasks extend `SharedState` and add op kinds (fog ops, tokens, ...).
 *
 * `SharedState` is also the body of the persisted campaign document (see
 * `campaign.ts`), so everything here must be plain JSON: no Blobs, no class
 * instances. Binary assets are referenced by id (`model.ts`).
 */
import {
  isGridSettings,
  isMapScene,
  isNonEmptyString,
  type GridSettings,
  type MapScene,
} from "./model";

export interface SharedState {
  /** Campaign title. Shown on the player idle screen until a map is loaded. */
  campaignName: string;
  /** Scenes in display order. */
  maps: MapScene[];
  /** Id of the scene the player view shows; null shows the idle screen. */
  activeMapId: string | null;
}

export function initialSharedState(): SharedState {
  return { campaignName: "", maps: [], activeMapId: null };
}

export type SharedOp =
  | { kind: "campaign/set-name"; name: string }
  /** Wholesale replacement, used when a campaign is opened from storage. */
  | { kind: "campaign/replace"; state: SharedState }
  /** Inserts a scene at `index` (clamped; appends when omitted). Ignored if the id exists. */
  | { kind: "map/add"; map: MapScene; index?: number }
  /** Removes a scene; clears `activeMapId` if it pointed at it. */
  | { kind: "map/remove"; id: string }
  | { kind: "map/rename"; id: string; name: string }
  /** Makes a scene the one the player shows; ignored for unknown ids. */
  | { kind: "map/set-active"; id: string | null }
  /** Replaces a scene's grid (geometry + both view styles); ignored for unknown ids. */
  | { kind: "map/set-grid"; id: string; grid: GridSettings };

export type SharedOpKind = SharedOp["kind"];

/** Pure reducer. Returns the same object when the op is a no-op. */
export function applyOp(state: SharedState, op: SharedOp): SharedState {
  switch (op.kind) {
    case "campaign/set-name":
      if (state.campaignName === op.name) return state;
      return { ...state, campaignName: op.name };
    case "campaign/replace":
      return op.state;
    case "map/add": {
      if (state.maps.some((m) => m.id === op.map.id)) return state;
      const index =
        op.index === undefined
          ? state.maps.length
          : Math.max(0, Math.min(state.maps.length, Math.floor(op.index)));
      const maps = [...state.maps];
      maps.splice(index, 0, op.map);
      return { ...state, maps };
    }
    case "map/remove": {
      if (!state.maps.some((m) => m.id === op.id)) return state;
      return {
        ...state,
        maps: state.maps.filter((m) => m.id !== op.id),
        activeMapId: state.activeMapId === op.id ? null : state.activeMapId,
      };
    }
    case "map/rename": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || target.name === op.name) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id ? { ...m, name: op.name } : m
        ),
      };
    }
    case "map/set-active": {
      if (state.activeMapId === op.id) return state;
      if (op.id !== null && !state.maps.some((m) => m.id === op.id)) {
        return state;
      }
      return { ...state, activeMapId: op.id };
    }
    case "map/set-grid": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || gridSettingsEqual(target.grid, op.grid)) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id ? { ...m, grid: cloneGridSettings(op.grid) } : m
        ),
      };
    }
  }
}

function gridStyleEqual(a: GridSettings["dm"], b: GridSettings["dm"]): boolean {
  return a.visible === b.visible && a.color === b.color && a.opacity === b.opacity;
}

export function gridSettingsEqual(a: GridSettings, b: GridSettings): boolean {
  return (
    a.cellSize === b.cellSize &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    gridStyleEqual(a.dm, b.dm) &&
    gridStyleEqual(a.player, b.player)
  );
}

function cloneGridSettings(grid: GridSettings): GridSettings {
  return { ...grid, dm: { ...grid.dm }, player: { ...grid.player } };
}

export function applyOps(
  state: SharedState,
  ops: readonly SharedOp[]
): SharedState {
  return ops.reduce(applyOp, state);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function isSharedState(x: unknown): x is SharedState {
  return (
    isRecord(x) &&
    typeof x.campaignName === "string" &&
    Array.isArray(x.maps) &&
    x.maps.every(isMapScene) &&
    (x.activeMapId === null || typeof x.activeMapId === "string")
  );
}

export function isSharedOp(x: unknown): x is SharedOp {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "campaign/set-name":
      return typeof x.name === "string";
    case "campaign/replace":
      return isSharedState(x.state);
    case "map/add":
      return (
        isMapScene(x.map) &&
        (x.index === undefined ||
          (typeof x.index === "number" && Number.isFinite(x.index)))
      );
    case "map/remove":
      return isNonEmptyString(x.id);
    case "map/rename":
      return isNonEmptyString(x.id) && typeof x.name === "string";
    case "map/set-active":
      return x.id === null || isNonEmptyString(x.id);
    case "map/set-grid":
      return isNonEmptyString(x.id) && isGridSettings(x.grid);
    default:
      return false;
  }
}
