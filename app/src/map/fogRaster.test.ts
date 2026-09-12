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
    const state = { globalCompositeOperation: "source-over", fillStyle: "" };
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
      fillRect: record("fillRect"),
      clearRect: record("clearRect"),
      beginPath: record("beginPath"),
      arc: record("arc"),
      moveTo: record("moveTo"),
      lineTo: record("lineTo"),
      closePath: record("closePath"),
      fill: record("fill"),
      drawImage: record("drawImage") as FogContext2D["drawImage"],
    };
    return { ctx, calls };
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
