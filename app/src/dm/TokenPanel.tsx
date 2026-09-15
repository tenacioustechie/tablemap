/**
 * Sidebar panel for the active map's tokens (T010, ADR 0015): add a disc or
 * an image token (placed at the centre of what the TV shows, then dragged
 * on the canvas), pick one from the list (or by clicking it on the canvas),
 * edit its name, badge, colour, size, vision (T105), snapping and the hidden
 * flag, or remove it. Selection is DM UI state held by `DmView`; every
 * change goes through `TokenActions`.
 */
import { useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { DEFAULT_PLAYER_DISPLAY, resolvePlayerView } from "../map/playerView";
import { playerPresentation } from "../state/calibration";
import { MapImportError } from "../state/mapActions";
import { activeMap } from "../state/maps";
import type { TokenSize } from "../state/model";
import { useTableStore, type TableStore } from "../state/store";
import type { TokenActions } from "../state/tokenActions";
import { TOKEN_BADGE_MAX_LENGTH, TOKEN_SIZES, tokenLabel } from "../state/tokens";
import { clampTokenVision, TOKEN_VISION_MAX } from "../state/vision";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  muted: { color: "#666", fontSize: 13, margin: 0 },
  error: { color: "#f88", fontSize: 12, margin: "4px 0" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    textAlign: "left",
    padding: "3px 6px",
    background: "transparent",
    color: "#ddd",
    border: "1px solid transparent",
    borderRadius: 3,
    cursor: "pointer",
  },
  itemSelected: { background: "#1e2a36", borderColor: "#8cf" },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    display: "inline-grid",
    placeItems: "center",
    fontSize: 10,
    fontWeight: 700,
    color: "#fff",
    border: "1px solid #111",
    flex: "none",
  },
  label: { display: "grid", gap: 2, color: "#aaa" },
  check: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
  input: {
    padding: "4px 6px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
  },
  editor: { display: "grid", gap: 6, padding: 8, border: "1px solid #333", borderRadius: 4 },
} satisfies Record<string, CSSProperties>;

