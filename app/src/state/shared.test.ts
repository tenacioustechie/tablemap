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
import { initialInitiative, linkedToken } from "./initiative";
import { duplicateMapScene } from "./maps";
import { defaultGridSettings, type Annotation, type MapScene, type Token } from "./model";
import { createToken } from "./tokens";
import type { WallSegment } from "./walls";

const scene = (id: string): MapScene => ({
  id,
  name: `Map ${id}`,
  imageAssetId: null,
  backgroundColor: "#3b3b3b",
  imageRotation: 0,
  width: 1000,
  height: 800,
  grid: defaultGridSettings(),
  fogMaskAssetId: null,
  fogOps: [],
  fogOpsFrom: 0,
  tokens: [],
  annotations: [],
  walls: [],
  visionDim: "auto",
});

describe("shared state reducer", () => {
  it("starts with an empty campaign, no maps, no active map, no splash image, the default artwork and an empty initiative list", () => {
    expect(initialSharedState()).toEqual({
      campaignName: "",
      maps: [],
      activeMapId: null,
      splashImageAssetId: null,
      splashTitleCard: false,
      initiative: { entries: [], turn: null, round: 1 },
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
      initiative: { entries: [{ id: "i", name: "Loaded", value: 9, tokenId: null }], turn: 0, round: 2 },
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
        initiative: initialInitiative(),
      })
    ).toBe(true);
    expect(
      isSharedState({
        campaignName: "x",
        maps: [],
        activeMapId: null,
        splashImageAssetId: "s",
        splashTitleCard: true,
        initiative: initialInitiative(),
      })
    ).toBe(true);
    // Pre-v11 shape: no initiative (T109; the guard is strict).
    expect(
      isSharedState({ campaignName: "x", maps: [], activeMapId: null, splashImageAssetId: null, splashTitleCard: false })
    ).toBe(false);
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
        initiative: initialInitiative(),
      })
    ).toBe(false);
    expect(
      isSharedState({
        campaignName: "x",
        maps: [],
        activeMapId: null,
        splashImageAssetId: "",
        splashTitleCard: false,
        initiative: initialInitiative(),
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
    // Vision is patched like any field (T105), and the hidden token keeps it.
    const seeing = applyOp(moved, { kind: "map/token-update", id: "a", tokenId: "orc", patch: { vision: 6 } });
    expect(seeing.maps[0].tokens[0]).toEqual(orc({ x: 150, hidden: true, vision: 6 }));
    expect(applyOp(seeing, { kind: "map/token-update", id: "a", tokenId: "orc", patch: { vision: 6 } })).toBe(seeing);
    expect(applyOp(seeing, { kind: "map/token-update", id: "a", tokenId: "orc", patch: { hidden: false } }).maps[0].tokens[0].vision).toBe(6);
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
    // Vision (T105): whole cells, 0 or more, in a patch and on a new token alike.
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { vision: 6 } })).toBe(true);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { vision: 0 } })).toBe(true);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { vision: -1 } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-update", id: "a", tokenId: "t", patch: { vision: 2.5 } })).toBe(false);
    expect(isSharedOp({ kind: "map/token-add", id: "a", token: orc({ vision: 4 }) })).toBe(true);
    expect(isSharedOp({ kind: "map/token-add", id: "a", token: { ...orc(), vision: -3 } })).toBe(false);
    const noVision = Object.fromEntries(Object.entries(orc()).filter(([k]) => k !== "vision"));
    expect(isSharedOp({ kind: "map/token-add", id: "a", token: noVision })).toBe(false);
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

