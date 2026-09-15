/**
 * The initiative tracker (T109, ADR 0027): the campaign's turn order, pure
 * and shared by both windows.
 *
 * Initiative is campaign state, not a map's: a fight may outlast a scene
 * switch, and an entry's `tokenId` may name a token on any map. It lives in
 * `SharedState.initiative`, changes only through the `initiative/*` ops
 * (`applyInitiativeOp`, which `shared.ts: applyOp` delegates to), and goes to
 * the player unfiltered — T111's strip draws it. Whether the strip is shown
 * is presentation, not state.
 *
 * `turn` is an index into `entries` (null = nobody's turn yet, and always
 * null for an empty list); `round` counts from 1. A `tokenId` that no longer
 * names a token is tolerated: `linkedToken` reads it as unlinked.
 */
import type { MapScene, Token } from "./model";
import type { SharedState } from "./shared";

export interface InitiativeEntry {
  id: string;
  name: string;
  /** The rolled initiative: any finite number (ties and fractions allowed). */
  value: number;
  /** A token on any map, or null. A dangling id is tolerated and reads as null. */
  tokenId: string | null;
}

export interface Initiative {
  /** In turn order. */
  entries: InitiativeEntry[];
  /** Index of the current entry in `entries`; null = no turn. */
  turn: number | null;
  /** The round, from 1. */
  round: number;
}

/** Some fields of an entry (every field but `id`, each optional). */
export type InitiativePatch = Partial<Omit<InitiativeEntry, "id">>;

export type InitiativeOp =
  /** Appends a copy of the entry; ignored for a duplicate id. The turn is untouched. */
  | { kind: "initiative/add"; entry: InitiativeEntry }
  /** Changes some fields of one entry in place (no re-sort); ignored for unknown ids. */
  | { kind: "initiative/update"; id: string; patch: InitiativePatch }
  /**
   * Removes one entry; ignored for unknown ids. Removing the current entry
   * hands the turn on as `initiative/next` would (to the first entry, and
   * the next round, when it was the last), or to null when none are left.
   */
  | { kind: "initiative/remove"; id: string }
  /** Orders by value, highest first, stably; the current entry stays current. */
  | { kind: "initiative/sort" }
  /** The next entry's turn; from the last, the first's in the next round; from no turn, the first's. */
  | { kind: "initiative/next" }
  /** The previous entry's turn; from the first, the last's in the round before (never below 1). */
  | { kind: "initiative/prev" }
  /** Makes one entry current (or, with null, nobody); ignored for unknown ids. The round is untouched. */
  | { kind: "initiative/set-turn"; id: string | null }
  /** Back to the first entry's turn (null when empty) in round 1. */
  | { kind: "initiative/reset" }
  /** Drops every entry: no turn, round 1. */
  | { kind: "initiative/clear" };

export type InitiativeOpKind = InitiativeOp["kind"];

export const INITIATIVE_OP_KINDS: readonly InitiativeOpKind[] = [
  "initiative/add",
  "initiative/update",
  "initiative/remove",
  "initiative/sort",
  "initiative/next",
  "initiative/prev",
  "initiative/set-turn",
  "initiative/reset",
  "initiative/clear",
];

export function initialInitiative(): Initiative {
  return { entries: [], turn: null, round: 1 };
}

// ---- guards ----------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** One validator per editable entry field; `isInitiativeEntry` and `isInitiativePatch` share them. */
const ENTRY_FIELD_GUARDS: Record<keyof InitiativePatch, (v: unknown) => boolean> = {
  name: (v) => typeof v === "string",
  value: (v) => typeof v === "number" && Number.isFinite(v),
  tokenId: (v) => v === null || isNonEmptyString(v),
};

const ENTRY_FIELDS = Object.keys(ENTRY_FIELD_GUARDS) as (keyof InitiativePatch)[];

