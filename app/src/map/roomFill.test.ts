// @vitest-environment node
/**
 * Room fill (T108): a closed room fills exactly its cells from any cell in
 * it, a closed door stops the fill and an open one lets it through, diagonal
 * walls block along their whole length (through grid corners and cell
 * centres too), ties on cell centres give a cell to one side, the map
 * border bounds the fill, the limit, degenerate inputs, determinism, no leak
 * out of random wall outlines, the rects matching grid snapping, and the
 * time budget.
 */
import { createDoor, createWall, type WallSegment } from "../state/walls";
import type { GridGeometry } from "../state/model";
import { snapShapeToCells } from "./fogSnap";
import { distancePointSegment, pointInPolygon } from "./geometry";
import { normalizeOffset } from "./grid";
import { cellAt, roomCells, ROOM_FILL_LIMIT, type GridCell } from "./roomFill";
import type { Point, Size } from "./viewport";
import { blockingSegments, type Segment } from "./visibility";

const CS = 50;
const GRID: GridGeometry = { cellSize: CS, offsetX: 0, offsetY: 0 };
/** 10 × 8 cells. */
const MAP: Size = { width: 500, height: 400 };

const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});
/** A segment between two grid corners (column, row) of `GRID`. */
const cornerSeg = ([c1, r1]: [number, number], [c2, r2]: [number, number]): Segment =>
  seg(c1 * CS, r1 * CS, c2 * CS, r2 * CS);
/** A closed outline through grid corners. */
const outline = (...corners: [number, number][]): Segment[] =>
  corners.map((c, i) => cornerSeg(c, corners[(i + 1) % corners.length]));

const cell = (column: number, row: number): GridCell => ({ column, row });

function fill(
  start: GridCell,
  segments: readonly Segment[],
  { grid = GRID, map = MAP, limit }: { grid?: GridGeometry; map?: Size; limit?: number } = {}
): number[] {
  const result = roomCells(start, grid, map, segments, limit);
  if (result === "too-large") throw new Error("unexpectedly too large");
  return result;
}

/** The cells a rects list covers, as sorted "column,row" keys (cells found through `cellAt`). */
function cellsOf(rects: readonly number[], grid: GridGeometry = GRID, map: Size = MAP): string[] {
  const keys: string[] = [];
  for (let i = 0; i + 3 < rects.length; i += 4) {
    const [x, y, w, h] = rects.slice(i, i + 4);
    const first = cellAt({ x: x + 0.01, y: y + 0.01 }, grid, map)!;
    const last = cellAt({ x: x + w - 0.01, y: y + h - 0.01 }, grid, map)!;
    for (let row = first.row; row <= last.row; row++) {
      for (let column = first.column; column <= last.column; column++) keys.push(`${column},${row}`);
    }
  }
  return keys.sort();
}

/** Every cell of `GRID` on `MAP` for which `inside(column, row)` holds, as sorted keys. */
function cellsWhere(inside: (column: number, row: number) => boolean): string[] {
  const keys: string[] = [];
  for (let row = 0; row < MAP.height / CS; row++) {
    for (let column = 0; column < MAP.width / CS; column++) if (inside(column, row)) keys.push(`${column},${row}`);
  }
  return keys.sort();
}

/** Rows appear top to bottom, and no two rects of a row touch (each run is merged). */
function expectMergedRuns(rects: readonly number[]): void {
  for (let i = 4; i + 3 < rects.length; i += 4) {
    const [px, py, pw] = rects.slice(i - 4, i);
    const [x, y] = rects.slice(i, i + 2);
    expect(y).toBeGreaterThanOrEqual(py);
    if (y === py) expect(x).toBeGreaterThan(px + pw);
  }
}

