/**
 * Undo / redo log semantics (T008): undo pops the map's log through a shared
 * op, redo re-appends what was popped, new ops discard redo, and the depth
 * the spec asks for is there.
 */
import { fogFill, fogShape, type FogOp } from "./fog";
import { createFogHistory } from "./fogHistory";
import { createBlankMapScene, findMap } from "./maps";
import type { SharedOp } from "./shared";
import { createTableStore, type TableStore } from "./store";

const rect = (x: number, mode: "reveal" | "hide" = "reveal"): FogOp =>
  fogShape(mode, { kind: "rect", x, y: 0, width: 1, height: 1 });

let store: TableStore;
const log = (id = "m") => findMap(store.getState().shared, id)!.fogOps;
const push = (op: FogOp, id = "m") => store.getState().dispatch({ kind: "map/fog-op", id, op });

beforeEach(() => {
  store = createTableStore();
  store.getState().dispatch(
    { kind: "map/add", map: createBlankMapScene({ id: "m", columns: 2, rows: 2 }) },
    { kind: "map/add", map: createBlankMapScene({ id: "n", columns: 2, rows: 2 }) },
    { kind: "map/set-active", id: "m" }
  );
});

describe("fog history", () => {
  it("undo drops the last op via map/fog-undo; redo re-appends it via map/fog-op", () => {
    const history = createFogHistory(store);
    history.start();
    const sent: SharedOp[] = [];
    store.onOps((ops) => sent.push(...ops));
    push(rect(1));
    push(rect(2));
    expect(history.canUndo("m")).toBe(true);
    expect(history.canRedo("m")).toBe(false);

    expect(history.undo("m")).toBe(true);
    expect(log()).toEqual([rect(1)]);
    expect(history.canRedo("m")).toBe(true);
    expect(history.redoDepth("m")).toBe(1);
    expect(sent.at(-1)).toEqual({ kind: "map/fog-undo", id: "m" });

    expect(history.redo("m")).toBe(true);
    expect(log()).toEqual([rect(1), rect(2)]);
    expect(history.canRedo("m")).toBe(false);
    expect(sent.at(-1)).toEqual({ kind: "map/fog-op", id: "m", op: rect(2) });
    // Both were ordinary sequenced ops.
    expect(store.getState().seq).toBe(5);
  });

  it("undo on an empty log, redo with nothing undone, and unknown maps are no-ops", () => {
    const history = createFogHistory(store);
    const seq = store.getState().seq;
    expect(history.undo("m")).toBe(false);
    expect(history.redo("m")).toBe(false);
    expect(history.undo("nope")).toBe(false);
    expect(history.canUndo("nope")).toBe(false);
    expect(store.getState().seq).toBe(seq);
  });

  it("a new fog op discards the redo stack; a redone op does not", () => {
    const history = createFogHistory(store);
    history.start();
    const changes = vi.fn();
    history.subscribe(changes);
    push(rect(1));
    push(rect(2));
    history.undo("m");
    history.undo("m");
    expect(history.redoDepth("m")).toBe(2);
    history.redo("m");
    expect(history.redoDepth("m")).toBe(1);
    push(fogFill("hide"));
    expect(history.redoDepth("m")).toBe(0);
    expect(history.canRedo("m")).toBe(false);
    expect(log()).toEqual([rect(1), fogFill("hide")]);
    expect(changes).toHaveBeenCalled();
  });

  it("redo stacks are per map and survive a compaction; removing the map or replacing the campaign drops them", () => {
    const history = createFogHistory(store);
    history.start();
    push(rect(1));
    push(rect(2), "n");
    history.undo("m");
    history.undo("n");
    expect(history.redoDepth("m")).toBe(1);
    expect(history.redoDepth("n")).toBe(1);

    push(rect(3), "n"); // only n's stack goes
    expect(history.redoDepth("m")).toBe(1);
    expect(history.redoDepth("n")).toBe(0);

    push(rect(4));
    history.undo("m");
    store.getState().dispatch({ kind: "map/fog-compact", id: "m", baseAssetId: "png", opCount: 0 });
    expect(history.redoDepth("m")).toBe(1);
    history.redo("m");
    expect(log()).toEqual([rect(4)]);

    history.undo("m");
    store.getState().dispatch({ kind: "map/remove", id: "m" });
    expect(history.redoDepth("m")).toBe(0);

    history.undo("n");
    expect(history.redoDepth("n")).toBe(1);
    store.getState().closeCampaign();
    expect(history.redoDepth("n")).toBe(0);
  });

  it("at least 20 steps undo and redo consistently (log contents restored exactly)", () => {
    const history = createFogHistory(store);
    history.start();
    const ops: FogOp[] = [];
    for (let i = 0; i < 25; i++) {
      const op = i % 5 === 4 ? fogFill(i % 2 ? "hide" : "reveal") : rect(i, i % 3 ? "reveal" : "hide");
      ops.push(op);
      push(op);
    }
    const before = log();
    for (let i = 0; i < 20; i++) expect(history.undo("m")).toBe(true);
    expect(log()).toEqual(ops.slice(0, 5));
    expect(history.redoDepth("m")).toBe(20);
    for (let i = 0; i < 20; i++) expect(history.redo("m")).toBe(true);
    expect(log()).toEqual(before);
    expect(history.redoDepth("m")).toBe(0);
    expect(history.redo("m")).toBe(false);
  });

  it("caps the redo stack, dropping the entries undone longest ago", () => {
    const history = createFogHistory(store, { maxRedo: 3 });
    for (let i = 0; i < 5; i++) push(rect(i));
    for (let i = 0; i < 5; i++) history.undo("m");
    expect(history.redoDepth("m")).toBe(3);
    // rect(4) and rect(3) were undone first and fell off; the rest come back in order.
    history.redo("m");
    history.redo("m");
    history.redo("m");
    expect(log()).toEqual([rect(0), rect(1), rect(2)]);
    expect(history.canRedo("m")).toBe(false);
  });

  it("redo goes through the injected apply and stop() detaches the store listener", () => {
    const apply = vi.fn((mapId: string, op: FogOp) =>
      store.getState().dispatch({ kind: "map/fog-op", id: mapId, op })
    );
    const history = createFogHistory(store, { apply });
    const stop = history.start();
    push(rect(1));
    history.undo("m");
    history.redo("m");
    expect(apply).toHaveBeenCalledWith("m", rect(1));
    expect(log()).toEqual([rect(1)]);

    history.undo("m");
    stop();
    push(rect(7)); // unobserved: the stack is not discarded
    expect(history.redoDepth("m")).toBe(1);
  });
});
