/**
 * The updater's bookkeeping — when to apply just the new ops, when to
 * rebuild, how compaction is bridged — exercised on the bitmap raster.
 */
import { fogFill, fogShape, type FogOp } from "../state/fog";
import { rotatePoint, ROTATION_DEGREES, type RotationDegrees } from "../state/sceneRotation";
import { readBlobBytes } from "../test/blob";
import { createFogMaskUpdater, rotateFogMask, type FogSource, type RotateContext2D } from "./fogMask";
import { applyFogOps, createBitmapFogRaster, FOG_HIDDEN, FOG_REVEALED } from "./fogRaster";

const rect = (x: number, mode: "reveal" | "hide" = "reveal"): FogOp =>
  fogShape(mode, { kind: "rect", x, y: 0, width: 1, height: 1 });

const source = (overrides: Partial<FogSource> = {}): FogSource => ({
  id: "m",
  width: 8,
  height: 1,
  fogMaskAssetId: null,
  fogOps: [],
  fogOpsFrom: 0,
  ...overrides,
});

const row = (r: ReturnType<typeof createBitmapFogRaster>) =>
  Array.from(r.alpha, (a) => (a > 127 ? "#" : ".")).join("");

/** A base bitmap: the given columns revealed. */
const baseWith = (...revealed: number[]) => {
  const base = new Uint8Array(8).fill(FOG_HIDDEN);
  for (const x of revealed) base[x] = FOG_REVEALED;
  return base;
};

/** Counts raster calls so incremental updates can be told from rebuilds. */
function instrumented() {
  const raster = createBitmapFogRaster(8, 1);
  const counts = { reset: 0, ops: 0 };
  const originalReset = raster.reset;
  const originalRect = raster.fillRect;
  const originalAll = raster.fillAll;
  raster.reset = (base) => {
    counts.reset++;
    originalReset(base);
  };
  raster.fillRect = (...args) => {
    counts.ops++;
    originalRect(...args);
  };
  raster.fillAll = (mode) => {
    counts.ops++;
    originalAll(mode);
  };
  return { raster, counts };
}