export function isInitiativeEntry(x: unknown): x is InitiativeEntry {
  return isRecord(x) && isNonEmptyString(x.id) && ENTRY_FIELDS.every((key) => ENTRY_FIELD_GUARDS[key](x[key]));
}

/** Only known fields, each well-formed; an empty patch is a valid (no-op) patch. */
export function isInitiativePatch(x: unknown): x is InitiativePatch {
  if (!isRecord(x)) return false;
  return Object.keys(x).every((key) => {
    const guard = ENTRY_FIELD_GUARDS[key as keyof InitiativePatch];
    return guard !== undefined && guard(x[key]);
  });
}

/** A round: a whole number, 1 or more. */
export function isInitiativeRound(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
}

/** Well-formed entries with distinct ids, a turn inside the list (or null) and a legal round. */
export function isInitiative(x: unknown): x is Initiative {
  if (!isRecord(x) || !Array.isArray(x.entries) || !x.entries.every(isInitiativeEntry)) return false;
  const entries = x.entries as InitiativeEntry[];
  if (new Set(entries.map((e) => e.id)).size !== entries.length) return false;
  const turnOk =
    x.turn === null ||
    (typeof x.turn === "number" && Number.isSafeInteger(x.turn) && x.turn >= 0 && x.turn < entries.length);
  return turnOk && isInitiativeRound(x.round);
}

export function isInitiativeOpKind(x: unknown): x is InitiativeOpKind {
  return (INITIATIVE_OP_KINDS as readonly unknown[]).includes(x);
}

export function isInitiativeOp(x: unknown): x is InitiativeOp {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "initiative/add":
      return isInitiativeEntry(x.entry);
    case "initiative/update":
      return isNonEmptyString(x.id) && isInitiativePatch(x.patch);
    case "initiative/remove":
      return isNonEmptyString(x.id);
    case "initiative/set-turn":
      return x.id === null || isNonEmptyString(x.id);
    case "initiative/sort":
    case "initiative/next":
    case "initiative/prev":
    case "initiative/reset":
    case "initiative/clear":
      return true;
    default:
      return false;
  }
}

// ---- construction ------------------------------------------------------------

export interface NewInitiativeEntryOptions {
  id: string;
  name: string;
  value: number;
  tokenId?: string | null;
}

export function createInitiativeEntry({ id, name, value, tokenId = null }: NewInitiativeEntryOptions): InitiativeEntry {
  return { id, name, value, tokenId };
}

export function cloneInitiativeEntry(entry: InitiativeEntry): InitiativeEntry {
  return { ...entry };
}

export function cloneInitiative(initiative: Initiative): Initiative {
  return { ...initiative, entries: initiative.entries.map(cloneInitiativeEntry) };
}

export function initiativeEntriesEqual(a: InitiativeEntry, b: InitiativeEntry): boolean {
  return a.id === b.id && a.name === b.name && a.value === b.value && a.tokenId === b.tokenId;
}

/** The entry with `patch` applied; the same object when nothing changes. */
export function patchInitiativeEntry(entry: InitiativeEntry, patch: InitiativePatch): InitiativeEntry {
  const next: InitiativeEntry = {
    id: entry.id,
    name: patch.name ?? entry.name,
    value: patch.value ?? entry.value,
    tokenId: patch.tokenId === undefined ? entry.tokenId : patch.tokenId,
  };
  return initiativeEntriesEqual(entry, next) ? entry : next;
}

// ---- queries -------------------------------------------------------------------

export function findInitiativeEntry(initiative: Initiative, id: string): InitiativeEntry | undefined {
  return initiative.entries.find((e) => e.id === id);
}

/** The entry whose turn it is, or null. */
export function currentEntry(initiative: Initiative): InitiativeEntry | null {
  return initiative.turn === null ? null : (initiative.entries[initiative.turn] ?? null);
}

export interface LinkedToken {
  map: MapScene;
  token: Token;
}

/**
 * The token an entry is linked to, and the map it is on; null when the entry
 * is unlinked or its token is gone. The active map is searched first, then
 * every map in order: a duplicated map copies its tokens' ids.
 */
