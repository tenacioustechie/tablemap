/**
 * Rasterising fog operations (T007, ADR 0012).
 *
 * A `FogRaster` is a map-sized alpha surface: 255 = hidden (black fog), 0 =
 * revealed. `applyFogOp` turns one `FogOp` into raster calls, so the maths of
 * "which pixels does this op touch" lives in exactly one place and both
 * windows produce the same mask from the same op log.
 *
 * Two implementations:
 * - `createCanvasFogRaster` — production. A 2D canvas; `hide` paints black
 *   with `source-over`, `reveal` punches holes with `destination-out`.
 * - `createBitmapFogRaster` — a plain `Uint8Array`, one byte per pixel, with
 *   the same operations done arithmetically (pixel centres, no
 *   anti-aliasing). It needs no canvas at all, so the op maths is unit
 *   tested under jsdom, and it is the basis for "is this cell fogged?"
 *   queries later.
 *
 * `Base` is what `reset` starts from: for the canvas an image (the decoded
 * base PNG), for the bitmap another alpha array. Null means fully fogged.
 */
import type { FogMode, FogOp, FogShape } from "../state/fog";

export interface FogRaster<Base> {
  readonly width: number;
  readonly height: number;
  /** Start over: fully fogged, or exactly `base` when given. */
  reset(base: Base | null): void;
  fillAll(mode: FogMode): void;
  fillRect(mode: FogMode, x: number, y: number, width: number, height: number): void;
  fillCircle(mode: FogMode, x: number, y: number, radius: number): void;
  /** Flat [x0, y0, x1, y1, ...]; even-odd fill. */
  fillPolygon(mode: FogMode, points: readonly number[]): void;
}

export function applyFogOp<Base>(raster: FogRaster<Base>, op: FogOp): void {
  if (op.type === "fill") {
    raster.fillAll(op.mode);
    return;
  }
  applyFogShape(raster, op.mode, op.shape);
}

export function applyFogOps<Base>(raster: FogRaster<Base>, ops: readonly FogOp[]): void {
  for (const op of ops) applyFogOp(raster, op);
}

function applyFogShape<Base>(raster: FogRaster<Base>, mode: FogMode, shape: FogShape) {
  switch (shape.kind) {
    case "rect":
      raster.fillRect(mode, shape.x, shape.y, shape.width, shape.height);
      return;
    case "circle":
      raster.fillCircle(mode, shape.x, shape.y, shape.radius);
      return;
    case "polygon":
      raster.fillPolygon(mode, shape.points);
      return;
  }
}

// ---- canvas ----------------------------------------------------------------

export const FOG_COLOR = "#000000";

/** The subset of `CanvasRenderingContext2D` the canvas raster uses. */
export type FogContext2D = Pick<
  CanvasRenderingContext2D,
  | "globalCompositeOperation"
  | "fillStyle"
  | "fillRect"
  | "clearRect"
  | "beginPath"
  | "arc"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "drawImage"
>;

export interface CanvasFogRaster extends FogRaster<CanvasImageSource> {
  readonly canvas: HTMLCanvasElement;
  /** Changes the surface size (clears it). */
  resize(width: number, height: number): void;
}

