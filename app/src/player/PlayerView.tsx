/**
 * Player view: render-only, chrome-free. Never imports from src/dm/ or the DM
 * store; everything it shows comes from the sync mirror — including map
 * images, which the DM pushes as assets (ADR 0008).
 *
 * The active map is fitted to the window (contain). Locking the scale to the
 * physical calibration is a later task.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { MapStage } from "../map/MapStage";
import { useContainerSize } from "../map/useContainerSize";
import { useImageElement } from "../map/useImageElement";
import { fitToView } from "../map/viewport";
import { activeMap } from "../state/maps";
import { useMirror } from "../state/mirror";
import type { TransportFactory } from "../state/transport";
import { isFullscreenKey, toggleLocalFullscreen } from "./fullscreen";
import { usePlayerSync } from "./usePlayerSync";

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

export interface PlayerViewProps {
  /** Injected in tests; the real app uses a BroadcastChannel. */
  createTransport?: TransportFactory;
}

export function PlayerView({ createTransport }: PlayerViewProps) {
  const mirror = usePlayerSync(createTransport);
  const status = useMirror(mirror, (m) => m.status);
  const seq = useMirror(mirror, (m) => m.seq);
  const campaignName = useMirror(mirror, (m) => m.shared?.campaignName ?? "");
  const scene = useMirror(mirror, (m) => (m.shared ? activeMap(m.shared) : undefined));
  const imageBlob = useMirror(mirror, (m) =>
    scene?.imageAssetId ? m.assets[scene.imageAssetId] : undefined
  );
  const { image, status: imageStatus } = useImageElement(imageBlob);

  const rootRef = useRef<HTMLElement>(null);
  const size = useContainerSize(rootRef);
  const viewport = useMemo(
    () =>
      scene
        ? fitToView({ width: scene.width, height: scene.height }, size)
        : { x: 0, y: 0, scale: 1 },
    [scene, size]
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

  return (
    <main
      ref={rootRef}
      data-testid="player-view"
      data-sync-status={status}
      data-sync-seq={seq}
      data-active-map-id={scene?.id ?? ""}
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
      {scene ? (
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
          data-testid="player-map-stage"
        />
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
