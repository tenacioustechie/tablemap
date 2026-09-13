/**
 * The `?` cheat sheet (T018): a dismissable modal listing every keyboard
 * shortcut and mouse gesture of the DM view, rendered from `SHORTCUTS` and
 * `MOUSE_GESTURES` in `dm/shortcuts.ts` so it cannot drift from what the
 * keys do. Closes on Esc (handled by `DmView`, which gives the sheet
 * precedence over the tools' own Esc), on the Close button, on `?` again,
 * and on a click on the backdrop.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { MOUSE_GESTURES, SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";

const styles = {
  backdrop: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "rgba(0, 0, 0, 0.6)",
    zIndex: 20,
  },
  sheet: {
    width: "min(720px, calc(100vw - 48px))",
    maxHeight: "calc(100vh - 48px)",
    overflowY: "auto",
    background: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: 8,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    padding: 16,
    color: "#ddd",
    fontSize: 13,
    outline: "none",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { margin: 0, fontSize: 16 },
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0 24px",
  },
  heading: { fontSize: 13, margin: "12px 0 4px", color: "#aaa" },
  table: { borderCollapse: "collapse", width: "100%" },
  keyCell: { padding: "3px 8px 3px 0", whiteSpace: "nowrap", verticalAlign: "top" },
  labelCell: { padding: "3px 0", color: "#ccc" },
  kbd: {
    display: "inline-block",
    minWidth: 18,
    padding: "1px 6px",
    border: "1px solid #666",
    borderBottomWidth: 2,
    borderRadius: 4,
    background: "#2a2a2a",
    color: "#fff",
    font: "inherit",
    textAlign: "center",
  },
  footnote: { margin: "12px 0 0", color: "#888", fontSize: 12 },
} satisfies Record<string, CSSProperties>;

export interface ShortcutHelpProps {
  onClose: () => void;
}

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the sheet so Esc and `?` reach the window listeners from here,
    // not from a sidebar button that Space or Enter would activate.
    sheetRef.current?.focus();
  }, []);
  return (
    <div
      data-testid="shortcut-help-backdrop"
      style={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcut-help"
        tabIndex={-1}
        style={styles.sheet}
      >
        <div style={styles.header}>
          <h2 style={styles.title}>Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} data-testid="shortcut-help-close">
            Close (Esc)
          </button>
        </div>
        <div style={styles.columns}>
          <div>
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group} data-testid="shortcut-group" data-group={group}>
                <h3 style={styles.heading}>{group}</h3>
                <table style={styles.table}>
                  <tbody>
                    {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                      <tr key={s.key} data-testid="shortcut-row" data-key={s.key}>
                        <td style={styles.keyCell}>
                          <kbd style={styles.kbd}>{s.key}</kbd>
                        </td>
                        <td style={styles.labelCell} data-testid="shortcut-label">
                          {s.label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <div>
            <h3 style={styles.heading}>Mouse, on the canvas</h3>
            <table style={styles.table}>
              <tbody>
                {MOUSE_GESTURES.map((g) => (
                  <tr key={g.gesture} data-testid="gesture-row" data-gesture={g.gesture}>
                    <td style={styles.keyCell}>
                      <kbd style={styles.kbd}>{g.gesture}</kbd>
                    </td>
                    <td style={styles.labelCell} data-testid="gesture-label">
                      {g.label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p style={styles.footnote}>
          Keys do nothing while you are typing in a text field. A fog or draw key arms that tool and
          opens its tab.
        </p>
      </div>
    </div>
  );
}
