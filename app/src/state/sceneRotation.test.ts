/**
 * Turning a scene (T017, ADR 0021): the point transform, four quarter turns
 * are the identity for every part of a scene, the grid's lines turn as a
 * set, tokens keep their centres and their snapping, annotations and every
 * fog shape follow.
 */
import { gridLines } from "../map/grid";
import { fogFill, fogShape, type FogOp, type FogShape } from "./fog";
import { createBlankMapScene } from "./maps";
import { defaultGridSettings, type Annotation, type MapScene, type Token } from "./model";
import {
  imageAssetSize,
  isRotationDegrees,
  nextImageRotation,
  rotateAnnotation,
  rotatedImagePlacement,
  rotatedSceneSize,
  rotateFogOp,
  rotateFogShape,
  rotateGrid,
  rotatePoint,
  rotatePoints,
  rotateRect,
  rotateScene,
  rotateToken,
  ROTATION_DEGREES,
  type RotationDegrees,
} from "./sceneRotation";
import { createToken, snapTokenPosition, tokenCenter } from "./tokens";

const W = 400;
const H = 300;
const size = { width: W, height: H };

const closeTo = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sortedClose = (actual: number[], expected: number[]) => {
  const a = [...actual].sort((x, y) => x - y);
  const b = [...expected].sort((x, y) => x - y);
  return a.length === b.length && a.every((v, i) => closeTo(v, b[i]));
};

describe("rotatePoint", () => {
  it("turns a point of a W × H scene clockwise by 90, 180 and 270 degrees", () => {
    const p = { x: 30, y: 50 };
    expect(rotatePoint(p, size, 90)).toEqual({ x: H - 50, y: 30 });
    expect(rotatePoint(p, size, 180)).toEqual({ x: W - 30, y: H - 50 });
    expect(rotatePoint(p, size, 270)).toEqual({ x: 50, y: W - 30 });
  });

  it("keeps the corners on the corners and the centre in the middle", () => {
    expect(rotatePoint({ x: 0, y: 0 }, size, 90)).toEqual({ x: H, y: 0 });
    expect(rotatePoint({ x: W, y: H }, size, 90)).toEqual({ x: 0, y: W });
    expect(rotatePoint({ x: W / 2, y: H / 2 }, size, 90)).toEqual({ x: H / 2, y: W / 2 });
    expect(rotatePoint({ x: W / 2, y: H / 2 }, size, 180)).toEqual({ x: W / 2, y: H / 2 });
  });

  it("four quarter turns are the identity; two are a half turn; three are 270", () => {
    const p = { x: 17, y: 233 };
    let q = p;
    let s = size;
    for (let i = 0; i < 4; i++) {
      q = rotatePoint(q, s, 90);
      s = rotatedSceneSize(s, 90);
      if (i === 1) expect(q).toEqual(rotatePoint(p, size, 180));
      if (i === 2) expect(q).toEqual(rotatePoint(p, size, 270));
    }
    expect(q).toEqual(p);
    expect(s).toEqual(size);
  });

  it("rotatedSceneSize swaps the sides for a quarter turn only", () => {
    expect(rotatedSceneSize(size, 90)).toEqual({ width: H, height: W });
    expect(rotatedSceneSize(size, 270)).toEqual({ width: H, height: W });
    expect(rotatedSceneSize(size, 180)).toEqual(size);
  });

  it("rotatePoints turns a flat list pairwise and ignores a dangling coordinate", () => {
    expect(rotatePoints([0, 0, 30, 50, 7], size, 90)).toEqual([H, 0, H - 50, 30]);
  });

  it("rotateRect turns the corners and renormalises to a positive size", () => {
    expect(rotateRect({ x: 10, y: 20, width: 100, height: 50 }, size, 90)).toEqual({
      x: H - 70,
      y: 10,
      width: 50,
      height: 100,
    });
    expect(rotateRect({ x: 10, y: 20, width: 100, height: 50 }, size, 180)).toEqual({
      x: W - 110,
      y: H - 70,
      width: 100,
      height: 50,
    });
  });

  it("guards the degrees", () => {
    expect(ROTATION_DEGREES).toEqual([90, 180, 270]);
    expect(isRotationDegrees(90)).toBe(true);
    expect(isRotationDegrees(0)).toBe(false);
    expect(isRotationDegrees(360)).toBe(false);
    expect(isRotationDegrees("90")).toBe(false);
  });

  it("nextImageRotation advances and wraps", () => {
    expect(nextImageRotation(0, 90)).toBe(90);
    expect(nextImageRotation(270, 90)).toBe(0);
    expect(nextImageRotation(180, 270)).toBe(90);
  });
});