describe("roomCells: rooms", () => {
  const room = outline([1, 1], [4, 1], [4, 3], [1, 3]);

  it("fills exactly a closed room's cells, merged per row, from any cell in it", () => {
    const expected = [50, 50, 150, 50, 50, 100, 150, 50];
    for (let column = 1; column <= 3; column++) {
      for (let row = 1; row <= 2; row++) expect(fill(cell(column, row), room)).toEqual(expected);
    }
  });

  it("walls along grid lines do not split the room where they meet at corners", () => {
    // An L-shaped room: its six walls meet at six corners, one of them reflex.
    const l = outline([1, 1], [3, 1], [3, 3], [6, 3], [6, 5], [1, 5]);
    const expected = cellsWhere((c, r) => (c >= 1 && c <= 2 && r >= 1 && r <= 4) || (c >= 3 && c <= 5 && r >= 3 && r <= 4));
    for (const start of [cell(1, 1), cell(2, 4), cell(5, 3)]) {
      const rects = fill(start, l);
      expect(cellsOf(rects)).toEqual(expected);
      expectMergedRuns(rects);
    }
  });

  it("from outside, fills everything but the room", () => {
    expect(cellsOf(fill(cell(0, 0), room))).toEqual(cellsWhere((c, r) => !(c >= 1 && c <= 3 && r >= 1 && r <= 2)));
  });

  it("a wall with a one-cell gap lets the fill out; closing the gap closes the room", () => {
    // The top wall stops one cell short of the corner, above cell (3, 1).
    const sides = [cornerSeg([4, 1], [4, 3]), cornerSeg([4, 3], [1, 3]), cornerSeg([1, 3], [1, 1])];
    const leaky = [cornerSeg([1, 1], [3, 1]), ...sides];
    expect(cellsOf(fill(cell(1, 1), leaky))).toEqual(cellsWhere(() => true));
    // The only way out is up through the gap: without it the outside is not reached from (1, 1).
    const closed = [...leaky, cornerSeg([3, 1], [4, 1])];
    expect(cellsOf(fill(cell(1, 1), closed))).toHaveLength(6);
  });
});

describe("roomCells: doors", () => {
  // Room A: columns 1–3, rows 1–3; room B: columns 4–6, same rows. The wall
  // between them at corner column 4 has a door across row 2.
  const walls = (open: boolean): WallSegment[] => [
    ...outline([1, 1], [7, 1], [7, 4], [1, 4]).map((s, i) =>
      createWall({ id: `outer-${i}`, x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y })
    ),
    createWall({ id: "mid-top", x1: 200, y1: 50, x2: 200, y2: 100 }),
    createDoor({ id: "door", x1: 200, y1: 100, x2: 200, y2: 150, open }),
    createWall({ id: "mid-bottom", x1: 200, y1: 150, x2: 200, y2: 200 }),
  ];
  const roomA = cellsWhere((c, r) => c >= 1 && c <= 3 && r >= 1 && r <= 3);
  const roomB = cellsWhere((c, r) => c >= 4 && c <= 6 && r >= 1 && r <= 3);

  it("a closed door stops the fill: the cell beyond it stays out", () => {
    const closed = blockingSegments(walls(false));
    expect(cellsOf(fill(cell(3, 2), closed))).toEqual(roomA);
    expect(cellsOf(fill(cell(4, 2), closed))).toEqual(roomB);
  });

  it("an open door lets it through: both rooms, as if the door were not there", () => {
    const open = blockingSegments(walls(true));
    const both = [...roomA, ...roomB].sort();
    expect(cellsOf(fill(cell(1, 1), open))).toEqual(both);
    expect(cellsOf(fill(cell(6, 3), open))).toEqual(both);
    const withoutDoor = blockingSegments(walls(true).filter((w) => w.id !== "door"));
    expect(fill(cell(1, 1), open)).toEqual(fill(cell(1, 1), withoutDoor));
  });
});

