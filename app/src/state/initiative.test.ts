import {
  applyInitiativeOp,
  cloneInitiative,
  createInitiativeEntry,
  currentEntry,
  findInitiativeEntry,
  initialInitiative,
  INITIATIVE_OP_KINDS,
  initiativeEntriesEqual,
  isInitiative,
  isInitiativeEntry,
  isInitiativeOp,
  isInitiativeOpKind,
  isInitiativePatch,
  isInitiativeRound,
  linkedToken,
  patchInitiativeEntry,
  unlinkInitiativeToken,
  type Initiative,
  type InitiativeEntry,
  type InitiativeOp,
} from "./initiative";
import { createBlankMapScene } from "./maps";
import { initialSharedState, type SharedState } from "./shared";
import { createToken } from "./tokens";

const entry = (id: string, value: number, tokenId: string | null = null): InitiativeEntry =>
  createInitiativeEntry({ id, name: `Entry ${id}`, value, tokenId });

const list = (entries: InitiativeEntry[], turn: number | null = null, round = 1): Initiative => ({
  entries,
  turn,
  round,
});

/** The three shapes every op is checked on. */
const empty = (round = 1) => list([], null, round);
const one = (turn: number | null = 0, round = 1) => list([entry("a", 10)], turn, round);
const many = (turn: number | null = 0, round = 1) =>
  list([entry("a", 20), entry("b", 15), entry("c", 10), entry("d", 5)], turn, round);

const apply = (initiative: Initiative, ...ops: InitiativeOp[]) => ops.reduce(applyInitiativeOp, initiative);
const ids = (initiative: Initiative) => initiative.entries.map((e) => e.id);

/** Deeply frozen, so a reducer that mutates its input throws. */
function frozen(initiative: Initiative): Initiative {
  return Object.freeze({
    ...initiative,
    entries: Object.freeze(initiative.entries.map((e) => Object.freeze({ ...e }))) as InitiativeEntry[],
  });
}