describe("rotateGrid", () => {
  const geometries = [
    { cellSize: 50, offsetX: 12, offsetY: 7 },
    { cellSize: 70, offsetX: 0, offsetY: 0 },
    { cellSize: 33.3, offsetX: -5, offsetY: 100.25 },
    { cellSize: 48.5, offsetX: 12, offsetY: -7 },
    { cellSize: 1000, offsetX: 3, offsetY: 4 }, // one cell bigger than the map
  ];

  it.each(geometries)("keeps the cell size and wraps the turned origin: %o", (geometry) => {
    const grid = { ...defaultGridSettings(), ...geometry };
    for (const degrees of ROTATION_DEGREES) {
      const turned = rotateGrid(grid, size, degrees);
      expect(turned.cellSize).toBe(geometry.cellSize);
      expect(turned.offsetX).toBeGreaterThanOrEqual(0);
      expect(turned.offsetX).toBeLessThan(geometry.cellSize);
      expect(turned.offsetY).toBeGreaterThanOrEqual(0);
      expect(turned.offsetY).toBeLessThan(geometry.cellSize);
      expect(turned.dm).toEqual(grid.dm);
      expect(turned.player).toEqual(grid.player);
    }
  });

  it.each(geometries)(
    "the lines of the turned scene are the turned lines (a vertical becomes a horizontal): %o",
    (geometry) => {
      const grid = { ...defaultGridSettings(), ...geometry };
      const before = gridLines(W, H, grid);
      for (const degrees of ROTATION_DEGREES) {
        const turnedSize = rotatedSceneSize(size, degrees);
        const after = gridLines(turnedSize.width, turnedSize.height, rotateGrid(grid, size, degrees));
        // A vertical line x = v is the segment (v, 0)–(v, H); turning both
        // ends gives a line whose fixed coordinate is the turned point's.
        const expectedVertical: number[] = [];
        const expectedHorizontal: number[] = [];
        for (const v of before.vertical) {
          const p = rotatePoint({ x: v, y: 0 }, size, degrees);
          if (degrees === 180) expectedVertical.push(p.x);
          else expectedHorizontal.push(p.y);
        }
        for (const h of before.horizontal) {
          const p = rotatePoint({ x: 0, y: h }, size, degrees);
          if (degrees === 180) expectedHorizontal.push(p.y);
          else expectedVertical.push(p.x);
        }
        expect(sortedClose(after.vertical, expectedVertical)).toBe(true);
        expect(sortedClose(after.horizontal, expectedHorizontal)).toBe(true);
      }
    }
  );

  it("four quarter turns bring the grid back", () => {
    const grid = { ...defaultGridSettings(), cellSize: 50, offsetX: 12, offsetY: 7 };
    let g = grid;
    let s = size;
    for (let i = 0; i < 4; i++) {
      g = rotateGrid(g, s, 90);
      s = rotatedSceneSize(s, 90);
    }
    expect(g).toEqual(grid);
  });
});

describe("rotateToken", () => {
  const cell = 50;
  const grid = { ...defaultGridSettings(), cellSize: cell, offsetX: 12, offsetY: 7 };

  it("turns the footprint's centre and recomputes the top-left; size and the rest are untouched", () => {
    const token = createToken({ id: "t", x: 112, y: 57, size: 2, appearance: { type: "disc", color: "#f00" }, badge: "T" });
    const turned = rotateToken(token, size, cell, 90);
    expect(tokenCenter(turned, cell)).toEqual(rotatePoint(tokenCenter(token, cell), size, 90));
    expect(turned).toMatchObject({ id: "t", size: 2, badge: "T", appearance: { type: "disc", color: "#f00" } });
    expect(turned.x).toBe(H - (57 + 2 * cell));
    expect(turned.y).toBe(112);
  });

  it("a snapped token is still on the turned grid", () => {
    for (const tokenSize of [1, 2, 3, 4] as const) {
      const token = createToken({ id: "t", x: 12 + 3 * cell, y: 7 + cell, size: tokenSize, appearance: { type: "disc", color: "#f00" } });
      expect(snapTokenPosition(token, grid)).toEqual({ x: token.x, y: token.y });
      for (const degrees of ROTATION_DEGREES) {
        const turned = rotateToken(token, size, cell, degrees);
        const turnedGrid = rotateGrid(grid, size, degrees);
        const snapped = snapTokenPosition(turned, turnedGrid);
        expect(closeTo(snapped.x, turned.x) && closeTo(snapped.y, turned.y)).toBe(true);
      }
    }
  });

  it("four quarter turns bring a token back", () => {
    const token = createToken({ id: "t", x: 33, y: 44, size: 3, appearance: { type: "image", assetId: "img" } });
    let t = token;
    let s = size;
    for (let i = 0; i < 4; i++) {
      t = rotateToken(t, s, cell, 90);
      s = rotatedSceneSize(s, 90);
    }
    expect(t).toEqual(token);
  });
});

