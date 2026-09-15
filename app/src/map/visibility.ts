/**
 * Visibility polygon (T104, ADR 0026): what a point sees — the part of the
 * map within a radius that no blocking segment hides. Walls and closed doors
 * block, open doors do not. Pure and shared by both windows: T106 reveals
 * what a dropped token sees, T107 draws what every token currently sees.
 *
 * Angular sweep: rays are cast just either side (± `ANGLE_EPSILON`) of every
 * segment endpoint and map corner within the radius, at every point where a
 * segment or a map edge crosses the radius circle, and at `RADIUS_STEPS`
 * fixed angles round the circle. Each ray stops at its nearest hit — a
 * segment, the map's edge (the bounds are four implicit segments, met by a
 * slab test) or the radius — and the hits, in angle order, are the polygon.
 * A ray only tests the segments in its angular bin, nearest first, and stops
 * as soon as the next one starts beyond its best hit so far.
 *
 * Degenerate inputs never throw. No radius, an origin that is not a finite
 * point on the map, or an empty map give `[]` (nothing is seen). A segment
 * through the origin — a token centred on a wall line — blocks nothing, so
 * the point sees both sides. Zero-length and non-finite segments are ignored.
 *
 * Wall endpoints are read through `segmentPoints`: nothing in `map/` reads a
 * wall's coordinates by hand (`player/boundary.test.ts`).
 */
import { isBlocking, segmentPoints, type WallSegment } from "../state/walls";
import { distancePointSegment } from "./geometry";
import type { Point, Size } from "./viewport";

/** A blocking segment in map pixels. */
export interface Segment {
  a: Point;
  b: Point;
}

/** Fixed rays round the radius circle; the 64-gon's area is 0.16 % short of the circle's. */
export const RADIUS_STEPS = 64;
/** Radians either side of a corner at which its two rays are cast. */
export const ANGLE_EPSILON = 1e-5;
/** A segment this close to the origin (map px) passes through it and blocks nothing. */
export const ON_SEGMENT_EPSILON = 1e-3;

/** Angular bins the rays look segments up in. */
const ANGLE_BINS = 256;
/** A segment subtending more than this goes in every bin: near π the short way round is unreliable. */
const WIDE_SPAN = 0.9 * Math.PI;
/** A ray within this sine of a segment's direction is parallel to it (and slides past it). */
const PARALLEL_EPSILON = 1e-9;
/** Slack on the segment parameter, so a ray through a shared corner hits one of its segments. */
const ENDPOINT_SLACK = 1e-9;
/** A ray direction component this small runs along a map edge (cos(π/2) is 6e-17, not 0). */
const AXIS_EPSILON = 1e-12;

const TWO_PI = 2 * Math.PI;

// One record per candidate segment, relative to the origin: start, direction,
// cross(start, direction) (the ray parameter's numerator), length, and the
// distance from the origin to the segment's nearest point.
const AX = 0;
const AY = 1;
const DX = 2;
const DY = 3;
const CROSS = 4;
const LENGTH = 5;
const NEAR = 6;
const STRIDE = 7;

/** The segments that block sight: every wall, and every door while it is closed. */
export function blockingSegments(walls: readonly WallSegment[]): Segment[] {
  return walls.filter(isBlocking).map((wall) => {
    const [a, b] = segmentPoints(wall);
    return { a, b };
  });
}

/** A vision of `visionCells` cells in map pixels; 0 unless both are positive and finite. */
export function visionRadiusPx(visionCells: number, cellSize: number): number {
  const radius = visionCells * cellSize;
  return visionCells > 0 && cellSize > 0 && Number.isFinite(radius) ? radius : 0;
}

interface AngleList {
  values: Float64Array;
  count: number;
}

/** Appends a ray angle, normalised into [-π, π). */
function addAngle(list: AngleList, theta: number): void {
  list.values[list.count++] =
    theta < -Math.PI ? theta + TWO_PI : theta >= Math.PI ? theta - TWO_PI : theta;
}

