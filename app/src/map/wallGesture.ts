/**
 * The wall and door tools' pointer gesture as a pure state machine (T102,
 * ADR 0025): presses, moves and releases in map pixels → committed
 * segments, one at a time. `DmCanvas` feeds it stage events and draws
 * `wallGesturePreview` as the live preview; every committed segment
 * becomes one `map/wall-set` in the view.
 *
 * - **wall** (a polyline): a press places a vertex; every vertex after the
 *   first commits the segment from the previous one. A release that
 *   travelled at least `minDrag` from its press places a vertex too, so a
 *   drag draws one segment. A vertex within `minDrag` of the last one is
 *   ignored (no zero-length walls — and the second press of a double-click
 *   lands on the last vertex). A **double-click** ends the polyline, unless
 *   the press it came with placed a vertex (two quick clicks on two corners
 *   are two vertices, not an end, and a fresh polyline started quickly
 *   after the last one ended is kept); **cancel** (Esc) ends it too. The
 *   browser sends a double-click's own press and release after the event:
 *   the idle state remembers where the polyline ended (`endedAt`) and
 *   swallows a press there, so no stray one-vertex polyline starts.
 *   Nothing is ever left dangling: the preview segment from the last vertex
 *   to the pointer is not a segment until its far end is placed.
 * - **door**: press, drag, release: one closed door from the press to the
 *   release, nothing when the two are closer than `minDrag`.
 *
 * Every placed point is **snapped** to the nearest grid corner
 * (`nearestGridCorner`) when the event's point is within `snapThreshold`
 * of one and `grid` is set; an event with `shift` is never snapped, so
 * Shift places a point exactly where the pointer is. The preview shows the
 * snapped point, so what is previewed is what is committed.
 *
 * `snapThreshold` and `minDrag` are in map pixels; callers divide their
 * screen-pixel thresholds by the viewport scale.
 */
import type { GridGeometry } from "../state/model";
import type { WallKind } from "../state/walls";
import { nearestGridCorner } from "./grid";
import type { Point } from "./viewport";

export interface WallGestureConfig {
  tool: WallKind;
  /** Corners of this grid are snap targets; null while snapping is off. */
  grid: GridGeometry | null;
  /** Map pixels: a point further than this from the nearest corner stays put. */
  snapThreshold: number;
  /**
   * Map pixels: a release closer than this to its press is a click, and a
   * vertex closer than this to the previous one is the same vertex.
   */
  minDrag: number;
}

export type WallGestureState =
  | {
      phase: "idle";
      /**
       * Where a double-click just ended a polyline: the browser sends that
       * double-click's own press and release after it, and a press there
       * must not start a stray one-vertex polyline. Cleared by the next press.
       */
      endedAt?: Point;
    }
  /** The wall tool with at least one vertex placed. */
  | {
      phase: "drawing";
      /** Snapped, in order; the last one is the live segment's start. */
      vertices: Point[];
      /** The pointer, snapped, for the preview. */
      current: Point;
      /** The raw press point while the button is held; null once released. */
      pressed: Point | null;
      /** Whether the latest press (or the drag it became) placed a vertex. */
      lastPressPlaced: boolean;
    }
  /** The door tool with the button held. */
  | { phase: "dragging"; start: Point; current: Point };

export const IDLE_WALL_GESTURE: WallGestureState = { phase: "idle" };

export type WallGestureEvent =
  | { type: "down"; point: Point; shift?: boolean }
  | { type: "move"; point: Point; shift?: boolean }
  | { type: "up"; point: Point; shift?: boolean }
  | { type: "double"; point: Point; shift?: boolean }
  | { type: "cancel" };

