import { applyFogOps, createBitmapFogRaster } from "../map/fogRaster";
import { fixtureSquareCorners, GRID_FIXTURE } from "../test/gridFixture";
import { fogFill, fogShape } from "./fog";
import type { GridGeometry, Token, TokenSize } from "./model";
import {
  clampTokenPosition,
  createToken,
  defaultTokenColor,
  defaultTokenLabels,
  isTokenSize,
  isTokenVisibleToPlayers,
  patchToken,
  placeToken,
  sceneTokenVisibility,
  snapTokenPosition,
  TOKEN_PALETTE,
  TOKEN_SIZES,
  tokenCells,
  tokenCenter,
  tokenFogSamplePoints,
  tokenFootprintPx,
  tokenRect,
  tokenTopLeftForCenter,
  tokenVisibility,
} from "./tokens";

const grid: GridGeometry = { cellSize: 50, offsetX: 0, offsetY: 0 };
const map = { width: 500, height: 400 };

const disc = (over: Partial<Token> = {}): Token =>
  createToken({ id: "t", x: 0, y: 0, appearance: { type: "disc", color: "#f00" }, ...over });

describe("token geometry", () => {
  it("footprint, rect and centre scale with the size", () => {
    for (const size of TOKEN_SIZES) {
      expect(tokenFootprintPx(size, 50)).toBe(size * 50);
      expect(tokenRect({ x: 10, y: 20, size }, 50)).toEqual({ x: 10, y: 20, width: size * 50, height: size * 50 });
      expect(tokenCenter({ x: 10, y: 20, size }, 50)).toEqual({ x: 10 + size * 25, y: 20 + size * 25 });
      expect(tokenTopLeftForCenter({ x: 100, y: 100 }, size, 50)).toEqual({ x: 100 - size * 25, y: 100 - size * 25 });
    }
    expect(isTokenSize(3)).toBe(true);
    expect(isTokenSize(5)).toBe(false);
    expect(isTokenSize("2")).toBe(false);
  });
});

describe("snap math", () => {
  it.each(TOKEN_SIZES)("a %ix%i token dropped anywhere in a cell aligns its whole footprint with the grid", (size) => {
    // Drop the top-left at a few points around the corner (120, 80): the
    // nearest corner is (100, 100) for all of them.
    for (const p of [
      { x: 101, y: 99 },
      { x: 124, y: 76 },
      { x: 76, y: 124 },
      { x: 100, y: 100 },
    ]) {
      const snapped = snapTokenPosition(p, grid);
      expect(snapped).toEqual({ x: 100, y: 100 });
      const rect = tokenRect({ ...snapped, size }, grid.cellSize);
      // Every edge lies on a grid line and the footprint is size² cells.
      expect(rect.x % grid.cellSize).toBe(0);
      expect(rect.y % grid.cellSize).toBe(0);
      expect(rect.width / grid.cellSize).toBe(size);
      const cells = tokenCells({ ...snapped, size }, grid);
      expect(cells).toHaveLength(size * size);
      expect(cells[0]).toEqual({ col: 2, row: 2 });
      expect(cells[cells.length - 1]).toEqual({ col: 2 + size - 1, row: 2 + size - 1 });
    }
  });

  it("halfway between corners rounds up, like Math.round", () => {
    expect(snapTokenPosition({ x: 125, y: 75 }, grid)).toEqual({ x: 150, y: 100 });
    expect(snapTokenPosition({ x: 124.9, y: 74.9 }, grid)).toEqual({ x: 100, y: 50 });
  });

  it.each(TOKEN_SIZES)("honours the grid offset for a %ix%i token (fixture grid)", (size) => {
    const g = GRID_FIXTURE.geometry;
    const [topLeft] = fixtureSquareCorners(3, 2);
    // A drop just off the corner of cell (3, 2) snaps exactly onto it.
    const snapped = snapTokenPosition({ x: topLeft.x + 7, y: topLeft.y - 9 }, g);
    expect(snapped).toEqual(topLeft);
    expect(tokenCells({ ...snapped, size }, g)[0]).toEqual({ col: 3, row: 2 });
    // The token's far corner is on a grid corner as well.
    const [, far] = fixtureSquareCorners(3 + size - 1, 2 + size - 1);
    const rect = tokenRect({ ...snapped, size }, g.cellSize);
    expect(rect.x + rect.width).toBeCloseTo(far.x, 9);
    expect(rect.y + rect.height).toBeCloseTo(far.y, 9);
  });

  it("negative offsets and positions snap too", () => {
    const g: GridGeometry = { cellSize: 40, offsetX: -15, offsetY: 5 };
    expect(snapTokenPosition({ x: -20, y: -30 }, g)).toEqual({ x: -15, y: -35 });
    expect(snapTokenPosition({ x: 30, y: 60 }, g)).toEqual({ x: 25, y: 45 });
  });
});

