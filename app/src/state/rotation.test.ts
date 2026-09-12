import {
  isQuarterTurn,
  isRotation,
  mapEdgeAtTop,
  normalizeRotation,
  rotateClockwise,
  rotateCounterClockwise,
  ROTATIONS,
  type Rotation,
} from "./rotation";

describe("rotation", () => {
  it("steps clockwise and counter-clockwise in quarter turns, wrapping around", () => {
    expect(rotateClockwise(0)).toBe(90);
    expect(rotateClockwise(270)).toBe(0);
    expect(rotateCounterClockwise(0)).toBe(270);
    expect(rotateCounterClockwise(90)).toBe(0);
    for (const r of ROTATIONS) {
      expect(rotateCounterClockwise(rotateClockwise(r))).toBe(r);
    }
  });

  it("normalises multiples of 90 and rejects anything else", () => {
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(45)).toBe(0);
    expect(normalizeRotation(NaN)).toBe(0);
    expect(isRotation(180)).toBe(true);
    expect(isRotation(30)).toBe(false);
    expect(isRotation("90")).toBe(false);
  });

  it("knows which rotations swap width and height, and which map edge is at the top", () => {
    expect(isQuarterTurn(0)).toBe(false);
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(180)).toBe(false);
    expect(isQuarterTurn(270)).toBe(true);
    const edges: Record<Rotation, string> = { 0: "top", 90: "left", 180: "bottom", 270: "right" };
    for (const r of ROTATIONS) expect(mapEdgeAtTop(r)).toBe(edges[r]);
  });
});