/** The two rays just either side of the direction to (x, y). */
function addCornerRays(list: AngleList, x: number, y: number): void {
  const theta = Math.atan2(y, x);
  addAngle(list, theta - ANGLE_EPSILON);
  addAngle(list, theta + ANGLE_EPSILON);
}

/** A ray to each point where (x, y) + u·(dx, dy), 0 < u < 1, crosses the circle of `radius`. */
function addCircleCrossings(
  list: AngleList,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number
): void {
  const a = dx * dx + dy * dy;
  const b = 2 * (x * dx + y * dy);
  const discriminant = b * b - 4 * a * (x * x + y * y - radius * radius);
  if (a === 0 || discriminant <= 0) return;
  const root = Math.sqrt(discriminant);
  for (const u of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (u > 0 && u < 1) addAngle(list, Math.atan2(y + u * dy, x + u * dx));
  }
}

function angleBin(theta: number): number {
  return Math.floor(((theta + Math.PI) / TWO_PI) * ANGLE_BINS);
}

function wrapBin(bin: number): number {
  return ((bin % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS;
}

/**
 * Bins of candidate segments by the angles they subtend from the origin (one
 * bin of margin either side), each bin's list nearest first: bin `k` holds
 * `items[start[k]]` … `items[start[k + 1] - 1]`.
 */
function binSegments(records: Float64Array, count: number): { start: Int32Array; items: Int32Array } {
  const first = new Int32Array(count);
  const span = new Int32Array(count);
  const start = new Int32Array(ANGLE_BINS + 1);
  for (let i = 0; i < count; i++) {
    const at = i * STRIDE;
    const ax = records[at + AX];
    const ay = records[at + AY];
    const alpha = Math.atan2(ay, ax);
    let sweep = Math.atan2(ay + records[at + DY], ax + records[at + DX]) - alpha;
    if (sweep > Math.PI) sweep -= TWO_PI;
    else if (sweep < -Math.PI) sweep += TWO_PI;
    if (Math.abs(sweep) > WIDE_SPAN) {
      span[i] = ANGLE_BINS;
    } else {
      const from = sweep >= 0 ? alpha : alpha + sweep;
      first[i] = angleBin(from) - 1;
      span[i] = Math.min(ANGLE_BINS, angleBin(from + Math.abs(sweep)) + 1 - first[i] + 1);
    }
    for (let k = 0; k < span[i]; k++) start[wrapBin(first[i] + k) + 1]++;
  }
  for (let k = 0; k < ANGLE_BINS; k++) start[k + 1] += start[k];

  const order = Array.from({ length: count }, (_, i) => i).sort(
    (i, j) => records[i * STRIDE + NEAR] - records[j * STRIDE + NEAR] || i - j
  );
  const items = new Int32Array(start[ANGLE_BINS]);
  const next = start.slice(0, ANGLE_BINS);
  for (const i of order) {
    for (let k = 0; k < span[i]; k++) items[next[wrapBin(first[i] + k)]++] = i;
  }
  return { start, items };
}

/**
 * The polygon `origin` sees within `radiusPx` on a map of `bounds`, with
 * `segments` blocking: flat `[x0, y0, x1, y1, …]` in map pixels, in angle
 * order round the origin, every vertex on the map. Same input, same output.
 */
export function visibilityPolygon(
  origin: Point,
  radiusPx: number,
  segments: readonly Segment[],
  bounds: Size
): number[] {
  const { x: ox, y: oy } = origin;
  const { width, height } = bounds;
  const valid =
    radiusPx > 0 &&
    Number.isFinite(radiusPx) &&
    width > 0 &&
    height > 0 &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    ox >= 0 &&
    oy >= 0 &&
    ox <= width &&
    oy <= height;
  if (!valid) return [];

  const angles: AngleList = {
    values: new Float64Array(segments.length * 6 + 16 + RADIUS_STEPS),
    count: 0,
  };

  // Candidates: finite, not a point, not through the origin, starting within the radius.
  const records = new Float64Array(segments.length * STRIDE);
  let count = 0;
  for (const { a, b } of segments) {
    const ax = a.x - ox;
    const ay = a.y - oy;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0 && Number.isFinite(length) && Number.isFinite(ax) && Number.isFinite(ay))) {
      continue;
    }
    const near = distancePointSegment(origin, a, b);
    if (near <= ON_SEGMENT_EPSILON || near >= radiusPx) continue;
    const at = count * STRIDE;
    records[at + AX] = ax;
    records[at + AY] = ay;
    records[at + DX] = dx;
    records[at + DY] = dy;
    records[at + CROSS] = ax * dy - ay * dx;
    records[at + LENGTH] = length;
    records[at + NEAR] = near;
    count++;
    if (Math.hypot(ax, ay) < radiusPx) addCornerRays(angles, ax, ay);
    if (Math.hypot(ax + dx, ay + dy) < radiusPx) addCornerRays(angles, ax + dx, ay + dy);
    addCircleCrossings(angles, ax, ay, dx, dy, radiusPx);
  }

  // The map's edges, relative to the origin: corner rays and circle crossings
  // here; each ray's exit distance is computed below.
  const left = -ox;
  const top = -oy;
  const right = width - ox;
  const bottom = height - oy;
  for (const [x, y] of [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]) {
    const distance = Math.hypot(x, y);
    if (distance > 0 && distance < radiusPx) addCornerRays(angles, x, y);
  }
  addCircleCrossings(angles, left, top, width, 0, radiusPx);
  addCircleCrossings(angles, right, top, 0, height, radiusPx);
  addCircleCrossings(angles, right, bottom, -width, 0, radiusPx);
  addCircleCrossings(angles, left, bottom, 0, -height, radiusPx);

  for (let k = 0; k < RADIUS_STEPS; k++) addAngle(angles, -Math.PI + (k * TWO_PI) / RADIUS_STEPS);

  const bins = binSegments(records, count);
  const sorted = angles.values.subarray(0, angles.count).sort();
  const polygon: number[] = [];
  for (let n = 0; n < sorted.length; n++) {
    const theta = sorted[n];
    if (n > 0 && theta === sorted[n - 1]) continue;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    let best = Math.min(
      radiusPx,
      c > AXIS_EPSILON ? right / c : c < -AXIS_EPSILON ? left / c : Infinity,
      s > AXIS_EPSILON ? bottom / s : s < -AXIS_EPSILON ? top / s : Infinity
    );
    const bin = Math.min(ANGLE_BINS - 1, angleBin(theta));
    for (let j = bins.start[bin]; j < bins.start[bin + 1]; j++) {
      const at = bins.items[j] * STRIDE;
      if (records[at + NEAR] >= best) break;
      const denominator = c * records[at + DY] - s * records[at + DX];
      if (Math.abs(denominator) <= PARALLEL_EPSILON * records[at + LENGTH]) continue;
      const t = records[at + CROSS] / denominator;
      if (t <= ON_SEGMENT_EPSILON || t >= best) continue;
      const u = (records[at + AX] * s - records[at + AY] * c) / denominator;
      if (u < -ENDPOINT_SLACK || u > 1 + ENDPOINT_SLACK) continue;
      best = t;
    }
    const x = Math.min(width, Math.max(0, ox + c * best));
    const y = Math.min(height, Math.max(0, oy + s * best));
    const last = polygon.length;
    if (last >= 2 && polygon[last - 2] === x && polygon[last - 1] === y) continue;
    polygon.push(x, y);
  }
  const end = polygon.length;
  if (end >= 4 && polygon[0] === polygon[end - 2] && polygon[1] === polygon[end - 1]) {
    polygon.length = end - 2;
  }
  return polygon;
}
