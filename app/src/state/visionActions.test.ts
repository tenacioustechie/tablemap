// @vitest-environment node
/**
 * Vision on the DM side (T106): what a seeing token sees becomes one polygon
 * reveal with the standard feather; a door toggle reveals for every seeing
 * token in one dispatch (one undo step); drops, vision edits and door
 * toggles trigger it after the triggering dispatch, and nothing the actions
 * dispatch themselves ever does.
 */
import { blockingSegments } from "../map/visibility";
import { fogFeatherPx, fogFill, fogShape, polygonShape, type FogOp } from "./fog";
import { createFogHistory } from "./fogHistory";
import { createBlankMapScene, findMap } from "./maps";
import type { MapScene } from "./model";
import { initialSharedState, type SharedOp } from "./shared";
import { createTableStore, type TableStore } from "./store";
import { createToken } from "./tokens";
import { tokenVisionPolygon } from "./vision";
import { alreadyRevealed, createVisionActions, visionRevealOp } from "./visionActions";
import { createDoor, createWall, type WallSegment } from "./walls";

const MAP = "m";
const CELL = 50;
const disc = { type: "disc" as const, color: "#f00" };

/**
 * A 500 x 400 map with a walled room (50, 50)-(250, 250) whose right wall
 * has a closed door from y = 125 to 175. Inside: `seer` (vision 6, centre
 * (125, 125)) and `scout` (vision 2, centre (175, 175), 75 px from the
 * door); outside: `blind` (no vision).
 */
function roomScene(): MapScene {
  return {
    ...createBlankMapScene({ id: MAP, columns: 10, rows: 8, cellSize: CELL }),
    walls: [
      createWall({ id: "top", x1: 50, y1: 50, x2: 250, y2: 50 }),
      createWall({ id: "left", x1: 50, y1: 50, x2: 50, y2: 250 }),
      createWall({ id: "bottom", x1: 50, y1: 250, x2: 250, y2: 250 }),
      createWall({ id: "right-a", x1: 250, y1: 50, x2: 250, y2: 125 }),
      createDoor({ id: "door", x1: 250, y1: 125, x2: 250, y2: 175 }),
      createWall({ id: "right-b", x1: 250, y1: 175, x2: 250, y2: 250 }),
    ],
    tokens: [
      createToken({ id: "seer", x: 100, y: 100, appearance: disc, vision: 6 }),
      createToken({ id: "scout", x: 150, y: 150, appearance: disc, vision: 2 }),
      createToken({ id: "blind", x: 350, y: 300, appearance: disc }),
    ],
  };
}

let store: TableStore;
let batches: SharedOp[][];
let queued: (() => void)[];

/** A scheduler the test runs by hand. */
const schedule = (run: () => void) => {
  queued.push(run);
};
const flush = () => {
  const runs = queued;
  queued = [];
  for (const run of runs) run();
};

const scene = () => findMap(store.getState().shared, MAP)!;
const token = (id: string) => scene().tokens.find((t) => t.id === id)!;
const log = () => scene().fogOps;
const fogBatches = () => batches.filter((ops) => ops.some((op) => op.kind === "map/fog-op"));
const pointsOf = (op: FogOp): number[] => {
  if (op.type !== "shape" || op.shape.kind !== "polygon") throw new Error("not a polygon op");
  return op.shape.points;
};
const maxX = (points: number[]) => Math.max(...points.filter((_, i) => i % 2 === 0));

const setDoor = (open: boolean) =>
  store.getState().dispatch({ kind: "map/door-set-open", id: MAP, segmentId: "door", open });
const moveToken = (tokenId: string, x: number, y: number) =>
  store.getState().dispatch({ kind: "map/token-update", id: MAP, tokenId, patch: { x, y } });

beforeEach(() => {
  store = createTableStore({ ...initialSharedState(), maps: [roomScene()], activeMapId: MAP });
  batches = [];
  queued = [];
  store.onOps((ops) => batches.push([...ops]));
});

