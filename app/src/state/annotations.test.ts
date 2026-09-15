/**
 * Annotation visibility rules (T011): who may see what, and what the DM's
 * publisher lets across the wire.
 */
import {
  annotationEqual,
  annotationsForView,
  cloneAnnotation,
  createDrawing,
  createNote,
  drawingsForView,
  findAnnotation,
  isAnnotationForPlayer,
  isAnnotationVisibleIn,
  notesOf,
  opForPlayer,
  opsForPlayer,
  sceneForPlayer,
  sharedStateForPlayer,
} from "./annotations";
import { createBlankMapScene } from "./maps";
import type { Annotation, MapScene } from "./model";
import { initialSharedState, type SharedOp, type SharedState } from "./shared";

const note = createNote({ id: "n1", x: 10, y: 20, text: "The lever opens the vault" });
const dmDrawing = createDrawing({ id: "d1", points: [0, 0, 10, 10], color: "#f00", strokeWidth: 3, visibility: "dm" });
const sharedDrawing = createDrawing({ id: "d2", points: [0, 0, 10, 10, 20, 0], color: "#0f0", strokeWidth: 5, visibility: "all" });
const all: Annotation[] = [note, dmDrawing, sharedDrawing];

const withAnnotations = (annotations: Annotation[], id = "m"): MapScene => ({
  ...createBlankMapScene({ id, columns: 4, rows: 4, cellSize: 10 }),
  annotations,
});

describe("annotation visibility rules", () => {
  it("the DM sees everything", () => {
    for (const a of all) expect(isAnnotationVisibleIn(a, "dm")).toBe(true);
    expect(annotationsForView(all, "dm")).toEqual(all);
    expect(drawingsForView(all, "dm")).toEqual([dmDrawing, sharedDrawing]);
  });

  it("the players never see a note, whatever its fields say", () => {
    expect(isAnnotationVisibleIn(note, "player")).toBe(false);
    // Even a note that somehow claims to be shared is a note: hidden.
    const forged = { ...note, visibility: "all" } as unknown as Annotation;
    expect(isAnnotationVisibleIn(forged, "player")).toBe(false);
    expect(isAnnotationForPlayer(forged)).toBe(false);
    expect(notesOf(all)).toEqual([note]);
  });

  it("the players see drawings marked for both views only", () => {
    expect(isAnnotationVisibleIn(dmDrawing, "player")).toBe(false);
    expect(isAnnotationVisibleIn(sharedDrawing, "player")).toBe(true);
    expect(annotationsForView(all, "player")).toEqual([sharedDrawing]);
    expect(drawingsForView(all, "player")).toEqual([sharedDrawing]);
  });
});

