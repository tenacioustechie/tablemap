/**
 * Pure viewport math for the Konva stage. A viewport is the stage transform:
 * map pixel `p` appears at screen pixel `rotate(p * scale) + (x, y)`, with
 * `rotation` in degrees clockwise (Konva's order: translate, rotate, scale).
 * The DM canvas never rotates; the player view does (T009).
 */

export interface Viewport {
  x: number;
  y: number;
  scale: number;
  /** Degrees clockwise; omitted means 0. */
  rotation?: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
/** Zoom multiplier per wheel notch. */
export const WHEEL_ZOOM_STEP = 1.1;

export function clampScale(
  scale: number,
  min: number = MIN_SCALE,
  max: number = MAX_SCALE
): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * A viewport that shows the whole map centred in `view` ("contain"), with
 * `padding` screen pixels on every side. Degenerate sizes yield scale 1.
 */
export function fitToView(map: Size, view: Size, padding = 0): Viewport {
  const availW = view.width - 2 * padding;
  const availH = view.height - 2 * padding;
  if (map.width <= 0 || map.height <= 0 || availW <= 0 || availH <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = Math.min(availW / map.width, availH / map.height);
  return {
    scale,
    x: (view.width - map.width * scale) / 2,
    y: (view.height - map.height * scale) / 2,
  };
}

/**
 * A viewport at a fixed `scale` with the map centred in `view` (used by the
 * calibration-locked player view: the scale is dictated, only the position
 * is free). Non-positive or non-finite scales fall back to `fitToView`.
 */
export function centerAtScale(map: Size, view: Size, scale: number): Viewport {
  if (!Number.isFinite(scale) || scale <= 0) return fitToView(map, view);
  return {
    scale,
    x: (view.width - map.width * scale) / 2,
    y: (view.height - map.height * scale) / 2,
  };
}

/**
 * Multiplies the scale by `factor`, keeping the map point under `pointer`
 * (screen coordinates) fixed. The scale is clamped; at the clamp the
 * viewport is returned unchanged.
 */
export function zoomAt(
  viewport: Viewport,
  pointer: Point,
  factor: number,
  min: number = MIN_SCALE,
  max: number = MAX_SCALE
): Viewport {
  const scale = clampScale(viewport.scale * factor, min, max);
  if (scale === viewport.scale) return viewport;
  const mapX = (pointer.x - viewport.x) / viewport.scale;
  const mapY = (pointer.y - viewport.y) / viewport.scale;
  return {
    scale,
    x: pointer.x - mapX * scale,
    y: pointer.y - mapY * scale,
  };
}

/** Zoom factor for a wheel event: up (negative deltaY) zooms in. */
export function wheelZoomFactor(deltaY: number, step = WHEEL_ZOOM_STEP): number {
  if (deltaY === 0) return 1;
  return deltaY < 0 ? step : 1 / step;
}

/**
 * Rotates a vector by `degrees` clockwise (y down). Quarter turns are exact
 * (no trigonometric noise), so rotated coordinates compare with `toEqual`.
 */
export function rotateVector(v: Point, degrees: number): Point {
  const r = ((degrees % 360) + 360) % 360;
  // `0 - n` rather than `-n`: no negative zero for axis-aligned inputs.
  switch (r) {
    case 0:
      return { x: v.x, y: v.y };
    case 90:
      return { x: 0 - v.y, y: v.x };
    case 180:
      return { x: 0 - v.x, y: 0 - v.y };
    case 270:
      return { x: v.y, y: 0 - v.x };
    default: {
      const rad = (r * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
    }
  }
}

/** Screen (stage) pixel -> map pixel under the given viewport. */
export function screenToMap(viewport: Viewport, point: Point): Point {
  const unrotated = rotateVector(
    { x: point.x - viewport.x, y: point.y - viewport.y },
    -(viewport.rotation ?? 0)
  );
  return { x: unrotated.x / viewport.scale, y: unrotated.y / viewport.scale };
}

/** Map pixel -> screen (stage) pixel under the given viewport. */
export function mapToScreen(viewport: Viewport, point: Point): Point {
  const rotated = rotateVector(
    { x: point.x * viewport.scale, y: point.y * viewport.scale },
    viewport.rotation ?? 0
  );
  return { x: rotated.x + viewport.x, y: rotated.y + viewport.y };
}

/**
 * The viewport at the same scale and rotation with map point `point` in the
 * middle of `view` (T103: the Walls panel centres the canvas on a door).
 */
export function centerOn(viewport: Viewport, point: Point, view: Size): Viewport {
  const at = mapToScreen({ ...viewport, x: 0, y: 0 }, point);
  return { ...viewport, x: view.width / 2 - at.x, y: view.height / 2 - at.y };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  if (dx === 0 && dy === 0) return viewport;
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}
