/**
 * The players' initiative strip (T111) on its own: the scroll maths that
 * keeps the current chip in view, and the strip applying it as the turn
 * moves. The strip inside the player view — the DM's toggle, the empty
 * list, rotation and z-order — is tested in `usePlayerSync.test.tsx`.
 */
import { render, screen } from "@testing-library/react";
import { TURN_RING_COLOR } from "../map/TokenLayer";
import { createInitiativeEntry, type Initiative } from "../state/initiative";
import { INITIATIVE_STRIP_VMIN, InitiativeStrip, stripScrollLeft } from "./InitiativeStrip";

describe("stripScrollLeft", () => {
  // A 300 px wide list holding 1000 px of chips.
  const at = (chipLeft: number, chipWidth = 100) =>
    stripScrollLeft({ chipLeft, chipWidth, viewWidth: 300, contentWidth: 1000 });

  it("centres the chip, never scrolling before the start or past the end", () => {
    expect(at(0)).toBe(0);
    expect(at(100)).toBe(0);
    expect(at(400)).toBe(300);
    expect(at(250, 50)).toBe(125);
    expect(at(800)).toBe(700);
    expect(at(900)).toBe(700);
  });

  it("never scrolls a list that fits", () => {
    expect(stripScrollLeft({ chipLeft: 200, chipWidth: 80, viewWidth: 300, contentWidth: 280 })).toBe(0);
  });
});

/** Replaces a layout getter (jsdom has no layout) on every HTML element; returns the undo. */
function stubLayout(name: string, get: (this: HTMLElement) => number, set?: (this: HTMLElement, v: number) => void) {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get, set });
  return () => {
    if (own) Object.defineProperty(HTMLElement.prototype, name, own);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  };
}

describe("InitiativeStrip", () => {
  const entries = Array.from({ length: 12 }, (_, i) =>
    createInitiativeEntry({ id: `e${i}`, name: `Goblin ${i + 1}`, value: 20 - i })
  );
  const at = (turn: number | null, round = 1): Initiative => ({ entries, turn, round });
  const chips = () => screen.getAllByTestId("player-initiative-entry");

  it("is thin: its thickness is under the 8 % cap of the display's shorter side", () => {
    render(<InitiativeStrip initiative={at(0)} />);
    expect(INITIATIVE_STRIP_VMIN).toBeGreaterThan(0);
    expect(INITIATIVE_STRIP_VMIN).toBeLessThanOrEqual(8);
    const strip = screen.getByTestId("player-initiative-strip");
    expect(strip.style.height).toBe(`${INITIATIVE_STRIP_VMIN}vmin`);
    expect(strip.style.top).toBe("0px");
  });

  it("names every entry in order, marks the current one in the ring's gold and ends with the round", () => {
    const { rerender } = render(<InitiativeStrip initiative={at(null, 3)} />);
    const strip = screen.getByTestId("player-initiative-strip");
    expect(chips().map((c) => c.textContent)).toEqual(entries.map((e) => e.name));
    expect(chips().every((c) => c.dataset.current === "false")).toBe(true);
    expect(strip.dataset.turn).toBe("");
    expect(strip.dataset.entries).toBe("12");
    expect(strip.lastElementChild?.textContent).toBe("Round 3");

    rerender(<InitiativeStrip initiative={at(2, 3)} />);
    expect(chips().map((c) => c.dataset.current)).toEqual(entries.map((_, i) => (i === 2 ? "true" : "false")));
    expect(chips()[2].getAttribute("aria-current")).toBe("step");
    expect(chips()[1].getAttribute("aria-current")).toBeNull();
    expect(chips()[2].style.borderColor).not.toBe(chips()[1].style.borderColor);
    const gold = document.createElement("div");
    gold.style.background = TURN_RING_COLOR;
    expect(chips()[2].style.background).toBe(gold.style.background);
    expect(strip.dataset.turn).toBe("2");
  });

  it("scrolls the current chip to the middle of a long list whenever the turn moves", () => {
    // Every chip 100 px wide at 100 px × its index; the list shows 300 of 1200 px.
    const scrolled = new WeakMap<HTMLElement, number>();
    const undo = [
      stubLayout("offsetLeft", function () {
        return this.parentElement ? 100 * Array.from(this.parentElement.children).indexOf(this) : 0;
      }),
      stubLayout("offsetWidth", () => 100),
      stubLayout("clientWidth", () => 300),
      stubLayout("scrollWidth", () => 1200),
      stubLayout(
        "scrollLeft",
        function () {
          return scrolled.get(this) ?? 0;
        },
        function (value) {
          scrolled.set(this, value);
        }
      ),
    ];
    try {
      const { rerender } = render(<InitiativeStrip initiative={at(null)} />);
      const list = screen.getByTestId("player-initiative-list");
      expect(list.scrollLeft).toBe(0);
      rerender(<InitiativeStrip initiative={at(5)} />);
      expect(list.scrollLeft).toBe(400);
      rerender(<InitiativeStrip initiative={at(11)} />);
      expect(list.scrollLeft).toBe(900);
      rerender(<InitiativeStrip initiative={at(0)} />);
      expect(list.scrollLeft).toBe(0);
    } finally {
      for (const restore of undo) restore();
    }
  });
});
