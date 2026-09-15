/**
 * The players' initiative strip (T111, ADR 0027): the campaign's turn order
 * as a row of name chips along the top edge of the TV, the current entry
 * highlighted in the turn ring's gold and "Round n" at the end.
 *
 * Render-only, from the mirror's `shared.initiative`: `PlayerView` mounts it
 * inside a `Rotated` box while the DM's `presentation.initiativeStrip` is on
 * and the list is not empty, so it reads along the top whichever way the
 * view is turned, beneath the splash and the blackout. Every entry is shown
 * as the DM entered it — the strip does not second-guess the list (the turn
 * ring is what follows the hidden and fogged rules).
 *
 * Its thickness is `INITIATIVE_STRIP_VMIN` % of the display's shorter side
 * (`vmin`), so it covers less than 8 % of the display height at any rotation.
 * A list too long for the edge scrolls sideways, and every change of turn
 * (or of the list) scrolls the current chip to the middle (`stripScrollLeft`);
 * the round stays put at the end.
 */
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { TURN_RING_COLOR } from "../map/TokenLayer";
import type { Initiative } from "../state/initiative";

/** The strip's thickness in % of the display's shorter side; the cap is 8. */
export const INITIATIVE_STRIP_VMIN = 7;

const PAD_VMIN = 1;
const CHIP_BORDER_VMIN = 0.3;
/** Chip line height: the strip's inner height minus the chip's borders. */
const CHIP_LINE_VMIN = INITIATIVE_STRIP_VMIN - 2 * PAD_VMIN - 2 * CHIP_BORDER_VMIN;

const stripStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: `${INITIATIVE_STRIP_VMIN}vmin`,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: "1.5vmin",
  padding: `${PAD_VMIN}vmin 1.5vmin`,
  background: "rgba(0, 0, 0, 0.75)",
  color: "#ddd",
  fontFamily: "system-ui, sans-serif",
  fontSize: "2.8vmin",
  userSelect: "none",
  pointerEvents: "auto",
};

const listStyle: CSSProperties = {
  position: "relative", // the chips' offsetParent, for the scroll maths
  flex: 1,
  minWidth: 0,
  height: "100%",
  display: "flex",
  alignItems: "center",
  gap: "1vmin",
  margin: 0,
  padding: 0,
  listStyle: "none",
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "none",
};

const chipStyle: CSSProperties = {
  flex: "none",
  display: "block",
  height: "100%",
  boxSizing: "border-box",
  maxWidth: "32vmin",
  padding: "0 1.8vmin",
  border: `${CHIP_BORDER_VMIN}vmin solid rgba(255, 255, 255, 0.25)`,
  borderRadius: `${INITIATIVE_STRIP_VMIN}vmin`,
  lineHeight: `${CHIP_LINE_VMIN}vmin`,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const currentChipStyle: CSSProperties = {
  ...chipStyle,
  background: TURN_RING_COLOR,
  borderColor: TURN_RING_COLOR,
  color: "#111",
  fontWeight: 700,
};

const roundStyle: CSSProperties = {
  flex: "none",
  color: TURN_RING_COLOR,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export interface StripScrollInput {
  /** The chip's left edge and width inside the scrolling list, in CSS px. */
  chipLeft: number;
  chipWidth: number;
  /** The list's visible width and its scrollable content width. */
  viewWidth: number;
  contentWidth: number;
}

/** The list's `scrollLeft` that centres the chip, clamped to what the list can scroll. */
export function stripScrollLeft({ chipLeft, chipWidth, viewWidth, contentWidth }: StripScrollInput): number {
  const max = Math.max(0, contentWidth - viewWidth);
  const centred = chipLeft + chipWidth / 2 - viewWidth / 2;
  return Math.min(max, Math.max(0, centred));
}

export function InitiativeStrip({ initiative }: { initiative: Initiative }) {
  const { entries, turn, round } = initiative;
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the current chip in view. Layout offsets, not bounding boxes: the
  // strip may be turned by its `Rotated` box.
  useLayoutEffect(() => {
    const list = listRef.current;
    const chip = turn === null ? undefined : list?.children[turn];
    if (!list || !(chip instanceof HTMLElement)) return;
    list.scrollLeft = stripScrollLeft({
      chipLeft: chip.offsetLeft,
      chipWidth: chip.offsetWidth,
      viewWidth: list.clientWidth,
      contentWidth: list.scrollWidth,
    });
  }, [turn, entries]);

  return (
    <div
      data-testid="player-initiative-strip"
      data-entries={entries.length}
      data-turn={turn ?? ""}
      data-round={round}
      style={stripStyle}
    >
      <ol ref={listRef} data-testid="player-initiative-list" style={listStyle}>
        {entries.map((entry, index) => {
          const current = index === turn;
          return (
            <li
              key={entry.id}
              data-testid="player-initiative-entry"
              data-entry-id={entry.id}
              data-current={current ? "true" : "false"}
              aria-current={current ? "step" : undefined}
              style={current ? currentChipStyle : chipStyle}
            >
              {entry.name}
            </li>
          );
        })}
      </ol>
      <span data-testid="player-initiative-round" style={roundStyle}>
        Round {round}
      </span>
    </div>
  );
}
