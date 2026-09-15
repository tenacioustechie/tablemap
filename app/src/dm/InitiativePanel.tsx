/**
 * Sidebar panel for the campaign's initiative (T110, ADR 0027): the Turns
 * tab. Add an entry by name and value, or from a token on the active map
 * (the entry takes the token's label and links it); edit an entry's value
 * in place; remove one; click a row to make it current; **Sort**, **Prev** /
 * **Next** and the round; **Reset** and **Clear** behind an inline confirm.
 *
 * Every change is one `initiative/*` op dispatched straight to the store:
 * the list, the turn and the round are shared campaign state (the player's
 * strip draws them, T111), so nothing about them is held here. The only
 * local state is the add form's draft and which confirm is pending.
 * Initiative edits are not in any undo history.
 */
import { nanoid } from "nanoid";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  createInitiativeEntry,
  currentEntry,
  linkedToken,
  type InitiativeOp,
} from "../state/initiative";
import { useTableStore, type TableStore } from "../state/store";
import { tokenLabel } from "../state/tokens";

const styles = {
  heading: { fontSize: 13, margin: "12px 0 6px", color: "#aaa" },
  form: { display: "grid", gap: 6, fontSize: 12 },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  label: { display: "grid", gap: 2, color: "#aaa" },
  input: {
    padding: "4px 6px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
  },
  muted: { color: "#666", fontSize: 13, margin: 0 },
  status: { color: "#aaa", fontSize: 12, margin: 0 },
  round: { marginLeft: "auto", color: "#fc6", fontWeight: 600 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 4px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: 3,
    cursor: "pointer",
  },
  itemCurrent: { background: "#2a2510", borderColor: "#ffd24a" },
  value: { width: 52 },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
    background: "none",
    border: "none",
    color: "#ddd",
    font: "inherit",
    padding: "4px 2px",
    cursor: "pointer",
  },
  link: {
    padding: "0 5px",
    border: "1px solid #8cf",
    borderRadius: 8,
    color: "#8cf",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  danger: { color: "#f88" },
  kbd: {
    display: "inline-block",
    padding: "0 5px",
    border: "1px solid #555",
    borderRadius: 3,
    color: "#aaa",
    font: "inherit",
  },
} satisfies Record<string, CSSProperties>;

export interface InitiativePanelProps {
  store: TableStore;
  /** Ids for new entries; tests pass a counter. */
  newId?: () => string;
}

