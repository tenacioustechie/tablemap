// @vitest-environment node
//
// Node rather than jsdom: compaction stores PNG Blobs in IndexedDB and
// jsdom's Blob is not structured-cloneable by fake-indexeddb.
import { nanoid } from "nanoid";
import type { FogSource } from "../map/fogMask";
import { TableMapDb } from "./db";
import { fogFill, fogShape, type FogOp } from "./fog";
import { createFogActions, FOG_COMPACT_AT, FOG_KEEP_OPS } from "./fogActions";
import { createBlankMapScene, findMap } from "./maps";
import { createCampaign, getAsset, listAssetIds } from "./persistence";
import { createTableStore, type TableStore } from "./store";

let db: TableMapDb;
let store: TableStore;

beforeEach(async () => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
  store = createTableStore();
  store.getState().openCampaign(await createCampaign(db, "C", { id: "camp" }));
  const map = createBlankMapScene({ id: "m", columns: 4, rows: 4, cellSize: 10 });
  store.getState().dispatch({ kind: "map/add", map }, { kind: "map/set-active", id: "m" });
});

afterEach(async () => {
  await db.delete();
});

const rect = (x: number): FogOp =>
  fogShape("reveal", { kind: "rect", x, y: 0, width: 5, height: 5 });
const scene = () => findMap(store.getState().shared, "m")!;

interface BakeCall {
  scene: FogSource;
  base: Blob | null;
  opCount: number;
}

/** A baker that records its calls and returns a fake PNG naming the prefix. */
function recordingBake() {
  const calls: BakeCall[] = [];
  const bake = async (source: FogSource, base: Blob | null, opCount: number) => {
    calls.push({ scene: source, base, opCount });
    const baseText = base ? await base.text() : "black";
    return new Blob([`${baseText}+${opCount}`], { type: "image/png" });
  };
  return { bake, calls };
}

