import { defaultPlayerPresentation, lockedScale } from "../state/calibration";
import { ROTATIONS, type Rotation } from "../state/rotation";
import {
  clampCenter,
  DEFAULT_PLAYER_DISPLAY,
  isScaleLocked,
  playerScale,
  playerStageTransform,
  playerViewportRect,
  rectCenter,
  resolvePlayerView,
  rotatedSize,
  type PlayerView,
} from "./playerView";
import { mapToScreen, screenToMap, type Point } from "./viewport";

const display = { width: 1920, height: 1080 };
const scene = { width: 4000, height: 3000, grid: { cellSize: 50 } };
const calibrated = { ...defaultPlayerPresentation(), pxPerInch: 100 };

const closePoint = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("viewport rect <-> player transform", () => {
  const view = (rotation: Rotation): PlayerView => ({ center: { x: 1234, y: 567 }, scale: 2, rotation });

  it.each(ROTATIONS)("rotation %d: the centre lands mid-display and the transform inverts the rect", (rotation) => {
    const v = view(rotation);
    const transform = playerStageTransform(v, display);
    expect(transform.scale).toBe(2);
    expect(transform.rotation).toBe(rotation);
    closePoint(mapToScreen(transform, v.center), { x: 960, y: 540 });
    closePoint(screenToMap(transform, { x: 960, y: 540 }), v.center);

    // Every corner of the viewport rectangle is a corner of the display.
    const rect = playerViewportRect(v, display);
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ].map((p) => mapToScreen(transform, p));
    const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;
    expect(new Set(corners.map(key))).toEqual(new Set(["0,0", "1920,0", "0,1080", "1920,1080"]));
    closePoint(rectCenter(rect), v.center);
  });

  it("a quarter turn swaps the rectangle's width and height, never its area or scale", () => {
    const straight = playerViewportRect(view(0), display);
    const turned = playerViewportRect(view(90), display);
    expect(straight).toEqual({ x: 1234 - 480, y: 567 - 270, width: 960, height: 540 });
    expect(turned).toEqual({ x: 1234 - 270, y: 567 - 480, width: 540, height: 960 });
    expect(playerViewportRect(view(180), display)).toEqual(straight);
    expect(playerViewportRect(view(270), display)).toEqual(turned);
    expect(rotatedSize(display, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(display, 180)).toEqual(display);
  });

  it("rotation 90 puts the map's left edge along the top of the display", () => {
    // Map point straight left of the centre appears straight above it.
    const transform = playerStageTransform(view(90), display);
    const left = mapToScreen(transform, { x: 1234 - 100, y: 567 });
    closePoint(left, { x: 960, y: 540 - 200 });
    const transform180 = playerStageTransform(view(180), display);
    closePoint(mapToScreen(transform180, { x: 1234, y: 567 - 100 }), { x: 960, y: 540 + 200 });
  });

  it("dragging the rectangle by a map offset moves the centre by exactly that offset", () => {
    for (const rotation of ROTATIONS) {
      const rect = playerViewportRect(view(rotation), display);
      const moved = { ...rect, x: rect.x + 33, y: rect.y - 12 };
      expect(rectCenter(moved)).toEqual({ x: 1234 + 33, y: 567 - 12 });
    }
  });
});

describe("resolvePlayerView", () => {
  it("calibrated: locks the scale from the calibration and honours the pan centre", () => {
    const v = resolvePlayerView({ ...calibrated, center: { x: 100, y: 200 } }, scene, display);
    expect(v.scale).toBe(lockedScale(100, "inch", 50));
    expect(v.center).toEqual({ x: 100, y: 200 });
    expect(v.rotation).toBe(0);
    expect(isScaleLocked(calibrated)).toBe(true);
  });

  it("rotation preserves the calibration scale: a cell is the same number of screen pixels", () => {
    for (const rotation of ROTATIONS) {
      const v = resolvePlayerView({ ...calibrated, rotation }, scene, display);
      expect(v.scale).toBe(2);
      expect(scene.grid.cellSize * v.scale).toBe(100);
      const transform = playerStageTransform(v, display);
      const a = mapToScreen(transform, { x: 0, y: 0 });
      const b = mapToScreen(transform, { x: 50, y: 0 });
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100, 9);
    }
  });

  it("no centre means the map's centre; the centre is clamped onto the map", () => {
    expect(resolvePlayerView(calibrated, scene, display).center).toEqual({ x: 2000, y: 1500 });
    expect(
      resolvePlayerView({ ...calibrated, center: { x: -50, y: 9999 } }, scene, display).center
    ).toEqual({ x: 0, y: 3000 });
    expect(clampCenter({ x: 5, y: 5 }, scene)).toEqual({ x: 5, y: 5 });
  });

  it("uncalibrated and overview fit the map to the rotated display and ignore the pan", () => {
    const flat = resolvePlayerView(
      { ...defaultPlayerPresentation(), center: { x: 1, y: 1 } },
      scene,
      display
    );
    expect(flat.scale).toBe(Math.min(1920 / 4000, 1080 / 3000));
    expect(flat.center).toEqual({ x: 2000, y: 1500 });
    const turned = resolvePlayerView({ ...defaultPlayerPresentation(), rotation: 90 }, scene, display);
    expect(turned.scale).toBe(Math.min(1080 / 4000, 1920 / 3000));
    const overview = { ...calibrated, overview: true, center: { x: 1, y: 1 } };
    expect(isScaleLocked(overview)).toBe(false);
    expect(resolvePlayerView(overview, scene, display)).toEqual(flat);
    // Fitted maps are centred on the display whichever way they are turned.
    for (const rotation of ROTATIONS) {
      const v = resolvePlayerView({ ...defaultPlayerPresentation(), rotation }, scene, display);
      closePoint(mapToScreen(playerStageTransform(v, display), v.center), { x: 960, y: 540 });
    }
  });

  it("playerScale falls back to scale 1 for a degenerate display, and the default display is 1080p", () => {
    expect(playerScale(defaultPlayerPresentation(), scene, { width: 0, height: 0 })).toBe(1);
    expect(DEFAULT_PLAYER_DISPLAY).toEqual({ width: 1920, height: 1080 });
  });
});
