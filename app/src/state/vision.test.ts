import { VISION_DIMS, type VisionDim } from "./model";
import { createToken, tokenCenter } from "./tokens";
import { clampTokenVision, mapUsesVision, seeingTokens, TOKEN_VISION_MAX, tokenCentre } from "./vision";

const disc = { type: "disc" as const, color: "#f00" };
const blind = createToken({ id: "blind", x: 0, y: 0, appearance: disc });
const scout = createToken({ id: "scout", x: 70, y: 0, appearance: disc, vision: 6 });
const lurker = createToken({ id: "lurker", x: 140, y: 0, appearance: disc, vision: 2, hidden: true });

describe("seeingTokens", () => {
  it("keeps the tokens with vision above 0, hidden ones included, in document order", () => {
    expect(seeingTokens({ tokens: [lurker, blind, scout] })).toEqual([lurker, scout]);
    expect(seeingTokens({ tokens: [blind] })).toEqual([]);
    expect(seeingTokens({ tokens: [] })).toEqual([]);
  });
});

describe("mapUsesVision", () => {
  const scene = (visionDim: VisionDim, ...tokens: (typeof blind)[]) => ({ visionDim, tokens });

  it("auto: only while a token on the map has vision (a hidden one counts)", () => {
    expect(mapUsesVision(scene("auto"))).toBe(false);
    expect(mapUsesVision(scene("auto", blind))).toBe(false);
    expect(mapUsesVision(scene("auto", blind, scout))).toBe(true);
    expect(mapUsesVision(scene("auto", lurker))).toBe(true);
  });

  it("on: always, with or without a seeing token", () => {
    expect(mapUsesVision(scene("on"))).toBe(true);
    expect(mapUsesVision(scene("on", blind))).toBe(true);
    expect(mapUsesVision(scene("on", scout))).toBe(true);
  });

  it("off: never, with or without a seeing token", () => {
    expect(mapUsesVision(scene("off"))).toBe(false);
    expect(mapUsesVision(scene("off", blind))).toBe(false);
    expect(mapUsesVision(scene("off", scout, lurker))).toBe(false);
  });

  it("answers for every dim value", () => {
    for (const dim of VISION_DIMS) expect(typeof mapUsesVision(scene(dim, scout))).toBe("boolean");
  });
});

describe("tokenCentre", () => {
  it("is the centre of the footprint for every size, snapped or not", () => {
    expect(tokenCentre({ x: 70, y: 140, size: 1 }, 70)).toEqual({ x: 105, y: 175 });
    expect(tokenCentre({ x: 70, y: 140, size: 2 }, 70)).toEqual({ x: 140, y: 210 });
    expect(tokenCentre({ x: 12.5, y: -3, size: 3 }, 50)).toEqual({ x: 87.5, y: 72 });
    for (const size of [1, 2, 3, 4] as const) {
      const token = { x: 33, y: 44, size };
      expect(tokenCentre(token, 48.5)).toEqual(tokenCenter(token, 48.5));
    }
  });
});

describe("clampTokenVision", () => {
  it("rounds to whole cells and clamps to 0..TOKEN_VISION_MAX", () => {
    expect(TOKEN_VISION_MAX).toBe(60);
    expect(clampTokenVision(6)).toBe(6);
    expect(clampTokenVision(0)).toBe(0);
    expect(clampTokenVision(6.4)).toBe(6);
    expect(clampTokenVision(6.5)).toBe(7);
    expect(clampTokenVision(-3)).toBe(0);
    expect(Object.is(clampTokenVision(-0.2), 0)).toBe(true);
    expect(clampTokenVision(75)).toBe(60);
    expect(clampTokenVision(Infinity)).toBe(60);
    expect(clampTokenVision(-Infinity)).toBe(0);
    expect(clampTokenVision(NaN)).toBe(0);
  });
});