describe("clamping and placing", () => {
  it.each(TOKEN_SIZES)("keeps a %ix%i token's centre on the map", (size) => {
    const half = size * 25;
    expect(clampTokenPosition({ x: -1000, y: -1000 }, size, 50, map)).toEqual({ x: -half, y: -half });
    expect(clampTokenPosition({ x: 1000, y: 1000 }, size, 50, map)).toEqual({
      x: map.width - half,
      y: map.height - half,
    });
    expect(clampTokenPosition({ x: 120, y: 80 }, size, 50, map)).toEqual({ x: 120, y: 80 });
  });

  it("placeToken clamps, then snaps only for snapping tokens", () => {
    expect(placeToken({ x: 112, y: 63 }, { size: 1, snapToGrid: true }, grid, map)).toEqual({ x: 100, y: 50 });
    expect(placeToken({ x: 112, y: 63 }, { size: 1, snapToGrid: false }, grid, map)).toEqual({ x: 112, y: 63 });
    // Off the map: the centre is brought back, then snapped to the edge cell.
    expect(placeToken({ x: -300, y: 900 }, { size: 2, snapToGrid: true }, grid, map)).toEqual({ x: -50, y: 350 });
    expect(placeToken({ x: -300, y: 900 }, { size: 2, snapToGrid: false }, grid, map)).toEqual({ x: -50, y: 350 });
  });
});

describe("fog / token visibility predicate", () => {
  /** A 500x400 raster with a 150x150 room revealed at (100, 100). */
  function roomRaster() {
    const raster = createBitmapFogRaster(map.width, map.height);
    applyFogOps(raster, [fogShape("reveal", { kind: "rect", x: 100, y: 100, width: 150, height: 150 })]);
    return raster;
  }

  it("samples the centre of every cell of the footprint", () => {
    expect(tokenFogSamplePoints({ x: 100, y: 100, size: 1 }, 50)).toEqual([{ x: 125, y: 125 }]);
    expect(tokenFogSamplePoints({ x: 100, y: 100, size: 2 }, 50)).toEqual([
      { x: 125, y: 125 },
      { x: 175, y: 125 },
      { x: 125, y: 175 },
      { x: 175, y: 175 },
    ]);
    expect(tokenFogSamplePoints({ x: 0, y: 0, size: 4 }, 50)).toHaveLength(16);
  });

  it("a token in a revealed room is visible; under fog it is not; the hidden flag always wins", () => {
    const raster = roomRaster();
    const inRoom = disc({ x: 100, y: 100 });
    const inFog = disc({ x: 300, y: 300 });
    expect(tokenVisibility(inRoom, 50, map, raster.isHidden)).toBe("visible");
    expect(tokenVisibility(inFog, 50, map, raster.isHidden)).toBe("fogged");
    expect(tokenVisibility({ ...inRoom, hidden: true }, 50, map, raster.isHidden)).toBe("hidden");
    expect(tokenVisibility({ ...inFog, hidden: true }, 50, map, raster.isHidden)).toBe("hidden");
    expect(isTokenVisibleToPlayers(inRoom, 50, map, raster.isHidden)).toBe(true);
    expect(isTokenVisibleToPlayers(inFog, 50, map, raster.isHidden)).toBe(false);
    expect(isTokenVisibleToPlayers({ ...inRoom, hidden: true }, 50, map, raster.isHidden)).toBe(false);
  });

  it.each(TOKEN_SIZES)("a %ix%i token needs every cell it stands on revealed", (size) => {
    const raster = roomRaster(); // revealed: cells (2..4, 2..4)
    // Fully inside the room (for sizes up to 3); size 4 overflows the room.
    const inside = disc({ x: 100, y: 100, size });
    expect(tokenVisibility(inside, 50, map, raster.isHidden)).toBe(size <= 3 ? "visible" : "fogged");
    // Straddling the room's edge: one cell out is enough to hide it.
    const straddling = disc({ x: 100 + (3 - Math.min(size, 3)) * 50 + 50, y: 100, size });
    expect(tokenVisibility(straddling, 50, map, raster.isHidden)).toBe("fogged");
  });

  it("a fully revealed map shows everything; a fully fogged one nothing", () => {
    const revealed = createBitmapFogRaster(map.width, map.height);
    applyFogOps(revealed, [fogFill("reveal")]);
    const fogged = createBitmapFogRaster(map.width, map.height);
    for (const size of TOKEN_SIZES) {
      const t = disc({ x: 50, y: 50, size });
      expect(tokenVisibility(t, 50, map, revealed.isHidden)).toBe("visible");
      expect(tokenVisibility(t, 50, map, fogged.isHidden)).toBe("fogged");
    }
  });

  it("cells off the map count as fogged", () => {
    const revealed = createBitmapFogRaster(map.width, map.height);
    applyFogOps(revealed, [fogFill("reveal")]);
    expect(tokenVisibility(disc({ x: -30, y: 0 }), 50, map, revealed.isHidden)).toBe("fogged");
    expect(tokenVisibility(disc({ x: 475, y: 375 }), 50, map, revealed.isHidden)).toBe("fogged");
    expect(tokenVisibility(disc({ x: 450, y: 350 }), 50, map, revealed.isHidden)).toBe("visible");
  });

  it("feathered edges: the predicate reads the mask at 50 %, like the bitmap raster", () => {
    const raster = createBitmapFogRaster(map.width, map.height);
    applyFogOps(raster, [fogShape("reveal", { kind: "circle", x: 125, y: 125, radius: 30 }, 12)]);
    expect(tokenVisibility(disc({ x: 100, y: 100 }), 50, map, raster.isHidden)).toBe("visible");
    expect(tokenVisibility(disc({ x: 150, y: 100 }), 50, map, raster.isHidden)).toBe("fogged");
  });

  it("sceneTokenVisibility reports every token by id", () => {
    const raster = roomRaster();
    const scene = {
      tokens: [disc({ id: "a", x: 100, y: 100 }), disc({ id: "b", x: 300, y: 300 }), disc({ id: "c", x: 100, y: 100, hidden: true })],
      grid,
      ...map,
    };
    expect(sceneTokenVisibility(scene, raster.isHidden)).toEqual({ a: "visible", b: "fogged", c: "hidden" });
  });
});

