import { DEFAULT_DRAW_TOOL_SETTINGS, type DrawMode } from "./annotationTool";
import { DEFAULT_FOG_TOOL_SETTINGS, FOG_TOOL_KINDS, type FogToolKind } from "./fogTool";
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
    expect(describeTool("align", fog(), draw("draw"))).toEqual({ label: "Align grid", tab: "maps" });
  });

  it("names every fog mode and tool and points at the Fog tab", () => {
    const expected: Record<FogToolKind, string> = { brush: "brush", rect: "rectangle", lasso: "lasso" };
    for (const tool of FOG_TOOL_KINDS) {
      for (const mode of ["reveal", "hide"] as const) {
        expect(describeTool("fog", fog({ tool, mode }), draw("draw"))).toEqual({
          label: `Fog · ${mode} ${expected[tool]}`,
          tab: "fog",
        });
      }
    }
    expect(describeTool("fog", fog(), draw("draw"))?.label).toBe("Fog · reveal brush");
    expect(describeTool("fog", fog({ mode: "hide", tool: "rect" }), draw("draw"))?.label).toBe(
      "Fog · hide rectangle"
    );
  });

  it("names the pen and the eraser and points at the Draw tab", () => {
    expect(describeTool("draw", fog(), draw("draw"))).toEqual({ label: "Draw · pen", tab: "draw" });
    expect(describeTool("draw", fog(), draw("erase"))).toEqual({ label: "Draw · eraser", tab: "draw" });
  });

  it("names the note tool and points at the Draw tab", () => {
    expect(describeTool("note", fog(), draw("erase"))).toEqual({ label: "Place note", tab: "draw" });
  });

  it("ignores the settings of the tools that are not armed", () => {
    expect(describeTool("align", fog({ mode: "hide" }), draw("erase"))?.label).toBe("Align grid");
    expect(describeTool("note", fog({ tool: "lasso" }), draw("erase"))?.label).toBe("Place note");
  });
});