describe("rotateAnnotation", () => {
  const note: Annotation = { id: "n", kind: "note", x: 30, y: 50, text: "hi", visibility: "dm" };
  const drawing: Annotation = {
    id: "d",
    kind: "drawing",
    points: [0, 0, 30, 50, 400, 300],
    color: "#f00",
    strokeWidth: 3,
    visibility: "all",
  };

  it("turns a note's position and every point of a drawing", () => {
    expect(rotateAnnotation(note, size, 90)).toEqual({ ...note, x: H - 50, y: 30 });
    expect(rotateAnnotation(drawing, size, 90)).toEqual({
      ...drawing,
      points: [H, 0, H - 50, 30, 0, W],
    });
    expect(rotateAnnotation(drawing, size, 270)).toEqual({
      ...drawing,
      points: [0, W, 50, W - 30, H, 0],
    });
  });

  it("four quarter turns bring both back", () => {
    for (const a of [note, drawing]) {
      let x = a;
      let s = size;
      for (let i = 0; i < 4; i++) {
        x = rotateAnnotation(x, s, 90);
        s = rotatedSceneSize(s, 90);
      }
      expect(x).toEqual(a);
    }
  });
});

describe("rotateFogShape / rotateFogOp", () => {
  const shapes: FogShape[] = [
    { kind: "rect", x: 10, y: 20, width: 100, height: 50 },
    { kind: "rects", rects: [10, 20, 100, 50, 200, 100, 30, 30] },
    { kind: "circle", x: 30, y: 50, radius: 12 },
    { kind: "polygon", points: [0, 0, 100, 0, 50, 80] },
    { kind: "stroke", points: [10, 10, 60, 90], radius: 8 },
  ];

  it("turns every shape kind: corners renormalised, centres and points turned, radii kept", () => {
    expect(rotateFogShape(shapes[0], size, 90)).toEqual({ kind: "rect", x: H - 70, y: 10, width: 50, height: 100 });
    expect(rotateFogShape(shapes[1], size, 90)).toEqual({
      kind: "rects",
      rects: [H - 70, 10, 50, 100, H - 130, 200, 30, 30],
    });
    expect(rotateFogShape(shapes[2], size, 90)).toEqual({ kind: "circle", x: H - 50, y: 30, radius: 12 });
    expect(rotateFogShape(shapes[3], size, 90)).toEqual({ kind: "polygon", points: [H, 0, H, 100, H - 80, 50] });
    expect(rotateFogShape(shapes[4], size, 90)).toEqual({ kind: "stroke", points: [H - 10, 10, H - 90, 60], radius: 8 });
  });

  it("a fill is untouched and a shape op keeps its mode and feather", () => {
    expect(rotateFogOp(fogFill("hide"), size, 90)).toEqual(fogFill("hide"));
    const op = fogShape("hide", shapes[2], 6);
    expect(rotateFogOp(op, size, 180)).toEqual({
      type: "shape",
      mode: "hide",
      feather: 6,
      shape: { kind: "circle", x: W - 30, y: H - 50, radius: 12 },
    });
  });

  it("four quarter turns bring every shape back", () => {
    for (const shape of shapes) {
      let x: FogOp = fogShape("reveal", shape, 4);
      let s = size;
      for (let i = 0; i < 4; i++) {
        x = rotateFogOp(x, s, 90);
        s = rotatedSceneSize(s, 90);
      }
      expect(x).toEqual(fogShape("reveal", shape, 4));
    }
  });
});

