/**
 * Rasterising fog operations (T007, ADR 0012; T008, ADR 0013).
 *
 * A `FogRaster` is a map-sized alpha surface: 255 = hidden (black fog), 0 =
 * revealed. `applyFogOp` turns one `FogOp` into raster calls, so the maths of
 * "which pixels does this op touch" lives in exactly one place and both
 * windows produce the same mask from the same op log.
 *
 * Two implementations:
 * - `createCanvasFogRaster` — production. A 2D canvas; `hide` paints black
 *   with `source-over`, `reveal` punches holes with `destination-out`. A
 *   feathered op is drawn as its own blurred shadow: the shape is painted
 *   `SHADOW_SHIFT` px off the canvas with `shadowOffsetX` bringing the
 *   shadow (blurred by `feather`) back onto it. That works in every browser
 *   and with both composite operations, unlike `ctx.filter`.
 * - `createBitmapFogRaster` — a plain `Uint8Array`, one byte per pixel, with
 *   the same operations done arithmetically (pixel centres, no
 *   anti-aliasing, feather ignored: the hard edge sits where a feathered
 *   edge crosses 50 %). It needs no canvas at all, so the op maths is unit
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
  fillRect(mode: FogMode, x: number, y: number, width: number, height: number, feather?: number): void;
  /** Flat [x, y, w, h, ...]: the union of the rectangles. */
  fillRects(mode: FogMode, rects: readonly number[], feather?: number): void;
  fillCircle(mode: FogMode, x: number, y: number, radius: number, feather?: number): void;
  /** Flat [x0, y0, x1, y1, ...]; even-odd fill. */
  fillPolygon(mode: FogMode, points: readonly number[], feather?: number): void;
  /** Flat [x0, y0, x1, y1, ...]; round caps and joins; one point is a disc. */
  fillStroke(mode: FogMode, points: readonly number[], radius: number, feather?: number): void;
}

export function applyFogOp<Base>(raster: FogRaster<Base>, op: FogOp): void {
  if (op.type === "fill") {
    raster.fillAll(op.mode);
    return;
  }
  applyFogShape(raster, op.mode, op.shape, op.feather ?? 0);
}

export function applyFogOps<Base>(raster: FogRaster<Base>, ops: readonly FogOp[]): void {
  for (const op of ops) applyFogOp(raster, op);
}

function applyFogShape<Base>(
  raster: FogRaster<Base>,
  mode: FogMode,
  shape: FogShape,
  feather: number
) {
  switch (shape.kind) {
    case "rect":
      raster.fillRect(mode, shape.x, shape.y, shape.width, shape.height, feather);
      return;
    case "rects":
      raster.fillRects(mode, shape.rects, feather);
      return;
    case "circle":
      raster.fillCircle(mode, shape.x, shape.y, shape.radius, feather);
      return;
    case "polygon":
      raster.fillPolygon(mode, shape.points, feather);
      return;
    case "stroke":
      raster.fillStroke(mode, shape.points, shape.radius, feather);
      return;
  }
}

// ---- canvas ----------------------------------------------------------------

export const FOG_COLOR = "#000000";

/**
 * How far off the canvas a feathered shape is drawn (and its shadow shifted
 * back). Larger than any map this app handles, so the shape itself never
 * touches the surface.
 */
export const SHADOW_SHIFT = 1 << 16;

/** The subset of `CanvasRenderingContext2D` the canvas raster uses. */
export type FogContext2D = Pick<
  CanvasRenderingContext2D,
  | "globalCompositeOperation"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "shadowColor"
  | "shadowBlur"
  | "shadowOffsetX"
  | "shadowOffsetY"
  | "save"
  | "restore"
  | "translate"
  | "fillRect"
  | "clearRect"
  | "beginPath"
  | "rect"
  | "arc"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "stroke"
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

  const paint = (mode: FogMode, feather: number, draw: () => void) => {
    ctx.globalCompositeOperation = mode === "hide" ? "source-over" : "destination-out";
    ctx.fillStyle = FOG_COLOR;
    ctx.strokeStyle = FOG_COLOR;
    if (feather > 0) {
      ctx.save();
      ctx.shadowColor = FOG_COLOR;
      ctx.shadowBlur = feather;
      ctx.shadowOffsetX = SHADOW_SHIFT;
      ctx.shadowOffsetY = 0;
      ctx.translate(-SHADOW_SHIFT, 0);
      draw();
      ctx.restore();
    } else {
      draw();
    }
    ctx.globalCompositeOperation = "source-over";
  };

  const polyline = (points: readonly number[]) => {
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i + 1 < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  };

  const fillCircle = (mode: FogMode, x: number, y: number, radius: number, feather: number) => {
    if (radius <= 0) return;
    paint(mode, feather, () => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    });
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
    fillRect(mode, x, y, w, h, feather = 0) {
      if (w <= 0 || h <= 0) return;
      paint(mode, feather, () => ctx.fillRect(x, y, w, h));
    },
    fillRects(mode, rects, feather = 0) {
      if (rects.length < 4) return;
      paint(mode, feather, () => {
        ctx.beginPath();
        for (let i = 0; i + 3 < rects.length; i += 4) {
          if (rects[i + 2] > 0 && rects[i + 3] > 0) {
            ctx.rect(rects[i], rects[i + 1], rects[i + 2], rects[i + 3]);
          }
        }
        // Non-zero winding: overlapping rectangles stay filled (a union).
        ctx.fill("nonzero");
      });
    },
    fillCircle(mode, x, y, radius, feather = 0) {
      fillCircle(mode, x, y, radius, feather);
    },
    fillPolygon(mode, points, feather = 0) {
      if (points.length < 6) return;
      paint(mode, feather, () => {
        polyline(points);
        ctx.closePath();
        ctx.fill("evenodd");
      });
    },
    fillStroke(mode, points, radius, feather = 0) {
      if (points.length < 2 || radius <= 0) return;
      if (points.length < 4) {
        fillCircle(mode, points[0], points[1], radius, feather);
        return;
      }
      paint(mode, feather, () => {
        ctx.lineWidth = radius * 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        polyline(points);
        ctx.stroke();
      });
    },
  };
}