describe("roomCells: diagonal walls", () => {
  it("a diagonal through grid corners and cell centres blocks along its whole length", () => {
    // A right triangle: top and right walls on grid lines, the hypotenuse from corner (0, 0) to (6, 6).
    const triangle = outline([0, 0], [6, 0], [6, 6]);
    const above = cellsWhere((c, r) => c <= 5 && r < c);
    for (const start of [cell(5, 0), cell(1, 0), cell(5, 4)]) {
      const rects = fill(start, triangle);
      expect(cellsOf(rects)).toEqual(above);
      expectMergedRuns(rects);
      expect(rects.length / 4).toBe(5); // one run per row
    }
    // From outside nothing above the diagonal is reached; the cells it cuts in half go to the outside.
    const outside = cellsOf(fill(cell(0, 5), triangle));
    expect(outside.filter((k) => above.includes(k))).toEqual([]);
    expect(outside).toEqual(expect.arrayContaining(["0,0", "3,3", "5,5"]));
    expect(outside.length + above.length).toBe(80);
  });

  it("a diagonal between the grid lines blocks along its whole length and gives each cell to its centre's side", () => {
    // Hypotenuse from corner (0, 0) to (6, 5): no centre and no corner on it but its ends.
    const triangle = outline([0, 0], [6, 0], [6, 5]);
    const above = cellsWhere((c, r) => c <= 5 && (r + 0.5) * 6 < (c + 0.5) * 5);
    expect(above).toHaveLength(15);
    expect(cellsOf(fill(cell(5, 0), triangle))).toEqual(above);
    const outside = cellsOf(fill(cell(0, 7), triangle));
    expect(outside.filter((k) => above.includes(k))).toEqual([]);
    expect(outside.length + above.length).toBe(80);
  });

  it("a diagonal door is as tight as a diagonal wall while closed", () => {
    const walls: WallSegment[] = [
      createWall({ id: "top", x1: 0, y1: 0, x2: 300, y2: 0 }),
      createWall({ id: "right", x1: 300, y1: 0, x2: 300, y2: 300 }),
      createWall({ id: "diag-a", x1: 0, y1: 0, x2: 150, y2: 150 }),
      createDoor({ id: "diag-door", x1: 150, y1: 150, x2: 300, y2: 300 }),
    ];
    const above = cellsWhere((c, r) => c <= 5 && r < c);
    expect(cellsOf(fill(cell(5, 0), blockingSegments(walls)))).toEqual(above);
    const opened = walls.map((w) => (w.kind === "door" ? { ...w, open: true } : w));
    expect(cellsOf(fill(cell(5, 0), blockingSegments(opened))).length).toBeGreaterThan(above.length);
  });
});

describe("roomCells: ties on cell centres", () => {
  it("a wall along a row of centres gives that row to the side below it, whichever way it was drawn", () => {
    for (const wall of [seg(0, 175, 500, 175), seg(500, 175, 0, 175)]) {
      expect(fill(cell(4, 0), [wall])).toEqual([0, 0, 500, 50, 0, 50, 500, 50, 0, 100, 500, 50]);
      expect(cellsOf(fill(cell(4, 7), [wall]))).toEqual(cellsWhere((_, r) => r >= 3));
    }
  });

  it("a wall along a column of centres gives that column to the side left of it", () => {
    for (const wall of [seg(225, 0, 225, 400), seg(225, 400, 225, 0)]) {
      expect(cellsOf(fill(cell(0, 0), [wall]))).toEqual(cellsWhere((c) => c <= 4));
      expect(cellsOf(fill(cell(9, 7), [wall]))).toEqual(cellsWhere((c) => c >= 5));
    }
  });

  it("walls that end on centres, corners or centre lines never cut a cell off", () => {
    const stubs = [
      seg(225, 0, 225, 175), // ends on the centre of (4, 3)
      seg(0, 125, 100, 125), // along row 2's centres, ends on the corner line between columns 1 and 2
      seg(300, 300, 375, 225), // diagonal from a corner to a centre
      seg(425, 400, 425, 325), // up from the map edge along column 8's centres
      seg(150, 50, 150, 100), // one grid edge, corner to corner
    ];
    const all = cellsWhere(() => true);
    for (const start of [cell(0, 0), cell(4, 3), cell(9, 7)]) {
      expect(cellsOf(fill(start, stubs))).toEqual(all);
    }
  });
});

