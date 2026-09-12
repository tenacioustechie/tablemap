/**
 * Fog of war on the DM side (T007, ADR 0012): the actions the fog panel and
 * the canvas tools call, and compaction of the op log.
 *
 * Every action is one `map/fog-op` dispatch, so the player and the autosaver
 * see it like any other op. When a map's log reaches `compactAt` entries,
 * the first `length - keepOps` of them are baked into a PNG (`bake`, browser
 * canvas work injected so this module stays testable under Node), stored as
 * a `fog-mask` asset, and dropped from the log with one `map/fog-compact`
 * op. The baked prefix is checked against the live log after every await,
 * so a log that changed underneath (a later undo, another campaign opened)
 * simply aborts the compaction; the next fog op retries it. Compaction never
 * changes the pixels, only where they are stored.
 *
 * Off-limits to `src/player/**`, like every module that writes state.
 */
import { nanoid } from "nanoid";
import type { BakeFogMask } from "../map/fogMask";
import type { TableMapDb } from "./db";
import { fogFill, fogShape, type FogOp, type FogShape } from "./fog";
import { findMap, referencedAssetIds } from "./maps";
import type { MapScene } from "./model";
import { deleteAsset, getAsset, putAsset } from "./persistence";
import type { TableStore } from "./store";

/** Log length that triggers compaction. */
export const FOG_COMPACT_AT = 64;
/** Ops left in the log after compaction (undo, T008, needs at least 20). */
export const FOG_KEEP_OPS = 32;

export interface FogActions {
  /** Appends one op to a map's fog log (and compacts the log if it is long). */
  apply(mapId: string, op: FogOp): void;
  reveal(mapId: string, shape: FogShape): void;
  hide(mapId: string, shape: FogShape): void;
  revealAll(mapId: string): void;
  hideAll(mapId: string): void;
  /** Resolves once every compaction started so far has finished (tests). */
  idle(): Promise<void>;
}

export interface FogActionDeps {
  bake: BakeFogMask;
  compactAt?: number;
  keepOps?: number;
  newId?: () => string;
  /** Called when a compaction fails. Default: `console.error`. */
  onError?: (error: unknown) => void;
}

function samePrefix(scene: MapScene, snapshot: MapScene, opCount: number): boolean {
  if (
    scene.fogMaskAssetId !== snapshot.fogMaskAssetId ||
    scene.fogOpsFrom !== snapshot.fogOpsFrom ||
    scene.fogOps.length < opCount
  ) {
    return false;
  }
  // The store keeps op objects by reference, so identity is exact here.
  for (let i = 0; i < opCount; i++) {
    if (scene.fogOps[i] !== snapshot.fogOps[i]) return false;
  }
  return true;
}

export function createFogActions(
  store: TableStore,
  db: TableMapDb,
  {
    bake,
    compactAt = FOG_COMPACT_AT,
    keepOps = FOG_KEEP_OPS,
    newId = nanoid,
    onError = (error) => console.error("fog compaction failed", error),
  }: FogActionDeps
): FogActions {
  const running = new Map<string, Promise<void>>();
  const keep = Math.max(0, Math.min(keepOps, compactAt - 1));

  /** Resolves true when it dispatched a `map/fog-compact`. */
  const compact = async (mapId: string): Promise<boolean> => {
    const snapshot = findMap(store.getState().shared, mapId);
    const campaignId = store.getState().campaignId;
    if (!snapshot || campaignId === null || snapshot.fogOps.length < compactAt) return false;
    const opCount = snapshot.fogOps.length - keep;
    const live = () => findMap(store.getState().shared, mapId);
    const stillValid = () => {
      const scene = live();
      return scene !== undefined && samePrefix(scene, snapshot, opCount);
    };

    const baseRecord = snapshot.fogMaskAssetId
      ? await getAsset(db, snapshot.fogMaskAssetId)
      : undefined;
    if (!stillValid()) return false;
    const png = await bake(snapshot, baseRecord?.blob ?? null, opCount);
    if (!stillValid()) return false;
    const baseAssetId = await putAsset(db, {
      id: newId(),
      campaignId,
      kind: "fog-mask",
      blob: png,
    });
    if (!stillValid() || store.getState().campaignId !== campaignId) {
      await deleteAsset(db, baseAssetId);
      return false;
    }
    store.getState().dispatch({ kind: "map/fog-compact", id: mapId, baseAssetId, opCount });
    const previous = snapshot.fogMaskAssetId;
    if (previous && !referencedAssetIds(store.getState().shared).has(previous)) {
      await deleteAsset(db, previous);
    }
    return true;
  };

  const maybeCompact = (mapId: string) => {
    if (running.has(mapId)) return;
    const scene = findMap(store.getState().shared, mapId);
    if (!scene || scene.fogOps.length < compactAt) return;
    const run = compact(mapId)
      .catch((error: unknown) => {
        onError(error);
        return false;
      })
      .then((compacted) => {
        running.delete(mapId);
        // Ops kept arriving during the bake: go again if still over the
        // line. A failed attempt is not retried until the next fog op.
        if (compacted) maybeCompact(mapId);
      });
    running.set(mapId, run);
  };

  const apply = (mapId: string, op: FogOp) => {
    if (!findMap(store.getState().shared, mapId)) return;
    store.getState().dispatch({ kind: "map/fog-op", id: mapId, op });
    maybeCompact(mapId);
  };

  return {
    apply,
    reveal: (mapId, shape) => apply(mapId, fogShape("reveal", shape)),
    hide: (mapId, shape) => apply(mapId, fogShape("hide", shape)),
    revealAll: (mapId) => apply(mapId, fogFill("reveal")),
    hideAll: (mapId) => apply(mapId, fogFill("hide")),
    async idle() {
      while (running.size > 0) await Promise.all([...running.values()]);
    },
  };
}
