/**
 * Square-grid line positions for a map, from its `GridSettings`. Pure, so
 * the renderer stays a thin sceneFunc.
 */
import type { GridSettings } from "../state/model";

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
  // First line at or after 0.
  const start = offset - Math.floor(offset / cellSize) * cellSize;
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
  grid: Pick<GridSettings, "cellSize" | "offsetX" | "offsetY">
): GridLines {
  return {
    vertical: gridLinePositions(width, grid.cellSize, grid.offsetX),
    horizontal: gridLinePositions(height, grid.cellSize, grid.offsetY),
  };
}