describe("fog mask updater", () => {
  it("a new map with no base is rebuilt from full fog and reported ready", () => {
    const { raster, counts } = instrumented();
    const updater = createFogMaskUpdater(raster);
    expect(updater.status).toBe("waiting");
    expect(updater.update(source({ fogOps: [rect(1), rect(2)] }), null)).toBe("ready");
    expect(row(raster)).toBe("#..#####");
    expect(counts).toEqual({ reset: 1, ops: 2 });
  });

  it("applies only the ops appended since the last update", () => {
    const { raster, counts } = instrumented();
    const updater = createFogMaskUpdater(raster);
    const ops = [rect(1)];
    updater.update(source({ fogOps: ops }), null);
    const more = [...ops, rect(3), rect(5)];
    expect(updater.update(source({ fogOps: more }), null)).toBe("ready");
    expect(row(raster)).toBe("#.#.#.##");
    expect(counts).toEqual({ reset: 1, ops: 3 });
    // Nothing new: nothing applied.
    updater.update(source({ fogOps: more }), null);
    expect(counts).toEqual({ reset: 1, ops: 3 });
  });

  it("rebuilds when the log shrinks (undo) or the map changes", () => {
    const { raster, counts } = instrumented();
    const updater = createFogMaskUpdater(raster);
    updater.update(source({ fogOps: [rect(1), rect(2)] }), null);
    updater.update(source({ fogOps: [rect(1)] }), null);
    expect(row(raster)).toBe("#.######");
    expect(counts).toEqual({ reset: 2, ops: 3 });

    updater.update(source({ id: "other", fogOps: [rect(7)] }), null);
    expect(row(raster)).toBe("#######.");
    expect(counts).toEqual({ reset: 3, ops: 4 });
  });

  it("resizes the raster when the map size changes", () => {
    const raster = createBitmapFogRaster(8, 1);
    const updater = createFogMaskUpdater(raster);
    updater.update(source({ width: 3, height: 2, fogOps: [fogFill("reveal")] }), null);
    expect(raster.width).toBe(3);
    expect(raster.height).toBe(2);
    expect(raster.hiddenFraction()).toBe(0);
  });

  it("waits (fully fogged) for a base it does not have, then rebuilds from it", () => {
    const { raster, counts } = instrumented();
    const updater = createFogMaskUpdater(raster);
    const scene = source({ fogMaskAssetId: "png", fogOps: [rect(0)] });
    expect(updater.update(scene, null)).toBe("waiting");
    expect(row(raster)).toBe("########");
    // Still waiting while ops arrive: nothing is shown that might be wrong.
    const grown = { ...scene, fogOps: [...scene.fogOps, rect(1)] };
    expect(updater.update(grown, null)).toBe("waiting");
    expect(row(raster)).toBe("########");
    expect(counts.ops).toBe(0);

    const base = baseWith(6);
    expect(updater.update(grown, base)).toBe("ready");
    expect(row(raster)).toBe("..####.#");
    // And incremental again from here (same base object).
    const opsBefore = counts.ops;
    updater.update({ ...grown, fogOps: [...grown.fogOps, rect(2)] }, base);
    expect(row(raster)).toBe("...###.#");
    expect(counts.ops).toBe(opsBefore + 1);
  });

  it("bridges a compaction: keeps the pixels, applies new ops, rebuilds once the PNG lands", () => {
    const { raster, counts } = instrumented();
    const updater = createFogMaskUpdater(raster);
    const ops = [rect(0), rect(1), rect(2), rect(3)];
    updater.update(source({ fogOps: ops }), null);
    expect(row(raster)).toBe("....####");

    // The DM baked the first three ops into "png-1" and dropped them.
    const compacted = source({ fogMaskAssetId: "png-1", fogOps: ops.slice(3), fogOpsFrom: 3 });
    expect(updater.update(compacted, null)).toBe("bridged");
    expect(row(raster)).toBe("....####");
    expect(counts.reset).toBe(1); // no rebuild, no black flash

    // More ops before the PNG arrives are applied on top.
    const grown = { ...compacted, fogOps: [...compacted.fogOps, rect(5)] };
    expect(updater.update(grown, null)).toBe("bridged");
    expect(row(raster)).toBe("....#.##");
    expect(counts.reset).toBe(1);

    // The PNG (what the DM baked) arrives: rebuilt from it, same pixels.
    expect(updater.update(grown, baseWith(0, 1, 2))).toBe("ready");
    expect(row(raster)).toBe("....#.##");
    expect(counts.reset).toBe(2);
  });

  it("cannot bridge from a waiting raster, nor across a map switch", () => {
    const raster = createBitmapFogRaster(8, 1);
    const updater = createFogMaskUpdater(raster);
    updater.update(source({ fogMaskAssetId: "png-0", fogOps: [rect(0)] }), null);
    expect(updater.status).toBe("waiting");
    expect(
      updater.update(source({ fogMaskAssetId: "png-1", fogOps: [], fogOpsFrom: 1 }), null)
    ).toBe("waiting");

    updater.update(source({ id: "a", fogOps: [rect(0)] }), null);
    expect(updater.status).toBe("ready");
    expect(
      updater.update(source({ id: "b", fogMaskAssetId: "png-b", fogOps: [], fogOpsFrom: 4 }), null)
    ).toBe("waiting");
    expect(row(raster)).toBe("########");
  });

  it("a changed base image for the same asset id triggers a rebuild", () => {
    const { raster, counts } = instrumented();
    const updater = createFogMaskUpdater(raster);
    const scene = source({ fogMaskAssetId: "png", fogOps: [rect(1)] });
    updater.update(scene, baseWith(6));
    expect(row(raster)).toBe("#.####.#");
    updater.update(scene, baseWith(7));
    expect(row(raster)).toBe("#.#####.");
    expect(counts.reset).toBe(2);
  });

  it("the incremental path and a from-scratch replay agree byte for byte", () => {
    const raster = createBitmapFogRaster(8, 1);
    const updater = createFogMaskUpdater(raster);
    const history: FogOp[] = [];
    for (let i = 0; i < 12; i++) {
      history.push(i % 4 === 3 ? fogFill(i % 8 === 7 ? "hide" : "reveal") : rect(i % 8, i % 2 ? "hide" : "reveal"));
      updater.update(source({ fogOps: [...history] }), null);
    }
    const replay = createBitmapFogRaster(8, 1);
    applyFogOps(replay, history);
    expect(raster.alpha).toEqual(replay.alpha);
  });
});

// ---- rotateFogMask (T017) ---------------------------------------------------

/** An alpha grid standing in for a decoded mask image. */
interface AlphaImage {
  width: number;
  height: number;
  alpha: Uint8Array;
}

/**
 * A software 2D context that supports exactly what the rotator uses:
 * `translate`, `rotate` (multiples of 90°) and `drawImage`. Each source
 * pixel's centre goes through the current transform and lands in the target
 * pixel that contains it, so the test checks real pixels, not calls.
 */
