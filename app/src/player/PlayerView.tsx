/**
 * Player view: render-only, chrome-free. Never imports from src/dm/ or the DM
 * store; everything it shows comes from the sync mirror — including map
 * images and fog-mask bases, which the DM pushes as assets (ADR 0008), and
 * how to present the scene on this display (`presentation`, ADR 0011). Fog
 * is drawn opaque here (ADR 0012): the stage rasterises the scene's fog ops
 * itself, so a reveal on the DM side is one delta away from the TV.
 *
 * Presentation modes (`presentationMode`):
 * - calibrated: the stage scale is locked so one grid cell is exactly one
 *   physical cell (1 inch / 25 mm) on this display; the map is centred.
 * - overview: the DM's override; the whole map fitted to the window, with a
 *   "not to scale" badge so nobody measures against it.
 * - uncalibrated: no calibration for this display yet; fitted to the window.
 * - calibrating: the ruler screen — a white square of the requested size.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { MapStage } from "../map/MapStage";
import { useContainerSize } from "../map/useContainerSize";
import { useImageElement } from "../map/useImageElement";
import { centerAtScale, fitToView, type Viewport } from "../map/viewport";
import {
  CELL_UNIT_LABELS,
  lockedScale,
  presentationMode,
  type CellUnit,
} from "../state/calibration";
import { activeMap } from "../state/maps";
import { useMirror } from "../state/mirror";
import type { TransportFactory } from "../state/transport";
import { isFullscreenKey, toggleLocalFullscreen } from "./fullscreen";
import { usePlayerSync, type ReadDisplay } from "./usePlayerSync";

const idleTitleStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  margin: 0,
  color: "#3a3a3a",
  fontSize: "5vmin",
  fontFamily: "system-ui, sans-serif",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  userSelect: "none",
};

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
  const presentation = useMirror(mirror, (m) => m.presentation);
  const mode = presentationMode(presentation);
  const { image, status: imageStatus } = useImageElement(imageBlob);

  const rootRef = useRef<HTMLElement>(null);
  const size = useContainerSize(rootRef);
  const viewport = useMemo<Viewport>(() => {
    if (!scene) return { x: 0, y: 0, scale: 1 };
    const map = { width: scene.width, height: scene.height };
    if (mode === "calibrated" && presentation.pxPerInch !== null) {
      return centerAtScale(
        map,
        size,
        lockedScale(presentation.pxPerInch, presentation.cellUnit, scene.grid.cellSize)
      );
    }
    return fitToView(map, size);
  }, [scene, size, mode, presentation.pxPerInch, presentation.cellUnit]);

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

  return (
    <main
      ref={rootRef}
      data-testid="player-view"
      data-sync-status={status}
      data-sync-seq={seq}
      data-active-map-id={scene?.id ?? ""}
      data-view-mode={mode}
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
            data-testid="player-map-stage"
          />
          {mode === "overview" && (
            <div data-testid="player-overview-badge" style={overviewBadgeStyle}>
              Overview: not to scale
            </div>
          )}
        </>
      ) : (
        campaignName !== "" && (
          <p data-testid="player-campaign-name" style={idleTitleStyle}>
            {campaignName}
          </p>
        )
      )}
    </main>
  );
}
