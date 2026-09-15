/**
 * Room fill (T108, ADR 0026 as amended): every grid cell reachable from a
 * start cell without crossing a wall or a closed door. Pure and
 * deterministic; the DM's **Fill** fog tool commits the result as one
 * `rects` fog op, the shape grid snapping already produces (T008).
 *
 * The flood moves between 4-neighbour cells of the map's grid, clipped to
 * the map (the border bounds it), and **a step is blocked when a blocking
 * segment crosses the line between the two cells' centres** — the line
 * through the middle of their shared edge. A partial cell along the map's
 * edge steps from the centre of its part on the map, so a wall drawn to the
 * edge closes it off too. Testing that line rather than the
 * whole shared edge is what keeps a room drawn on grid lines in one piece (a
 * wall along a grid line touches the ends of every edge across it) and keeps
 * a wall running through the middle of a row of cells from letting the
 * flood step round it; and because every path of steps is a continuous line
 * through cell centres, no closed outline of walls can be left without one
 * step crossing it.
 *
 * Touching is decided by one fixed tie-break, as if every cell centre were
 * nudged a hair down and a far smaller hair left: a centre exactly on a
 * segment's line counts as being on the right-hand side of the segment
 * walked from its lexicographically smaller end (x, then y) in screen
 * coordinates — below a horizontal wall, left of a vertical one; a segment
 * end exactly on a row of centres counts as above it, one exactly on a
 * column of centres as right of it. Every case is then a clean crossing or
 * a clean miss of the nudged lines, so a diagonal wall through grid corners
 * and cell centres blocks along its whole length (no leak through the
 * corners), and a cell whose centre lies on a wall joins one side instead
 * of being cut off from both.
 *
 * The result is the flat `[x, y, w, h, …]` list of a `rects` shape: the
 * cells row by row, each row's horizontal runs merged, clipped to the map
 * and rounded like `fogSnap.ts: snapShapeToCells` (so an open map fills to
 * exactly the rects that snapping the whole map gives). More than `limit`
 * reachable cells is `"too-large"`: the flood stops there.
 */
import type { GridGeometry } from "../state/model";
import { SNAP_EPSILON } from "./fogSnap";
import { normalizeOffset } from "./grid";
import type { Point, Size } from "./viewport";
import type { Segment } from "./visibility";

/** The most cells one fill may reveal or hide. */
export const ROOM_FILL_LIMIT = 20_000;

/**
 * A grid cell: column `k` spans `[s + k·cellSize, s + (k + 1)·cellSize]`,
 * where `s` is the grid's X offset wrapped into the first cell (row likewise).
 * Column / row -1 is the partial cell at the map's left / top edge.
 */
export interface GridCell {
  column: number;
  row: number;
}

/** The map's cells: which columns and rows overlap it, and where column / row 0 starts. */
interface CellLattice {
  cellSize: number;
  startX: number;
  startY: number;
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
  width: number;
  height: number;
}

function cellLattice(grid: GridGeometry, map: Size): CellLattice | null {
  const cs = grid.cellSize;
  const { width, height } = map;
  if (!(cs > 0 && Number.isFinite(cs) && width > 0 && height > 0)) return null;
  if (!(Number.isFinite(width) && Number.isFinite(height))) return null;
  if (!(Number.isFinite(grid.offsetX) && Number.isFinite(grid.offsetY))) return null;
  // The same cells `snapShapeToCells` considers for the whole map.
  const startX = normalizeOffset(grid.offsetX, cs);
  const startY = normalizeOffset(grid.offsetY, cs);
  const firstColumn = Math.max(-1, Math.floor((SNAP_EPSILON - startX) / cs));
  const lastColumn = Math.floor((width - SNAP_EPSILON - startX) / cs);
  const firstRow = Math.max(-1, Math.floor((SNAP_EPSILON - startY) / cs));
  const lastRow = Math.floor((height - SNAP_EPSILON - startY) / cs);
  if (lastColumn < firstColumn || lastRow < firstRow) return null;
  return { cellSize: cs, startX, startY, firstColumn, lastColumn, firstRow, lastRow, width, height };
}