describe("wall ops (T101, ADR 0024)", () => {
  const wall: WallSegment = { id: "w1", kind: "wall", x1: 0, y1: 0, x2: 100, y2: 0 };
  const door: WallSegment = { id: "d1", kind: "door", x1: 100, y1: 0, x2: 150, y2: 0, open: false };
  const twoMaps = (): SharedState => ({
    ...initialSharedState(),
    maps: [scene("a"), scene("b")],
    activeMapId: "a",
  });

  it("map/wall-set appends a copy to one map, replaces in place by id, and is a no-op when identical or unknown", () => {
    const before = twoMaps();
    const withWall = applyOp(before, { kind: "map/wall-set", id: "a", segment: wall });
    expect(withWall.maps[0].walls).toEqual([wall]);
    expect(withWall.maps[0].walls[0]).not.toBe(wall);
    expect(withWall.maps[1].walls).toEqual([]);
    expect(before.maps[0].walls).toEqual([]);

    const withDoor = applyOp(withWall, { kind: "map/wall-set", id: "a", segment: door });
    expect(withDoor.maps[0].walls).toEqual([wall, door]);
    // Identical segment: same state object.
    expect(applyOp(withDoor, { kind: "map/wall-set", id: "a", segment: { ...door } })).toBe(withDoor);
    // Same id: replaced in place, order kept. A door's `open` changes this way too.
    const opened = applyOp(withDoor, { kind: "map/wall-set", id: "a", segment: { ...door, open: true } });
    expect(opened.maps[0].walls).toEqual([wall, { ...door, open: true }]);
    const moved = applyOp(opened, { kind: "map/wall-set", id: "a", segment: { ...wall, x2: 90 } });
    expect(moved.maps[0].walls).toEqual([{ ...wall, x2: 90 }, { ...door, open: true }]);
    // The kind may change under the same id.
    const asWall = applyOp(moved, { kind: "map/wall-set", id: "a", segment: { id: "d1", kind: "wall", x1: 100, y1: 0, x2: 150, y2: 0 } });
    expect(asWall.maps[0].walls[1]).toEqual({ id: "d1", kind: "wall", x1: 100, y1: 0, x2: 150, y2: 0 });
    // Unknown map: no-op.
    expect(applyOp(withDoor, { kind: "map/wall-set", id: "nope", segment: wall })).toBe(withDoor);
  });

  it("map/wall-remove drops one segment; an unknown segment id or map is a no-op", () => {
    const state = applyOps(twoMaps(), [
      { kind: "map/wall-set", id: "a", segment: wall },
      { kind: "map/wall-set", id: "a", segment: door },
      { kind: "map/wall-set", id: "b", segment: wall },
    ]);
    const removed = applyOp(state, { kind: "map/wall-remove", id: "a", segmentId: "w1" });
    expect(removed.maps[0].walls).toEqual([door]);
    expect(removed.maps[1].walls).toEqual([wall]);
    expect(applyOp(removed, { kind: "map/wall-remove", id: "a", segmentId: "w1" })).toBe(removed);
    expect(applyOp(removed, { kind: "map/wall-remove", id: "a", segmentId: "ghost" })).toBe(removed);
    expect(applyOp(removed, { kind: "map/wall-remove", id: "nope", segmentId: "d1" })).toBe(removed);
  });

  it("map/walls-clear empties one map's walls and is a no-op when there are none", () => {
    const state = applyOps(twoMaps(), [
      { kind: "map/wall-set", id: "a", segment: wall },
      { kind: "map/wall-set", id: "a", segment: door },
      { kind: "map/wall-set", id: "b", segment: door },
    ]);
    const cleared = applyOp(state, { kind: "map/walls-clear", id: "a" });
    expect(cleared.maps[0].walls).toEqual([]);
    expect(cleared.maps[1].walls).toEqual([door]);
    expect(applyOp(cleared, { kind: "map/walls-clear", id: "a" })).toBe(cleared);
    expect(applyOp(cleared, { kind: "map/walls-clear", id: "nope" })).toBe(cleared);
    // The state stays plain JSON.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("map/door-set-open opens and closes one door in place; a wall, an unknown segment or map, or the same state is a no-op (T103)", () => {
    const state = applyOps(twoMaps(), [
      { kind: "map/wall-set", id: "a", segment: wall },
      { kind: "map/wall-set", id: "a", segment: door },
      { kind: "map/wall-set", id: "b", segment: door },
    ]);
    const opened = applyOp(state, { kind: "map/door-set-open", id: "a", segmentId: "d1", open: true });
    expect(opened.maps[0].walls).toEqual([wall, { ...door, open: true }]);
    expect(opened.maps[0].walls[0]).toBe(state.maps[0].walls[0]); // the wall keeps its identity
    expect(opened.maps[1].walls).toEqual([door]); // the other map's door is untouched
    expect(state.maps[0].walls[1]).toEqual(door); // and the input was not mutated
    // Already open: same state.
    expect(applyOp(opened, { kind: "map/door-set-open", id: "a", segmentId: "d1", open: true })).toBe(opened);
    const closed = applyOp(opened, { kind: "map/door-set-open", id: "a", segmentId: "d1", open: false });
    expect(closed.maps[0].walls).toEqual([wall, door]);
    expect(applyOp(closed, { kind: "map/door-set-open", id: "a", segmentId: "d1", open: false })).toBe(closed);
    // A wall id is a no-op: the op never turns a wall into a door.
    expect(applyOp(state, { kind: "map/door-set-open", id: "a", segmentId: "w1", open: true })).toBe(state);
    expect(applyOp(state, { kind: "map/door-set-open", id: "a", segmentId: "ghost", open: true })).toBe(state);
    expect(applyOp(state, { kind: "map/door-set-open", id: "nope", segmentId: "d1", open: true })).toBe(state);
    // Equivalent to the wall-set it is a convenience over.
    expect(opened).toEqual(applyOp(state, { kind: "map/wall-set", id: "a", segment: { ...door, open: true } }));
    expect(JSON.parse(JSON.stringify(opened))).toEqual(opened);
  });

  it("guards the wall ops, and a state's maps must carry a wall list", () => {
    expect(isSharedOp({ kind: "map/door-set-open", id: "a", segmentId: "d1", open: true })).toBe(true);
    expect(isSharedOp({ kind: "map/door-set-open", id: "a", segmentId: "d1", open: false })).toBe(true);
    expect(isSharedOp({ kind: "map/door-set-open", id: "", segmentId: "d1", open: true })).toBe(false);
    expect(isSharedOp({ kind: "map/door-set-open", id: "a", segmentId: "", open: true })).toBe(false);
    expect(isSharedOp({ kind: "map/door-set-open", id: "a", segmentId: "d1", open: "yes" })).toBe(false);
    expect(isSharedOp({ kind: "map/door-set-open", id: "a", segmentId: "d1" })).toBe(false);
    expect(isSharedOp({ kind: "map/door-set-open", id: "a", open: true })).toBe(false);
    expect(isSharedOp({ kind: "map/wall-set", id: "a", segment: wall })).toBe(true);
    expect(isSharedOp({ kind: "map/wall-set", id: "a", segment: door })).toBe(true);
    expect(isSharedOp({ kind: "map/wall-set", id: "", segment: wall })).toBe(false);
    expect(isSharedOp({ kind: "map/wall-set", id: "a", segment: { ...wall, kind: "fence" } })).toBe(false);
    expect(isSharedOp({ kind: "map/wall-set", id: "a", segment: { ...door, open: "no" } })).toBe(false);
    expect(isSharedOp({ kind: "map/wall-set", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/wall-remove", id: "a", segmentId: "w1" })).toBe(true);
    expect(isSharedOp({ kind: "map/wall-remove", id: "a", segmentId: "" })).toBe(false);
    expect(isSharedOp({ kind: "map/wall-remove", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/walls-clear", id: "a" })).toBe(true);
    expect(isSharedOp({ kind: "map/walls-clear", id: "" })).toBe(false);
    expect(isSharedOp({ kind: "map/walls-clear" })).toBe(false);

    const withWalls: SharedState = { ...initialSharedState(), maps: [{ ...scene("a"), walls: [wall, door] }] };
    expect(isSharedState(withWalls)).toBe(true);
    const noWalls = Object.fromEntries(Object.entries(scene("a")).filter(([k]) => k !== "walls"));
    expect(isSharedState({ ...initialSharedState(), maps: [noWalls] })).toBe(false);
    expect(isSharedState({ ...initialSharedState(), maps: [{ ...scene("a"), walls: [{ id: "w" }] }] })).toBe(false);
  });
});

describe("map/set-vision-dim (T105, ADR 0026)", () => {
  const withMaps = (...ids: string[]): SharedState => ({ ...initialSharedState(), maps: ids.map(scene) });

  it("sets one map's dim override immutably; the same value or an unknown map is a no-op", () => {
    const state = withMaps("a", "b");
    expect(state.maps.map((m) => m.visionDim)).toEqual(["auto", "auto"]);
    const off = applyOp(state, { kind: "map/set-vision-dim", id: "a", visionDim: "off" });
    expect(off.maps[0]).toEqual({ ...state.maps[0], visionDim: "off" });
    expect(off.maps[1]).toBe(state.maps[1]);
    expect(state.maps[0].visionDim).toBe("auto");
    expect(applyOp(off, { kind: "map/set-vision-dim", id: "a", visionDim: "off" })).toBe(off);
    expect(applyOp(off, { kind: "map/set-vision-dim", id: "zzz", visionDim: "on" })).toBe(off);
    const on = applyOp(off, { kind: "map/set-vision-dim", id: "a", visionDim: "on" });
    expect(on.maps[0].visionDim).toBe("on");
    expect(applyOp(on, { kind: "map/set-vision-dim", id: "a", visionDim: "auto" }).maps[0]).toEqual(state.maps[0]);
    expect(isSharedState(JSON.parse(JSON.stringify(on)))).toBe(true);
  });

  it("guards the op, and a state's maps must carry a legal dim override", () => {
    for (const visionDim of ["auto", "on", "off"]) {
      expect(isSharedOp({ kind: "map/set-vision-dim", id: "a", visionDim })).toBe(true);
    }
    expect(isSharedOp({ kind: "map/set-vision-dim", id: "a", visionDim: "dim" })).toBe(false);
    expect(isSharedOp({ kind: "map/set-vision-dim", id: "a", visionDim: true })).toBe(false);
    expect(isSharedOp({ kind: "map/set-vision-dim", id: "a" })).toBe(false);
    expect(isSharedOp({ kind: "map/set-vision-dim", id: "", visionDim: "on" })).toBe(false);

    const noDim = Object.fromEntries(Object.entries(scene("a")).filter(([k]) => k !== "visionDim"));
    expect(isSharedState({ ...initialSharedState(), maps: [noDim] })).toBe(false);
    expect(isSharedState({ ...initialSharedState(), maps: [{ ...scene("a"), visionDim: "sometimes" }] })).toBe(false);
    expect(isSharedState({ ...initialSharedState(), maps: [{ ...scene("a"), visionDim: "off" }] })).toBe(true);
  });
});

describe("map/rotate (T017, ADR 0021)", () => {
  const withMaps = (...ids: string[]): SharedState => ({
    ...initialSharedState(),
    maps: ids.map(scene),
    activeMapId: null,
  });
  const revealCell: FogOp = {
    type: "shape",
    mode: "reveal",
    shape: { kind: "rect", x: 100, y: 200, width: 50, height: 50 },
  };

  it("turns one map's size, image rotation, grid, fog, tokens and annotations and swaps in the baked mask", () => {
    const token = createToken({ id: "t", x: 100, y: 200, appearance: { type: "disc", color: "#f00" } });
    const before: SharedState = {
      ...withMaps("a", "b"),
      maps: [
        {
          ...scene("a"),
          grid: { ...defaultGridSettings(), cellSize: 50, offsetX: 12, offsetY: 7 },
          fogMaskAssetId: "mask-0",
          fogOps: [fogFill("hide"), revealCell],
          fogOpsFrom: 4,
          tokens: [token],
          annotations: [{ id: "n", kind: "note", x: 10, y: 20, text: "x", visibility: "dm" }],
        },
        scene("b"),
      ],
    };
    const after = applyOp(before, { kind: "map/rotate", id: "a", degrees: 90, fogMaskAssetId: "mask-1" });
    expect(after.maps[1]).toBe(before.maps[1]);
    // (W, H) = (1000, 800): (x, y) -> (800 - y, x).
    expect(after.maps[0]).toEqual({
      ...before.maps[0],
      width: 800,
      height: 1000,
      imageRotation: 90,
      grid: { ...before.maps[0].grid, offsetX: (800 - 7) % 50, offsetY: 12 },
      fogMaskAssetId: "mask-1",
      fogOps: [
        fogFill("hide"),
        { ...revealCell, shape: { kind: "rect", x: 800 - 250, y: 100, width: 50, height: 50 } },
      ],
      tokens: [{ ...token, x: 800 - 250, y: 100 }],
      annotations: [{ id: "n", kind: "note", x: 780, y: 10, text: "x", visibility: "dm" }],
    });
    expect(before.maps[0].width).toBe(1000); // immutable
    expect(applyOp(before, { kind: "map/rotate", id: "zzz", degrees: 90, fogMaskAssetId: null })).toBe(before);
  });

  it("four quarter turns give back the original scene; the state stays plain JSON", () => {
    const start: SharedState = {
      ...withMaps("a"),
      maps: [
        {
          ...scene("a"),
          fogOps: [revealCell],
          tokens: [createToken({ id: "t", x: 100, y: 200, size: 2, appearance: { type: "disc", color: "#f00" } })],
        },
      ],
    };
    let state = start;
    for (let i = 0; i < 4; i++) {
      state = applyOp(state, { kind: "map/rotate", id: "a", degrees: 90, fogMaskAssetId: null });
    }
    expect(state).toEqual(start);
    expect(isSharedState(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("guards the op, and a state's maps must carry a legal image rotation", () => {
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: 90, fogMaskAssetId: null })).toBe(true);
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: 270, fogMaskAssetId: "m" })).toBe(true);
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: 0, fogMaskAssetId: null })).toBe(false);
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: 45, fogMaskAssetId: null })).toBe(false);
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: "90", fogMaskAssetId: null })).toBe(false);
    expect(isSharedOp({ kind: "map/rotate", id: "", degrees: 90, fogMaskAssetId: null })).toBe(false);
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: 90 })).toBe(false);
    expect(isSharedOp({ kind: "map/rotate", id: "a", degrees: 90, fogMaskAssetId: "" })).toBe(false);
    expect(isSharedState({ ...withMaps("a"), maps: [{ ...scene("a"), imageRotation: 90 }] })).toBe(true);
    expect(isSharedState({ ...withMaps("a"), maps: [{ ...scene("a"), imageRotation: 45 }] })).toBe(false);
    const legacy: Partial<MapScene> = { ...scene("a") };
    delete legacy.imageRotation;
    expect(isSharedState({ ...withMaps("a"), maps: [legacy] })).toBe(false);
  });
});