describe("visionRevealOp and alreadyRevealed", () => {
  it("a seeing token's reveal is its vision polygon with the standard feather; a blind token has none", () => {
    const op = visionRevealOp(scene(), token("seer"));
    expect(op).toEqual(
      fogShape("reveal", polygonShape(tokenVisionPolygon(scene(), token("seer"))), fogFeatherPx(CELL))
    );
    expect(pointsOf(op!).length).toBeGreaterThanOrEqual(6);
    // The closed room bounds it.
    expect(maxX(pointsOf(op!))).toBeLessThanOrEqual(250 + 1e-6);
    expect(visionRevealOp(scene(), token("blind"))).toBeNull();
  });

  it("counts a reveal as done when an identical one, or a reveal-all, follows the last hide", () => {
    const seer = visionRevealOp(scene(), token("seer"))!;
    const scout = visionRevealOp(scene(), token("scout"))!;
    const hide = fogShape("hide", { kind: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(alreadyRevealed([], seer)).toBe(false);
    expect(alreadyRevealed([seer], seer)).toBe(true);
    expect(alreadyRevealed([seer, scout], seer)).toBe(true);
    expect(alreadyRevealed([scout], seer)).toBe(false);
    expect(alreadyRevealed([seer, hide], seer)).toBe(false);
    expect(alreadyRevealed([hide, fogFill("reveal")], seer)).toBe(true);
    expect(alreadyRevealed([fogFill("reveal"), fogFill("hide")], seer)).toBe(false);
    // Same polygon, different edge: not the same reveal.
    expect(alreadyRevealed([fogShape("reveal", polygonShape(pointsOf(seer)))], seer)).toBe(false);
  });
});

describe("revealFor / revealAll", () => {
  it("revealFor dispatches one polygon reveal; a blind or unknown token, an unknown map or a reveal already in the log dispatch nothing", () => {
    const actions = createVisionActions(store, { schedule });
    expect(actions.revealFor(MAP, "seer")).toBe(true);
    expect(batches).toEqual([[{ kind: "map/fog-op", id: MAP, op: visionRevealOp(scene(), token("seer")) }]]);

    const seq = store.getState().seq;
    expect(actions.revealFor(MAP, "seer")).toBe(false);
    expect(actions.revealFor(MAP, "blind")).toBe(false);
    expect(actions.revealFor(MAP, "nobody")).toBe(false);
    expect(actions.revealFor("nowhere", "seer")).toBe(false);
    expect(store.getState().seq).toBe(seq);

    // After a hide the same view counts again.
    store.getState().dispatch({ kind: "map/fog-op", id: MAP, op: fogFill("hide") });
    expect(actions.revealFor(MAP, "seer")).toBe(true);
    expect(log()).toHaveLength(3);
  });

  it("a hidden token still reveals what it sees", () => {
    store.getState().dispatch({ kind: "map/token-update", id: MAP, tokenId: "seer", patch: { hidden: true } });
    const actions = createVisionActions(store, { schedule });
    expect(actions.revealFor(MAP, "seer")).toBe(true);
    expect(log()).toEqual([visionRevealOp(scene(), token("seer"))]);
  });

  it("walls and a closed door bound the view; an open door lets it through, like a map without the door", () => {
    const actions = createVisionActions(store, { schedule });
    actions.revealFor(MAP, "seer");
    const closed = pointsOf(log()[0]);
    expect(maxX(closed)).toBeLessThanOrEqual(250 + 1e-6);

    setDoor(true);
    expect(actions.revealFor(MAP, "seer")).toBe(true);
    const open = pointsOf(log()[1]);
    expect(maxX(open)).toBeGreaterThan(300);
    const withoutDoor: WallSegment[] = scene().walls.filter((w) => w.kind === "wall");
    expect(open).toEqual(tokenVisionPolygon(scene(), token("seer"), blockingSegments(withoutDoor)));
  });

  it("revealAll reveals for every seeing token in one dispatch, which fog history undoes and redoes as one step", () => {
    const history = createFogHistory(store);
    history.start();
    const actions = createVisionActions(store, { schedule });
    expect(actions.revealAll(MAP)).toBe(true);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { kind: "map/fog-op", id: MAP, op: visionRevealOp(scene(), token("seer")) },
      { kind: "map/fog-op", id: MAP, op: visionRevealOp(scene(), token("scout")) },
    ]);
    const seq = store.getState().seq;

    expect(history.undo(MAP)).toBe(true);
    expect(log()).toEqual([]);
    expect(store.getState().seq).toBe(seq + 1);
    expect(history.redoDepth(MAP)).toBe(1);
    expect(history.redo(MAP)).toBe(true);
    expect(log()).toHaveLength(2);
    expect(store.getState().seq).toBe(seq + 2);

    // Nothing new to see; unknown maps and maps without a seeing token do nothing.
    expect(actions.revealAll(MAP)).toBe(false);
    expect(actions.revealAll("nowhere")).toBe(false);
    store.getState().dispatch({
      kind: "map/add",
      map: createBlankMapScene({ id: "empty", columns: 2, rows: 2, cellSize: CELL }),
    });
    expect(actions.revealAll("empty")).toBe(false);
  });

  it("appends through the injected apply: one call per reveal, carrying every op", () => {
    const apply = vi.fn();
    const actions = createVisionActions(store, { apply, schedule });
    actions.revealAll(MAP);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      MAP,
      visionRevealOp(scene(), token("seer")),
      visionRevealOp(scene(), token("scout"))
    );
    actions.revealFor(MAP, "scout");
    expect(apply).toHaveBeenLastCalledWith(MAP, visionRevealOp(scene(), token("scout")));
  });

  it("a drop among 400 walls reveals well within a frame", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const walls = Array.from({ length: 400 }, (_, i) => {
      const x = random() * 500;
      const y = random() * 400;
      return createWall({ id: `w${i}`, x1: x, y1: y, x2: x + (random() - 0.5) * 40, y2: y + (random() - 0.5) * 40 });
    });
    store.getState().dispatch({ kind: "map/remove", id: MAP });
    store.getState().dispatch({ kind: "map/add", map: { ...roomScene(), walls } });
    const actions = createVisionActions(store, { schedule });
    const times: number[] = [];
    for (let run = 0; run < 15; run++) {
      store.getState().dispatch({ kind: "map/fog-op", id: MAP, op: fogFill("hide") });
      const started = performance.now();
      expect(actions.revealFor(MAP, "seer")).toBe(true);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(16);
  });
});