/** The cell under a map point; null off the map or without a usable grid. */
export function cellAt(point: Point, grid: GridGeometry, map: Size): GridCell | null {
  const lattice = cellLattice(grid, map);
  if (!lattice) return null;
  const { x, y } = point;
  if (!(x >= 0 && y >= 0 && x <= lattice.width && y <= lattice.height)) return null;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    column: clamp(Math.floor((x - lattice.startX) / lattice.cellSize), lattice.firstColumn, lattice.lastColumn),
    row: clamp(Math.floor((y - lattice.startY) / lattice.cellSize), lattice.firstRow, lattice.lastRow),
  };
}

/**
 * Along one axis, the centre of cell `index`'s part on the map `[0, extent]`:
 * the grid centre, or the middle of what is left of a partial edge cell.
 * Every cell of a column (row) shares it, so steps stay axis-aligned.
 */
function centreOnMap(start: number, index: number, cellSize: number, extent: number): number {
  const from = start + index * cellSize;
  const to = from + cellSize;
  return from < 0 || to > extent
    ? (Math.max(0, from) + Math.min(extent, to)) / 2
    : start + (index + 0.5) * cellSize;
}

/**
 * The steps the segments block, by the key of the cell they leave:
 * `right` from (column, row) to (column + 1, row), `down` to (column, row + 1).
 */
function blockedSteps(
  segments: readonly Segment[],
  lattice: CellLattice,
  key: (column: number, row: number) => number
): { right: Set<number>; down: Set<number> } {
  const right = new Set<number>();
  const down = new Set<number>();
  const { cellSize: cs, startX, startY, firstColumn, lastColumn, firstRow, lastRow, width, height } = lattice;
  const centreX = (column: number) => centreOnMap(startX, column, cs, width);
  const centreY = (row: number) => centreOnMap(startY, row, cs, height);

  for (const segment of segments) {
    // From the lexicographically smaller end, so the tie-break ignores direction.
    const swap = segment.a.x > segment.b.x || (segment.a.x === segment.b.x && segment.a.y > segment.b.y);
    const a = swap ? segment.b : segment.a;
    const b = swap ? segment.a : segment.b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(dx) && Number.isFinite(dy))) continue;
    if (dx === 0 && dy === 0) continue;
    /** Which side of the segment's line a centre is on; a centre on the line counts as the `true` side. */
    const side = (x: number, y: number) => dx * (y - a.y) - dy * (x - a.x) >= 0;

    // Right steps: rows of centres the segment's ends straddle (an end on the row counts as above).
    // The index ranges and the column guesses assume grid centres; an edge cell's centre on the
    // map is still inside that cell, so one cell of margin covers it.
    if (dy !== 0) {
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const rowFrom = Math.max(firstRow, Math.ceil((minY - startY) / cs - 0.5) - 1);
      const rowTo = Math.min(lastRow, Math.floor((maxY - startY) / cs - 0.5) + 1);
      for (let row = rowFrom; row <= rowTo; row++) {
        const y = centreY(row);
        if (a.y > y === b.y > y) continue;
        // The side changes once along the row, next to where the line meets it.
        const guess = Math.floor((a.x + ((y - a.y) * dx) / dy - startX) / cs - 0.5);
        const from = Math.max(firstColumn, guess - 1);
        const to = Math.min(lastColumn - 1, guess + 1);
        for (let column = from; column <= to; column++) {
          if (side(centreX(column), y) !== side(centreX(column + 1), y)) right.add(key(column, row));
        }
      }
    }

    // Down steps: columns of centres the ends straddle (an end on the column counts as right of it).
    if (dx !== 0) {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const columnFrom = Math.max(firstColumn, Math.ceil((minX - startX) / cs - 0.5) - 1);
      const columnTo = Math.min(lastColumn, Math.floor((maxX - startX) / cs - 0.5) + 1);
      for (let column = columnFrom; column <= columnTo; column++) {
        const x = centreX(column);
        if (a.x < x === b.x < x) continue;
        const guess = Math.floor((a.y + ((x - a.x) * dy) / dx - startY) / cs - 0.5);
        const from = Math.max(firstRow, guess - 1);
        const to = Math.min(lastRow - 1, guess + 1);
        for (let row = from; row <= to; row++) {
          if (side(x, centreY(row)) !== side(x, centreY(row + 1))) down.add(key(column, row));
        }
      }
    }
  }
  return { right, down };
}

