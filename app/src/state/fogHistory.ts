/**
 * Fog undo / redo on the DM side (T008, ADR 0013).
 *
 * The undo history *is* the map's fog log (`MapScene.fogOps`): undo drops
 * the last op with one shared `map/fog-undo`, which the player applies like
 * any other op, so both windows shrink the same log and rebuild the same
 * mask. What undo dropped goes on a DM-only redo stack per map; redo
 * re-applies the top entry as a fresh `map/fog-op`. Any *new* fog op on a
 * map (a brush stroke, hide all, ...) discards that map's redo stack, as in
 * every editor; ops that redo itself dispatches do not. Turning the map
 * (`map/rotate`, T017) turns the log's ops in place, so undo keeps working,
 * but the redo stack held ops in the old coordinates and is dropped.
 *
 * **One dispatch, one step** (T106, ADR 0026): the ops one dispatch appends
 * to a map's log — what vision reveals for every seeing token when a door is
 * toggled — are undone and redone together. While started, the history
 * records where each such group ends in the map's history (`fogOpsFrom +
 * fogOps.length`, which a compaction does not move) and how many ops it
 * holds; undo drops the whole group with that many `map/fog-undo` ops in one
 * dispatch (one seq, one delta: the player needs nothing new) and redo
 * re-appends it with one `apply` call. The groups are DM-only bookkeeping:
 * after a reload every op is its own step again, and a group partly baked
 * by a compaction undoes what is left of it.
 *
 * Depth: undo reaches back to the start of the log — at least
 * `FOG_KEEP_OPS` (32) ops after a compaction, unbounded before one — and ops
 * baked into the base PNG are gone for good (`FOG_KEEP_OPS` is what
 * guarantees the ≥ 20 steps the spec asks for). Redo keeps `maxRedo`
 * steps.
 *
 * Undo / redo work from creation; `start()` attaches the store listener
 * that discards redo stacks on new ops and records the groups (the DM view
 * runs it as an effect).
 *
 * Off-limits to `src/player/**`: it writes state.
 */
import type { FogOp } from "./fog";
import { findMap } from "./maps";
import type { MapScene } from "./model";
import type { SharedOp } from "./shared";
import type { TableStore } from "./store";

export const FOG_MAX_REDO = 100;

export interface FogHistory {
  /** Drops the last step of a map's log (its last op, or the ops one dispatch added); false when there is nothing to undo. */
  undo(mapId: string): boolean;
  /** Re-applies the last undone step; false when there is nothing to redo. */
  redo(mapId: string): boolean;
  canUndo(mapId: string): boolean;
  canRedo(mapId: string): boolean;
  /** Number of undone steps waiting to be redone. */
  redoDepth(mapId: string): number;
  /** Called whenever a redo stack changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Starts watching the store so new fog ops discard redo stacks and the
   * ops of one dispatch form one step. Returns the stop function (usable
   * directly as an effect cleanup).
   */
  start(): () => void;
  /** Detaches from the store; the redo stacks are kept. */
  stop(): void;
}

export interface FogHistoryOptions {
  /**
   * How redo appends a step's ops, all in one dispatch. Default: a plain
   * dispatch of one `map/fog-op` each; the DM view passes `FogActions.apply`
   * so a redone step can trigger compaction.
   */
  apply?: (mapId: string, ...ops: FogOp[]) => void;
  maxRedo?: number;
}

/** Ops one dispatch appended, as one undo step: `size` ops ending where the history was `end` long. */
interface OpGroup {
  end: number;
  size: number;
}

const historyEnd = (scene: MapScene) => scene.fogOpsFrom + scene.fogOps.length;