describe("rotateScene", () => {
  const token: Token = createToken({ id: "t", x: 112, y: 57, size: 2, appearance: { type: "disc", color: "#f00" } });
  const scene: MapScene = {
    ...createBlankMapScene({ id: "m", columns: 8, rows: 6, cellSize: 50 }),
    imageAssetId: "img",
    grid: { ...defaultGridSettings(), cellSize: 50, offsetX: 12, offsetY: 7 },
    fogMaskAssetId: "mask-0",
    fogOps: [fogFill("hide"), fogShape("reveal", { kind: "rect", x: 112, y: 57, width: 50, height: 50 })],
    fogOpsFrom: 5,
    tokens: [token],
    annotations: [{ id: "n", kind: "note", x: 30, y: 50, text: "x", visibility: "dm" }],
  };

  it("swaps the size, advances the image rotation, swaps in the baked mask and turns everything else", () => {
    const turned = rotateScene(scene, 90, "mask-1");
    expect(turned).toMatchObject({
      id: "m",
      imageAssetId: "img",
      width: 300,
      height: 400,
      imageRotation: 90,
      fogMaskAssetId: "mask-1",
      fogOpsFrom: 5,
    });
    expect(turned.grid).toEqual(rotateGrid(scene.grid, size, 90));
    expect(turned.fogOps).toEqual(scene.fogOps.map((op) => rotateFogOp(op, size, 90)));
    expect(turned.tokens).toEqual([rotateToken(token, size, 50, 90)]);
    expect(turned.annotations).toEqual(scene.annotations.map((a) => rotateAnnotation(a, size, 90)));
    // The original is untouched (pure).
    expect(scene.width).toBe(400);
    expect(scene.imageRotation).toBe(0);
  });

  it("a half turn keeps the size; the image rotation wraps at 360", () => {
    const half = rotateScene(scene, 180, null);
    expect(half).toMatchObject({ width: 400, height: 300, imageRotation: 180, fogMaskAssetId: null });
    expect(rotateScene(half, 180, "m").imageRotation).toBe(0);
    expect(rotateScene(rotateScene(scene, 270, "a"), 270, "b").imageRotation).toBe(180);
  });

  it("four quarter turns deep-equal the original (bar the baked mask id the caller supplies)", () => {
    let s = scene;
    for (let i = 0; i < 4; i++) s = rotateScene(s, 90, `mask-${i + 1}`);
    expect(s).toEqual({ ...scene, fogMaskAssetId: "mask-4" });
  });

  it("one 180 turn equals two 90 turns; 270 equals three", () => {
    const two = rotateScene(rotateScene(scene, 90, "x"), 90, "y");
    expect(two).toEqual(rotateScene(scene, 180, "y"));
    const three = rotateScene(two, 90, "z");
    expect(three).toEqual(rotateScene(scene, 270, "z"));
  });
});

describe("drawing the turned image", () => {
  it("imageAssetSize undoes the quarter-turn swap", () => {
    expect(imageAssetSize({ width: 300, height: 400, imageRotation: 90 })).toEqual({ width: 400, height: 300 });
    expect(imageAssetSize({ width: 300, height: 400, imageRotation: 270 })).toEqual({ width: 400, height: 300 });
    expect(imageAssetSize({ width: 400, height: 300, imageRotation: 180 })).toEqual({ width: 400, height: 300 });
    expect(imageAssetSize({ width: 400, height: 300, imageRotation: 0 })).toEqual({ width: 400, height: 300 });
  });

  it("rotatedImagePlacement puts every pixel of the asset where rotatePoint says it goes", () => {
    // A node at `at`, rotated by r about its origin, maps a local point p to
    // at + R(r) p (y down, so a positive angle is clockwise).
    const place = (r: number, at: { x: number; y: number }, p: { x: number; y: number }) => {
      const a = (r * Math.PI) / 180;
      const c = Math.round(Math.cos(a));
      const s = Math.round(Math.sin(a));
      return { x: at.x + c * p.x - s * p.y, y: at.y + s * p.x + c * p.y };
    };
    for (const degrees of ROTATION_DEGREES) {
      const at = rotatedImagePlacement(size, degrees);
      for (const p of [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }, { x: 30, y: 50 }]) {
        expect(place(degrees, at, p)).toEqual(rotatePoint(p, size, degrees));
      }
    }
    expect(rotatedImagePlacement(size, 0)).toEqual({ x: 0, y: 0 });
  });

  it("the placement covers exactly the turned scene for every rotation", () => {
    for (const rotation of [0, ...ROTATION_DEGREES] as const) {
      const scene = { width: rotation === 90 || rotation === 270 ? H : W, height: rotation === 90 || rotation === 270 ? W : H, imageRotation: rotation };
      const asset = imageAssetSize(scene);
      expect(asset).toEqual(size);
      const at = rotatedImagePlacement(asset, rotation);
      const degrees: RotationDegrees | 0 = rotation;
      const corners = [{ x: 0, y: 0 }, { x: asset.width, y: asset.height }].map((p) =>
        degrees === 0 ? { x: at.x + p.x, y: at.y + p.y } : rotatePoint(p, asset, degrees)
      );
      const xs = corners.map((c) => c.x).sort((a, b) => a - b);
      const ys = corners.map((c) => c.y).sort((a, b) => a - b);
      expect(xs).toEqual([0, scene.width]);
      expect(ys).toEqual([0, scene.height]);
    }
  });
});
