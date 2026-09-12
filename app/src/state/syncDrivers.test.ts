/**
 * DM publisher + player receiver wired through the in-memory hub. This is the
 * protocol end-to-end minus the browser.
 */
import { readBlobText } from "../test/blob";
import { startDmSync, type AssetSource } from "./dmSync";
import { createMirrorStore } from "./mirror";
import { defaultGridSettings, type MapScene } from "./model";
import { startPlayerSync } from "./playerSync";
import { initialSharedState, type SharedOp } from "./shared";
import { createTableStore } from "./store";
import {
  decodeMessage,
  encodeMessage,
  delta,
  PROTOCOL_VERSION,
  type AssetMessage,
} from "./sync";
import { createMemoryHub } from "./transport";

const setName = (name: string): SharedOp => ({ kind: "campaign/set-name", name });
const named = (campaignName: string) => ({ ...initialSharedState(), campaignName });

function decodedLog(hub: ReturnType<typeof createMemoryHub>) {
  return hub.log.map((entry) => {
    const r = decodeMessage(entry.raw);
    if (!r.ok) throw new Error(`undecodable message in log: ${entry.raw}`);
    return { from: entry.from, message: r.message };
  });
}

describe("DM sync publisher", () => {
  it("announces itself and broadcasts a snapshot on start", () => {
    const hub = createMemoryHub();
    const dm = createTableStore(named("Start"));
    startDmSync(dm, hub.connect(), { clientId: "dm-1" });
    expect(decodedLog(hub).map((e) => e.message)).toEqual([
      { type: "hello", v: PROTOCOL_VERSION, role: "dm", clientId: "dm-1" },
      { type: "snapshot", v: PROTOCOL_VERSION, seq: 0, state: named("Start") },
    ]);
  });

  it("broadcasts each dispatch as one delta carrying the protocol version", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    dm.getState().dispatch(setName("A"));
    dm.getState().dispatch(setName("B"), setName("C"));
    const deltas = decodedLog(hub)
      .map((e) => e.message)
      .filter((m) => m.type === "delta");
    expect(deltas).toEqual([
      delta(1, [setName("A")]),
      delta(2, [setName("B"), setName("C")]),
    ]);
  });

  it("answers a player hello with a snapshot, ignores everything else", () => {
    const hub = createMemoryHub();
    const dm = createTableStore(named("S"));
    startDmSync(dm, hub.connect());
    const probe = hub.connect();
    const before = hub.log.length;

    probe.post(encodeMessage({ type: "hello", v: PROTOCOL_VERSION, role: "player", clientId: "p" }));
    expect(hub.log.length).toBe(before + 2); // the hello + the snapshot reply
    const reply = decodeMessage(hub.log[hub.log.length - 1].raw);
    expect(reply).toEqual({
      ok: true,
      message: { type: "snapshot", v: PROTOCOL_VERSION, seq: 0, state: named("S") },
    });

    // Another DM's hello, garbage, and a forged delta produce no reply and no
    // state change: the DM store is only ever mutated by its own dispatch.
    const mid = hub.log.length;
    probe.post(encodeMessage({ type: "hello", v: PROTOCOL_VERSION, role: "dm", clientId: "d" }));
    probe.post("garbage");
    probe.post(encodeMessage(delta(1, [setName("hacked")])));
    expect(hub.log.length).toBe(mid + 3);
    expect(dm.getState().shared.campaignName).toBe("S");
    expect(dm.getState().seq).toBe(0);
  });

  it("stop() detaches from the store and the transport", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    const stop = startDmSync(dm, hub.connect());
    stop();
    const before = hub.log.length;
    dm.getState().dispatch(setName("after-stop"));
    hub.connect().post(encodeMessage({ type: "hello", v: PROTOCOL_VERSION, role: "player", clientId: "p" }));
    expect(hub.log.length).toBe(before + 1);
  });
});

