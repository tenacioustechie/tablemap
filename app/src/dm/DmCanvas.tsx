/**
 * The DM's map canvas: the active scene on a Konva stage with free pan
 * (drag) and zoom (wheel), fitted to the container whenever the scene
 * changes.
 *
 * With `alignment` active, the canvas runs the grid alignment tool instead
 * of drag-pan: the DM drags across (or clicks the two opposite corners of)
 * one printed map square; the resulting cell size + offset go to
 * `alignment.onAligned`. Esc cancels. The interaction itself is the pure
 * state machine in `map/alignment.ts`; this component only feeds it pointer
 * events in map coordinates and draws the preview box.
 *
 * With `fog` active (T007), a drag across the map becomes one rectangle
 * handed to `fog.onShape` in map pixels (the panel turns it into a fog op).
 * The tool stays on for the next rectangle; Esc abandons a drag in progress,
 * or leaves the tool when none is. The fog base PNG for the active map is
 * read from the database here (the player gets it over the sync channel).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Circle, Rect } from "react-konva";
import {
  ALIGN_CLICK_THRESHOLD_PX,
  alignmentBox,
  IDLE_ALIGNMENT,
  reduceAlignment,
  type AlignmentEvent,
  type AlignmentState,
} from "../map/alignment";
import { MIN_ALIGN_CELL_SIZE } from "../map/grid";
import { MapStage, type StagePointerTool } from "../map/MapStage";
import { useContainerSize } from "../map/useContainerSize";
import { useImageElement } from "../map/useImageElement";
import { fitToView, type Point, type Viewport } from "../map/viewport";
import type { TableMapDb } from "../state/db";
import { rectShape, type FogMode, type FogShape } from "../state/fog";
import { activeMap } from "../state/maps";
import type { GridGeometry } from "../state/model";
import { useTableStore, type TableStore } from "../state/store";
import { useAssetBlob } from "./useAssetBlob";

const FIT_PADDING = 24;
/** Drags shorter than this (in screen px, either axis) are clicks, not rectangles. */
export const FOG_RECT_MIN_PX = 2;

const styles = {
  root: { position: "absolute", inset: 0 },
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#555",
    textAlign: "center",
    padding: 24,
  },
  hud: {
    position: "absolute",
    right: 12,
    bottom: 12,
    display: "flex",
    gap: 8,
    alignItems: "center",
    color: "#aaa",
    fontSize: 12,
    background: "rgba(0,0,0,0.5)",
    padding: "4px 8px",
    borderRadius: 4,
  },
  alignHint: {
    position: "absolute",
    left: 12,
    top: 12,
    right: 12,
    color: "#fff",
    fontSize: 13,
    background: "rgba(20, 60, 100, 0.85)",
    border: "1px solid #8cf",
    padding: "6px 10px",
    borderRadius: 4,
    pointerEvents: "none",
  },
  fogHint: {
    position: "absolute",
    left: 12,
    top: 12,
    right: 12,
    color: "#fff",
    fontSize: 13,
    background: "rgba(80, 60, 10, 0.85)",
    border: "1px solid #fc6",
    padding: "6px 10px",
    borderRadius: 4,
    pointerEvents: "none",
  },
} satisfies Record<string, CSSProperties>;

export interface AlignmentProps {
  /** Called with the derived geometry once both corners are placed. */
  onAligned: (geometry: GridGeometry) => void;
  /** Esc, or a click on the hint's cancel affordance. */
  onCancel: () => void;
}

export interface FogToolProps {
  /** Whether dragged rectangles reveal or hide. */
  mode: FogMode;
  /** Called with each completed rectangle, in map pixels. */
  onShape: (shape: FogShape) => void;
  /** Esc while no drag is in progress. */
  onCancel: () => void;
}

export interface DmCanvasProps {
  store: TableStore;
  db: TableMapDb;
  /** Present while the grid alignment tool is active. */
  alignment?: AlignmentProps;
  /** Present while the fog rectangle tool is active. */
  fog?: FogToolProps;
}

