/**
 * Vitest setup, run before every test file. Gives every environment an
 * in-memory IndexedDB so persistence code works under jsdom and node alike.
 * Data does not survive across files (each file gets fresh globals);
 * persistence tests still use a uniquely named database per test.
 *
 * jsdom has no 2D canvas implementation (`getContext` returns null), which
 * makes Konva throw on mount. We install a no-op 2D context so Konva stages
 * can be mounted and their scene graph inspected in component tests; what
 * actually gets painted is covered by the Playwright suite.
 */
import "fake-indexeddb/auto";

function createNoopContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { canvas };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (prop in state) return state[prop];
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
          width: w,
          height: h,
        });
      }
      if (prop === "measureText") return () => ({ width: 0 });
      if (prop === "createImageData") {
        return (w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
          width: w,
          height: h,
        });
      }
      if (prop === "getTransform") return () => new DOMMatrix();
      return () => undefined;
    },
    set(_target, prop, value) {
      state[prop] = value;
      return true;
    },
  });
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string
  ) {
    return contextId === "2d" ? createNoopContext2d(this) : null;
  } as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => "data:,";
}

if (typeof DOMMatrix === "undefined") {
  // jsdom lacks DOMMatrix; Konva only needs it for getTransform above.
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class {};
}
