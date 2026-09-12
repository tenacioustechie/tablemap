import { fireEvent, render } from "@testing-library/react";
import { Rect } from "react-konva";
import { createBlankMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { MapStage } from "./MapStage";
import { screenToMap, zoomAt, wheelZoomFactor, type Viewport } from "./viewport";

const scene = createBlankMapScene({ id: "s", columns: 4, rows: 3, cellSize: 50, color: "#123456" });
const size = { width: 400, height: 300 };
const viewport: Viewport = { x: 10, y: 20, scale: 1.5 };

const withGrid = (dm: boolean, player: boolean): MapScene => ({
  ...scene,
  grid: {
    ...scene.grid,
    dm: { ...scene.grid.dm, visible: dm },
    player: { ...scene.grid.player, visible: player },
  },
});

describe("MapStage", () => {
  it("mounts a Konva stage with a canvas per layer and reports the scene", () => {
    const { container, getByTestId } = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="dm" />
    );
    const wrapper = getByTestId("map-stage");
    expect(wrapper.dataset.mapId).toBe("s");
    expect(wrapper.dataset.mapName).toBe("Blank map");
    expect(wrapper.dataset.imageStatus).toBe("none");
    expect(wrapper.dataset.scale).toBe("1.5000");
    expect(wrapper.dataset.gridView).toBe("dm");
    expect(wrapper.dataset.gridVisible).toBe("true");
    expect(wrapper.dataset.tool).toBe("none");
    // Background+image layer and grid layer.
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("width")).toBe(String(400 * window.devicePixelRatio));
  });

  it("draws the grid according to the chosen view's style only", () => {
    const dmOnly = withGrid(true, false);
    const a = render(
      <MapStage scene={dmOnly} image={null} size={size} viewport={viewport} gridView="dm" />
    );
    expect(a.container.querySelectorAll("canvas")).toHaveLength(2);
    expect(a.getByTestId("map-stage").dataset.gridVisible).toBe("true");
    a.unmount();

    const b = render(
      <MapStage scene={dmOnly} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(b.container.querySelectorAll("canvas")).toHaveLength(1);
    expect(b.getByTestId("map-stage").dataset.gridVisible).toBe("false");
    b.unmount();

    const c = render(
      <MapStage scene={withGrid(false, true)} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(c.container.querySelectorAll("canvas")).toHaveLength(2);
  });

  it("reports a loaded image and a custom status", () => {
    const img = new Image();
    const { getByTestId, rerender } = render(
      <MapStage scene={scene} image={img} size={size} viewport={viewport} gridView="dm" />
    );
    expect(getByTestId("map-stage").dataset.imageStatus).toBe("loaded");
    rerender(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        imageStatus="waiting"
      />
    );
    expect(getByTestId("map-stage").dataset.imageStatus).toBe("waiting");
  });

  it("zooms around the pointer on wheel when interactive", () => {
    const onViewportChange = vi.fn();
    const { container } = render(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        interactive
        onViewportChange={onViewportChange}
      />
    );
    const content = container.querySelector(".konvajs-content")!;
    fireEvent.wheel(content, { deltaY: -100, clientX: 120, clientY: 80 });
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith(
      zoomAt(viewport, { x: 120, y: 80 }, wheelZoomFactor(-100))
    );
    fireEvent.wheel(content, { deltaY: 100, clientX: 0, clientY: 0 });
    expect(onViewportChange).toHaveBeenLastCalledWith(
      zoomAt(viewport, { x: 0, y: 0 }, wheelZoomFactor(100))
    );
  });

  it("ignores wheel when not interactive", () => {
    const onViewportChange = vi.fn();
    const { container } = render(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        onViewportChange={onViewportChange}
      />
    );
    fireEvent.wheel(container.querySelector(".konvajs-content")!, { deltaY: -100 });
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it("feeds a pointer tool presses, moves and releases in map coordinates", () => {
    const tool = { onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn() };
    const { container, getByTestId } = render(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        interactive
        pointerTool={tool}
      />
    );
    expect(getByTestId("map-stage").dataset.tool).toBe("active");
    const content = container.querySelector(".konvajs-content")!;
    fireEvent.mouseDown(content, { clientX: 40, clientY: 50 });
    fireEvent.mouseMove(content, { clientX: 100, clientY: 110 });
    fireEvent.mouseUp(content, { clientX: 100, clientY: 110 });
    expect(tool.onDown).toHaveBeenCalledWith(screenToMap(viewport, { x: 40, y: 50 }));
    expect(tool.onMove).toHaveBeenCalledWith(screenToMap(viewport, { x: 100, y: 110 }));
    expect(tool.onUp).toHaveBeenCalledWith(screenToMap(viewport, { x: 100, y: 110 }));
    expect(tool.onDown).toHaveBeenCalledWith({ x: 20, y: 20 });
  });

  it("does nothing on pointer events without a tool, and draws the overlay in its own layer", () => {
    const { container, rerender } = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="dm" interactive />
    );
    const content = container.querySelector(".konvajs-content")!;
    expect(() => {
      fireEvent.mouseDown(content, { clientX: 1, clientY: 1 });
      fireEvent.mouseUp(content, { clientX: 1, clientY: 1 });
    }).not.toThrow();
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
    rerender(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        interactive
        overlay={<Rect x={0} y={0} width={10} height={10} />}
      />
    );
    expect(container.querySelectorAll("canvas")).toHaveLength(3);
  });
});
