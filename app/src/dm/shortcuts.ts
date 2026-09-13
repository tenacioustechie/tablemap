/**
 * The DM view's single-key shortcuts (T018, ADR 0022): one pure table,
 * `SHORTCUTS`, that the `?` cheat sheet, the user guide's keyboard table
 * (checked by `docs.test.ts`) and the toolbar chip all render from, and one
 * pure function, `shortcutFor(event)`, that turns a keydown into a command
 * or nothing. `DmView` turns commands into its tool and tab calls; nothing
 * here touches React or the store.
 *
 * Rules: no Ctrl / Cmd / Alt (those are undo / redo and the browser's);
 * Shift only for `?`, which needs it on most layouts; nothing fires while a
 * text field, select or editable element has the keys (`isEditableTarget`).
 * Esc and Space are deliberately *not* commands: Esc stays the tools' own
 * cancel key (and closes the cheat sheet when it is open), Space is the pan
 * modifier the canvas watches itself.
 */
import type { FogMode } from "../state/fog";
import type { WallKind } from "../state/walls";
import type { DrawMode } from "./annotationTool";
import type { FogToolKind } from "./fogTool";
import { DM_TABS, type DmTabId } from "./SidebarTabs";

export type ShortcutCommand =
  | { kind: "tab"; tab: DmTabId }
  | { kind: "stop" }
  | { kind: "fog-mode"; mode: FogMode }
  | { kind: "fog-tool"; tool: FogToolKind }
  | { kind: "brush-radius"; direction: -1 | 1 }
  | { kind: "draw-mode"; mode: DrawMode }
  | { kind: "note" }
  | { kind: "align" }
  | { kind: "wall-tool"; tool: WallKind }
  | { kind: "help" };

export type ShortcutGroup = "Tabs" | "Tools" | "Fog" | "Draw" | "Walls";

export interface Shortcut {
  /** The `KeyboardEvent.key` value, as shown on the cheat sheet. */
  key: string;
  /** What it does, as shown on the cheat sheet and in the user guide. */
  label: string;
  group: ShortcutGroup;
  command: ShortcutCommand;
}

const TAB_SHORTCUTS: Shortcut[] = DM_TABS.map((t, i) => ({
  key: String(i + 1),
  label: `Open the ${t.label} tab`,
  group: "Tabs",
  command: { kind: "tab", tab: t.id },
}));

/** Every keyboard shortcut, in the order the cheat sheet lists them. */
export const SHORTCUTS: readonly Shortcut[] = [
  ...TAB_SHORTCUTS,
  { key: "?", label: "Show or hide this cheat sheet", group: "Tools", command: { kind: "help" } },
  { key: "V", label: "Stop the armed tool", group: "Tools", command: { kind: "stop" } },
  { key: "G", label: "Align grid", group: "Tools", command: { kind: "align" } },
  { key: "N", label: "Place a note", group: "Tools", command: { kind: "note" } },
  { key: "R", label: "Fog: reveal mode", group: "Fog", command: { kind: "fog-mode", mode: "reveal" } },
  { key: "H", label: "Fog: hide mode", group: "Fog", command: { kind: "fog-mode", mode: "hide" } },
  { key: "B", label: "Fog: brush", group: "Fog", command: { kind: "fog-tool", tool: "brush" } },
  { key: "X", label: "Fog: rectangle", group: "Fog", command: { kind: "fog-tool", tool: "rect" } },
  { key: "L", label: "Fog: lasso", group: "Fog", command: { kind: "fog-tool", tool: "lasso" } },
  { key: "[", label: "Fog: smaller brush", group: "Fog", command: { kind: "brush-radius", direction: -1 } },
  { key: "]", label: "Fog: larger brush", group: "Fog", command: { kind: "brush-radius", direction: 1 } },
  { key: "P", label: "Draw: pen", group: "Draw", command: { kind: "draw-mode", mode: "draw" } },
  { key: "E", label: "Draw: eraser", group: "Draw", command: { kind: "draw-mode", mode: "erase" } },
  { key: "W", label: "Walls: wall", group: "Walls", command: { kind: "wall-tool", tool: "wall" } },
  { key: "D", label: "Walls: door", group: "Walls", command: { kind: "wall-tool", tool: "door" } },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Tabs", "Tools", "Fog", "Draw", "Walls"];

export interface MouseGesture {
  gesture: string;
  label: string;
}

/** The canvas's mouse gestures, listed on the cheat sheet next to the keys. */
export const MOUSE_GESTURES: readonly MouseGesture[] = [
  { gesture: "Wheel", label: "Zoom around the pointer" },
  {
    gesture: "Drag",
    label: "Pan; move a token under the pointer; inside the blue rectangle, pan the TV; with a tool armed, use the tool",
  },
  { gesture: "Space + drag, or middle-button drag", label: "Pan, whatever tool is armed" },
  { gesture: "Alt + click (Option on a Mac)", label: "Ping that spot on the TV" },
  { gesture: "Click a wall or door (no tool armed)", label: "Select it; drag an end to move it; Delete removes it" },
  { gesture: "Esc", label: "Stop the armed tool, or abandon the stroke in progress; close this sheet" },
  { gesture: "Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y (Cmd on a Mac)", label: "Undo / redo the last fog change" },
];

/** Keyboard shortcuts must not steal keys from text fields. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}

export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "target"
>;

const byKey = new Map(SHORTCUTS.map((s) => [s.key.toLowerCase(), s]));

/** The command a keydown asks for, or null when it is not a shortcut. */
export function shortcutFor(event: ShortcutKeyEvent): ShortcutCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isEditableTarget(event.target)) return null;
  const shortcut = byKey.get(event.key.toLowerCase());
  if (!shortcut) return null;
  // `?` is Shift+/ on most layouts; every other key is plain.
  if (event.shiftKey && shortcut.key !== "?") return null;
  return shortcut.command;
}

function commandEqual(a: ShortcutCommand, b: ShortcutCommand): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "tab":
      return a.tab === (b as typeof a).tab;
    case "fog-mode":
      return a.mode === (b as typeof a).mode;
    case "fog-tool":
      return a.tool === (b as typeof a).tool;
    case "brush-radius":
      return a.direction === (b as typeof a).direction;
    case "draw-mode":
      return a.mode === (b as typeof a).mode;
    case "wall-tool":
      return a.tool === (b as typeof a).tool;
    default:
      return true;
  }
}

/** The key that issues a command, as the cheat sheet shows it; null for none. */
export function shortcutKeyFor(command: ShortcutCommand): string | null {
  return SHORTCUTS.find((s) => commandEqual(s.command, command))?.key ?? null;
}