// ---- sampling the canvas ----------------------------------------------------

/** Reads single fog pixels back from a mask canvas (T010: "is this token under fog?"). */
export interface FogSampler {
  /** 0 (revealed) .. 255 (hidden); 0 outside the mask. */
  alphaAt(x: number, y: number): number;
  isHidden(x: number, y: number): boolean;
}

/**
 * Samples a mask canvas through a 1 × 1 scratch canvas created with
 * `willReadFrequently`: the pixel is copied with `drawImage` and read from
 * the scratch, so the (large, possibly GPU-backed) mask canvas itself never
 * sees a `getImageData` and keeps its fast path for painting. Without a 2D
 * context every pixel reads as hidden (the safe answer).
 */
export function createFogSampler(
  mask: HTMLCanvasElement,
  scratch: HTMLCanvasElement = document.createElement("canvas")
): FogSampler {
  scratch.width = 1;
  scratch.height = 1;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  const alphaAt = (x: number, y: number): number => {
    if (!ctx) return FOG_HIDDEN;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return FOG_REVEALED;
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(mask, px, py, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  };
  return { alphaAt, isHidden: (x, y) => alphaAt(x, y) > 127 };
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
 * inside a shape when its centre `(px + 0.5, py + 0.5)` is. Feather is
 * ignored (see the module comment).
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

  const fillRect = (v: number, x: number, y: number, rw: number, rh: number) => {
    if (rw <= 0 || rh <= 0) return;
    const y0 = Math.max(0, Math.ceil(y - 0.5));
    const y1 = Math.min(h, Math.ceil(y + rh - 0.5));
    for (let py = y0; py < y1; py++) fillSpan(v, py, x, x + rw);
  };

  const fillCircle = (v: number, cx: number, cy: number, radius: number) => {
    if (radius <= 0) return;
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
  };

  const fillPolygon = (v: number, points: readonly number[]) => {
    const n = Math.floor(points.length / 2);
    if (n < 3) return;
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
  };

  /** The pixels within `radius` of the segment (ax, ay)-(bx, by). */
  const fillCapsule = (
    v: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    radius: number
  ) => {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
    const x1 = Math.min(w, Math.ceil(Math.max(ax, bx) + radius));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
    const y1 = Math.min(h, Math.ceil(Math.max(ay, by) + radius));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const r2 = radius * radius;
    for (let py = y0; py < y1; py++) {
      const cy = py + 0.5;
      const row = py * w;
      for (let px = x0; px < x1; px++) {
        const cx = px + 0.5;
        let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = cx - (ax + t * dx);
        const ey = cy - (ay + t * dy);
        if (ex * ex + ey * ey <= r2) alpha[row + px] = v;
      }
    }
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
      fillRect(value(mode), x, y, rw, rh);
    },
    fillRects(mode, rects) {
      const v = value(mode);
      for (let i = 0; i + 3 < rects.length; i += 4) {
        fillRect(v, rects[i], rects[i + 1], rects[i + 2], rects[i + 3]);
      }
    },
    fillCircle(mode, cx, cy, radius) {
      fillCircle(value(mode), cx, cy, radius);
    },
    fillPolygon(mode, points) {
      fillPolygon(value(mode), points);
    },
    fillStroke(mode, points, radius) {
      if (points.length < 2 || radius <= 0) return;
      const v = value(mode);
      if (points.length < 4) {
        fillCircle(v, points[0], points[1], radius);
        return;
      }
      for (let i = 0; i + 3 < points.length; i += 2) {
        fillCapsule(v, points[i], points[i + 1], points[i + 2], points[i + 3], radius);
      }
    },
  };
}
