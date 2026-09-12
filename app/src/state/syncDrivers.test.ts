/**
 * DM publisher + player receiver wired through the in-memory hub. This is the
 * protocol end-to-end minus the browser.
 */
import { applyFogOp, applyFogOps, createBitmapFogRaster } from "../map/fogRaster";
import { readBlobText } from "../test/blob";
import { createDrawing, createNote } from "./annotations";
import { defaultPlayerPresentation, type DisplayInfo } from "./calibration";
import { newCampaign } from "./campaign";
import { startDmSync, type AssetSource } from "./dmSync";
import { fogFill, fogShape, type FogOp } from "./fog";
import { createBlankMapScene } from "./maps";
import { createMirrorStore } from "./mirror";
import { createToken, tokenVisibility } from "./tokens";
import { defaultGridSettings, type MapScene } from "./model";
import { startPlayerSync } from "./playerSync";
import { initialSharedState, type SharedOp } from "./shared";
import { createTableStore } from "./store";
import {
  decodeMessage,
  encodeMessage,
  delta,
  hello,
  ping,
  presentation,
  PROTOCOL_VERSION,
  type AssetMessage,
  type DeltaMessage,
} from "./sync";
import { createMemoryHub } from "./transport";

const setName = (name: string): SharedOp => ({ kind: "campaign/set-name", name });
const named = (campaignName: string) => ({ ...initialSharedState(), campaignName });
const noPresentation = () => defaultPlayerPresentation();
const tv: DisplayInfo = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };
const laptop: DisplayInfo = { width: 1440, height: 900, pixelRatio: 2, left: 0, top: 25 };

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
      presentation(noPresentation()),
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
    expect(hub.log.length).toBe(before + 3); // the hello + snapshot + presentation replies
    const reply = decodeMessage(hub.log[hub.log.length - 2].raw);
    expect(reply).toEqual({
      ok: true,
      message: { type: "snapshot", v: PROTOCOL_VERSION, seq: 0, state: named("S") },
    });
    expect(decodeMessage(hub.log[hub.log.length - 1].raw)).toEqual({
      ok: true,
      message: presentation(noPresentation()),
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
      presentation: noPresentation(),
      pings: [],
    });

    dm.getState().dispatch(setName("Changed"));
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 1,
      shared: named("Changed"),
      assets: {},
      presentation: noPresentation(),
      pings: [],
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
    const firstSync = startPlayerSync(createMirrorStore(), first);
    firstSync.stop();
    first.close();

    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 2,
      shared: named("Two"),
      assets: {},
      presentation: noPresentation(),
      pings: [],
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
    expect(tail).toEqual(["delta", "hello", "snapshot", "presentation"]);
    expect(mirror.getState()).toEqual({
      status: "synced",
      seq: 1,
      shared: named("real"),
      assets: {},
      presentation: noPresentation(),
      pings: [],
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

  it("grid settings reach the player as a delta and survive a fresh snapshot", () => {
    const hub = createMemoryHub();
    const scene: MapScene = {
      id: "m",
      name: "m",
      imageAssetId: null,
      backgroundColor: "#000",
      width: 100,
      height: 100,
      grid: defaultGridSettings(),
      fogMaskAssetId: null,
      fogOps: [],
      fogOpsFrom: 0,
      tokens: [],
      annotations: [],
    };
    const dm = createTableStore({ ...initialSharedState(), maps: [scene], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());

    const grid = {
      cellSize: 48,
      offsetX: 12,
      offsetY: 7,
      dm: { visible: true, color: "#ff0000", opacity: 0.6 },
      player: { visible: false, color: "#00ff00", opacity: 0.2 },
    };
    dm.getState().dispatch({ kind: "map/set-grid", id: "m", grid });
    expect(mirror.getState().seq).toBe(1);
    expect(mirror.getState().shared?.maps[0].grid).toEqual(grid);

    // A player opened later gets the grid in its snapshot.
    const late = createMirrorStore();
    startPlayerSync(late, hub.connect());
    expect(late.getState().shared?.maps[0].grid).toEqual(grid);
  });

  it("fog ops travel as operations and replay to a byte-identical mask on the player (T007)", () => {
    const hub = createMemoryHub();
    const scene: MapScene = {
      ...createBlankMapScene({ id: "m", columns: 4, rows: 3, cellSize: 8 }),
      id: "m",
    };
    const dm = createTableStore({ ...initialSharedState(), maps: [scene], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());

    // The DM rasterises as it goes; the player rasterises from the mirrored log.
    const dmRaster = createBitmapFogRaster(scene.width, scene.height);
    const ops: FogOp[] = [
      fogShape("reveal", { kind: "rect", x: 2, y: 2, width: 12, height: 9 }),
      fogShape("hide", { kind: "circle", x: 8, y: 6, radius: 3 }),
      fogFill("hide"),
      fogShape("reveal", { kind: "polygon", points: [0, 0, 20, 0, 10, 15] }),
    ];
    for (const op of ops) {
      dm.getState().dispatch({ kind: "map/fog-op", id: "m", op });
      applyFogOp(dmRaster, op);
    }
    expect(mirror.getState().seq).toBe(4);
    const mirrored = mirror.getState().shared!.maps[0];
    expect(mirrored.fogOps).toEqual(ops);
    expect(mirrored.fogOpsFrom).toBe(0);
    const playerRaster = createBitmapFogRaster(mirrored.width, mirrored.height);
    applyFogOps(playerRaster, mirrored.fogOps);
    expect(playerRaster.alpha).toEqual(dmRaster.alpha);
    expect(playerRaster.hiddenFraction()).toBeLessThan(1);

    // No message on the wire carried pixels: only ops and state.
    const types = decodedLog(hub).map((e) => e.message.type);
    expect(types.filter((t) => t === "asset")).toHaveLength(0);
    expect(types.filter((t) => t === "delta")).toHaveLength(4);

    // Compaction reaches the player as an op too, and a late player gets the result in its snapshot.
    dm.getState().dispatch({ kind: "map/fog-compact", id: "m", baseAssetId: "png-1", opCount: 3 });
    expect(mirror.getState().shared!.maps[0]).toMatchObject({
      fogMaskAssetId: "png-1",
      fogOps: [ops[3]],
      fogOpsFrom: 3,
    });
    const late = createMirrorStore();
    startPlayerSync(late, hub.connect());
    expect(late.getState().shared?.maps[0]).toMatchObject({
      fogMaskAssetId: "png-1",
      fogOps: [ops[3]],
      fogOpsFrom: 3,
    });
  });

  it("undo travels as a map/fog-undo delta and the player's replayed mask matches the DM's (T008)", () => {
    const hub = createMemoryHub();
    const scene: MapScene = createBlankMapScene({ id: "m", columns: 4, rows: 3, cellSize: 8 });
    const dm = createTableStore({ ...initialSharedState(), maps: [scene], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());

    const ops: FogOp[] = [
      fogShape("reveal", { kind: "stroke", points: [4, 4, 20, 12], radius: 3 }, 2),
      fogShape("reveal", { kind: "rects", rects: [0, 0, 8, 8, 8, 8, 8, 8] }),
      fogShape("hide", { kind: "polygon", points: [0, 0, 30, 0, 15, 20] }),
    ];
    for (const op of ops) dm.getState().dispatch({ kind: "map/fog-op", id: "m", op });
    dm.getState().dispatch({ kind: "map/fog-undo", id: "m" });
    const mirrored = mirror.getState().shared!.maps[0];
    expect(mirrored.fogOps).toEqual(ops.slice(0, 2));
    expect(decodedLog(hub).map((e) => e.message.type).filter((t) => t === "delta")).toHaveLength(4);

    const dmRaster = createBitmapFogRaster(scene.width, scene.height);
    applyFogOps(dmRaster, dm.getState().shared.maps[0].fogOps);
    const playerRaster = createBitmapFogRaster(mirrored.width, mirrored.height);
    applyFogOps(playerRaster, mirrored.fogOps);
    expect(playerRaster.alpha).toEqual(dmRaster.alpha);
    expect(playerRaster.isHidden(4, 4)).toBe(false); // the stroke survived the undo
  });

  it("stop() stops updating the mirror", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    const sync = startPlayerSync(mirror, hub.connect());
    sync.stop();
    dm.getState().dispatch(setName("unseen"));
    expect(mirror.getState().shared?.campaignName).toBe("");
    sync.announce();
    expect(hub.log.filter((e) => e.from === 1)).toHaveLength(1); // only the start-up hello
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
    fogOps: [],
    fogOpsFrom: 0,
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
    expect(types).toEqual(["hello", "snapshot", "presentation", "delta", "asset"]);

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

  it("does not re-send assets to a player it has already served (re-announce after a display change)", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore({
      ...initialSharedState(),
      maps: [scene("m", "img-a")],
      activeMapId: "m",
    });
    startDmSync(dm, hub.connect(), { assets: source });
    const mirror = createMirrorStore();
    const sync = startPlayerSync(mirror, hub.connect(), { clientId: "same" });
    await vi.waitFor(() => expect(assetsInLog(hub)).toHaveLength(2));

    sync.announce();
    await new Promise((r) => setTimeout(r, 10));
    expect(assetsInLog(hub)).toHaveLength(2);
    // ...but a snapshot and presentation did go out again.
    const tail = decodedLog(hub).slice(-3).map((e) => e.message.type);
    expect(tail).toEqual(["hello", "snapshot", "presentation"]);
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

describe("display report + presentation (T006, ADR 0011)", () => {
  const calibration = { pxPerInch: 40, method: "square" as const, updatedAt: 1 };

  it("the player's hello carries its display and the DM records it (DM-only, not shared)", () => {
    const hub = createMemoryHub();
    const dm = createTableStore(named("S"));
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect(), { clientId: "p", display: () => tv });

    const hellos = decodedLog(hub).filter((e) => e.message.type === "hello" && e.from === 1);
    expect(hellos.map((e) => e.message)).toEqual([hello("player", "p", tv)]);
    expect(dm.getState().presentation.playerDisplay).toEqual(tv);
    expect(dm.getState().shared).toEqual(named("S"));
    expect(dm.getState().seq).toBe(0);
  });

  it("a hello without a display leaves the recorded display alone", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    startPlayerSync(createMirrorStore(), hub.connect(), { display: () => tv });
    startPlayerSync(createMirrorStore(), hub.connect());
    expect(dm.getState().presentation.playerDisplay).toEqual(tv);
  });

  it("pushes the presentation whenever the DM store's presentation changes", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect(), { display: () => tv });
    expect(mirror.getState().presentation).toEqual(noPresentation());

    dm.getState().setPresentation({ calibration, cellUnit: "mm25" });
    expect(mirror.getState().presentation).toEqual({
      ...noPresentation(),
      pxPerInch: 40,
      cellUnit: "mm25",
    });
    dm.getState().setPresentation({ overview: true });
    expect(mirror.getState().presentation.overview).toBe(true);
    dm.getState().setPresentation({ target: 96 });
    expect(mirror.getState().presentation.target).toBe(96);

    // T009: pan centre, rotation, blackout and splash travel the same way.
    dm.getState().setPresentation({ center: { x: 120, y: 80 }, rotation: 90 });
    expect(mirror.getState().presentation).toMatchObject({ center: { x: 120, y: 80 }, rotation: 90 });
    dm.getState().setPresentation({ blackout: true });
    expect(mirror.getState().presentation.blackout).toBe(true);
    dm.getState().setPresentation({ splash: true, blackout: false });
    expect(mirror.getState().presentation).toMatchObject({ splash: true, blackout: false });
    // The DM-only switch preference is not part of what the player gets.
    const sent = hub.log.length;
    dm.getState().setPresentation({ splashOnSwitch: true });
    expect(hub.log.length).toBe(sent);
    expect("splashOnSwitch" in mirror.getState().presentation).toBe(false);

    // The recorded display is DM-only: changing it alone sends nothing new.
    const before = hub.log.length;
    dm.getState().setPlayerDisplay({ ...tv });
    expect(hub.log.length).toBe(before);
  });

  it("a DM that starts after the player learns the display and the player gets its presentation", () => {
    const hub = createMemoryHub();
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect(), { clientId: "p", display: () => tv });

    const dm = createTableStore(named("Late"));
    startDmSync(dm, hub.connect());
    expect(dm.getState().presentation.playerDisplay).toEqual(tv);
    expect(mirror.getState()).toMatchObject({ status: "synced", shared: named("Late") });

    dm.getState().setPresentation({ calibration });
    expect(mirror.getState().presentation.pxPerInch).toBe(40);
  });

  it("a player re-announcing from another display switches the DM's recorded display and drops the old calibration", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    let display = laptop;
    const mirror = createMirrorStore();
    const sync = startPlayerSync(mirror, hub.connect(), { display: () => display });
    dm.getState().setPresentation({ calibration });
    expect(mirror.getState().presentation.pxPerInch).toBe(40);

    display = tv;
    sync.announce();
    expect(dm.getState().presentation.playerDisplay).toEqual(tv);
    expect(dm.getState().presentation.calibration).toBeNull();
    expect(mirror.getState().presentation.pxPerInch).toBeNull();
  });

  it("the player still only ever sends hello", () => {
    const hub = createMemoryHub();
    const dm = createTableStore();
    startDmSync(dm, hub.connect());
    const sync = startPlayerSync(createMirrorStore(), hub.connect(), { display: () => tv });
    dm.getState().setPresentation({ calibration, target: 50 });
    sync.announce();
    for (const { raw } of hub.log.filter((e) => e.from === 1)) {
      const r = decodeMessage(raw);
      expect(r.ok && r.message.type).toBe("hello");
    }
  });
});

describe("tokens over sync (T010)", () => {
  /** 8 x 6 cells of 10 px. */
  const scene = () => createBlankMapScene({ id: "m", columns: 8, rows: 6, cellSize: 10 });
  const orc = createToken({ id: "orc", x: 20, y: 10, appearance: { type: "disc", color: "#f00" }, badge: "O" });

  it("token ops travel as deltas, the mirrored state matches, and a late player gets them in its snapshot", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), maps: [scene()], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());

    dm.getState().dispatch({ kind: "map/token-add", id: "m", token: orc });
    dm.getState().dispatch({ kind: "map/token-update", id: "m", tokenId: "orc", patch: { x: 30, hidden: true } });
    expect(mirror.getState().seq).toBe(2);
    expect(mirror.getState().shared!.maps[0].tokens).toEqual([{ ...orc, x: 30, hidden: true }]);
    expect(mirror.getState().shared).toEqual(dm.getState().shared);
    expect(decodedLog(hub).map((e) => e.message.type).filter((t) => t === "delta")).toHaveLength(2);

    const late = createMirrorStore();
    startPlayerSync(late, hub.connect());
    expect(late.getState().shared!.maps[0].tokens).toEqual([{ ...orc, x: 30, hidden: true }]);

    dm.getState().dispatch({ kind: "map/token-remove", id: "m", tokenId: "orc" });
    expect(mirror.getState().shared!.maps[0].tokens).toEqual([]);
    expect(late.getState().shared!.maps[0].tokens).toEqual([]);
  });

  it("a token under fog is not visible to the player until the DM reveals its cell", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), maps: [scene()], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    dm.getState().dispatch({ kind: "map/token-add", id: "m", token: orc });

    // What the player window derives from its mirror: the fog raster from the
    // op log, and the visibility predicate over it.
    const playerSees = () => {
      const map = mirror.getState().shared!.maps[0];
      const raster = createBitmapFogRaster(map.width, map.height);
      applyFogOps(raster, map.fogOps);
      return map.tokens.map((t) => tokenVisibility(t, map.grid.cellSize, map, raster.isHidden));
    };
    expect(playerSees()).toEqual(["fogged"]);

    // Revealing the room next door changes nothing; revealing the token's cell does.
    dm.getState().dispatch({ kind: "map/fog-op", id: "m", op: fogShape("reveal", { kind: "rect", x: 50, y: 0, width: 30, height: 60 }) });
    expect(playerSees()).toEqual(["fogged"]);
    dm.getState().dispatch({ kind: "map/fog-op", id: "m", op: fogShape("reveal", { kind: "rect", x: 20, y: 10, width: 10, height: 10 }) });
    expect(playerSees()).toEqual(["visible"]);

    // The DM's hidden flag hides it again, whatever the fog; unhiding brings it back.
    dm.getState().dispatch({ kind: "map/token-update", id: "m", tokenId: "orc", patch: { hidden: true } });
    expect(playerSees()).toEqual(["hidden"]);
    dm.getState().dispatch({ kind: "map/token-update", id: "m", tokenId: "orc", patch: { hidden: false } });
    expect(playerSees()).toEqual(["visible"]);

    // Hiding the whole map (or undoing the reveal) fogs it again.
    dm.getState().dispatch({ kind: "map/fog-op", id: "m", op: fogFill("hide") });
    expect(playerSees()).toEqual(["fogged"]);
    dm.getState().dispatch({ kind: "map/fog-undo", id: "m" });
    expect(playerSees()).toEqual(["visible"]);
  });

  it("an image token's asset is pushed to the player after the delta, and dropped once the token is gone", async () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), maps: [scene()], activeMapId: "m" });
    const blob = new Blob(["orc-png"], { type: "image/png" });
    const assets: AssetSource = async (id) => (id === "img-orc" ? { kind: "token-image", blob } : undefined);
    startDmSync(dm, hub.connect(), { assets });
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());

    const goblin = createToken({ id: "gob", x: 0, y: 0, appearance: { type: "image", assetId: "img-orc" } });
    dm.getState().dispatch({ kind: "map/token-add", id: "m", token: goblin });
    await vi.waitFor(() => expect(mirror.getState().assets["img-orc"]).toBeDefined());
    const message = decodedLog(hub)
      .map((e) => e.message)
      .find((m): m is AssetMessage => m.type === "asset" && m.id === "img-orc");
    expect(message).toMatchObject({ kind: "token-image", mime: "image/png" });
    expect(await readBlobText(mirror.getState().assets["img-orc"])).toBe("orc-png");

    dm.getState().dispatch({ kind: "map/token-remove", id: "m", tokenId: "gob" });
    expect(mirror.getState().assets["img-orc"]).toBeUndefined();
  });
});

