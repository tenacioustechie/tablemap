/**
 * The toolbar's tool status chip (T016): what the armed canvas tool is
 * called and which sidebar tab owns it. Pure so the labels can be checked
 * for every tool / mode combination without rendering anything. T019 adds
 * the calibration chip's text next to it, for the same reason.
 */
import {
  CELL_UNIT_LABELS,
  type CellUnit,
  type DisplayCalibration,
} from "../state/calibration";
import type { DrawToolSettings } from "./annotationTool";
import type { FogToolSettings } from "./fogTool";
import { FOG_TOOL_LABELS } from "./fogTool";
import { shortcutKeyFor } from "./shortcuts";
import type { DmTabId } from "./SidebarTabs";
import { DEFAULT_WALL_TOOL_SETTINGS, type WallToolSettings } from "./wallTool";

/** Which canvas tool is running; they are mutually exclusive. */
export type DmTool = "none" | "align" | "fog" | "draw" | "note" | "wall";

export interface ToolStatus {
  /** Short human label: "Align grid", "Fog · reveal brush", "Draw · pen", "Place note", "Walls · door". */
  label: string;
  /** The sidebar tab that holds the tool's controls. */
  tab: DmTabId;
  /** The key that arms this very tool (T018), from `SHORTCUTS`; null if none does. */
  key: string | null;
}

/** The sidebar tab that owns each canvas tool's controls. */
export const TOOL_TABS: Record<Exclude<DmTool, "none">, DmTabId> = {
  align: "maps",
  fog: "fog",
  draw: "draw",
  note: "draw",
  wall: "walls",
};

/**
 * The tool still armed after the DM switches to `tab` (ADR 0028): a tool
 * survives a visit to its own tab and is put down by any other, so a fog
 * brush or a door tool never lingers on the canvas while the DM works in
 * another panel.
 */
export function toolAfterTabChange(tool: DmTool, tab: DmTabId): DmTool {
  return tool === "none" || TOOL_TABS[tool] === tab ? tool : "none";
}

/** `null` while no tool is armed: the chip is hidden. */
export function describeTool(
  tool: DmTool,
  fog: FogToolSettings,
  draw: DrawToolSettings,
  wall: WallToolSettings = DEFAULT_WALL_TOOL_SETTINGS
): ToolStatus | null {
  switch (tool) {
    case "none":
      return null;
    case "align":
      return { label: "Align grid", tab: TOOL_TABS.align, key: shortcutKeyFor({ kind: "align" }) };
    case "fog":
      return {
        label: `Fog · ${fog.mode} ${FOG_TOOL_LABELS[fog.tool].toLowerCase()}`,
        tab: TOOL_TABS.fog,
        key: shortcutKeyFor({ kind: "fog-tool", tool: fog.tool }),
      };
    case "draw":
      return {
        label: draw.mode === "erase" ? "Draw · eraser" : "Draw · pen",
        tab: TOOL_TABS.draw,
        key: shortcutKeyFor({ kind: "draw-mode", mode: draw.mode }),
      };
    case "note":
      return { label: "Place note", tab: TOOL_TABS.note, key: shortcutKeyFor({ kind: "note" }) };
    case "wall":
      return {
        label: `Walls · ${wall.tool}`,
        tab: TOOL_TABS.wall,
        key: shortcutKeyFor({ kind: "wall-tool", tool: wall.tool }),
      };
  }
}

export const NOT_CALIBRATED_LABEL = "Not calibrated";

/**
 * The toolbar's calibration chip (T019): "1 inch = 96 px/in" from the
 * current calibration and cell unit (one decimal at most, none when whole),
 * or "Not calibrated". The chip opens the Table tab either way.
 */
export function describeCalibration(
  calibration: DisplayCalibration | null,
  cellUnit: CellUnit
): string {
  if (calibration === null) return NOT_CALIBRATED_LABEL;
  const pxPerInch = Number(calibration.pxPerInch.toFixed(1));
  return `${CELL_UNIT_LABELS[cellUnit]} = ${pxPerInch} px/in`;
}