export interface TokenPanelProps {
  store: TableStore;
  actions: TokenActions;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function describeError(error: unknown): string {
  if (error instanceof MapImportError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function TokenPanel({ store, actions, selectedId, onSelect }: TokenPanelProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const presentationState = useTableStore((s) => s.presentation, store);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New tokens land in the middle of what the TV shows, where the action is.
  const placement = useMemo(() => {
    if (!scene) return undefined;
    const display = presentationState.playerDisplay ?? DEFAULT_PLAYER_DISPLAY;
    return resolvePlayerView(playerPresentation(presentationState), scene, display).center;
  }, [scene, presentationState]);

  if (!scene) {
    return (
      <section data-testid="token-panel">
        <h3 style={styles.heading}>Tokens</h3>
        <p style={styles.muted}>Show a map to place tokens.</p>
      </section>
    );
  }

  const mapId = scene.id;
  const selected = scene.tokens.find((t) => t.id === selectedId);

  const addDisc = () => {
    setError(null);
    const token = actions.addDisc(mapId, { at: placement });
    if (token) onSelect(token.id);
  };

  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    actions
      .addImage(mapId, file, { at: placement })
      .then((token) => onSelect(token.id))
      .catch((err) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };

  const edit = (patch: Parameters<TokenActions["update"]>[2]) => {
    if (selected) actions.update(mapId, selected.id, patch);
  };

  return (
    <section data-testid="token-panel" style={styles.form}>
      <h3 style={styles.heading}>
        Tokens <span data-testid="token-count">({scene.tokens.length})</span>
      </h3>
      <div style={styles.row}>
        <button type="button" data-testid="token-add" onClick={addDisc} disabled={busy}>
          Add token
        </button>
        <label style={styles.label}>
          Add image token (PNG, JPEG, WebP)
          <input
            data-testid="token-image-input"
            aria-label="Token image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onPickImage}
            disabled={busy}
          />
        </label>
      </div>
      {error && (
        <p data-testid="token-error" role="alert" style={styles.error}>
          {error}
        </p>
      )}

      {scene.tokens.length === 0 ? (
        <p style={styles.muted}>No tokens on this map yet.</p>
      ) : (
        <ul data-testid="token-list" style={styles.list}>
          {scene.tokens.map((token) => {
            const isSelected = token.id === selectedId;
            return (
              <li
                key={token.id}
                data-testid="token-item"
                data-token-id={token.id}
                data-selected={isSelected ? "true" : "false"}
                data-hidden={token.hidden ? "true" : "false"}
              >
                <button
                  type="button"
                  aria-label={`Select ${tokenLabel(token)}`}
                  aria-pressed={isSelected}
                  style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
                  onClick={() => onSelect(isSelected ? null : token.id)}
                >
                  <span
                    style={{
                      ...styles.swatch,
                      background: token.appearance.type === "disc" ? token.appearance.color : "#555",
                    }}
                  >
                    {token.appearance.type === "image" ? "img" : token.badge}
                  </span>
                  <span style={{ flex: 1 }}>{tokenLabel(token)}</span>
                  <span style={{ color: "#888" }}>
                    {token.size}×{token.size}
                    {token.hidden ? " · hidden" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div data-testid="token-editor" data-token-id={selected.id} style={styles.editor}>
          <label style={styles.label}>
            Name
            <input
              data-testid="token-name"
              type="text"
              value={selected.name}
              style={styles.input}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </label>
          <label style={styles.label}>
            Badge (up to {TOKEN_BADGE_MAX_LENGTH} characters)
            <input
              data-testid="token-badge"
              type="text"
              maxLength={TOKEN_BADGE_MAX_LENGTH}
              value={selected.badge}
              style={styles.input}
              onChange={(e) => edit({ badge: e.target.value.slice(0, TOKEN_BADGE_MAX_LENGTH) })}
            />
          </label>
          {selected.appearance.type === "disc" && (
            <label style={styles.check}>
              Colour
              <input
                data-testid="token-color"
                type="color"
                value={selected.appearance.color}
                onChange={(e) => edit({ appearance: { type: "disc", color: e.target.value } })}
              />
            </label>
          )}
          <label style={styles.check}>
            Size
            <select
              data-testid="token-size"
              value={selected.size}
              style={styles.input}
              onChange={(e) => edit({ size: Number(e.target.value) as TokenSize })}
            >
              {TOKEN_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}×{s}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.check}>
            Vision (cells)
            <input
              data-testid="token-vision"
              type="number"
              min={0}
              max={TOKEN_VISION_MAX}
              step={1}
              value={selected.vision}
              style={{ ...styles.input, width: 64 }}
              onChange={(e) => {
                const cells = Number(e.target.value);
                if (e.target.value.trim() !== "" && !Number.isNaN(cells)) {
                  edit({ vision: clampTokenVision(cells) });
                }
              }}
            />
          </label>
          <label style={styles.check}>
            <input
              data-testid="token-snap"
              type="checkbox"
              checked={selected.snapToGrid}
              onChange={(e) => edit({ snapToGrid: e.target.checked })}
            />
            Snap to grid
          </label>
          <label style={styles.check}>
            <input
              data-testid="token-hidden"
              type="checkbox"
              checked={selected.hidden}
              onChange={(e) => edit({ hidden: e.target.checked })}
            />
            Hidden from players
          </label>
          <div style={styles.row}>
            <button
              type="button"
              data-testid="token-remove"
              disabled={busy}
              onClick={() => {
                setError(null);
                const id = selected.id;
                onSelect(null);
                void actions.remove(mapId, id).catch((err) => setError(describeError(err)));
              }}
            >
              Remove token
            </button>
            <button type="button" data-testid="token-deselect" onClick={() => onSelect(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <p style={styles.muted}>
        Drag tokens on the canvas to move them; click one to select it. Players never see hidden
        tokens or tokens standing on fogged cells.
      </p>
    </section>
  );
}
