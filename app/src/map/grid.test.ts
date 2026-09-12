import { gridLinePositions, gridLines } from "./grid";

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
});
