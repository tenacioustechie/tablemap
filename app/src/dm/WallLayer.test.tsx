/**
 * The DM canvas's wall layer (T101, ADR 0024): every wall and door of the
 * active scene is a node in the stage's controls layer, styled by kind and
 * door state, non-listening, following the store; while the shared stage —
 * as the player renders it — has no wall node at all. T102 adds selection
 * and end handles; T103 the door look (a solid bar closed, the bar swung
 * 45° as a thin outline open) and the click that toggles a door under any
 * tool.
 */
import { act, render, screen } from "@testing-library/react";
import Konva from "konva";
import { nanoid } from "nanoid";
import { MapStage } from "../map/MapStage";
import { TableMapDb } from "../state/db";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { createDoor, createWall, type WallSegment } from "../state/walls";
import { DmCanvas, type WallToolProps } from "./DmCanvas";
import {
  DOOR_COLOR,
  DOOR_DASH,
  DOOR_STROKE_PX,
  OPEN_DOOR_STROKE_PX,
  OPEN_DOOR_SWING_DEG,
  OPEN_DOORWAY_OPACITY,
  openDoorLeaf,
  WALL_COLOR,
  WALL_HIT_PX,
  WALL_STROKE_PX,
} from "./WallLayer";

const walls: WallSegment[] = [
  createWall({ id: "w1", x1: 0, y1: 0, x2: 200, y2: 0 }),
  createWall({ id: "w2", x1: 200, y1: 0, x2: 200, y2: 150 }),
  createDoor({ id: "d-closed", x1: 50, y1: 0, x2: 100, y2: 0 }),
  createDoor({ id: "d-open", x1: 0, y1: 50, x2: 0, y2: 100, open: true }),
];

function storeWith(segments: WallSegment[]) {
  const scene = { ...createBlankMapScene({ id: "m", columns: 4, rows: 3, cellSize: 50 }), walls: segments };
  return createTableStore({ ...initialSharedState(), maps: [scene], activeMapId: "m" });
}

const lastStage = () => Konva.stages[Konva.stages.length - 1];
const wallNodes = (stage: Konva.Stage) => stage.find<Konva.Line>(".wall");

const wallProps = (selectedId: string | null, drawing = false): WallToolProps => ({
  drawing,
  settings: { tool: "wall" as const, snap: true },
  selectedId,
  onSegment: vi.fn(),
  onSelect: vi.fn(),
  onMoveEndpoint: vi.fn(),
  onToggleDoor: vi.fn(),
  onCancel: vi.fn(),
});

/** Fires a click on a node as Konva would, bubbling up to the stage. */
function clickNode(node: Konva.Node, init: MouseEventInit = {}) {
  act(() => {
    node.fire("mousedown", { evt: new MouseEvent("mousedown", init) }, true);
    node.fire("mouseup", { evt: new MouseEvent("mouseup", init) }, true);
    node.fire("click", { evt: new MouseEvent("click", init) }, true);
  });
}