describe("what crosses the wire", () => {
  it("sceneForPlayer strips notes and DM-only drawings, and is the same object when there is nothing to strip", () => {
    const scene = withAnnotations(all);
    expect(sceneForPlayer(scene).annotations).toEqual([sharedDrawing]);
    const clean = withAnnotations([sharedDrawing]);
    expect(sceneForPlayer(clean)).toBe(clean);
    const empty = withAnnotations([]);
    expect(sceneForPlayer(empty)).toBe(empty);
  });

  it("sharedStateForPlayer filters every map and keeps untouched maps by identity", () => {
    const secret = withAnnotations(all, "a");
    const clean = withAnnotations([sharedDrawing], "b");
    const state: SharedState = { ...initialSharedState(), maps: [secret, clean], activeMapId: "a" };
    const filtered = sharedStateForPlayer(state);
    expect(filtered).not.toBe(state);
    expect(filtered.maps[0].annotations).toEqual([sharedDrawing]);
    expect(filtered.maps[1]).toBe(clean);
    expect(JSON.stringify(filtered)).not.toContain("lever");
    const cleanState: SharedState = { ...initialSharedState(), maps: [clean] };
    expect(sharedStateForPlayer(cleanState)).toBe(cleanState);
  });

  it("sharedStateForPlayer carries the campaign's splash choice untouched (T015)", () => {
    const state: SharedState = {
      ...initialSharedState(),
      maps: [withAnnotations(all, "a")],
      splashImageAssetId: "cover",
      splashTitleCard: true,
    };
    const filtered = sharedStateForPlayer(state);
    expect(filtered).not.toBe(state);
    expect(filtered).toMatchObject({ splashImageAssetId: "cover", splashTitleCard: true });
  });

  it("opForPlayer rewrites a DM-only annotation-set into a removal and filters replace/add", () => {
    const setNote: SharedOp = { kind: "map/annotation-set", id: "m", annotation: note };
    expect(opForPlayer(setNote)).toEqual({ kind: "map/annotation-remove", id: "m", annotationId: "n1" });
    const setDm: SharedOp = { kind: "map/annotation-set", id: "m", annotation: dmDrawing };
    expect(opForPlayer(setDm)).toEqual({ kind: "map/annotation-remove", id: "m", annotationId: "d1" });
    const setShared: SharedOp = { kind: "map/annotation-set", id: "m", annotation: sharedDrawing };
    expect(opForPlayer(setShared)).toBe(setShared);

    const add: SharedOp = { kind: "map/add", map: withAnnotations(all) };
    const addFiltered = opForPlayer(add);
    expect(addFiltered.kind === "map/add" && addFiltered.map.annotations).toEqual([sharedDrawing]);
    const addClean: SharedOp = { kind: "map/add", map: withAnnotations([]) };
    expect(opForPlayer(addClean)).toBe(addClean);

    const replace: SharedOp = {
      kind: "campaign/replace",
      state: { ...initialSharedState(), maps: [withAnnotations(all)] },
    };
    const replaced = opForPlayer(replace);
    expect(replaced.kind === "campaign/replace" && replaced.state.maps[0].annotations).toEqual([
      sharedDrawing,
    ]);

    const other: SharedOp[] = [
      { kind: "campaign/set-name", name: "x" },
      { kind: "map/annotation-remove", id: "m", annotationId: "n1" },
      { kind: "map/annotations-clear", id: "m", annotationKind: "drawing" },
      { kind: "map/set-active", id: "m" },
      // Walls go to the player unfiltered (T101, ADR 0024).
      { kind: "map/wall-set", id: "m", segment: { id: "w", kind: "wall", x1: 0, y1: 0, x2: 1, y2: 1 } },
      { kind: "map/wall-set", id: "m", segment: { id: "d", kind: "door", x1: 0, y1: 0, x2: 1, y2: 1, open: false } },
      { kind: "map/wall-remove", id: "m", segmentId: "w" },
      { kind: "map/walls-clear", id: "m" },
      { kind: "map/door-set-open", id: "m", segmentId: "d", open: true }, // T103
    ];
    for (const op of other) expect(opForPlayer(op)).toBe(op);
    // A scene's walls survive the filter along with the shared drawings.
    const walled = { ...withAnnotations(all), walls: [{ id: "w", kind: "wall" as const, x1: 0, y1: 0, x2: 9, y2: 9 }] };
    const addWalled = opForPlayer({ kind: "map/add", map: walled });
    expect(addWalled.kind === "map/add" && addWalled.map.walls).toEqual(walled.walls);
    expect(opsForPlayer([setNote, ...other])).toEqual([opForPlayer(setNote), ...other]);
  });

  it("no note text survives opsForPlayer for any op that can carry one", () => {
    const ops: SharedOp[] = [
      { kind: "map/annotation-set", id: "m", annotation: note },
      { kind: "map/add", map: withAnnotations([note]) },
      { kind: "campaign/replace", state: { ...initialSharedState(), maps: [withAnnotations([note])] } },
    ];
    expect(JSON.stringify(opsForPlayer(ops))).not.toContain("lever");
  });
});

describe("construction and equality", () => {
  it("createNote / createDrawing build well-formed annotations and copy the points", () => {
    expect(note).toEqual({ id: "n1", kind: "note", x: 10, y: 20, text: "The lever opens the vault", visibility: "dm" });
    expect(createNote({ id: "n", x: 0, y: 0 }).text).toBe("");
    const points = [1, 2, 3, 4];
    const d = createDrawing({ id: "d", points, color: "#fff", strokeWidth: 2, visibility: "all" });
    expect(d.points).toEqual(points);
    expect(d.points).not.toBe(points);
  });

  it("cloneAnnotation is a deep copy; annotationEqual compares by value", () => {
    const copy = cloneAnnotation(sharedDrawing);
    expect(copy).toEqual(sharedDrawing);
    expect(copy).not.toBe(sharedDrawing);
    expect(copy.kind === "drawing" && copy.points).not.toBe(sharedDrawing.points);
    expect(annotationEqual(copy, sharedDrawing)).toBe(true);
    expect(annotationEqual(note, cloneAnnotation(note))).toBe(true);
    expect(annotationEqual(note, { ...note, text: "x" })).toBe(false);
    expect(annotationEqual(note, { ...note, x: 11 })).toBe(false);
    expect(annotationEqual(sharedDrawing, { ...sharedDrawing, visibility: "dm" })).toBe(false);
    expect(annotationEqual(sharedDrawing, { ...sharedDrawing, points: [0, 0, 10, 10, 20, 1] })).toBe(false);
    expect(annotationEqual(sharedDrawing, { ...sharedDrawing, points: [0, 0] })).toBe(false);
    expect(annotationEqual(note, dmDrawing)).toBe(false);
  });

  it("findAnnotation looks a scene's annotation up by id", () => {
    const scene = withAnnotations(all);
    expect(findAnnotation(scene, "d2")).toBe(scene.annotations[2]);
    expect(findAnnotation(scene, "zzz")).toBeUndefined();
    expect(findAnnotation(undefined, "n1")).toBeUndefined();
  });
});
