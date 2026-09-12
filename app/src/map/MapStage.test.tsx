import { fireEvent, render } from "@testing-library/react";
import { createBlankMapScene } from "../state/maps";
import { MapStage } from "./MapStage";
import { zoomAt, wheelZoomFactor, type Viewport } from "./viewport";

const scene = createBlankMapScene({ id: "s", columns: 4, rows: 3, cellSize: 50, color: "#123456" });
const size = { width: 400, height: 300 };
const viewport: Viewport = { x: 10, y: 20, scale: 1.5 };

describe("MapStage", () => {
  it("mounts a Konva stage with a canvas per layer and reports the scene", () => {
    const { container, getByTestId } = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} />
    );
    const wrapper = getByTestId("map-stage");
    expect(wrapper.dataset.mapId).toBe("s");
    expect(wrapper.dataset.mapName).toBe("Blank map");
    expect(wrapper.dataset.imageStatus).toBe("none");
    expect(wrapper.dataset.scale).toBe("1.5000");
    // Background+image layer and grid layer.
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("width")).toBe(String(400 * window.devicePixelRatio));
  });

  it("omits the grid layer when the scene hides its grid or showGrid is false", () => {
    const hidden = { ...scene, grid: { ...scene.grid, visible: false } };
    const a = render(<MapStage scene={hidden} image={null} size={size} viewport={viewport} />);
    expect(a.container.querySelectorAll("canvas")).toHaveLength(1);
    a.unmount();
    const b = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} showGrid={false} />
    );
    expect(b.container.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("reports a loaded image and a custom status", () => {
    const img = new Image();
    const { getByTestId, rerender } = render(
      <MapStage scene={scene} image={img} size={size} viewport={viewport} />
    );
    expect(getByTestId("map-stage").dataset.imageStatus).toBe("loaded");
    rerender(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} imageStatus="waiting" />
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
        onViewportChange={onViewportChange}
      />
    );
    fireEvent.wheel(container.querySelector(".konvajs-content")!, { deltaY: -100 });
    expect(onViewportChange).not.toHaveBeenCalled();
  });
});
