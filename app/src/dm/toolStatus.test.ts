import { DEFAULT_DRAW_TOOL_SETTINGS, type DrawMode } from "./annotationTool";
import { DEFAULT_FOG_TOOL_SETTINGS, FOG_TOOL_KINDS, type FogToolKind } from "./fogTool";
import { shortcutKeyFor } from "./shortcuts";
import { describeCalibration, describeTool, NOT_CALIBRATED_LABEL } from "./toolStatus";

const fog = (patch: Partial<typeof DEFAULT_FOG_TOOL_SETTINGS> = {}) => ({
  ...DEFAULT_FOG_TOOL_SETTINGS,
  ...patch,
});
const draw = (mode: DrawMode) => ({ ...DEFAULT_DRAW_TOOL_SETTINGS, mode });

describe("describeTool", () => {
  it("is nothing while no tool is armed", () => {
    expect(describeTool("none", fog(), draw("draw"))).toBeNull();
  });

  it("names the alignment tool and points at the Maps tab", () => {
    expect(describeTool("align", fog(), draw("draw"))).toEqual({
      label: "Align grid",
      tab: "maps",
      key: "G",
    });
  });

  it("names every fog mode and tool and points at the Fog tab", () => {
    const expected: Record<FogToolKind, string> = { brush: "brush", rect: "rectangle", lasso: "lasso", fill: "fill" };
    const keys: Record<FogToolKind, string> = { brush: "B", rect: "X", lasso: "L", fill: "F" };
    for (const tool of FOG_TOOL_KINDS) {
      for (const mode of ["reveal", "hide"] as const) {
        expect(describeTool("fog", fog({ tool, mode }), draw("draw"))).toEqual({
          label: `Fog · ${mode} ${expected[tool]}`,
          tab: "fog",
          key: keys[tool],
        });
      }
    }
    expect(describeTool("fog", fog(), draw("draw"))?.label).toBe("Fog · reveal brush");
    expect(describeTool("fog", fog({ mode: "hide", tool: "rect" }), draw("draw"))?.label).toBe(
      "Fog · hide rectangle"
    );
    // The room fill (T108), in both modes.
    expect(describeTool("fog", fog({ tool: "fill" }), draw("draw"))).toEqual({
      label: "Fog · reveal fill",
      tab: "fog",
      key: "F",
    });
    expect(describeTool("fog", fog({ mode: "hide", tool: "fill" }), draw("draw"))?.label).toBe("Fog · hide fill");
  });

  it("names the pen and the eraser and points at the Draw tab", () => {
    expect(describeTool("draw", fog(), draw("draw"))).toEqual({
      label: "Draw · pen",
      tab: "draw",
      key: "P",
    });
    expect(describeTool("draw", fog(), draw("erase"))).toEqual({
      label: "Draw · eraser",
      tab: "draw",
      key: "E",
    });
  });

  it("names the note tool and points at the Draw tab", () => {
    expect(describeTool("note", fog(), draw("erase"))).toEqual({
      label: "Place note",
      tab: "draw",
      key: "N",
    });
  });

  it("names the wall and the door tool and points at the Walls tab (T102)", () => {
    expect(describeTool("wall", fog(), draw("draw"), { tool: "wall", snap: true })).toEqual({
      label: "Walls · wall",
      tab: "walls",
      key: "W",
    });
    expect(describeTool("wall", fog(), draw("draw"), { tool: "door", snap: false })).toEqual({
      label: "Walls · door",
      tab: "walls",
      key: "D",
    });
    // The settings default to the wall tool when a caller has none.
    expect(describeTool("wall", fog(), draw("draw"))?.label).toBe("Walls · wall");
    for (const tool of ["wall", "door"] as const) {
      expect(describeTool("wall", fog(), draw("draw"), { tool, snap: true })?.key).toBe(
        shortcutKeyFor({ kind: "wall-tool", tool })
      );
    }
  });

  it("takes the key from the shortcut table, so the chip and the cheat sheet agree (T018)", () => {
    expect(describeTool("align", fog(), draw("draw"))?.key).toBe(shortcutKeyFor({ kind: "align" }));
    expect(describeTool("note", fog(), draw("draw"))?.key).toBe(shortcutKeyFor({ kind: "note" }));
    for (const tool of FOG_TOOL_KINDS) {
      expect(describeTool("fog", fog({ tool }), draw("draw"))?.key).toBe(
        shortcutKeyFor({ kind: "fog-tool", tool })
      );
    }
    for (const mode of ["draw", "erase"] as const) {
      expect(describeTool("draw", fog(), draw(mode))?.key).toBe(
        shortcutKeyFor({ kind: "draw-mode", mode })
      );
    }
  });

  it("ignores the settings of the tools that are not armed", () => {
    expect(describeTool("align", fog({ mode: "hide" }), draw("erase"))?.label).toBe("Align grid");
    expect(describeTool("note", fog({ tool: "lasso" }), draw("erase"))?.label).toBe("Place note");
    expect(describeTool("fog", fog(), draw("erase"), { tool: "door", snap: true })?.label).toBe(
      "Fog · reveal brush"
    );
  });
});

describe("describeCalibration (T019)", () => {
  const cal = (pxPerInch: number) => ({ pxPerInch, method: "square" as const, updatedAt: 1 });

  it("says so while the display is not calibrated", () => {
    expect(describeCalibration(null, "inch")).toBe(NOT_CALIBRATED_LABEL);
    expect(describeCalibration(null, "mm25")).toBe("Not calibrated");
  });

  it("names the cell unit and the px per inch, whole or to one decimal", () => {
    expect(describeCalibration(cal(96), "inch")).toBe("1 inch = 96 px/in");
    expect(describeCalibration(cal(40.25), "inch")).toBe("1 inch = 40.3 px/in");
    expect(describeCalibration(cal(102.4649), "mm25")).toBe("25 mm = 102.5 px/in");
    expect(describeCalibration(cal(40.04), "inch")).toBe("1 inch = 40 px/in");
  });
});
