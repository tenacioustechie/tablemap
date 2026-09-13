/**
 * The Konva stage both views render a scene with (ADR 0002). Layers, bottom
 * to top: background colour + map image, grid, underlay (T013: the DM's
 * invisible drag handles that tokens must win over), tokens (T010),
 * annotations (T011: drawings, under the fog), fog, tool overlay, pings
 * (T011: above the fog, only while one is playing), controls.
 *
 * `onAltClick` (T011) receives a click made with Alt held, in map pixels,
 * whatever else is going on (a pointer tool does not see that press): the
 * DM's ping gesture.
 *
 * The stage is a pure function of its props: the caller owns the viewport
 * (pan/zoom/rotation) and the decoded image. The image is drawn turned by
 * the scene's own `imageRotation` (T017: a document-level quarter turn that
 * the whole scene shares), independently of the viewport's rotation (the
 * player's TV rotation), which is applied to the stage on top. With `interactive`, wheel zooms
 * around the pointer and dragging pans; the caller receives the new
 * viewport. A `pointerTool` receives presses/moves/releases in map
 * coordinates instead of drag-panning (wheel zoom stays), and `overlay` lets
 * the caller draw its preview on top in map coordinates (`fogOverlay`:
 * inside the fog layer, so a preview can punch through the mask;
 * `controls`: a listening layer for draggable handles).
 *
 * **Pan override** (T018, ADR 0022): while `interactive`, a middle-button
 * press, or any press while `panOverride` is set (the DM canvas sets it
 * while Space is held), starts a pan of the stage by hand — whatever tool
 * is armed, the tool never sees that press, the moves or the release. The
 * pan follows the pointer through window listeners, so it survives leaving
 * the stage, and reports the viewport as it goes; `data-panning` says when
 * one is in progress. Konva's own drag-pan is off during an override so the
 * two cannot fight over a left-button press.
 *
 * `gridView` picks which of the scene's two grid styles to draw (ADR 0010)
 * and how the fog is composited: the DM sees fogged areas dimmed
 * (`FOG_ALPHA.dm`), the player sees them opaque black (ADR 0012). The fog
 * mask itself is an offscreen canvas kept in step with the scene's fog ops
 * by `useFogMask`; `fogBase` is the scene's base PNG (from storage on the DM
 * side, from the sync mirror on the player side), undefined until it is
 * available.
 *
 * This module is shared by `dm/` and `player/`, so it must not import
 * either, nor the DM store.
 */
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import type { AssetId, GridStyle, GridView, MapScene } from "../state/model";
import type { Ping } from "../state/ping";
import { imageAssetSize, rotatedImagePlacement } from "../state/sceneRotation";
import { sceneTokenVisibility } from "../state/tokens";
import { AnnotationLayer, shownAnnotationCount } from "./AnnotationLayer";
import { gridLines } from "./grid";
import { PingLayer } from "./PingLayer";
import { shownTokenCount, TokenLayer, type TokenTool } from "./TokenLayer";
import { useFogMask } from "./useFogMask";
import { useImageElement } from "./useImageElement";
import { usePings } from "./usePings";
import {
  screenToMap,
  wheelZoomFactor,
  zoomAt,
  type Point,
  type Size,
  type Viewport,
} from "./viewport";

/** Opacity of the fog layer per view: the DM sees through it, players do not. */
export const FOG_ALPHA: Record<GridView, number> = { dm: 0.5, player: 1 };

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
  /**
   * While true, every press pans the stage instead of reaching the tool or
   * Konva's drag (T018: the DM holds Space). A middle-button press pans
   * regardless.
   */
  panOverride?: boolean;
  /** Konva nodes drawn above everything, in map coordinates. */
  overlay?: ReactNode;
  /**
   * Konva nodes drawn inside the fog layer, after the mask, in map
   * coordinates: a node with `globalCompositeOperation="destination-out"`
   * punches a live preview through the fog (T008).
   */
  fogOverlay?: ReactNode;
  /**
   * Interactive Konva nodes drawn in a listening layer above everything, in
   * map coordinates — the DM's draggable player-viewport rectangle (T009).
   * A draggable node here takes the drag instead of the stage.
   */
  controls?: ReactNode;
  /**
   * Interactive Konva nodes drawn in a listening layer *beneath the tokens*,
   * in map coordinates (T013): a draggable node here is hit only where no
   * token is, so the DM's player-viewport handle never takes a drag meant
   * for a token standing inside it. Draw nothing visible here; what the DM
   * sees of such a control goes in `controls`.
   */
  underlay?: ReactNode;
  /** Reported on the wrapper as `data-image-status` (defaults from `image`). */
  imageStatus?: string;
  /** The scene's fog base PNG (`scene.fogMaskAssetId`); undefined until available. */
  fogBase?: Blob;
  /** Blobs of the scene's image tokens by asset id (T010); a token waits for its image. */
  tokenImages?: Readonly<Record<AssetId, Blob>>;
  /** DM token interaction (select, drag); absent on the player and while a tool runs (T010). */
  tokenTool?: TokenTool;
  /** Recent pings (T011); the active ones for this scene are animated above the fog. */
  pings?: readonly Ping[];
  /** A click with Alt held, in map pixels (T011: the DM's ping). Pointer tools do not see it. */
  onAltClick?: (point: Point) => void;
  /** Extra data attributes for the wrapper, e.g. test ids. */
  "data-testid"?: string;
}

