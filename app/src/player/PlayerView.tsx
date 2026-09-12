/**
 * Player view: render-only, chrome-free. Never imports from src/dm/ or the DM
 * store; everything it shows comes from the sync mirror.
 */
import { useEffect, type CSSProperties } from "react";
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
      data-testid="player-view"
      data-sync-status={status}
      data-sync-seq={seq}
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
      {campaignName !== "" && (
        <p data-testid="player-campaign-name" style={idleTitleStyle}>
          {campaignName}
        </p>
      )}
    </main>
  );
}
