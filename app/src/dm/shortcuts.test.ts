/**
 * The DM view's keymap (T018): every listed key maps to its command, keys
 * with Ctrl / Cmd / Alt (and Shift, bar `?`) map to nothing, nothing fires
 * from inside a text field, and the table the cheat sheet renders from is
 * complete and free of duplicates.
 */
import { DM_TABS } from "./SidebarTabs";
import {
  isEditableTarget,
  MOUSE_GESTURES,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  shortcutFor,
  shortcutKeyFor,
  TAB_KEYS,
  type ShortcutCommand,
  type ShortcutKeyEvent,
} from "./shortcuts";

function key(
  k: string,
  extra: Partial<Omit<ShortcutKeyEvent, "key">> = {}
): ShortcutKeyEvent {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: document.body,
    ...extra,
  };
}

/** Every key and what it must do, spelled out so the table cannot drift silently. */
const EXPECTED: [string, ShortcutCommand][] = [
  ["1", { kind: "tab", tab: "maps" }],
  ["2", { kind: "tab", tab: "fog" }],
  ["3", { kind: "tab", tab: "tokens" }],
  ["4", { kind: "tab", tab: "draw" }],
  ["5", { kind: "tab", tab: "walls" }],
  ["6", { kind: "tab", tab: "table" }],
  ["7", { kind: "tab", tab: "turns" }],
  ["?", { kind: "help" }],
  ["V", { kind: "stop" }],
  ["G", { kind: "align" }],
  ["N", { kind: "note" }],
  ["R", { kind: "fog-mode", mode: "reveal" }],
  ["H", { kind: "fog-mode", mode: "hide" }],
  ["B", { kind: "fog-tool", tool: "brush" }],
  ["X", { kind: "fog-tool", tool: "rect" }],
  ["L", { kind: "fog-tool", tool: "lasso" }],
  ["F", { kind: "fog-tool", tool: "fill" }],
  ["[", { kind: "brush-radius", direction: -1 }],
  ["]", { kind: "brush-radius", direction: 1 }],
  ["P", { kind: "draw-mode", mode: "draw" }],
  ["E", { kind: "draw-mode", mode: "erase" }],
  ["W", { kind: "wall-tool", tool: "wall" }],
  ["D", { kind: "wall-tool", tool: "door" }],
  [".", { kind: "turn", direction: 1 }],
  [",", { kind: "turn", direction: -1 }],
];