interface RectDrag {
  start: Point;
  current: Point;
}

function FogRectPreview({ drag, mode }: { drag: RectDrag; mode: FogMode }) {
  const rect = rectShape(drag.start, drag.current);
  const colour = mode === "reveal" ? "#fc6" : "#f66";
  return (
    <Rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      stroke={colour}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      dash={[6, 4]}
      fill={mode === "reveal" ? "rgba(255, 204, 102, 0.2)" : "rgba(255, 102, 102, 0.2)"}
      listening={false}
    />
  );
}

function AlignmentPreview({ state, scale }: { state: AlignmentState; scale: number }) {
  if (state.phase === "idle") return null;
  const box = alignmentBox(state);
  const marker = 5 / scale;
  return (
    <>
      {box && (
        <Rect
          x={Math.min(box.first.x, box.second.x)}
          y={Math.min(box.first.y, box.second.y)}
          width={Math.abs(box.second.x - box.first.x)}
          height={Math.abs(box.second.y - box.first.y)}
          stroke="#8cf"
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          dash={[6, 4]}
          fill="rgba(136, 204, 255, 0.15)"
          listening={false}
        />
      )}
      <Circle
        x={state.first.x}
        y={state.first.y}
        radius={marker}
        fill="#8cf"
        listening={false}
      />
    </>
  );
}