describe("token construction and patching", () => {
  it("createToken fills in defaults and copies the appearance", () => {
    const appearance = { type: "disc" as const, color: "#abc" };
    const t = createToken({ id: "x", x: 1, y: 2, appearance });
    expect(t).toEqual({
      id: "x",
      name: "",
      appearance,
      badge: "",
      x: 1,
      y: 2,
      size: 1,
      snapToGrid: true,
      hidden: false,
      vision: 0,
    });
    expect(t.appearance).not.toBe(appearance);
    // Vision (T105) is given like any other option.
    expect(createToken({ id: "y", x: 0, y: 0, appearance, vision: 6 }).vision).toBe(6);
  });

  it("patchToken returns the same object for an empty or identical patch, a new one otherwise", () => {
    const t = disc({ name: "Orc", badge: "1" });
    expect(patchToken(t, {})).toBe(t);
    expect(patchToken(t, { name: "Orc", appearance: { type: "disc", color: "#f00" } })).toBe(t);
    expect(patchToken(t, { name: undefined })).toBe(t);
    const moved = patchToken(t, { x: 50, hidden: true });
    expect(moved).not.toBe(t);
    expect(moved).toEqual({ ...t, x: 50, hidden: true });
    expect(t.x).toBe(0);
    const recoloured = patchToken(t, { appearance: { type: "image", assetId: "img" } });
    expect(recoloured.appearance).toEqual({ type: "image", assetId: "img" });
    const size: TokenSize = 3;
    expect(patchToken(t, { size }).size).toBe(3);
  });

  it("default labels and colours cycle through the palette", () => {
    expect(defaultTokenLabels(1)).toEqual({ name: "Token 1", badge: "1" });
    expect(defaultTokenLabels(12)).toEqual({ name: "Token 12", badge: "12" });
    expect(defaultTokenColor(1)).toBe(TOKEN_PALETTE[0]);
    expect(defaultTokenColor(TOKEN_PALETTE.length)).toBe(TOKEN_PALETTE[TOKEN_PALETTE.length - 1]);
    expect(defaultTokenColor(TOKEN_PALETTE.length + 1)).toBe(TOKEN_PALETTE[0]);
    expect(defaultTokenColor(0)).toBe(TOKEN_PALETTE[0]);
  });
});
