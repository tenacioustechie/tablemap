/**
 * How the player display shows a scene (T009, ADR 0014), and the DM's handle
 * on it — all pure maths shared by both windows.
 *
 * A `PlayerView` is a map point at the middle of the display (`center`), a
 * `scale` and a quarter-turn `rotation`. From it:
 * - `playerStageTransform` gives the Konva stage transform the player view
 *   applies (`Viewport` with rotation): map point p lands at screen pixel
 *   `rotate((p - center) * scale) + display / 2`.
 * - `playerViewportRect` gives the *inverse* picture for the DM canvas: the
 *   axis-aligned map rectangle the display shows, `display / scale` in size
 *   (width and height swapped by a quarter turn), centred on `center`.
 *   Dragging that rectangle moves `center`; the two are inverses of each
 *   other, which `playerView.test.ts` checks for every rotation.
 *
 * The scale is the calibration lock (`lockedScale`) whenever the display is
 * calibrated and not in overview; rotation never touches it — a cell stays
 * one inch whichever way the map is turned. Otherwise the map is fitted to
 * the rotated display (so a quarter turn fits the map's width to the
 * display's height) and centred: there is nothing to pan when the whole map
 * is on screen, so `center` is ignored in that case.
 */
import { lockedScale, type PlayerPresentation } from "../state/calibration";
import type { GridGeometry } from "../state/model";
import { isQuarterTurn, type Rotation } from "../state/rotation";
import { fitToView, rotateVector, type Point, type Size, type Viewport } from "./viewport";

export interface PlayerView {
  /** Map point at the middle of the display, in map pixels. */
  center: Point;
  scale: number;
  rotation: Rotation;
}

/** An axis-aligned rectangle in map pixels. */
export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SceneGeometry = Size & { grid: Pick<GridGeometry, "cellSize"> };

/** Assumed until a player window reports its display: a 1080p TV. */
export const DEFAULT_PLAYER_DISPLAY: Size = { width: 1920, height: 1080 };

/** The display's size as the map sees it: a quarter turn swaps width and height. */
export function rotatedSize(size: Size, rotation: Rotation): Size {
  return isQuarterTurn(rotation)
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

export function mapCenter(map: Size): Point {
  return { x: map.width / 2, y: map.height / 2 };
}

/** Keeps the centre on the map: the display can overhang but never lose the map entirely. */
export function clampCenter(center: Point, map: Size): Point {
  return {
    x: Math.min(map.width, Math.max(0, center.x)),
    y: Math.min(map.height, Math.max(0, center.y)),
  };
}

/** True when the player scale is locked to the calibration (the only mode with a pan). */
export function isScaleLocked(presentation: PlayerPresentation): boolean {
  return presentation.pxPerInch !== null && !presentation.overview;
}

/** The player stage scale for a scene: the calibration lock, or fit to the (rotated) display. */
export function playerScale(
  presentation: PlayerPresentation,
  scene: SceneGeometry,
  display: Size
): number {
  if (isScaleLocked(presentation) && presentation.pxPerInch !== null) {
    return lockedScale(presentation.pxPerInch, presentation.cellUnit, scene.grid.cellSize);
  }
  return fitToView(scene, rotatedSize(display, presentation.rotation)).scale;
}

export function resolvePlayerView(
  presentation: PlayerPresentation,
  scene: SceneGeometry,
  display: Size
): PlayerView {
  const center =
    isScaleLocked(presentation) && presentation.center !== null
      ? clampCenter(presentation.center, scene)
      : mapCenter(scene);
  return { center, scale: playerScale(presentation, scene, display), rotation: presentation.rotation };
}

/** The stage transform that puts `view.center` at the middle of `display`, rotated. */
export function playerStageTransform(view: PlayerView, display: Size): Viewport {
  const c = rotateVector(
    { x: view.center.x * view.scale, y: view.center.y * view.scale },
    view.rotation
  );
  return {
    x: display.width / 2 - c.x,
    y: display.height / 2 - c.y,
    scale: view.scale,
    rotation: view.rotation,
  };
}

/** The map rectangle `display` shows under `view` (what the DM drags). */
export function playerViewportRect(view: PlayerView, display: Size): MapRect {
  const shown = rotatedSize(display, view.rotation);
  const width = shown.width / view.scale;
  const height = shown.height / view.scale;
  return { x: view.center.x - width / 2, y: view.center.y - height / 2, width, height };
}

export function rectCenter(rect: MapRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
