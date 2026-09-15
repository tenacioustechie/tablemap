/**
 * The Turns tab's panel (T110) against a real store: every control
 * dispatches exactly the `initiative/*` op it names (watched through
 * `store.onOps`), the list is the store's order with the current row
 * marked, and nothing but the add form's draft (and a pending confirm) is
 * held in the panel — everything it shows comes back from the store.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createInitiativeEntry, type Initiative, type InitiativeEntry } from "../state/initiative";
import { createBlankMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { initialSharedState, type SharedOp } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { createToken } from "../state/tokens";
import { InitiativePanel, parseInitiativeValue } from "./InitiativePanel";

const disc = { type: "disc" as const, color: "#f00" };

/** Map A (active by default): a named token and an unnamed one with a badge. Map B: an ogre. */
function maps(): MapScene[] {
  const a = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 });
  const b = createBlankMapScene({ id: "b", name: "Cellar", columns: 4, rows: 4, cellSize: 50 });
  return [
    {
      ...a,
      tokens: [
        createToken({ id: "gob", x: 0, y: 0, appearance: disc, name: "Goblin" }),
        createToken({ id: "t2", x: 50, y: 0, appearance: disc, badge: "2" }),
      ],
    },
    { ...b, tokens: [createToken({ id: "ogre", x: 0, y: 0, appearance: disc, name: "Ogre" })] },
  ];
}

function setup({
  initiative,
  activeMapId = "a",
}: { initiative?: Initiative; activeMapId?: string | null } = {}) {
  const store = createTableStore({
    ...initialSharedState(),
    maps: maps(),
    activeMapId,
    ...(initiative ? { initiative } : {}),
  });
  const ops: SharedOp[] = [];
  store.onOps((batch) => ops.push(...batch));
  let n = 0;
  render(<InitiativePanel store={store} newId={() => `e${++n}`} />);
  return { store, ops };
}

const entry = (id: string, name: string, value: number, tokenId: string | null = null): InitiativeEntry =>
  createInitiativeEntry({ id, name, value, tokenId });

/** Xan 12, Yor 18, Zed 5, unsorted. */
const three = (turn: number | null = null, round = 1): Initiative => ({
  entries: [entry("x", "Xan", 12), entry("y", "Yor", 18), entry("z", "Zed", 5)],
  turn,
  round,
});

const items = () => screen.queryAllByTestId("initiative-item");
const names = () => items().map((li) => within(li).getByTestId("initiative-item-name").textContent);
const currents = () => items().map((li) => li.dataset.current);
const byId = (id: string) => screen.getByTestId(id);
const button = (id: string) => byId(id) as HTMLButtonElement;
const input = (id: string) => byId(id) as HTMLInputElement;
const initiativeOf = (store: TableStore) => store.getState().shared.initiative;
const typeDraft = (name: string, value: string) => {
  fireEvent.change(input("initiative-name"), { target: { value: name } });
  fireEvent.change(input("initiative-value"), { target: { value } });
};

describe("parseInitiativeValue", () => {
  it("reads finite numbers, fractions and negatives; empty or anything else is null", () => {
    expect(parseInitiativeValue("17")).toBe(17);
    expect(parseInitiativeValue(" -2 ")).toBe(-2);
    expect(parseInitiativeValue("12.5")).toBe(12.5);
    expect(parseInitiativeValue("")).toBeNull();
    expect(parseInitiativeValue("   ")).toBeNull();
    expect(parseInitiativeValue("abc")).toBeNull();
    expect(parseInitiativeValue("Infinity")).toBeNull();
  });
});