describe("player sync receiver", () => {
  it("requests a snapshot on start and mirrors the DM afterwards", () => {
    const hub = createMemoryHub();
    const dm = createTableStore(named("Existing"));
    startDmSync(dm, hub.connect());

    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect(), { clientId: "p-1" });
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 0,
      shared: named("Existing"),
      assets: {},
    });

    dm.getState().dispatch(setName("Changed"));
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 1,
      shared: named("Changed"),
      assets: {},
    });
  });

  it("a player that loads before the DM catches up when the DM starts", () => {
    const hub = createMemoryHub();
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    expect(mirror.getState().status).toBe("connecting");

    const dm = createTableStore(named("Late DM"));
    startDmSync(dm, hub.connect());
    expect(mirror.getState()).toMatchObject({
      status: "synced",
      shared: named("Late DM"),
    });
  });

  it("a reconnecting player (fresh mirror) recovers full state via snapshot", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    dm.getState().dispatch(setName("One"));
    dm.getState().dispatch(setName("Two"));

    // Simulate reload: the old endpoint is gone, a brand-new one appears.
    const first = hub.connect();
    const stopFirst = startPlayerSync(createMirrorStore(), first);
    stopFirst();
    first.close();

    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 2,
      shared: named("Two"),
      assets: {},
    });
    dm.getState().dispatch(setName("Three"));
    expect(mirror.getState().shared?.campaignName).toBe("Three");
  });

  it("recovers from a missed delta by re-requesting a snapshot", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    dm.getState().dispatch(setName("real"));
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    expect(mirror.getState().seq).toBe(1);

    // A delta the player cannot apply (seq jumps 1 -> 5), as if it had been
    // suspended and missed traffic. It must not apply the ops blindly.
    const before = hub.log.length;
    hub.connect().post(encodeMessage(delta(5, [setName("skipped")])));

    // Player detected the gap and asked; DM answered with a snapshot.
    const tail = decodedLog(hub).slice(before).map((e) => e.message.type);
    expect(tail).toEqual(["delta", "hello", "snapshot"]);
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 1,
      shared: named("real"),
      assets: {},
    });
  });

  it("only ever sends hello — never ops, snapshots or anything else", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect()); // endpoint 0
    const playerEndpointId = 1; // hub ids are sequential
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect(), { clientId: "p" });

    // Throw every kind of traffic at the player.
    dm.getState().dispatch(setName("a"));
    const noise = hub.connect();
    noise.post("garbage");
    noise.post(encodeMessage(delta(99, [setName("gap")])));
    noise.post(encodeMessage({ type: "hello", v: PROTOCOL_VERSION, role: "dm", clientId: "other" }));

    const fromPlayer = hub.log.filter((e) => e.from === playerEndpointId);
    expect(fromPlayer.length).toBeGreaterThan(1);
    for (const { raw } of fromPlayer) {
      const r = decodeMessage(raw);
      expect(r.ok && r.message).toEqual({
        type: "hello",
        v: PROTOCOL_VERSION,
        role: "player",
        clientId: "p",
      });
    }
    // And the DM store was never touched by any of it.
    expect(dm.getState().seq).toBe(1);
  });

  it("stop() stops updating the mirror", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    const stop = startPlayerSync(mirror, hub.connect());
    stop();
    dm.getState().dispatch(setName("unseen"));
    expect(mirror.getState().shared?.campaignName).toBe("");
  });
});