export function linkedToken(
  shared: Pick<SharedState, "maps" | "activeMapId">,
  entry: InitiativeEntry
): LinkedToken | null {
  const { tokenId } = entry;
  if (tokenId === null) return null;
  const active = shared.maps.find((m) => m.id === shared.activeMapId);
  for (const map of active ? [active, ...shared.maps] : shared.maps) {
    const token = map.tokens.find((t) => t.id === tokenId);
    if (token) return { map, token };
  }
  return null;
}

/** Every entry linked to `tokenId` unlinked; the same object when none was. */
export function unlinkInitiativeToken(initiative: Initiative, tokenId: string): Initiative {
  if (!initiative.entries.some((e) => e.tokenId === tokenId)) return initiative;
  return {
    ...initiative,
    entries: initiative.entries.map((e) => (e.tokenId === tokenId ? { ...e, tokenId: null } : e)),
  };
}

// ---- reducer -------------------------------------------------------------------

function withTurn(initiative: Initiative, turn: number | null, round: number): Initiative {
  if (initiative.turn === turn && initiative.round === round) return initiative;
  return { ...initiative, turn, round };
}

/** Pure reducer for the `initiative/*` ops. Returns the same object when the op is a no-op. */
export function applyInitiativeOp(initiative: Initiative, op: InitiativeOp): Initiative {
  const { entries, turn, round } = initiative;
  switch (op.kind) {
    case "initiative/add": {
      if (entries.some((e) => e.id === op.entry.id)) return initiative;
      return { ...initiative, entries: [...entries, cloneInitiativeEntry(op.entry)] };
    }
    case "initiative/update": {
      const index = entries.findIndex((e) => e.id === op.id);
      if (index < 0) return initiative;
      const next = patchInitiativeEntry(entries[index], op.patch);
      if (next === entries[index]) return initiative;
      return { ...initiative, entries: entries.map((e, i) => (i === index ? next : e)) };
    }
    case "initiative/remove": {
      const index = entries.findIndex((e) => e.id === op.id);
      if (index < 0) return initiative;
      const rest = entries.filter((_, i) => i !== index);
      if (turn === null || index > turn) return { ...initiative, entries: rest };
      if (index < turn) return { entries: rest, turn: turn - 1, round };
      // The current entry goes: the one after it, now at the same index, takes the turn.
      if (rest.length === 0) return { entries: rest, turn: null, round };
      if (turn < rest.length) return { ...initiative, entries: rest };
      return { entries: rest, turn: 0, round: round + 1 };
    }
    case "initiative/sort": {
      const order = entries
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => b.entry.value - a.entry.value || a.index - b.index);
      if (order.every((o, i) => o.index === i)) return initiative;
      return {
        entries: order.map((o) => o.entry),
        turn: turn === null ? null : order.findIndex((o) => o.index === turn),
        round,
      };
    }
    case "initiative/next": {
      if (entries.length === 0) return initiative;
      if (turn === null) return withTurn(initiative, 0, round);
      if (turn + 1 < entries.length) return withTurn(initiative, turn + 1, round);
      return withTurn(initiative, 0, round + 1);
    }
    case "initiative/prev": {
      if (entries.length === 0 || turn === null) return initiative;
      if (turn > 0) return withTurn(initiative, turn - 1, round);
      return withTurn(initiative, entries.length - 1, Math.max(1, round - 1));
    }
    case "initiative/set-turn": {
      if (op.id === null) return withTurn(initiative, null, round);
      const index = entries.findIndex((e) => e.id === op.id);
      if (index < 0) return initiative;
      return withTurn(initiative, index, round);
    }
    case "initiative/reset":
      return withTurn(initiative, entries.length > 0 ? 0 : null, 1);
    case "initiative/clear":
      if (entries.length === 0 && turn === null && round === 1) return initiative;
      return initialInitiative();
  }
}
