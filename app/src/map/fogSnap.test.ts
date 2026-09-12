/**
 * Snap-to-cell expansion (T008): every shape kind grows to the whole cells
 * it touches, as one `rects` op; edges exactly on grid lines do not spill;
 * results are clipped to the map and merged per row.
 */
import { strokeShape, type FogShape } from "../state/fog";
import type { GridGeometry } from "../state/model";
import { GRID_FIXTURE } from "../test/gridFixture";
import { applyFogOp, createBitmapFogRaster } from "./fogRaster";
import { shapeTouchesRect, snapShapeToCells } from "./fogSnap";
import {
  distanceSegmentRect,
  pointInPolygon,
  polygonIntersectsRect,
  segmentsIntersect,
} from "./geometry";

const grid: GridGeometry = { cellSize: 10, offsetX: 0, offsetY: 0 };
const map = { width: 50, height: 40 };

/** Cell (column, row) of the 10 px grid as a flat rect. */
const cell = (c: number, r: number, w = 1, h = 1) => [c * 10, r * 10, w * 10, h * 10];

const snap = (shape: FogShape, g = grid, m = map) => snapShapeToCells(shape, g, m)?.rects ?? null;

describe("snapShapeToCells", () => {
  it("expands a rectangle to the cells it touches, inclusive of partial ones", () => {
    expect(snap({ kind: "rect", x: 12, y: 13, width: 15, height: 4 })).toEqual(cell(1, 1, 2, 1));
    // Exactly on grid lines: exactly those cells, no spill into the neighbours.
    expect(snap({ kind: "rect", x: 10, y: 10, width: 20, height: 10 })).toEqual(cell(1, 1, 2, 1));
    // A rectangle inside one cell is that cell; a degenerate one is nothing.
    expect(snap({ kind: "rect", x: 24, y: 24, width: 2, height: 2 })).toEqual(cell(2, 2));
    expect(snap({ kind: "rect", x: 24, y: 24, width: 0, height: 5 })).toBeNull();
  });

  it("merges runs of cells per row and clips to the map", () => {
    expect(snap({ kind: "rect", x: -20, y: -5, width: 100, height: 12 })).toEqual([
      ...cell(0, 0, 5, 1),
    ]);
    // A ring polygon: the middle cell of a 3x3 block is not touched.
    const ring: FogShape = {
      kind: "polygon",
      points: [1, 1, 29, 1, 29, 29, 1, 29, 1, 22, 22, 22, 22, 8, 1, 8],
    };
    // A "C" open to the left: the notch spans x 1..22 at y 8..22, so in row 1
    // only cell 2 (the right arm) is touched; rows 0 and 2 are the full arms.
    expect(snap(ring)).toEqual([...cell(0, 0, 3, 1), ...cell(2, 1), ...cell(0, 2, 3, 1)]);
  });

  it("respects the grid offset, including the partial edge cells", () => {
    const offset: GridGeometry = { cellSize: 10, offsetX: 4, offsetY: 6 };
    // Cell columns start at 4 + 10k; the first column is the partial [0, 4).
    expect(snap({ kind: "rect", x: 1, y: 7, width: 2, height: 2 }, offset)).toEqual([0, 6, 4, 10]);
    expect(snap({ kind: "rect", x: 15, y: 17, width: 1, height: 1 }, offset)).toEqual([14, 16, 10, 10]);
    // Wrapped offsets behave like their normalised value.
    const wrapped: GridGeometry = { cellSize: 10, offsetX: -26, offsetY: 106 };
    expect(snap({ kind: "rect", x: 15, y: 17, width: 1, height: 1 }, wrapped)).toEqual([14, 16, 10, 10]);
    // The fixture grid: a rect inside cell (2, 1) snaps to exactly that square.
    const g = GRID_FIXTURE.geometry;
    const x = g.offsetX + 2 * g.cellSize;
    const y = g.offsetY + 1 * g.cellSize;
    expect(
      snap({ kind: "rect", x: x + 5, y: y + 5, width: 3, height: 3 }, g, GRID_FIXTURE)
    ).toEqual([x, y, g.cellSize, g.cellSize]);
  });

  it("a brush stroke covers every cell within its radius of the path", () => {
    // A dot of radius 3 in the middle of cell (2, 2): just that cell.
    expect(snap(strokeShape([25, 25], 3))).toEqual(cell(2, 2));
    // Radius 6 reaches the four neighbours (distance 5 to each edge) but not the diagonals (7.07).
    expect(snap(strokeShape([25, 25], 6))).toEqual([...cell(2, 1), ...cell(1, 2, 3, 1), ...cell(2, 3)]);
    // A horizontal drag along the middle of row 1 with a small radius: that row's cells only.
    expect(snap(strokeShape([12, 15, 38, 15], 2))).toEqual(cell(1, 1, 3, 1));
    // A diagonal drag through the cell corners: the cells it crosses, plus the
    // neighbours sharing those corners (within radius 1 of the path).
    expect(snap(strokeShape([5, 5, 25, 25], 1))).toEqual([
      ...cell(0, 0, 2, 1),
      ...cell(0, 1, 3, 1),
      ...cell(1, 2, 2, 1),
    ]);
    // Away from the corners, only the crossed cells.
    expect(snap(strokeShape([5, 5, 5, 25], 1))).toEqual([...cell(0, 0), ...cell(0, 1), ...cell(0, 2)]);
    expect(snap(strokeShape([5, 5], 0))).toBeNull();
  });

  it("a circle and a lasso cover the cells they overlap, not just their centres", () => {
    expect(snap({ kind: "circle", x: 20, y: 20, radius: 3 })).toEqual([
      ...cell(1, 1, 2, 1),
      ...cell(1, 2, 2, 1),
    ]);
    // A thin triangle crossing three cells in a row without containing any cell corner or centre.
    expect(snap({ kind: "polygon", points: [2, 5, 38, 4, 38, 6] })).toEqual(cell(0, 0, 4, 1));
    // A big lasso: cells fully inside count too (their corners are inside the polygon).
    expect(snap({ kind: "polygon", points: [0, 0, 50, 0, 50, 40, 0, 40] })).toEqual([
      ...cell(0, 0, 5, 1),
      ...cell(0, 1, 5, 1),
      ...cell(0, 2, 5, 1),
      ...cell(0, 3, 5, 1),
    ]);
  });

  it("a rects shape (re-snapped) and unusable grids or maps", () => {
    expect(snap({ kind: "rects", rects: [12, 12, 2, 2, 31, 31, 2, 2] })).toEqual([...cell(1, 1), ...cell(3, 3)]);
    expect(snap({ kind: "rect", x: 0, y: 0, width: 5, height: 5 }, { cellSize: 0, offsetX: 0, offsetY: 0 })).toBeNull();
    expect(snap({ kind: "rect", x: 0, y: 0, width: 5, height: 5 }, grid, { width: 0, height: 10 })).toBeNull();
    expect(snap({ kind: "rect", x: 100, y: 100, width: 5, height: 5 })).toBeNull();
  });

  it("the snapped op rasterises to whole cells (and only those)", () => {
    const r = createBitmapFogRaster(map.width, map.height);
    const rects = snapShapeToCells(strokeShape([12, 15, 38, 15], 2), grid, map)!;
    applyFogOp(r, { type: "shape", mode: "reveal", shape: rects });
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const inRow1 = y >= 10 && y < 20 && x >= 10 && x < 40;
        expect(r.isHidden(x, y)).toBe(!inRow1);
      }
    }
  });
});

