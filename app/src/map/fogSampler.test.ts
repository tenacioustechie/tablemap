import { createFogSampler, FOG_HIDDEN, FOG_REVEALED } from "./fogRaster";

/**
 * A scratch canvas whose context records the source pixel `drawImage` was
 * asked for and answers `getImageData` from a function of that pixel.
 */
function scratchCanvas(alphaOf: (x: number, y: number) => number, withContext = true) {
  const calls: unknown[][] = [];
  let last = { x: -1, y: -1 };
  const ctx = {
    clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
    drawImage: (...args: unknown[]) => {
      calls.push(["drawImage", ...args]);
      last = { x: args[1] as number, y: args[2] as number };
    },
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, alphaOf(last.x, last.y)]), width: 1, height: 1 }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (_id: string, options?: unknown) => {
      calls.push(["getContext", options]);
      return withContext ? ctx : null;
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const mask = { width: 40, height: 30 } as HTMLCanvasElement;

describe("createFogSampler (T010)", () => {
  it("copies one pixel of the mask into a 1x1 scratch created for frequent reads and reads its alpha", () => {
    const { canvas, calls } = scratchCanvas((x, y) => (x < 20 && y < 15 ? 255 : 0));
    const sampler = createFogSampler(mask, canvas);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(calls[0]).toEqual(["getContext", { willReadFrequently: true }]);
    expect(sampler.alphaAt(3.7, 4.2)).toBe(255);
    expect(calls.slice(-2)).toEqual([
      ["clearRect", 0, 0, 1, 1],
      ["drawImage", mask, 3, 4, 1, 1, 0, 0, 1, 1],
    ]);
    expect(sampler.isHidden(3, 4)).toBe(true);
    expect(sampler.isHidden(25, 4)).toBe(false);
    expect(sampler.alphaAt(25, 20)).toBe(0);
  });

  it("treats pixels outside the mask as revealed and everything as hidden without a context", () => {
    const { canvas, calls } = scratchCanvas(() => 255);
    const sampler = createFogSampler(mask, canvas);
    const before = calls.length;
    expect(sampler.alphaAt(-1, 0)).toBe(FOG_REVEALED);
    expect(sampler.alphaAt(40, 0)).toBe(FOG_REVEALED);
    expect(sampler.alphaAt(0, 30)).toBe(FOG_REVEALED);
    expect(sampler.isHidden(39.9, 29.9)).toBe(true);
    expect(calls.length).toBe(before + 2); // only the in-bounds read touched the canvas

    const none = createFogSampler(mask, scratchCanvas(() => 0, false).canvas);
    expect(none.alphaAt(1, 1)).toBe(FOG_HIDDEN);
    expect(none.isHidden(1, 1)).toBe(true);
  });
});
