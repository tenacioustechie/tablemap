import { fireEvent, render } from "@testing-library/react";
import { Rect } from "react-konva";
import { fogFill } from "../state/fog";
import { createBlankMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { createToken } from "../state/tokens";
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
    expect(wrapper.dataset.fogStatus).toBe("ready");
    expect(wrapper.dataset.fogOps).toBe("0");
    expect(wrapper.dataset.fogHistory).toBe("0");
    // Background+image layer, grid layer, token layer (T010) and fog layer.
    expect(container.querySelectorAll("canvas")).toHaveLength(4);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("width")).toBe(String(400 * window.devicePixelRatio));
  });

  it("draws the grid according to the chosen view's style only", () => {
    const dmOnly = withGrid(true, false);
    const a = render(
      <MapStage scene={dmOnly} image={null} size={size} viewport={viewport} gridView="dm" />
    );
    expect(a.container.querySelectorAll("canvas")).toHaveLength(4);
    expect(a.getByTestId("map-stage").dataset.gridVisible).toBe("true");
    a.unmount();

    const b = render(
      <MapStage scene={dmOnly} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(b.container.querySelectorAll("canvas")).toHaveLength(3);
    expect(b.getByTestId("map-stage").dataset.gridVisible).toBe("false");
    b.unmount();

    const c = render(
      <MapStage scene={withGrid(false, true)} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(c.container.querySelectorAll("canvas")).toHaveLength(4);
  });

  it("always draws a fog layer, dimmed for the DM and opaque for the player (T007)", () => {
    const fogged: MapScene = {
      ...scene,
      fogOps: [{ type: "shape", mode: "reveal", shape: { kind: "rect", x: 0, y: 0, width: 10, height: 10 } }],
      fogOpsFrom: 3,
    };
    const dm = render(
      <MapStage scene={fogged} image={null} size={size} viewport={viewport} gridView="dm" />
    );
    const stage = dm.container.querySelector<HTMLDivElement>(".konvajs-content")!;
    // Konva mirrors the scene graph on the stage node; the fog image is the
    // only node of the layer named "fog".
    const konva = (stage as unknown as { __konvaStage?: unknown }).__konvaStage;
    expect(konva).toBeUndefined(); // no such handle: assert through data attributes instead
    expect(dm.getByTestId("map-stage").dataset.fogOps).toBe("1");
    expect(dm.getByTestId("map-stage").dataset.fogHistory).toBe("4");
    expect(dm.getByTestId("map-stage").dataset.fogStatus).toBe("ready");
    dm.unmount();

    // A base the player has not received yet: nothing is revealed (waiting).
    const withBase: MapScene = { ...fogged, fogMaskAssetId: "mask-1" };
    const player = render(
      <MapStage scene={withBase} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(player.getByTestId("map-stage").dataset.fogStatus).toBe("waiting");
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
    expect(container.querySelectorAll("canvas")).toHaveLength(4);
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
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
  });

  it("rotates the stage and draws controls in their own listening layer (T009)", () => {
    const { container, getByTestId, rerender } = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(getByTestId("map-stage").dataset.rotation).toBe("0");
    expect(container.querySelectorAll("canvas")).toHaveLength(4);
    rerender(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={{ ...viewport, rotation: 90 }}
        gridView="player"
        controls={<Rect x={0} y={0} width={10} height={10} draggable />}
      />
    );
    expect(getByTestId("map-stage").dataset.rotation).toBe("90");
    expect(getByTestId("map-stage").dataset.scale).toBe("1.5000");
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
  });

  it("draws a fog overlay inside the fog layer (no extra canvas) and reports the viewport (T008)", () => {
    const { container, getByTestId } = render(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        fogOverlay={<Rect x={0} y={0} width={10} height={10} globalCompositeOperation="destination-out" />}
      />
    );
    expect(container.querySelectorAll("canvas")).toHaveLength(4);
    expect(getByTestId("map-stage").dataset.viewportX).toBe("10.00");
    expect(getByTestId("map-stage").dataset.viewportY).toBe("20.00");
  });

  describe("tokens (T010)", () => {
    const orc = createToken({ id: "orc", x: 50, y: 50, appearance: { type: "disc", color: "#f00" }, badge: "O" });
    const ghost = createToken({ id: "ghost", x: 100, y: 50, appearance: { type: "disc", color: "#0f0" }, hidden: true });
    // The scene is 200 x 150 map px (4 x 3 cells of 50).
    const goblin = createToken({ id: "gob", x: 0, y: 50, appearance: { type: "image", assetId: "img" }, size: 2 });
    const revealed: MapScene = { ...scene, tokens: [orc, ghost, goblin], fogOps: [fogFill("reveal")] };

    it("reports the tokens and draws all of them for the DM, only the visible ones for the player", () => {
      const dm = render(
        <MapStage scene={revealed} image={null} size={size} viewport={viewport} gridView="dm" />
      );
      const wrapper = dm.getByTestId("map-stage");
      expect(wrapper.dataset.tokens).toBe("3");
      expect(wrapper.dataset.tokensShown).toBe("3");
      expect(wrapper.dataset.tokensHidden).toBe("1");
      // jsdom's blank canvas reads as revealed everywhere, and the map is revealed anyway.
      expect(wrapper.dataset.tokensFogged).toBe("0");
      expect(wrapper.dataset.tokenSelected).toBe("");
      dm.unmount();

      const player = render(
        <MapStage scene={revealed} image={null} size={size} viewport={viewport} gridView="player" />
      );
      expect(player.getByTestId("map-stage").dataset.tokensShown).toBe("2");
      expect(player.getByTestId("map-stage").dataset.tokensHidden).toBe("1");
    });

    it("while the fog base is missing (waiting) every token is fogged and the player draws none", () => {
      const waiting: MapScene = { ...revealed, fogMaskAssetId: "mask-1" };
      const { getByTestId, rerender } = render(
        <MapStage scene={waiting} image={null} size={size} viewport={viewport} gridView="player" />
      );
      expect(getByTestId("map-stage").dataset.fogStatus).toBe("waiting");
      expect(getByTestId("map-stage").dataset.tokensShown).toBe("0");
      expect(getByTestId("map-stage").dataset.tokensFogged).toBe("2"); // the hidden one reports "hidden"
      expect(getByTestId("map-stage").dataset.tokensHidden).toBe("1");
      // The DM still draws them all (dimmed under the fog).
      rerender(<MapStage scene={waiting} image={null} size={size} viewport={viewport} gridView="dm" />);
      expect(getByTestId("map-stage").dataset.tokensShown).toBe("3");
    });

    it("reads the fog mask's pixels to decide: a token on a fogged cell is left out on the player", () => {
      // Make the scratch canvas report the mask as hidden left of x = 100 map px.
      const original = HTMLCanvasElement.prototype.getContext;
      const spy = vi
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockImplementation(function (this: HTMLCanvasElement, id: string, options?: unknown) {
          const base = original.call(this, id, options as CanvasRenderingContext2DSettings);
          if (!base || !(options as { willReadFrequently?: boolean } | undefined)?.willReadFrequently) return base;
          let sx = 0;
          return new Proxy(base, {
            get(target, prop) {
              if (prop === "drawImage") return (_m: unknown, x: number) => void (sx = x);
              if (prop === "getImageData")
                return () => ({ data: new Uint8ClampedArray([0, 0, 0, sx < 100 ? 255 : 0]), width: 1, height: 1 });
              return Reflect.get(target, prop);
            },
          });
        } as typeof HTMLCanvasElement.prototype.getContext);
      try {
        const { getByTestId, rerender } = render(
          <MapStage scene={revealed} image={null} size={size} viewport={viewport} gridView="player" />
        );
        // orc at (50, 50) samples (75, 75): fogged. goblin (2x2 at 0,50) samples x = 25 and 75: fogged.
        expect(getByTestId("map-stage").dataset.tokensFogged).toBe("2");
        expect(getByTestId("map-stage").dataset.tokensShown).toBe("0");
        const moved: MapScene = { ...revealed, tokens: [{ ...orc, x: 100 }, ghost, goblin] };
        rerender(<MapStage scene={moved} image={null} size={size} viewport={viewport} gridView="player" />);
        expect(getByTestId("map-stage").dataset.tokensFogged).toBe("1");
        expect(getByTestId("map-stage").dataset.tokensShown).toBe("1");
      } finally {
        spy.mockRestore();
      }
    });

    it("with a token tool the layer listens, reports the selection and the token images are looked up by asset id", () => {
      const tool = { selectedId: "orc", onSelect: vi.fn(), onMove: vi.fn() };
      const { getByTestId } = render(
        <MapStage
          scene={revealed}
          image={null}
          size={size}
          viewport={viewport}
          gridView="dm"
          tokenTool={tool}
          tokenImages={{ img: new Blob(["png"], { type: "image/png" }) }}
        />
      );
      expect(getByTestId("map-stage").dataset.tokenSelected).toBe("orc");
      expect(getByTestId("map-stage").dataset.tokensShown).toBe("3");
    });
  });
});
