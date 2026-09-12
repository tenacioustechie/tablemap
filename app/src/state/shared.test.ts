import {
  applyOp,
  applyOps,
  initialSharedState,
  isSharedOp,
  isSharedState,
  type SharedState,
} from "./shared";
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
