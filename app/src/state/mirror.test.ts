import { defaultPlayerPresentation } from "./calibration";
import {
  createMirrorStore,
  initialMirrorState,
  reduceMirror,
  type MirrorState,
} from "./mirror";
import { defaultGridSettings, type MapScene } from "./model";
import { applyOps, initialSharedState, type SharedOp } from "./shared";
import { createTableStore } from "./store";
import {
  asset,
  delta,
  hello,
  presentation,
  snapshot,
  type DeltaMessage,
  type SyncMessage,
} from "./sync";

const setName = (name: string): SharedOp => ({ kind: "campaign/set-name", name });
const named = (campaignName: string) => ({ ...initialSharedState(), campaignName });
const noPresentation = () => defaultPlayerPresentation();

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
      assets: {},
      presentation: noPresentation(),
    });
    expect(createMirrorStore().getState()).toEqual(initialMirrorState());
  });

  it("a snapshot replaces everything and marks the mirror synced", () => {
    const { state, resyncs } = applyAll(initialMirrorState(), [
      snapshot(5, named("Strahd")),
    ]);
    expect(state).toEqual({
      status: "synced",
      seq: 5,
      shared: named("Strahd"),
      assets: {},
      presentation: noPresentation(),
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
      snapshot(3, named("x")),
    ]).state;
    for (const seq of [3, 2, 0]) {
      const step = reduceMirror(synced, delta(seq, [setName("stale")]));
      expect(step.state).toBe(synced);
      expect(step.resync).toBe(false);
    }
  });

  it("requests a resync on a gap, keeping the last good state", () => {
    const synced = applyAll(initialMirrorState(), [
      snapshot(3, named("x")),
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
      snapshot(9, named("old")),
    ]).state;
    const step = reduceMirror(synced, snapshot(0, named("new")));
    expect(step.state).toEqual({
      status: "synced",
      seq: 0,
      shared: named("new"),
      assets: {},
      presentation: noPresentation(),
    });
  });

  it("a player hello is inert; a DM hello asks the player to re-announce itself", () => {
    const start = initialMirrorState();
    expect(reduceMirror(start, hello("player", "id"))).toEqual({ state: start, resync: false });
    expect(reduceMirror(start, hello("dm", "id"))).toEqual({ state: start, resync: true });
  });
});

describe("mirror presentation (T006)", () => {
  const calibrated = { pxPerInch: 40, cellUnit: "inch" as const, overview: false, target: null };

  it("replaces the presentation without touching seq, status, state or assets", () => {
    const start = applyAll(initialMirrorState(), [snapshot(3, named("x"))]).state;
    const step = reduceMirror(start, presentation(calibrated));
    expect(step.resync).toBe(false);
    expect(step.state.presentation).toEqual(calibrated);
    expect(step.state.presentation).not.toBe(calibrated);
    expect(step.state).toMatchObject({ status: "synced", seq: 3, shared: named("x"), assets: {} });
  });

  it("is accepted before any snapshot and survives snapshots and deltas", () => {
    let state = reduceMirror(initialMirrorState(), presentation(calibrated)).state;
    expect(state.status).toBe("connecting");
    expect(state.presentation).toEqual(calibrated);
    state = reduceMirror(state, snapshot(1, named("a"))).state;
    expect(state.presentation).toEqual(calibrated);
    state = reduceMirror(state, delta(2, [setName("b")])).state;
    expect(state.presentation).toEqual(calibrated);
  });

  it("returns the same state for an identical presentation", () => {
    const start = reduceMirror(initialMirrorState(), presentation(calibrated)).state;
    expect(reduceMirror(start, presentation({ ...calibrated })).state).toBe(start);
  });
});

describe("mirror assets", () => {
  const scene = (id: string, imageAssetId: string | null): MapScene => ({
    id,
    name: id,
    imageAssetId,
    backgroundColor: "#000",
    width: 10,
    height: 10,
    grid: defaultGridSettings(),
    fogMaskAssetId: null,
    tokens: [],
    annotations: [],
  });
  const withMaps = (...maps: MapScene[]) => ({
    ...initialSharedState(),
    maps,
    activeMapId: maps[0]?.id ?? null,
  });
  const png = asset("img-a", "map-image", "image/png", "iVBORw0KGgo=");

  it("stores a decoded Blob per asset id, without touching seq or status", () => {
    const start = applyAll(initialMirrorState(), [snapshot(2, withMaps(scene("m", "img-a")))]).state;
    const step = reduceMirror(start, png);
    expect(step.resync).toBe(false);
    expect(step.state.seq).toBe(2);
    expect(step.state.status).toBe("synced");
    expect(step.state.shared).toBe(start.shared);
    const blob = step.state.assets["img-a"];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(8);
  });

  it("accepts assets before any snapshot (they are unsequenced)", () => {
    const step = reduceMirror(initialMirrorState(), png);
    expect(step.resync).toBe(false);
    expect(step.state.status).toBe("connecting");
    expect(Object.keys(step.state.assets)).toEqual(["img-a"]);
  });

  it("a later message for the same id replaces the Blob", () => {
    const first = reduceMirror(initialMirrorState(), png).state;
    const second = reduceMirror(first, asset("img-a", "map-image", "image/webp", "AAAA")).state;
    expect(second.assets["img-a"].type).toBe("image/webp");
    expect(Object.keys(second.assets)).toEqual(["img-a"]);
  });

  it("ignores undecodable asset data", () => {
    const start = reduceMirror(initialMirrorState(), png).state;
    const step = reduceMirror(start, asset("img-b", "map-image", "image/png", "*not base64*"));
    expect(step.state).toBe(start);
    expect(step.resync).toBe(false);
  });

  it("drops assets the shared state no longer references", () => {
    const a = scene("ma", "img-a");
    const b = scene("mb", "img-b");
    let state = applyAll(initialMirrorState(), [
      snapshot(1, withMaps(a, b)),
      png,
      asset("img-b", "map-image", "image/png", "AAAA"),
    ]).state;
    expect(Object.keys(state.assets).sort()).toEqual(["img-a", "img-b"]);

    state = reduceMirror(state, delta(2, [{ kind: "map/remove", id: "mb" }])).state;
    expect(Object.keys(state.assets)).toEqual(["img-a"]);

    state = reduceMirror(state, snapshot(9, initialSharedState())).state;
    expect(state.assets).toEqual({});
  });

  it("keeps the same assets object when nothing is pruned", () => {
    const a = scene("ma", "img-a");
    const start = applyAll(initialMirrorState(), [snapshot(1, withMaps(a)), png]).state;
    const step = reduceMirror(start, delta(2, [setName("x")]));
    expect(step.state.assets).toBe(start.assets);
  });
});