describe("initiative guards", () => {
  it("isInitiativeEntry: an id, a name, a finite value and a token id or null", () => {
    expect(isInitiativeEntry(entry("a", 12))).toBe(true);
    expect(isInitiativeEntry({ id: "a", name: "", value: -2.5, tokenId: "t" })).toBe(true);
    const bad: unknown[] = [
      { name: "A", value: 1, tokenId: null },
      { id: "", name: "A", value: 1, tokenId: null },
      { id: "a", value: 1, tokenId: null },
      { id: "a", name: 7, value: 1, tokenId: null },
      { id: "a", name: "A", value: "1", tokenId: null },
      { id: "a", name: "A", value: Number.NaN, tokenId: null },
      { id: "a", name: "A", value: Number.POSITIVE_INFINITY, tokenId: null },
      { id: "a", name: "A", value: 1 },
      { id: "a", name: "A", value: 1, tokenId: "" },
      { id: "a", name: "A", value: 1, tokenId: 3 },
      null,
      [],
      "a",
    ];
    for (const x of bad) expect(isInitiativeEntry(x)).toBe(false);
  });

  it("isInitiativePatch: known fields only, each well-formed; {} is valid", () => {
    for (const patch of [{}, { name: "" }, { value: -3.5 }, { tokenId: null }, { tokenId: "t" }, { name: "A", value: 1, tokenId: null }]) {
      expect(isInitiativePatch(patch)).toBe(true);
    }
    const bad: unknown[] = [
      { id: "b" },
      { round: 2 },
      { value: Number.NaN },
      { value: "3" },
      { name: null },
      { tokenId: "" },
      { tokenId: undefined },
      null,
      [],
    ];
    for (const patch of bad) expect(isInitiativePatch(patch)).toBe(false);
  });

  it("isInitiativeRound: a whole number, 1 or more", () => {
    for (const round of [1, 2, 99]) expect(isInitiativeRound(round)).toBe(true);
    for (const round of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
      expect(isInitiativeRound(round)).toBe(false);
    }
  });

  it("isInitiative: well-formed entries with distinct ids, a turn inside the list or null, a legal round", () => {
    expect(isInitiative(initialInitiative())).toBe(true);
    expect(isInitiative(empty(7))).toBe(true);
    expect(isInitiative(one(null))).toBe(true);
    expect(isInitiative(many(3, 4))).toBe(true);
    const bad: unknown[] = [
      list([], 0),
      many(4),
      many(-1),
      many(1.5),
      { ...many(), turn: "0" },
      { ...many(), turn: undefined },
      many(0, 0),
      { ...many(), round: 2.5 },
      list([entry("a", 1), entry("a", 2)]),
      list([entry("a", 1), { id: "b" } as InitiativeEntry]),
      { entries: [], turn: null },
      { turn: null, round: 1 },
      null,
      [],
    ];
    for (const x of bad) expect(isInitiative(x)).toBe(false);
  });

  it("isInitiativeOp checks each op's payload; isInitiativeOpKind knows the nine kinds", () => {
    const good: unknown[] = [
      { kind: "initiative/add", entry: entry("a", 1) },
      { kind: "initiative/update", id: "a", patch: {} },
      { kind: "initiative/update", id: "a", patch: { name: "A", value: 3, tokenId: null } },
      { kind: "initiative/remove", id: "a" },
      { kind: "initiative/sort" },
      { kind: "initiative/next" },
      { kind: "initiative/prev" },
      { kind: "initiative/set-turn", id: "a" },
      { kind: "initiative/set-turn", id: null },
      { kind: "initiative/reset" },
      { kind: "initiative/clear" },
    ];
    for (const op of good) expect(isInitiativeOp(op)).toBe(true);
    const bad: unknown[] = [
      { kind: "initiative/add" },
      { kind: "initiative/add", entry: { id: "a", name: "A" } },
      { kind: "initiative/update", id: "a" },
      { kind: "initiative/update", id: "", patch: {} },
      { kind: "initiative/update", id: "a", patch: { id: "b" } },
      { kind: "initiative/update", id: "a", patch: { value: "3" } },
      { kind: "initiative/remove" },
      { kind: "initiative/remove", id: "" },
      { kind: "initiative/set-turn" },
      { kind: "initiative/set-turn", id: "" },
      { kind: "initiative/set-turn", id: 0 },
      { kind: "initiative/shuffle" },
      { kind: "map/remove", id: "a" },
      null,
      "initiative/next",
    ];
    for (const op of bad) expect(isInitiativeOp(op)).toBe(false);
    expect(INITIATIVE_OP_KINDS).toHaveLength(9);
    for (const kind of INITIATIVE_OP_KINDS) expect(isInitiativeOpKind(kind)).toBe(true);
    expect(isInitiativeOpKind("map/remove")).toBe(false);
    expect(isInitiativeOpKind(undefined)).toBe(false);
  });
});