export function createFogHistory(
  store: TableStore,
  { apply, maxRedo = FOG_MAX_REDO }: FogHistoryOptions = {}
): FogHistory {
  const redo = new Map<string, FogOp[][]>();
  /** Per map, the multi-op groups still in the log, oldest first. */
  const groups = new Map<string, OpGroup[]>();
  const listeners = new Set<() => void>();
  let replaying = false;

  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const append =
    apply ??
    ((mapId: string, ...ops: FogOp[]) =>
      store.getState().dispatch(...ops.map((op): SharedOp => ({ kind: "map/fog-op", id: mapId, op }))));

  const forget = (mapId: string) => {
    if (redo.delete(mapId)) notify();
  };

  const setGroups = (mapId: string, list: OpGroup[]) => {
    if (list.length > 0) groups.set(mapId, list);
    else groups.delete(mapId);
  };

  /** Keeps the groups that still end inside the log: not undone some other way, not wholly baked. */
  const pruneGroups = (mapId: string) => {
    const list = groups.get(mapId);
    if (!list) return;
    const scene = findMap(store.getState().shared, mapId);
    setGroups(
      mapId,
      scene ? list.filter((g) => g.end <= historyEnd(scene) && g.end > scene.fogOpsFrom) : []
    );
  };

  const onBatch = (ops: readonly SharedOp[]) => {
    const appended = new Map<string, number>();
    for (const op of ops) {
      switch (op.kind) {
        case "map/fog-op":
          if (!replaying) forget(op.id);
          appended.set(op.id, (appended.get(op.id) ?? 0) + 1);
          break;
        case "map/fog-undo":
        case "map/fog-compact":
          pruneGroups(op.id);
          break;
        case "map/remove":
          forget(op.id);
          groups.delete(op.id);
          break;
        case "map/rotate":
          // The log's ops were turned in place, so undo (and its groups)
          // keeps working; the undone ops on the redo stack were not, so
          // they are dropped (T017, ADR 0021).
          forget(op.id);
          break;
        case "campaign/replace":
          groups.clear();
          if (redo.size > 0) {
            redo.clear();
            notify();
          }
          break;
        default:
          break;
      }
    }
    for (const [mapId, size] of appended) {
      const scene = findMap(store.getState().shared, mapId);
      if (!scene) continue;
      const end = historyEnd(scene);
      // Anything recorded past where this dispatch started was undone some other way.
      const list = (groups.get(mapId) ?? []).filter((g) => g.end <= end - size);
      if (size > 1) list.push({ end, size });
      setGroups(mapId, list);
    }
  };

  let offOps: (() => void) | null = null;
  const stop = () => {
    offOps?.();
    offOps = null;
  };

  const stackOf = (mapId: string) => redo.get(mapId) ?? [];

  return {
    start() {
      stop();
      offOps = store.onOps(onBatch);
      return stop;
    },
    stop,
    undo(mapId) {
      const scene = findMap(store.getState().shared, mapId);
      if (!scene || scene.fogOps.length === 0) return false;
      const end = historyEnd(scene);
      const list = groups.get(mapId) ?? [];
      const group = list.find((g) => g.end === end);
      const size = Math.min(group?.size ?? 1, scene.fogOps.length);
      const undone = scene.fogOps.slice(-size);
      setGroups(
        mapId,
        list.filter((g) => g.end <= end - size)
      );
      store.getState().dispatch(...undone.map((): SharedOp => ({ kind: "map/fog-undo", id: mapId })));
      const stack = [...stackOf(mapId), undone];
      if (stack.length > maxRedo) stack.splice(0, stack.length - maxRedo);
      redo.set(mapId, stack);
      notify();
      return true;
    },
    redo(mapId) {
      const stack = stackOf(mapId);
      if (stack.length === 0) return false;
      const ops = stack[stack.length - 1];
      const rest = stack.slice(0, -1);
      if (rest.length > 0) redo.set(mapId, rest);
      else redo.delete(mapId);
      replaying = true;
      try {
        append(mapId, ...ops);
      } finally {
        replaying = false;
      }
      notify();
      return true;
    },
    canUndo(mapId) {
      const scene = findMap(store.getState().shared, mapId);
      return scene !== undefined && scene.fogOps.length > 0;
    },
    canRedo: (mapId) => stackOf(mapId).length > 0,
    redoDepth: (mapId) => stackOf(mapId).length,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
