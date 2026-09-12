/**
 * Keeping a fog raster in step with a scene's fog state (T007, ADR 0012).
 *
 * A scene's fog is `fogMaskAssetId` (the base PNG; null = fully fogged) plus
 * `fogOps` (the log applied on top), with `fogOpsFrom` saying where in the
 * map's fog history the log starts. `createFogMaskUpdater` owns a raster and
 * brings it in line with whatever scene it is given:
 *
 * - **incremental** — same map, same base, log grown: only the new ops are
 *   applied (a brush stroke costs one shape, not a rebuild);
 * - **rebuild** — anything else while the base is available: reset to the
 *   base and replay the whole log;
 * - **bridged** — the base changed (compaction) but its PNG has not arrived
 *   or decoded yet. Compaction never changes the pixels, so the raster is
 *   still right; new ops are applied on top and the rebuild waits for the
 *   PNG. This is what keeps the TV from flashing black mid-session;
 * - **waiting** — the base is missing and the raster cannot be trusted
 *   (a map first shown before its PNG arrived): fully fogged until it does.
 *   The safe default: nothing is ever shown that should be hidden.
 *
 * `bakeFogMask` is the other half of compaction: render base + the first
 * `opCount` ops into a PNG Blob (browser only).
 */
import type { AssetId, MapScene } from "../state/model";
import {
  applyFogOps,
  createCanvasFogRaster,
  type CanvasFogRaster,
  type FogRaster,
} from "./fogRaster";

/** What the updater reads from a scene. */
export type FogSource = Pick<
  MapScene,
  "id" | "width" | "height" | "fogMaskAssetId" | "fogOps" | "fogOpsFrom"
>;

export type FogMaskStatus = "ready" | "bridged" | "waiting";

export interface FogMaskUpdater<Base> {
  /**
   * Makes the raster show `scene`'s fog. `base` is the decoded base for
   * `scene.fogMaskAssetId`; pass null when the scene has none or it is not
   * available yet. Returns what the raster now represents.
   */
  update(scene: FogSource, base: Base | null): FogMaskStatus;
  readonly status: FogMaskStatus;
}

export interface ResizableFogRaster<Base> extends FogRaster<Base> {
  resize(width: number, height: number): void;
}

export function createFogMaskUpdater<Base>(
  raster: ResizableFogRaster<Base>
): FogMaskUpdater<Base> {
  let sceneId: string | null = null;
  let baseAssetId: AssetId | null = null;
  let base: Base | null = null;
  /** History index of the next op the raster has not applied. */
  let nextIndex = 0;
  let status: FogMaskStatus = "waiting";

  const rebuild = (scene: FogSource, newBase: Base | null) => {
    raster.reset(newBase);
    applyFogOps(raster, scene.fogOps);
  };

  return {
    get status() {
      return status;
    },
    update(scene, newBase) {
      const surfaceChanged =
        scene.id !== sceneId ||
        scene.width !== raster.width ||
        scene.height !== raster.height;
      if (surfaceChanged) {
        if (scene.width !== raster.width || scene.height !== raster.height) {
          raster.resize(scene.width, scene.height);
        }
        sceneId = scene.id;
        status = "waiting";
      }
      const baseAvailable = scene.fogMaskAssetId === null || newBase !== null;
      const baseChanged = scene.fogMaskAssetId !== baseAssetId || newBase !== base;
      const first = scene.fogOpsFrom;
      const last = first + scene.fogOps.length;
      const canContinue =
        !surfaceChanged && status !== "waiting" && first <= nextIndex && nextIndex <= last;

      if (canContinue && !baseChanged) {
        applyFogOps(raster, scene.fogOps.slice(nextIndex - first));
      } else if (baseAvailable) {
        rebuild(scene, newBase);
        status = "ready";
      } else if (canContinue) {
        // Compaction: same pixels under a new base we do not have yet.
        applyFogOps(raster, scene.fogOps.slice(nextIndex - first));
        status = "bridged";
      } else {
        raster.reset(null);
        status = "waiting";
      }
      baseAssetId = scene.fogMaskAssetId;
      base = newBase;
      nextIndex = last;
      return status;
    },
  };
}

// ---- canvas convenience -------------------------------------------------------

export interface CanvasFogMask {
  raster: CanvasFogRaster;
  updater: FogMaskUpdater<CanvasImageSource>;
  canvas: HTMLCanvasElement;
}

export function createCanvasFogMask(width: number, height: number): CanvasFogMask {
  const raster = createCanvasFogRaster(width, height);
  return { raster, updater: createFogMaskUpdater(raster), canvas: raster.canvas };
}

// ---- baking (compaction) ----------------------------------------------------

export type DecodeImage = (blob: Blob) => Promise<CanvasImageSource>;

/** `createImageBitmap`, falling back to an `Image` element. */
export const decodeImageInBrowser: DecodeImage = async (blob) => {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("could not encode the fog mask"));
    }, "image/png");
  });
}

/** Signature of a fog mask baker; `state/fogActions.ts` takes one. */
export type BakeFogMask = (
  scene: FogSource,
  baseBlob: Blob | null,
  opCount: number
) => Promise<Blob>;

/**
 * Renders `scene`'s base plus its first `opCount` ops to a PNG. Browser only
 * (needs a 2D canvas and an image decoder); `fogActions` tests inject a fake.
 */
export async function bakeFogMask(
  scene: FogSource,
  baseBlob: Blob | null,
  opCount: number,
  decode: DecodeImage = decodeImageInBrowser
): Promise<Blob> {
  const base = baseBlob ? await decode(baseBlob) : null;
  const raster = createCanvasFogRaster(scene.width, scene.height);
  raster.reset(base);
  applyFogOps(raster, scene.fogOps.slice(0, Math.max(0, opCount)));
  if (base && "close" in base && typeof base.close === "function") base.close();
  return canvasToPng(raster.canvas);
}
