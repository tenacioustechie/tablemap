import {
  applyOp,
  applyOps,
  gridSettingsEqual,
  initialSharedState,
  isSharedOp,
  isSharedState,
  type SharedState,
} from "./shared";
import { fogFill, type FogOp } from "./fog";
import { defaultGridSettings, type MapScene } from "./model";

const scene = (id: string): MapScene => ({
  id,
  name: `Map ${id}`,
  imageAssetId: null,
  backgroundColor: "#3b3b3b",
  width: 1000,
  height: 800,
  grid: defaultGridSettings(),
  fogMaskAssetId: null,
  fogOps: [],
  fogOpsFrom: 0,
  tokens: [],
  annotations: [],
});

describe("shared state reducer", () => {
  it("starts with an empty campaign, no maps and no active map", () => {
    expect(initialSharedState()).toEqual({
      campaignName: "",
      maps: [],
      activeMapId: null,
    });
  });

  it("applies campaign/set-name immutably", () => {
    const before = initialSharedState();
    const after = applyOp(before, { kind: "campaign/set-name", name: "Tomb" });
    expect(after).toEqual({ ...initialSharedState(), campaignName: "Tomb" });
    expect(before).toEqual(initialSharedState());
  });

  it("returns the same object for a no-op", () => {
    const state = { ...initialSharedState(), campaignName: "Tomb" };
    expect(applyOp(state, { kind: "campaign/set-name", name: "Tomb" })).toBe(
      state
    );
  });

  it("campaign/replace swaps in the given state wholesale", () => {
    const replacement: SharedState = {
      campaignName: "Loaded",
      maps: [scene("m1")],
      activeMapId: "m1",
    };
    const before = { ...initialSharedState(), campaignName: "Old" };
    expect(applyOp(before, { kind: "campaign/replace", state: replacement })).toBe(
      replacement
    );
    expect(before.campaignName).toBe("Old");
  });

  it("applies ops in order", () => {
    const result = applyOps(initialSharedState(), [
      { kind: "campaign/set-name", name: "A" },
      { kind: "campaign/replace", state: { ...initialSharedState(), campaignName: "R" } },
      { kind: "campaign/set-name", name: "B" },
    ]);
    expect(result.campaignName).toBe("B");
  });

  it("validates state shapes, including nested maps", () => {
    expect(isSharedState(initialSharedState())).toBe(true);
    expect(
      isSharedState({ campaignName: "x", maps: [scene("a")], activeMapId: "a" })
    ).toBe(true);
    expect(isSharedState({ campaignName: "x" })).toBe(false);
    expect(isSharedState({ campaignName: 1, maps: [], activeMapId: null })).toBe(
      false
    );
    expect(
      isSharedState({ campaignName: "x", maps: [{ id: "bad" }], activeMapId: null })
    ).toBe(false);
    expect(
      isSharedState({ campaignName: "x", maps: [], activeMapId: 7 })
    ).toBe(false);
    expect(isSharedState(null)).toBe(false);
    expect(isSharedState([])).toBe(false);
  });

  it("validates op shapes", () => {
    expect(isSharedOp({ kind: "campaign/set-name", name: "x" })).toBe(true);
    expect(isSharedOp({ kind: "campaign/set-name" })).toBe(false);
    expect(
      isSharedOp({ kind: "campaign/replace", state: initialSharedState() })
    ).toBe(true);
    expect(isSharedOp({ kind: "campaign/replace", state: { campaignName: "x" } })).toBe(
      false
    );
    expect(isSharedOp({ kind: "other" })).toBe(false);
    expect(isSharedOp("campaign/set-name")).toBe(false);
  });

  it("validates map op shapes", () => {
    expect(isSharedOp({ kind: "map/add", map: scene("a") })).toBe(true);
    expect(isSharedOp({ kind: "map/add", map: scene("a"), index: 0 })).toBe(true);
    expect(isSharedOp({ kind: "map/add", map: { id: "a" } })).toBe(false);
    expect(isSharedOp({ kind: "map/add", map: scene("a"), index: "0" })).toBe(false);
    expect(isSharedOp({ kind: "map/remove", id: "a" })).toBe(true);
    expect(isSharedOp({ kind: "map/remove", id: "" })).toBe(false);
    expect(isSharedOp({ kind: "map/rename", id: "a", name: "" })).toBe(true);
    expect(isSharedOp({ kind: "map/rename", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/set-active", id: null })).toBe(true);
    expect(isSharedOp({ kind: "map/set-active", id: "a" })).toBe(true);
    expect(isSharedOp({ kind: "map/set-active", id: 1 })).toBe(false);
    expect(isSharedOp({ kind: "map/set-grid", id: "a", grid: defaultGridSettings() })).toBe(true);
    expect(isSharedOp({ kind: "map/set-grid", id: "", grid: defaultGridSettings() })).toBe(false);
    expect(
      isSharedOp({ kind: "map/set-grid", id: "a", grid: { ...defaultGridSettings(), cellSize: 0 } })
    ).toBe(false);
    expect(isSharedOp({ kind: "map/set-grid", id: "a" })).toBe(false);
  });

  it("validates fog op shapes (T007)", () => {
    expect(isSharedOp({ kind: "map/fog-op", id: "a", op: { type: "fill", mode: "hide" } })).toBe(true);
    expect(
      isSharedOp({
        kind: "map/fog-op",
        id: "a",
        op: { type: "shape", mode: "reveal", shape: { kind: "rect", x: 1, y: 2, width: 3, height: 4 } },
      })
    ).toBe(true);
    expect(isSharedOp({ kind: "map/fog-op", id: "", op: { type: "fill", mode: "hide" } })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-op", id: "a", op: { type: "fill", mode: "toggle" } })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-op", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-compact", id: "a", baseAssetId: "b", opCount: 3 })).toBe(true);
    expect(isSharedOp({ kind: "map/fog-compact", id: "a", baseAssetId: null, opCount: 0 })).toBe(true);
    expect(isSharedOp({ kind: "map/fog-compact", id: "a", baseAssetId: "", opCount: 3 })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-compact", id: "a", baseAssetId: "b", opCount: -1 })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-compact", id: "a", baseAssetId: "b", opCount: 1.5 })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-compact", id: "a", baseAssetId: "b" })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-undo", id: "a" })).toBe(true);
    expect(isSharedOp({ kind: "map/fog-undo", id: "" })).toBe(false);
    expect(isSharedOp({ kind: "map/fog-undo" })).toBe(false);
  });
});

