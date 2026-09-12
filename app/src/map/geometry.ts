/**
 * Small 2D geometry helpers, pure: point / segment / rectangle / polygon
 * containment, distance and intersection. Used by grid snapping
 * (`fogSnap.ts`); later by tokens ("is this token under fog?").
 *
 * Rectangles are `{ x, y, width, height }` (axis-aligned, closed);
 * polygons are flat `[x0, y0, x1, y1, ...]` with even-odd containment.
 */
import type { Point } from "./viewport";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Positive-area overlap of two rectangles (touching edges, and empty rects, do not count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Distance from a point to the nearest point of a rectangle (0 inside). */
export function distancePointRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

export function distancePointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Even-odd containment; a point exactly on an edge may fall either way. */
export function pointInPolygon(p: Point, points: readonly number[]): boolean {
  const n = Math.floor(points.length / 2);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2];
    const yi = points[i * 2 + 1];
    const xj = points[j * 2];
    const yj = points[j * 2 + 1];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    p.x <= Math.max(a.x, b.x) &&
    p.x >= Math.min(a.x, b.x) &&
    p.y <= Math.max(a.y, b.y) &&
    p.y >= Math.min(a.y, b.y)
  );
}

/** Closed segments a-b and c-d share at least one point (collinear overlap counts). */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

export function rectCorners(r: Rect): [Point, Point, Point, Point] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const c = rectCorners(r);
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
  }
  return false;
}

/**
 * Distance between a segment and a rectangle (0 when they meet). Both are
 * convex, so the minimum is at a vertex of one of them.
 */
export function distanceSegmentRect(a: Point, b: Point, r: Rect): number {
  if (segmentIntersectsRect(a, b, r)) return 0;
  let best = Math.min(distancePointRect(a, r), distancePointRect(b, r));
  for (const corner of rectCorners(r)) best = Math.min(best, distancePointSegment(corner, a, b));
  return best;
}

/** The polygon and the rectangle share area, an edge crossing, or a corner. */
export function polygonIntersectsRect(points: readonly number[], r: Rect): boolean {
  const n = Math.floor(points.length / 2);
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    if (pointInRect({ x: points[i * 2], y: points[i * 2 + 1] }, r)) return true;
  }
  for (const corner of rectCorners(r)) if (pointInPolygon(corner, points)) return true;
  const c = rectCorners(r);
  for (let i = 0; i < n; i++) {
    const a = { x: points[i * 2], y: points[i * 2 + 1] };
    const b = { x: points[((i + 1) % n) * 2], y: points[((i + 1) % n) * 2 + 1] };
    for (let k = 0; k < 4; k++) if (segmentsIntersect(a, b, c[k], c[(k + 1) % 4])) return true;
  }
  return false;
}