describe("initiative in the shared state (T109, ADR 0027)", () => {
  const token = (id: string): Token => createToken({ id, x: 0, y: 0, appearance: { type: "disc", color: "#f00" } });
  const fight = (): SharedState => ({
    ...initialSharedState(),
    maps: [
      { ...scene("a"), tokens: [token("orc"), token("goblin")] },
      { ...scene("b"), tokens: [token("wolf")] },
    ],
    activeMapId: "a",
    initiative: {
      entries: [
        { id: "i1", name: "Orc", value: 12, tokenId: "orc" },
        { id: "i2", name: "Goblin", value: 15, tokenId: "goblin" },
        { id: "i3", name: "Orc again", value: 3, tokenId: "orc" },
        { id: "i4", name: "Wolf", value: 8, tokenId: "wolf" },
      ],
      turn: 1,
      round: 2,
    },
  });

  it("the initiative ops go through applyOp and touch nothing else; a no-op returns the same state", () => {
    const state = fight();
    const next = applyOp(state, { kind: "initiative/next" });
    expect(next).toEqual({ ...state, initiative: { ...state.initiative, turn: 2 } });
    expect(next.maps).toBe(state.maps);
    expect(next.initiative.entries).toBe(state.initiative.entries);
    expect(state.initiative.turn).toBe(1);
    expect(applyOp(state, { kind: "initiative/set-turn", id: "i2" })).toBe(state);
    expect(applyOp(state, { kind: "initiative/remove", id: "ghost" })).toBe(state);
    expect(applyOp(state, { kind: "initiative/update", id: "i1", patch: { value: 12 } })).toBe(state);

    const run = applyOps(state, [
      { kind: "initiative/add", entry: { id: "i5", name: "Bat", value: 20, tokenId: null } },
      { kind: "initiative/sort" },
      { kind: "initiative/prev" },
    ]);
    expect(run.initiative.entries.map((e) => e.id)).toEqual(["i5", "i2", "i1", "i4", "i3"]);
    expect(run.initiative).toMatchObject({ turn: 0, round: 2 });
    expect(applyOp(run, { kind: "initiative/reset" }).initiative).toMatchObject({ turn: 0, round: 1 });
    expect(applyOp(run, { kind: "initiative/clear" })).toEqual({ ...run, initiative: initialInitiative() });
    expect(isSharedState(JSON.parse(JSON.stringify(run)))).toBe(true);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it("map/token-remove unlinks every entry linked to the removed token, and only those; the turn is untouched", () => {
    const state = fight();
    const next = applyOp(state, { kind: "map/token-remove", id: "a", tokenId: "orc" });
    expect(next.maps[0].tokens.map((t) => t.id)).toEqual(["goblin"]);
    expect(next.initiative.entries.map((e) => e.tokenId)).toEqual([null, "goblin", null, "wolf"]);
    expect(next.initiative.entries.map((e) => e.name)).toEqual(["Orc", "Goblin", "Orc again", "Wolf"]);
    expect(next.initiative.entries[1]).toBe(state.initiative.entries[1]);
    expect(next.initiative).toMatchObject({ turn: 1, round: 2 });
    expect(state.initiative.entries[0].tokenId).toBe("orc"); // the input is untouched
    expect(isSharedState(next)).toBe(true);

    // A token on another map than the active one.
    const noWolf = applyOp(state, { kind: "map/token-remove", id: "b", tokenId: "wolf" });
    expect(noWolf.initiative.entries.map((e) => e.tokenId)).toEqual(["orc", "goblin", "orc", null]);
    // A token nobody is linked to: the initiative keeps its identity.
    const withBat = { ...state, maps: [{ ...state.maps[0], tokens: [...state.maps[0].tokens, token("bat")] }, state.maps[1]] };
    const noBat = applyOp(withBat, { kind: "map/token-remove", id: "a", tokenId: "bat" });
    expect(noBat.maps[0].tokens.map((t) => t.id)).toEqual(["orc", "goblin"]);
    expect(noBat.initiative).toBe(state.initiative);
    // Unknown token or map: the same state, links intact.
    expect(applyOp(state, { kind: "map/token-remove", id: "b", tokenId: "orc" })).toBe(state);
    expect(applyOp(state, { kind: "map/token-remove", id: "zzz", tokenId: "orc" })).toBe(state);
  });

  it("a token id another map still holds (a duplicated map) stays linked, to that map's token", () => {
    const state = fight();
    const duplicated = applyOp(state, { kind: "map/add", map: duplicateMapScene(state.maps[0], { id: "copy" }) });
    expect(duplicated.maps[2].tokens.map((t) => t.id)).toEqual(["orc", "goblin"]);
    const removed = applyOp(duplicated, { kind: "map/token-remove", id: "a", tokenId: "orc" });
    expect(removed.initiative).toBe(duplicated.initiative);
    expect(linkedToken(removed, removed.initiative.entries[0])?.map.id).toBe("copy");
    const gone = applyOp(removed, { kind: "map/token-remove", id: "copy", tokenId: "orc" });
    expect(gone.initiative.entries.map((e) => e.tokenId)).toEqual([null, "goblin", null, "wolf"]);
  });

  it("other ways a token disappears leave the link dangling, which reads as unlinked", () => {
    const state = fight();
    const noMap = applyOp(state, { kind: "map/remove", id: "b" });
    expect(noMap.initiative).toBe(state.initiative);
    expect(noMap.initiative.entries[3].tokenId).toBe("wolf");
    expect(linkedToken(noMap, noMap.initiative.entries[3])).toBeNull();
    expect(linkedToken(noMap, noMap.initiative.entries[1])?.token.id).toBe("goblin");
    expect(isSharedState(noMap)).toBe(true);
  });

  it("campaign/replace carries the initiative; the state guard requires a well-formed one", () => {
    const state = fight();
    expect(applyOp(initialSharedState(), { kind: "campaign/replace", state }).initiative).toBe(state.initiative);
    expect(isSharedState(state)).toBe(true);
    const noInitiative = Object.fromEntries(Object.entries(state).filter(([k]) => k !== "initiative"));
    expect(isSharedState(noInitiative)).toBe(false);
    expect(isSharedState({ ...state, initiative: { ...state.initiative, turn: 4 } })).toBe(false);
    expect(isSharedState({ ...state, initiative: { ...state.initiative, round: 0 } })).toBe(false);
    expect(isSharedState({ ...state, initiative: null })).toBe(false);
  });

  it("guards the initiative ops through isSharedOp", () => {
    const entry = { id: "i", name: "Bat", value: 20, tokenId: null };
    for (const op of [
      { kind: "initiative/add", entry },
      { kind: "initiative/update", id: "i", patch: { value: 4 } },
      { kind: "initiative/remove", id: "i" },
      { kind: "initiative/sort" },
      { kind: "initiative/next" },
      { kind: "initiative/prev" },
      { kind: "initiative/set-turn", id: "i" },
      { kind: "initiative/set-turn", id: null },
      { kind: "initiative/reset" },
      { kind: "initiative/clear" },
    ]) {
      expect(isSharedOp(op)).toBe(true);
    }
    expect(isSharedOp({ kind: "initiative/add", entry: { ...entry, value: "20" } })).toBe(false);
    expect(isSharedOp({ kind: "initiative/update", id: "i", patch: { turn: 1 } })).toBe(false);
    expect(isSharedOp({ kind: "initiative/remove", id: "" })).toBe(false);
    expect(isSharedOp({ kind: "initiative/set-turn" })).toBe(false);
    expect(isSharedOp({ kind: "initiative/roll" })).toBe(false);
  });
});