/** Cell coordinates carry the grid's sub-pixel offset; keep them tidy (as `fogSnap.ts` does). */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The cells reachable from `startCell` without crossing one of `segments`
 * (T104's `blockingSegments`: walls and closed doors), as flat
 * `[x, y, w, h, …]` map-pixel rects, row by row with each row's runs
 * merged; `"too-large"` when more than `limit` cells are reachable; `[]` for
 * a start cell off the map or an unusable grid or map. Same input, same
 * output, whatever the order or direction of the segments.
 */
export function roomCells(
  startCell: GridCell,
  grid: GridGeometry,
  sceneSize: Size,
  segments: readonly Segment[],
  limit: number = ROOM_FILL_LIMIT
): number[] | "too-large" {
  const lattice = cellLattice(grid, sceneSize);
  if (!lattice) return [];
  const { cellSize: cs, startX, startY, firstColumn, lastColumn, firstRow, lastRow, width, height } = lattice;
  const { column: startColumn, row: startRow } = startCell;
  if (
    !Number.isInteger(startColumn) ||
    !Number.isInteger(startRow) ||
    startColumn < firstColumn ||
    startColumn > lastColumn ||
    startRow < firstRow ||
    startRow > lastRow
  ) {
    return [];
  }

  const columns = lastColumn - firstColumn + 1;
  const key = (column: number, row: number) => (row - firstRow) * columns + (column - firstColumn);
  const blocked = blockedSteps(segments, lattice, key);

  const start = key(startColumn, startRow);
  if (limit < 1) return "too-large";
  const reached = new Set<number>([start]);
  const queue = [start];
  const visit = (next: number): boolean => {
    if (reached.has(next)) return true;
    if (reached.size >= limit) return false;
    reached.add(next);
    queue.push(next);
    return true;
  };
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    const column = (cell % columns) + firstColumn;
    const row = Math.floor(cell / columns) + firstRow;
    if (column < lastColumn && !blocked.right.has(cell) && !visit(cell + 1)) return "too-large";
    if (column > firstColumn && !blocked.right.has(cell - 1) && !visit(cell - 1)) return "too-large";
    if (row < lastRow && !blocked.down.has(cell) && !visit(cell + columns)) return "too-large";
    if (row > firstRow && !blocked.down.has(cell - columns) && !visit(cell - columns)) return "too-large";
  }

  const cells = [...reached].sort((p, q) => p - q);
  const rects: number[] = [];
  for (let i = 0; i < cells.length; ) {
    const row = Math.floor(cells[i] / columns) + firstRow;
    const runStart = (cells[i] % columns) + firstColumn;
    let runEnd = runStart;
    while (i + 1 < cells.length && cells[i + 1] === cells[i] + 1 && (cells[i + 1] % columns) !== 0) {
      i++;
      runEnd++;
    }
    i++;
    const x0 = Math.max(0, startX + runStart * cs);
    const x1 = Math.min(width, startX + (runEnd + 1) * cs);
    const y0 = Math.max(0, startY + row * cs);
    const y1 = Math.min(height, startY + (row + 1) * cs);
    if (x1 - x0 > 0 && y1 - y0 > 0) rects.push(round(x0), round(y0), round(x1 - x0), round(y1 - y0));
  }
  return rects;
}
