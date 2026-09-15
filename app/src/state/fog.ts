/**
 * Fog of war operations (T007, ADR 0012; tools T008, ADR 0013).
 *
 * The fog on a map is a mask: alpha 255 = hidden (black), 0 = revealed. It is
 * never stored or sent as pixels while the DM works; it is *described* as a
 * base (`MapScene.fogMaskAssetId`, a PNG the mask starts from; null means
 * fully fogged) plus an ordered log of operations (`MapScene.fogOps`). Both
 * windows rasterise the same base + log with the same code (`map/fogRaster.ts`)
 * and so arrive at the same pixels.
 *
 * Ops are plain JSON in map pixels. A `fill` op covers the whole map; a
 * `shape` op paints one shape. `mode` says which way: `reveal` clears fog,
 * `hide` restores it. Shapes: `rect`, `circle`, `polygon` (the lasso),
 * `stroke` (one brush drag: a polyline with round caps and joins, i.e. the
 * union of capsules of `radius` around each segment; a single point is a
 * disc) and `rects` (a union of rectangles: what grid snapping produces, one
 * op per gesture whatever the cells). A shape op may carry `feather`, the
 * width in map pixels of a soft edge centred on the shape's boundary.
 */
export type FogMode = "reveal" | "hide";

export const FOG_MODES: readonly FogMode[] = ["reveal", "hide"];

export type FogShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  /** Flat [x0, y0, x1, y1, ...]; at least three points. */
  | { kind: "polygon"; points: number[] }
  /** Flat [x0, y0, x1, y1, ...]; at least one point. Round caps and joins. */
  | { kind: "stroke"; points: number[]; radius: number }
  /** Flat [x0, y0, w0, h0, x1, y1, w1, h1, ...]; at least one rectangle. */
  | { kind: "rects"; rects: number[] };

export type FogShapeKind = FogShape["kind"];

export type FogOp =
  /** The whole map: `reveal` = reveal all, `hide` = hide all. */
  | { type: "fill"; mode: FogMode }
  | { type: "shape"; mode: FogMode; shape: FogShape; feather?: number };

// ---- constructors ---------------------------------------------------------

export function fogFill(mode: FogMode): FogOp {
  return { type: "fill", mode };
}

/** A shape op; `feather` (map px) is only recorded when positive. */
export function fogShape(mode: FogMode, shape: FogShape, feather?: number): FogOp {
  const op: FogOp = { type: "shape", mode, shape: cloneFogShape(shape) };
  if (feather !== undefined && feather > 0) op.feather = feather;
  return op;
}

/**
 * The standard feather for a map, in map pixels: about a third of a cell,
 * 4–64. The fog tools' soft edge (T008) and a token's vision reveal (T106).
 */
export function fogFeatherPx(cellSize: number): number {
  const px = cellSize * 0.3;
  return Math.max(4, Math.min(64, Number.isFinite(px) ? px : 4));
}

/** A rectangle from any two opposite corners (normalised to positive size). */
export function rectShape(
  a: { x: number; y: number },
  b: { x: number; y: number }
): Extract<FogShape, { kind: "rect" }> {
  return {
    kind: "rect",
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function strokeShape(
  points: readonly number[],
  radius: number
): Extract<FogShape, { kind: "stroke" }> {
  return { kind: "stroke", points: [...points], radius };
}

export function polygonShape(points: readonly number[]): Extract<FogShape, { kind: "polygon" }> {
  return { kind: "polygon", points: [...points] };
}

export function rectsShape(rects: readonly number[]): Extract<FogShape, { kind: "rects" }> {
  return { kind: "rects", rects: [...rects] };
}

/** Axis-aligned bounds of a shape (rects and polygons may be empty). */
export function fogShapeBounds(shape: FogShape): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (shape.kind) {
    case "rect":
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    case "circle":
      return {
        x: shape.x - shape.radius,
        y: shape.y - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2,
      };
    case "polygon":
      return pointsBounds(shape.points, 0);
    case "stroke":
      return pointsBounds(shape.points, shape.radius);
    case "rects": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 3 < shape.rects.length; i += 4) {
        minX = Math.min(minX, shape.rects[i]);
        minY = Math.min(minY, shape.rects[i + 1]);
        maxX = Math.max(maxX, shape.rects[i] + shape.rects[i + 2]);
        maxY = Math.max(maxY, shape.rects[i + 1] + shape.rects[i + 3]);
      }
      return finiteBounds(minX, minY, maxX, maxY);
    }
  }
}

function pointsBounds(points: readonly number[], pad: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i] - pad);
    minY = Math.min(minY, points[i + 1] - pad);
    maxX = Math.max(maxX, points[i] + pad);
    maxY = Math.max(maxY, points[i + 1] + pad);
  }
  return finiteBounds(minX, minY, maxX, maxY);
}

function finiteBounds(minX: number, minY: number, maxX: number, maxY: number) {
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function cloneFogShape(shape: FogShape): FogShape {
  switch (shape.kind) {
    case "polygon":
    case "stroke":
      return { ...shape, points: [...shape.points] };
    case "rects":
      return { ...shape, rects: [...shape.rects] };
    default:
      return { ...shape };
  }
}

export function cloneFogOp(op: FogOp): FogOp {
  return op.type === "fill" ? { ...op } : { ...op, shape: cloneFogShape(op.shape) };
}

// ---- type guards ----------------------------------------------------------

// Local copies (not imported from `model.ts`, which imports this module).
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isFlatPoints(x: unknown, minPoints: number): x is number[] {
  return (
    Array.isArray(x) &&
    x.length >= minPoints * 2 &&
    x.length % 2 === 0 &&
    x.every(isFiniteNumber)
  );
}

export function isFogMode(x: unknown): x is FogMode {
  return (FOG_MODES as readonly unknown[]).includes(x);
}

export function isFogShape(x: unknown): x is FogShape {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "rect":
      return (
        isFiniteNumber(x.x) &&
        isFiniteNumber(x.y) &&
        isFiniteNumber(x.width) &&
        x.width >= 0 &&
        isFiniteNumber(x.height) &&
        x.height >= 0
      );
    case "circle":
      return (
        isFiniteNumber(x.x) &&
        isFiniteNumber(x.y) &&
        isFiniteNumber(x.radius) &&
        x.radius >= 0
      );
    case "polygon":
      return isFlatPoints(x.points, 3);
    case "stroke":
      return isFlatPoints(x.points, 1) && isFiniteNumber(x.radius) && x.radius >= 0;
    case "rects": {
      const r = x.rects;
      if (!Array.isArray(r) || r.length < 4 || r.length % 4 !== 0 || !r.every(isFiniteNumber)) {
        return false;
      }
      for (let i = 2; i < r.length; i += 4) if (r[i] < 0 || r[i + 1] < 0) return false;
      return true;
    }
    default:
      return false;
  }
}

export function isFogOp(x: unknown): x is FogOp {
  if (!isRecord(x) || !isFogMode(x.mode)) return false;
  switch (x.type) {
    case "fill":
      return true;
    case "shape":
      return (
        isFogShape(x.shape) &&
        (x.feather === undefined || (isFiniteNumber(x.feather) && x.feather >= 0))
      );
    default:
      return false;
  }
}
