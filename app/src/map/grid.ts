/**
 * Square-grid maths: line positions for a map from its `GridSettings`, and
 * the two-corner alignment that derives a grid from one printed square.
 * Pure, so the renderer stays a thin sceneFunc and the tool is testable
 * without a canvas.
 */
import type { GridGeometry } from "../state/model";
import type { Point } from "./viewport";

/** Wraps an offset into [0, cellSize): the first line at or after 0. */
export function normalizeOffset(offset: number, cellSize: number): number {
  if (!(cellSize > 0)) return 0;
  const wrapped = offset - Math.floor(offset / cellSize) * cellSize;
  // Floating error can land exactly on cellSize; that is line 0 again.
  return wrapped >= cellSize ? 0 : wrapped;
}

/**
 * Positions of grid lines along one axis of length `extent`, for lines at
 * `offset + k * cellSize` (k integer) that fall inside [0, extent].
 */
export function gridLinePositions(
  extent: number,
  cellSize: number,
  offset: number
): number[] {
  if (!(cellSize > 0) || !(extent > 0)) return [];
  const start = normalizeOffset(offset, cellSize);
  const lines: number[] = [];
  for (let p = start; p <= extent + 1e-9; p += cellSize) {
    lines.push(Math.round(p * 1000) / 1000);
  }
  return lines;
}

export interface GridLines {
  vertical: number[];
  horizontal: number[];
}

export function gridLines(
  width: number,
  height: number,
  grid: GridGeometry
): GridLines {
  return {
    vertical: gridLinePositions(width, grid.cellSize, grid.offsetX),
    horizontal: gridLinePositions(height, grid.cellSize, grid.offsetY),
  };
}

/**
 * The grid corner nearest to `p`: a point of the lattice
 * `(offsetX + i * cellSize, offsetY + j * cellSize)`, `i`, `j` integers,
 * on or off the map (T102: the wall tools snap to corners). `p` itself for
 * a degenerate cell size.
 */
export function nearestGridCorner(p: Point, grid: GridGeometry): Point {
  const { cellSize } = grid;
  if (!(cellSize > 0)) return { x: p.x, y: p.y };
  return {
    x: round3(grid.offsetX + Math.round((p.x - grid.offsetX) / cellSize) * cellSize),
    y: round3(grid.offsetY + Math.round((p.y - grid.offsetY) / cellSize) * cellSize),
  };
}

/** Smallest square the alignment tool accepts, in map pixels. */
export const MIN_ALIGN_CELL_SIZE = 4;

/**
 * Two-corner alignment: `a` and `b` are opposite corners of one printed map
 * square (any order, any diagonal). The cell size is the mean of the
 * square's width and height (a real square gives equal sides; averaging
 * absorbs a slightly off click), and the offset is the square's top-left
 * corner wrapped into the first cell. Returns null when the box is too
 * small to be a cell.
 */
export function alignGridToSquare(a: Point, b: Point): GridGeometry | null {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < MIN_ALIGN_CELL_SIZE || h < MIN_ALIGN_CELL_SIZE) return null;
  const cellSize = round3((w + h) / 2);
  return {
    cellSize,
    offsetX: round3(normalizeOffset(Math.min(a.x, b.x), cellSize)),
    offsetY: round3(normalizeOffset(Math.min(a.y, b.y), cellSize)),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
