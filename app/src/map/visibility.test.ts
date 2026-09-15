// @vitest-environment node
/**
 * The visibility polygon (T104): the radius circle on an empty map, doors,
 * shadows checked against a brute-force sight-line test, the degenerate
 * inputs, determinism and the time budget.
 */
import { createDoor, createWall, segmentPoints, type WallSegment } from "../state/walls";
import { pointInPolygon, segmentsIntersect } from "./geometry";
import type { Point, Size } from "./viewport";
import {
  RADIUS_STEPS,
  blockingSegments,
  visibilityPolygon,
  visionRadiusPx,
  type Segment,
} from "./visibility";

const BOUNDS: Size = { width: 1000, height: 1000 };
const CENTRE: Point = { x: 500, y: 500 };
const RADIUS = 250;

const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

function vertices(polygon: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < polygon.length; i += 2) out.push({ x: polygon[i], y: polygon[i + 1] });
  return out;
}

/** Shoelace area of a flat polygon. */
function area(polygon: readonly number[]): number {
  const n = polygon.length / 2;
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    twice += polygon[j * 2] * polygon[i * 2 + 1] - polygon[i * 2] * polygon[j * 2 + 1];
  }
  return Math.abs(twice) / 2;
}

/** The blockers worked out by hand, independently of `blockingSegments`. */
function blockersByHand(walls: readonly WallSegment[]): Segment[] {
  return walls
    .filter((wall) => wall.kind === "wall" || !wall.open)
    .map((wall) => {
      const [a, b] = segmentPoints(wall);
      return { a, b };
    });
}

/** Brute force: `p` is seen when it is on the map, within the radius, and no blocker meets the sight line. */
function sees(origin: Point, radius: number, blockers: readonly Segment[], bounds: Size, p: Point): boolean {
  if (p.x < 0 || p.y < 0 || p.x > bounds.width || p.y > bounds.height) return false;
  if (Math.hypot(p.x - origin.x, p.y - origin.y) > radius) return false;
  return !blockers.some(({ a, b }) => segmentsIntersect(origin, p, a, b));
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1.5, 0],
  [-1.5, 0],
  [0, 1.5],
  [0, -1.5],
  [1.1, 1.1],
  [1.1, -1.1],
  [-1.1, 1.1],
  [-1.1, -1.1],
];

/**
 * Samples a grid over the circle's box and compares polygon containment with
 * `sees`. Points whose brute-force answer changes within 1.5 px are skipped:
 * the polygon is exact only up to the circle's chords (under 0.5 px at these
 * radii) and the rays cast a hair either side of a corner. `shadowed` counts
 * the points on the map and within the radius that are hidden.
 */
function compareWithBruteForce(
  origin: Point,
  radius: number,
  blockers: readonly Segment[],
  bounds: Size,
  polygon: readonly number[]
): { mismatches: Point[]; seen: number; shadowed: number } {
  const mismatches: Point[] = [];
  let seen = 0;
  let shadowed = 0;
  const step = 4.7;
  for (let y = origin.y - radius - 8.3; y <= origin.y + radius + 8; y += step) {
    for (let x = origin.x - radius - 8.3; x <= origin.x + radius + 8; x += step) {
      const p = { x, y };
      const visible = sees(origin, radius, blockers, bounds, p);
      const nearAnEdge = NEIGHBOURS.some(
        ([dx, dy]) => sees(origin, radius, blockers, bounds, { x: x + dx, y: y + dy }) !== visible
      );
      if (nearAnEdge) continue;
      if (pointInPolygon(p, polygon) !== visible) mismatches.push(p);
      if (visible) seen++;
      else if (sees(origin, radius, [], bounds, p)) shadowed++;
    }
  }
  return { mismatches, seen, shadowed };
}

/** A 200 px room round the centre with a door in its right-hand wall. */
function room(open: boolean): WallSegment[] {
  return [
    createWall({ id: "top", x1: 400, y1: 400, x2: 600, y2: 400 }),
    createWall({ id: "left", x1: 400, y1: 400, x2: 400, y2: 600 }),
    createWall({ id: "bottom", x1: 400, y1: 600, x2: 600, y2: 600 }),
    createWall({ id: "right-upper", x1: 600, y1: 400, x2: 600, y2: 450 }),
    createWall({ id: "right-lower", x1: 600, y1: 550, x2: 600, y2: 600 }),
    createDoor({ id: "door", x1: 600, y1: 450, x2: 600, y2: 550, open }),
  ];
}