describe("InitiativePanel (T110)", () => {
  it("starts empty in round 1 with nothing to sort, step, reset or clear", () => {
    const { ops } = setup();
    expect(byId("initiative-count").textContent).toBe("(0)");
    expect(screen.queryByTestId("initiative-list")).toBeNull();
    expect(byId("initiative-round").textContent).toBe("Round 1");
    expect(byId("initiative-round").dataset.round).toBe("1");
    expect(byId("initiative-current").textContent).toMatch(/no one/i);
    for (const id of ["initiative-add", "initiative-sort", "initiative-prev", "initiative-next", "initiative-reset", "initiative-clear"]) {
      expect(button(id).disabled, id).toBe(true);
    }
    expect(ops).toEqual([]);
  });

  it("Add dispatches one initiative/add with the typed name and value and clears the draft; no value is 0; a blank name adds nothing", () => {
    const { store, ops } = setup();
    typeDraft("  Goblin  ", "17");
    expect(button("initiative-add").disabled).toBe(false);
    fireEvent.click(button("initiative-add"));
    expect(ops).toEqual([
      { kind: "initiative/add", entry: { id: "e1", name: "Goblin", value: 17, tokenId: null } },
    ]);
    expect(input("initiative-name").value).toBe("");
    expect(input("initiative-value").value).toBe("");
    expect(document.activeElement).toBe(input("initiative-name"));
    expect(names()).toEqual(["Goblin"]);
    expect(byId("initiative-count").textContent).toBe("(1)");

    typeDraft("Ogre", "");
    fireEvent.submit(byId("initiative-form"));
    expect(ops[1]).toEqual({ kind: "initiative/add", entry: { id: "e2", name: "Ogre", value: 0, tokenId: null } });

    typeDraft("   ", "4");
    expect(button("initiative-add").disabled).toBe(true);
    fireEvent.submit(byId("initiative-form"));
    expect(ops).toHaveLength(2);
    expect(initiativeOf(store).entries.map((e) => e.name)).toEqual(["Goblin", "Ogre"]);
    // The turn is untouched by adding.
    expect(initiativeOf(store).turn).toBeNull();
  });

  it("Add from token lists the active map's tokens by label and adds the picked one linked, with the drafted value; a linked token cannot be picked again", () => {
    const { ops } = setup();
    const select = () => byId("initiative-add-token") as HTMLSelectElement;
    const options = () => Array.from(select().options);
    expect(options().map((o) => o.textContent)).toEqual(["Add from token…", "Goblin", "Token 2"]);
    expect(options().every((o) => !o.disabled)).toBe(true);

    fireEvent.change(input("initiative-value"), { target: { value: "14" } });
    fireEvent.change(select(), { target: { value: "gob" } });
    expect(ops).toEqual([
      { kind: "initiative/add", entry: { id: "e1", name: "Goblin", value: 14, tokenId: "gob" } },
    ]);
    expect(input("initiative-value").value).toBe("");
    expect(select().value).toBe("");
    expect(items()[0].dataset.linked).toBe("true");
    expect(within(items()[0]).getByTestId("initiative-item-link").textContent).toBe("token");
    expect(options()[1].disabled).toBe(true);
    expect(options()[1].textContent).toBe("Goblin (in the order)");

    fireEvent.change(select(), { target: { value: "t2" } });
    expect(ops[1]).toEqual({ kind: "initiative/add", entry: { id: "e2", name: "Token 2", value: 0, tokenId: "t2" } });
    expect(names()).toEqual(["Goblin", "Token 2"]);
  });

  it("with no map shown the token picker is disabled and says why", () => {
    setup({ activeMapId: null });
    const select = byId("initiative-add-token") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options[0].textContent).toBe("Show a map to add its tokens");
    expect(select.options).toHaveLength(1);
  });

  it("lists the store's order with the current row marked, and a link indicator only for links that name a token", () => {
    setup({
      initiative: {
        entries: [
          entry("g", "Goblin", 15, "gob"),
          entry("o", "Ogre", 12, "ogre"),
          entry("h", "Ghost", 8, "gone"),
          entry("x", "Xan", 3),
        ],
        turn: 1,
        round: 2,
      },
    });
    expect(names()).toEqual(["Goblin", "Ogre", "Ghost", "Xan"]);
    expect(currents()).toEqual(["false", "true", "false", "false"]);
    expect(items()[1].getAttribute("aria-current")).toBe("step");
    expect(items()[0].hasAttribute("aria-current")).toBe(false);
    expect(items().map((li) => li.dataset.linked)).toEqual(["true", "true", "false", "false"]);
    expect(screen.getAllByTestId("initiative-item-link").map((l) => l.textContent)).toEqual(["token", "on Cellar"]);
    expect(items().map((li) => (within(li).getByTestId("initiative-item-value") as HTMLInputElement).value)).toEqual([
      "15",
      "12",
      "8",
      "3",
    ]);
    expect(byId("initiative-round").textContent).toBe("Round 2");
    expect(byId("initiative-current").textContent).toBe("Ogre's turn.");
  });

  it("editing a value dispatches initiative/update for that entry (no re-sort); an empty value dispatches nothing; the field never changes the turn", () => {
    const { store, ops } = setup({ initiative: three(0) });
    const value = (i: number) => within(items()[i]).getByTestId("initiative-item-value") as HTMLInputElement;
    fireEvent.click(value(1));
    fireEvent.change(value(1), { target: { value: "20" } });
    expect(ops).toEqual([{ kind: "initiative/update", id: "y", patch: { value: 20 } }]);
    expect(value(1).value).toBe("20");
    expect(names()).toEqual(["Xan", "Yor", "Zed"]);
    expect(currents()).toEqual(["true", "false", "false"]);

    fireEvent.change(value(2), { target: { value: "" } });
    expect(ops).toHaveLength(1);
    expect(initiativeOf(store).entries[2].value).toBe(5);
  });

  it("a click on a row, or on its name, makes it current with initiative/set-turn; Remove removes that entry and nothing else", () => {
    const { store, ops } = setup({ initiative: three(0) });
    fireEvent.click(items()[2]);
    expect(ops).toEqual([{ kind: "initiative/set-turn", id: "z" }]);
    expect(currents()).toEqual(["false", "false", "true"]);

    fireEvent.click(within(items()[1]).getByTestId("initiative-item-name"));
    expect(ops[1]).toEqual({ kind: "initiative/set-turn", id: "y" });
    expect(currents()).toEqual(["false", "true", "false"]);

    fireEvent.click(within(items()[0]).getByTestId("initiative-item-remove"));
    expect(ops.slice(2)).toEqual([{ kind: "initiative/remove", id: "x" }]);
    expect(names()).toEqual(["Yor", "Zed"]);
    // Yor is still current, now at index 0.
    expect(currents()).toEqual(["true", "false"]);
    expect(initiativeOf(store).turn).toBe(0);
  });

  it("Sort, Next and Prev dispatch their ops and the round counter follows the store", () => {
    const { ops } = setup({ initiative: three(2) });
    expect(button("initiative-prev").disabled).toBe(false);
    fireEvent.click(button("initiative-sort"));
    expect(ops).toEqual([{ kind: "initiative/sort" }]);
    expect(names()).toEqual(["Yor", "Xan", "Zed"]);
    expect(currents()).toEqual(["false", "false", "true"]);

    fireEvent.click(button("initiative-next"));
    expect(ops[1]).toEqual({ kind: "initiative/next" });
    expect(currents()).toEqual(["true", "false", "false"]);
    expect(byId("initiative-round").textContent).toBe("Round 2");

    fireEvent.click(button("initiative-prev"));
    expect(ops[2]).toEqual({ kind: "initiative/prev" });
    expect(currents()).toEqual(["false", "false", "true"]);
    expect(byId("initiative-round").textContent).toBe("Round 1");
    expect(ops).toHaveLength(3);
  });

  it("Prev waits for a turn; Next starts the first one", () => {
    const { ops } = setup({ initiative: three(null) });
    expect(button("initiative-prev").disabled).toBe(true);
    expect(byId("initiative-current").textContent).toMatch(/nobody's turn/i);
    fireEvent.click(button("initiative-next"));
    expect(ops).toEqual([{ kind: "initiative/next" }]);
    expect(currents()).toEqual(["true", "false", "false"]);
    expect(byId("initiative-current").textContent).toBe("Xan's turn.");
  });

  it("Reset and Clear ask first: Cancel dispatches nothing, Confirm dispatches initiative/reset or initiative/clear", () => {
    const { store, ops } = setup({ initiative: three(2, 3) });
    fireEvent.click(button("initiative-reset"));
    expect(screen.queryByTestId("initiative-reset")).toBeNull();
    expect(screen.queryByTestId("initiative-clear")).toBeNull();
    fireEvent.click(button("initiative-reset-cancel"));
    expect(ops).toEqual([]);
    expect(screen.queryByTestId("initiative-reset-confirm")).toBeNull();

    fireEvent.click(button("initiative-reset"));
    fireEvent.click(button("initiative-reset-confirm"));
    expect(ops).toEqual([{ kind: "initiative/reset" }]);
    expect(byId("initiative-round").textContent).toBe("Round 1");
    expect(currents()).toEqual(["true", "false", "false"]);
    expect(screen.queryByTestId("initiative-reset-confirm")).toBeNull();

    fireEvent.click(button("initiative-clear"));
    fireEvent.click(button("initiative-clear-cancel"));
    expect(ops).toHaveLength(1);
    expect(items()).toHaveLength(3);

    fireEvent.click(button("initiative-clear"));
    fireEvent.click(button("initiative-clear-confirm"));
    expect(ops[1]).toEqual({ kind: "initiative/clear" });
    expect(items()).toHaveLength(0);
    expect(initiativeOf(store)).toEqual({ entries: [], turn: null, round: 1 });
    expect(button("initiative-clear").disabled).toBe(true);
  });

  it("a pending confirm folds away when the list empties elsewhere", () => {
    const { store } = setup({ initiative: three(0) });
    fireEvent.click(button("initiative-clear"));
    expect(byId("initiative-clear-confirm")).toBeTruthy();
    // A dispatch from outside the panel empties the list.
    act(() => store.getState().dispatch({ kind: "initiative/clear" }));
    expect(screen.queryByTestId("initiative-clear-confirm")).toBeNull();
    expect(button("initiative-clear").disabled).toBe(true);
  });

  it("five entries: add, sort, next through a full round (the round counter increments), remove the current one, clear — every change an op", () => {
    const { store, ops } = setup();
    for (const [name, value] of [
      ["Aria", "12"],
      ["Bram", "19"],
      ["Cato", "7"],
      ["Dax", "15"],
      ["Eve", "3"],
    ]) {
      typeDraft(name, value);
      fireEvent.click(button("initiative-add"));
    }
    expect(names()).toEqual(["Aria", "Bram", "Cato", "Dax", "Eve"]);

    fireEvent.click(button("initiative-sort"));
    expect(names()).toEqual(["Bram", "Dax", "Aria", "Cato", "Eve"]);

    for (let i = 0; i < 5; i++) {
      fireEvent.click(button("initiative-next"));
      expect(items()[i].dataset.current).toBe("true");
      expect(byId("initiative-round").textContent).toBe("Round 1");
    }
    fireEvent.click(button("initiative-next"));
    expect(currents()).toEqual(["true", "false", "false", "false", "false"]);
    expect(byId("initiative-round").textContent).toBe("Round 2");

    fireEvent.click(within(items()[0]).getByTestId("initiative-item-remove"));
    expect(names()).toEqual(["Dax", "Aria", "Cato", "Eve"]);
    expect(currents()).toEqual(["true", "false", "false", "false"]);
    expect(byId("initiative-current").textContent).toBe("Dax's turn.");

    fireEvent.click(button("initiative-clear"));
    fireEvent.click(button("initiative-clear-confirm"));
    expect(items()).toHaveLength(0);
    expect(byId("initiative-round").textContent).toBe("Round 1");

    expect(ops.map((op) => op.kind)).toEqual([
      ...Array<string>(5).fill("initiative/add"),
      "initiative/sort",
      ...Array<string>(6).fill("initiative/next"),
      "initiative/remove",
      "initiative/clear",
    ]);
    expect(initiativeOf(store)).toEqual({ entries: [], turn: null, round: 1 });
  });

  it("Show the turn strip on the TV switches the presentation, not the list (T111)", () => {
    const { store, ops } = setup({ initiative: three(1) });
    const checkbox = () => input("initiative-strip-checkbox");
    const before = initiativeOf(store);
    expect(checkbox().checked).toBe(false);
    expect(store.getState().presentation.initiativeStrip).toBe(false);

    fireEvent.click(checkbox());
    expect(store.getState().presentation.initiativeStrip).toBe(true);
    expect(checkbox().checked).toBe(true);
    // Set elsewhere (the toolbar): the box follows.
    act(() => store.getState().setPresentation({ initiativeStrip: false }));
    expect(checkbox().checked).toBe(false);
    fireEvent.click(checkbox());
    fireEvent.click(checkbox());
    expect(store.getState().presentation.initiativeStrip).toBe(false);

    expect(ops).toEqual([]);
    expect(store.getState().seq).toBe(0);
    expect(initiativeOf(store)).toBe(before);
  });
});
