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
  annotationEqual,
  cloneAnnotation,
  isAnnotationKind,
  type AnnotationKind,
} from "./annotations";
import { cloneFogOp, isFogOp, type FogOp } from "./fog";
import {
  isAnnotation,
  isGridSettings,
  isMapScene,
  isNonEmptyString,
  isToken,
  isTokenPatch,
  type Annotation,
  type AssetId,
  type GridSettings,
  type MapScene,
  type Token,
} from "./model";
import { cloneToken, patchToken, type TokenPatch } from "./tokens";

export interface SharedState {
  /** Campaign title. Shown on the player idle screen until a map is loaded. */
  campaignName: string;
  /** Scenes in display order. */
  maps: MapScene[];
  /** Id of the scene the player view shows; null shows the idle screen. */
  activeMapId: string | null;
  /**
   * The campaign's splash image (a `splash-image` asset), shown by the
   * player's splash screen instead of the title card; null = title card
   * (T009, ADR 0014).
   */
  splashImageAssetId: AssetId | null;
  /**
   * What the splash shows when no image is chosen (T015, ADR 0019): the
   * campaign-title card when true, the default artwork when false.
   * Irrelevant while `splashImageAssetId` is set.
   */
  splashTitleCard: boolean;
}

export function initialSharedState(): SharedState {
  return {
    campaignName: "",
    maps: [],
    activeMapId: null,
    splashImageAssetId: null,
    splashTitleCard: false,
  };
}

export type SharedOp =
  | { kind: "campaign/set-name"; name: string }
  /** Wholesale replacement, used when a campaign is opened from storage. */
  | { kind: "campaign/replace"; state: SharedState }
  /** Chooses (or with null, clears) the campaign's splash image (T009). */
  | { kind: "campaign/set-splash-image"; assetId: AssetId | null }
  /** Title card (on) or default artwork (off) when no splash image is chosen (T015). */
  | { kind: "campaign/set-splash-title-card"; on: boolean }
  /** Inserts a scene at `index` (clamped; appends when omitted). Ignored if the id exists. */
  | { kind: "map/add"; map: MapScene; index?: number }
  /** Removes a scene; clears `activeMapId` if it pointed at it. */
  | { kind: "map/remove"; id: string }
  | { kind: "map/rename"; id: string; name: string }
  /** Makes a scene the one the player shows; ignored for unknown ids. */
  | { kind: "map/set-active"; id: string | null }
  /** Replaces a scene's grid (geometry + both view styles); ignored for unknown ids. */
  | { kind: "map/set-grid"; id: string; grid: GridSettings }
  /** Appends one fog operation to a scene's log; ignored for unknown ids (ADR 0012). */
  | { kind: "map/fog-op"; id: string; op: FogOp }
  /**
   * Undo (ADR 0013): drops the last op of a scene's log. Ignored for unknown
   * ids and empty logs (ops already baked into the base cannot be undone).
   * Redo is the DM re-sending the dropped op as a `map/fog-op`.
   */
  | { kind: "map/fog-undo"; id: string }
  /**
   * Compaction (ADR 0012): the first `opCount` ops of the log have been baked
   * into the PNG `baseAssetId`, which becomes the scene's fog base; those ops
   * are dropped and `fogOpsFrom` advances by `opCount`. Ignored for unknown
   * ids and when the log is shorter than `opCount` (the DM verifies the baked
   * prefix is unchanged before sending).
   */
  | {
      kind: "map/fog-compact";
      id: string;
      baseAssetId: AssetId | null;
      opCount: number;
    }
  /** Appends a token to a scene (T010); ignored for unknown scenes and duplicate token ids. */
  | { kind: "map/token-add"; id: string; token: Token }
  /** Changes some fields of a token; ignored for unknown scenes/tokens, no-op when nothing changes. */
  | { kind: "map/token-update"; id: string; tokenId: string; patch: TokenPatch }
  /** Removes a token; ignored for unknown scenes/tokens. */
  | { kind: "map/token-remove"; id: string; tokenId: string }
  /**
   * Upserts an annotation (T011): replaces the one with the same id in
   * place, else appends. Ignored for unknown scenes; same state when the
   * annotation is unchanged. The DM's publisher rewrites this for the player
   * when the annotation is DM-only (`annotations.ts: opForPlayer`).
   */
  | { kind: "map/annotation-set"; id: string; annotation: Annotation }
  /** Removes an annotation; ignored for unknown scenes/annotations. */
  | { kind: "map/annotation-remove"; id: string; annotationId: string }
  /** Removes every annotation of one kind (the "clear layer" button); no-op when there are none. */
  | { kind: "map/annotations-clear"; id: string; annotationKind: AnnotationKind };

export type SharedOpKind = SharedOp["kind"];

