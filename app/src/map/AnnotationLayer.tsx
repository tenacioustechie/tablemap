/**
 * The annotation layer of the stage (T011, ADR 0016), between the tokens
 * and the fog: freehand drawings as round-capped polylines in map pixels.
 * Shared by both views; it draws exactly `drawingsForView(annotations,
 * view)`, so a DM-only drawing never appears on the player, and it never
 * draws notes at all — note markers are DM chrome, drawn by the DM canvas
 * in its controls layer, so no code path here could put one on the TV.
 *
 * Sitting under the fog, a drawing in a fogged area is hidden from the
 * players exactly like the map under it.
 */
import { Circle, Layer, Line } from "react-konva";
import { drawingsForView, type DrawingAnnotation } from "../state/annotations";
import type { Annotation, GridView } from "../state/model";

export interface AnnotationLayerProps {
  annotations: readonly Annotation[];
  view: GridView;
}

/** One stroke; a single point is a dot of the stroke's width. */
export function DrawingNode({ drawing }: { drawing: DrawingAnnotation }) {
  const { points, color, strokeWidth } = drawing;
  if (points.length < 4) {
    return (
      <Circle
        name="drawing"
        id={`drawing-${drawing.id}`}
        x={points[0]}
        y={points[1]}
        radius={strokeWidth / 2}
        fill={color}
        listening={false}
      />
    );
  }
  return (
    <Line
      name="drawing"
      id={`drawing-${drawing.id}`}
      points={points}
      stroke={color}
      strokeWidth={strokeWidth}
      lineCap="round"
      lineJoin="round"
      listening={false}
    />
  );
}

export function AnnotationLayer({ annotations, view }: AnnotationLayerProps) {
  const drawings = drawingsForView(annotations, view);
  return (
    <Layer name="annotations" listening={false}>
      {drawings.map((d) => (
        <DrawingNode key={d.id} drawing={d} />
      ))}
    </Layer>
  );
}

/** How many of a scene's annotations the given view draws. */
export function shownAnnotationCount(annotations: readonly Annotation[], view: GridView): number {
  return drawingsForView(annotations, view).length;
}
