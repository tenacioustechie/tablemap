import {
  cloneFogOp,
  fogFill,
  fogShape,
  isFogOp,
  isFogShape,
  rectShape,
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
});

describe("fog op guards", () => {
  it("accepts every op kind with every mode", () => {
    const ops: FogOp[] = [
      fogFill("reveal"),
      fogFill("hide"),
      fogShape("reveal", { kind: "rect", x: 0, y: 0, width: 0, height: 0 }),
      fogShape("hide", { kind: "circle", x: 5, y: 5, radius: 2.5 }),
      fogShape("reveal", { kind: "polygon", points: [0, 0, 4, 0, 4, 4, 0, 4] }),
    ];
    for (const op of ops) expect(isFogOp(JSON.parse(JSON.stringify(op)))).toBe(true);
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