describe("asset publishing (ADR 0008)", () => {
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
  const blobs: Record<string, Blob> = {
    "img-a": new Blob(["aaaa"], { type: "image/png" }),
    "img-b": new Blob(["bb"], { type: "image/jpeg" }),
  };
  const source: AssetSource = async (id) => {
    const blob = blobs[id];
    return blob ? { kind: "map-image", blob } : undefined;
  };
  const assetsInLog = (hub: ReturnType<typeof createMemoryHub>) =>
    decodedLog(hub)
      .map((e) => e.message)
      .filter((m): m is AssetMessage => m.type === "asset");

  it("pushes the active map's image after the start-up snapshot", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore({
      ...initialSharedState(),
      maps: [scene("m", "img-a")],
      activeMapId: "m",
    });
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    startDmSync(dm, hub.connect(), { assets: source });
    await vi.waitFor(() => expect(assetsInLog(hub)).toHaveLength(1));
    expect(assetsInLog(hub)[0]).toMatchObject({
      id: "img-a",
      kind: "map-image",
      mime: "image/png",
    });
    const received = mirror.getState().assets["img-a"];
    expect(received).toBeInstanceOf(Blob);
    expect(await readBlobText(received)).toBe("aaaa");
    expect(received.type).toBe("image/png");
  });

  it("pushes a newly imported map's image once, after its delta", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect(), { assets: source });
    dm.getState().dispatch(
      { kind: "map/add", map: scene("m", "img-a") },
      { kind: "map/set-active", id: "m" }
    );
    await vi.waitFor(() => expect(assetsInLog(hub)).toHaveLength(1));
    const types = decodedLog(hub).map((e) => e.message.type);
    expect(types).toEqual(["hello", "snapshot", "delta", "asset"]);

    // Further dispatches referencing the same asset do not resend it.
    dm.getState().dispatch({ kind: "map/rename", id: "m", name: "renamed" });
    dm.getState().dispatch({ kind: "map/set-active", id: null });
    dm.getState().dispatch({ kind: "map/set-active", id: "m" });
    await new Promise((r) => setTimeout(r, 10));
    expect(assetsInLog(hub)).toHaveLength(1);
  });

  it("sends the active map's assets before other maps' assets", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore({
      ...initialSharedState(),
      maps: [scene("ma", "img-a"), scene("mb", "img-b")],
      activeMapId: "mb",
    });
    startDmSync(dm, hub.connect(), { assets: source });
    await vi.waitFor(() => expect(assetsInLog(hub)).toHaveLength(2));
    expect(assetsInLog(hub).map((m) => m.id)).toEqual(["img-b", "img-a"]);
  });

  it("re-sends every asset when a player says hello (fresh player windows)", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore({
      ...initialSharedState(),
      maps: [scene("m", "img-a")],
      activeMapId: "m",
    });
    startDmSync(dm, hub.connect(), { assets: source });
    await vi.waitFor(() => expect(assetsInLog(hub)).toHaveLength(1));

    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    await vi.waitFor(() => expect(assetsInLog(hub)).toHaveLength(2));
    expect(mirror.getState().assets["img-a"]).toBeInstanceOf(Blob);
  });

  it("skips assets the source cannot find and sends nothing without a source", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore({
      ...initialSharedState(),
      maps: [scene("m", "missing")],
      activeMapId: "m",
    });
    startDmSync(dm, hub.connect(), { assets: source });
    await new Promise((r) => setTimeout(r, 10));
    expect(assetsInLog(hub)).toHaveLength(0);

    const hub2 = createMemoryHub();
    const dm2 = createTableStore({
      ...initialSharedState(),
      maps: [scene("m", "img-a")],
      activeMapId: "m",
    });
    startDmSync(dm2, hub2.connect());
    await new Promise((r) => setTimeout(r, 10));
    expect(assetsInLog(hub2)).toHaveLength(0);
  });

  it("stop() cancels pending asset pushes", async () => {
    const hub = createMemoryHub();
    let release: () => void = () => {};
    const slow: AssetSource = (id) =>
      new Promise((resolve) => {
        release = () => resolve({ kind: "map-image", blob: blobs[id] });
      });
    const dm = createTableStore({
      ...initialSharedState(),
      maps: [scene("m", "img-a")],
      activeMapId: "m",
    });
    const stop = startDmSync(dm, hub.connect(), { assets: slow });
    stop();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(assetsInLog(hub)).toHaveLength(0);
  });
});
