/** DM view — full editing UI. Must never be imported by src/player/. */
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { PlayerWindowController } from "./playerWindow";
import { usePlayerWindow } from "./usePlayerWindow";

const SIDEBAR_WIDTH = 240;

const styles = {
  root: {
    display: "grid",
    gridTemplateRows: "auto 1fr",
    gridTemplateColumns: `${SIDEBAR_WIDTH}px 1fr`,
    height: "100vh",
    overflow: "hidden",
  },
  toolbar: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    borderBottom: "1px solid #333",
    background: "#1a1a1a",
  },
  sidebar: {
    padding: 12,
    borderRight: "1px solid #333",
    background: "#161616",
    overflowY: "auto",
  },
  canvas: {
    position: "relative",
    background: "#0d0d0d",
    overflow: "hidden",
  },
  canvasPlaceholder: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#555",
  },
  status: { marginLeft: "auto", color: "#aaa", fontSize: 14 },
  hint: { color: "#fc6", fontSize: 13 },
} satisfies Record<string, CSSProperties>;

export interface DmViewProps {
  /** Injected in tests; the real app creates a browser-backed controller. */
  playerWindow?: PlayerWindowController;
}

export function DmView({ playerWindow }: DmViewProps) {
  const pw = usePlayerWindow(playerWindow);

  const statusText = !pw.status.open
    ? "closed"
    : pw.status.fullscreen
      ? "fullscreen"
      : "open";

  return (
    <div data-testid="dm-view" style={styles.root}>
      <header data-testid="dm-controls" style={styles.toolbar}>
        <Link to="/" style={{ color: "#8cf" }}>
          TableMap
        </Link>
        <strong>DM view</strong>
        <button type="button" onClick={pw.open}>
          Open player view
        </button>
        <button
          type="button"
          onClick={() => void pw.toggleFullscreen()}
          disabled={!pw.status.open}
        >
          {pw.status.fullscreen
            ? "Exit player fullscreen"
            : "Fullscreen player view"}
        </button>
        <button type="button" onClick={pw.close} disabled={!pw.status.open}>
          Close player view
        </button>
        {pw.lastFullscreenResult === "denied" && (
          <span data-testid="fullscreen-hint" style={styles.hint}>
            Browser blocked fullscreen from here. Press F in the player window.
          </span>
        )}
        <span data-testid="player-window-status" style={styles.status}>
          Player view: {statusText}
        </span>
      </header>

      <aside data-testid="dm-sidebar" style={styles.sidebar}>
        <h2 style={{ fontSize: 14, margin: "0 0 8px", color: "#aaa" }}>
          Tools
        </h2>
        <p style={{ color: "#666", fontSize: 13 }}>
          Fog, grid, tokens and annotations arrive in later tasks.
        </p>
      </aside>

      <section data-testid="dm-canvas" style={styles.canvas}>
        <div style={styles.canvasPlaceholder}>Canvas area</div>
      </section>
    </div>
  );
}