/** Walls and doors round the centre: a wall above, a diagonal, a long wall crossing the circle, an L, a closed and an open door. */
const SHADOW_WALLS: WallSegment[] = [
  createWall({ id: "north", x1: 440, y1: 420, x2: 580, y2: 420 }),
  createWall({ id: "diagonal", x1: 600, y1: 520, x2: 660, y2: 640 }),
  createWall({ id: "long", x1: 150, y1: 700, x2: 850, y2: 640 }),
  createWall({ id: "l-upright", x1: 380, y1: 480, x2: 380, y2: 540 }),
  createWall({ id: "l-foot", x1: 380, y1: 540, x2: 340, y2: 540 }),
  createDoor({ id: "closed", x1: 520, y1: 330, x2: 620, y2: 380, open: false }),
  createDoor({ id: "open", x1: 300, y1: 350, x2: 360, y2: 420, open: true }),
];

describe("visionRadiusPx", () => {
  it("is the vision in cells times the cell size", () => {
    expect(visionRadiusPx(6, 70)).toBe(420);
    expect(visionRadiusPx(1.5, 50)).toBe(75);
  });

  it("is 0 for no vision, a non-positive cell or anything non-finite", () => {
    expect(visionRadiusPx(0, 70)).toBe(0);
    expect(visionRadiusPx(-2, 70)).toBe(0);
    expect(visionRadiusPx(6, 0)).toBe(0);
    expect(visionRadiusPx(6, -70)).toBe(0);
    expect(visionRadiusPx(Number.NaN, 70)).toBe(0);
    expect(visionRadiusPx(Number.POSITIVE_INFINITY, 70)).toBe(0);
  });
});

describe("blockingSegments", () => {
  it("keeps walls and closed doors, in order, and drops open doors", () => {
    const walls: WallSegment[] = [
      createWall({ id: "w", x1: 0, y1: 1, x2: 2, y2: 3 }),
      createDoor({ id: "open", x1: 4, y1: 5, x2: 6, y2: 7, open: true }),
      createDoor({ id: "closed", x1: 8, y1: 9, x2: 10, y2: 11 }),
    ];
    expect(blockingSegments(walls)).toEqual([seg(0, 1, 2, 3), seg(8, 9, 10, 11)]);
    expect(blockingSegments([])).toEqual([]);
  });
});

