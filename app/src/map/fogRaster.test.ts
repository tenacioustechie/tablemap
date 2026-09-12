/**
 * Op application maths on a small raster, with no canvas involved: the
 * bitmap raster implements the same operations the canvas raster issues,
 * pixel by pixel. The canvas path is checked in e2e by reading pixels.
 */
import { fogFill, fogShape, type FogOp } from "../state/fog";
import {
  applyFogOp,
  applyFogOps,
  createBitmapFogRaster,
  createCanvasFogRaster,
  FOG_HIDDEN,
  FOG_REVEALED,
  SHADOW_SHIFT,
  type FogContext2D,
} from "./fogRaster";

/** Renders the raster as rows of `#` (hidden) and `.` (revealed). */
function picture(raster: ReturnType<typeof createBitmapFogRaster>): string[] {
  const rows: string[] = [];
  for (let y = 0; y < raster.height; y++) {
    let row = "";
    for (let x = 0; x < raster.width; x++) row += raster.isHidden(x, y) ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

describe("bitmap fog raster", () => {
  it("starts fully fogged and fill ops flip the whole surface", () => {
    const r = createBitmapFogRaster(4, 2);
    expect(r.hiddenFraction()).toBe(1);
    applyFogOp(r, fogFill("reveal"));
    expect(r.hiddenFraction()).toBe(0);
    expect(r.alphaAt(3, 1)).toBe(FOG_REVEALED);
    applyFogOp(r, fogFill("hide"));
    expect(r.hiddenFraction()).toBe(1);
    expect(r.alphaAt(0, 0)).toBe(FOG_HIDDEN);
  });

  it("reveals exactly the pixels whose centres lie inside a rectangle", () => {
    const r = createBitmapFogRaster(6, 4);
    applyFogOp(r, fogShape("reveal", { kind: "rect", x: 1, y: 1, width: 3, height: 2 }));
    expect(picture(r)).toEqual(["######", "#...##", "#...##", "######"]);
    // Fractional edges: a pixel counts when its centre is covered.
    // [0.6, 2.6) covers the centres 1.5 and 2.5, not 0.5 or 3.5.
    const f = createBitmapFogRaster(4, 1);
    applyFogOp(f, fogShape("reveal", { kind: "rect", x: 0.6, y: 0, width: 2, height: 1 }));
    expect(picture(f)).toEqual(["#..#"]);
    // [0.4, 2.4) covers 0.5 and 1.5, not 2.5.
    const g = createBitmapFogRaster(4, 1);
    applyFogOp(g, fogShape("reveal", { kind: "rect", x: 0.4, y: 0, width: 2, height: 1 }));
    expect(picture(g)).toEqual(["..##"]);
  });

  it("clips shapes to the surface and ignores empty ones", () => {
    const r = createBitmapFogRaster(3, 3);
    applyFogOp(r, fogShape("reveal", { kind: "rect", x: -5, y: -5, width: 7, height: 6 }));
    expect(picture(r)).toEqual(["..#", "###", "###"]);
    applyFogOp(r, fogShape("hide", { kind: "rect", x: 0, y: 0, width: 0, height: 5 }));
    applyFogOp(r, fogShape("hide", { kind: "circle", x: 0, y: 0, radius: 0 }));
    applyFogOp(r, fogShape("hide", { kind: "polygon", points: [0, 0, 1, 1] }));
    expect(picture(r)).toEqual(["..#", "###", "###"]);
  });

  it("hide ops paint fog back over revealed pixels", () => {
    const r = createBitmapFogRaster(5, 1);
    applyFogOps(r, [
      fogFill("reveal"),
      fogShape("hide", { kind: "rect", x: 1, y: 0, width: 2, height: 1 }),
    ]);
    expect(picture(r)).toEqual([".##.."]);
  });

  it("rasterises a circle by pixel centres", () => {
    const r = createBitmapFogRaster(7, 7);
    applyFogOp(r, fogShape("reveal", { kind: "circle", x: 3.5, y: 3.5, radius: 2.5 }));
    expect(picture(r)).toEqual([
      "#######",
      "##...##",
      "#.....#",
      "#.....#",
      "#.....#",
      "##...##",
      "#######",
    ]);
    // The centre pixel is inside; the corners of the bounding box are not.
    expect(r.isHidden(3, 3)).toBe(false);
    expect(r.isHidden(1, 1)).toBe(true);
  });

  it("rasterises polygons with even-odd fill, including concave ones", () => {
    const tri = createBitmapFogRaster(6, 4);
    applyFogOp(tri, fogShape("reveal", { kind: "polygon", points: [0, 0, 6, 0, 0, 4] }));
    expect(picture(tri)).toEqual(["......", "....##", "###..#", "#####."].map((row, y) => {
      // Right-angled triangle with the hypotenuse from (6,0) to (0,4):
      // at centre y = 0.5 the edge is at x = 5.25, so 5 pixels... derive
      // expectations from the geometry rather than hand-typing them.
      let s = "";
      for (let x = 0; x < 6; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        s += cx < 6 - (6 * cy) / 4 ? "." : "#";
      }
      void row;
      return s;
    }));

    // A "C" shape: concave polygon, the notch stays fogged.
    const c = createBitmapFogRaster(4, 3);
    applyFogOp(
      c,
      fogShape("reveal", {
        kind: "polygon",
        points: [0, 0, 4, 0, 4, 1, 1, 1, 1, 2, 4, 2, 4, 3, 0, 3],
      })
    );
    expect(picture(c)).toEqual(["....", ".###", "...."]);

    // Self-intersecting bow-tie: even-odd leaves the crossing consistent.
    const bow = createBitmapFogRaster(4, 2);
    applyFogOp(bow, fogShape("reveal", { kind: "polygon", points: [0, 0, 4, 2, 4, 0, 0, 2] }));
    expect(picture(bow)).toEqual([".##.", ".##."]);
  });

  it("rasterises a brush stroke as capsules: every pixel within the radius of the path (T008)", () => {
    // A horizontal segment of radius 1.5 through the middle row.
    const r = createBitmapFogRaster(9, 5);
    applyFogOp(r, fogShape("reveal", { kind: "stroke", points: [2, 2.5, 6, 2.5], radius: 1.5 }));
    expect(picture(r)).toEqual([
      "#########",
      "#......##", // centres at y 1.5 are 1 off the axis: |x - end| <= sqrt(1.25)
      "........#", // on the axis: centres from 0.5 to 7.5 are within 1.5 of an end
      "#......##",
      "#########",
    ]);
    // Derived from the geometry: a pixel is inside when its centre is within
    // the radius of the segment.
    const check = createBitmapFogRaster(12, 8);
    const pts = [1.5, 1.5, 9, 3, 4, 6.5];
    applyFogOp(check, fogShape("reveal", { kind: "stroke", points: pts, radius: 1.2 }));
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 12; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        let d = Infinity;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const ax = pts[i];
          const ay = pts[i + 1];
          const dx = pts[i + 2] - ax;
          const dy = pts[i + 3] - ay;
          const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy)));
          d = Math.min(d, Math.hypot(cx - ax - t * dx, cy - ay - t * dy));
        }
        expect(check.isHidden(x, y)).toBe(d > 1.2);
      }
    }
    // A single point is a disc; an empty path or zero radius is nothing.
    const dot = createBitmapFogRaster(5, 5);
    applyFogOp(dot, fogShape("reveal", { kind: "stroke", points: [2.5, 2.5], radius: 1.5 }));
    const disc = createBitmapFogRaster(5, 5);
    applyFogOp(disc, fogShape("reveal", { kind: "circle", x: 2.5, y: 2.5, radius: 1.5 }));
    expect(dot.alpha).toEqual(disc.alpha);
    applyFogOp(dot, fogShape("hide", { kind: "stroke", points: [2.5, 2.5, 3, 3], radius: 0 }));
    expect(dot.alpha).toEqual(disc.alpha);
  });

  it("fills a union of rectangles in one op, clipping each to the surface (T008)", () => {
    const r = createBitmapFogRaster(6, 3);
    applyFogOp(
      r,
      fogShape("reveal", { kind: "rects", rects: [0, 0, 2, 1, 1, 1, 2, 1, 4, -3, 5, 5] })
    );
    // The third rectangle spans y in [-3, 2): rows 0 and 1 only.
    expect(picture(r)).toEqual(["..##..", "#..#..", "######"]);
    // Feather is accepted on any shape and ignored by the bitmap (hard edge).
    const f = createBitmapFogRaster(6, 3);
    applyFogOp(f, fogShape("reveal", { kind: "rects", rects: [0, 0, 2, 1, 1, 1, 2, 1, 4, -3, 5, 5] }, 8));
    expect(f.alpha).toEqual(r.alpha);
  });

  it("applies a batch of brush strokes to a 4k-wide mask within budget (T008 perf smoke)", () => {
    // 4096 x 2160, 64 strokes (one compaction's worth) of 24 segments each,
    // radius 40 (a typical brush). Work is proportional to the strokes'
    // bounding boxes, not the map.
    const r = createBitmapFogRaster(4096, 2160);
    const ops: FogOp[] = [];
    for (let s = 0; s < 64; s++) {
      const pts: number[] = [];
      for (let i = 0; i <= 24; i++) {
        pts.push(200 + s * 55 + i * 12, 300 + ((s * 37 + i * 29) % 900));
      }
      ops.push(fogShape(s % 3 === 0 ? "hide" : "reveal", { kind: "stroke", points: pts, radius: 40 }));
    }
    const started = performance.now();
    applyFogOps(r, ops);
    const elapsed = performance.now() - started;
    expect(r.hiddenFraction()).toBeLessThan(1);
    // Generous for CI machines; locally this is well under 100 ms.
    expect(elapsed).toBeLessThan(2000);
  });

  it("reset restores the base bitmap or full fog", () => {
    const base = new Uint8Array(4).fill(FOG_HIDDEN);
    base[2] = FOG_REVEALED;
    const r = createBitmapFogRaster(4, 1);
    r.reset(base);
    expect(picture(r)).toEqual(["##.#"]);
    applyFogOp(r, fogFill("reveal"));
    r.reset(null);
    expect(picture(r)).toEqual(["####"]);
    expect(() => r.reset(new Uint8Array(3))).toThrow(/base/);
    r.resize(2, 2);
    expect(r.width).toBe(2);
    expect(r.height).toBe(2);
    expect(r.hiddenFraction()).toBe(1);
  });

  it("the same op log gives byte-identical masks however it is replayed (DM vs player)", () => {
    const log: FogOp[] = [
      fogShape("reveal", { kind: "rect", x: 2, y: 2, width: 10, height: 6 }),
      fogShape("reveal", { kind: "circle", x: 20, y: 10, radius: 5.5 }),
      fogShape("hide", { kind: "polygon", points: [4, 4, 12, 4, 8, 9] }),
      fogFill("hide"),
      fogShape("reveal", { kind: "rect", x: 0.5, y: 0.5, width: 3, height: 3 }),
    ];
    // DM: ops applied one at a time as they happen.
    const dm = createBitmapFogRaster(32, 20);
    for (const op of log) applyFogOp(dm, op);
    // Player: the log as it arrives over the wire (JSON), replayed at once.
    const player = createBitmapFogRaster(32, 20);
    applyFogOps(player, JSON.parse(JSON.stringify(log)) as FogOp[]);
    expect(player.alpha).toEqual(dm.alpha);
    expect(dm.hiddenFraction()).toBeGreaterThan(0.9);
    expect(dm.isHidden(1, 1)).toBe(false);
  });
});

