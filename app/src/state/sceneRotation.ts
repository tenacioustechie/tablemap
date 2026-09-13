/**
 * Turning a whole scene in quarter turns (T017, ADR 0021).
 *
 * A map is sometimes scanned sideways. The fix is a *document* operation:
 * `rotateScene` turns every map-pixel thing on the scene at once — the
 * image (by advancing `imageRotation`; the asset is never re-encoded), the
 * grid origin, every token, every note and drawing point, every wall and
 * door endpoint (T101), and every fog op in the log — so both windows keep
 * seeing one consistent coordinate space,
 * and the player view's own TV rotation (`state/rotation.ts`,
 * `presentation.rotation`) stays a presentation-only quarter turn on top.
 *
 * Everything here is pure. The base fog mask is a bitmap, so the DM side
 * bakes a turned copy separately (`map/fogMask.ts: rotateFogMask`) and hands
 * its asset id in; the reducer just swaps the reference.
 *
 * Coordinates: a point `(x, y)` on a scene of size `(W, H)` lands, after a
 * clockwise turn by
 * - 90°  at `(H − y, x)`   (the scene is now `H` wide and `W` tall),
 * - 180° at `(W − x, H − y)`,
 * - 270° at `(y, W − x)`   (again `H` wide, `W` tall).
 *
 * Four quarter turns are the identity, coordinate for coordinate.
 */
import { cloneFogOp, rectShape, type FogOp, type FogShape } from "./fog";
import type { Annotation, GridSettings, MapScene, Token } from "./model";
import type { AssetId } from "./model";
import { normalizeRotation, type Rotation } from "./rotation";
import { tokenCenter, tokenTopLeftForCenter } from "./tokens";
import type { WallSegment } from "./walls";

/** A turn: quarter turns clockwise, never 0 (a `map/rotate` always changes something). */
export type RotationDegrees = 90 | 180 | 270;

export const ROTATION_DEGREES: readonly RotationDegrees[] = [90, 180, 270];

export function isRotationDegrees(x: unknown): x is RotationDegrees {
  return (ROTATION_DEGREES as readonly unknown[]).includes(x);
}

export interface Point {
  x: number;
  y: number;
}

export interface SceneSize {
  width: number;
  height: number;
}

/** The size of a scene after a turn: a quarter turn swaps the sides. */
export function rotatedSceneSize(size: SceneSize, degrees: RotationDegrees): SceneSize {
  return degrees === 180
    ? { width: size.width, height: size.height }
    : { width: size.height, height: size.width };
}

/** Where a point of a `size` scene lands after a clockwise turn (see the module comment). */
export function rotatePoint(point: Point, size: SceneSize, degrees: RotationDegrees): Point {
  const { width: w, height: h } = size;
  switch (degrees) {
    case 90:
      return { x: h - point.y, y: point.x };
    case 180:
      return { x: w - point.x, y: h - point.y };
    case 270:
      return { x: point.y, y: w - point.x };
  }
}

/** Turns a flat `[x0, y0, x1, y1, ...]` list of points. */
export function rotatePoints(
  points: readonly number[],
  size: SceneSize,
  degrees: RotationDegrees
): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const p = rotatePoint({ x: points[i], y: points[i + 1] }, size, degrees);
    out.push(p.x, p.y);
  }
  return out;
}

/**
 * Turns an axis-aligned rectangle: its opposite corners are turned and the
 * result re-normalised to a positive size.
 */
export function rotateRect(
  rect: { x: number; y: number; width: number; height: number },
  size: SceneSize,
  degrees: RotationDegrees
): { x: number; y: number; width: number; height: number } {
  const a = rotatePoint({ x: rect.x, y: rect.y }, size, degrees);
  const b = rotatePoint({ x: rect.x + rect.width, y: rect.y + rect.height }, size, degrees);
  const { x, y, width, height } = rectShape(a, b);
  return { x, y, width, height };
}

/**
 * The grid of the turned scene. The cell size is unchanged; the origin is
 * turned as a point (the renderer wraps offsets into the first cell, so any
 * value is legal, but a wrapped one keeps the panel's fields readable). A
 * turned vertical line becomes a horizontal one and vice versa, and the set
 * of lines of the turned scene equals the turned set of lines
 * (`sceneRotation.test.ts` checks that).
 */
export function rotateGrid(
  grid: GridSettings,
  size: SceneSize,
  degrees: RotationDegrees
): GridSettings {
  const origin = rotatePoint({ x: grid.offsetX, y: grid.offsetY }, size, degrees);
  return {
    ...grid,
    offsetX: wrapOffset(origin.x, grid.cellSize),
    offsetY: wrapOffset(origin.y, grid.cellSize),
    dm: { ...grid.dm },
    player: { ...grid.player },
  };
}

/** `map/grid.ts: normalizeOffset`, kept local so `state/` does not import `map/`. */
function wrapOffset(offset: number, cellSize: number): number {
  if (!(cellSize > 0)) return 0;
  const wrapped = offset - Math.floor(offset / cellSize) * cellSize;
  return wrapped >= cellSize ? 0 : wrapped;
}

/**
 * A token turned with the scene: its footprint's centre is turned and the
 * top-left recomputed from it. Footprints are square, so nothing else
 * changes; a snapped token stays on the turned grid.
 */
