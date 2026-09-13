/**
 * The DM canvas's wall layer (T101, ADR 0024): every wall and door of the
 * active scene is a node in the stage's controls layer, styled by kind and
 * door state, non-listening, following the store; while the shared stage —
 * as the player renders it — has no wall node at all.
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
import { DmCanvas } from "./DmCanvas";
import { DOOR_DASH, OPEN_DOOR_STROKE_PX, WALL_COLOR, WALL_STROKE_PX } from "./WallLayer";

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

describe("WallLayer on the DM canvas", () => {
  it("draws one node per segment in the controls layer, non-listening, styled by kind", () => {
    const store = storeWith(walls);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    render(<DmCanvas store={store} db={db} />);
    expect(screen.getByTestId("dm-canvas-surface").dataset.walls).toBe("4");

    const stage = lastStage();
    const nodes = wallNodes(stage);
    expect(nodes).toHaveLength(4);
    for (const node of nodes) {
      expect(node.getLayer()!.name()).toBe("controls");
      expect(node.listening()).toBe(false);
      expect(node.stroke()).toBe(WALL_COLOR);
      expect(node.strokeScaleEnabled()).toBe(false);
    }
    const group = stage.findOne<Konva.Group>(".walls")!;
    expect(group.listening()).toBe(false);
    expect(group.getChildren()).toHaveLength(4);

    const wall = stage.findOne<Konva.Line>("#wall-w1")!;
    expect(wall.points()).toEqual([0, 0, 200, 0]);
    expect(wall.strokeWidth()).toBe(WALL_STROKE_PX);
    expect(wall.dash()).toBeUndefined();

    const closed = stage.findOne<Konva.Line>("#wall-d-closed")!;
    expect(closed.points()).toEqual([50, 0, 100, 0]);
    expect(closed.strokeWidth()).toBe(WALL_STROKE_PX);
    expect(closed.dash()).toEqual([...DOOR_DASH]);

    const open = stage.findOne<Konva.Line>("#wall-d-open")!;
    expect(open.points()).toEqual([0, 50, 0, 100]);
    expect(open.strokeWidth()).toBe(OPEN_DOOR_STROKE_PX);
    expect(open.dash()).toBeUndefined();
  });

  it("follows the store: a set, an opened door, a removal and a clear change the nodes", () => {
    const store = storeWith([]);
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    render(<DmCanvas store={store} db={db} />);
    const surface = screen.getByTestId("dm-canvas-surface");
    expect(surface.dataset.walls).toBe("0");
    expect(wallNodes(lastStage())).toHaveLength(0);

    act(() => {
      store.getState().dispatch({ kind: "map/wall-set", id: "m", segment: walls[0] });
      store.getState().dispatch({ kind: "map/wall-set", id: "m", segment: walls[2] });
    });
    expect(surface.dataset.walls).toBe("2");
    expect(wallNodes(lastStage())).toHaveLength(2);
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.dash()).toEqual([...DOOR_DASH]);

    act(() => {
      store.getState().dispatch({ kind: "map/wall-set", id: "m", segment: { ...walls[2], open: true } as WallSegment });
    });
    expect(wallNodes(lastStage())).toHaveLength(2);
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.dash()).toBeUndefined();
    expect(lastStage().findOne<Konva.Line>("#wall-d-closed")!.strokeWidth()).toBe(OPEN_DOOR_STROKE_PX);

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
      // Nothing on the stage carries a wall's colour either.
      expect(stage.find((node: Konva.Node) => node.getAttr("stroke") === WALL_COLOR)).toHaveLength(0);
      unmount();
    }
  });
});
