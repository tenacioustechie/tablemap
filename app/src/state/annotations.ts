/**
 * Annotations (T011, ADR 0016): DM-only pinned notes and freehand drawings
 * with a per-drawing visibility. Pure and shared by both windows.
 *
 * The visibility rules live here, in one place:
 * - a **note** is never visible to the players, whatever else it says;
 * - a **drawing** is visible to the players only with `visibility: "all"`;
 * - the DM sees everything.
 *
 * `isAnnotationVisibleIn(annotation, view)` is what a renderer asks. On top
 * of that, DM-only annotations never even reach the player window: the DM's
 * sync publisher runs every snapshot through `sharedStateForPlayer` and
 * every delta through `opsForPlayer` before posting, so the player's mirror
 * holds nothing it may not draw. The persisted document keeps them (they
 * are part of the map), which is why they are in `SharedState` at all.
 */
import type { Annotation, AnnotationVisibility, GridView, MapScene } from "./model";
import type { SharedOp, SharedState } from "./shared";
import { wallForPlayer } from "./walls";

export type AnnotationKind = Annotation["kind"];

export type NoteAnnotation = Extract<Annotation, { kind: "note" }>;
export type DrawingAnnotation = Extract<Annotation, { kind: "drawing" }>;

export const ANNOTATION_KINDS: readonly AnnotationKind[] = ["note", "drawing"];

export const ANNOTATION_VISIBILITIES: readonly AnnotationVisibility[] = ["dm", "all"];

export function isAnnotationKind(x: unknown): x is AnnotationKind {
  return (ANNOTATION_KINDS as readonly unknown[]).includes(x);
}

export function isAnnotationVisibility(x: unknown): x is AnnotationVisibility {
  return (ANNOTATION_VISIBILITIES as readonly unknown[]).includes(x);
}

// ---- visibility rules ------------------------------------------------------

/** Whether the given view may draw the annotation. The DM sees everything. */
export function isAnnotationVisibleIn(annotation: Annotation, view: GridView): boolean {
  if (view === "dm") return true;
  // Notes are DM-only by definition; their `visibility` field is the literal
  // "dm", but the kind alone decides so a malformed value cannot leak one.
  if (annotation.kind === "note") return false;
  return annotation.visibility === "all";
}

/** Shorthand: may the players see it? */
export function isAnnotationForPlayer(annotation: Annotation): boolean {
  return isAnnotationVisibleIn(annotation, "player");
}

export function annotationsForView(
  annotations: readonly Annotation[],
  view: GridView
): Annotation[] {
  return annotations.filter((a) => isAnnotationVisibleIn(a, view));
}

/** The drawings the view draws (notes are never drawn by the stage). */
export function drawingsForView(
  annotations: readonly Annotation[],
  view: GridView
): DrawingAnnotation[] {
  return annotations.filter(
    (a): a is DrawingAnnotation => a.kind === "drawing" && isAnnotationVisibleIn(a, view)
  );
}

export function notesOf(annotations: readonly Annotation[]): NoteAnnotation[] {
  return annotations.filter((a): a is NoteAnnotation => a.kind === "note");
}

// ---- what crosses the wire --------------------------------------------------

/**
 * The scene as the player may know it: DM-only annotations removed and door
 * names stripped (ADR 0030). Same object when nothing is removed.
 */
export function sceneForPlayer(scene: MapScene): MapScene {
  const annotationsOk = scene.annotations.every(isAnnotationForPlayer);
  const walls = scene.walls.map(wallForPlayer);
  const wallsOk = walls.every((w, i) => w === scene.walls[i]);
  if (annotationsOk && wallsOk) return scene;
  return {
    ...scene,
    annotations: annotationsOk ? scene.annotations : scene.annotations.filter(isAnnotationForPlayer),
    walls: wallsOk ? scene.walls : walls,
  };
}

/** The shared state as the player may know it. Same object when nothing is removed. */
export function sharedStateForPlayer(state: SharedState): SharedState {
  const maps = state.maps.map(sceneForPlayer);
  if (maps.every((m, i) => m === state.maps[i])) return state;
  return { ...state, maps };
}

/**
 * One op as the player may receive it. An op that would give the player a
 * DM-only annotation is turned into the removal of that id (harmless if the
 * player never had it; correct if the annotation just stopped being shared).
 * Ops carrying whole scenes or states are filtered. Everything else passes
 * through unchanged (same object).
 */
export function opForPlayer(op: SharedOp): SharedOp {
  switch (op.kind) {
    case "campaign/replace": {
      const state = sharedStateForPlayer(op.state);
      return state === op.state ? op : { ...op, state };
    }
    case "map/add": {
      const map = sceneForPlayer(op.map);
      return map === op.map ? op : { ...op, map };
    }
    case "map/annotation-set":
      return isAnnotationForPlayer(op.annotation)
        ? op
        : { kind: "map/annotation-remove", id: op.id, annotationId: op.annotation.id };
    case "map/wall-set": {
      const segment = wallForPlayer(op.segment);
      return segment === op.segment ? op : { ...op, segment };
    }
    default:
      return op;
  }
}

export function opsForPlayer(ops: readonly SharedOp[]): SharedOp[] {
  return ops.map(opForPlayer);
}

// ---- construction --------------------------------------------------------------

export interface NewNote {
  id: string;
  /** Map pixels. */
  x: number;
  y: number;
  text?: string;
}

export function createNote({ id, x, y, text = "" }: NewNote): NoteAnnotation {
  return { id, kind: "note", x, y, text, visibility: "dm" };
}

export interface NewDrawing {
  id: string;
  /** Flat [x0, y0, x1, y1, ...] in map pixels; at least one point. */
  points: readonly number[];
  color: string;
  /** Map pixels. */
  strokeWidth: number;
  visibility: AnnotationVisibility;
}

export function createDrawing({
  id,
  points,
  color,
  strokeWidth,
  visibility,
}: NewDrawing): DrawingAnnotation {
  return { id, kind: "drawing", points: [...points], color, strokeWidth, visibility };
}

export function cloneAnnotation(annotation: Annotation): Annotation {
  return annotation.kind === "drawing"
    ? { ...annotation, points: [...annotation.points] }
    : { ...annotation };
}

export function annotationEqual(a: Annotation, b: Annotation): boolean {
  if (a.kind !== b.kind || a.id !== b.id || a.visibility !== b.visibility) return false;
  if (a.kind === "note" && b.kind === "note") {
    return a.x === b.x && a.y === b.y && a.text === b.text;
  }
  if (a.kind === "drawing" && b.kind === "drawing") {
    return (
      a.color === b.color &&
      a.strokeWidth === b.strokeWidth &&
      a.points.length === b.points.length &&
      a.points.every((p, i) => p === b.points[i])
    );
  }
  return false;
}

export function findAnnotation(
  scene: Pick<MapScene, "annotations"> | undefined,
  id: string
): Annotation | undefined {
  return scene?.annotations.find((a) => a.id === id);
}