describe("annotations and pings over sync (T011, ADR 0016)", () => {
  const scene = () => createBlankMapScene({ id: "m", columns: 4, rows: 3, cellSize: 8 });
  const note = createNote({ id: "n1", x: 1, y: 2, text: "SECRET-LEVER" });
  const dmDrawing = createDrawing({ id: "d-dm", points: [0, 0, 5, 5], color: "#f00", strokeWidth: 2, visibility: "dm" });
  const shared = createDrawing({ id: "d-all", points: [0, 0, 5, 5], color: "#0f0", strokeWidth: 2, visibility: "all" });
  const rawWire = (hub: ReturnType<typeof createMemoryHub>) => hub.log.map((e) => e.raw).join("\n");

  it("notes and DM-only drawings never cross the wire; shared drawings do; seq stays contiguous", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), maps: [scene()], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());

    dm.getState().dispatch({ kind: "map/annotation-set", id: "m", annotation: note });
    dm.getState().dispatch({ kind: "map/annotation-set", id: "m", annotation: dmDrawing });
    dm.getState().dispatch({ kind: "map/annotation-set", id: "m", annotation: shared });
    expect(dm.getState().shared.maps[0].annotations).toHaveLength(3);
    expect(mirror.getState().seq).toBe(3);
    expect(mirror.getState().shared?.maps[0].annotations).toEqual([shared]);
    expect(rawWire(hub)).not.toContain("SECRET-LEVER");
    expect(rawWire(hub)).not.toContain("#f00");
    // The DM-only sets went out as removals (harmless), keeping one delta per dispatch.
    const deltas = decodedLog(hub)
      .map((e) => e.message)
      .filter((m): m is DeltaMessage => m.type === "delta");
    expect(deltas.map((d) => d.ops[0].kind)).toEqual([
      "map/annotation-remove",
      "map/annotation-remove",
      "map/annotation-set",
    ]);

    // Editing the note later leaks nothing either; removing it is a no-op on the player.
    dm.getState().dispatch({ kind: "map/annotation-set", id: "m", annotation: { ...note, text: "MORE-SECRET" } });
    dm.getState().dispatch({ kind: "map/annotation-remove", id: "m", annotationId: "n1" });
    expect(mirror.getState().seq).toBe(5);
    expect(mirror.getState().shared?.maps[0].annotations).toEqual([shared]);
    expect(rawWire(hub)).not.toContain("SECRET");

    // Clearing the drawings reaches the player.
    dm.getState().dispatch({ kind: "map/annotations-clear", id: "m", annotationKind: "drawing" });
    expect(mirror.getState().shared?.maps[0].annotations).toEqual([]);
    expect(dm.getState().shared.maps[0].annotations).toEqual([]);
  });

  it("a late player's snapshot, a campaign replace and a map add are stripped the same way", () => {
    const hub = createMemoryHub();
    const withSecrets = { ...scene(), annotations: [note, dmDrawing, shared] };
    const dm = createTableStore({ ...initialSharedState(), maps: [withSecrets], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    expect(mirror.getState().shared?.maps[0].annotations).toEqual([shared]);

    dm.getState().openCampaign(
      newCampaign("Replaced", {
        id: "c",
        state: { ...initialSharedState(), maps: [{ ...withSecrets, id: "r" }] },
      })
    );
    expect(mirror.getState().shared?.maps[0].annotations).toEqual([shared]);
    dm.getState().dispatch({ kind: "map/add", map: { ...withSecrets, id: "added" } });
    expect(mirror.getState().shared?.maps[1].annotations).toEqual([shared]);
    expect(rawWire(hub)).not.toContain("SECRET-LEVER");
    // The DM's own state (and therefore the autosaved document) still has everything.
    expect(dm.getState().shared.maps.map((m) => m.annotations.length)).toEqual([3, 3]);
  });

  it("a ping travels as one unsequenced ping message and lands in the mirror; a forged ping never reaches the DM", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), maps: [scene()], activeMapId: "m" });
    startDmSync(dm, hub.connect());
    const mirror = createMirrorStore();
    startPlayerSync(mirror, hub.connect());
    const before = hub.log.length;

    const value = { id: "p1", mapId: "m", x: 3, y: 4, at: Date.now() };
    dm.getState().sendPing(value);
    expect(mirror.getState().pings).toEqual([value]);
    expect(mirror.getState().seq).toBe(0);
    expect(decodedLog(hub).slice(before).map((e) => e.message)).toEqual([ping(value)]);

    // A late player does not get old pings.
    const late = createMirrorStore();
    startPlayerSync(late, hub.connect());
    expect(late.getState().pings).toEqual([]);

    // Something else posting a ping cannot make the DM ping.
    hub.connect().post(encodeMessage(ping({ ...value, id: "forged" })));
    expect(dm.getState().pings.map((p) => p.id)).toEqual(["p1"]);
  });
});