/** A segment the gesture committed: its kind and endpoints in map pixels. */
export interface NewWallSegment {
  kind: WallKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WallGestureStep {
  state: WallGestureState;
  /** Present when this event committed a segment. */
  segment?: NewWallSegment;
}

/**
 * Where a point lands: the nearest grid corner when snapping is on, the
 * corner is within reach and Shift is not held; the point itself otherwise.
 */
export function snapWallPoint(
  point: Point,
  config: Pick<WallGestureConfig, "grid" | "snapThreshold">,
  shift = false
): Point {
  if (!config.grid || shift) return { x: point.x, y: point.y };
  const corner = nearestGridCorner(point, config.grid);
  return Math.hypot(corner.x - point.x, corner.y - point.y) <= config.snapThreshold
    ? corner
    : { x: point.x, y: point.y };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function segmentBetween(kind: WallKind, a: Point, b: Point): NewWallSegment {
  return { kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** Adds `vertex` to a polyline unless it repeats the last one; the new segment if it did. */
function placeVertex(
  state: Extract<WallGestureState, { phase: "drawing" }>,
  vertex: Point,
  minDrag: number
): { vertices: Point[]; segment?: NewWallSegment } {
  const last = state.vertices[state.vertices.length - 1];
  if (distance(last, vertex) < minDrag) return { vertices: state.vertices };
  return {
    vertices: [...state.vertices, vertex],
    segment: segmentBetween("wall", last, vertex),
  };
}

function reduceWallTool(
  state: WallGestureState,
  event: Exclude<WallGestureEvent, { type: "cancel" }>,
  config: WallGestureConfig
): WallGestureStep {
  const snapped = snapWallPoint(event.point, config, event.shift);
  if (state.phase !== "drawing") {
    if (event.type !== "down") return { state };
    if (
      state.phase === "idle" &&
      state.endedAt !== undefined &&
      distance(state.endedAt, event.point) < config.minDrag
    ) {
      // The tail of the double-click that ended the last polyline.
      return { state: IDLE_WALL_GESTURE };
    }
    return {
      state: {
        phase: "drawing",
        vertices: [snapped],
        current: snapped,
        pressed: event.point,
        lastPressPlaced: true,
      },
    };
  }
  switch (event.type) {
    case "down": {
      const placed = placeVertex(state, snapped, config.minDrag);
      return {
        state: {
          ...state,
          vertices: placed.vertices,
          current: snapped,
          pressed: event.point,
          lastPressPlaced: placed.segment !== undefined,
        },
        segment: placed.segment,
      };
    }
    case "move":
      return { state: { ...state, current: snapped } };
    case "up": {
      const dragged =
        state.pressed !== null && distance(state.pressed, event.point) >= config.minDrag;
      const placed = dragged ? placeVertex(state, snapped, config.minDrag) : { vertices: state.vertices };
      return {
        state: {
          ...state,
          vertices: placed.vertices,
          current: snapped,
          pressed: null,
          lastPressPlaced: state.lastPressPlaced || placed.segment !== undefined,
        },
        segment: placed.segment,
      };
    }
    case "double":
      // A double-click on the last vertex ends the polyline. One whose press
      // placed a vertex was just a quick second click on the next corner (or
      // a quick fresh start after the last polyline ended) and changes nothing.
      return state.lastPressPlaced ? { state } : { state: { phase: "idle", endedAt: event.point } };
  }
}

function reduceDoorTool(
  state: WallGestureState,
  event: Exclude<WallGestureEvent, { type: "cancel" }>,
  config: WallGestureConfig
): WallGestureStep {
  const snapped = snapWallPoint(event.point, config, event.shift);
  if (state.phase !== "dragging") {
    if (event.type !== "down") return { state };
    return { state: { phase: "dragging", start: snapped, current: snapped } };
  }
  switch (event.type) {
    case "down":
    case "move":
      return { state: { ...state, current: snapped } };
    case "up":
      return distance(state.start, snapped) >= config.minDrag
        ? { state: IDLE_WALL_GESTURE, segment: segmentBetween("door", state.start, snapped) }
        : { state: IDLE_WALL_GESTURE };
    case "double":
      return { state };
  }
}

export function reduceWallGesture(
  state: WallGestureState,
  event: WallGestureEvent,
  config: WallGestureConfig
): WallGestureStep {
  if (event.type === "cancel") return { state: IDLE_WALL_GESTURE };
  // A tool change mid-gesture cannot happen (the canvas resets the state),
  // but a state of the other tool's shape is treated as idle just in case.
  return config.tool === "door"
    ? reduceDoorTool(state.phase === "drawing" ? IDLE_WALL_GESTURE : state, event, config)
    : reduceWallTool(state.phase === "dragging" ? IDLE_WALL_GESTURE : state, event, config);
}

/** The live segment: from the last placed point to the pointer; null while idle. */
export function wallGesturePreview(state: WallGestureState): { from: Point; to: Point } | null {
  switch (state.phase) {
    case "idle":
      return null;
    case "drawing":
      return { from: state.vertices[state.vertices.length - 1], to: state.current };
    case "dragging":
      return { from: state.start, to: state.current };
  }
}
