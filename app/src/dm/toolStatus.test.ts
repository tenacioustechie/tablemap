import { DEFAULT_DRAW_TOOL_SETTINGS, type DrawMode } from "./annotationTool";
import { DEFAULT_FOG_TOOL_SETTINGS, FOG_TOOL_KINDS, type FogToolKind } from "./fogTool";
import { shortcutKeyFor } from "./shortcuts";
import { describeTool } from "./toolStatus";

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
    const expected: Record<FogToolKind, string> = { brush: "brush", rect: "rectangle", lasso: "lasso" };
    const keys: Record<FogToolKind, string> = { brush: "B", rect: "X", lasso: "L" };
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
  });
});