const NO_PINGS: readonly Ping[] = [];

function hasAlt(evt: MouseEvent | TouchEvent): boolean {
  return "altKey" in evt && evt.altKey === true;
}

/** The middle button, the pan button whatever tool is armed (T018). */
export const PAN_MOUSE_BUTTON = 1;

function isMiddleButton(evt: MouseEvent | TouchEvent): boolean {
  return "button" in evt && evt.button === PAN_MOUSE_BUTTON;
}

/** A pan by hand in progress: where it started on screen and what the viewport was. */
interface PanState {
  clientX: number;
  clientY: number;
  viewport: Viewport;
}

/**
 * The map image drawn turned by the scene's `imageRotation` (T017,
 * ADR 0021): the node keeps the asset's own size and is placed so the
 * turned image covers `[0, width] × [0, height]` of the scene. Both windows
 * draw it this way, so the asset is never re-encoded.
 */
function MapImage({ scene, image }: { scene: MapScene; image: HTMLImageElement }) {
  const asset = imageAssetSize(scene);
  const at = rotatedImagePlacement(asset, scene.imageRotation);
  return (
    <KonvaImage
      name="map-image"
      image={image}
      x={at.x}
      y={at.y}
      rotation={scene.imageRotation}
      width={asset.width}
      height={asset.height}
    />
  );
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
  panOverride = false,
  overlay,
  fogOverlay,
  controls,
  underlay,
  imageStatus,
  fogBase,
  tokenImages,
  tokenTool,
  pings = NO_PINGS,
  onAltClick,
  "data-testid": testId = "map-stage",
}: MapStageProps) {
  const gridStyle = scene.grid[gridView];
  const { active: activePingList, now } = usePings(pings, scene.id);
  const annotationsShown = shownAnnotationCount(scene.annotations, gridView);

  const fogImageRef = useRef<Konva.Image>(null);
  const redrawFog = useCallback(() => {
    fogImageRef.current?.getLayer()?.batchDraw();
  }, []);
  const { image: fogBaseImage } = useImageElement(fogBase);
  const fog = useFogMask(scene, fogBaseImage, redrawFog);

  // Which tokens the players may see (T010): recomputed when the tokens, the
  // grid or the fog pixels change (`isFogged` is new after every mask update).
  const { tokens, grid, width, height } = scene;
  const tokenVisibility = useMemo(
    () => sceneTokenVisibility({ tokens, grid, width, height }, fog.isFogged),
    [tokens, grid, width, height, fog.isFogged]
  );
  const tokenCounts = useMemo(() => {
    const values = Object.values(tokenVisibility);
    return {
      shown: shownTokenCount(tokens, gridView, tokenVisibility),
      fogged: values.filter((v) => v === "fogged").length,
      hidden: values.filter((v) => v === "hidden").length,
    };
  }, [tokens, gridView, tokenVisibility]);

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

  // ---- pan override (T018) ------------------------------------------------
  // The pan in progress lives in a ref (the window listeners read it) and is
  // mirrored into state for the attribute. The viewport it started from is
  // kept so each move is start + offset, not a chain of deltas.
  const panRef = useRef<PanState | null>(null);
  const [panning, setPanning] = useState(false);
  const canPan = interactive && onViewportChange !== undefined;
  const viewportChangeRef = useRef(onViewportChange);
  viewportChangeRef.current = onViewportChange;

  useEffect(() => {
    if (!panning) return;
    const onMove = (evt: MouseEvent) => {
      const pan = panRef.current;
      if (!pan) return;
      viewportChangeRef.current?.({
        ...pan.viewport,
        x: pan.viewport.x + (evt.clientX - pan.clientX),
        y: pan.viewport.y + (evt.clientY - pan.clientY),
      });
    };
    const onUp = () => {
      panRef.current = null;
      setPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [panning]);

  /** Starts a pan by hand when the press asks for one; true if it did. */
  const startPanIfAsked = useCallback(
    (e: StagePointerEvent): boolean => {
      if (!canPan || !("clientX" in e.evt)) return false;
      if (!panOverride && !isMiddleButton(e.evt)) return false;
      // A middle press would otherwise start the browser's autoscroll.
      e.evt.preventDefault();
      panRef.current = { clientX: e.evt.clientX, clientY: e.evt.clientY, viewport };
      setPanning(true);
      return true;
    },
    [canPan, panOverride, viewport]
  );

  const toolEvent = useCallback(
    (handler: ((point: Point) => void) | undefined, phase: "down" | "move" | "up") =>
      (e: StagePointerEvent) => {
        // A pan by hand takes the press and everything until the release.
        if (phase === "down" && startPanIfAsked(e)) return;
        if (panRef.current) return;
        if (!pointerTool || !handler) return;
        // An Alt press is the ping gesture (below), not the tool's.
        if (phase !== "move" && onAltClick && hasAlt(e.evt)) return;
        const pointer = e.target.getStage()?.getPointerPosition();
        if (!pointer) return;
        if (e.evt.cancelable && e.evt.type.startsWith("touch")) e.evt.preventDefault();
        handler(screenToMap(viewport, pointer));
      },
    [pointerTool, onAltClick, viewport, startPanIfAsked]
  );
  const onToolDown = toolEvent(pointerTool?.onDown, "down");
  const onToolMove = toolEvent(pointerTool?.onMove, "move");
  const onToolUp = toolEvent(pointerTool?.onUp, "up");

  const onClick = useCallback(
    (e: StagePointerEvent) => {
      if (!onAltClick || !hasAlt(e.evt)) return;
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;
      onAltClick(screenToMap(viewport, pointer));
    },
    [onAltClick, viewport]
  );

  return (
    <div
      data-testid={testId}
      data-map-id={scene.id}
      data-map-name={scene.name}
      data-image-status={imageStatus ?? (image ? "loaded" : "none")}
      data-image-rotation={scene.imageRotation}
      data-map-size={`${scene.width},${scene.height}`}
      data-scale={viewport.scale.toFixed(4)}
      data-viewport-x={viewport.x.toFixed(2)}
      data-viewport-y={viewport.y.toFixed(2)}
      data-rotation={viewport.rotation ?? 0}
      data-grid-view={gridView}
      data-grid-visible={gridStyle.visible ? "true" : "false"}
      data-tool={pointerTool ? "active" : "none"}
      data-panning={panning ? "true" : "false"}
      data-fog-status={fog.status}
      data-fog-ops={scene.fogOps.length}
      data-fog-history={scene.fogOpsFrom + scene.fogOps.length}
      data-tokens={scene.tokens.length}
      data-tokens-shown={tokenCounts.shown}
      data-tokens-fogged={tokenCounts.fogged}
      data-tokens-hidden={tokenCounts.hidden}
      data-token-selected={tokenTool?.selectedId ?? ""}
      data-annotations={scene.annotations.length}
      data-annotations-shown={annotationsShown}
      data-pings={activePingList.length}
      style={{ position: "absolute", inset: 0 }}
    >
      <Stage
        width={Math.max(1, Math.floor(size.width))}
        height={Math.max(1, Math.floor(size.height))}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        rotation={viewport.rotation ?? 0}
        draggable={interactive && !pointerTool && !panOverride}
        onWheel={onWheel}
        onDragEnd={onDragEnd}
        onMouseDown={onToolDown}
        onMouseMove={onToolMove}
        onMouseUp={onToolUp}
        onTouchStart={onToolDown}
        onTouchMove={onToolMove}
        onTouchEnd={onToolUp}
        onClick={onClick}
      >
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={scene.width}
            height={scene.height}
            fill={scene.backgroundColor}
          />
          {image && <MapImage scene={scene} image={image} />}
        </Layer>
        {gridStyle.visible && (
          <Layer listening={false}>
            <GridShape scene={scene} style={gridStyle} />
          </Layer>
        )}
        {underlay && <Layer name="underlay">{underlay}</Layer>}
        <TokenLayer
          scene={scene}
          view={gridView}
          visibility={tokenVisibility}
          images={tokenImages}
          tool={tokenTool}
          scale={viewport.scale}
        />
        <AnnotationLayer annotations={scene.annotations} view={gridView} />
        <Layer listening={false} name="fog">
          <KonvaImage
            ref={fogImageRef}
            image={fog.canvas}
            x={0}
            y={0}
            width={scene.width}
            height={scene.height}
            opacity={FOG_ALPHA[gridView]}
          />
          {fogOverlay}
        </Layer>
        {overlay && <Layer listening={false}>{overlay}</Layer>}
        {activePingList.length > 0 && (
          <PingLayer pings={activePingList} now={now} scale={viewport.scale} />
        )}
        {controls && <Layer name="controls">{controls}</Layer>}
      </Stage>
    </div>
  );
}