describe("roomCells: the map border", () => {
  it("an open map fills to exactly what snapping the whole map gives, partial cells included", () => {
    const whole = { kind: "rect" as const, x: 0, y: 0, width: 0, height: 0 };
    const cases: [GridGeometry, Size][] = [
      [GRID, MAP],
      [{ cellSize: 50, offsetX: 12, offsetY: 7 }, { width: 400, height: 300 }],
      [{ cellSize: 23.7, offsetX: -40.2, offsetY: 311.9 }, { width: 333.3, height: 250.5 }],
    ];
    for (const [grid, map] of cases) {
      const snapped = snapShapeToCells({ ...whole, width: map.width, height: map.height }, grid, map)!;
      const start = cellAt({ x: map.width / 2, y: map.height / 2 }, grid, map)!;
      expect(fill(start, [], { grid, map })).toEqual(snapped.rects);
    }
  });

  it("the partial cells along the edges belong to the lattice and are clipped to the map", () => {
    const grid = { cellSize: 50, offsetX: 12, offsetY: 7 };
    const map = { width: 400, height: 300 };
    // A wall along corner column 1 (x = 62) from the top edge to the bottom edge.
    const rects = fill(cell(-1, -1), [seg(62, 0, 62, 300)], { grid, map });
    expect(rects).toEqual([0, 0, 62, 7, 0, 7, 62, 50, 0, 57, 62, 50, 0, 107, 62, 50, 0, 157, 62, 50, 0, 207, 62, 50, 0, 257, 62, 43]);
  });

  it("the edge closes a room drawn against it", () => {
    // Two walls and the map's top-left corner: columns 0–2, rows 0–2.
    const corner = [cornerSeg([3, 0], [3, 3]), cornerSeg([3, 3], [0, 3])];
    expect(fill(cell(1, 1), corner)).toEqual([0, 0, 150, 50, 0, 50, 150, 50, 0, 100, 150, 50]);
  });

  it("cellAt finds the cell under a point, partial cells too, and nothing off the map", () => {
    const grid = { cellSize: 50, offsetX: 12, offsetY: 7 };
    const map = { width: 400, height: 300 };
    expect(cellAt({ x: 0, y: 0 }, grid, map)).toEqual(cell(-1, -1));
    expect(cellAt({ x: 12, y: 7 }, grid, map)).toEqual(cell(0, 0));
    expect(cellAt({ x: 61.9, y: 56.9 }, grid, map)).toEqual(cell(0, 0));
    expect(cellAt({ x: 62, y: 57 }, grid, map)).toEqual(cell(1, 1));
    expect(cellAt({ x: 400, y: 300 }, grid, map)).toEqual(cell(7, 5));
    expect(cellAt({ x: 250, y: 150 }, GRID, MAP)).toEqual(cell(5, 3));
    for (const p of [{ x: -0.1, y: 10 }, { x: 10, y: 300.1 }, { x: NaN, y: 1 }]) expect(cellAt(p, grid, map)).toBeNull();
    expect(cellAt({ x: 1, y: 1 }, { cellSize: 0, offsetX: 0, offsetY: 0 }, map)).toBeNull();
  });
});

describe("roomCells: the limit", () => {
  it("more cells than the limit is too large; exactly the limit fills", () => {
    expect(cellsOf(fill(cell(0, 0), [], { limit: 80 }))).toHaveLength(80);
    expect(roomCells(cell(0, 0), GRID, MAP, [], 79)).toBe("too-large");
    expect(roomCells(cell(0, 0), GRID, MAP, [], 0)).toBe("too-large");
    const room = outline([1, 1], [4, 1], [4, 3], [1, 3]);
    expect(cellsOf(fill(cell(2, 2), room, { limit: 6 }))).toHaveLength(6);
    expect(roomCells(cell(2, 2), GRID, MAP, room, 5)).toBe("too-large");
  });

  it("defaults to 20 000 cells", () => {
    expect(ROOM_FILL_LIMIT).toBe(20_000);
    const grid = { cellSize: 2, offsetX: 0, offsetY: 0 };
    expect(roomCells(cell(0, 0), grid, { width: 300, height: 300 }, [])).toBe("too-large"); // 22 500 cells
    expect(roomCells(cell(0, 0), grid, { width: 280, height: 280 }, [])).not.toBe("too-large"); // 19 600
    // Walls make a large map fillable: a room of it.
    const walled = [seg(0, 100, 300, 100)];
    expect(cellsOf(fill(cell(0, 0), walled, { grid, map: { width: 300, height: 300 } }), grid, { width: 300, height: 300 })).toHaveLength(150 * 50);
  });
});