describe("fog ops (T007, ADR 0012)", () => {
  const rect = (x: number): FogOp => ({
    type: "shape",
    mode: "reveal",
    shape: { kind: "rect", x, y: 0, width: 10, height: 10 },
  });
  const withMaps = (...ids: string[]): SharedState => ({
    ...initialSharedState(),
    maps: ids.map(scene),
    activeMapId: null,
  });

  it("map/fog-op appends a copy of the op to that map's log only", () => {
    const state = withMaps("a", "b");
    const op = rect(1);
    const next = applyOp(state, { kind: "map/fog-op", id: "a", op });
    expect(next.maps[0].fogOps).toEqual([op]);
    expect(next.maps[0].fogOps[0]).not.toBe(op); // defensive copy
    expect(next.maps[0].fogOpsFrom).toBe(0);
    expect(next.maps[1]).toBe(state.maps[1]);
    expect(state.maps[0].fogOps).toEqual([]);
    const again = applyOp(next, { kind: "map/fog-op", id: "a", op: fogFill("hide") });
    expect(again.maps[0].fogOps).toEqual([op, { type: "fill", mode: "hide" }]);
    // Earlier entries keep their identity, so renderers can apply just the tail.
    expect(again.maps[0].fogOps[0]).toBe(next.maps[0].fogOps[0]);
    expect(applyOp(state, { kind: "map/fog-op", id: "zzz", op })).toBe(state);
  });

  it("map/fog-compact swaps in the baked base, drops the prefix and advances the history index", () => {
    let state = withMaps("a");
    for (const x of [1, 2, 3, 4, 5]) state = applyOp(state, { kind: "map/fog-op", id: "a", op: rect(x) });
    const compacted = applyOp(state, { kind: "map/fog-compact", id: "a", baseAssetId: "png-1", opCount: 3 });
    expect(compacted.maps[0].fogMaskAssetId).toBe("png-1");
    expect(compacted.maps[0].fogOps).toEqual([rect(4), rect(5)]);
    expect(compacted.maps[0].fogOpsFrom).toBe(3);
    expect(compacted.maps[0].fogOps[0]).toBe(state.maps[0].fogOps[3]);
    // A second round continues counting from there.
    const twice = applyOp(compacted, { kind: "map/fog-compact", id: "a", baseAssetId: "png-2", opCount: 2 });
    expect(twice.maps[0]).toMatchObject({ fogMaskAssetId: "png-2", fogOps: [], fogOpsFrom: 5 });
  });

  it("map/fog-compact ignores unknown maps, oversized counts and no-ops", () => {
    let state = withMaps("a");
    state = applyOp(state, { kind: "map/fog-op", id: "a", op: rect(1) });
    expect(applyOp(state, { kind: "map/fog-compact", id: "x", baseAssetId: "p", opCount: 1 })).toBe(state);
    expect(applyOp(state, { kind: "map/fog-compact", id: "a", baseAssetId: "p", opCount: 2 })).toBe(state);
    expect(applyOp(state, { kind: "map/fog-compact", id: "a", baseAssetId: null, opCount: 0 })).toBe(state);
    // Replacing the base without dropping ops is still a change.
    const rebased = applyOp(state, { kind: "map/fog-compact", id: "a", baseAssetId: "p", opCount: 0 });
    expect(rebased.maps[0]).toMatchObject({ fogMaskAssetId: "p", fogOps: [rect(1)], fogOpsFrom: 0 });
  });

  it("map/fog-undo drops the last op of that map's log only, and is a no-op on an empty log (T008)", () => {
    let state = withMaps("a", "b");
    for (const x of [1, 2, 3]) state = applyOp(state, { kind: "map/fog-op", id: "a", op: rect(x) });
    state = applyOp(state, { kind: "map/fog-op", id: "b", op: rect(9) });
    const undone = applyOp(state, { kind: "map/fog-undo", id: "a" });
    expect(undone.maps[0].fogOps).toEqual([rect(1), rect(2)]);
    expect(undone.maps[0].fogOps[0]).toBe(state.maps[0].fogOps[0]); // the survivors keep identity
    expect(undone.maps[0].fogOpsFrom).toBe(0);
    expect(undone.maps[1]).toBe(state.maps[1]);
    const twice = applyOp(applyOp(undone, { kind: "map/fog-undo", id: "a" }), { kind: "map/fog-undo", id: "a" });
    expect(twice.maps[0].fogOps).toEqual([]);
    expect(applyOp(twice, { kind: "map/fog-undo", id: "a" })).toBe(twice);
    expect(applyOp(state, { kind: "map/fog-undo", id: "zzz" })).toBe(state);
    // Compaction leaves nothing to undo past the base.
    const compacted = applyOp(state, { kind: "map/fog-compact", id: "a", baseAssetId: "png", opCount: 3 });
    expect(applyOp(compacted, { kind: "map/fog-undo", id: "a" })).toBe(compacted);
  });

  it("the state stays plain JSON with fog ops in it", () => {
    let state = withMaps("a");
    state = applyOp(state, { kind: "map/fog-op", id: "a", op: rect(1) });
    state = applyOp(state, { kind: "map/fog-op", id: "a", op: fogFill("reveal") });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(isSharedState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });
});

describe("map ops", () => {
  const withMaps = (...ids: string[]): SharedState => ({
    ...initialSharedState(),
    maps: ids.map(scene),
    activeMapId: null,
  });

  it("map/add appends by default, inserts at a clamped index otherwise", () => {
    const s1 = applyOp(withMaps("a"), { kind: "map/add", map: scene("b") });
    expect(s1.maps.map((m) => m.id)).toEqual(["a", "b"]);
    const s2 = applyOp(s1, { kind: "map/add", map: scene("c"), index: 1 });
    expect(s2.maps.map((m) => m.id)).toEqual(["a", "c", "b"]);
    const s3 = applyOp(s2, { kind: "map/add", map: scene("d"), index: 99 });
    expect(s3.maps.map((m) => m.id)).toEqual(["a", "c", "b", "d"]);
    const s4 = applyOp(s3, { kind: "map/add", map: scene("e"), index: -5 });
    expect(s4.maps.map((m) => m.id)).toEqual(["e", "a", "c", "b", "d"]);
    expect(s4.activeMapId).toBeNull();
  });

  it("map/add ignores a duplicate id", () => {
    const state = withMaps("a");
    expect(applyOp(state, { kind: "map/add", map: scene("a") })).toBe(state);
  });

  it("map/set-active switches only to known maps and null", () => {
    const state = withMaps("a", "b");
    const active = applyOp(state, { kind: "map/set-active", id: "b" });
    expect(active.activeMapId).toBe("b");
    expect(applyOp(active, { kind: "map/set-active", id: "b" })).toBe(active);
    expect(applyOp(active, { kind: "map/set-active", id: "zzz" })).toBe(active);
    expect(applyOp(active, { kind: "map/set-active", id: null }).activeMapId).toBeNull();
  });

  it("map/remove drops the map and clears activeMapId if it pointed at it", () => {
    const state = applyOp(withMaps("a", "b"), { kind: "map/set-active", id: "a" });
    const removedOther = applyOp(state, { kind: "map/remove", id: "b" });
    expect(removedOther.maps.map((m) => m.id)).toEqual(["a"]);
    expect(removedOther.activeMapId).toBe("a");
    const removedActive = applyOp(state, { kind: "map/remove", id: "a" });
    expect(removedActive.maps.map((m) => m.id)).toEqual(["b"]);
    expect(removedActive.activeMapId).toBeNull();
    expect(applyOp(state, { kind: "map/remove", id: "nope" })).toBe(state);
  });

  it("map/rename changes one map immutably and is a no-op otherwise", () => {
    const state = withMaps("a", "b");
    const renamed = applyOp(state, { kind: "map/rename", id: "a", name: "Crypt" });
    expect(renamed.maps[0].name).toBe("Crypt");
    expect(renamed.maps[1]).toBe(state.maps[1]);
    expect(state.maps[0].name).toBe("Map a");
    expect(applyOp(renamed, { kind: "map/rename", id: "a", name: "Crypt" })).toBe(renamed);
    expect(applyOp(state, { kind: "map/rename", id: "x", name: "Crypt" })).toBe(state);
  });

  it("map/set-grid replaces one map's grid immutably and is a no-op otherwise", () => {
    const state = withMaps("a", "b");
    const grid = {
      cellSize: 48.5,
      offsetX: 12,
      offsetY: -7,
      dm: { visible: true, color: "#ff0000", opacity: 0.8 },
      player: { visible: false, color: "#00ff00", opacity: 0.1 },
    };
    const next = applyOp(state, { kind: "map/set-grid", id: "a", grid });
    expect(next.maps[0].grid).toEqual(grid);
    expect(next.maps[0].grid).not.toBe(grid); // defensive copy: later mutation of `grid` cannot leak in
    expect(next.maps[1]).toBe(state.maps[1]);
    expect(state.maps[0].grid).toEqual(defaultGridSettings());
    expect(applyOp(next, { kind: "map/set-grid", id: "a", grid: { ...grid, dm: { ...grid.dm } } })).toBe(next);
    expect(applyOp(state, { kind: "map/set-grid", id: "zzz", grid })).toBe(state);
    expect(gridSettingsEqual(grid, next.maps[0].grid)).toBe(true);
    expect(gridSettingsEqual(grid, { ...grid, player: { ...grid.player, opacity: 0.2 } })).toBe(false);
  });

  it("add + set-active in one batch yields a shown map (the import path)", () => {
    const result = applyOps(initialSharedState(), [
      { kind: "map/add", map: scene("m") },
      { kind: "map/set-active", id: "m" },
    ]);
    expect(result.activeMapId).toBe("m");
    expect(isSharedState(result)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
