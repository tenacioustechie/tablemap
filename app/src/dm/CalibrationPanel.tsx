/**
 * Sidebar panel for physical calibration (T006, ADR 0011): makes one grid
 * cell one real inch (or 25 mm) on the player's TV.
 *
 * Two ways to derive pixels-per-inch for the connected display:
 * - Ruler: put the player window on the ruler screen (a white square), grow
 *   or shrink the square until it measures one cell, save.
 * - TV size: type the diagonal and native resolution.
 *
 * Also the cell unit (1 inch / 25 mm) and the **overview** override, which
 * un-locks the player zoom (fit to window) and is visibly "not to scale".
 * All state lives in the DM store's `presentation`; the calibration session
 * persists it per display.
 *
 * Once the display is calibrated the TV-size fieldset is a recalibration
 * tool the DM rarely needs, so it folds behind a disclosure (T019); while
 * the display is uncalibrated it stays open as one of the two ways in.
 */
import { useEffect, useState, type CSSProperties } from "react";
import {
  calibratedCellPx,
  CELL_UNIT_LABELS,
  CELL_UNITS,
  clampTargetPx,
  displayKey,
  initialTargetPx,
  pxPerInchFromDiagonal,
  pxPerInchFromSquare,
  type CalibrationMethod,
  type CellUnit,
  type DisplayInfo,
} from "../state/calibration";
import type { CalibrationSession } from "../state/calibrationSession";
import { useTableStore, type TableStore } from "../state/store";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  label: { display: "grid", gap: 2, color: "#aaa" },
  inline: { display: "flex", alignItems: "center", gap: 6, color: "#aaa" },
  input: {
    padding: "4px 6px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
    width: "100%",
    boxSizing: "border-box",
  },
  fieldset: {
    border: "1px solid #333",
    borderRadius: 4,
    padding: "6px 8px",
    margin: 0,
    display: "grid",
    gap: 6,
  },
  legend: { color: "#aaa", padding: "0 4px", fontSize: 12 },
  muted: { color: "#666", fontSize: 12, margin: 0 },
  ok: { color: "#8f8", fontSize: 12, margin: 0 },
  warn: { color: "#fc6", fontSize: 12, margin: 0 },
  active: { background: "#1b2530", borderColor: "#8cf", color: "#8cf" },
  disclosure: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 8px",
    background: "#1c1c1c",
    color: "#ccc",
    border: "1px solid #333",
    borderRadius: 4,
    fontSize: 12,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;

const METHOD_LABELS: Record<CalibrationMethod, string> = {
  square: "measured with a ruler",
  diagonal: "from the TV size",
};

export interface CalibrationPanelProps {
  store: TableStore;
  session: CalibrationSession;
}

function describeDisplay(display: DisplayInfo): string {
  const ratio = display.pixelRatio === 1 ? "" : ` (${display.pixelRatio}× pixels)`;
  return `${display.width}×${display.height}${ratio}`;
}

function formatPx(n: number): string {
  return n.toFixed(1);
}

/** Diagonal + resolution form. Resolution is prefilled with the display's native size. */
function TvSizeForm({
  display,
  onApply,
}: {
  display: DisplayInfo;
  onApply: (pxPerInch: number) => void;
}) {
  const key = displayKey(display);
  const [diagonal, setDiagonal] = useState("");
  const [width, setWidth] = useState(String(Math.round(display.width * display.pixelRatio)));
  const [height, setHeight] = useState(String(Math.round(display.height * display.pixelRatio)));
  useEffect(() => {
    setWidth(String(Math.round(display.width * display.pixelRatio)));
    setHeight(String(Math.round(display.height * display.pixelRatio)));
  }, [key, display.width, display.height, display.pixelRatio]);

  const result =
    diagonal.trim() === ""
      ? null
      : pxPerInchFromDiagonal({
          diagonalInches: Number(diagonal),
          widthPx: Number(width),
          heightPx: Number(height),
          pixelRatio: display.pixelRatio,
        });

  return (
    <fieldset data-testid="calibration-tv-size" style={styles.fieldset}>
      <legend style={styles.legend}>Or enter the TV size</legend>
      <label style={styles.label}>
        TV diagonal (inches)
        <input
          aria-label="TV diagonal in inches"
          type="number"
          min={1}
          step={0.5}
          value={diagonal}
          onChange={(e) => setDiagonal(e.target.value)}
          style={styles.input}
        />
      </label>
      <div style={styles.row}>
        <label style={{ ...styles.label, flex: 1 }}>
          Width (px)
          <input
            aria-label="TV resolution width"
            type="number"
            min={1}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={{ ...styles.label, flex: 1 }}>
          Height (px)
          <input
            aria-label="TV resolution height"
            type="number"
            min={1}
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            style={styles.input}
          />
        </label>
      </div>
      {diagonal.trim() !== "" && result === null && (
        <p data-testid="tv-size-error" style={styles.warn}>
          Those numbers do not describe a real TV. Check the diagonal and resolution.
        </p>
      )}
      {result !== null && (
        <p data-testid="tv-size-preview" style={styles.muted}>
          {formatPx(result)} px per inch
        </p>
      )}
      <button
        type="button"
        disabled={result === null}
        onClick={() => result !== null && onApply(result)}
      >
        Use TV size
      </button>
    </fieldset>
  );
}

