/**
 * The Konva stage both views render a scene with (ADR 0002). Layers, bottom
 * to top: background colour + map image, grid. Fog, tokens and annotations
 * are added by later tasks.
 *
 * The stage is a pure function of its props: the caller owns the viewport
 * (pan/zoom) and the decoded image. With `interactive`, wheel zooms around
 * the pointer and dragging pans; the caller receives the new viewport.
 * This module is shared by `dm/` and `player/`, so it must not import
 * either, nor the DM store.
 */
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback } from "react";
import { Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import type { MapScene } from "../state/model";
import { gridLines } from "./grid";
import { wheelZoomFactor, zoomAt, type Size, type Viewport } from "./viewport";

export interface MapStageProps {
  scene: MapScene;
  /** Decoded background image; null renders only the background colour. */
  image: HTMLImageElement | null;
  /** Stage size in CSS pixels (the container's size). */
  size: Size;
  viewport: Viewport;
  /** Enables wheel zoom + drag pan; `onViewportChange` receives the result. */
  interactive?: boolean;
  onViewportChange?: (viewport: Viewport) => void;
  /** Whether to draw the grid; defaults to the scene's own setting. */
  showGrid?: boolean;
  /** Reported on the wrapper as `data-image-status` (defaults from `image`). */
  imageStatus?: string;
  /** Extra data attributes for the wrapper, e.g. test ids. */
  "data-testid"?: string;
}

function GridShape({ scene }: { scene: MapScene }) {
  const { grid, width, height } = scene;
  const lines = gridLines(width, height, grid);
  return (
    <Shape
      listening={false}
      stroke={grid.color}
      strokeWidth={1}
      opacity={grid.opacity}
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

export function MapStage({
  scene,
  image,
  size,
  viewport,
  interactive = false,
  onViewportChange,
  showGrid,
  imageStatus,
  "data-testid": testId = "map-stage",
}: MapStageProps) {
  const gridVisible = showGrid ?? scene.grid.visible;

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

  return (
    <div
      data-testid={testId}
      data-map-id={scene.id}
      data-map-name={scene.name}
      data-image-status={imageStatus ?? (image ? "loaded" : "none")}
      data-scale={viewport.scale.toFixed(4)}
      style={{ position: "absolute", inset: 0 }}
    >
      <Stage
        width={Math.max(1, Math.floor(size.width))}
        height={Math.max(1, Math.floor(size.height))}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={interactive}
        onWheel={onWheel}
        onDragEnd={onDragEnd}
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
        {gridVisible && (
          <Layer listening={false}>
            <GridShape scene={scene} />
          </Layer>
        )}
      </Stage>
    </div>
  );
}