/** A typed initiative value: the number, or null when the text is empty or not a finite number. */
export function parseInitiativeValue(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

type PendingConfirm = "reset" | "clear" | null;

export function InitiativePanel({ store, newId = nanoid }: InitiativePanelProps) {
  const initiative = useTableStore((s) => s.shared.initiative, store);
  const maps = useTableStore((s) => s.shared.maps, store);
  const activeMapId = useTableStore((s) => s.shared.activeMapId, store);
  const dispatch = useTableStore((s) => s.dispatch, store);
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const { entries, turn, round } = initiative;
  const scene = maps.find((m) => m.id === activeMapId);
  const current = currentEntry(initiative);
  const linkedIds = new Set(entries.map((e) => e.tokenId));

  // A pending confirm has nothing left to act on once the list is empty.
  useEffect(() => {
    if (entries.length === 0) setConfirm(null);
  }, [entries.length]);

  const run = (op: InitiativeOp) => dispatch(op);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = draftName.trim();
    if (name === "") return;
    run({
      kind: "initiative/add",
      entry: createInitiativeEntry({ id: newId(), name, value: parseInitiativeValue(draftValue) ?? 0 }),
    });
    setDraftName("");
    setDraftValue("");
    nameInput.current?.focus();
  };

  const addToken = (tokenId: string) => {
    const token = scene?.tokens.find((t) => t.id === tokenId);
    if (!token) return;
    run({
      kind: "initiative/add",
      entry: createInitiativeEntry({
        id: newId(),
        name: tokenLabel(token),
        value: parseInitiativeValue(draftValue) ?? 0,
        tokenId: token.id,
      }),
    });
    setDraftValue("");
  };

  const tokenPrompt = !scene
    ? "Show a map to add its tokens"
    : scene.tokens.length === 0
      ? "No tokens on this map"
      : "Add from token…";

  return (
    <section data-testid="initiative-panel" style={styles.form}>
      <h3 style={styles.heading}>
        Initiative <span data-testid="initiative-count">({entries.length})</span>
      </h3>
      <form data-testid="initiative-form" onSubmit={add} style={styles.form}>
        <div style={styles.row}>
          <label style={{ ...styles.label, flex: 1 }}>
            Name
            <input
              ref={nameInput}
              data-testid="initiative-name"
              type="text"
              value={draftName}
              placeholder="Goblin 1"
              style={styles.input}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </label>
          <label style={styles.label}>
            Initiative
            <input
              data-testid="initiative-value"
              type="number"
              step="any"
              value={draftValue}
              placeholder="0"
              style={{ ...styles.input, ...styles.value }}
              onChange={(e) => setDraftValue(e.target.value)}
            />
          </label>
        </div>
        <div style={styles.row}>
          <button type="submit" data-testid="initiative-add" disabled={draftName.trim() === ""}>
            Add
          </button>
          <select
            data-testid="initiative-add-token"
            aria-label="Add from token"
            value=""
            disabled={!scene || scene.tokens.length === 0}
            style={{ ...styles.input, flex: 1 }}
            onChange={(e) => addToken(e.target.value)}
          >
            <option value="">{tokenPrompt}</option>
            {scene?.tokens.map((token) => (
              <option key={token.id} value={token.id} disabled={linkedIds.has(token.id)}>
                {tokenLabel(token)}
                {linkedIds.has(token.id) ? " (in the order)" : ""}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div style={styles.row}>
        <button
          type="button"
          data-testid="initiative-sort"
          disabled={entries.length < 2}
          onClick={() => run({ kind: "initiative/sort" })}
        >
          Sort
        </button>
        <button
          type="button"
          data-testid="initiative-prev"
          disabled={turn === null}
          onClick={() => run({ kind: "initiative/prev" })}
        >
          Prev
        </button>
        <button
          type="button"
          data-testid="initiative-next"
          disabled={entries.length === 0}
          onClick={() => run({ kind: "initiative/next" })}
        >
          Next
        </button>
        <span data-testid="initiative-round" data-round={round} style={styles.round}>
          Round {round}
        </span>
      </div>
      <p data-testid="initiative-current" style={styles.status}>
        {current
          ? `${current.name}'s turn.`
          : entries.length > 0
            ? "Nobody's turn yet: click Next, or click a row."
            : "No one in the order yet."}
      </p>

      {entries.length > 0 && (
        <ol data-testid="initiative-list" style={styles.list}>
          {entries.map((entry, index) => {
            const isCurrent = index === turn;
            const link = linkedToken({ maps, activeMapId }, entry);
            return (
              <li
                key={entry.id}
                data-testid="initiative-item"
                data-entry-id={entry.id}
                data-current={isCurrent ? "true" : "false"}
                data-linked={link ? "true" : "false"}
                aria-current={isCurrent ? "step" : undefined}
                style={isCurrent ? { ...styles.item, ...styles.itemCurrent } : styles.item}
                onClick={() => run({ kind: "initiative/set-turn", id: entry.id })}
              >
                <input
                  data-testid="initiative-item-value"
                  type="number"
                  step="any"
                  aria-label={`Initiative of ${entry.name}`}
                  value={entry.value}
                  style={{ ...styles.input, ...styles.value }}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const value = parseInitiativeValue(e.target.value);
                    if (value !== null) run({ kind: "initiative/update", id: entry.id, patch: { value } });
                  }}
                />
                <button
                  type="button"
                  data-testid="initiative-item-name"
                  aria-label={`Make it ${entry.name}'s turn`}
                  aria-pressed={isCurrent}
                  style={styles.name}
                >
                  {entry.name}
                </button>
                {link && (
                  <span
                    data-testid="initiative-item-link"
                    title={`Linked to ${tokenLabel(link.token)} on ${link.map.name}`}
                    style={styles.link}
                  >
                    {link.map.id === activeMapId ? "token" : `on ${link.map.name}`}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="initiative-item-remove"
                  aria-label={`Remove ${entry.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    run({ kind: "initiative/remove", id: entry.id });
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {confirm === "reset" ? (
        <div style={styles.row}>
          <button
            type="button"
            style={styles.danger}
            data-testid="initiative-reset-confirm"
            onClick={() => {
              run({ kind: "initiative/reset" });
              setConfirm(null);
            }}
          >
            Confirm reset
          </button>
          <button type="button" data-testid="initiative-reset-cancel" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      ) : confirm === "clear" ? (
        <div style={styles.row}>
          <button
            type="button"
            style={styles.danger}
            data-testid="initiative-clear-confirm"
            onClick={() => {
              run({ kind: "initiative/clear" });
              setConfirm(null);
            }}
          >
            Confirm clear
          </button>
          <button type="button" data-testid="initiative-clear-cancel" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={styles.row}>
          <button
            type="button"
            data-testid="initiative-reset"
            title="Back to the first entry's turn in round 1"
            disabled={entries.length === 0}
            onClick={() => setConfirm("reset")}
          >
            Reset
          </button>
          <button
            type="button"
            data-testid="initiative-clear"
            title="Remove every entry"
            disabled={entries.length === 0}
            onClick={() => setConfirm("clear")}
          >
            Clear
          </button>
        </div>
      )}
      <p style={styles.muted}>
        With this tab open, press <kbd style={styles.kbd}>.</kbd> for the next turn and{" "}
        <kbd style={styles.kbd}>,</kbd> for the previous one. The current entry's token gets a gold
        ring on your canvas. Changes to the order cannot be undone.
      </p>
    </section>
  );
}
