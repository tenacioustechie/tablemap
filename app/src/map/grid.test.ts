import { fixtureSquareCorners, GRID_FIXTURE } from "../test/gridFixture";
import {
  alignGridToSquare,
  gridLinePositions,
  gridLines,
  MIN_ALIGN_CELL_SIZE,
  normalizeOffset,
} from "./grid";

describe("gridLinePositions", () => {
  it("starts at the origin with no offset and includes the far edge when it lands on a line", () => {
    expect(gridLinePositions(200, 50, 0)).toEqual([0, 50, 100, 150, 200]);
  });

  it("shifts by the offset and wraps it into the first cell", () => {
    expect(gridLinePositions(200, 50, 10)).toEqual([10, 60, 110, 160]);
    expect(gridLinePositions(200, 50, 60)).toEqual([10, 60, 110, 160]);
    expect(gridLinePositions(200, 50, -40)).toEqual([10, 60, 110, 160]);
  });

  it("handles non-integer cell sizes without drifting past the edge", () => {
    const lines = gridLinePositions(100, 33.3, 0);
    expect(lines[0]).toBe(0);
    expect(lines[lines.length - 1]).toBeLessThanOrEqual(100);
    expect(lines).toHaveLength(4);
  });

  it("returns nothing for degenerate input", () => {
    expect(gridLinePositions(100, 0, 0)).toEqual([]);
    expect(gridLinePositions(0, 10, 0)).toEqual([]);
    expect(gridLinePositions(100, -5, 0)).toEqual([]);
  });

  it("gridLines covers both axes from the grid settings", () => {
    expect(gridLines(100, 50, { cellSize: 50, offsetX: 0, offsetY: 25 })).toEqual({
      vertical: [0, 50, 100],
      horizontal: [25],
    });
  });

  it("generates the lines of a viewport-sized region for the fixture grid", () => {
    const { width, height, geometry } = GRID_FIXTURE;
    const lines = gridLines(width, height, geometry);
    expect(lines.vertical).toEqual([12, 62, 112, 162, 212, 262, 312, 362]);
    expect(lines.horizontal).toEqual([7, 57, 107, 157, 207, 257]);
    // Every line is inside the region and consecutive lines are one cell apart.
    for (const axis of [lines.vertical, lines.horizontal]) {
      for (let i = 1; i < axis.length; i++) expect(axis[i] - axis[i - 1]).toBe(geometry.cellSize);
    }
    expect(lines.vertical.at(-1)).toBeLessThanOrEqual(width);
    expect(lines.horizontal.at(-1)).toBeLessThanOrEqual(height);
  });
});

describe("normalizeOffset", () => {
  it("wraps any offset into [0, cellSize)", () => {
    expect(normalizeOffset(0, 50)).toBe(0);
    expect(normalizeOffset(12, 50)).toBe(12);
    expect(normalizeOffset(62, 50)).toBe(12);
    expect(normalizeOffset(-38, 50)).toBe(12);
    expect(normalizeOffset(50, 50)).toBe(0);
    expect(normalizeOffset(-50, 50)).toBe(0);
    expect(normalizeOffset(5, 0)).toBe(0);
  });
});

describe("alignGridToSquare (two opposite corners of one cell)", () => {
  const { geometry } = GRID_FIXTURE;

  it("recovers the fixture grid exactly from a cell's corners", () => {
    const [a, b] = fixtureSquareCorners(2, 1);
    expect(alignGridToSquare(a, b)).toEqual(geometry);
  });

  it("is independent of corner order and of which diagonal was used", () => {
    const [tl, br] = fixtureSquareCorners(3, 2);
    const tr = { x: br.x, y: tl.y };
    const bl = { x: tl.x, y: br.y };
    expect(alignGridToSquare(br, tl)).toEqual(geometry);
    expect(alignGridToSquare(tr, bl)).toEqual(geometry);
    expect(alignGridToSquare(bl, tr)).toEqual(geometry);
  });

  it("yields the same grid from any cell of the fixture, including the first", () => {
    for (const [c, r] of [
      [0, 0],
      [7, 5],
      [1, 4],
    ]) {
      const [a, b] = fixtureSquareCorners(c, r);
      expect(alignGridToSquare(a, b)).toEqual(geometry);
    }
  });

  it("lands within ±1 px of the fixture grid when the clicks are slightly off", () => {
    const [a, b] = fixtureSquareCorners(4, 3);
    const jittered = alignGridToSquare(
      { x: a.x - 0.8, y: a.y + 0.6 },
      { x: b.x + 0.7, y: b.y - 0.9 }
    );
    expect(jittered).not.toBeNull();
    expect(Math.abs(jittered!.cellSize - geometry.cellSize)).toBeLessThanOrEqual(1);
    expect(Math.abs(jittered!.offsetX - geometry.offsetX)).toBeLessThanOrEqual(1);
    expect(Math.abs(jittered!.offsetY - geometry.offsetY)).toBeLessThanOrEqual(1);
  });

  it("averages width and height when the box is not perfectly square", () => {
    const g = alignGridToSquare({ x: 100, y: 100 }, { x: 148, y: 152 });
    expect(g).toEqual({ cellSize: 50, offsetX: 0, offsetY: 0 });
  });

  it("wraps the offset into the first cell", () => {
    const g = alignGridToSquare({ x: 1012, y: 507 }, { x: 1062, y: 557 });
    expect(g).toEqual({ cellSize: 50, offsetX: 12, offsetY: 7 });
  });

  it("rejects boxes too small to be a cell", () => {
    expect(alignGridToSquare({ x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
    expect(
      alignGridToSquare({ x: 10, y: 10 }, { x: 10 + MIN_ALIGN_CELL_SIZE - 1, y: 60 })
    ).toBeNull();
    expect(
      alignGridToSquare({ x: 10, y: 10 }, { x: 60, y: 10 + MIN_ALIGN_CELL_SIZE - 1 })
    ).toBeNull();
    expect(alignGridToSquare({ x: NaN, y: 0 }, { x: 50, y: 50 })).toBeNull();
    expect(
      alignGridToSquare({ x: 10, y: 10 }, { x: 10 + MIN_ALIGN_CELL_SIZE, y: 10 + MIN_ALIGN_CELL_SIZE })
    ).not.toBeNull();
  });
});