/** Pure reducer. Returns the same object when the op is a no-op. */
export function applyOp(state: SharedState, op: SharedOp): SharedState {
  switch (op.kind) {
    case "campaign/set-name":
      if (state.campaignName === op.name) return state;
      return { ...state, campaignName: op.name };
    case "campaign/replace":
      return op.state;
    case "campaign/set-splash-image":
      if (state.splashImageAssetId === op.assetId) return state;
      return { ...state, splashImageAssetId: op.assetId };
    case "campaign/set-splash-title-card":
      if (state.splashTitleCard === op.on) return state;
      return { ...state, splashTitleCard: op.on };
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
    case "map/fog-op": {
      if (!state.maps.some((m) => m.id === op.id)) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id ? { ...m, fogOps: [...m.fogOps, cloneFogOp(op.op)] } : m
        ),
      };
    }
    case "map/fog-undo": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || target.fogOps.length === 0) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id ? { ...m, fogOps: m.fogOps.slice(0, -1) } : m
        ),
      };
    }
    case "map/fog-compact": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target) return state;
      const opCount = Math.floor(op.opCount);
      if (opCount < 0 || opCount > target.fogOps.length) return state;
      if (opCount === 0 && target.fogMaskAssetId === op.baseAssetId) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id
            ? {
                ...m,
                fogMaskAssetId: op.baseAssetId,
                fogOps: m.fogOps.slice(opCount),
                fogOpsFrom: m.fogOpsFrom + opCount,
              }
            : m
        ),
      };
    }
    case "map/token-add": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || target.tokens.some((t) => t.id === op.token.id)) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id ? { ...m, tokens: [...m.tokens, cloneToken(op.token)] } : m
        ),
      };
    }
    case "map/token-update": {
      const target = state.maps.find((m) => m.id === op.id);
      const token = target?.tokens.find((t) => t.id === op.tokenId);
      if (!target || !token) return state;
      const next = patchToken(token, op.patch);
      if (next === token) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id
            ? { ...m, tokens: m.tokens.map((t) => (t.id === op.tokenId ? next : t)) }
            : m
        ),
      };
    }
    case "map/token-remove": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || !target.tokens.some((t) => t.id === op.tokenId)) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id ? { ...m, tokens: m.tokens.filter((t) => t.id !== op.tokenId) } : m
        ),
      };
    }
    case "map/annotation-set": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target) return state;
      const existing = target.annotations.find((a) => a.id === op.annotation.id);
      if (existing && annotationEqual(existing, op.annotation)) return state;
      const copy = cloneAnnotation(op.annotation);
      const annotations = existing
        ? target.annotations.map((a) => (a.id === copy.id ? copy : a))
        : [...target.annotations, copy];
      return {
        ...state,
        maps: state.maps.map((m) => (m.id === op.id ? { ...m, annotations } : m)),
      };
    }
    case "map/annotation-remove": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || !target.annotations.some((a) => a.id === op.annotationId)) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id
            ? { ...m, annotations: m.annotations.filter((a) => a.id !== op.annotationId) }
            : m
        ),
      };
    }
    case "map/annotations-clear": {
      const target = state.maps.find((m) => m.id === op.id);
      if (!target || !target.annotations.some((a) => a.kind === op.annotationKind)) return state;
      return {
        ...state,
        maps: state.maps.map((m) =>
          m.id === op.id
            ? { ...m, annotations: m.annotations.filter((a) => a.kind !== op.annotationKind) }
            : m
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
    (x.activeMapId === null || typeof x.activeMapId === "string") &&
    (x.splashImageAssetId === null || isNonEmptyString(x.splashImageAssetId)) &&
    typeof x.splashTitleCard === "boolean"
  );
}

export function isSharedOp(x: unknown): x is SharedOp {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "campaign/set-name":
      return typeof x.name === "string";
    case "campaign/replace":
      return isSharedState(x.state);
    case "campaign/set-splash-image":
      return x.assetId === null || isNonEmptyString(x.assetId);
    case "campaign/set-splash-title-card":
      return typeof x.on === "boolean";
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
    case "map/fog-op":
      return isNonEmptyString(x.id) && isFogOp(x.op);
    case "map/fog-undo":
      return isNonEmptyString(x.id);
    case "map/fog-compact":
      return (
        isNonEmptyString(x.id) &&
        (x.baseAssetId === null || isNonEmptyString(x.baseAssetId)) &&
        typeof x.opCount === "number" &&
        Number.isInteger(x.opCount) &&
        x.opCount >= 0
      );
    case "map/token-add":
      return isNonEmptyString(x.id) && isToken(x.token);
    case "map/token-update":
      return isNonEmptyString(x.id) && isNonEmptyString(x.tokenId) && isTokenPatch(x.patch);
    case "map/token-remove":
      return isNonEmptyString(x.id) && isNonEmptyString(x.tokenId);
    case "map/annotation-set":
      return isNonEmptyString(x.id) && isAnnotation(x.annotation);
    case "map/annotation-remove":
      return isNonEmptyString(x.id) && isNonEmptyString(x.annotationId);
    case "map/annotations-clear":
      return isNonEmptyString(x.id) && isAnnotationKind(x.annotationKind);
    default:
      return false;
  }
}
