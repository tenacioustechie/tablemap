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
});