describe("triggers (start)", () => {
  it("a seeing token's drop reveals after the move's dispatch, in a dispatch of its own; a blind token's drop reveals nothing", () => {
    const actions = createVisionActions(store, { schedule });
    actions.start();
    moveToken("seer", 150, 100);
    expect(batches).toHaveLength(1); // the move alone: nothing was dispatched inside it
    expect(log()).toEqual([]);
    flush();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual([{ kind: "map/fog-op", id: MAP, op: visionRevealOp(scene(), token("seer")) }]);
    expect(token("seer")).toMatchObject({ x: 150, y: 100 });

    moveToken("blind", 400, 300);
    flush();
    expect(batches).toHaveLength(3);
    expect(fogBatches()).toHaveLength(1);
  });

  it("a vision given to a token reveals at once; vision 0 and other edits do not", () => {
    createVisionActions(store, { schedule }).start();
    const update = (tokenId: string, patch: object) =>
      store.getState().dispatch({ kind: "map/token-update", id: MAP, tokenId, patch });
    update("blind", { name: "Bob" });
    update("blind", { vision: 0 });
    update("seer", { hidden: true, badge: "S" });
    expect(queued).toHaveLength(0);
    flush();
    expect(fogBatches()).toHaveLength(0);

    update("blind", { vision: 4 });
    flush();
    expect(fogBatches()).toEqual([
      [{ kind: "map/fog-op", id: MAP, op: visionRevealOp(scene(), token("blind")) }],
    ]);
    expect(maxX(pointsOf(log()[0]))).toBeGreaterThan(350);
  });

  it("a door toggle reveals for every seeing token in one dispatch, one undo step; closing it reveals the narrower view and hides nothing", () => {
    const history = createFogHistory(store);
    history.start();
    createVisionActions(store, { schedule }).start();

    setDoor(true);
    flush();
    expect(fogBatches()).toHaveLength(1);
    expect(fogBatches()[0]).toHaveLength(2);
    expect(log()).toEqual([
      visionRevealOp(scene(), token("seer")),
      visionRevealOp(scene(), token("scout")),
    ]);
    expect(maxX(pointsOf(log()[0]))).toBeGreaterThan(250);
    expect(maxX(pointsOf(log()[1]))).toBeGreaterThan(250);

    setDoor(false);
    flush();
    expect(fogBatches()).toHaveLength(2);
    expect(log()).toHaveLength(4);
    expect(log().every((op) => op.mode === "reveal")).toBe(true);
    expect(maxX(pointsOf(log()[2]))).toBeLessThanOrEqual(250 + 1e-6);
    expect(maxX(pointsOf(log()[3]))).toBeLessThanOrEqual(250 + 1e-6);

    history.undo(MAP);
    expect(log()).toHaveLength(2);
    history.undo(MAP);
    expect(log()).toHaveLength(0);
  });

  it("merges the triggers queued before the reveal runs: one reveal dispatch per map", () => {
    createVisionActions(store, { schedule }).start();
    moveToken("seer", 150, 100);
    moveToken("seer", 100, 150);
    expect(queued).toHaveLength(1);
    flush();
    expect(fogBatches()).toEqual([
      [{ kind: "map/fog-op", id: MAP, op: visionRevealOp(scene(), token("seer")) }],
    ]);

    // A drop and a door toggle in one dispatch: every seeing token, once.
    store.getState().dispatch(
      { kind: "map/token-update", id: MAP, tokenId: "scout", patch: { x: 100, y: 200 } },
      { kind: "map/door-set-open", id: MAP, segmentId: "door", open: true }
    );
    flush();
    expect(fogBatches()).toHaveLength(2);
    expect(fogBatches()[1]).toHaveLength(2);
  });

  it("nothing else triggers: a map switch, a campaign load, a new seeing token, a wall edit, a fog op", () => {
    createVisionActions(store, { schedule }).start();
    store.getState().dispatch(
      { kind: "map/add", map: { ...roomScene(), id: "other" } },
      { kind: "map/set-active", id: "other" },
      {
        kind: "map/token-add",
        id: MAP,
        token: createToken({ id: "late", x: 200, y: 200, appearance: disc, vision: 3 }),
      },
      { kind: "map/wall-remove", id: MAP, segmentId: "top" },
      { kind: "map/fog-op", id: MAP, op: fogFill("hide") }
    );
    store.getState().dispatch({ kind: "campaign/replace", state: store.getState().shared });
    expect(queued).toHaveLength(0);
    flush();
    expect(log()).toEqual([fogFill("hide")]);
  });

  it("ignores what its own dispatch sets off: no loop even when the reveal runs synchronously and apply toggles a door", () => {
    let calls = 0;
    const doorOpen = () => scene().walls.some((w) => w.kind === "door" && w.open);
    const apply = (mapId: string, ...ops: FogOp[]) => {
      calls++;
      store.getState().dispatch(
        ...ops.map((op): SharedOp => ({ kind: "map/fog-op", id: mapId, op })),
        { kind: "map/door-set-open", id: mapId, segmentId: "door", open: !doorOpen() }
      );
    };
    createVisionActions(store, { apply, schedule: (run) => run() }).start();
    setDoor(true);
    expect(calls).toBe(1);
    expect(fogBatches()).toHaveLength(1);
    expect(doorOpen()).toBe(false); // apply closed it again, and that was not a trigger
  });

  it("stop() detaches and drops what was queued", () => {
    const actions = createVisionActions(store, { schedule });
    const stop = actions.start();
    moveToken("seer", 150, 100);
    stop();
    flush();
    setDoor(true);
    flush();
    expect(queued).toHaveLength(0);
    expect(fogBatches()).toHaveLength(0);
    // start() again reattaches (and is idempotent).
    actions.start();
    actions.start();
    setDoor(false);
    flush();
    expect(fogBatches()).toHaveLength(1);
  });

  it("by default the reveal runs in a microtask after the triggering dispatch", async () => {
    createVisionActions(store).start();
    moveToken("seer", 150, 100);
    expect(log()).toEqual([]);
    await Promise.resolve();
    expect(log()).toEqual([visionRevealOp(scene(), token("seer"))]);
  });
});