export function createCanvasFogRaster(
  width: number,
  height: number,
  canvas: HTMLCanvasElement = document.createElement("canvas")
): CanvasFogRaster {
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d") as FogContext2D | null;
  if (!ctx) throw new Error("2D canvas is not available");

  const paint = (mode: FogMode, draw: () => void) => {
    ctx.globalCompositeOperation = mode === "hide" ? "source-over" : "destination-out";
    ctx.fillStyle = FOG_COLOR;
    draw();
    ctx.globalCompositeOperation = "source-over";
  };

  return {
    canvas,
    get width() {
      return canvas.width;
    },
    get height() {
      return canvas.height;
    },
    resize(w, h) {
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
    },
    reset(base) {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (base) {
        ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = FOG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    },
    fillAll(mode) {
      if (mode === "hide") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = FOG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    fillRect(mode, x, y, w, h) {
      paint(mode, () => ctx.fillRect(x, y, w, h));
    },
    fillCircle(mode, x, y, radius) {
      paint(mode, () => {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      });
    },
    fillPolygon(mode, points) {
      if (points.length < 6) return;
      paint(mode, () => {
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
        ctx.closePath();
        ctx.fill("evenodd");
      });
    },
  };
}

// ---- bitmap ----------------------------------------------------------------

export const FOG_HIDDEN = 255;
export const FOG_REVEALED = 0;

export interface BitmapFogRaster extends FogRaster<Uint8Array> {
  /** Row-major alpha, one byte per pixel. A new array after `resize`. */
  readonly alpha: Uint8Array;
  /** Changes the surface size (fully fogged afterwards). */
  resize(width: number, height: number): void;
  alphaAt(x: number, y: number): number;
  isHidden(x: number, y: number): boolean;
  /** Fraction of pixels that are hidden, 0..1. */
  hiddenFraction(): number;
}

/**
 * Pixel `(px, py)` covers the unit square `[px, px+1) x [py, py+1)`; it is
 * inside a shape when its centre `(px + 0.5, py + 0.5)` is.
 */
export function createBitmapFogRaster(width: number, height: number): BitmapFogRaster {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  let alpha = new Uint8Array(w * h);
  alpha.fill(FOG_HIDDEN);
  const value = (mode: FogMode) => (mode === "hide" ? FOG_HIDDEN : FOG_REVEALED);

  const fillSpan = (v: number, py: number, x0: number, x1: number) => {
    // Pixels whose centre lies in [x0, x1).
    const from = Math.max(0, Math.ceil(x0 - 0.5));
    const to = Math.min(w, Math.ceil(x1 - 0.5));
    if (from >= to) return;
    alpha.fill(v, py * w + from, py * w + to);
  };

  return {
    get alpha() {
      return alpha;
    },
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    resize(width, height) {
      w = Math.max(1, Math.round(width));
      h = Math.max(1, Math.round(height));
      alpha = new Uint8Array(w * h);
      alpha.fill(FOG_HIDDEN);
    },
    alphaAt: (x, y) => alpha[y * w + x],
    isHidden: (x, y) => alpha[y * w + x] > 127,
    hiddenFraction() {
      let hidden = 0;
      for (const a of alpha) if (a > 127) hidden++;
      return hidden / alpha.length;
    },
    reset(base) {
      if (base) {
        if (base.length !== alpha.length) {
          throw new Error(`fog base is ${base.length} px, raster is ${alpha.length} px`);
        }
        alpha.set(base);
      } else {
        alpha.fill(FOG_HIDDEN);
      }
    },
    fillAll(mode) {
      alpha.fill(value(mode));
    },
    fillRect(mode, x, y, rw, rh) {
      if (rw <= 0 || rh <= 0) return;
      const v = value(mode);
      const y0 = Math.max(0, Math.ceil(y - 0.5));
      const y1 = Math.min(h, Math.ceil(y + rh - 0.5));
      for (let py = y0; py < y1; py++) fillSpan(v, py, x, x + rw);
    },
    fillCircle(mode, cx, cy, radius) {
      if (radius <= 0) return;
      const v = value(mode);
      const r2 = radius * radius;
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(h, Math.ceil(cy + radius));
      for (let py = y0; py < y1; py++) {
        const dy = py + 0.5 - cy;
        const half = r2 - dy * dy;
        if (half < 0) continue;
        const dx = Math.sqrt(half);
        // Centres with (x - cx)^2 <= half, i.e. x in [cx - dx, cx + dx].
        fillSpan(v, py, cx - dx, cx + dx + 1e-9);
      }
    },
    fillPolygon(mode, points) {
      const n = Math.floor(points.length / 2);
      if (n < 3) return;
      const v = value(mode);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        minY = Math.min(minY, points[i * 2 + 1]);
        maxY = Math.max(maxY, points[i * 2 + 1]);
      }
      const y0 = Math.max(0, Math.floor(minY));
      const y1 = Math.min(h, Math.ceil(maxY));
      const xs: number[] = [];
      for (let py = y0; py < y1; py++) {
        const sy = py + 0.5;
        xs.length = 0;
        for (let i = 0; i < n; i++) {
          const ax = points[i * 2];
          const ay = points[i * 2 + 1];
          const bx = points[((i + 1) % n) * 2];
          const by = points[((i + 1) % n) * 2 + 1];
          // Half-open in y so a vertex on the scanline is counted once.
          if (ay <= sy === by <= sy) continue;
          xs.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) fillSpan(v, py, xs[i], xs[i + 1]);
      }
    },
  };
}
