import {
  createMirrorStore,
  initialMirrorState,
  reduceMirror,
  type MirrorState,
} from "./mirror";
import { applyOps, initialSharedState, type SharedOp } from "./shared";
import { createTableStore } from "./store";
import { delta, hello, snapshot, type DeltaMessage, type SyncMessage } from "./sync";

const setName = (name: string): SharedOp => ({ kind: "campaign/set-name", name });

function applyAll(start: MirrorState, messages: SyncMessage[]) {
  let state = start;
  const resyncs: number[] = [];
  messages.forEach((m, i) => {
    const step = reduceMirror(state, m);
    state = step.state;
    if (step.resync) resyncs.push(i);
  });
  return { state, resyncs };
}

describe("mirror reducer", () => {
  it("starts connecting with no state", () => {
    expect(initialMirrorState()).toEqual({
      status: "connecting",
      seq: 0,
      shared: null,
    });
    expect(createMirrorStore().getState()).toEqual(initialMirrorState());
  });

  it("a snapshot replaces everything and marks the mirror synced", () => {
    const { state, resyncs } = applyAll(initialMirrorState(), [
      snapshot(5, { campaignName: "Strahd" }),
    ]);
    expect(state).toEqual({
      status: "synced",
      seq: 5,
      shared: { campaignName: "Strahd" },
    });
    expect(resyncs).toEqual([]);
  });

  it("applying a snapshot then contiguous deltas equals applying the final snapshot", () => {
    // Drive a real DM store and capture the deltas it would broadcast.
    const dm = createTableStore();
    const deltas: DeltaMessage[] = [];
    dm.onOps((ops, seq) => deltas.push(delta(seq, ops)));

    const start = snapshot(dm.getState().seq, dm.getState().shared);
    dm.getState().dispatch(setName("A"));
    dm.getState().dispatch(setName("AB"), setName("ABC"));
    dm.getState().dispatch(setName("Final"));
    const end = snapshot(dm.getState().seq, dm.getState().shared);
    expect(deltas).toHaveLength(3);

    const viaDeltas = applyAll(initialMirrorState(), [start, ...deltas]);
    const viaSnapshot = applyAll(initialMirrorState(), [end]);
    expect(viaDeltas.resyncs).toEqual([]);
    expect(viaDeltas.state).toEqual(viaSnapshot.state);
    expect(viaDeltas.state.shared).toEqual(
      applyOps(
        initialSharedState(),
        deltas.flatMap((d) => d.ops)
      )
    );
  });

  it("ignores duplicate or stale deltas", () => {
    const synced = applyAll(initialMirrorState(), [
      snapshot(3, { campaignName: "x" }),
    ]).state;
    for (const seq of [3, 2, 0]) {
      const step = reduceMirror(synced, delta(seq, [setName("stale")]));
      expect(step.state).toBe(synced);
      expect(step.resync).toBe(false);
    }
  });

  it("requests a resync on a gap, keeping the last good state", () => {
    const synced = applyAll(initialMirrorState(), [
      snapshot(3, { campaignName: "x" }),
    ]).state;
    const step = reduceMirror(synced, delta(5, [setName("skipped")]));
    expect(step.state).toBe(synced);
    expect(step.resync).toBe(true);
  });

  it("requests a resync when a delta arrives before any snapshot", () => {
    const step = reduceMirror(initialMirrorState(), delta(1, [setName("a")]));
    expect(step.state).toEqual(initialMirrorState());
    expect(step.resync).toBe(true);
  });

  it("accepts a snapshot with a lower seq (DM restarted)", () => {
    const synced = applyAll(initialMirrorState(), [
      snapshot(9, { campaignName: "old" }),
    ]).state;
    const step = reduceMirror(synced, snapshot(0, { campaignName: "new" }));
    expect(step.state).toEqual({
      status: "synced",
      seq: 0,
      shared: { campaignName: "new" },
    });
  });

  it("hello messages are inert", () => {
    const start = initialMirrorState();
    for (const role of ["dm", "player"] as const) {
      const step = reduceMirror(start, hello(role, "id"));
      expect(step).toEqual({ state: start, resync: false });
    }
  });
});