describe("roomCells: degenerate inputs", () => {
  it("an unusable grid or map, or a start cell off the lattice, fills nothing", () => {
    for (const cellSize of [0, -50, NaN, Infinity]) {
      expect(roomCells(cell(0, 0), { cellSize, offsetX: 0, offsetY: 0 }, MAP, [])).toEqual([]);
    }
    expect(roomCells(cell(0, 0), GRID, { width: 0, height: 400 }, [])).toEqual([]);
    expect(roomCells(cell(0, 0), GRID, { width: 500, height: NaN }, [])).toEqual([]);
    expect(roomCells(cell(0, 0), { cellSize: 50, offsetX: NaN, offsetY: 0 }, MAP, [])).toEqual([]);
    for (const start of [cell(-1, 0), cell(10, 0), cell(0, 8), cell(0.5, 1), cell(NaN, 0)]) {
      expect(roomCells(start, GRID, MAP, [])).toEqual([]);
    }
  });

  it("ignores zero-length and non-finite segments", () => {
    const junk = [seg(100, 100, 100, 100), seg(NaN, 0, 100, 100), seg(0, 0, Infinity, 100), seg(0, -Infinity, 0, 5)];
    expect(fill(cell(3, 3), junk)).toEqual(fill(cell(3, 3), []));
  });
});

describe("roomCells: determinism", () => {
  it("the same answer for a repeated call, shuffled or reversed segments, and frozen inputs", () => {
    const walls = [
      ...outline([1, 1], [7, 1], [7, 6], [1, 6]),
      cornerSeg([4, 1], [4, 3]),
      seg(200, 187.5, 350, 300),
      seg(62.5, 175, 175, 175),
    ];
    const start = cell(2, 2);
    const first = fill(start, walls);
    expect(fill(start, walls)).toEqual(first);
    expect(fill(start, [...walls].reverse())).toEqual(first);
    expect(fill(start, walls.map(({ a, b }) => ({ a: b, b: a })))).toEqual(first);
    const shuffled = [walls[3], walls[6], walls[0], walls[5], walls[2], walls[4], walls[1]];
    expect(fill(start, shuffled)).toEqual(first);
    const frozen = Object.freeze(walls.map((w) => Object.freeze({ a: Object.freeze({ ...w.a }), b: Object.freeze({ ...w.b }) })));
    expect(fill(Object.freeze({ ...start }), frozen, { grid: Object.freeze({ ...GRID }), map: Object.freeze({ ...MAP }) })).toEqual(first);
  });
});