describe("initiative helpers", () => {
  it("initialInitiative is an empty list with no turn in round 1, fresh each time", () => {
    expect(initialInitiative()).toEqual({ entries: [], turn: null, round: 1 });
    expect(initialInitiative()).not.toBe(initialInitiative());
    expect(initialInitiative().entries).not.toBe(initialInitiative().entries);
  });

  it("createInitiativeEntry leaves the entry unlinked unless asked; clones are independent", () => {
    expect(createInitiativeEntry({ id: "a", name: "Aria", value: 17 })).toEqual({ id: "a", name: "Aria", value: 17, tokenId: null });
    expect(createInitiativeEntry({ id: "a", name: "Aria", value: 17, tokenId: "t" }).tokenId).toBe("t");
    const original = many(1, 2);
    const copy = cloneInitiative(original);
    expect(copy).toEqual(original);
    expect(copy.entries).not.toBe(original.entries);
    expect(copy.entries[0]).not.toBe(original.entries[0]);
  });

  it("currentEntry is the entry at the turn, or null", () => {
    expect(currentEntry(empty())).toBeNull();
    expect(currentEntry(one(null))).toBeNull();
    expect(currentEntry(one(0))).toEqual(entry("a", 10));
    expect(currentEntry(many(2))?.id).toBe("c");
    // A turn past the end (never produced by the ops) reads as none.
    expect(currentEntry(list([entry("a", 1)], 5))).toBeNull();
  });

  it("findInitiativeEntry, initiativeEntriesEqual and patchInitiativeEntry", () => {
    expect(findInitiativeEntry(many(), "c")).toEqual(entry("c", 10));
    expect(findInitiativeEntry(many(), "zzz")).toBeUndefined();
    const a = entry("a", 10, "t");
    expect(initiativeEntriesEqual(a, { ...a })).toBe(true);
    for (const other of [{ ...a, id: "b" }, { ...a, name: "x" }, { ...a, value: 11 }, { ...a, tokenId: null }]) {
      expect(initiativeEntriesEqual(a, other)).toBe(false);
    }
    expect(patchInitiativeEntry(a, {})).toBe(a);
    expect(patchInitiativeEntry(a, { value: 10, tokenId: "t" })).toBe(a);
    expect(patchInitiativeEntry(a, { tokenId: null })).toEqual({ ...a, tokenId: null });
    expect(patchInitiativeEntry(a, { name: "Aria", value: -1 })).toEqual({ ...a, name: "Aria", value: -1 });
    expect(a).toEqual(entry("a", 10, "t"));
  });

  it("linkedToken finds the linked token and its map, the active map first; unlinked and dangling ids read as null", () => {
    const token = (id: string) => createToken({ id, x: 0, y: 0, appearance: { type: "disc", color: "#f00" } });
    const cave = { ...createBlankMapScene({ id: "cave", columns: 2, rows: 2, cellSize: 10 }), tokens: [token("orc")] };
    const keep = {
      ...createBlankMapScene({ id: "keep", columns: 2, rows: 2, cellSize: 10 }),
      tokens: [token("wolf"), token("orc")],
    };
    const shared: SharedState = { ...initialSharedState(), maps: [cave, keep], activeMapId: "keep" };
    expect(linkedToken(shared, entry("i", 1, "wolf"))).toEqual({ map: keep, token: keep.tokens[0] });
    expect(linkedToken(shared, entry("i", 1, "wolf"))?.token).toBe(keep.tokens[0]);
    // The same id on two maps (a duplicated map): the active map's token wins, else the first map's.
    expect(linkedToken(shared, entry("i", 1, "orc"))?.map.id).toBe("keep");
    expect(linkedToken({ ...shared, activeMapId: "cave" }, entry("i", 1, "orc"))?.map.id).toBe("cave");
    expect(linkedToken({ ...shared, activeMapId: null }, entry("i", 1, "orc"))?.map.id).toBe("cave");
    // A token that is not on the active map is still found.
    expect(linkedToken({ ...shared, activeMapId: "cave" }, entry("i", 1, "wolf"))?.map.id).toBe("keep");
    expect(linkedToken(shared, entry("i", 1, null))).toBeNull();
    expect(linkedToken(shared, entry("i", 1, "gone"))).toBeNull();
    expect(linkedToken(initialSharedState(), entry("i", 1, "orc"))).toBeNull();
  });

  it("unlinkInitiativeToken unlinks every entry linked to one token and keeps the rest", () => {
    const state = list([entry("a", 3, "orc"), entry("b", 2, "wolf"), entry("c", 1, "orc")], 1, 4);
    const next = unlinkInitiativeToken(state, "orc");
    expect(next).toEqual(list([entry("a", 3), entry("b", 2, "wolf"), entry("c", 1)], 1, 4));
    expect(next.entries[1]).toBe(state.entries[1]);
    expect(state.entries[0].tokenId).toBe("orc");
    expect(unlinkInitiativeToken(state, "bat")).toBe(state);
    const nobody = empty();
    expect(unlinkInitiativeToken(nobody, "orc")).toBe(nobody);
  });
});

