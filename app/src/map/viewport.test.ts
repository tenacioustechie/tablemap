import {
  centerAtScale,
  centerOn,
  clampScale,
  fitToView,
  mapToScreen,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  rotateVector,
  screenToMap,
  wheelZoomFactor,
  zoomAt,
} from "./viewport";

describe("screenToMap / mapToScreen", () => {
  const vp = { x: 100, y: 50, scale: 2 };

  it("inverts the stage transform", () => {
    expect(screenToMap(vp, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(screenToMap(vp, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
    expect(mapToScreen(vp, { x: 100, y: 100 })).toEqual({ x: 300, y: 250 });
    const p = { x: 12.5, y: -7 };
    expect(screenToMap(vp, mapToScreen(vp, p))).toEqual(p);
  });

  it("applies the rotation clockwise after scaling, exactly for quarter turns (T009)", () => {
    const turned = { ...vp, rotation: 90 };
    // Map +x becomes screen +y (clockwise, y down).
    expect(mapToScreen(turned, { x: 10, y: 0 })).toEqual({ x: 100, y: 70 });
    expect(mapToScreen(turned, { x: 0, y: 10 })).toEqual({ x: 80, y: 50 });
    expect(mapToScreen({ ...vp, rotation: 180 }, { x: 10, y: 5 })).toEqual({ x: 80, y: 40 });
    expect(mapToScreen({ ...vp, rotation: 270 }, { x: 10, y: 0 })).toEqual({ x: 100, y: 30 });
    for (const rotation of [0, 90, 180, 270, 360, -90]) {
      const r = { ...vp, rotation };
      const p = { x: 12.5, y: -7 };
      expect(screenToMap(r, mapToScreen(r, p))).toEqual(p);
    }
    expect(rotateVector({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 1 });
    expect(rotateVector({ x: 1, y: 0 }, -90)).toEqual({ x: 0, y: -1 });
    const oblique = rotateVector({ x: 1, y: 0 }, 45);
    expect(oblique.x).toBeCloseTo(Math.SQRT1_2);
    expect(oblique.y).toBeCloseTo(Math.SQRT1_2);
  });
});

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

describe("centerOn (T103)", () => {
  it("puts the map point in the middle of the view, keeping the scale", () => {
    const vp = { x: 999, y: -5, scale: 2 };
    const centred = centerOn(vp, { x: 100, y: 50 }, { width: 800, height: 600 });
    expect(centred).toEqual({ x: 400 - 200, y: 300 - 100, scale: 2 });
    expect(mapToScreen(centred, { x: 100, y: 50 })).toEqual({ x: 400, y: 300 });
    expect(vp).toEqual({ x: 999, y: -5, scale: 2 });
  });

  it("honours the viewport's rotation", () => {
    const vp = { x: 0, y: 0, scale: 1, rotation: 90 };
    const centred = centerOn(vp, { x: 10, y: 20 }, { width: 200, height: 100 });
    expect(centred.rotation).toBe(90);
    expect(mapToScreen(centred, { x: 10, y: 20 })).toEqual({ x: 100, y: 50 });
  });
});

describe("centerAtScale", () => {
  it("keeps the given scale and centres the map, even when it overflows the view", () => {
    const vp = centerAtScale({ width: 4000, height: 3000 }, { width: 1920, height: 1080 }, 0.8);
    expect(vp.scale).toBe(0.8);
    expect(vp.x).toBe((1920 - 3200) / 2);
    expect(vp.y).toBe((1080 - 2400) / 2);
  });

  it("centres a small map inside the view", () => {
    const vp = centerAtScale({ width: 100, height: 50 }, { width: 1000, height: 1000 }, 2);
    expect(vp).toEqual({ scale: 2, x: 400, y: 450 });
  });

  it("falls back to fitting for a bad scale", () => {
    const map = { width: 200, height: 100 };
    const view = { width: 400, height: 400 };
    expect(centerAtScale(map, view, 0)).toEqual(fitToView(map, view));
    expect(centerAtScale(map, view, NaN)).toEqual(fitToView(map, view));
  });
});