/** Mulberry32: a small seeded generator, so the random outlines are the same every run. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("roomCells: no leak out of a closed outline", () => {
  /** A star-shaped (so simple) polygon round `centre`, flat. */
  function starPolygon(rnd: () => number, centre: Point, cs: number, snap: number | null): number[] {
    const n = 3 + Math.floor(rnd() * 7);
    const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((p, q) => p - q);
    const points: number[] = [];
    for (const angle of angles) {
      const r = cs * (1 + rnd() * 6);
      let x = centre.x + r * Math.cos(angle);
      let y = centre.y + r * Math.sin(angle);
      if (snap !== null) {
        x = Math.round(x / snap) * snap;
        y = Math.round(y / snap) * snap;
      }
      points.push(x, y);
    }
    return points;
  }

  function boundaryDistance(p: Point, points: readonly number[]): number {
    const n = points.length / 2;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      best = Math.min(
        best,
        distancePointSegment(p, { x: points[i * 2], y: points[i * 2 + 1] }, { x: points[j * 2], y: points[j * 2 + 1] })
      );
    }
    return best;
  }

  function check(grid: GridGeometry, map: Size, snap: (cs: number) => number | null, seed: number) {
    const rnd = random(seed);
    const cs = grid.cellSize;
    const startX = normalizeOffset(grid.offsetX, cs);
    const startY = normalizeOffset(grid.offsetY, cs);
    // The centre of the cell's part on the map (a partial edge cell's is inside the map).
    const middle = (from: number, extent: number) => (Math.max(0, from) + Math.min(extent, from + cs)) / 2;
    const centreOf = ({ column, row }: GridCell): Point => ({
      x: middle(startX + column * cs, map.width),
      y: middle(startY + row * cs, map.height),
    });
    let checked = 0;
    for (let n = 0; n < 150; n++) {
      const origin = { x: rnd() * map.width, y: rnd() * map.height };
      const points = starPolygon(rnd, origin, cs, snap(cs));
      const segments: Segment[] = [];
      for (let i = 0; i < points.length / 2; i++) {
        const j = (i + 1) % (points.length / 2);
        segments.push(seg(points[i * 2], points[i * 2 + 1], points[j * 2], points[j * 2 + 1]));
      }
      // Two starts: a random cell, and the cell under the outline's origin.
      for (const at of [{ x: rnd() * map.width, y: rnd() * map.height }, origin]) {
        const start = cellAt(at, grid, map);
        if (!start) continue;
        const startCentre = centreOf(start);
        if (boundaryDistance(startCentre, points) < 1e-6) continue;
        const inside = pointInPolygon(startCentre, points);
        const rects = roomCells(start, grid, map, segments);
        if (rects === "too-large") throw new Error("too large");
        for (const key of cellsOf(rects, grid, map)) {
          const [column, row] = key.split(",").map(Number);
          const centre = centreOf({ column, row });
          if (boundaryDistance(centre, points) < 1e-6) continue; // on the outline: either side is fair
          expect(pointInPolygon(centre, points), `seed ${seed} outline ${n} cell ${key}`).toBe(inside);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }

  it("never reaches a cell centre on the other side of a random outline at any angle", () => {
    check({ cellSize: 23.7, offsetX: 7.3, offsetY: 11.9 }, { width: 520, height: 410 }, () => null, 108);
  });

  it("nor when the outline's corners sit exactly on grid corners and cell centres (every tie)", () => {
    check({ cellSize: 40, offsetX: 0, offsetY: 0 }, { width: 600, height: 480 }, (cs) => cs / 2, 2026);
    check({ cellSize: 50, offsetX: 12, offsetY: 7 }, { width: 400, height: 300 }, (cs) => cs, 7);
  });
});

describe("roomCells: budget", () => {
  it("fills ~20 000 cells among 400 walls well within a pointer frame's budget", () => {
    const grid = { cellSize: 20, offsetX: 0, offsetY: 0 };
    const map = { width: 3000, height: 2640 }; // 150 × 132 = 19 800 cells
    const rnd = random(400);
    const walls = Array.from({ length: 400 }, () => {
      const x = rnd() * map.width;
      const y = rnd() * map.height;
      const angle = rnd() * 2 * Math.PI;
      const length = 20 + rnd() * 100;
      return seg(x, y, x + length * Math.cos(angle), y + length * Math.sin(angle));
    });
    const start = cell(75, 66);
    const times: number[] = [];
    let size = 0;
    for (let run = 0; run < 15; run++) {
      const t0 = performance.now();
      const rects = roomCells(start, grid, map, walls);
      times.push(performance.now() - t0);
      if (rects !== "too-large") size = rects.length;
    }
    times.sort((p, q) => p - q);
    expect(size).toBeGreaterThan(0);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(50);
  });
});