describe("shortcutFor", () => {
  it("maps every listed key to its command, as typed or as the letter's lower case", () => {
    for (const [k, command] of EXPECTED) {
      expect(shortcutFor(key(k)), k).toEqual(command);
      expect(shortcutFor(key(k.toLowerCase())), k.toLowerCase()).toEqual(command);
    }
  });

  it("gives every tab its own digit: 1–6 as before, and the next free one, 7, to Turns (T110)", () => {
    // Until T110 the digits followed the strip's order; Turns sits after
    // Tokens in the strip but takes 7, so no existing key moved.
    expect(Object.keys(TAB_KEYS).sort()).toEqual(DM_TABS.map((t) => t.id).sort());
    for (const t of DM_TABS) {
      expect(shortcutFor(key(TAB_KEYS[t.id]))).toEqual({ kind: "tab", tab: t.id });
    }
    expect(DM_TABS.map((t) => TAB_KEYS[t.id])).toEqual(["1", "2", "3", "7", "4", "5", "6"]);
    expect(shortcutFor(key("8"))).toBeNull();
    expect(shortcutFor(key("0"))).toBeNull();
  });

  it("turn keys are plain . and , — not with Shift (< and >) or a modifier (T110)", () => {
    expect(shortcutFor(key("."))).toEqual({ kind: "turn", direction: 1 });
    expect(shortcutFor(key(","))).toEqual({ kind: "turn", direction: -1 });
    expect(shortcutFor(key(".", { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key(">", { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key(",", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key(".", { target: document.createElement("input") }))).toBeNull();
  });

  it("is nothing for keys that are not shortcuts, Esc and Space included", () => {
    // (F was listed here until T108 made it the fill tool's key; the player window's own F is not a DM shortcut.)
    for (const k of ["a", "q", "Escape", " ", "Enter", "ArrowLeft", "K", "Tab", "z", "y"]) {
      expect(shortcutFor(key(k)), k).toBeNull();
    }
  });

  it("is nothing with Ctrl, Cmd or Alt held (undo / redo and the browser keep those)", () => {
    for (const [k] of EXPECTED) {
      expect(shortcutFor(key(k, { ctrlKey: true })), `Ctrl+${k}`).toBeNull();
      expect(shortcutFor(key(k, { metaKey: true })), `Cmd+${k}`).toBeNull();
      expect(shortcutFor(key(k, { altKey: true })), `Alt+${k}`).toBeNull();
    }
    expect(shortcutFor(key("z", { ctrlKey: true }))).toBeNull();
  });

  it("is nothing with Shift held, except for ?, which needs Shift on most layouts", () => {
    for (const [k] of EXPECTED) {
      if (k === "?") continue;
      expect(shortcutFor(key(k, { shiftKey: true })), `Shift+${k}`).toBeNull();
    }
    expect(shortcutFor(key("?", { shiftKey: true }))).toEqual({ kind: "help" });
    expect(shortcutFor(key("?"))).toEqual({ kind: "help" });
  });

  it("is nothing while a text field, select or editable element has the keys", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not compute isContentEditable; the guard reads the property.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const target of [input, textarea, select, editable]) {
      for (const [k] of EXPECTED) {
        expect(shortcutFor(key(k, { target })), `${target.tagName} ${k}`).toBeNull();
      }
    }
    const button = document.createElement("button");
    expect(shortcutFor(key("B", { target: button }))).toEqual({ kind: "fog-tool", tool: "brush" });
    expect(shortcutFor(key("B", { target: null }))).toEqual({ kind: "fog-tool", tool: "brush" });
  });
});

describe("isEditableTarget", () => {
  it("is true for inputs, textareas, selects and contenteditable, false otherwise", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe("SHORTCUTS", () => {
  it("lists exactly the expected keys, each once, with a label and a known group", () => {
    expect(SHORTCUTS.map((s) => s.key)).toEqual(EXPECTED.map(([k]) => k));
    expect(new Set(SHORTCUTS.map((s) => s.key.toLowerCase())).size).toBe(SHORTCUTS.length);
    for (const s of SHORTCUTS) {
      expect(s.label.length).toBeGreaterThan(3);
      expect(SHORTCUT_GROUPS).toContain(s.group);
    }
    expect(SHORTCUTS.map((s) => s.command)).toEqual(EXPECTED.map(([, c]) => c));
  });

  it("names the mouse gestures the canvas supports, the pan override among them", () => {
    const gestures = MOUSE_GESTURES.map((g) => g.gesture).join("\n");
    expect(gestures).toMatch(/wheel/i);
    expect(gestures).toMatch(/drag/i);
    expect(gestures).toMatch(/alt/i);
    expect(gestures).toMatch(/space/i);
    expect(gestures).toMatch(/middle/i);
    expect(new Set(MOUSE_GESTURES.map((g) => g.gesture)).size).toBe(MOUSE_GESTURES.length);
  });
});

describe("shortcutKeyFor", () => {
  it("finds the key of every command, by value, and null for one that has none", () => {
    for (const [k, command] of EXPECTED) {
      expect(shortcutKeyFor({ ...command })).toBe(k);
    }
    expect(shortcutKeyFor({ kind: "tab", tab: "fog" })).toBe("2");
    expect(shortcutKeyFor({ kind: "tab", tab: "walls" })).toBe("5");
    expect(shortcutKeyFor({ kind: "tab", tab: "table" })).toBe("6");
    expect(shortcutKeyFor({ kind: "fog-tool", tool: "lasso" })).toBe("L");
    expect(shortcutKeyFor({ kind: "brush-radius", direction: 1 })).toBe("]");
    // A command shape the table does not hold.
    expect(shortcutKeyFor({ kind: "tab", tab: "nowhere" as "maps" })).toBeNull();
  });
});