describe("WallLayer on the DM canvas", () => {
  it("draws one node per segment in the controls layer, non-listening, styled by kind and door state", () => {
    const store = storeWith(walls);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    render(<DmCanvas store={store} db={db} />);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.walls).toBe("4");
    expect(surface.dataset.doorsOpen).toBe("1");
    expect(surface.dataset.doorsClickable).toBe("false");

    const stage = lastStage();
    const nodes = wallNodes(stage);
    expect(nodes).toHaveLength(4);
    for (const node of nodes) {
      expect(node.getLayer()!.name()).toBe("controls");
      expect(node.listening()).toBe(false);
      expect(node.strokeScaleEnabled()).toBe(false);
    }
    const group = stage.findOne<Konva.Group>(".walls")!;
    expect(group.listening()).toBe(false);

    const wall = stage.findOne<Konva.Line>("#wall-w1")!;
    expect(wall.points()).toEqual([0, 0, 200, 0]);
    expect(wall.stroke()).toBe(WALL_COLOR);
    expect(wall.strokeWidth()).toBe(WALL_STROKE_PX);
    expect(wall.dash()).toBeUndefined();
    expect(wall.hasName("door")).toBe(false);

    // A closed door: a solid bar in the door colour across the doorway.
    const closed = stage.findOne<Konva.Line>("#wall-d-closed")!;
    expect(closed.points()).toEqual([50, 0, 100, 0]);
    expect(closed.stroke()).toBe(DOOR_COLOR);
    expect(closed.strokeWidth()).toBe(DOOR_STROKE_PX);
    expect(closed.dash()).toBeUndefined();
    expect(closed.opacity()).toBe(1);
    expect(closed.lineCap()).toBe("butt");
    expect(closed.hasName("door")).toBe(true);
    expect(stage.findOne("#door-leaf-d-closed")).toBeUndefined();

    // An open door: the doorway a faint dashed line, the leaf swung 45° as a thin line.
    const open = stage.findOne<Konva.Line>("#wall-d-open")!;
    expect(open.points()).toEqual([0, 50, 0, 100]);
    expect(open.stroke()).toBe(DOOR_COLOR);
    expect(open.strokeWidth()).toBe(OPEN_DOOR_STROKE_PX);
    expect(open.dash()).toEqual([...DOOR_DASH]);
    expect(open.opacity()).toBe(OPEN_DOORWAY_OPACITY);
    const leaf = stage.findOne<Konva.Line>("#door-leaf-d-open")!;
    expect(leaf.getLayer()!.name()).toBe("controls");
    expect(leaf.listening()).toBe(false);
    expect(leaf.stroke()).toBe(DOOR_COLOR);
    expect(leaf.strokeWidth()).toBe(OPEN_DOOR_STROKE_PX);
    const [hinge, tip] = openDoorLeaf({ x: 0, y: 50 }, { x: 0, y: 100 });
    expect(leaf.points()).toEqual([hinge.x, hinge.y, tip.x, tip.y]);
    expect(stage.find(".door-leaf")).toHaveLength(1);
  });

  it("follows the store: a set, an opened door, a removal and a clear change the nodes", () => {
    const store = storeWith([]);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    render(<DmCanvas store={store} db={db} />);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.walls).toBe("0");
    expect(surface.dataset.doorsOpen).toBe("0");
    expect(wallNodes(lastStage())).toHaveLength(0);

    act(() => {
      store.getState().dispatch({ kind: "map/wall-set", id: "m", segment: walls[0] });
      store.getState().dispatch({ kind: "map/wall-set", id: "m", segment: walls[2] });
    });
    expect(surface.dataset.walls).toBe("2");
    expect(wallNodes(lastStage())).toHaveLength(2);
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.strokeWidth()).toBe(DOOR_STROKE_PX);
    expect(lastStage().find(".door-leaf")).toHaveLength(0);

    act(() => {
      store.getState().dispatch({ kind: "map/door-set-open", id: "m", segmentId: "d-closed", open: true });
    });
    expect(wallNodes(lastStage())).toHaveLength(2);
    expect(surface.dataset.doorsOpen).toBe("1");
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.dash()).toEqual([...DOOR_DASH]);
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.strokeWidth()).toBe(OPEN_DOOR_STROKE_PX);
    expect(lastStage().find(".door-leaf")).toHaveLength(1);

    act(() => {
      store.getState().dispatch({ kind: "map/door-set-open", id: "m", segmentId: "d-closed", open: false });
    });
    expect(surface.dataset.doorsOpen).toBe("0");
    expect(lastStage().find(".door-leaf")).toHaveLength(0);

    act(() => {
      store.getState().dispatch({ kind: "map/wall-remove", id: "m", segmentId: "w1" });
    });
    expect(surface.dataset.walls).toBe("1");
    expect(lastStage().findOne("#wall-w1")).toBeUndefined();

    act(() => {
      store.getState().dispatch({ kind: "map/walls-clear", id: "m" });
    });
    expect(surface.dataset.walls).toBe("0");
    expect(wallNodes(lastStage())).toHaveLength(0);
  });

  it("with the `walls` prop the segments listen, wide to the pointer, and the selected one gets a halo and two end handles (T102)", () => {
    const store = storeWith(walls);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    const onSelect = vi.fn();
    const onMoveEndpoint = vi.fn();
    const props = (selectedId: string | null, drawing = false): WallToolProps => ({
      ...wallProps(selectedId, drawing),
      onSelect,
      onMoveEndpoint,
    });
    const { rerender } = render(<DmCanvas store={store} db={db} walls={props(null)} />);
    const stage = lastStage();
    expect(stage.findOne<Konva.Group>(".walls")!.listening()).toBe(true);
    for (const node of wallNodes(stage)) {
      expect(node.listening()).toBe(true);
      // Screen pixels at any zoom: with strokeScaleEnabled off Konva draws the hit stroke unscaled (T103).
      expect(node.hitStrokeWidth()).toBe(WALL_HIT_PX);
    }
    expect(stage.find(".wall-highlight")).toHaveLength(0);
    expect(stage.find(".wall-handle")).toHaveLength(0);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.wallSelected).toBe("");
    expect(surface.dataset.wallSegments).toBe(
      "wall:0,0,200,0;wall:200,0,200,150;door:50,0,100,0:closed;door:0,50,0,100:open"
    );

    // A click on a node reports its id; an Alt-click is a ping and does not.
    stage.findOne<Konva.Line>("#wall-w2")!.fire("click", { evt: new MouseEvent("click") }, true);
    expect(onSelect).toHaveBeenLastCalledWith("w2");
    stage.findOne<Konva.Line>("#wall-w1")!.fire("click", { evt: new MouseEvent("click", { altKey: true }) }, true);
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(<DmCanvas store={store} db={db} walls={props("d-closed")} />);
    expect(surface.dataset.wallSelected).toBe("d-closed");
    const halo = lastStage().find<Konva.Line>(".wall-highlight");
    expect(halo).toHaveLength(1);
    expect(halo[0].points()).toEqual([50, 0, 100, 0]);
    expect(halo[0].listening()).toBe(false);
    const handles = lastStage().find<Konva.Circle>(".wall-handle");
    expect(handles.map((h) => h.id())).toEqual(["wall-handle-d-closed-start", "wall-handle-d-closed-end"]);
    expect(handles.map((h) => h.position())).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(handles.every((h) => h.draggable())).toBe(true);
    expect(handles.every((h) => h.fill() === DOOR_COLOR)).toBe(true);
    // The dragged end is drawn where it is being dragged to, and the drop is reported.
    const end = handles[1];
    end.position({ x: 130, y: 20 });
    end.fire("dragmove", { evt: new MouseEvent("mousemove") }, true);
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.points()).toEqual([50, 0, 130, 20]);
    end.position({ x: 142, y: 8 });
    end.fire("dragmove", { evt: new MouseEvent("mousemove") }, true);
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.points()).toEqual([50, 0, 150, 0]);
    expect(onMoveEndpoint).not.toHaveBeenCalled();
    end.fire("dragend", { evt: new MouseEvent("mouseup") }, true);
    // Snapped to the 50 px grid corner by the canvas (12 px reach).
    expect(onMoveEndpoint).toHaveBeenCalledWith("d-closed", "end", { x: 150, y: 0 });
    expect(end.position()).toEqual({ x: 150, y: 0 });

    // While the wall tool is armed nothing listens — not even the doors (T103) — and the handles are not draggable.
    rerender(<DmCanvas store={store} db={db} walls={props("d-closed", true)} />);
    expect(lastStage().findOne<Konva.Group>(".walls")!.listening()).toBe(false);
    expect(wallNodes(lastStage()).every((n) => !n.listening())).toBe(true);
    expect(lastStage().find<Konva.Circle>(".wall-handle").every((h) => !h.draggable())).toBe(true);
    expect(surface.dataset.doorsClickable).toBe("false");
  });

  it("a click on a door toggles it without selecting it; that press and release never reach the stage (T103)", () => {
    const store = storeWith(walls);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    const props = wallProps(null);
    render(<DmCanvas store={store} db={db} walls={props} />);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.doorsClickable).toBe("true");
    const stage = lastStage();
    const stageDown = vi.fn();
    const stageUp = vi.fn();
    const stageClick = vi.fn();
    stage.on("mousedown", stageDown);
    stage.on("mouseup", stageUp);
    stage.on("click", stageClick);
    const door = stage.findOne<Konva.Line>("#wall-d-closed")!;

    clickNode(door);
    expect(props.onToggleDoor).toHaveBeenCalledWith("d-closed");
    // Picking a door to edit it must not open it, so a click on one never selects it.
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(stageDown).not.toHaveBeenCalled();
    expect(stageUp).not.toHaveBeenCalled();
    expect(stageClick).not.toHaveBeenCalled();

    // A wall's click selects it and bubbles as before: the stage may still drag-pan and ping.
    clickNode(stage.findOne<Konva.Line>("#wall-w1")!);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenLastCalledWith("w1");
    expect(props.onToggleDoor).toHaveBeenCalledTimes(1);
    expect([stageDown, stageUp, stageClick].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);

    // A drag that started elsewhere and ends on a door is the tool's: its release reaches the stage.
    act(() => {
      stage.fire("mousedown", { evt: new MouseEvent("mousedown") });
      door.fire("mouseup", { evt: new MouseEvent("mouseup") }, true);
    });
    expect(stageUp).toHaveBeenCalledTimes(2);
    expect(props.onToggleDoor).toHaveBeenCalledTimes(1);

    // An Alt-click on a door is a ping and a middle-button press a pan: both reach the stage, neither toggles.
    clickNode(stage.findOne<Konva.Line>("#wall-d-open")!, { altKey: true });
    clickNode(door, { button: 1 });
    expect(props.onToggleDoor).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect([stageDown, stageUp, stageClick].map((f) => f.mock.calls.length)).toEqual([4, 4, 3]);
  });

  it("doors listen under a fog tool while walls do not, and a click then toggles without selecting; not under grid alignment (T103)", () => {
    const store = storeWith(walls);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    const props = wallProps(null);
    const fog = { settings: { mode: "reveal" as const, tool: "brush" as const, radius: 20, feather: true, snap: false }, onShape: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<DmCanvas store={store} db={db} walls={props} fog={fog} />);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.fogging).toBe("reveal");
    expect(surface.dataset.doorsClickable).toBe("true");
    const stage = lastStage();
    expect(stage.findOne<Konva.Group>(".walls")!.listening()).toBe(true);
    expect(stage.findOne<Konva.Line>("#wall-w1")!.listening()).toBe(false);
    expect(stage.findOne<Konva.Line>("#wall-w2")!.listening()).toBe(false);
    expect(stage.findOne<Konva.Line>("#wall-d-closed")!.listening()).toBe(true);
    expect(stage.findOne<Konva.Line>("#wall-d-open")!.listening()).toBe(true);
    expect(stage.find(".wall-handle")).toHaveLength(0);

    clickNode(stage.findOne<Konva.Line>("#wall-d-open")!);
    expect(props.onToggleDoor).toHaveBeenCalledWith("d-open");
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(fog.onShape).not.toHaveBeenCalled();

    // Grid alignment clicks on corners, where doors end: no door listens while it runs.
    rerender(
      <DmCanvas store={store} db={db} walls={props} fog={fog} alignment={{ onAligned: vi.fn(), onCancel: vi.fn() }} />
    );
    expect(surface.dataset.aligning).toBe("true");
    expect(surface.dataset.doorsClickable).toBe("false");
    expect(wallNodes(lastStage()).every((n) => !n.listening())).toBe(true);
    expect(lastStage().findOne<Konva.Group>(".walls")!.listening()).toBe(false);
  });

  it("a focus request centres the viewport on the segment's middle, once per request (T103)", () => {
    const store = storeWith(walls);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    // A measurable container: jsdom reports no size, so the fit is skipped and the effect needs one.
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const props = (focus?: { id: string; nonce: number }): WallToolProps => ({ ...wallProps(null), focus });
      const { rerender } = render(<DmCanvas store={store} db={db} walls={props()} />);
      const stageEl = () => screen.getByTestId("dm-map-stage");
      const at = () => ({ x: Number(stageEl().dataset.viewportX), y: Number(stageEl().dataset.viewportY), scale: Number(stageEl().dataset.scale) });
      const before = at();

      rerender(<DmCanvas store={store} db={db} walls={props({ id: "w2", nonce: 1 })} />);
      const centred = at();
      // w2's middle (200, 75) sits at the middle of the 800 × 600 container.
      expect(centred.scale).toBe(before.scale);
      expect(centred.x + 200 * centred.scale).toBeCloseTo(400, 1);
      expect(centred.y + 75 * centred.scale).toBeCloseTo(300, 1);

      // The same request again does nothing; a new nonce recentres on another segment.
      act(() => {
        store.getState().dispatch({ kind: "map/wall-set", id: "m", segment: { ...walls[1], x2: 300 } });
      });
      rerender(<DmCanvas store={store} db={db} walls={props({ id: "w2", nonce: 1 })} />);
      expect(at()).toEqual(centred);
      rerender(<DmCanvas store={store} db={db} walls={props({ id: "d-open", nonce: 2 })} />);
      expect(at().x + 0 * at().scale).toBeCloseTo(400, 1);
      expect(at().y + 75 * at().scale).toBeCloseTo(300, 1);
      // An unknown id is ignored.
      const stay = at();
      rerender(<DmCanvas store={store} db={db} walls={props({ id: "ghost", nonce: 3 })} />);
      expect(at()).toEqual(stay);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it("the shared stage draws no wall for either view, even with walls in the scene", () => {
    const scene = { ...createBlankMapScene({ id: "m", columns: 4, rows: 3, cellSize: 50 }), walls };
    const size = { width: 400, height: 300 };
    const viewport = { x: 0, y: 0, scale: 1 };
    for (const view of ["player", "dm"] as const) {
      const { unmount } = render(
        <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView={view} />
      );
      const stage = lastStage();
      expect(wallNodes(stage)).toHaveLength(0);
      expect(stage.findOne(".walls")).toBeUndefined();
      expect(stage.find(".door-leaf")).toHaveLength(0);
      // Nothing on the stage carries a wall's or a door's colour either.
      expect(
        stage.find((node: Konva.Node) => node.getAttr("stroke") === WALL_COLOR || node.getAttr("stroke") === DOOR_COLOR)
      ).toHaveLength(0);
      unmount();
    }
  });
});

describe("openDoorLeaf", () => {
  it("swings the doorway 45° clockwise about its first end, keeping the length", () => {
    const [hinge, tip] = openDoorLeaf({ x: 10, y: 10 }, { x: 110, y: 10 });
    expect(hinge).toEqual({ x: 10, y: 10 });
    expect(tip.x).toBeCloseTo(10 + 100 * Math.SQRT1_2, 6);
    expect(tip.y).toBeCloseTo(10 + 100 * Math.SQRT1_2, 6);
    expect(Math.hypot(tip.x - hinge.x, tip.y - hinge.y)).toBeCloseTo(100, 6);
    expect(OPEN_DOOR_SWING_DEG).toBe(45);
    // A quarter turn is exact.
    expect(openDoorLeaf({ x: 0, y: 0 }, { x: 0, y: 50 }, 90)).toEqual([
      { x: 0, y: 0 },
      { x: -50, y: 0 },
    ]);
  });
});
