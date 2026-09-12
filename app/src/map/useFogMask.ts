/**
 * React binding for the fog mask (T007): one offscreen canvas per stage,
 * kept in step with the scene's fog state by `createFogMaskUpdater`. The
 * canvas element is stable for the life of the component; its pixels change
 * in a layout effect (before paint), and `onDraw` lets the caller ask Konva
 * to redraw the layer that shows it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import {
  createCanvasFogMask,
  type CanvasFogMask,
  type FogMaskStatus,
  type FogSource,
} from "./fogMask";

export interface FogMaskHandle {
  canvas: HTMLCanvasElement;
  status: FogMaskStatus;
}

export function useFogMask(
  scene: FogSource,
  base: HTMLImageElement | null,
  onDraw?: () => void
): FogMaskHandle {
  const maskRef = useRef<CanvasFogMask | null>(null);
  maskRef.current ??= createCanvasFogMask(scene.width, scene.height);
  const mask = maskRef.current;
  const [status, setStatus] = useState<FogMaskStatus>("waiting");

  useLayoutEffect(() => {
    setStatus(mask.updater.update(scene, base));
    onDraw?.();
    // `fogOps` is a new array after every fog op; the other fields change
    // when the map, its size or its base does.
  }, [
    mask,
    scene.id,
    scene.width,
    scene.height,
    scene.fogMaskAssetId,
    scene.fogOps,
    scene.fogOpsFrom,
    base,
    onDraw,
  ]);

  return { canvas: mask.canvas, status };
}
