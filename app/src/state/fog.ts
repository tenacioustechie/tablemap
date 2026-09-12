/**
 * Fog of war operations (T007, ADR 0012).
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
 * `hide` restores it. Shapes beyond the rectangle (circle, polygon) are
 * rasterised here already so the brush and lasso tools (T008) only add UI.
 */
export type FogMode = "reveal" | "hide";

export const FOG_MODES: readonly FogMode[] = ["reveal", "hide"];

export type FogShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  /** Flat [x0, y0, x1, y1, ...]; at least three points. */
  | { kind: "polygon"; points: number[] };

export type FogOp =
  /** The whole map: `reveal` = reveal all, `hide` = hide all. */
  | { type: "fill"; mode: FogMode }
  | { type: "shape"; mode: FogMode; shape: FogShape };

// ---- constructors ---------------------------------------------------------

export function fogFill(mode: FogMode): FogOp {
  return { type: "fill", mode };
}

export function fogShape(mode: FogMode, shape: FogShape): FogOp {
  return { type: "shape", mode, shape: cloneFogShape(shape) };
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

export function cloneFogShape(shape: FogShape): FogShape {
  return shape.kind === "polygon" ? { ...shape, points: [...shape.points] } : { ...shape };
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
      return (
        Array.isArray(x.points) &&
        x.points.length >= 6 &&
        x.points.length % 2 === 0 &&
        x.points.every(isFiniteNumber)
      );
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
      return isFogShape(x.shape);
    default:
      return false;
  }
}
