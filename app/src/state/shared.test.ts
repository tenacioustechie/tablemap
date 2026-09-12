import {
  applyOp,
  applyOps,
  initialSharedState,
  isSharedOp,
  isSharedState,
} from "./shared";

describe("shared state reducer", () => {
  it("starts with an empty campaign name", () => {
    expect(initialSharedState()).toEqual({ campaignName: "" });
  });

  it("applies campaign/set-name immutably", () => {
    const before = initialSharedState();
    const after = applyOp(before, { kind: "campaign/set-name", name: "Tomb" });
    expect(after).toEqual({ campaignName: "Tomb" });
    expect(before).toEqual({ campaignName: "" });
  });

  it("returns the same object for a no-op", () => {
    const state = { campaignName: "Tomb" };
    expect(applyOp(state, { kind: "campaign/set-name", name: "Tomb" })).toBe(
      state
    );
  });

  it("applies ops in order", () => {
    const result = applyOps(initialSharedState(), [
      { kind: "campaign/set-name", name: "A" },
      { kind: "campaign/set-name", name: "B" },
    ]);
    expect(result.campaignName).toBe("B");
  });

  it("validates state and op shapes", () => {
    expect(isSharedState({ campaignName: "x" })).toBe(true);
    expect(isSharedState({ campaignName: 1 })).toBe(false);
    expect(isSharedState(null)).toBe(false);
    expect(isSharedState([])).toBe(false);
    expect(isSharedOp({ kind: "campaign/set-name", name: "x" })).toBe(true);
    expect(isSharedOp({ kind: "campaign/set-name" })).toBe(false);
    expect(isSharedOp({ kind: "other" })).toBe(false);
    expect(isSharedOp("campaign/set-name")).toBe(false);
  });
});
