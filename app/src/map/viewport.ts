/**
 * Pure viewport math for the Konva stage. A viewport is the stage transform:
 * map pixel `p` appears at screen pixel `p * scale + (x, y)`.
 */

export interface Viewport {
  x: number;
  y: number;
  scale: number;
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

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  if (dx === 0 && dy === 0) return viewport;
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}
