import {
  cloneFogOp,
  fogFill,
  fogShape,
  fogShapeBounds,
  isFogOp,
  isFogShape,
  polygonShape,
  rectShape,
  rectsShape,
  strokeShape,
  type FogOp,
} from "./fog";

describe("fog op constructors", () => {
  it("rectShape normalises any two corners to a positive-size rectangle", () => {
    expect(rectShape({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({
      kind: "rect",
      x: 4,
      y: 2,
      width: 6,
      height: 18,
    });
    expect(rectShape({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({
      kind: "rect",
      x: 1,
      y: 1,
      width: 0,
      height: 0,
    });
  });

  it("fogShape and cloneFogOp copy shapes so later mutation cannot leak in", () => {
    const polygon = { kind: "polygon" as const, points: [0, 0, 1, 0, 1, 1] };
    const op = fogShape("hide", polygon);
    polygon.points.push(9, 9);
    expect(op).toEqual({
      type: "shape",
      mode: "hide",
      shape: { kind: "polygon", points: [0, 0, 1, 0, 1, 1] },
    });
    const copy = cloneFogOp(op);
    expect(copy).toEqual(op);
    expect(copy).not.toBe(op);
    expect(copy.type === "shape" && copy.shape).not.toBe(op.type === "shape" && op.shape);
    expect(cloneFogOp(fogFill("reveal"))).toEqual({ type: "fill", mode: "reveal" });
  });

  it("stroke / polygon / rects constructors copy their arrays; feather is recorded only when positive (T008)", () => {
    const pts = [1, 2, 3, 4];
    const stroke = strokeShape(pts, 5);
    pts.push(9, 9);
    expect(stroke).toEqual({ kind: "stroke", points: [1, 2, 3, 4], radius: 5 });
    expect(polygonShape([0, 0, 1, 0, 1, 1])).toEqual({ kind: "polygon", points: [0, 0, 1, 0, 1, 1] });
    expect(rectsShape([0, 0, 1, 1])).toEqual({ kind: "rects", rects: [0, 0, 1, 1] });
    expect(fogShape("reveal", stroke, 12)).toEqual({ type: "shape", mode: "reveal", shape: stroke, feather: 12 });
    expect(fogShape("reveal", stroke, 0)).toEqual({ type: "shape", mode: "reveal", shape: stroke });
    expect("feather" in fogShape("hide", stroke)).toBe(false);
    const op = fogShape("hide", { kind: "rects", rects: [0, 0, 1, 1] }, 3);
    const copy = cloneFogOp(op);
    expect(copy).toEqual(op);
    expect(copy.type === "shape" && copy.shape.kind === "rects" && copy.shape.rects).not.toBe(
      op.type === "shape" && op.shape.kind === "rects" && op.shape.rects
    );
  });

  it("fogShapeBounds boxes every shape kind (strokes padded by their radius)", () => {
    expect(fogShapeBounds({ kind: "rect", x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(fogShapeBounds({ kind: "circle", x: 5, y: 5, radius: 2 })).toEqual({ x: 3, y: 3, width: 4, height: 4 });
    expect(fogShapeBounds({ kind: "polygon", points: [0, 0, 4, 1, 2, 6] })).toEqual({ x: 0, y: 0, width: 4, height: 6 });
    expect(fogShapeBounds({ kind: "stroke", points: [2, 2, 6, 3], radius: 1 })).toEqual({ x: 1, y: 1, width: 6, height: 3 });
    expect(fogShapeBounds({ kind: "rects", rects: [0, 0, 1, 1, 5, 5, 2, 3] })).toEqual({ x: 0, y: 0, width: 7, height: 8 });
    expect(fogShapeBounds({ kind: "rects", rects: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("fog op guards", () => {
  it("accepts every op kind with every mode", () => {
    const ops: FogOp[] = [
      fogFill("reveal"),
      fogFill("hide"),
      fogShape("reveal", { kind: "rect", x: 0, y: 0, width: 0, height: 0 }),
      fogShape("hide", { kind: "circle", x: 5, y: 5, radius: 2.5 }),
      fogShape("reveal", { kind: "polygon", points: [0, 0, 4, 0, 4, 4, 0, 4] }),
      fogShape("hide", { kind: "stroke", points: [1, 1], radius: 3 }),
      fogShape("reveal", { kind: "stroke", points: [1, 1, 2, 2, 3, 1], radius: 0 }, 4),
      fogShape("reveal", { kind: "rects", rects: [0, 0, 1, 1, 2, 2, 0, 0] }, 0.5),
    ];
    for (const op of ops) expect(isFogOp(JSON.parse(JSON.stringify(op)))).toBe(true);
  });

  it("rejects malformed strokes, rect unions and feathers (T008)", () => {
    expect(isFogShape({ kind: "stroke", points: [], radius: 1 })).toBe(false);
    expect(isFogShape({ kind: "stroke", points: [1], radius: 1 })).toBe(false);
    expect(isFogShape({ kind: "stroke", points: [1, 1], radius: -1 })).toBe(false);
    expect(isFogShape({ kind: "stroke", points: [1, 1] })).toBe(false);
    expect(isFogShape({ kind: "rects", rects: [] })).toBe(false);
    expect(isFogShape({ kind: "rects", rects: [0, 0, 1] })).toBe(false);
    expect(isFogShape({ kind: "rects", rects: [0, 0, -1, 1] })).toBe(false);
    expect(isFogShape({ kind: "rects", rects: [0, 0, 1, Infinity] })).toBe(false);
    const shape = { kind: "rect", x: 0, y: 0, width: 1, height: 1 };
    expect(isFogOp({ type: "shape", mode: "hide", shape, feather: -1 })).toBe(false);
    expect(isFogOp({ type: "shape", mode: "hide", shape, feather: "soft" })).toBe(false);
    expect(isFogOp({ type: "shape", mode: "hide", shape, feather: 2 })).toBe(true);
  });

  it("rejects unknown modes, types, shapes and non-finite numbers", () => {
    expect(isFogOp({ type: "fill", mode: "clear" })).toBe(false);
    expect(isFogOp({ type: "erase", mode: "hide" })).toBe(false);
    expect(isFogOp({ type: "shape", mode: "hide" })).toBe(false);
    expect(isFogOp({ type: "shape", mode: "hide", shape: { kind: "star" } })).toBe(false);
    expect(isFogOp(null)).toBe(false);
    expect(isFogOp("fill")).toBe(false);
    expect(isFogShape({ kind: "rect", x: 0, y: 0, width: -1, height: 1 })).toBe(false);
    expect(isFogShape({ kind: "rect", x: NaN, y: 0, width: 1, height: 1 })).toBe(false);
    expect(isFogShape({ kind: "circle", x: 0, y: 0, radius: -2 })).toBe(false);
    expect(isFogShape({ kind: "circle", x: 0, y: 0 })).toBe(false);
    expect(isFogShape({ kind: "polygon", points: [0, 0, 1, 1] })).toBe(false); // two points
    expect(isFogShape({ kind: "polygon", points: [0, 0, 1, 1, 2] })).toBe(false); // odd
    expect(isFogShape({ kind: "polygon", points: [0, 0, 1, 1, "2", 2] })).toBe(false);
    expect(isFogShape({ kind: "polygon", points: [0, 0, 1, 1, 2, 2] })).toBe(true);
  });
});
