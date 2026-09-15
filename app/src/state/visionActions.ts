/**
 * Vision on the DM side (T106, ADR 0026): what a seeing token sees is
 * revealed as ordinary fog ops, so undo, sync, compaction and export need
 * nothing new.
 *
 * `revealFor(mapId, tokenId)` commits what one token sees — its
 * `tokenVisionPolygon` — as one `polygon` reveal with the standard feather
 * (`fogFeatherPx`). `revealAll(mapId)` does it for every seeing token of the
 * map in **one** `apply` call, i.e. one dispatch: one seq, one delta and one
 * fog undo step (`fogHistory.ts` undoes the ops of one dispatch together).
 * A token without vision, or one that sees nothing, reveals nothing; so does
 * a polygon the log already reveals (`alreadyRevealed`), so dropping a token
 * back where it stood, or toggling a door no token looks through, adds no
 * empty undo step.
 *
 * `start()` subscribes to the store's ops — on the DM side only: the player
 * never dispatches — and reacts to
 * - a `map/token-update` that moves a token (`x` or `y` in the patch: a drop
 *   through `TokenActions.move`) or gives it a vision above 0: that token;
 * - a `map/door-set-open`, either way: every seeing token of the map.
 *   Closing a door re-hides nothing: fog is additive.
 *
 * Nothing else is a trigger: not a map switch, not a campaign load (the log
 * already holds what was seen). The reveal runs once the triggering dispatch
 * has reached every listener (`schedule`, a microtask by default): a
 * dispatch from inside a listener would hand the listeners after this one —
 * the sync publisher among them — the reveal before the op that caused it.
 * Triggers queued before the reveal runs are merged per map. Whatever the
 * actions' own dispatch sets off is ignored, so a reveal can never trigger
 * another.
 *
 * Off-limits to `src/player/**`: it writes state.
 */
import { fogFeatherPx, fogShape, polygonShape, type FogOp } from "./fog";
import { findMap } from "./maps";
import type { MapScene, Token } from "./model";
import type { SharedOp } from "./shared";
import type { TableStore } from "./store";
import { seeingTokens, tokenVisionPolygon } from "./vision";

export interface VisionActions {
  /** Reveals what one token sees in one dispatch; false when nothing was dispatched. */
  revealFor(mapId: string, tokenId: string): boolean;
  /** Reveals what every seeing token of the map sees, all in one dispatch; false when nothing was dispatched. */
  revealAll(mapId: string): boolean;
  /** Starts reacting to token drops, vision edits and door toggles. Returns the stop function. */
  start(): () => void;
  /** Detaches from the store and drops any reveal not yet run. */
  stop(): void;
}

export interface VisionActionDeps {
  /**
   * How the reveal ops are appended, all of them in one dispatch. Default: a
   * plain dispatch of one `map/fog-op` each; the DM view passes
   * `FogActions.apply` so a reveal can trigger compaction.
   */
  apply?: (mapId: string, ...ops: FogOp[]) => void;
  /** Runs queued reveals after the triggering dispatch. Default: a microtask. */
  schedule?: (run: () => void) => void;
}

/** The reveal op for what a token sees (standard feather); null without vision or when it sees nothing. */
export function visionRevealOp(
  scene: Pick<MapScene, "walls" | "grid" | "width" | "height">,
  token: Pick<Token, "x" | "y" | "size" | "vision">
): FogOp | null {
  const points = tokenVisionPolygon(scene, token);
  if (points.length < 6) return null;
  return fogShape("reveal", polygonShape(points), fogFeatherPx(scene.grid.cellSize));
}

function samePolygonReveal(a: FogOp, b: FogOp): boolean {
  if (a.type !== "shape" || b.type !== "shape") return false;
  if (a.mode !== b.mode || a.feather !== b.feather) return false;
  if (a.shape.kind !== "polygon" || b.shape.kind !== "polygon") return false;
  const p = a.shape.points;
  const q = b.shape.points;
  return p.length === q.length && p.every((v, i) => v === q[i]);
}

/**
 * Whether `log` already reveals what `op` would: a reveal-all, or an
 * identical polygon reveal, after the last op that hides anything. Only
 * reveals follow that op, and reveals never take fog back, so `op` would
 * change no pixel. Conservative: anything baked into the base is not seen.
 */
export function alreadyRevealed(log: readonly FogOp[], op: FogOp): boolean {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.mode === "hide") return false;
    if (entry.type === "fill" || samePolygonReveal(entry, op)) return true;
  }
  return false;
}

export function createVisionActions(
  store: TableStore,
  { apply, schedule = (run) => queueMicrotask(run) }: VisionActionDeps = {}
): VisionActions {
  const append =
    apply ??
    ((mapId: string, ...ops: FogOp[]) =>
      store.getState().dispatch(...ops.map((op): SharedOp => ({ kind: "map/fog-op", id: mapId, op }))));
  let dispatching = false;

  /** One dispatch with the reveals of the listed tokens that would change something. */
  const reveal = (mapId: string, tokenIds: readonly string[]): boolean => {
    const scene = findMap(store.getState().shared, mapId);
    if (!scene) return false;
    const ops: FogOp[] = [];
    for (const id of tokenIds) {
      const token = scene.tokens.find((t) => t.id === id);
      const op = token ? visionRevealOp(scene, token) : null;
      if (op && !alreadyRevealed([...scene.fogOps, ...ops], op)) ops.push(op);
    }
    if (ops.length === 0) return false;
    dispatching = true;
    try {
      append(mapId, ...ops);
    } finally {
      dispatching = false;
    }
    return true;
  };

  const revealAll = (mapId: string): boolean => {
    const scene = findMap(store.getState().shared, mapId);
    return scene !== undefined && reveal(mapId, seeingTokens(scene).map((t) => t.id));
  };

  /** Per map: the tokens whose reveal is due, or `all`. */
  const pending = new Map<string, Set<string> | "all">();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const due = [...pending];
    pending.clear();
    for (const [mapId, tokens] of due) {
      if (tokens === "all") revealAll(mapId);
      else reveal(mapId, [...tokens]);
    }
  };
  /** Queues a reveal for one token, or for all of a map's seeing tokens (`null`). */
  const queue = (mapId: string, tokenId: string | null) => {
    const due = pending.get(mapId);
    if (tokenId === null) pending.set(mapId, "all");
    else if (due === undefined) pending.set(mapId, new Set([tokenId]));
    else if (due !== "all") due.add(tokenId);
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  };

  const onOps = (ops: readonly SharedOp[]) => {
    if (dispatching) return;
    for (const op of ops) {
      if (op.kind === "map/door-set-open") {
        queue(op.id, null);
      } else if (op.kind === "map/token-update") {
        const { x, y, vision } = op.patch;
        if (x !== undefined || y !== undefined || (vision !== undefined && vision > 0)) {
          queue(op.id, op.tokenId);
        }
      }
    }
  };

  let offOps: (() => void) | null = null;
  const stop = () => {
    offOps?.();
    offOps = null;
    pending.clear();
  };

  return {
    revealFor: (mapId, tokenId) => reveal(mapId, [tokenId]),
    revealAll,
    start() {
      stop();
      offOps = store.onOps(onOps);
      return stop;
    },
    stop,
  };
}
