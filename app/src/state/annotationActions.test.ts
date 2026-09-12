/**
 * The DM's annotation actions over a real store (T011): notes, drawings,
 * the eraser's hit test, clear-layer, removal and pings.
 */
import { createAnnotationActions, drawingWithin, sceneNotes } from "./annotationActions";
import { createDrawing } from "./annotations";
import { createBlankMapScene } from "./maps";
import { initialSharedState } from "./shared";
import { createTableStore } from "./store";

function setup() {
  const a = createBlankMapScene({ id: "a", columns: 10, rows: 8, cellSize: 50 });
  const b = createBlankMapScene({ id: "b", columns: 4, rows: 4, cellSize: 50 });
  const store = createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId: "a" });
  let n = 0;
  const actions = createAnnotationActions(store, { newId: () => `id${++n}`, now: () => 1234 });
  const annotations = (mapId = "a") => store.getState().shared.maps.find((m) => m.id === mapId)!.annotations;
  return { store, actions, annotations };
}

describe("annotation actions (T011)", () => {
  it("addNote pins an empty DM-only note and updateNote moves or re-words it", () => {
    const { store, actions, annotations } = setup();
    const note = actions.addNote("a", { x: 120, y: 80 });
    expect(note).toEqual({ id: "id1", kind: "note", x: 120, y: 80, text: "", visibility: "dm" });
    expect(annotations()).toEqual([note]);
    expect(actions.addNote("zzz", { x: 0, y: 0 })).toBeUndefined();
    expect(store.getState().seq).toBe(1);

    actions.updateNote("a", "id1", { text: "Trap here" });
    expect(annotations()[0]).toMatchObject({ text: "Trap here", x: 120, y: 80 });
    actions.updateNote("a", "id1", { x: 130 });
    expect(annotations()[0]).toMatchObject({ text: "Trap here", x: 130, y: 80 });
    expect(store.getState().seq).toBe(3);
    // Nothing to change: nothing dispatched.
    actions.updateNote("a", "id1", { text: "Trap here" });
    actions.updateNote("a", "id1", {});
    actions.updateNote("a", "nope", { text: "x" });
    expect(store.getState().seq).toBe(3);
    expect(sceneNotes(store.getState().shared.maps[0]).map((n) => n.id)).toEqual(["id1"]);
    expect(sceneNotes(undefined)).toEqual([]);
  });

  it("addDrawing records a stroke with the given style and visibility; empty strokes are refused", () => {
    const { store, actions, annotations } = setup();
    const d = actions.addDrawing("a", { points: [1, 2, 3, 4], color: "#f00", strokeWidth: 6, visibility: "all" });
    expect(d).toEqual({ id: "id1", kind: "drawing", points: [1, 2, 3, 4], color: "#f00", strokeWidth: 6, visibility: "all" });
    const dot = actions.addDrawing("a", { points: [9, 9], color: "#0f0", strokeWidth: 2, visibility: "dm" });
    expect(dot?.points).toEqual([9, 9]);
    expect(annotations()).toHaveLength(2);
    expect(actions.addDrawing("a", { points: [], color: "#f00", strokeWidth: 6, visibility: "all" })).toBeUndefined();
    expect(actions.addDrawing("zzz", { points: [1, 2], color: "#f00", strokeWidth: 6, visibility: "all" })).toBeUndefined();
    expect(store.getState().seq).toBe(2);
  });

  it("drawingWithin measures against the stroke's segments plus half its width", () => {
    const line = createDrawing({ id: "l", points: [0, 0, 100, 0], color: "#fff", strokeWidth: 10, visibility: "all" });
    expect(drawingWithin(line, { x: 50, y: 4 }, 0)).toBe(true); // inside the stroke's own width
    expect(drawingWithin(line, { x: 50, y: 14 }, 10)).toBe(true); // within reach
    expect(drawingWithin(line, { x: 50, y: 16 }, 10)).toBe(false);
    expect(drawingWithin(line, { x: 120, y: 0 }, 10)).toBe(false); // 20 past the end, reach is 10 + 5
    expect(drawingWithin(line, { x: 114, y: 0 }, 10)).toBe(true);
    const dot = createDrawing({ id: "d", points: [10, 10], color: "#fff", strokeWidth: 4, visibility: "all" });
    expect(drawingWithin(dot, { x: 13, y: 10 }, 1)).toBe(true);
    expect(drawingWithin(dot, { x: 14, y: 10 }, 1)).toBe(false);
    const empty = createDrawing({ id: "e", points: [], color: "#fff", strokeWidth: 4, visibility: "all" });
    expect(drawingWithin(empty, { x: 0, y: 0 }, 100)).toBe(false);
  });

  it("erase removes every drawing under the eraser (whole strokes) in one dispatch and leaves notes alone", () => {
    const { store, actions, annotations } = setup();
    actions.addNote("a", { x: 50, y: 50 });
    actions.addDrawing("a", { points: [0, 50, 100, 50], color: "#f00", strokeWidth: 4, visibility: "all" });
    actions.addDrawing("a", { points: [50, 0, 50, 100], color: "#0f0", strokeWidth: 4, visibility: "dm" });
    actions.addDrawing("a", { points: [300, 300, 320, 320], color: "#00f", strokeWidth: 4, visibility: "all" });
    const seq = store.getState().seq;
    expect(actions.erase("a", { x: 50, y: 50 }, 5)).toBe(2);
    expect(store.getState().seq).toBe(seq + 1);
    expect(annotations().map((a) => a.id)).toEqual(["id1", "id4"]);
    expect(actions.erase("a", { x: 0, y: 0 }, 5)).toBe(0);
    expect(actions.erase("zzz", { x: 0, y: 0 }, 5)).toBe(0);
    expect(store.getState().seq).toBe(seq + 1);
  });

  it("clearDrawings removes all drawings of the map, both visibilities, and keeps notes and other maps", () => {
    const { store, actions, annotations } = setup();
    actions.addNote("a", { x: 1, y: 1 });
    actions.addDrawing("a", { points: [0, 0, 1, 1], color: "#f00", strokeWidth: 4, visibility: "all" });
    actions.addDrawing("a", { points: [0, 0, 1, 1], color: "#f00", strokeWidth: 4, visibility: "dm" });
    actions.addDrawing("b", { points: [0, 0, 1, 1], color: "#f00", strokeWidth: 4, visibility: "all" });
    actions.clearDrawings("a");
    expect(annotations().map((a) => a.kind)).toEqual(["note"]);
    expect(annotations("b")).toHaveLength(1);
    const seq = store.getState().seq;
    actions.clearDrawings("a"); // nothing left: the reducer keeps the state, seq still advances once per dispatch
    actions.clearDrawings("zzz");
    expect(store.getState().seq).toBe(seq + 1);
  });

  it("remove drops one annotation of any kind; unknown ids dispatch nothing", () => {
    const { store, actions, annotations } = setup();
    actions.addNote("a", { x: 1, y: 1 });
    actions.addDrawing("a", { points: [0, 0, 1, 1], color: "#f00", strokeWidth: 4, visibility: "all" });
    actions.remove("a", "id1");
    expect(annotations().map((a) => a.id)).toEqual(["id2"]);
    const seq = store.getState().seq;
    actions.remove("a", "id1");
    actions.remove("zzz", "id2");
    expect(store.getState().seq).toBe(seq);
    actions.remove("a", "id2");
    expect(annotations()).toEqual([]);
  });

  it("ping records a stamped ping on the store and notifies ping listeners, never touching shared state", () => {
    const { store, actions } = setup();
    const seen: unknown[] = [];
    store.onPing((p) => seen.push(p));
    const p = actions.ping("a", { x: 10, y: 20 });
    expect(p).toEqual({ id: "id1", mapId: "a", x: 10, y: 20, at: 1234 });
    expect(seen).toEqual([p]);
    expect(store.getState().pings).toEqual([p]);
    expect(store.getState().seq).toBe(0);
    expect(store.getState().shared.maps[0].annotations).toEqual([]);
    expect(actions.ping("zzz", { x: 0, y: 0 })).toBeUndefined();
    expect(seen).toHaveLength(1);
  });
});
