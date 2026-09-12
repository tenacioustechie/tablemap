/**
 * React binding for the fog mask (T007): one offscreen canvas per stage,
 * kept in step with the scene's fog state by `createFogMaskUpdater`. The
 * canvas element is stable for the life of the component; its pixels change
 * in a layout effect (before paint), and `onDraw` lets the caller ask Konva
 * to redraw the layer that shows it.
 *
 * The handle also answers "is this map pixel fogged?" (`isFogged`, T010) by
 * sampling the mask (`createFogSampler`); while the mask is `waiting` (a
 * base this window does not have) everything is fogged, matching what is
 * drawn. `isFogged` is a new function after every mask update, so memoising
 * on it recomputes exactly when the fog changed.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FogQuery } from "../state/tokens";
import {
  createCanvasFogMask,
  type CanvasFogMask,
  type FogMaskStatus,
  type FogSource,
} from "./fogMask";
import { createFogSampler, type FogSampler } from "./fogRaster";

export interface FogMaskHandle {
  canvas: HTMLCanvasElement;
  status: FogMaskStatus;
  /** Counts mask updates; changes whenever the pixels may have. */
  version: number;
  isFogged: FogQuery;
}

const ALL_FOGGED: FogQuery = () => true;

export function useFogMask(
  scene: FogSource,
  base: HTMLImageElement | null,
  onDraw?: () => void
): FogMaskHandle {
  const maskRef = useRef<CanvasFogMask | null>(null);
  maskRef.current ??= createCanvasFogMask(scene.width, scene.height);
  const mask = maskRef.current;
  const samplerRef = useRef<FogSampler | null>(null);
  samplerRef.current ??= createFogSampler(mask.canvas);
  const sampler = samplerRef.current;
  const [{ status, version }, setState] = useState<{ status: FogMaskStatus; version: number }>({
    status: "waiting",
    version: 0,
  });

  useLayoutEffect(() => {
    const next = mask.updater.update(scene, base);
    setState((s) => ({ status: next, version: s.version + 1 }));
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

  const isFogged = useMemo<FogQuery>(
    () => (status === "waiting" ? ALL_FOGGED : (x, y) => sampler.isHidden(x, y)),
    // `version` is what invalidates the query: same pixels, same answer.
    [status, version, sampler]
  );

  return { canvas: mask.canvas, status, version, isFogged };
}