describe("initiative ops (T109)", () => {
  const EVERY_OP: InitiativeOp[] = [
    { kind: "initiative/add", entry: entry("new", 12) },
    { kind: "initiative/add", entry: entry("a", 99) },
    { kind: "initiative/update", id: "b", patch: { value: 30, name: "B!" } },
    { kind: "initiative/update", id: "a", patch: {} },
    { kind: "initiative/remove", id: "a" },
    { kind: "initiative/remove", id: "d" },
    { kind: "initiative/remove", id: "ghost" },
    { kind: "initiative/sort" },
    { kind: "initiative/next" },
    { kind: "initiative/prev" },
    { kind: "initiative/set-turn", id: "c" },
    { kind: "initiative/set-turn", id: null },
    { kind: "initiative/set-turn", id: "ghost" },
    { kind: "initiative/reset" },
    { kind: "initiative/clear" },
  ];
  const SHAPES: Record<string, Initiative> = {
    empty: empty(),
    "empty, round 3": empty(3),
    "one, no turn": one(null),
    one: one(0, 2),
    "many, no turn": many(null, 4),
    "many, first": many(0, 2),
    "many, middle": many(2, 3),
    "many, last": many(3, 1),
  };

  it("every op on every shape keeps the list well-formed, never mutates its input, and is a valid op", () => {
    expect([...new Set(EVERY_OP.map((op) => op.kind))].sort()).toEqual([...INITIATIVE_OP_KINDS].sort());
    for (const [name, shape] of Object.entries(SHAPES)) {
      for (const op of EVERY_OP) {
        const after = applyInitiativeOp(frozen(shape), op);
        expect(isInitiative(after), `${op.kind} on ${name}`).toBe(true);
        expect(isInitiativeOp(JSON.parse(JSON.stringify(op)))).toBe(true);
      }
    }
  });

  describe("initiative/add", () => {
    it("appends a copy and leaves the turn alone, on empty, one-entry and many-entry lists", () => {
      const e = entry("x", 12, "t");
      const fromEmpty = apply(empty(), { kind: "initiative/add", entry: e });
      expect(fromEmpty).toEqual(list([e], null, 1));
      expect(fromEmpty.entries[0]).not.toBe(e);
      expect(apply(one(0, 2), { kind: "initiative/add", entry: e })).toEqual(list([entry("a", 10), e], 0, 2));
      const start = many(3, 5);
      const fromMany = apply(start, { kind: "initiative/add", entry: e });
      // Appended, not sorted in: sorting is its own op.
      expect(ids(fromMany)).toEqual(["a", "b", "c", "d", "x"]);
      expect(fromMany).toMatchObject({ turn: 3, round: 5 });
      expect(fromMany.entries[0]).toBe(start.entries[0]);
      expect(ids(start)).toEqual(["a", "b", "c", "d"]);
    });

    it("ignores a duplicate id", () => {
      const start = many();
      expect(apply(start, { kind: "initiative/add", entry: entry("b", 99) })).toBe(start);
      const single = one();
      expect(apply(single, { kind: "initiative/add", entry: entry("a", 1) })).toBe(single);
    });
  });

  describe("initiative/update", () => {
    it("patches one entry in place without re-sorting; the turn and round are untouched", () => {
      const start = many(1, 2);
      const raised = apply(start, { kind: "initiative/update", id: "d", patch: { value: 50, name: "Dragon", tokenId: "t" } });
      expect(ids(raised)).toEqual(["a", "b", "c", "d"]);
      expect(raised.entries[3]).toEqual({ id: "d", name: "Dragon", value: 50, tokenId: "t" });
      expect(raised).toMatchObject({ turn: 1, round: 2 });
      expect(raised.entries[0]).toBe(start.entries[0]);
      expect(apply(raised, { kind: "initiative/update", id: "d", patch: { tokenId: null } }).entries[3].tokenId).toBeNull();
      expect(apply(one(), { kind: "initiative/update", id: "a", patch: { name: "Solo" } })).toEqual(
        list([{ ...entry("a", 10), name: "Solo" }], 0, 1)
      );
    });

    it("is a no-op when nothing changes, for an unknown id and on an empty list", () => {
      const start = many(1, 2);
      expect(apply(start, { kind: "initiative/update", id: "d", patch: {} })).toBe(start);
      expect(apply(start, { kind: "initiative/update", id: "d", patch: { value: 5 } })).toBe(start);
      expect(apply(start, { kind: "initiative/update", id: "zzz", patch: { value: 1 } })).toBe(start);
      const nobody = empty();
      expect(apply(nobody, { kind: "initiative/update", id: "a", patch: { value: 1 } })).toBe(nobody);
    });
  });

  describe("initiative/remove", () => {
    it("is a no-op on an empty list and for an unknown id", () => {
      const nobody = empty();
      expect(apply(nobody, { kind: "initiative/remove", id: "a" })).toBe(nobody);
      const start = many(1);
      expect(apply(start, { kind: "initiative/remove", id: "zzz" })).toBe(start);
    });

    it("removing the only entry leaves an empty list with no turn; the round is kept", () => {
      expect(apply(one(0, 3), { kind: "initiative/remove", id: "a" })).toEqual(list([], null, 3));
      expect(apply(one(null, 2), { kind: "initiative/remove", id: "a" })).toEqual(list([], null, 2));
    });

    it("an entry before the current one: the same entry stays current", () => {
      const next = apply(many(2, 2), { kind: "initiative/remove", id: "a" });
      expect(ids(next)).toEqual(["b", "c", "d"]);
      expect(currentEntry(next)?.id).toBe("c");
      expect(next).toMatchObject({ turn: 1, round: 2 });
    });

    it("an entry after the current one, or with no turn: the turn is untouched", () => {
      expect(apply(many(1, 2), { kind: "initiative/remove", id: "d" })).toEqual(
        list([entry("a", 20), entry("b", 15), entry("c", 10)], 1, 2)
      );
      expect(apply(many(null, 2), { kind: "initiative/remove", id: "b" })).toEqual(
        list([entry("a", 20), entry("c", 10), entry("d", 5)], null, 2)
      );
    });

    it("the current entry: the one after it takes the turn, in the same round", () => {
      const middle = apply(many(1, 2), { kind: "initiative/remove", id: "b" });
      expect(ids(middle)).toEqual(["a", "c", "d"]);
      expect(currentEntry(middle)?.id).toBe("c");
      expect(middle.round).toBe(2);
      const first = apply(many(0, 2), { kind: "initiative/remove", id: "a" });
      expect(currentEntry(first)?.id).toBe("b");
      expect(first.round).toBe(2);
    });

    it("the current entry when it is the last: the first entry's turn in the next round, as next would give", () => {
      const start = many(3, 2);
      const removed = apply(start, { kind: "initiative/remove", id: "d" });
      expect(removed).toEqual(list([entry("a", 20), entry("b", 15), entry("c", 10)], 0, 3));
      const advanced = apply(start, { kind: "initiative/next" });
      expect(currentEntry(removed)).toEqual(currentEntry(advanced));
      expect(removed.round).toBe(advanced.round);
    });
  });

  describe("initiative/sort", () => {
    it("orders by value, highest first; ties keep their order; the current entry stays current", () => {
      const start = list([entry("low", 3), entry("tie1", 12), entry("high", 18.5), entry("tie2", 12), entry("neg", -1)], 3, 4);
      expect(currentEntry(start)?.id).toBe("tie2");
      const sorted = apply(start, { kind: "initiative/sort" });
      expect(ids(sorted)).toEqual(["high", "tie1", "tie2", "low", "neg"]);
      expect(currentEntry(sorted)?.id).toBe("tie2");
      expect(sorted).toMatchObject({ turn: 2, round: 4 });
      expect(sorted.entries[0]).toBe(start.entries[2]); // entries keep their identity
      expect(apply(sorted, { kind: "initiative/sort" })).toBe(sorted);
      // With no turn, none after.
      const noTurn = apply({ ...start, turn: null }, { kind: "initiative/sort" });
      expect(noTurn.turn).toBeNull();
      expect(ids(noTurn)).toEqual(ids(sorted));
    });

    it("is a no-op on an empty, a one-entry or an already sorted list", () => {
      for (const start of [empty(), one(), one(null), many(), many(3, 2)]) {
        expect(apply(start, { kind: "initiative/sort" })).toBe(start);
      }
    });
  });

  describe("initiative/next and initiative/prev", () => {
    it("are no-ops on an empty list", () => {
      const nobody = empty(3);
      expect(apply(nobody, { kind: "initiative/next" })).toBe(nobody);
      expect(apply(nobody, { kind: "initiative/prev" })).toBe(nobody);
    });

    it("next with no turn starts at the first entry in the same round; prev with no turn does nothing", () => {
      expect(apply(many(null, 2), { kind: "initiative/next" })).toEqual(many(0, 2));
      expect(apply(one(null), { kind: "initiative/next" })).toEqual(one(0));
      const idle = many(null, 2);
      expect(apply(idle, { kind: "initiative/prev" })).toBe(idle);
      const idleOne = one(null);
      expect(apply(idleOne, { kind: "initiative/prev" })).toBe(idleOne);
    });

    it("next walks a many-entry list turn by turn and wraps into the next round", () => {
      let state = many(0, 1);
      const seen: string[] = [];
      for (let i = 0; i < 9; i++) {
        state = apply(state, { kind: "initiative/next" });
        seen.push(`${state.round}:${currentEntry(state)?.id}`);
      }
      expect(seen).toEqual(["1:b", "1:c", "1:d", "2:a", "2:b", "2:c", "2:d", "3:a", "3:b"]);
    });

    it("prev walks back, wraps to the last entry of the round before, and never goes below round 1", () => {
      let state = many(1, 2);
      const seen: string[] = [];
      for (let i = 0; i < 7; i++) {
        state = apply(state, { kind: "initiative/prev" });
        seen.push(`${state.round}:${currentEntry(state)?.id}`);
      }
      expect(seen).toEqual(["2:a", "1:d", "1:c", "1:b", "1:a", "1:d", "1:c"]);
    });

    it("on a one-entry list, next counts rounds up and prev counts them back down to 1", () => {
      const first = one(0, 1);
      const second = apply(first, { kind: "initiative/next" });
      expect(second).toEqual(one(0, 2));
      expect(apply(second, { kind: "initiative/next" })).toEqual(one(0, 3));
      expect(apply(second, { kind: "initiative/prev" })).toEqual(one(0, 1));
      // Already the first entry of round 1: nothing changes.
      expect(apply(first, { kind: "initiative/prev" })).toBe(first);
    });

    it("prev undoes next, and next undoes prev, from any turn after round 1", () => {
      for (let turn = 0; turn < 4; turn++) {
        for (const round of [2, 5]) {
          const start = many(turn, round);
          expect(apply(start, { kind: "initiative/next" }, { kind: "initiative/prev" })).toEqual(start);
          expect(apply(start, { kind: "initiative/prev" }, { kind: "initiative/next" })).toEqual(start);
        }
      }
    });
  });

  describe("initiative/set-turn", () => {
    it("makes one entry current, or nobody with null, leaving the entries and round alone", () => {
      const start = many(0, 3);
      const third = apply(start, { kind: "initiative/set-turn", id: "c" });
      expect(third).toEqual(many(2, 3));
      expect(third.entries).toBe(start.entries);
      expect(apply(third, { kind: "initiative/set-turn", id: null })).toEqual(many(null, 3));
      expect(apply(one(null, 2), { kind: "initiative/set-turn", id: "a" })).toEqual(one(0, 2));
      expect(apply(one(0, 2), { kind: "initiative/set-turn", id: null })).toEqual(one(null, 2));
    });

    it("is a no-op for an unknown id, when that entry is already current, and on an empty list", () => {
      const start = many(2, 3);
      expect(apply(start, { kind: "initiative/set-turn", id: "c" })).toBe(start);
      expect(apply(start, { kind: "initiative/set-turn", id: "zzz" })).toBe(start);
      const nobody = empty();
      expect(apply(nobody, { kind: "initiative/set-turn", id: "a" })).toBe(nobody);
      expect(apply(nobody, { kind: "initiative/set-turn", id: null })).toBe(nobody);
      const idle = many(null);
      expect(apply(idle, { kind: "initiative/set-turn", id: null })).toBe(idle);
    });
  });

  describe("initiative/reset and initiative/clear", () => {
    it("reset goes back to the first entry's turn in round 1, keeping the entries", () => {
      const start = many(2, 6);
      const reset = apply(start, { kind: "initiative/reset" });
      expect(reset).toEqual(many(0, 1));
      expect(reset.entries).toBe(start.entries);
      expect(apply(many(null, 3), { kind: "initiative/reset" })).toEqual(many(0, 1));
      expect(apply(one(0, 4), { kind: "initiative/reset" })).toEqual(one(0, 1));
      expect(apply(one(null), { kind: "initiative/reset" })).toEqual(one(0, 1));
      expect(apply(empty(5), { kind: "initiative/reset" })).toEqual(empty(1));
      for (const done of [reset, one(0, 1), empty()]) {
        expect(apply(done, { kind: "initiative/reset" })).toBe(done);
      }
    });

    it("clear drops every entry: no turn, round 1", () => {
      for (const start of [many(2, 6), many(null), one(0, 3), one(null), empty(4)]) {
        expect(apply(start, { kind: "initiative/clear" })).toEqual(initialInitiative());
      }
      const nobody = empty();
      expect(apply(nobody, { kind: "initiative/clear" })).toBe(nobody);
    });
  });

  it("a five-entry fight: add, sort, a full round and more, remove the current entry, clear", () => {
    let state = initialInitiative();
    const party = [
      ["rogue", 14],
      ["ogre", 8],
      ["wizard", 19],
      ["goblin", 14],
      ["cleric", 3],
    ] as const;
    for (const [id, value] of party) state = apply(state, { kind: "initiative/add", entry: entry(id, value) });
    expect(state.turn).toBeNull();
    state = apply(state, { kind: "initiative/sort" }, { kind: "initiative/next" });
    expect(ids(state)).toEqual(["wizard", "rogue", "goblin", "ogre", "cleric"]);
    expect(state).toMatchObject({ turn: 0, round: 1 });
    for (let i = 0; i < 5; i++) state = apply(state, { kind: "initiative/next" });
    expect(currentEntry(state)?.id).toBe("wizard");
    expect(state.round).toBe(2);
    state = apply(state, { kind: "initiative/next" }, { kind: "initiative/next" });
    expect(currentEntry(state)?.id).toBe("goblin");
    state = apply(state, { kind: "initiative/remove", id: "goblin" });
    expect(currentEntry(state)?.id).toBe("ogre");
    expect(state).toMatchObject({ turn: 2, round: 2 });
    state = apply(state, { kind: "initiative/clear" });
    expect(state).toEqual(initialInitiative());
  });
});
