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
import { defaultGridSettings, type Annotation, type MapScene, type Token } from "./model";
import { createToken } from "./tokens";

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
  it("starts with an empty campaign, no maps, no active map, no splash image and the default artwork", () => {
    expect(initialSharedState()).toEqual({
      campaignName: "",
      maps: [],
      activeMapId: null,
      splashImageAssetId: null,
      splashTitleCard: false,
    });
  });

  it("campaign/set-splash-title-card chooses the title card over the default artwork (T015)", () => {
    const before = initialSharedState();
    const titled = applyOp(before, { kind: "campaign/set-splash-title-card", on: true });
    expect(titled).toEqual({ ...before, splashTitleCard: true });
    expect(before.splashTitleCard).toBe(false);
    expect(applyOp(titled, { kind: "campaign/set-splash-title-card", on: true })).toBe(titled);
    expect(applyOp(before, { kind: "campaign/set-splash-title-card", on: false })).toBe(before);
    expect(applyOp(titled, { kind: "campaign/set-splash-title-card", on: false })).toEqual(before);
    // Independent of the chosen image: both fields keep their own value.
    const withImage = applyOp(titled, { kind: "campaign/set-splash-image", assetId: "s1" });
    expect(withImage).toEqual({ ...before, splashTitleCard: true, splashImageAssetId: "s1" });
    expect(applyOp(withImage, { kind: "campaign/set-splash-image", assetId: null })).toEqual(titled);

    expect(isSharedOp({ kind: "campaign/set-splash-title-card", on: true })).toBe(true);
    expect(isSharedOp({ kind: "campaign/set-splash-title-card", on: false })).toBe(true);
    expect(isSharedOp({ kind: "campaign/set-splash-title-card", on: "yes" })).toBe(false);
    expect(isSharedOp({ kind: "campaign/set-splash-title-card", on: 1 })).toBe(false);
    expect(isSharedOp({ kind: "campaign/set-splash-title-card" })).toBe(false);
  });

  it("campaign/set-splash-image selects or clears the splash image (T009)", () => {
    const before = initialSharedState();
    const chosen = applyOp(before, { kind: "campaign/set-splash-image", assetId: "s1" });
    expect(chosen).toEqual({ ...before, splashImageAssetId: "s1" });
    expect(before.splashImageAssetId).toBeNull();
    expect(applyOp(chosen, { kind: "campaign/set-splash-image", assetId: "s1" })).toBe(chosen);
    expect(applyOp(chosen, { kind: "campaign/set-splash-image", assetId: null })).toEqual(before);
    expect(isSharedOp({ kind: "campaign/set-splash-image", assetId: null })).toBe(true);
    expect(isSharedOp({ kind: "campaign/set-splash-image", assetId: "s" })).toBe(true);
    expect(isSharedOp({ kind: "campaign/set-splash-image", assetId: "" })).toBe(false);
    expect(isSharedOp({ kind: "campaign/set-splash-image" })).toBe(false);
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
      splashImageAssetId: null,
      splashTitleCard: false,
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
      isSharedState({
        campaignName: "x",
        maps: [scene("a")],
        activeMapId: "a",
        splashImageAssetId: null,
        splashTitleCard: false,
      })
    ).toBe(true);
    expect(
      isSharedState({
        campaignName: "x",
        maps: [],
        activeMapId: null,
        splashImageAssetId: "s",
        splashTitleCard: true,
      })
    ).toBe(true);
    // Pre-v6 shape: no splash image field (migration adds it; the guard is strict).
    expect(
      isSharedState({ campaignName: "x", maps: [scene("a")], activeMapId: "a", splashTitleCard: false })
    ).toBe(false);
    // Pre-v7 shape: no title-card field (T015; the guard is strict).
    expect(
      isSharedState({ campaignName: "x", maps: [scene("a")], activeMapId: "a", splashImageAssetId: null })
    ).toBe(false);
    expect(
      isSharedState({
        campaignName: "x",
        maps: [],
        activeMapId: null,
        splashImageAssetId: null,
        splashTitleCard: "true",
      })
    ).toBe(false);
    expect(
      isSharedState({
        campaignName: "x",
        maps: [],
        activeMapId: null,
        splashImageAssetId: "",
        splashTitleCard: false,
      })
    ).toBe(false);
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

describe("token ops (T010)", () => {
  const withMaps = (...ids: string[]): SharedState => ({ ...initialSharedState(), maps: ids.map(scene) });
  const orc = (over: Partial<Token> = {}): Token =>
    createToken({ id: "orc", x: 100, y: 50, appearance: { type: "disc", color: "#f00" }, name: "Orc", badge: "O", ...over });
  const withToken = () => applyOp(withMaps("a", "b"), { kind: "map/token-add", id: "a", token: orc() });

  it("map/token-add appends a copy to one map; duplicates and unknown maps are ignored", () => {
    const state = withMaps("a", "b");
    const token = orc();
    const next = applyOp(state, { kind: "map/token-add", id: "a", token });
    expect(next.maps[0].tokens).toEqual([token]);
    expect(next.maps[0].tokens[0]).not.toBe(token);
    expect(next.maps[0].tokens[0].appearance).not.toBe(token.appearance);
    expect(next.maps[1]).toBe(state.maps[1]);
    expect(state.maps[0].tokens).toEqual([]);
    expect(applyOp(next, { kind: "map/token-add", id: "a", token: orc({ name: "Again" }) })).toBe(next);
    expect(applyOp(state, { kind: "map/token-add", id: "zzz", token })).toBe(state);
    const second = applyOp(next, { kind: "map/token-add", id: "a", token: orc({ id: "goblin" }) });
    expect(second.maps[0].tokens.map((t) => t.id)).toEqual(["orc", "goblin"]);
    expect(second.maps[0].tokens[0]).toBe(next.maps[0].tokens[0]); // untouched entries keep their identity
  });

  it("map/token-update patches one token immutably and is a no-op otherwise", () => {
    const state = withToken();
    const moved = applyOp(state, { kind: "map/token-update", id: "a", tokenId: "orc", patch: { x: 150, hidden: true } });
    expect(moved.maps[0].tokens[0]).toEqual(orc({ x: 150, hidden: true }));
    expect(state.maps[0].tokens[0]).toEqual(orc());
    expect(moved.maps[1]).toBe(state.maps[1]);
    expect(applyOp(moved, { kind: "map/token-update", id: "a", tokenId: "orc", patch: { x: 150 } })).toBe(moved);
    expect(applyOp(moved, { kind: "map/token-update", id: "a", tokenId: "orc", patch: {} })).toBe(moved);
    expect(applyOp(moved, { kind: "map/token-update", id: "a", tokenId: "nope", patch: { x: 1 } })).toBe(moved);
    expect(applyOp(moved, { kind: "map/token-update", id: "b", tokenId: "orc", patch: { x: 1 } })).toBe(moved);
    const image = applyOp(moved, {
      kind: "map/token-update",
      id: "a",
      tokenId: "orc",
      patch: { appearance: { type: "image", assetId: "img" }, size: 3, snapToGrid: false, badge: "", name: "" },
    });
    expect(image.maps[0].tokens[0]).toEqual(orc({ x: 150, hidden: true, appearance: { type: "image", assetId: "img" }, size: 3, snapToGrid: false, badge: "", name: "" }));
  });

  it("map/token-remove drops one token; unknown ids are ignored", () => {
    const state = applyOp(withToken(), { kind: "map/token-add", id: "a", token: orc({ id: "goblin" }) });
    const next = applyOp(state, { kind: "map/token-remove", id: "a", tokenId: "orc" });
    expect(next.maps[0].tokens.map((t) => t.id)).toEqual(["goblin"]);
    expect(state.maps[0].tokens).toHaveLength(2);
    expect(applyOp(next, { kind: "map/token-remove", id: "a", tokenId: "orc" })).toBe(next);
    expect(applyOp(next, { kind: "map/token-remove", id: "zzz", tokenId: "goblin" })).toBe(next);
  });

  it("guards the three token ops, including the patch shape", () => {
    expect(isSharedOp({ kind: "map/token-add", id: "a", token: orc() })).toBe(true);
    expect(isSharedOp({ kind: "map/token-add", id: "a", token: { ...orc(), size: 9 } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-add", id: "", token: orc() })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: {} })).toBe(true);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { x: 1, hidden: true, appearance: { type: "disc", color: "#0f0" } } })).toBe(true);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { x: "1" } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { id: "other" } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { size: 0 } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { appearance: { type: "image" } } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: null })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "", patch: {} })).toBe(false);
    expect(isSharedOp({ kind: "map/token-remove", id: "a", tokenId: "t" })).toBe(true);
    expect(isSharedOp({ kind: "map/token-remove", id: "a" })).toBe(false);
    // The state with tokens is still plain JSON and validates.
    const state = withToken();
    expect(isSharedState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });
});

describe("annotation ops (T011)", () => {
  const withMaps = (...ids: string[]): SharedState => ({ ...initialSharedState(), maps: ids.map(scene) });
  type Note = Extract<Annotation, { kind: "note" }>;
  type Drawing = Extract<Annotation, { kind: "drawing" }>;
  const note = (over: Partial<Note> = {}): Note => ({
    id: "n1",
    kind: "note",
    x: 10,
    y: 20,
    text: "Trap",
    visibility: "dm",
    ...over,
  });
  const drawing = (over: Partial<Drawing> = {}): Drawing => ({
    id: "d1",
    kind: "drawing",
    points: [0, 0, 5, 5],
    color: "#f00",
    strokeWidth: 3,
    visibility: "all",
    ...over,
  });

  it("map/annotation-set appends a copy, replaces in place by id, and is a no-op for identical or unknown", () => {
    const state = withMaps("a", "b");
    const n = note();
    const next = applyOp(state, { kind: "map/annotation-set", id: "a", annotation: n });
    expect(next.maps[0].annotations).toEqual([n]);
    expect(next.maps[0].annotations[0]).not.toBe(n);
    expect(next.maps[1]).toBe(state.maps[1]);
    expect(state.maps[0].annotations).toEqual([]);
    expect(applyOp(next, { kind: "map/annotation-set", id: "a", annotation: note() })).toBe(next);
    expect(applyOp(next, { kind: "map/annotation-set", id: "zzz", annotation: n })).toBe(next);

    const d = drawing();
    const two = applyOp(next, { kind: "map/annotation-set", id: "a", annotation: d });
    expect(two.maps[0].annotations.map((a) => a.id)).toEqual(["n1", "d1"]);
    expect(two.maps[0].annotations[0]).toBe(next.maps[0].annotations[0]);
    const points = [1, 1, 2, 2];
    const drawn = two.maps[0].annotations[1];
    expect(drawn.kind === "drawing" && drawn.points).not.toBe(d.points);

    const moved = applyOp(two, { kind: "map/annotation-set", id: "a", annotation: note({ x: 99, text: "Moved" }) });
    expect(moved.maps[0].annotations.map((a) => a.id)).toEqual(["n1", "d1"]); // same slot
    expect(moved.maps[0].annotations[0]).toMatchObject({ x: 99, text: "Moved" });
    expect(moved.maps[0].annotations[1]).toBe(two.maps[0].annotations[1]);
    const restyled = applyOp(moved, { kind: "map/annotation-set", id: "a", annotation: drawing({ points, visibility: "dm" }) });
    expect(restyled.maps[0].annotations[1]).toMatchObject({ points, visibility: "dm" });
  });

  it("map/annotation-remove drops one annotation; map/annotations-clear drops a whole kind", () => {
    let state = withMaps("a", "b");
    for (const a of [note(), drawing(), drawing({ id: "d2", visibility: "dm" }), note({ id: "n2" })]) {
      state = applyOp(state, { kind: "map/annotation-set", id: "a", annotation: a });
    }
    const removed = applyOp(state, { kind: "map/annotation-remove", id: "a", annotationId: "d1" });
    expect(removed.maps[0].annotations.map((a) => a.id)).toEqual(["n1", "d2", "n2"]);
    expect(applyOp(removed, { kind: "map/annotation-remove", id: "a", annotationId: "d1" })).toBe(removed);
    expect(applyOp(removed, { kind: "map/annotation-remove", id: "zzz", annotationId: "n1" })).toBe(removed);

    const cleared = applyOp(state, { kind: "map/annotations-clear", id: "a", annotationKind: "drawing" });
    expect(cleared.maps[0].annotations.map((a) => a.id)).toEqual(["n1", "n2"]);
    expect(cleared.maps[1]).toBe(state.maps[1]);
    expect(applyOp(cleared, { kind: "map/annotations-clear", id: "a", annotationKind: "drawing" })).toBe(cleared);
    const noNotes = applyOp(cleared, { kind: "map/annotations-clear", id: "a", annotationKind: "note" });
    expect(noNotes.maps[0].annotations).toEqual([]);
    expect(applyOp(state, { kind: "map/annotations-clear", id: "zzz", annotationKind: "drawing" })).toBe(state);
  });

  it("guards the three annotation ops", () => {
    expect(isSharedOp({ kind: "map/annotation-set", id: "a", annotation: note() })).toBe(true);
    expect(isSharedOp({ kind: "map/annotation-set", id: "a", annotation: drawing() })).toBe(true);
    expect(isSharedOp({ kind: "map/annotation-set", id: "a", annotation: { ...note(), visibility: "all" } })).toBe(false);
    expect(isSharedOp({ kind: "map/annotation-set", id: "a", annotation: drawing({ points: [1, "x" as unknown as number] }) })).toBe(false);
    expect(isSharedOp({ kind: "map/annotation-set", id: "", annotation: note() })).toBe(false);
    expect(isSharedOp({ kind: "map/annotation-set", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/annotation-remove", id: "a", annotationId: "n1" })).toBe(true);
    expect(isSharedOp({ kind: "map/annotation-remove", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/annotations-clear", id: "a", annotationKind: "drawing" })).toBe(true);
    expect(isSharedOp({ kind: "map/annotations-clear", id: "a", annotationKind: "note" })).toBe(true);
    expect(isSharedOp({ kind: "map/annotations-clear", id: "a", annotationKind: "token" })).toBe(false);
    const state = applyOp(withMaps("a"), { kind: "map/annotation-set", id: "a", annotation: note() });
    expect(isSharedState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });
});