export function CalibrationPanel({ store, session }: CalibrationPanelProps) {
  const presentation = useTableStore((s) => s.presentation, store);
  const setPresentation = useTableStore((s) => s.setPresentation, store);
  const { playerDisplay, calibration, cellUnit, overview, target } = presentation;
  const [error, setError] = useState<string | null>(null);
  // The TV-size fieldset is always open while uncalibrated; once a
  // calibration exists it is a recalibration tool behind a disclosure.
  const [tvSizeOpen, setTvSizeOpen] = useState(false);
  const showTvSize = calibration === null || tvSizeOpen;

  const save = (pxPerInch: number, method: CalibrationMethod) => {
    setError(null);
    void session.save({ pxPerInch, method, updatedAt: Date.now() }).then((ok) => {
      if (!ok) setError("No player display connected. Open the player view first.");
    });
  };

  const startRuler = () =>
    setPresentation({ target: initialTargetPx(calibration, cellUnit) });
  const adjustTarget = (delta: number) => {
    if (target === null) return;
    setPresentation({ target: clampTargetPx(target + delta) });
  };
  const saveRuler = () => {
    if (target === null) return;
    const pxPerInch = pxPerInchFromSquare(target, cellUnit);
    if (pxPerInch === null) {
      setError("That square size is not a plausible screen resolution.");
      return;
    }
    save(pxPerInch, "square");
  };

  const unitLabel = CELL_UNIT_LABELS[cellUnit];

  return (
    <section data-testid="calibration-panel" style={styles.form}>
      <h3 style={styles.heading}>Calibration</h3>

      {playerDisplay === null ? (
        <p data-testid="calibration-status" style={styles.muted}>
          Open the player view (and move it to the TV) to calibrate its display.
        </p>
      ) : (
        <p data-testid="calibration-status" style={calibration ? styles.ok : styles.muted}>
          Player display {describeDisplay(playerDisplay)}:{" "}
          {calibration
            ? `calibrated, ${formatPx(calibration.pxPerInch)} px per inch (${METHOD_LABELS[calibration.method]}). One cell = ${formatPx(calibratedCellPx(calibration.pxPerInch, cellUnit))} px = ${unitLabel}.`
            : "not calibrated; the player view fits the map to the window."}
        </p>
      )}

      <div role="radiogroup" aria-label="Physical cell size" style={styles.row}>
        <span style={{ color: "#aaa" }}>One cell is</span>
        {CELL_UNITS.map((unit: CellUnit) => (
          <label key={unit} style={styles.inline}>
            <input
              type="radio"
              name="cell-unit"
              aria-label={`Cell is ${CELL_UNIT_LABELS[unit]}`}
              checked={cellUnit === unit}
              onChange={() => void session.setCellUnit(unit)}
            />
            {CELL_UNIT_LABELS[unit]}
          </label>
        ))}
      </div>

      <label style={styles.inline}>
        <input
          type="checkbox"
          aria-label="Overview (not to scale)"
          data-testid="overview-toggle"
          checked={overview}
          disabled={calibration === null}
          onChange={(e) => setPresentation({ overview: e.target.checked })}
        />
        Overview: fit the whole map (not to scale)
      </label>

      {target === null ? (
        <button
          type="button"
          data-testid="start-ruler-calibration"
          disabled={playerDisplay === null}
          onClick={startRuler}
        >
          Calibrate with a ruler…
        </button>
      ) : (
        <fieldset data-testid="ruler-calibration" style={{ ...styles.fieldset, ...styles.active }}>
          <legend style={styles.legend}>Ruler</legend>
          <p style={styles.muted}>
            The player screen shows a white square. Measure it and adjust until it is exactly{" "}
            {unitLabel} wide.
          </p>
          <label style={styles.label}>
            Square size (px)
            <input
              aria-label="Target square size"
              type="number"
              min={1}
              step={0.5}
              value={target}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value.trim() !== "" && Number.isFinite(n) && n > 0) {
                  setPresentation({ target: clampTargetPx(n) });
                }
              }}
              style={styles.input}
            />
          </label>
          <div style={styles.row}>
            <button type="button" aria-label="Shrink by 10" onClick={() => adjustTarget(-10)}>
              −10
            </button>
            <button type="button" aria-label="Shrink by 1" onClick={() => adjustTarget(-1)}>
              −1
            </button>
            <button type="button" aria-label="Grow by 1" onClick={() => adjustTarget(1)}>
              +1
            </button>
            <button type="button" aria-label="Grow by 10" onClick={() => adjustTarget(10)}>
              +10
            </button>
          </div>
          <div style={styles.row}>
            <button type="button" data-testid="save-ruler-calibration" onClick={saveRuler}>
              It measures {unitLabel}: save
            </button>
            <button type="button" onClick={() => setPresentation({ target: null })}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}

      {playerDisplay !== null && calibration !== null && (
        <button
          type="button"
          data-testid="tv-size-disclosure"
          aria-expanded={tvSizeOpen}
          onClick={() => setTvSizeOpen((open) => !open)}
          style={styles.disclosure}
        >
          {tvSizeOpen ? "▾" : "▸"} Recalibrate from the TV size
        </button>
      )}
      {playerDisplay !== null && showTvSize && (
        <TvSizeForm display={playerDisplay} onApply={(pxPerInch) => save(pxPerInch, "diagonal")} />
      )}

      {calibration !== null && (
        <button type="button" onClick={() => void session.clear()}>
          Clear calibration
        </button>
      )}

      {error && (
        <p data-testid="calibration-error" style={styles.warn}>
          {error}
        </p>
      )}
    </section>
  );
}
