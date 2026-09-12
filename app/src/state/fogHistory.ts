/**
 * Fog undo / redo on the DM side (T008, ADR 0013).
 *
 * The undo history *is* the map's fog log (`MapScene.fogOps`): undo drops
 * the last op with one shared `map/fog-undo`, which the player applies like
 * any other op, so both windows shrink the same log and rebuild the same
 * mask. What undo dropped goes on a DM-only redo stack per map; redo
 * re-applies the top entry as a fresh `map/fog-op`. Any *new* fog op on a
 * map (a brush stroke, hide all, ...) discards that map's redo stack, as in
 * every editor; ops that redo itself dispatches do not.
 *
 * Depth: undo reaches back to the start of the log — at least
 * `FOG_KEEP_OPS` (32) after a compaction, unbounded before one — and ops
 * baked into the base PNG are gone for good (`FOG_KEEP_OPS` is what
 * guarantees the ≥ 20 steps the spec asks for). Redo keeps `maxRedo`
 * entries.
 *
 * Undo / redo work from creation; `start()` attaches the store listener
 * that discards redo stacks on new ops (the DM view runs it as an effect).
 *
 * Off-limits to `src/player/**`: it writes state.
 */
import type { FogOp } from "./fog";
import { findMap } from "./maps";
import type { SharedOp } from "./shared";
import type { TableStore } from "./store";

export const FOG_MAX_REDO = 100;

export interface FogHistory {
  /** Drops the last op of a map's log; false when there is nothing to undo. */
  undo(mapId: string): boolean;
  /** Re-applies the last undone op; false when there is nothing to redo. */
  redo(mapId: string): boolean;
  canUndo(mapId: string): boolean;
  canRedo(mapId: string): boolean;
  /** Number of undone ops waiting to be redone. */
  redoDepth(mapId: string): number;
  /** Called whenever a redo stack changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Starts watching the store so new fog ops discard redo stacks. Returns
   * the stop function (usable directly as an effect cleanup).
   */
  start(): () => void;
  /** Detaches from the store; the redo stacks are kept. */
  stop(): void;
}

export interface FogHistoryOptions {
  /**
   * How redo appends an op. Default: a plain `map/fog-op` dispatch; the DM
   * view passes `FogActions.apply` so a redone op can trigger compaction.
   */
  apply?: (mapId: string, op: FogOp) => void;
  maxRedo?: number;
}

export function createFogHistory(
  store: TableStore,
  { apply, maxRedo = FOG_MAX_REDO }: FogHistoryOptions = {}
): FogHistory {
  const redo = new Map<string, FogOp[]>();
  const listeners = new Set<() => void>();
  let replaying = false;

  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const append =
    apply ?? ((mapId: string, op: FogOp) => store.getState().dispatch({ kind: "map/fog-op", id: mapId, op }));

  const forget = (mapId: string) => {
    if (redo.delete(mapId)) notify();
  };

  const onOp = (op: SharedOp) => {
    switch (op.kind) {
      case "map/fog-op":
        if (!replaying) forget(op.id);
        return;
      case "map/remove":
        forget(op.id);
        return;
      case "campaign/replace":
        if (redo.size > 0) {
          redo.clear();
          notify();
        }
        return;
      default:
        return;
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
      offOps = store.onOps((ops) => {
        for (const op of ops) onOp(op);
      });
      return stop;
    },
    stop,
    undo(mapId) {
      const scene = findMap(store.getState().shared, mapId);
      if (!scene || scene.fogOps.length === 0) return false;
      const last = scene.fogOps[scene.fogOps.length - 1];
      store.getState().dispatch({ kind: "map/fog-undo", id: mapId });
      const stack = [...stackOf(mapId), last];
      if (stack.length > maxRedo) stack.splice(0, stack.length - maxRedo);
      redo.set(mapId, stack);
      notify();
      return true;
    },
    redo(mapId) {
      const stack = stackOf(mapId);
      if (stack.length === 0) return false;
      const op = stack[stack.length - 1];
      const rest = stack.slice(0, -1);
      if (rest.length > 0) redo.set(mapId, rest);
      else redo.delete(mapId);
      replaying = true;
      try {
        append(mapId, op);
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
