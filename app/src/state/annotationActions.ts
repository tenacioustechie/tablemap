/**
 * The DM's annotation operations over a store (T011, ADR 0016): pinned
 * notes, freehand drawings, the eraser, clear-layer and pings. Annotations
 * carry no assets, so no database is involved; everything is one dispatch
 * (pings go through `store.sendPing`, they are not state). Same shape as
 * `tokenActions.ts`. Off-limits to `src/player/**`.
 */
import { nanoid } from "nanoid";
import { distancePointSegment } from "../map/geometry";
import {
  createDrawing,
  createNote,
  findAnnotation,
  notesOf,
  type DrawingAnnotation,
  type NoteAnnotation,
} from "./annotations";
import { findMap } from "./maps";
import type { AnnotationVisibility, MapScene } from "./model";
import { createPing, type Ping } from "./ping";
import type { TableStore } from "./store";

export interface MapPoint {
  x: number;
  y: number;
}

export interface NotePatch {
  x?: number;
  y?: number;
  text?: string;
}

export interface NewDrawingOptions {
  /** Flat [x0, y0, ...] in map pixels; at least one point. */
  points: readonly number[];
  color: string;
  /** Map pixels. */
  strokeWidth: number;
  visibility: AnnotationVisibility;
}

export interface AnnotationActions {
  /** Pins a note at a map point; undefined for an unknown map. */
  addNote(mapId: string, at: MapPoint, text?: string): NoteAnnotation | undefined;
  /** Moves or re-words a note; nothing for unknown notes or an empty patch. */
  updateNote(mapId: string, noteId: string, patch: NotePatch): void;
  /** Adds a stroke; undefined for an unknown map or no points. */
  addDrawing(mapId: string, drawing: NewDrawingOptions): DrawingAnnotation | undefined;
  /**
   * Removes every drawing that passes within `radius` map px of `at` (a
   * stroke is erased whole). Returns how many were removed.
   */
  erase(mapId: string, at: MapPoint, radius: number): number;
  /** Removes every drawing on the map (both visibilities). */
  clearDrawings(mapId: string): void;
  /** Removes one annotation of any kind. */
  remove(mapId: string, annotationId: string): void;
  /** Sends a pulse at a map point to every view; undefined for an unknown map. */
  ping(mapId: string, at: MapPoint): Ping | undefined;
}

export interface AnnotationActionsOptions {
  newId?: () => string;
  now?: () => number;
}

/** Whether the stroke passes within `radius` of the point (its own width counts). */
export function drawingWithin(drawing: DrawingAnnotation, at: MapPoint, radius: number): boolean {
  const reach = radius + drawing.strokeWidth / 2;
  const pts = drawing.points;
  if (pts.length < 2) return false;
  if (pts.length < 4) return Math.hypot(at.x - pts[0], at.y - pts[1]) <= reach;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const a = { x: pts[i], y: pts[i + 1] };
    const b = { x: pts[i + 2], y: pts[i + 3] };
    if (distancePointSegment(at, a, b) <= reach) return true;
  }
  return false;
}

export function createAnnotationActions(
  store: TableStore,
  { newId = () => nanoid(), now = () => Date.now() }: AnnotationActionsOptions = {}
): AnnotationActions {
  const scene = (mapId: string) => findMap(store.getState().shared, mapId);

  return {
    addNote(mapId, at, text = "") {
      if (!scene(mapId)) return undefined;
      const note = createNote({ id: newId(), x: at.x, y: at.y, text });
      store.getState().dispatch({ kind: "map/annotation-set", id: mapId, annotation: note });
      return note;
    },
    updateNote(mapId, noteId, patch) {
      const existing = findAnnotation(scene(mapId), noteId);
      if (!existing || existing.kind !== "note") return;
      const next: NoteAnnotation = {
        ...existing,
        x: patch.x ?? existing.x,
        y: patch.y ?? existing.y,
        text: patch.text ?? existing.text,
      };
      if (next.x === existing.x && next.y === existing.y && next.text === existing.text) return;
      store.getState().dispatch({ kind: "map/annotation-set", id: mapId, annotation: next });
    },
    addDrawing(mapId, { points, color, strokeWidth, visibility }) {
      if (!scene(mapId) || points.length < 2) return undefined;
      const drawing = createDrawing({ id: newId(), points, color, strokeWidth, visibility });
      store.getState().dispatch({ kind: "map/annotation-set", id: mapId, annotation: drawing });
      return drawing;
    },
    erase(mapId, at, radius) {
      const target = scene(mapId);
      if (!target) return 0;
      const hits = target.annotations.filter(
        (a): a is DrawingAnnotation => a.kind === "drawing" && drawingWithin(a, at, radius)
      );
      if (hits.length === 0) return 0;
      store
        .getState()
        .dispatch(
          ...hits.map((a) => ({ kind: "map/annotation-remove" as const, id: mapId, annotationId: a.id }))
        );
      return hits.length;
    },
    clearDrawings(mapId) {
      if (!scene(mapId)) return;
      store.getState().dispatch({ kind: "map/annotations-clear", id: mapId, annotationKind: "drawing" });
    },
    remove(mapId, annotationId) {
      if (!findAnnotation(scene(mapId), annotationId)) return;
      store.getState().dispatch({ kind: "map/annotation-remove", id: mapId, annotationId });
    },
    ping(mapId, at) {
      if (!scene(mapId)) return undefined;
      const value = createPing({ mapId, x: at.x, y: at.y, id: newId(), now: now() });
      store.getState().sendPing(value);
      return value;
    },
  };
}

/** The notes of a scene, for the DM panel's list. */
export function sceneNotes(scene: Pick<MapScene, "annotations"> | undefined): NoteAnnotation[] {
  return scene ? notesOf(scene.annotations) : [];
}