export function DmCanvas({ store, db, alignment, fog }: DmCanvasProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const blob = useAssetBlob(db, scene?.imageAssetId);
  const { image, status } = useImageElement(blob);
  const fogBase = useAssetBlob(db, scene?.fogMaskAssetId);
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const fittedFor = useRef<string | null>(null);

  const sceneId = scene?.id ?? null;
  const sceneW = scene?.width ?? 0;
  const sceneH = scene?.height ?? 0;
  const fit = useCallback(() => {
    if (sceneId === null || size.width === 0 || size.height === 0) return;
    setViewport(
      fitToView({ width: sceneW, height: sceneH }, size, FIT_PADDING)
    );
    fittedFor.current = sceneId;
  }, [sceneId, sceneW, sceneH, size]);

  useEffect(() => {
    if (sceneId !== null && fittedFor.current !== sceneId) fit();
  }, [sceneId, fit]);

  // ---- grid alignment tool ------------------------------------------------
  const aligning = alignment !== undefined;
  // The machine's state lives in a ref (so pointer handlers always reduce
  // from the latest state and side effects stay out of React updaters) and
  // is mirrored into state for rendering.
  const alignStateRef = useRef<AlignmentState>(IDLE_ALIGNMENT);
  const [alignState, setAlignStateForRender] = useState<AlignmentState>(IDLE_ALIGNMENT);
  const [alignError, setAlignError] = useState<string | null>(null);
  const alignRef = useRef(alignment);
  alignRef.current = alignment;
  const setAlignState = useCallback((state: AlignmentState) => {
    alignStateRef.current = state;
    setAlignStateForRender(state);
  }, []);

  useEffect(() => {
    // Entering or leaving the tool (or switching maps) starts it afresh.
    setAlignState(IDLE_ALIGNMENT);
    setAlignError(null);
  }, [aligning, sceneId, setAlignState]);

  useEffect(() => {
    if (!aligning) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") alignRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aligning]);

  const feed = useCallback(
    (event: AlignmentEvent) => {
      const step = reduceAlignment(alignStateRef.current, event);
      setAlignState(step.state);
      if (!step.result) return;
      if (step.result.geometry) {
        setAlignError(null);
        alignRef.current?.onAligned(step.result.geometry);
      } else {
        setAlignError(
          `That box is too small to be a cell (at least ${MIN_ALIGN_CELL_SIZE} px). Try again.`
        );
      }
    },
    [setAlignState]
  );

  const scale = viewport.scale;
  const alignTool = useMemo<StagePointerTool | undefined>(
    () =>
      aligning
        ? {
            onDown: (point: Point) => feed({ type: "down", point }),
            onMove: (point: Point) => feed({ type: "move", point }),
            onUp: (point: Point) =>
              feed({ type: "up", point, minDrag: ALIGN_CLICK_THRESHOLD_PX / scale }),
          }
        : undefined,
    [aligning, feed, scale]
  );

  // ---- fog rectangle tool ---------------------------------------------------
  const fogging = fog !== undefined && !aligning;
  const fogRef = useRef(fog);
  fogRef.current = fog;
  const dragRef = useRef<RectDrag | null>(null);
  const [drag, setDragForRender] = useState<RectDrag | null>(null);
  const setDrag = useCallback((next: RectDrag | null) => {
    dragRef.current = next;
    setDragForRender(next);
  }, []);

  useEffect(() => {
    // Entering or leaving the tool (or switching maps) drops any drag.
    setDrag(null);
  }, [fogging, sceneId, setDrag]);

  useEffect(() => {
    if (!fogging) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRef.current) setDrag(null);
      else fogRef.current?.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fogging, setDrag]);

  const fogTool = useMemo<StagePointerTool | undefined>(
    () =>
      fogging
        ? {
            onDown: (point: Point) => setDrag({ start: point, current: point }),
            onMove: (point: Point) => {
              const current = dragRef.current;
              if (current) setDrag({ ...current, current: point });
            },
            onUp: (point: Point) => {
              const current = dragRef.current;
              if (!current) return;
              setDrag(null);
              const rect = rectShape(current.start, point);
              const min = FOG_RECT_MIN_PX / scale;
              if (rect.width < min || rect.height < min) return;
              fogRef.current?.onShape(rect);
            },
          }
        : undefined,
    [fogging, scale, setDrag]
  );

  const pointerTool = alignTool ?? fogTool;
  const overlay = aligning ? (
    <AlignmentPreview state={alignState} scale={scale} />
  ) : fogging && drag && fog ? (
    <FogRectPreview drag={drag} mode={fog.mode} />
  ) : undefined;

  return (
    <div
      ref={containerRef}
      data-testid="dm-canvas-surface"
      data-aligning={aligning ? "true" : "false"}
      data-fogging={fogging ? fog.mode : "false"}
      style={{ ...styles.root, cursor: aligning || fogging ? "crosshair" : undefined }}
    >
      {scene ? (
        <>
          <MapStage
            scene={scene}
            image={image}
            imageStatus={scene.imageAssetId ? status : "none"}
            size={size}
            viewport={viewport}
            gridView="dm"
            interactive
            onViewportChange={setViewport}
            pointerTool={pointerTool}
            overlay={overlay}
            fogBase={fogBase}
            data-testid="dm-map-stage"
          />
          {fogging && (
            <div data-testid="fog-hint" role="status" style={styles.fogHint}>
              <strong>{fog.mode === "reveal" ? "Reveal" : "Hide"} rectangle:</strong>{" "}
              drag across the area. Esc {drag ? "abandons this rectangle" : "stops"}.
            </div>
          )}
          {aligning && (
            <div data-testid="align-hint" role="status" style={styles.alignHint}>
              <strong>Align grid:</strong>{" "}
              {alignState.phase === "second"
                ? "now click the opposite corner of the same square."
                : "drag across one map square, or click one corner then the opposite corner."}{" "}
              Esc cancels.
              {alignError && (
                <span data-testid="align-error" style={{ color: "#fc6" }}>
                  {" "}
                  {alignError}
                </span>
              )}
            </div>
          )}
          <div style={styles.hud}>
            <span data-testid="canvas-zoom">
              {Math.round(viewport.scale * 100)}%
            </span>
            <button type="button" onClick={fit} data-testid="canvas-fit">
              Fit
            </button>
          </div>
        </>
      ) : (
        <div style={styles.placeholder}>
          <p>
            No map selected.
            <br />
            Drop a PNG, JPEG or WebP here, or use the Maps panel.
          </p>
        </div>
      )}
    </div>
  );
}
