/**
 * The state that is shared DM -> player. This is the *only* state the player
 * window ever sees; DM-only data (notes, UI state, window handles) never goes
 * in here.
 *
 * Changes to shared state are expressed as operations (`SharedOp`). The DM
 * store applies ops locally and the sync layer forwards the same ops to the
 * player as deltas, so both sides run the identical reducer (`applyOp`).
 * Later tasks extend `SharedState` and add op kinds (fog ops, tokens, ...).
 */

export interface SharedState {
  /** Campaign title. Shown on the player idle screen until a map is loaded. */
  campaignName: string;
}

export function initialSharedState(): SharedState {
  return { campaignName: "" };
}

export type SharedOp = { kind: "campaign/set-name"; name: string };

export type SharedOpKind = SharedOp["kind"];

/** Pure reducer. Returns the same object when the op is a no-op. */
export function applyOp(state: SharedState, op: SharedOp): SharedState {
  switch (op.kind) {
    case "campaign/set-name":
      if (state.campaignName === op.name) return state;
      return { ...state, campaignName: op.name };
  }
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
  return isRecord(x) && typeof x.campaignName === "string";
}

export function isSharedOp(x: unknown): x is SharedOp {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "campaign/set-name":
      return typeof x.name === "string";
    default:
      return false;
  }
}
