/**
 * The Konva stage both views render a scene with (ADR 0002). Layers, bottom
 * to top: background colour + map image, grid, tool overlay. Fog, tokens and
 * annotations are added by later tasks.
 *
 * The stage is a pure function of its props: the caller owns the viewport
 * (pan/zoom) and the decoded image. With `interactive`, wheel zooms around
 * the pointer and dragging pans; the caller receives the new viewport. A
 * `pointerTool` receives presses/moves/releases in map coordinates instead
 * of drag-panning (wheel zoom stays), and `overlay` lets the caller draw its
 * preview on top in map coordinates.
 *
 * `gridView` picks which of the scene's two grid styles to draw (ADR 0010).
 * This module is shared by `dm/` and `player/`, so it must not import
 * either, nor the DM store.
 */
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback, type ReactNode } from "react";
import { Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import type { GridStyle, GridView, MapScene } from "../state/model";
import { gridLines } from "./grid";
import {
  screenToMap,
  wheelZoomFactor,
  zoomAt,
  type Point,
  type Size,
  type Viewport,
} from "./viewport";

/** Pointer events in map coordinates, for DM tools. */
export interface StagePointerTool {
  onDown(point: Point): void;
  onMove(point: Point): void;
  onUp(point: Point): void;
}

export interface MapStageProps {
  scene: MapScene;
  /** Decoded background image; null renders only the background colour. */
  image: HTMLImageElement | null;
  /** Stage size in CSS pixels (the container's size). */
  size: Size;
  viewport: Viewport;
  /** Which view's grid style to draw. */
  gridView: GridView;
  /** Enables wheel zoom + drag pan; `onViewportChange` receives the result. */
  interactive?: boolean;
  onViewportChange?: (viewport: Viewport) => void;
  /** While set, presses go to the tool (in map pixels) and drag-pan is off. */
  pointerTool?: StagePointerTool;
  /** Konva nodes drawn above everything, in map coordinates. */
  overlay?: ReactNode;
  /** Reported on the wrapper as `data-image-status` (defaults from `image`). */
  imageStatus?: string;
  /** Extra data attributes for the wrapper, e.g. test ids. */
  "data-testid"?: string;
}

function GridShape({ scene, style }: { scene: MapScene; style: GridStyle }) {
  const { grid, width, height } = scene;
  const lines = gridLines(width, height, grid);
  return (
    <Shape
      listening={false}
      stroke={style.color}
      strokeWidth={1}
      opacity={style.opacity}
      strokeScaleEnabled={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const x of lines.vertical) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (const y of lines.horizontal) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.fillStrokeShape(shape);
      }}
    />
  );
}

type StagePointerEvent = KonvaEventObject<MouseEvent | TouchEvent>;

export function MapStage({
  scene,
  image,
  size,
  viewport,
  gridView,
  interactive = false,
  onViewportChange,
  pointerTool,
  overlay,
  imageStatus,
  "data-testid": testId = "map-stage",
}: MapStageProps) {
  const gridStyle = scene.grid[gridView];

  const onWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      if (!interactive || !onViewportChange) return;
      e.evt.preventDefault();
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      onViewportChange(zoomAt(viewport, pointer, wheelZoomFactor(e.evt.deltaY)));
    },
    [interactive, onViewportChange, viewport]
  );

  const onDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (!interactive || !onViewportChange) return;
      const stage = e.target as Konva.Stage;
      if (stage !== e.target.getStage()) return; // a child was dragged
      onViewportChange({ ...viewport, x: stage.x(), y: stage.y() });
    },
    [interactive, onViewportChange, viewport]
  );

  const toolEvent = useCallback(
    (handler: ((point: Point) => void) | undefined) => (e: StagePointerEvent) => {
      if (!pointerTool || !handler) return;
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;
      if (e.evt.cancelable && e.evt.type.startsWith("touch")) e.evt.preventDefault();
      handler(screenToMap(viewport, pointer));
    },
    [pointerTool, viewport]
  );
  const onToolDown = toolEvent(pointerTool?.onDown);
  const onToolMove = toolEvent(pointerTool?.onMove);
  const onToolUp = toolEvent(pointerTool?.onUp);

  return (
    <div
      data-testid={testId}
      data-map-id={scene.id}
      data-map-name={scene.name}
      data-image-status={imageStatus ?? (image ? "loaded" : "none")}
      data-scale={viewport.scale.toFixed(4)}
      data-grid-view={gridView}
      data-grid-visible={gridStyle.visible ? "true" : "false"}
      data-tool={pointerTool ? "active" : "none"}
      style={{ position: "absolute", inset: 0 }}
    >
      <Stage
        width={Math.max(1, Math.floor(size.width))}
        height={Math.max(1, Math.floor(size.height))}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={interactive && !pointerTool}
        onWheel={onWheel}
        onDragEnd={onDragEnd}
        onMouseDown={onToolDown}
        onMouseMove={onToolMove}
        onMouseUp={onToolUp}
        onTouchStart={onToolDown}
        onTouchMove={onToolMove}
        onTouchEnd={onToolUp}
      >
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={scene.width}
            height={scene.height}
            fill={scene.backgroundColor}
          />
          {image && (
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={scene.width}
              height={scene.height}
            />
          )}
        </Layer>
        {gridStyle.visible && (
          <Layer listening={false}>
            <GridShape scene={scene} style={gridStyle} />
          </Layer>
        )}
        {overlay && <Layer listening={false}>{overlay}</Layer>}
      </Stage>
    </div>
  );
}
