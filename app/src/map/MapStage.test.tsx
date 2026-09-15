import { fireEvent, render } from "@testing-library/react";
import Konva from "konva";
import { Rect } from "react-konva";
import { fogFill } from "../state/fog";
import { createBlankMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { createToken } from "../state/tokens";
import { tokenVisionPolygon } from "../state/vision";
import { DIM_ALPHA, MapStage } from "./MapStage";
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
    // Background+image layer, grid layer, token layer (T010), annotation
    // layer (T011) and fog layer.
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("width")).toBe(String(400 * window.devicePixelRatio));
  });

  it("draws the grid according to the chosen view's style only", () => {
    const dmOnly = withGrid(true, false);
    const a = render(
      <MapStage scene={dmOnly} image={null} size={size} viewport={viewport} gridView="dm" />
    );
    expect(a.container.querySelectorAll("canvas")).toHaveLength(5);
    expect(a.getByTestId("map-stage").dataset.gridVisible).toBe("true");
    a.unmount();

    const b = render(
      <MapStage scene={dmOnly} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(b.container.querySelectorAll("canvas")).toHaveLength(4);
    expect(b.getByTestId("map-stage").dataset.gridVisible).toBe("false");
    b.unmount();

    const c = render(
      <MapStage scene={withGrid(false, true)} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(c.container.querySelectorAll("canvas")).toHaveLength(5);
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
    const plain = { shift: false };
    expect(tool.onDown).toHaveBeenCalledWith(screenToMap(viewport, { x: 40, y: 50 }), plain);
    expect(tool.onMove).toHaveBeenCalledWith(screenToMap(viewport, { x: 100, y: 110 }), plain);
    expect(tool.onUp).toHaveBeenCalledWith(screenToMap(viewport, { x: 100, y: 110 }), plain);
    expect(tool.onDown).toHaveBeenCalledWith({ x: 20, y: 20 }, plain);
  });

  it("reports Shift with every pointer event and feeds a double-click to a tool that takes one (T102)", () => {
    // Konva's double-click window is a global 400 ms timer: start this test outside it.
    (Konva as unknown as { _mouseInDblClickWindow: boolean })._mouseInDblClickWindow = false;
    const tool = { onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn(), onDoubleClick: vi.fn() };
    const { container } = render(
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
    const content = container.querySelector(".konvajs-content")!;
    fireEvent.mouseDown(content, { clientX: 40, clientY: 50, shiftKey: true });
    fireEvent.mouseMove(content, { clientX: 60, clientY: 50, shiftKey: true });
    fireEvent.mouseUp(content, { clientX: 60, clientY: 50, shiftKey: true });
    const shifted = { shift: true };
    expect(tool.onDown).toHaveBeenCalledWith(screenToMap(viewport, { x: 40, y: 50 }), shifted);
    expect(tool.onMove).toHaveBeenCalledWith(screenToMap(viewport, { x: 60, y: 50 }), shifted);
    expect(tool.onUp).toHaveBeenCalledWith(screenToMap(viewport, { x: 60, y: 50 }), shifted);
    expect(tool.onDoubleClick).not.toHaveBeenCalled();
    // Konva's double-click: a second release within its click window.
    fireEvent.mouseDown(content, { clientX: 60, clientY: 50 });
    fireEvent.mouseUp(content, { clientX: 60, clientY: 50 });
    expect(tool.onDoubleClick).toHaveBeenCalledTimes(1);
    expect(tool.onDoubleClick).toHaveBeenCalledWith(screenToMap(viewport, { x: 60, y: 50 }), {
      shift: false,
    });
    // A tool without the handler is simply not told.
    const plainTool = { onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn() };
    const second = render(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        interactive
        pointerTool={plainTool}
      />
    );
    const secondContent = second.container.querySelector(".konvajs-content")!;
    expect(() => {
      fireEvent.mouseDown(secondContent, { clientX: 5, clientY: 5 });
      fireEvent.mouseUp(secondContent, { clientX: 5, clientY: 5 });
      fireEvent.mouseDown(secondContent, { clientX: 5, clientY: 5 });
      fireEvent.mouseUp(secondContent, { clientX: 5, clientY: 5 });
    }).not.toThrow();
    expect(plainTool.onUp).toHaveBeenCalledTimes(2);
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
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
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
    expect(container.querySelectorAll("canvas")).toHaveLength(6);
  });

  describe("annotations and pings (T011)", () => {
    const annotated: MapScene = {
      ...scene,
      annotations: [
        { id: "n1", kind: "note", x: 10, y: 10, text: "secret", visibility: "dm" },
        { id: "d1", kind: "drawing", points: [0, 0, 50, 50], color: "#f00", strokeWidth: 4, visibility: "dm" },
        { id: "d2", kind: "drawing", points: [0, 50, 50, 0], color: "#0f0", strokeWidth: 4, visibility: "all" },
        { id: "d3", kind: "drawing", points: [5, 5], color: "#00f", strokeWidth: 6, visibility: "all" },
      ],
    };

    it("draws only the drawings the view may see; notes are never drawn by the stage", () => {
      const dm = render(
        <MapStage scene={annotated} image={null} size={size} viewport={viewport} gridView="dm" />
      );
      expect(dm.getByTestId("map-stage").dataset.annotations).toBe("4");
      expect(dm.getByTestId("map-stage").dataset.annotationsShown).toBe("3");
      dm.unmount();
      const player = render(
        <MapStage scene={annotated} image={null} size={size} viewport={viewport} gridView="player" />
      );
      expect(player.getByTestId("map-stage").dataset.annotations).toBe("4");
      expect(player.getByTestId("map-stage").dataset.annotationsShown).toBe("2");
    });

    it("animates active pings of this scene in a layer above the fog, then drops the layer", () => {
      const now = Date.now();
      const pings = [
        { id: "p1", mapId: "s", x: 10, y: 10, at: now },
        { id: "p2", mapId: "other", x: 10, y: 10, at: now },
        { id: "p3", mapId: "s", x: 10, y: 10, at: now - 60_000 },
      ];
      const { container, getByTestId, rerender } = render(
        <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="player" pings={pings} />
      );
      expect(getByTestId("map-stage").dataset.pings).toBe("1");
      expect(container.querySelectorAll("canvas")).toHaveLength(6);
      rerender(
        <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="player" pings={[]} />
      );
      expect(getByTestId("map-stage").dataset.pings).toBe("0");
      expect(container.querySelectorAll("canvas")).toHaveLength(5);
    });

    it("reports an Alt-click in map coordinates and keeps that press from the pointer tool", () => {
      const onAltClick = vi.fn();
      const tool = { onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn() };
      const { container } = render(
        <MapStage
          scene={scene}
          image={null}
          size={size}
          viewport={viewport}
          gridView="dm"
          interactive
          pointerTool={tool}
          onAltClick={onAltClick}
        />
      );
      const content = container.querySelector(".konvajs-content")!;
      fireEvent.mouseDown(content, { clientX: 40, clientY: 50, altKey: true });
      fireEvent.mouseUp(content, { clientX: 40, clientY: 50, altKey: true });
      fireEvent.click(content, { clientX: 40, clientY: 50, altKey: true });
      expect(onAltClick).toHaveBeenCalledWith({ x: 20, y: 20 });
      expect(tool.onDown).not.toHaveBeenCalled();
      expect(tool.onUp).not.toHaveBeenCalled();
      // A plain click is not a ping and does reach the tool.
      fireEvent.mouseDown(content, { clientX: 40, clientY: 50 });
      fireEvent.mouseUp(content, { clientX: 40, clientY: 50 });
      fireEvent.click(content, { clientX: 40, clientY: 50 });
      expect(onAltClick).toHaveBeenCalledTimes(1);
      expect(tool.onDown).toHaveBeenCalledTimes(1);
    });
  });

  it("rotates the stage and draws controls in their own listening layer (T009)", () => {
    const { container, getByTestId, rerender } = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="player" />
    );
    expect(getByTestId("map-stage").dataset.rotation).toBe("0");
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
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
    expect(container.querySelectorAll("canvas")).toHaveLength(6);
  });

  it("draws the map image turned by the scene's imageRotation, covering the turned scene (T017)", () => {
    const img = new Image();
    // The asset is 200 x 150; a quarter turn makes the scene 150 x 200.
    const cases = [
      { imageRotation: 0 as const, width: 200, height: 150, x: 0, y: 0 },
      { imageRotation: 90 as const, width: 150, height: 200, x: 150, y: 0 },
      { imageRotation: 180 as const, width: 200, height: 150, x: 200, y: 150 },
      { imageRotation: 270 as const, width: 150, height: 200, x: 0, y: 200 },
    ];
    for (const c of cases) {
      const turned: MapScene = { ...scene, width: c.width, height: c.height, imageRotation: c.imageRotation };
      const { getByTestId, unmount } = render(
        <MapStage scene={turned} image={img} size={size} viewport={viewport} gridView="player" />
      );
      expect(getByTestId("map-stage").dataset.imageRotation).toBe(String(c.imageRotation));
      expect(getByTestId("map-stage").dataset.mapSize).toBe(`${c.width},${c.height}`);
      const stage = Konva.stages[Konva.stages.length - 1];
      const node = stage.findOne<Konva.Image>(".map-image")!;
      expect(node.rotation()).toBe(c.imageRotation);
      expect({ x: node.x(), y: node.y() }).toEqual({ x: c.x, y: c.y });
      // The node keeps the asset's own size; its rotated box is the scene.
      expect({ width: node.width(), height: node.height() }).toEqual({ width: 200, height: 150 });
      const box = node.getClientRect({ relativeTo: stage });
      expect(box.x).toBeCloseTo(0);
      expect(box.y).toBeCloseTo(0);
      expect(box.width).toBeCloseTo(c.width);
      expect(box.height).toBeCloseTo(c.height);
      // The viewport (TV) rotation is a separate transform on the stage.
      expect(getByTestId("map-stage").dataset.rotation).toBe("0");
      unmount();
    }
  });

  it("draws the underlay in its own layer between the grid and the tokens (T013)", () => {
    const { container, rerender } = render(
      <MapStage scene={scene} image={null} size={size} viewport={viewport} gridView="dm" />
    );
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
    rerender(
      <MapStage
        scene={scene}
        image={null}
        size={size}
        viewport={viewport}
        gridView="dm"
        underlay={<Rect x={0} y={0} width={10} height={10} draggable name="handle" />}
        controls={<Rect x={0} y={0} width={10} height={10} name="frame" />}
      />
    );
    // Image, grid, underlay, tokens, annotations, fog, controls: the underlay's
    // canvas is the third from the bottom, the controls' the top one.
    expect(container.querySelectorAll("canvas")).toHaveLength(7);
    const stage = Konva.stages[Konva.stages.length - 1];
    const layers = stage.getLayers().map((layer) => layer.name());
    expect(layers.indexOf("underlay")).toBe(2);
    expect(layers.indexOf("tokens")).toBe(3);
    expect(layers.indexOf("controls")).toBe(layers.length - 1);
    expect(stage.findOne(".handle")!.getLayer()!.name()).toBe("underlay");
    expect(stage.findOne(".frame")!.getLayer()!.name()).toBe("controls");
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
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
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

    it("a drag reports where the token would land on every move, clamped and snapped, then the drop (T106)", () => {
      const tool = { selectedId: null, onSelect: vi.fn(), onMove: vi.fn(), onDragMove: vi.fn() };
      const { getByTestId } = render(
        <MapStage scene={revealed} image={null} size={size} viewport={viewport} gridView="dm" tokenTool={tool} />
      );
      const stage = Konva.stages.find((s) => getByTestId("map-stage").contains(s.container()))!;
      const node = stage.findOne<Konva.Group>("#token-orc")!;
      node.position({ x: 62, y: 81 });
      node.fire("dragmove", { evt: new MouseEvent("mousemove") });
      expect(tool.onDragMove).toHaveBeenLastCalledWith("orc", { x: 50, y: 100 });
      expect(node.position()).toEqual({ x: 50, y: 100 });
      node.position({ x: 400, y: 30 }); // off the map: clamped to x = 175 (centre on the edge), then snapped
      node.fire("dragmove", { evt: new MouseEvent("mousemove") });
      expect(tool.onDragMove).toHaveBeenLastCalledWith("orc", { x: 200, y: 50 });
      expect(tool.onMove).not.toHaveBeenCalled();
      node.fire("dragend", { evt: new MouseEvent("mouseup") });
      expect(tool.onMove).toHaveBeenCalledWith("orc", { x: 200, y: 50 });
    });
  });

  describe("dim (T107)", () => {
    // The scene is 200 x 150 map px; vision 1 from (75, 75) sees a 50 px circle.
    const seer = createToken({ id: "seer", x: 50, y: 50, appearance: { type: "disc", color: "#0af" }, vision: 1 });
    const blind = { ...seer, id: "blind", x: 100, vision: 0 };
    const stageOf = (wrapper: HTMLElement) => Konva.stages.find((s) => wrapper.contains(s.container()))!;

    it("a map with no seeing token (auto) has no dim layer: the same canvases and layers as before vision", () => {
      const { container, getByTestId } = render(
        <MapStage scene={{ ...scene, tokens: [blind] }} image={null} size={size} viewport={viewport} gridView="player" />
      );
      const wrapper = getByTestId("map-stage");
      expect(wrapper.dataset.dim).toBe("false");
      expect(wrapper.dataset.dimPolygons).toBe("0");
      expect(container.querySelectorAll("canvas")).toHaveLength(5);
      expect(stageOf(wrapper).getLayers().map((l) => l.name())).toEqual(["", "", "tokens", "annotations", "fog"]);
      expect(stageOf(wrapper).findOne(".dim-shade")).toBeFalsy();
    });

    it("one seeing token: a dim layer beneath the tokens, shaded per view, with what the token sees cut out", () => {
      const seen: MapScene = { ...scene, tokens: [seer, blind] };
      for (const view of ["player", "dm"] as const) {
        const { container, getByTestId, unmount } = render(
          <MapStage scene={seen} image={null} size={size} viewport={viewport} gridView={view} />
        );
        const wrapper = getByTestId("map-stage");
        expect(wrapper.dataset.dim).toBe("true");
        expect(wrapper.dataset.dimPolygons).toBe("1");
        expect(container.querySelectorAll("canvas")).toHaveLength(6);
        const stage = stageOf(wrapper);
        expect(stage.getLayers().map((l) => l.name())).toEqual(["", "", "dim", "tokens", "annotations", "fog"]);
        const shade = stage.findOne<Konva.Rect>(".dim-shade")!;
        expect(shade.opacity()).toBe(DIM_ALPHA[view]);
        expect(shade.fill()).toBe("#000");
        expect([shade.x(), shade.y(), shade.width(), shade.height()]).toEqual([0, 0, 200, 150]);
        const cuts = stage.find<Konva.Line>(".dim-visible");
        expect(cuts).toHaveLength(1);
        expect(cuts[0].points()).toEqual(tokenVisionPolygon(seen, seer));
        expect(cuts[0].closed()).toBe(true);
        expect(cuts[0].opacity()).toBe(1);
        expect(cuts[0].globalCompositeOperation()).toBe("destination-out");
        // Tokens standing on dimmed ground are still drawn (jsdom reads every pixel as revealed).
        expect(wrapper.dataset.tokensShown).toBe("2");
        unmount();
      }
      expect(DIM_ALPHA).toEqual({ dm: 0.25, player: 0.6 });
    });

    it("the underlay stays beneath the dim; the dim stays beneath the tokens", () => {
      const { getByTestId } = render(
        <MapStage
          scene={{ ...scene, tokens: [seer] }}
          image={null}
          size={size}
          viewport={viewport}
          gridView="dm"
          underlay={<Rect x={0} y={0} width={10} height={10} name="handle" />}
        />
      );
      const layers = stageOf(getByTestId("map-stage")).getLayers().map((l) => l.name());
      expect(layers).toEqual(["", "", "underlay", "dim", "tokens", "annotations", "fog"]);
    });

    it("visionDim off removes it; on forces it, with nothing cut out while no token sees", () => {
      const props = { image: null, size, viewport, gridView: "player" as const };
      const { container, getByTestId, rerender } = render(
        <MapStage {...props} scene={{ ...scene, tokens: [seer], visionDim: "off" }} />
      );
      const wrapper = getByTestId("map-stage");
      expect(wrapper.dataset.dim).toBe("false");
      expect(container.querySelectorAll("canvas")).toHaveLength(5);

      rerender(<MapStage {...props} scene={{ ...scene, tokens: [blind], visionDim: "on" }} />);
      expect(wrapper.dataset.dim).toBe("true");
      expect(wrapper.dataset.dimPolygons).toBe("0");
      expect(container.querySelectorAll("canvas")).toHaveLength(6);
      expect(stageOf(wrapper).findOne(".dim-shade")).toBeTruthy();
      expect(stageOf(wrapper).find(".dim-visible")).toHaveLength(0);

      rerender(<MapStage {...props} scene={{ ...scene, tokens: [seer], visionDim: "on" }} />);
      expect(wrapper.dataset.dimPolygons).toBe("1");

      rerender(<MapStage {...props} scene={{ ...scene, tokens: [blind], visionDim: "auto" }} />);
      expect(wrapper.dataset.dim).toBe("false");
      expect(container.querySelectorAll("canvas")).toHaveLength(5);
    });

    it("keeps the cut-outs through a fog op (not recomputed) and moves them with the token", () => {
      const props = { image: null, size, viewport, gridView: "player" as const };
      const seen: MapScene = { ...scene, tokens: [seer] };
      const { getByTestId, rerender } = render(<MapStage {...props} scene={seen} />);
      const stage = stageOf(getByTestId("map-stage"));
      const before = stage.findOne<Konva.Line>(".dim-visible")!.points();

      rerender(<MapStage {...props} scene={{ ...seen, fogOps: [fogFill("reveal")] }} />);
      expect(stage.findOne<Konva.Line>(".dim-visible")!.points()).toBe(before);

      const moved: MapScene = { ...seen, tokens: [{ ...seer, x: 100 }] };
      rerender(<MapStage {...props} scene={moved} />);
      const after = stage.findOne<Konva.Line>(".dim-visible")!.points();
      expect(after).toEqual(tokenVisionPolygon(moved, moved.tokens[0]));
      expect(after).not.toEqual(before);
    });

    it("draws the dim overlay inside the dim layer, and none of it while the map is not dimmed", () => {
      const props = { image: null, size, viewport, gridView: "dm" as const };
      const lift = <Rect name="lift" x={0} y={0} width={10} height={10} globalCompositeOperation="destination-out" />;
      const { container, getByTestId, rerender } = render(
        <MapStage {...props} scene={{ ...scene, tokens: [seer] }} dimOverlay={lift} />
      );
      const stage = stageOf(getByTestId("map-stage"));
      expect(stage.findOne(".lift")!.getLayer()!.name()).toBe("dim");
      expect(container.querySelectorAll("canvas")).toHaveLength(6);
      rerender(<MapStage {...props} scene={{ ...scene, tokens: [blind] }} dimOverlay={lift} />);
      expect(stage.findOne(".lift")).toBeFalsy();
      expect(container.querySelectorAll("canvas")).toHaveLength(5);
    });
  });

  describe("pan override (T018)", () => {
    const tool = () => ({ onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn() });
    function mount(panOverride: boolean, pointerTool = tool()) {
      const onViewportChange = vi.fn();
      const utils = render(
        <MapStage
          scene={scene}
          image={null}
          size={size}
          viewport={viewport}
          gridView="dm"
          interactive
          onViewportChange={onViewportChange}
          pointerTool={pointerTool}
          panOverride={panOverride}
        />
      );
      const content = utils.container.querySelector(".konvajs-content")!;
      return { ...utils, content, onViewportChange, pointerTool };
    }

    it("with panOverride, a press pans from the viewport it started at and the tool sees nothing", () => {
      const { content, getByTestId, onViewportChange, pointerTool } = mount(true);
      const wrapper = getByTestId("map-stage");
      expect(wrapper.dataset.panning).toBe("false");
      expect(wrapper.dataset.tool).toBe("active");
      fireEvent.mouseDown(content, { clientX: 40, clientY: 50 });
      expect(wrapper.dataset.panning).toBe("true");
      fireEvent.mouseMove(content, { clientX: 70, clientY: 45 });
      expect(onViewportChange).toHaveBeenLastCalledWith({ ...viewport, x: 10 + 30, y: 20 - 5 });
      fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
      expect(onViewportChange).toHaveBeenLastCalledWith({ ...viewport, x: 10 + 60, y: 20 + 50 });
      fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
      expect(wrapper.dataset.panning).toBe("false");
      expect(onViewportChange).toHaveBeenCalledTimes(2);
      expect(pointerTool.onDown).not.toHaveBeenCalled();
      expect(pointerTool.onMove).not.toHaveBeenCalled();
      expect(pointerTool.onUp).not.toHaveBeenCalled();

      // After the release the tool gets its events again.
      fireEvent.mouseMove(content, { clientX: 10, clientY: 10 });
      expect(pointerTool.onMove).toHaveBeenCalledTimes(1);
    });

    it("a middle-button press pans without the override; other buttons go to the tool", () => {
      const { content, getByTestId, onViewportChange, pointerTool } = mount(false);
      const wrapper = getByTestId("map-stage");
      const down = fireEvent.mouseDown(content, { clientX: 0, clientY: 0, button: 1 });
      expect(down).toBe(false); // the browser's autoscroll is suppressed
      expect(wrapper.dataset.panning).toBe("true");
      fireEvent.mouseMove(content, { clientX: 25, clientY: 15, button: 1 });
      expect(onViewportChange).toHaveBeenLastCalledWith({ ...viewport, x: 35, y: 35 });
      fireEvent.mouseUp(content, { clientX: 25, clientY: 15, button: 1 });
      expect(wrapper.dataset.panning).toBe("false");
      expect(pointerTool.onDown).not.toHaveBeenCalled();
      expect(pointerTool.onUp).not.toHaveBeenCalled();

      fireEvent.mouseDown(content, { clientX: 0, clientY: 0, button: 0 });
      fireEvent.mouseUp(content, { clientX: 0, clientY: 0, button: 0 });
      expect(pointerTool.onDown).toHaveBeenCalledTimes(1);
      expect(pointerTool.onUp).toHaveBeenCalledTimes(1);
      expect(wrapper.dataset.panning).toBe("false");
    });

    it("pans by hand with no tool too, and never when not interactive", () => {
      const onViewportChange = vi.fn();
      const a = render(
        <MapStage
          scene={scene}
          image={null}
          size={size}
          viewport={viewport}
          gridView="dm"
          interactive
          onViewportChange={onViewportChange}
          panOverride
        />
      );
      const content = a.container.querySelector(".konvajs-content")!;
      fireEvent.mouseDown(content, { clientX: 0, clientY: 0 });
      fireEvent.mouseMove(content, { clientX: 5, clientY: 5 });
      fireEvent.mouseUp(content, { clientX: 5, clientY: 5 });
      expect(onViewportChange).toHaveBeenLastCalledWith({ ...viewport, x: 15, y: 25 });
      a.unmount();

      const player = render(
        <MapStage
          scene={scene}
          image={null}
          size={size}
          viewport={viewport}
          gridView="player"
          onViewportChange={onViewportChange}
          panOverride
        />
      );
      onViewportChange.mockClear();
      const playerContent = player.container.querySelector(".konvajs-content")!;
      fireEvent.mouseDown(playerContent, { clientX: 0, clientY: 0, button: 1 });
      fireEvent.mouseMove(playerContent, { clientX: 5, clientY: 5, button: 1 });
      fireEvent.mouseUp(playerContent, { clientX: 5, clientY: 5, button: 1 });
      expect(onViewportChange).not.toHaveBeenCalled();
      expect(player.getByTestId("map-stage").dataset.panning).toBe("false");
    });
  });
});
