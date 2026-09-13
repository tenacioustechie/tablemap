/**
 * The toolbar's tool status chip (T016): what the armed canvas tool is
 * called and which sidebar tab owns it. Pure so the labels can be checked
 * for every tool / mode combination without rendering anything.
 */
import type { DrawToolSettings } from "./annotationTool";
import type { FogToolSettings } from "./fogTool";
import { FOG_TOOL_LABELS } from "./fogTool";
import { shortcutKeyFor } from "./shortcuts";
import type { DmTabId } from "./SidebarTabs";

/** Which canvas tool is running; they are mutually exclusive. */
export type DmTool = "none" | "align" | "fog" | "draw" | "note";

export interface ToolStatus {
  /** Short human label: "Align grid", "Fog · reveal brush", "Draw · pen", "Place note". */
  label: string;
  /** The sidebar tab that holds the tool's controls. */
  tab: DmTabId;
  /** The key that arms this very tool (T018), from `SHORTCUTS`; null if none does. */
  key: string | null;
}

/** `null` while no tool is armed: the chip is hidden. */
export function describeTool(
  tool: DmTool,
  fog: FogToolSettings,
  draw: DrawToolSettings
): ToolStatus | null {
  switch (tool) {
    case "none":
      return null;
    case "align":
      return { label: "Align grid", tab: "maps", key: shortcutKeyFor({ kind: "align" }) };
    case "fog":
      return {
        label: `Fog · ${fog.mode} ${FOG_TOOL_LABELS[fog.tool].toLowerCase()}`,
        tab: "fog",
        key: shortcutKeyFor({ kind: "fog-tool", tool: fog.tool }),
      };
    case "draw":
      return {
        label: draw.mode === "erase" ? "Draw · eraser" : "Draw · pen",
        tab: "draw",
        key: shortcutKeyFor({ kind: "draw-mode", mode: draw.mode }),
      };
    case "note":
      return { label: "Place note", tab: "draw", key: shortcutKeyFor({ kind: "note" }) };
  }
}