function softwareCanvas() {
  let width = 1;
  let height = 1;
  let target = new Uint8Array(1);
  // Affine transform: x' = a x + c y + e, y' = b x + d y + f.
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: (typeof m)[] = [];
  const ctx: RotateContext2D = {
    save: () => void stack.push({ ...m }),
    restore: () => void (m = stack.pop() ?? m),
    translate: (x, y) => {
      m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y };
    },
    rotate: (angle) => {
      const cos = Math.round(Math.cos(angle));
      const sin = Math.round(Math.sin(angle));
      m = { ...m, a: m.a * cos + m.c * sin, b: m.b * cos + m.d * sin, c: -m.a * sin + m.c * cos, d: -m.b * sin + m.d * cos };
    },
    drawImage: ((image: AlphaImage, dx: number, dy: number, dw?: number, dh?: number) => {
      const w = dw ?? image.width;
      const h = dh ?? image.height;
      expect(w).toBe(image.width); // no resampling in this test
      expect(h).toBe(image.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const px = dx + x + 0.5;
          const py = dy + y + 0.5;
          const tx = Math.floor(m.a * px + m.c * py + m.e);
          const ty = Math.floor(m.b * px + m.d * py + m.f);
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) throw new Error(`pixel (${x}, ${y}) fell off at (${tx}, ${ty})`);
          target[ty * width + tx] = image.alpha[y * image.width + x];
        }
      }
    }) as unknown as RotateContext2D["drawImage"],
  };
  const canvas = {
    get width() {
      return width;
    },
    set width(v: number) {
      width = v;
      target = new Uint8Array(width * height);
    },
    get height() {
      return height;
    },
    set height(v: number) {
      height = v;
      target = new Uint8Array(width * height);
    },
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    /** "Encodes" the canvas: the raw alpha bytes, with the size in the type. */
    encode: async () => new Blob([new Uint8Array(target)], { type: `alpha/${width}x${height}` }),
  };
}

/** "Decodes" what `encode` produced. */
async function decodeAlpha(blob: Blob): Promise<AlphaImage> {
  const [width, height] = blob.type.replace("alpha/", "").split("x").map(Number);
  return { width, height, alpha: await readBlobBytes(blob) };
}

async function rotateAlpha(image: AlphaImage, degrees: RotationDegrees): Promise<AlphaImage> {
  const { canvas, encode } = softwareCanvas();
  const blob = await rotateFogMask(
    new Blob([new Uint8Array(image.alpha)], { type: `alpha/${image.width}x${image.height}` }),
    image,
    degrees,
    { decode: decodeAlpha as unknown as (blob: Blob) => Promise<CanvasImageSource>, createCanvas: () => canvas, encode }
  );
  return decodeAlpha(blob);
}

const picture = (rows: string[]): AlphaImage => ({
  width: rows[0].length,
  height: rows.length,
  alpha: Uint8Array.from(rows.join(""), (ch) => (ch === "#" ? FOG_HIDDEN : FOG_REVEALED)),
});
const rowsOf = (image: AlphaImage) =>
  Array.from({ length: image.height }, (_, y) =>
    Array.from(image.alpha.subarray(y * image.width, (y + 1) * image.width), (a) => (a > 127 ? "#" : ".")).join("")
  );

describe("rotateFogMask (T017)", () => {
  // 4 wide, 3 tall; one revealed pixel at (1, 0) and a revealed column at x = 3.
  const source = picture(["#.#.", "###.", "###."]);

  it("turns the mask's pixels clockwise onto a canvas of the turned size", async () => {
    // Clockwise: the top row becomes the right column, read top to bottom.
    expect(rowsOf(await rotateAlpha(source, 90))).toEqual(["###", "##.", "###", "..."]);
    expect(rowsOf(await rotateAlpha(source, 180))).toEqual([".###", ".###", ".#.#"]);
    expect(rowsOf(await rotateAlpha(source, 270))).toEqual(["...", "###", ".##", "###"]);
  });

  it("every source pixel lands where rotatePoint sends its centre", async () => {
    for (const degrees of ROTATION_DEGREES) {
      const turned = await rotateAlpha(source, degrees);
      for (let y = 0; y < source.height; y++) {
        for (let x = 0; x < source.width; x++) {
          const p = rotatePoint({ x: x + 0.5, y: y + 0.5 }, source, degrees);
          const tx = Math.floor(p.x);
          const ty = Math.floor(p.y);
          expect(turned.alpha[ty * turned.width + tx]).toBe(source.alpha[y * source.width + x]);
        }
      }
    }
  });

  it("four quarter turns give back the same pixels", async () => {
    let image = source;
    for (let i = 0; i < 4; i++) image = await rotateAlpha(image, 90);
    expect(image).toEqual(source);
    // And 90 + 270 too.
    expect(await rotateAlpha(await rotateAlpha(source, 90), 270)).toEqual(source);
  });
});