describe("visibilityPolygon", () => {
  it("is the radius circle on an empty map", () => {
    const origin = { x: 1000, y: 1000 };
    const radius = 300;
    const polygon = visibilityPolygon(origin, radius, [], { width: 2000, height: 2000 });
    expect(polygon).toHaveLength(RADIUS_STEPS * 2);
    for (const v of vertices(polygon)) {
      expect(Math.hypot(v.x - origin.x, v.y - origin.y)).toBeCloseTo(radius, 9);
    }
    expect(Math.abs(area(polygon) / (Math.PI * radius * radius) - 1)).toBeLessThan(0.02);
  });

  it("is blocked by a closed door and not by an open one", () => {
    const closed = visibilityPolygon(CENTRE, 300, blockingSegments(room(false)), BOUNDS);
    for (const v of vertices(closed)) {
      expect(v.x).toBeGreaterThanOrEqual(400 - 1e-6);
      expect(v.x).toBeLessThanOrEqual(600 + 1e-6);
      expect(v.y).toBeGreaterThanOrEqual(400 - 1e-6);
      expect(v.y).toBeLessThanOrEqual(600 + 1e-6);
    }
    expect(Math.abs(area(closed) / 40000 - 1)).toBeLessThan(0.001);
    expect(pointInPolygon({ x: 700, y: 500 }, closed)).toBe(false);

    const open = visibilityPolygon(CENTRE, 300, blockingSegments(room(true)), BOUNDS);
    expect(pointInPolygon({ x: 700, y: 500 }, open)).toBe(true);
    // Beside the doorway the wall still hides what is behind it.
    expect(pointInPolygon({ x: 700, y: 380 }, open)).toBe(false);
    expect(area(open)).toBeGreaterThan(area(closed) + 5000);
    // An open door is no segment at all.
    const withoutDoor = room(true).filter((wall) => wall.kind === "wall");
    expect(open).toStrictEqual(visibilityPolygon(CENTRE, 300, blockingSegments(withoutDoor), BOUNDS));

    for (const walls of [room(false), room(true)]) {
      const polygon = visibilityPolygon(CENTRE, 300, blockingSegments(walls), BOUNDS);
      const result = compareWithBruteForce(CENTRE, 300, blockersByHand(walls), BOUNDS, polygon);
      expect(result.mismatches).toEqual([]);
    }
  });

  it("casts the shadows a brute-force sight-line check sees", () => {
    const blockers = blockingSegments(SHADOW_WALLS);
    const polygon = visibilityPolygon(CENTRE, RADIUS, blockers, BOUNDS);
    const result = compareWithBruteForce(CENTRE, RADIUS, blockersByHand(SHADOW_WALLS), BOUNDS, polygon);
    expect(result.mismatches).toEqual([]);
    expect(result.seen).toBeGreaterThan(3000);
    expect(result.shadowed).toBeGreaterThan(1000);

    expect(pointInPolygon({ x: 510, y: 460 }, polygon)).toBe(true); // in front of the north wall
    expect(pointInPolygon({ x: 510, y: 380 }, polygon)).toBe(false); // behind it
    expect(pointInPolygon({ x: 320, y: 360 }, polygon)).toBe(true); // through the open door
    expect(pointInPolygon({ x: 600, y: 300 }, polygon)).toBe(false); // behind the closed door
    expect(pointInPolygon({ x: 500, y: 740 }, polygon)).toBe(false); // behind the long wall

    // Vertices go round the origin once, in angle order.
    const angles = vertices(polygon).map((v) => Math.atan2(v.y - CENTRE.y, v.x - CENTRE.x));
    let turned = 0;
    for (let i = 0; i < angles.length; i++) {
      let step = angles[(i + 1) % angles.length] - angles[i];
      if (step < -Math.PI) step += 2 * Math.PI;
      else if (step >= Math.PI) step -= 2 * Math.PI;
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      turned += step;
    }
    expect(turned).toBeCloseTo(2 * Math.PI, 6);
  });

  it("sees past segments that touch the origin at an endpoint, and still shadows the others", () => {
    const touching = [seg(500, 500, 600, 500), seg(500, 500, 500, 380)];
    const far = seg(420, 560, 580, 560);
    const polygon = visibilityPolygon(CENTRE, RADIUS, [...touching, far], BOUNDS);
    expect(polygon.length).toBeGreaterThanOrEqual(RADIUS_STEPS * 2);
    expect(polygon.every(Number.isFinite)).toBe(true);
    expect(pointInPolygon({ x: 550, y: 490 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 550, y: 510 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 500, y: 650 }, polygon)).toBe(false);
    const result = compareWithBruteForce(CENTRE, RADIUS, [far], BOUNDS, polygon);
    expect(result.mismatches).toEqual([]);
  });

  it("sees both sides of a segment the origin stands on", () => {
    const polygon = visibilityPolygon(CENTRE, RADIUS, [seg(400, 500, 600, 500)], BOUNDS);
    expect(Math.abs(area(polygon) / (Math.PI * RADIUS * RADIUS) - 1)).toBeLessThan(0.02);
    expect(pointInPolygon({ x: 500, y: 450 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 500, y: 550 }, polygon)).toBe(true);
  });

  it("lets no light through where collinear segments meet or overlap", () => {
    const merged = [seg(400, 420, 600, 420)];
    for (const parts of [
      [seg(400, 420, 500, 420), seg(500, 420, 600, 420)],
      [seg(400, 420, 520, 420), seg(480, 420, 600, 420)],
      [seg(600, 420, 500, 420), seg(400, 420, 500, 420)],
    ]) {
      const polygon = visibilityPolygon(CENTRE, RADIUS, parts, BOUNDS);
      // The joint at (500, 420) is straight above the origin.
      for (let x = 499; x <= 501; x += 0.05) {
        expect(pointInPolygon({ x, y: 300 }, polygon)).toBe(false);
      }
      expect(compareWithBruteForce(CENTRE, RADIUS, merged, BOUNDS, polygon).mismatches).toEqual([]);
    }
  });

  it("is not blocked by a segment seen edge-on", () => {
    const edgeOn = [seg(500, 400, 500, 300)];
    const polygon = visibilityPolygon(CENTRE, RADIUS, edgeOn, BOUNDS);
    expect(Math.abs(area(polygon) / (Math.PI * RADIUS * RADIUS) - 1)).toBeLessThan(0.02);
    expect(pointInPolygon({ x: 499, y: 350 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 501, y: 350 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 500.5, y: 260 }, polygon)).toBe(true);
    expect(compareWithBruteForce(CENTRE, RADIUS, edgeOn, BOUNDS, polygon).mismatches).toEqual([]);
  });

  it("ignores segments beyond the radius", () => {
    const near = [seg(440, 420, 580, 420)];
    const far = [seg(100, 100, 200, 100), seg(900, 500, 900, 900), seg(500, 760, 700, 760)];
    const expected = visibilityPolygon(CENTRE, RADIUS, near, BOUNDS);
    expect(visibilityPolygon(CENTRE, RADIUS, [...near, ...far], BOUNDS)).toStrictEqual(expected);
    expect(visibilityPolygon(CENTRE, RADIUS, [far[0], ...near, far[1], far[2]], BOUNDS)).toStrictEqual(
      expected
    );
  });

  it("is clipped to the map", () => {
    const bounds = { width: 800, height: 600 };
    const inBounds = (polygon: readonly number[]) =>
      vertices(polygon).every((v) => v.x >= 0 && v.x <= bounds.width && v.y >= 0 && v.y <= bounds.height);

    // Near a corner: the circle less what lies off the map, by counting pixel centres.
    const origin = { x: 60, y: 40 };
    const radius = 200;
    const walls = [seg(-50, 150, 150, 150)];
    const open = visibilityPolygon(origin, radius, [], bounds);
    expect(inBounds(open)).toBe(true);
    let pixels = 0;
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        if (Math.hypot(x + 0.5 - origin.x, y + 0.5 - origin.y) <= radius) pixels++;
      }
    }
    expect(Math.abs(area(open) / pixels - 1)).toBeLessThan(0.01);
    expect(compareWithBruteForce(origin, radius, [], bounds, open).mismatches).toEqual([]);
    const walled = visibilityPolygon(origin, radius, walls, bounds);
    expect(inBounds(walled)).toBe(true);
    expect(compareWithBruteForce(origin, radius, walls, bounds, walled).mismatches).toEqual([]);

    // On the map's edge: half the circle; in its corner: a quarter.
    const onEdge = visibilityPolygon({ x: 0, y: 300 }, radius, [], bounds);
    expect(inBounds(onEdge)).toBe(true);
    expect(Math.abs(area(onEdge) / ((Math.PI * radius * radius) / 2) - 1)).toBeLessThan(0.02);
    const inCorner = visibilityPolygon({ x: 800, y: 600 }, radius, [], bounds);
    expect(inBounds(inCorner)).toBe(true);
    expect(Math.abs(area(inCorner) / ((Math.PI * radius * radius) / 4) - 1)).toBeLessThan(0.02);

    // A radius larger than the map: the whole map.
    const whole = visibilityPolygon({ x: 400, y: 300 }, 5000, [], bounds);
    expect(inBounds(whole)).toBe(true);
    expect(area(whole)).toBeCloseTo(800 * 600, 3);
  });

  it("gives a sane answer for degenerate inputs and never throws", () => {
    const walls = blockingSegments(SHADOW_WALLS);
    expect(visibilityPolygon(CENTRE, 0, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon(CENTRE, -10, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon(CENTRE, Number.NaN, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon(CENTRE, Number.POSITIVE_INFINITY, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon({ x: Number.NaN, y: 500 }, RADIUS, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon({ x: -1, y: 500 }, RADIUS, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon({ x: 500, y: 1001 }, RADIUS, walls, BOUNDS)).toEqual([]);
    expect(visibilityPolygon(CENTRE, RADIUS, walls, { width: 0, height: 0 })).toEqual([]);

    const empty = visibilityPolygon(CENTRE, RADIUS, [], BOUNDS);
    const junk = [seg(450, 450, 450, 450), seg(Number.NaN, 400, 600, 400), seg(400, 400, Number.POSITIVE_INFINITY, 400)];
    expect(visibilityPolygon(CENTRE, RADIUS, junk, BOUNDS)).toStrictEqual(empty);

    // A tiny radius is still the circle round the origin (area taken about the origin, for precision).
    const tiny = visibilityPolygon(CENTRE, 1e-6, walls, BOUNDS);
    expect(tiny).toHaveLength(RADIUS_STEPS * 2);
    const aboutOrigin = tiny.map((v, i) => v - (i % 2 === 0 ? CENTRE.x : CENTRE.y));
    expect(Math.abs(area(aboutOrigin) / (Math.PI * 1e-12) - 1)).toBeLessThan(0.02);
  });

  it("is deterministic: the same input gives identical output, whatever the segment order", () => {
    const blockers = blockingSegments(SHADOW_WALLS);
    const first = visibilityPolygon(CENTRE, RADIUS, blockers, BOUNDS);
    expect(visibilityPolygon(CENTRE, RADIUS, blockers, BOUNDS)).toStrictEqual(first);
    expect(visibilityPolygon({ ...CENTRE }, RADIUS, blockers.map((s) => ({ ...s })), { ...BOUNDS })).toStrictEqual(
      first
    );
    expect(visibilityPolygon(CENTRE, RADIUS, [...blockers].reverse(), BOUNDS)).toStrictEqual(first);
  });
});

describe("visibilityPolygon budget", () => {
  /** Seeded PRNG (mulberry32), so the scenes are the same on every run. */
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function medianMs(run: () => void): number {
    for (let i = 0; i < 10; i++) run();
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const started = performance.now();
      run();
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }

  const bounds = { width: 4096, height: 4096 };
  const origin = { x: 2048, y: 2048 };
  const radius = visionRadiusPx(12, 70);

  /** 400 walls of 20–100 px scattered through the vision circle. */
  function scattered(): Segment[] {
    const next = random(104);
    return Array.from({ length: 400 }, () => {
      const angle = next() * 2 * Math.PI;
      const distance = 40 + next() * (radius - 100);
      const cx = origin.x + Math.cos(angle) * distance;
      const cy = origin.y + Math.sin(angle) * distance;
      const heading = next() * Math.PI;
      const half = 10 + next() * 40;
      return seg(
        cx - Math.cos(heading) * half,
        cy - Math.sin(heading) * half,
        cx + Math.cos(heading) * half,
        cy + Math.sin(heading) * half
      );
    });
  }

  /** 400 radial spokes: nearly every ray passes them all without a hit. */
  function spokes(): Segment[] {
    return Array.from({ length: 400 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 400 + 0.001;
      const from = 60 + (i % 5) * 20;
      const to = from + 400;
      return seg(
        origin.x + Math.cos(angle) * from,
        origin.y + Math.sin(angle) * from,
        origin.x + Math.cos(angle) * to,
        origin.y + Math.sin(angle) * to
      );
    });
  }

  it.each([
    ["scattered walls", scattered],
    ["radial spokes", spokes],
  ])("400 blocking segments (%s), one origin: under 4 ms", (_name, scene) => {
    const segments = scene();
    expect(segments).toHaveLength(400);
    const polygon = visibilityPolygon(origin, radius, segments, bounds);
    expect(polygon.length).toBeGreaterThan(400 * 2);
    expect(medianMs(() => visibilityPolygon(origin, radius, segments, bounds))).toBeLessThan(4);
  });
});

describe("visibility.ts source", () => {
  const source = Object.values(
    import.meta.glob<string>("./visibility.ts", { query: "?raw", import: "default", eager: true })
  )[0];

  it("imports only pure modules and uses no any", () => {
    expect(source).toBeTruthy();
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../state/walls", "./geometry", "./viewport"]);
    expect(source).not.toMatch(/\b(document|window|navigator|HTMLCanvasElement|OffscreenCanvas|Konva)\b/);
    expect(source).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
  });
});
