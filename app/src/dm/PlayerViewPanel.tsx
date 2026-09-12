/**
 * Sidebar panel for how the scene sits on the TV (T009, ADR 0014): rotation
 * in quarter turns, recentring the viewport rectangle, and the splash
 * screen's settings — whether a scene switch raises it, and the image it
 * shows instead of the campaign title. The blackout and splash switches
 * themselves live in the toolbar (`DmView`) where they are one click away.
 *
 * Rotation, centre and the switch preference are DM-only presentation state
 * in the store (the sync layer pushes what the player needs); the splash
 * image is campaign state, stored as an asset through `SplashActions`.
 */
import { useState, type ChangeEvent, type CSSProperties } from "react";
import { DEFAULT_PLAYER_DISPLAY } from "../map/playerView";
import type { TableMapDb } from "../state/db";
import { MapImportError } from "../state/mapActions";
import { rotateClockwise, rotateCounterClockwise } from "../state/rotation";
import type { SplashActions } from "../state/splashActions";
import { useTableStore, type TableStore } from "../state/store";
import { useAssetBlob, useObjectUrl } from "./useAssetBlob";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  inline: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
  label: { display: "grid", gap: 2, color: "#aaa" },
  muted: { color: "#666", fontSize: 12, margin: 0 },
  value: { color: "#eee", minWidth: 36, textAlign: "center" },
  error: { color: "#f88", fontSize: 12, margin: "4px 0" },
  thumb: {
    width: 96,
    height: 54,
    objectFit: "contain",
    background: "#000",
    border: "1px solid #333",
    borderRadius: 2,
    display: "block",
  },
} satisfies Record<string, CSSProperties>;

export interface PlayerViewPanelProps {
  store: TableStore;
  db: TableMapDb;
  splash: SplashActions;
}

function describeError(error: unknown): string {
  if (error instanceof MapImportError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function PlayerViewPanel({ store, db, splash }: PlayerViewPanelProps) {
  const presentation = useTableStore((s) => s.presentation, store);
  const setPresentation = useTableStore((s) => s.setPresentation, store);
  const splashImageAssetId = useTableStore((s) => s.shared.splashImageAssetId, store);
  const hasMap = useTableStore((s) => s.shared.activeMapId !== null, store);
  const splashBlob = useAssetBlob(db, splashImageAssetId);
  const splashUrl = useObjectUrl(splashBlob);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { rotation, center, playerDisplay, calibration, overview } = presentation;
  const locked = calibration !== null && !overview;
  const display = playerDisplay ?? DEFAULT_PLAYER_DISPLAY;

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    splash
      .setImage(file)
      .catch((err) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <section data-testid="player-view-panel" style={styles.form}>
      <h3 style={styles.heading}>Player view</h3>

      <div style={styles.row}>
        <span style={{ color: "#aaa" }}>Rotation</span>
        <button
          type="button"
          aria-label="Rotate player view counter-clockwise"
          onClick={() => setPresentation({ rotation: rotateCounterClockwise(rotation) })}
        >
          ⟲ 90°
        </button>
        <span data-testid="rotation-value" style={styles.value}>
          {rotation}°
        </span>
        <button
          type="button"
          aria-label="Rotate player view clockwise"
          onClick={() => setPresentation({ rotation: rotateClockwise(rotation) })}
        >
          ⟳ 90°
        </button>
      </div>

      <p data-testid="player-viewport-info" style={styles.muted}>
        {!hasMap
          ? "Show a map to position the player view."
          : locked
            ? `Drag the blue rectangle on the canvas to pan the player view (${display.width}×${display.height} display${playerDisplay ? "" : ", assumed until the player view connects"}).`
            : "The player view fits the whole map; calibrate the display to pan it."}
      </p>
      <div style={styles.row}>
        <button
          type="button"
          data-testid="recentre-player-view"
          disabled={center === null}
          onClick={() => setPresentation({ center: null })}
        >
          Recentre player view
        </button>
      </div>

      <label style={styles.inline}>
        <input
          type="checkbox"
          data-testid="splash-on-switch"
          aria-label="Show splash when switching maps"
          checked={presentation.splashOnSwitch}
          onChange={(e) => setPresentation({ splashOnSwitch: e.target.checked })}
        />
        Show splash when switching maps
      </label>

      <label style={styles.label}>
        Splash image (PNG, JPEG, WebP; the campaign title otherwise)
        <input
          data-testid="splash-file-input"
          aria-label="Splash image"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onPick}
          disabled={busy}
        />
      </label>
      {splashImageAssetId !== null && (
        <div style={styles.row}>
          {splashUrl ? (
            <img src={splashUrl} alt="" data-testid="splash-thumb" style={styles.thumb} />
          ) : (
            <div data-testid="splash-thumb" style={styles.thumb} />
          )}
          <button
            type="button"
            data-testid="clear-splash-image"
            disabled={busy}
            onClick={() => {
              setError(null);
              void splash.clearImage().catch((err) => setError(describeError(err)));
            }}
          >
            Use campaign title instead
          </button>
        </div>
      )}
      {error && (
        <p data-testid="splash-error" role="alert" style={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