export function rotateToken(
  token: Token,
  size: SceneSize,
  cellSize: number,
  degrees: RotationDegrees
): Token {
  const center = rotatePoint(tokenCenter(token, cellSize), size, degrees);
  const topLeft = tokenTopLeftForCenter(center, token.size, cellSize);
  return { ...token, appearance: { ...token.appearance }, x: topLeft.x, y: topLeft.y };
}

export function rotateAnnotation(
  annotation: Annotation,
  size: SceneSize,
  degrees: RotationDegrees
): Annotation {
  if (annotation.kind === "note") {
    const p = rotatePoint(annotation, size, degrees);
    return { ...annotation, x: p.x, y: p.y };
  }
  return { ...annotation, points: rotatePoints(annotation.points, size, degrees) };
}

/** A wall or door turned with the scene: both endpoints turned as points (T101). */
export function rotateWall(wall: WallSegment, size: SceneSize, degrees: RotationDegrees): WallSegment {
  const a = rotatePoint({ x: wall.x1, y: wall.y1 }, size, degrees);
  const b = rotatePoint({ x: wall.x2, y: wall.y2 }, size, degrees);
  return { ...wall, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** A fog shape turned with the scene; radii and the rectangles' sizes stay what they were. */
export function rotateFogShape(
  shape: FogShape,
  size: SceneSize,
  degrees: RotationDegrees
): FogShape {
  switch (shape.kind) {
    case "rect":
      return { kind: "rect", ...rotateRect(shape, size, degrees) };
    case "rects": {
      const rects: number[] = [];
      for (let i = 0; i + 3 < shape.rects.length; i += 4) {
        const r = rotateRect(
          { x: shape.rects[i], y: shape.rects[i + 1], width: shape.rects[i + 2], height: shape.rects[i + 3] },
          size,
          degrees
        );
        rects.push(r.x, r.y, r.width, r.height);
      }
      return { kind: "rects", rects };
    }
    case "circle": {
      const c = rotatePoint(shape, size, degrees);
      return { kind: "circle", x: c.x, y: c.y, radius: shape.radius };
    }
    case "polygon":
      return { kind: "polygon", points: rotatePoints(shape.points, size, degrees) };
    case "stroke":
      return { kind: "stroke", points: rotatePoints(shape.points, size, degrees), radius: shape.radius };
  }
}

/** A fog op turned with the scene: `fill` covers the whole map either way. */
export function rotateFogOp(op: FogOp, size: SceneSize, degrees: RotationDegrees): FogOp {
  if (op.type === "fill") return cloneFogOp(op);
  return { ...op, shape: rotateFogShape(op.shape, size, degrees) };
}

/**
 * The whole scene turned clockwise by `degrees`. `fogMaskAssetId` is the
 * turned copy of the base mask the caller baked (null when the scene has no
 * base, or when the caller could not bake one — then the turned scene starts
 * from full fog, which is the safe side). `fogOpsFrom` is untouched: the
 * log's ops are turned in place, so a renderer that had applied ops up to
 * some index still knows which entries are new — though the surface changed
 * size, so every renderer rebuilds anyway.
 */
export function rotateScene(
  scene: MapScene,
  degrees: RotationDegrees,
  fogMaskAssetId: AssetId | null
): MapScene {
  const size = { width: scene.width, height: scene.height };
  const turned = rotatedSceneSize(size, degrees);
  const cell = scene.grid.cellSize;
  return {
    ...scene,
    width: turned.width,
    height: turned.height,
    imageRotation: normalizeRotation(scene.imageRotation + degrees),
    grid: rotateGrid(scene.grid, size, degrees),
    fogMaskAssetId,
    fogOps: scene.fogOps.map((op) => rotateFogOp(op, size, degrees)),
    tokens: scene.tokens.map((token) => rotateToken(token, size, cell, degrees)),
    annotations: scene.annotations.map((a) => rotateAnnotation(a, size, degrees)),
    walls: scene.walls.map((w) => rotateWall(w, size, degrees)),
  };
}

/** The image rotation a scene would have after a turn (for the panel's preview). */
export function nextImageRotation(current: Rotation, degrees: RotationDegrees): Rotation {
  return normalizeRotation(current + degrees);
}

// ---- drawing the turned image ---------------------------------------------------

/**
 * The stored image asset's own size for a scene: the scene size with the
 * sides swapped back when `imageRotation` is a quarter turn.
 */
export function imageAssetSize(scene: Pick<MapScene, "width" | "height" | "imageRotation">): SceneSize {
  return scene.imageRotation === 90 || scene.imageRotation === 270
    ? { width: scene.height, height: scene.width }
    : { width: scene.width, height: scene.height };
}

/**
 * Where to put an image of `assetSize` (its own, unturned size) so that,
 * drawn with `rotation` about its top-left corner (the canvas and Konva
 * convention: position, then rotate), it covers exactly `[0, W'] × [0, H']`
 * of the turned scene. A local point `(x, y)` lands at
 * `position + rotate(x, y)`; the four cases are `rotatePoint` read the other
 * way round. Shared by the stage (the map image node) and the fog-mask baker
 * (`map/fogMask.ts: rotateFogMask`), so both turn pixels the same way.
 */
export function rotatedImagePlacement(assetSize: SceneSize, rotation: Rotation): Point {
  const { width: w, height: h } = assetSize;
  switch (rotation) {
    case 0:
      return { x: 0, y: 0 };
    case 90:
      return { x: h, y: 0 };
    case 180:
      return { x: w, y: h };
    case 270:
      return { x: 0, y: w };
  }
}