describe("canvas fog raster", () => {
  /** Records the 2D context calls the raster makes. */
  function fakeContext() {
    const calls: unknown[][] = [];
    const state = {
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt" as CanvasLineCap,
      lineJoin: "miter" as CanvasLineJoin,
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    };
    const record =
      (name: string) =>
      (...args: unknown[]) =>
        calls.push([name, state.globalCompositeOperation, ...args]);
    const ctx: FogContext2D = {
      get globalCompositeOperation() {
        return state.globalCompositeOperation as GlobalCompositeOperation;
      },
      set globalCompositeOperation(v) {
        state.globalCompositeOperation = v;
      },
      get fillStyle() {
        return state.fillStyle;
      },
      set fillStyle(v) {
        state.fillStyle = v as string;
      },
      get strokeStyle() {
        return state.strokeStyle;
      },
      set strokeStyle(v) {
        state.strokeStyle = v as string;
      },
      get lineWidth() {
        return state.lineWidth;
      },
      set lineWidth(v) {
        state.lineWidth = v;
      },
      get lineCap() {
        return state.lineCap;
      },
      set lineCap(v) {
        state.lineCap = v;
      },
      get lineJoin() {
        return state.lineJoin;
      },
      set lineJoin(v) {
        state.lineJoin = v;
      },
      get shadowColor() {
        return state.shadowColor;
      },
      set shadowColor(v) {
        state.shadowColor = v;
      },
      get shadowBlur() {
        return state.shadowBlur;
      },
      set shadowBlur(v) {
        state.shadowBlur = v;
        calls.push(["shadowBlur", state.globalCompositeOperation, v]);
      },
      get shadowOffsetX() {
        return state.shadowOffsetX;
      },
      set shadowOffsetX(v) {
        state.shadowOffsetX = v;
      },
      get shadowOffsetY() {
        return state.shadowOffsetY;
      },
      set shadowOffsetY(v) {
        state.shadowOffsetY = v;
      },
      save: record("save"),
      restore: () => {
        calls.push(["restore", state.globalCompositeOperation]);
        state.shadowBlur = 0;
        state.shadowOffsetX = 0;
      },
      translate: record("translate"),
      fillRect: record("fillRect"),
      clearRect: record("clearRect"),
      beginPath: record("beginPath"),
      rect: record("rect"),
      arc: record("arc"),
      moveTo: record("moveTo"),
      lineTo: record("lineTo"),
      closePath: record("closePath"),
      fill: record("fill"),
      stroke: record("stroke"),
      drawImage: record("drawImage") as FogContext2D["drawImage"],
    };
    return { ctx, calls, state };
  }

  function canvasWith(ctx: FogContext2D): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
    return canvas;
  }

  it("paints hide with source-over black and reveal with destination-out", () => {
    const { ctx, calls } = fakeContext();
    const r = createCanvasFogRaster(20, 10, canvasWith(ctx));
    expect(r.canvas.width).toBe(20);
    expect(r.canvas.height).toBe(10);
    applyFogOps(r, [
      fogShape("reveal", { kind: "rect", x: 1, y: 2, width: 3, height: 4 }),
      fogShape("hide", { kind: "circle", x: 5, y: 6, radius: 7 }),
      fogShape("reveal", { kind: "polygon", points: [0, 0, 1, 0, 1, 1] }),
      fogFill("hide"),
      fogFill("reveal"),
    ]);
    expect(calls).toEqual([
      ["fillRect", "destination-out", 1, 2, 3, 4],
      ["beginPath", "source-over"],
      ["arc", "source-over", 5, 6, 7, 0, Math.PI * 2],
      ["closePath", "source-over"],
      ["fill", "source-over"],
      ["beginPath", "destination-out"],
      ["moveTo", "destination-out", 0, 0],
      ["lineTo", "destination-out", 1, 0],
      ["lineTo", "destination-out", 1, 1],
      ["closePath", "destination-out"],
      ["fill", "destination-out", "evenodd"],
      ["fillRect", "source-over", 0, 0, 20, 10],
      ["clearRect", "source-over", 0, 0, 20, 10],
    ]);
    expect(ctx.globalCompositeOperation).toBe("source-over"); // always restored
    expect(ctx.fillStyle).toBe("#000000");
  });

  it("strokes a brush path with round caps and joins, and fills cell unions as one path (T008)", () => {
    const { ctx, calls, state } = fakeContext();
    const r = createCanvasFogRaster(20, 10, canvasWith(ctx));
    applyFogOps(r, [
      fogShape("reveal", { kind: "stroke", points: [1, 1, 5, 1, 5, 6], radius: 2 }),
      fogShape("hide", { kind: "stroke", points: [3, 3], radius: 1.5 }),
      fogShape("reveal", { kind: "rects", rects: [0, 0, 2, 2, 2, 0, 2, 2] }),
    ]);
    expect(calls).toEqual([
      ["beginPath", "destination-out"],
      ["moveTo", "destination-out", 1, 1],
      ["lineTo", "destination-out", 5, 1],
      ["lineTo", "destination-out", 5, 6],
      ["stroke", "destination-out"],
      ["beginPath", "source-over"],
      ["arc", "source-over", 3, 3, 1.5, 0, Math.PI * 2],
      ["closePath", "source-over"],
      ["fill", "source-over"],
      ["beginPath", "destination-out"],
      ["rect", "destination-out", 0, 0, 2, 2],
      ["rect", "destination-out", 2, 0, 2, 2],
      ["fill", "destination-out", "nonzero"],
    ]);
    expect(state.lineWidth).toBe(4);
    expect(state.lineCap).toBe("round");
    expect(state.lineJoin).toBe("round");
    expect(state.strokeStyle).toBe("#000000");
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("draws a feathered op as its own blurred shadow, shifted back onto the canvas (T008)", () => {
    const { ctx, calls, state } = fakeContext();
    const r = createCanvasFogRaster(20, 10, canvasWith(ctx));
    applyFogOp(r, fogShape("reveal", { kind: "rect", x: 1, y: 2, width: 3, height: 4 }, 6));
    expect(calls).toEqual([
      ["save", "destination-out"],
      ["shadowBlur", "destination-out", 6],
      ["translate", "destination-out", -SHADOW_SHIFT, 0],
      ["fillRect", "destination-out", 1, 2, 3, 4],
      ["restore", "destination-out"],
    ]);
    // The shadow lands exactly where the shape would have: shift + translate cancel.
    expect(state.shadowOffsetX).toBe(0); // restored
    expect(ctx.globalCompositeOperation).toBe("source-over");
    // Feather 0 (or absent) takes the plain path.
    calls.length = 0;
    applyFogOp(r, fogShape("hide", { kind: "circle", x: 1, y: 1, radius: 1 }, 0));
    expect(calls.map((c) => c[0])).toEqual(["beginPath", "arc", "closePath", "fill"]);
  });

  it("the shadow shift is larger than any map so the shape itself never lands on the surface", () => {
    expect(SHADOW_SHIFT).toBeGreaterThanOrEqual(16384);
  });

  it("reset draws the base image, or fills black without one", () => {
    const { ctx, calls } = fakeContext();
    const r = createCanvasFogRaster(8, 8, canvasWith(ctx));
    r.reset(null);
    const image = {} as CanvasImageSource;
    r.reset(image);
    expect(calls).toEqual([
      ["clearRect", "source-over", 0, 0, 8, 8],
      ["fillRect", "source-over", 0, 0, 8, 8],
      ["clearRect", "source-over", 0, 0, 8, 8],
      ["drawImage", "source-over", image, 0, 0, 8, 8],
    ]);
    r.resize(3, 4);
    expect(r.width).toBe(3);
    expect(r.height).toBe(4);
  });
});
