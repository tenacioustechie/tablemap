import {
  clampScale,
  fitToView,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  wheelZoomFactor,
  zoomAt,
} from "./viewport";

describe("fitToView", () => {
  it("contains a wide map, centred vertically", () => {
    const vp = fitToView({ width: 2000, height: 1000 }, { width: 1000, height: 1000 });
    expect(vp.scale).toBe(0.5);
    expect(vp.x).toBe(0);
    expect(vp.y).toBe(250);
  });

  it("contains a tall map, centred horizontally, honouring padding", () => {
    const vp = fitToView({ width: 500, height: 1000 }, { width: 1000, height: 600 }, 50);
    expect(vp.scale).toBe(0.5);
    expect(vp.y).toBe(50);
    expect(vp.x).toBe(375);
  });

  it("scales small maps up to fill", () => {
    const vp = fitToView({ width: 100, height: 100 }, { width: 400, height: 800 });
    expect(vp.scale).toBe(4);
    expect(vp).toEqual({ x: 0, y: 200, scale: 4 });
  });

  it("returns identity for degenerate sizes", () => {
    expect(fitToView({ width: 0, height: 10 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 0, scale: 1 });
    expect(fitToView({ width: 10, height: 10 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, scale: 1 });
    expect(fitToView({ width: 10, height: 10 }, { width: 40, height: 40 }, 30)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe("zoomAt", () => {
  const vp = { x: 100, y: 50, scale: 2 };

  it("keeps the map point under the pointer fixed", () => {
    const pointer = { x: 300, y: 250 };
    const before = { x: (pointer.x - vp.x) / vp.scale, y: (pointer.y - vp.y) / vp.scale };
    const next = zoomAt(vp, pointer, 1.5);
    expect(next.scale).toBe(3);
    const after = { x: (pointer.x - next.x) / next.scale, y: (pointer.y - next.y) / next.scale };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("zooming out then in by the inverse factor restores the viewport", () => {
    const pointer = { x: 10, y: 20 };
    const back = zoomAt(zoomAt(vp, pointer, 0.5), pointer, 2);
    expect(back.scale).toBeCloseTo(vp.scale);
    expect(back.x).toBeCloseTo(vp.x);
    expect(back.y).toBeCloseTo(vp.y);
  });

  it("clamps the scale and returns the same object at the limit", () => {
    const atMax = zoomAt(vp, { x: 0, y: 0 }, 1000);
    expect(atMax.scale).toBe(MAX_SCALE);
    expect(zoomAt(atMax, { x: 0, y: 0 }, 2)).toBe(atMax);
    const atMin = zoomAt(vp, { x: 0, y: 0 }, 0.0001);
    expect(atMin.scale).toBe(MIN_SCALE);
    expect(zoomAt(atMin, { x: 0, y: 0 }, 0.5)).toBe(atMin);
  });

  it("clampScale and wheelZoomFactor", () => {
    expect(clampScale(3, 1, 2)).toBe(2);
    expect(clampScale(0.5, 1, 2)).toBe(1);
    expect(clampScale(1.5, 1, 2)).toBe(1.5);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-1) * wheelZoomFactor(1)).toBeCloseTo(1);
  });

  it("panBy offsets without changing scale", () => {
    expect(panBy(vp, 5, -5)).toEqual({ x: 105, y: 45, scale: 2 });
    expect(panBy(vp, 0, 0)).toBe(vp);
  });
});