describe("fog actions", () => {
  it("reveal / hide / revealAll / hideAll each dispatch one map/fog-op", () => {
    const actions = createFogActions(store, db, { bake: recordingBake().bake });
    actions.reveal("m", { kind: "rect", x: 1, y: 2, width: 3, height: 4 });
    actions.hide("m", { kind: "circle", x: 1, y: 2, radius: 3 });
    actions.revealAll("m");
    actions.hideAll("m");
    expect(scene().fogOps).toEqual([
      { type: "shape", mode: "reveal", shape: { kind: "rect", x: 1, y: 2, width: 3, height: 4 } },
      { type: "shape", mode: "hide", shape: { kind: "circle", x: 1, y: 2, radius: 3 } },
      fogFill("reveal"),
      fogFill("hide"),
    ]);
    expect(store.getState().seq).toBe(6); // open, add+activate, then four fog ops
    expect(scene().fogMaskAssetId).toBeNull();
  });

  it("apply appends several ops in one dispatch, and nothing for no ops or an unknown map (T106)", () => {
    const actions = createFogActions(store, db, { bake: recordingBake().bake });
    const seq = store.getState().seq;
    actions.apply("m", rect(1), rect(2));
    expect(scene().fogOps).toEqual([rect(1), rect(2)]);
    expect(store.getState().seq).toBe(seq + 1);
    actions.apply("m");
    actions.apply("nope", rect(3));
    expect(store.getState().seq).toBe(seq + 1);
  });

  it("defaults leave room for undo: at least 20 ops survive a compaction", () => {
    expect(FOG_KEEP_OPS).toBeGreaterThanOrEqual(20);
    expect(FOG_COMPACT_AT).toBeGreaterThan(FOG_KEEP_OPS);
  });

  it("compacts the log into a fog-mask PNG once it reaches the threshold", async () => {
    const { bake, calls } = recordingBake();
    const actions = createFogActions(store, db, { bake, compactAt: 5, keepOps: 2 });
    for (let x = 0; x < 4; x++) actions.apply("m", rect(x));
    await actions.idle();
    expect(calls).toHaveLength(0);
    expect(scene().fogOps).toHaveLength(4);

    const before = scene().fogOps;
    actions.apply("m", rect(4));
    await actions.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0].base).toBeNull();
    expect(calls[0].opCount).toBe(3);
    expect(calls[0].scene.fogOps).toHaveLength(5);

    const after = scene();
    expect(after.fogOps).toEqual([rect(3), rect(4)]);
    expect(after.fogOps[0]).toBe(before[3]);
    expect(after.fogOpsFrom).toBe(3);
    expect(after.fogMaskAssetId).not.toBeNull();
    const asset = await getAsset(db, after.fogMaskAssetId!);
    expect(asset).toMatchObject({ campaignId: "camp", kind: "fog-mask" });
    expect(asset!.blob.type).toBe("image/png");
    expect(await asset!.blob.text()).toBe("black+3");
    expect(await listAssetIds(db, "camp")).toEqual([after.fogMaskAssetId]);
  });

  it("a second compaction bakes on top of the previous PNG and deletes it", async () => {
    const { bake, calls } = recordingBake();
    const actions = createFogActions(store, db, { bake, compactAt: 4, keepOps: 1 });
    for (let x = 0; x < 4; x++) actions.apply("m", rect(x));
    await actions.idle();
    const first = scene().fogMaskAssetId!;
    expect(scene()).toMatchObject({ fogOps: [rect(3)], fogOpsFrom: 3 });

    for (let x = 4; x < 7; x++) actions.apply("m", rect(x));
    await actions.idle();
    expect(calls).toHaveLength(2);
    expect(await calls[1].base!.text()).toBe("black+3");
    expect(calls[1].opCount).toBe(3);
    const second = scene();
    expect(second.fogMaskAssetId).not.toBe(first);
    expect(second).toMatchObject({ fogOps: [rect(6)], fogOpsFrom: 6 });
    expect(await (await getAsset(db, second.fogMaskAssetId!))!.blob.text()).toBe("black+3+3");
    expect(await getAsset(db, first)).toBeUndefined();
    expect(await listAssetIds(db, "camp")).toEqual([second.fogMaskAssetId]);
  });

  it("keeps the previous PNG when a duplicate map still uses it", async () => {
    const { bake } = recordingBake();
    const actions = createFogActions(store, db, { bake, compactAt: 3, keepOps: 1 });
    for (let x = 0; x < 3; x++) actions.apply("m", rect(x));
    await actions.idle();
    const first = scene().fogMaskAssetId!;
    // Another map referencing the same base (what a duplicate would do if it shared it).
    const twin = { ...createBlankMapScene({ id: "twin", columns: 1, rows: 1 }), fogMaskAssetId: first };
    store.getState().dispatch({ kind: "map/add", map: twin });

    for (let x = 3; x < 5; x++) actions.apply("m", rect(x));
    await actions.idle();
    expect(scene().fogMaskAssetId).not.toBe(first);
    expect(await getAsset(db, first)).toBeDefined();
  });

  it("aborts (and stores nothing) when the log changed underneath the bake", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const bake = async () => {
      await gate;
      return new Blob(["png"], { type: "image/png" });
    };
    const actions = createFogActions(store, db, { bake, compactAt: 3, keepOps: 1 });
    for (let x = 0; x < 3; x++) actions.apply("m", rect(x));
    // Compaction is now waiting on the bake; rewrite history meanwhile.
    store.getState().dispatch({ kind: "map/fog-compact", id: "m", baseAssetId: null, opCount: 1 });
    release!();
    await actions.idle();
    expect(scene()).toMatchObject({ fogMaskAssetId: null, fogOps: [rect(1), rect(2)], fogOpsFrom: 1 });
    expect(await listAssetIds(db, "camp")).toEqual([]);
  });

  it("ops arriving during a bake are kept, and a still-long log is compacted again", async () => {
    let release: (() => void) | undefined;
    let bakes = 0;
    const bake = async (_s: FogSource, _b: Blob | null, opCount: number) => {
      bakes++;
      if (bakes === 1) await new Promise<void>((r) => (release = r));
      return new Blob([`bake${bakes}:${opCount}`], { type: "image/png" });
    };
    const actions = createFogActions(store, db, { bake, compactAt: 4, keepOps: 1 });
    for (let x = 0; x < 4; x++) actions.apply("m", rect(x));
    await vi.waitFor(() => expect(release).toBeDefined());
    // Four more ops while the first bake is in flight.
    for (let x = 4; x < 8; x++) actions.apply("m", rect(x));
    expect(scene().fogOps).toHaveLength(8);
    release!();
    await actions.idle();
    // First compaction dropped 3 (of the original 4); the remaining 5 were
    // over the line again, so a second one ran and dropped 4 more.
    expect(bakes).toBe(2);
    expect(scene()).toMatchObject({ fogOps: [rect(7)], fogOpsFrom: 7 });
    expect(await (await getAsset(db, scene().fogMaskAssetId!))!.blob.text()).toBe("bake2:4");
  });

  it("reports a failed bake and leaves the log alone", async () => {
    const onError = vi.fn();
    const actions = createFogActions(store, db, {
      bake: async () => {
        throw new Error("no canvas");
      },
      compactAt: 2,
      keepOps: 1,
      onError,
    });
    actions.apply("m", rect(0));
    actions.apply("m", rect(1));
    await actions.idle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(scene().fogOps).toHaveLength(2);
    expect(scene().fogMaskAssetId).toBeNull();
    // The next op tries again.
    actions.apply("m", rect(2));
    await actions.idle();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("ignores unknown maps and does nothing without an open campaign", async () => {
    const { bake, calls } = recordingBake();
    const actions = createFogActions(store, db, { bake, compactAt: 1, keepOps: 0 });
    actions.revealAll("nope");
    expect(store.getState().seq).toBe(2); // open, add+activate: nothing dispatched
    store.getState().closeCampaign();
    actions.revealAll("m");
    await actions.idle();
    expect(calls).toHaveLength(0);
  });
});
