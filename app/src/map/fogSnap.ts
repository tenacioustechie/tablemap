/**
 * Grid snapping for fog tools (T008, ADR 0013): expands any fog shape to the
 * whole grid cells it touches, as one `rects` shape (one op per gesture,
 * however many cells).
 *
 * "Touches" is geometric overlap with the cell's interior, so a rectangle
 * dragged from somewhere inside one cell to somewhere inside another covers
 * exactly the cells between (inclusive); a brush stroke covers every cell
 * within its radius; a lasso covers every cell it crosses or contains.
 * Each cell is shrunk by `SNAP_EPSILON` before testing, so a shape whose
 * edge lies exactly on a grid line does not spill into the neighbour.
 *
 * Cells are clipped to the map, and runs of adjacent cells in a row are
 * merged into one rectangle to keep ops small.
 */
import { fogShapeBounds, rectsShape, type FogShape } from "../state/fog";
import type { GridGeometry } from "../state/model";
import {
  distancePointRect,
  distanceSegmentRect,
  polygonIntersectsRect,
  rectsOverlap,
  type Rect,
} from "./geometry";
import { normalizeOffset } from "./grid";

/** Map pixels; smaller overlaps than this do not count as touching a cell. */
export const SNAP_EPSILON = 1e-3;

export interface MapExtent {
  width: number;
  height: number;
}

/** Whether `shape` overlaps the interior of `cell`. */
export function shapeTouchesRect(shape: FogShape, cell: Rect): boolean {
  switch (shape.kind) {
    case "rect":
      return rectsOverlap(shape, cell);
    case "rects": {
      for (let i = 0; i + 3 < shape.rects.length; i += 4) {
        const r = { x: shape.rects[i], y: shape.rects[i + 1], width: shape.rects[i + 2], height: shape.rects[i + 3] };
        if (rectsOverlap(r, cell)) return true;
      }
      return false;
    }
    case "circle":
      return shape.radius > 0 && distancePointRect(shape, cell) < shape.radius;
    case "stroke": {
      const p = shape.points;
      if (shape.radius <= 0 || p.length < 2) return false;
      if (p.length < 4) return distancePointRect({ x: p[0], y: p[1] }, cell) < shape.radius;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const a = { x: p[i], y: p[i + 1] };
        const b = { x: p[i + 2], y: p[i + 3] };
        if (distanceSegmentRect(a, b, cell) < shape.radius) return true;
      }
      return false;
    }
    case "polygon":
      return polygonIntersectsRect(shape.points, cell);
  }
}

/**
 * The cells of `grid` that `shape` touches, as a `rects` shape clipped to
 * the map; null when it touches none (or the grid is unusable).
 */
export function snapShapeToCells(
  shape: FogShape,
  grid: GridGeometry,
  map: MapExtent
): Extract<FogShape, { kind: "rects" }> | null {
  const cs = grid.cellSize;
  if (!(cs > 0) || !(map.width > 0) || !(map.height > 0)) return null;
  const bounds = fogShapeBounds(shape);
  // First grid line at or after 0 on each axis; cell k starts at start + k * cs
  // (k = -1 is the partial cell at the top/left edge).
  const startX = normalizeOffset(grid.offsetX, cs);
  const startY = normalizeOffset(grid.offsetY, cs);
  const eps = SNAP_EPSILON;
  const kMin = Math.max(-1, Math.floor((bounds.x + eps - startX) / cs));
  const kMax = Math.min(
    Math.floor((map.width - eps - startX) / cs),
    Math.floor((bounds.x + bounds.width - eps - startX) / cs)
  );
  const jMin = Math.max(-1, Math.floor((bounds.y + eps - startY) / cs));
  const jMax = Math.min(
    Math.floor((map.height - eps - startY) / cs),
    Math.floor((bounds.y + bounds.height - eps - startY) / cs)
  );
  if (kMin > kMax || jMin > jMax) return null;

  const rects: number[] = [];
  for (let j = jMin; j <= jMax; j++) {
    const y0 = startY + j * cs;
    let runStart: number | null = null;
    const flush = (kEnd: number) => {
      if (runStart === null) return;
      const x0 = Math.max(0, startX + runStart * cs);
      const x1 = Math.min(map.width, startX + kEnd * cs);
      const cy0 = Math.max(0, y0);
      const cy1 = Math.min(map.height, y0 + cs);
      if (x1 - x0 > 0 && cy1 - cy0 > 0) rects.push(round(x0), round(cy0), round(x1 - x0), round(cy1 - cy0));
      runStart = null;
    };
    for (let k = kMin; k <= kMax; k++) {
      const cell: Rect = {
        x: startX + k * cs + eps,
        y: y0 + eps,
        width: cs - 2 * eps,
        height: cs - 2 * eps,
      };
      if (shapeTouchesRect(shape, cell)) {
        runStart ??= k;
      } else {
        flush(k);
      }
    }
    flush(kMax + 1);
  }
  return rects.length > 0 ? rectsShape(rects) : null;
}

/** Cell coordinates carry the grid's sub-pixel offset; keep them tidy. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