describe("geometry", () => {
  const box = { x: 10, y: 10, width: 10, height: 10 };

  it("segment / rectangle distance is zero on contact and exact otherwise", () => {
    expect(distanceSegmentRect({ x: 0, y: 15 }, { x: 30, y: 15 }, box)).toBe(0); // crosses
    expect(distanceSegmentRect({ x: 12, y: 12 }, { x: 13, y: 13 }, box)).toBe(0); // inside
    expect(distanceSegmentRect({ x: 0, y: 5 }, { x: 30, y: 5 }, box)).toBe(5); // parallel above
    expect(distanceSegmentRect({ x: 0, y: 0 }, { x: 5, y: 5 }, box)).toBeCloseTo(Math.hypot(5, 5)); // to the corner
    expect(distanceSegmentRect({ x: 0, y: 40 }, { x: 40, y: 0 }, box)).toBe(0); // touches the corner (20, 20)
    expect(distanceSegmentRect({ x: 0, y: 41 }, { x: 41, y: 0 }, box)).toBeCloseTo(Math.SQRT1_2); // just misses
  });

  it("segment intersection handles crossings, touching and collinear overlap", () => {
    const p = (x: number, y: number) => ({ x, y });
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(5, 5))).toBe(true); // T
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true); // collinear overlap
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(11, 0), p(15, 0))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBe(false);
  });

  it("polygon containment is even-odd; polygon / rectangle overlap sees crossings", () => {
    // A bow-tie whose lobes are left and right of the crossing at (5, 5).
    const bow = [0, 0, 10, 10, 10, 0, 0, 10];
    expect(pointInPolygon({ x: 2, y: 5 }, bow)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 5 }, bow)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 2 }, bow)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 8 }, bow)).toBe(false);
    expect(polygonIntersectsRect([0, 0, 40, 0, 40, 40, 0, 40], box)).toBe(true); // contains it
    expect(polygonIntersectsRect([12, 12, 14, 12, 13, 14], box)).toBe(true); // inside it
    expect(polygonIntersectsRect([0, 15, 40, 14, 40, 16], box)).toBe(true); // crosses it
    expect(polygonIntersectsRect([0, 0, 5, 0, 0, 5], box)).toBe(false);
    expect(polygonIntersectsRect([0, 0, 5, 0], box)).toBe(false); // not a polygon
  });

  it("shapeTouchesRect per kind", () => {
    expect(shapeTouchesRect({ kind: "rect", x: 0, y: 0, width: 10, height: 10 }, box)).toBe(false); // edge contact only
    expect(shapeTouchesRect({ kind: "rect", x: 0, y: 0, width: 11, height: 11 }, box)).toBe(true);
    expect(shapeTouchesRect({ kind: "circle", x: 5, y: 15, radius: 5 }, box)).toBe(false);
    expect(shapeTouchesRect({ kind: "circle", x: 5, y: 15, radius: 5.1 }, box)).toBe(true);
    expect(shapeTouchesRect({ kind: "rects", rects: [0, 0, 5, 5, 15, 15, 1, 1] }, box)).toBe(true);
    expect(shapeTouchesRect({ kind: "rects", rects: [0, 0, 5, 5] }, box)).toBe(false);
    expect(shapeTouchesRect(strokeShape([], 3), box)).toBe(false);
  });
});
