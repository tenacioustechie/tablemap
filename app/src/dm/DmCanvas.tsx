/**
 * The DM's map canvas: the active scene on a Konva stage with free pan
 * (drag) and zoom (wheel), fitted to the container whenever the scene
 * changes.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { MapStage } from "../map/MapStage";
import { useContainerSize } from "../map/useContainerSize";
import { useImageElement } from "../map/useImageElement";
import { fitToView, type Viewport } from "../map/viewport";
import type { TableMapDb } from "../state/db";
import { activeMap } from "../state/maps";
import { useTableStore, type TableStore } from "../state/store";
import { useAssetBlob } from "./useAssetBlob";

const FIT_PADDING = 24;

const styles = {
  root: { position: "absolute", inset: 0 },
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#555",
    textAlign: "center",
    padding: 24,
  },
  hud: {
    position: "absolute",
    right: 12,
    bottom: 12,
    display: "flex",
    gap: 8,
    alignItems: "center",
    color: "#aaa",
    fontSize: 12,
    background: "rgba(0,0,0,0.5)",
    padding: "4px 8px",
    borderRadius: 4,
  },
} satisfies Record<string, CSSProperties>;

export interface DmCanvasProps {
  store: TableStore;
  db: TableMapDb;
}

export function DmCanvas({ store, db }: DmCanvasProps) {
  const scene = useTableStore((s) => activeMap(s.shared), store);
  const blob = useAssetBlob(db, scene?.imageAssetId);
  const { image, status } = useImageElement(blob);
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const fittedFor = useRef<string | null>(null);

  const sceneId = scene?.id ?? null;
  const sceneW = scene?.width ?? 0;
  const sceneH = scene?.height ?? 0;
  const fit = useCallback(() => {
    if (sceneId === null || size.width === 0 || size.height === 0) return;
    setViewport(
      fitToView({ width: sceneW, height: sceneH }, size, FIT_PADDING)
    );
    fittedFor.current = sceneId;
  }, [sceneId, sceneW, sceneH, size]);

  useEffect(() => {
    if (sceneId !== null && fittedFor.current !== sceneId) fit();
  }, [sceneId, fit]);

  return (
    <div ref={containerRef} data-testid="dm-canvas-surface" style={styles.root}>
      {scene ? (
        <>
          <MapStage
            scene={scene}
            image={image}
            imageStatus={scene.imageAssetId ? status : "none"}
            size={size}
            viewport={viewport}
            interactive
            onViewportChange={setViewport}
            data-testid="dm-map-stage"
          />
          <div style={styles.hud}>
            <span data-testid="canvas-zoom">
              {Math.round(viewport.scale * 100)}%
            </span>
            <button type="button" onClick={fit} data-testid="canvas-fit">
              Fit
            </button>
          </div>
        </>
      ) : (
        <div style={styles.placeholder}>
          <p>
            No map selected.
            <br />
            Drop a PNG, JPEG or WebP here, or use the Maps panel.
          </p>
        </div>
      )}
    </div>
  );
}
