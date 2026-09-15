/**
 * Player view: render-only, chrome-free. Never imports from src/dm/ or the DM
 * store; everything it shows comes from the sync mirror — including map
 * images and fog-mask bases, which the DM pushes as assets (ADR 0008), and
 * how to present the scene on this display (`presentation`, ADR 0011,
 * ADR 0014). Fog is drawn opaque here (ADR 0012): the stage rasterises the
 * scene's fog ops itself, so a reveal on the DM side is one delta away from
 * the TV. Tokens (T010, ADR 0015) are drawn by the same stage, which leaves
 * out DM-hidden ones and any standing on a fogged cell. Annotations (T011,
 * ADR 0016): the stage draws only drawings marked for both views; notes and
 * DM-only drawings never even arrive (the DM strips them before sending),
 * and pings (`mirror.pings`) are animated above the fog. Walls and doors
 * (T101, T103) are held but never drawn; the root reports only their count
 * and how many doors are open (`data-walls`, `data-doors-open`).
 *
 * Presentation modes (`presentationMode`):
 * - calibrated: the stage scale is locked so one grid cell is exactly one
 *   physical cell (1 inch / 25 mm) on this display; the DM pans the view by
 *   dragging the viewport rectangle (`presentation.center`).
 * - overview: the DM's override; the whole map fitted to the window, with a
 *   "not to scale" badge so nobody measures against it.
 * - uncalibrated: no calibration for this display yet; fitted to the window.
 * - calibrating: the ruler screen — a white square of the requested size.
 *
 * On top of any of those (T009): the view is rotated in quarter turns
 * (`presentation.rotation`, the stage transform from `map/playerView.ts`);
 * `splash` covers the scene with the campaign's splash image, its title card
 * or the default artwork (T015, ADR 0019: the chosen image wins, with the
 * title as the placeholder until it has arrived; else the title card when
 * the DM asked for it; else the bundled artwork, a static asset both windows
 * load from the same origin — never through the asset channel);
 * `blackout` covers everything with solid black. Both are plain DOM layers
 * over the stage, so they appear the instant the message lands and the stage
 * underneath keeps its fog mask warm for when they lift. Priority, top down:
 * blackout > ruler screen (which replaces the scene and hides the splash) >
 * splash > scene.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import defaultSplashUrl from "../assets/splash-default.png";
import { MapStage } from "../map/MapStage";
import { playerStageTransform, resolvePlayerView } from "../map/playerView";
import { useContainerSize } from "../map/useContainerSize";
import { useImageElement } from "../map/useImageElement";
import type { Size, Viewport } from "../map/viewport";
import {
  CELL_UNIT_LABELS,
  presentationMode,
  type CellUnit,
} from "../state/calibration";
import { activeMap } from "../state/maps";
import { useMirror } from "../state/mirror";
import { isQuarterTurn, type Rotation } from "../state/rotation";
import type { TransportFactory } from "../state/transport";
import { openDoorsOf } from "../state/walls";
import { isFullscreenKey, toggleLocalFullscreen } from "./fullscreen";
import { usePlayerSync, type ReadDisplay } from "./usePlayerSync";

const titleStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "100%",
  height: "100%",
  margin: 0,
  color: "#3a3a3a",
  fontSize: "5vmin",
  fontFamily: "system-ui, sans-serif",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  textAlign: "center",
  userSelect: "none",
};

const splashTitleStyle: CSSProperties = { ...titleStyle, color: "#c8c8c8", fontSize: "7vmin" };

const targetScreenStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: 24,
  color: "#777",
  fontSize: 18,
  fontFamily: "system-ui, sans-serif",
  userSelect: "none",
};

const overviewBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  padding: "4px 10px",
  borderRadius: 4,
  background: "rgba(0, 0, 0, 0.6)",
  color: "#aaa",
  fontSize: 14,
  fontFamily: "system-ui, sans-serif",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  pointerEvents: "none",
  userSelect: "none",
};

const splashStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "#000",
  overflow: "hidden",
  zIndex: 10,
};

const blackoutStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "#000",
  opacity: 1,
  zIndex: 20,
};

/** The ruler screen: a square of exactly `sizePx` CSS pixels. */
function CalibrationTarget({ sizePx, unit }: { sizePx: number; unit: CellUnit }) {
  return (
    <div data-testid="calibration-screen" style={targetScreenStyle}>
      <div
        data-testid="calibration-target"
        data-size-px={sizePx}
        style={{
          width: sizePx,
          height: sizePx,
          background: "#fff",
          outline: "1px solid #444",
          boxSizing: "border-box",
        }}
      />
      <p style={{ margin: 0 }}>
        Measure this square. It should be exactly {CELL_UNIT_LABELS[unit]} wide.
      </p>
    </div>
  );
}

/**
 * Fills the display with `children` turned by `rotation`, so titles and the
 * splash image read the right way up for the players whichever way the map
 * is turned: a quarter turn swaps the box's width and height before rotating.
 */
function Rotated({
  rotation,
  size,
  children,
}: {
  rotation: Rotation;
  size: Size;
  children: ReactNode;
}) {
  const swap = isQuarterTurn(rotation);
  const width = swap ? size.height : size.width;
  const height = swap ? size.width : size.height;
  return (
    <div
      data-rotation={rotation}
      style={{
        position: "absolute",
        left: (size.width - width) / 2,
        top: (size.height - height) / 2,
        width,
        height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {children}
    </div>
  );
}

const splashImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
};

type SplashKind = "image" | "title" | "default";

/**
 * What the splash shows (T015): the campaign's image once decoded; the title
 * while a chosen image is still on its way (`imageChosen`) or when the DM
 * picked the title card; else the default artwork.
 */
function splashKind({
  imageReady,
  imageChosen,
  titleCard,
}: {
  imageReady: boolean;
  imageChosen: boolean;
  titleCard: boolean;
}): SplashKind {
  if (imageReady) return "image";
  if (imageChosen || titleCard) return "title";
  return "default";
}

function Splash({
  imageBlob,
  imageChosen,
  titleCard,
  campaignName,
  rotation,
  size,
}: {
  imageBlob: Blob | undefined;
  /** A splash image is chosen; the title stands in until it has arrived. */
  imageChosen: boolean;
  /** The DM chose the title card over the default artwork. */
  titleCard: boolean;
  campaignName: string;
  rotation: Rotation;
  size: Size;
}) {
  const { image } = useImageElement(imageBlob);
  const kind = splashKind({ imageReady: image !== null, imageChosen, titleCard });
  return (
    <div data-testid="player-splash" data-splash-kind={kind} style={splashStyle}>
      <Rotated rotation={rotation} size={size}>
        {kind === "image" && image ? (
          <img
            data-testid="player-splash-image"
            src={image.src}
            alt=""
            draggable={false}
            style={splashImageStyle}
          />
        ) : kind === "default" ? (
          <img
            data-testid="player-splash-image"
            src={defaultSplashUrl}
            alt=""
            draggable={false}
            style={splashImageStyle}
          />
        ) : (
          <p data-testid="player-splash-title" style={splashTitleStyle}>
            {campaignName}
          </p>
        )}
      </Rotated>
    </div>
  );
}

export interface PlayerViewProps {
  /** Injected in tests; the real app uses a BroadcastChannel. */
  createTransport?: TransportFactory;
  /** Injected in tests; the real app reads `window.screen`. */
  readDisplay?: ReadDisplay;
}

export function PlayerView({ createTransport, readDisplay }: PlayerViewProps) {
  const mirror = usePlayerSync(createTransport, readDisplay);
  const status = useMirror(mirror, (m) => m.status);
  const seq = useMirror(mirror, (m) => m.seq);
  const campaignName = useMirror(mirror, (m) => m.shared?.campaignName ?? "");
  const scene = useMirror(mirror, (m) => (m.shared ? activeMap(m.shared) : undefined));
  const imageBlob = useMirror(mirror, (m) =>
    scene?.imageAssetId ? m.assets[scene.imageAssetId] : undefined
  );
  const fogBaseBlob = useMirror(mirror, (m) =>
    scene?.fogMaskAssetId ? m.assets[scene.fogMaskAssetId] : undefined
  );
  const splashImageChosen = useMirror(mirror, (m) => m.shared?.splashImageAssetId != null);
  const splashTitleCard = useMirror(mirror, (m) => m.shared?.splashTitleCard ?? false);
  const splashBlob = useMirror(mirror, (m) =>
    m.shared?.splashImageAssetId ? m.assets[m.shared.splashImageAssetId] : undefined
  );
  // Image tokens look their Blob up by asset id (T010); the mirror keeps
  // every asset the state references, so the whole map serves as the index.
  const assets = useMirror(mirror, (m) => m.assets);
  const presentation = useMirror(mirror, (m) => m.presentation);
  // Pings (T011): the stage animates the ones still active for this scene.
  const pings = useMirror(mirror, (m) => m.pings);
  const mode = presentationMode(presentation);
  const { image, status: imageStatus } = useImageElement(imageBlob);

  const rootRef = useRef<HTMLElement>(null);
  const size = useContainerSize(rootRef);
  const view = useMemo(
    () => (scene ? resolvePlayerView(presentation, scene, size) : null),
    [scene, presentation, size]
  );
  const viewport = useMemo<Viewport>(
    () => (view ? playerStageTransform(view, size) : { x: 0, y: 0, scale: 1 }),
    [view, size]
  );

  useEffect(() => {
    const root = document.documentElement;
    const previousBackground = root.style.background;
    root.style.background = "#000";

    const onKeyDown = (event: KeyboardEvent) => {
      if (isFullscreenKey(event)) void toggleLocalFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      root.style.background = previousBackground;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const connected = status === "synced";

  return (
    <main
      ref={rootRef}
      data-testid="player-view"
      data-sync-status={status}
      data-sync-seq={seq}
      data-active-map-id={scene?.id ?? ""}
      data-walls={scene?.walls.length ?? 0}
      data-doors-open={scene ? openDoorsOf(scene.walls).length : 0}
      data-view-mode={mode}
      data-rotation={presentation.rotation}
      data-view-center={view ? `${view.center.x},${view.center.y}` : ""}
      data-blackout={presentation.blackout ? "true" : "false"}
      data-splash={presentation.splash ? "true" : "false"}
      onDoubleClick={() => void toggleLocalFullscreen()}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        background: "#000",
        overflow: "hidden",
        cursor: "none",
      }}
    >
      {mode === "calibrating" && presentation.target !== null ? (
        <CalibrationTarget sizePx={presentation.target} unit={presentation.cellUnit} />
      ) : scene ? (
        <>
          <MapStage
            scene={scene}
            image={image}
            imageStatus={
              scene.imageAssetId === null
                ? "none"
                : imageBlob
                  ? imageStatus
                  : "waiting"
            }
            size={size}
            viewport={viewport}
            gridView="player"
            fogBase={fogBaseBlob}
            tokenImages={assets}
            pings={pings}
            data-testid="player-map-stage"
          />
          {mode === "overview" && (
            <div data-testid="player-overview-badge" style={overviewBadgeStyle}>
              Overview: not to scale
            </div>
          )}
        </>
      ) : (
        connected &&
        campaignName !== "" && (
          <Rotated rotation={presentation.rotation} size={size}>
            <p data-testid="player-campaign-name" style={titleStyle}>
              {campaignName}
            </p>
          </Rotated>
        )
      )}
      {connected && presentation.splash && mode !== "calibrating" && (
        <Splash
          imageBlob={splashBlob}
          imageChosen={splashImageChosen}
          titleCard={splashTitleCard}
          campaignName={campaignName}
          rotation={presentation.rotation}
          size={size}
        />
      )}
      {presentation.blackout && <div data-testid="player-blackout" style={blackoutStyle} />}
    </main>
  );
}
