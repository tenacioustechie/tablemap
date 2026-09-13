/**
 * Map management on the DM side: the import pipeline (file -> Blob asset ->
 * map record -> op) and the other list actions (blank map, duplicate,
 * rename, delete, activate, rotate). Every action writes assets through the
 * given database and changes state only via `store.dispatch`, so the player
 * and the autosaver see it like any other op.
 *
 * Decoding an image to learn its size needs a browser (`createImageBitmap`
 * or `Image`), as does turning a fog mask on a canvas; both are injected
 * (`measureImage`, `rotateFogMask`) so the pipeline is unit testable under
 * Node.
 */
import { nanoid } from "nanoid";
import { rotateFogMask as rotateFogMaskInBrowser, type RotateFogMask } from "../map/fogMask";
import type { TableMapDb } from "./db";
import {
  createBlankMapScene,
  createImageMapScene,
  duplicateMapScene,
  findMap,
  referencedAssetIds,
  type BlankMapOptions,
} from "./maps";
import type { AssetId, GridSettings, MapScene } from "./model";
import { deleteAsset, getAsset, putAsset } from "./persistence";
import type { RotationDegrees } from "./sceneRotation";
import type { SharedOp } from "./shared";
import type { TableStore } from "./store";

export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** MIME type of a file, falling back to its extension when the browser gives none. */
export function imageMimeType(file: { type: string; name: string }): string | null {
  const type = file.type.toLowerCase();
  if (SUPPORTED_IMAGE_TYPES.includes(type)) return type;
  if (type === "") {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    return EXTENSION_TYPES[ext] ?? null;
  }
  return null;
}

export function isSupportedImageFile(file: { type: string; name: string }): boolean {
  return imageMimeType(file) !== null;
}

export interface ImageSize {
  width: number;
  height: number;
}

export type MeasureImage = (blob: Blob) => Promise<ImageSize>;

export class MapImportError extends Error {
  constructor(
    public readonly reason: "unsupported-type" | "undecodable",
    public readonly fileName: string
  ) {
    super(
      reason === "unsupported-type"
        ? `${fileName}: only PNG, JPEG and WebP images can be imported.`
        : `${fileName}: the image could not be decoded.`
    );
    this.name = "MapImportError";
  }
}

/** Browser implementation: decode via `createImageBitmap`, falling back to `Image`. */
export const measureImageInBrowser: MeasureImage = async (blob) => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<ImageSize>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Strips the extension from a file name to use as the map name. */
export function mapNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base === "" ? "Imported map" : base;
}

export interface ImportMapImageDeps {
  measureImage: MeasureImage;
  id?: string;
}

/**
 * The import pipeline: validate the file, decode it for its size, store the
 * bytes as a `map-image` asset, and build the scene record. Throws
 * `MapImportError`; on failure nothing is written.
 */
export async function importMapImage(
  db: TableMapDb,
  campaignId: string,
  file: File,
  { measureImage, id }: ImportMapImageDeps
): Promise<MapScene> {
  const mime = imageMimeType(file);
  if (mime === null) throw new MapImportError("unsupported-type", file.name);
  const blob = file.type === mime ? file : file.slice(0, file.size, mime);

  let size: ImageSize;
  try {
    size = await measureImage(blob);
  } catch {
    throw new MapImportError("undecodable", file.name);
  }
  if (!(size.width > 0 && size.height > 0)) {
    throw new MapImportError("undecodable", file.name);
  }

  const imageAssetId = await putAsset(db, { campaignId, kind: "map-image", blob });
  return createImageMapScene({
    id,
    name: mapNameFromFile(file.name),
    imageAssetId,
    width: size.width,
    height: size.height,
  });
}

export interface MapActions {
  /** Imports one image, appends it as a map and makes it active. */
  importImage(file: File): Promise<MapScene>;
  /** Adds a blank gridded map and makes it active. */
  createBlank(options: BlankMapOptions): MapScene;
  /** Copies a map (right after the original) and makes the copy active. */
  duplicate(id: string): Promise<MapScene | undefined>;
  rename(id: string, name: string): void;
  /** Removes the map and any asset nothing references any more. */
  remove(id: string): Promise<void>;
  setActive(id: string | null): void;
  /** Replaces a map's grid settings (geometry and both view styles). */
  setGrid(id: string, grid: GridSettings): void;
  /**
   * Turns a map clockwise by `degrees` (T017, ADR 0021): bakes a turned copy
   * of its base fog mask (if it has one) as a new `fog-mask` asset, then
   * dispatches one `map/rotate`, then deletes the old mask if nothing
   * references it any more. Resolves false when nothing was turned (unknown
   * map, or the map's fog changed underneath the bake — the next click
   * retries).
   */
  rotate(id: string, degrees: RotationDegrees): Promise<boolean>;
}

export interface MapActionDeps {
  measureImage?: MeasureImage;
  newId?: () => string;
  /** Turns a base fog mask; the browser bakes on a canvas, tests inject a fake. */
  rotateFogMask?: RotateFogMask;
}

function requireCampaignId(store: TableStore): string {
  const id = store.getState().campaignId;
  if (id === null) throw new Error("No campaign is open.");
  return id;
}

export function createMapActions(
  store: TableStore,
  db: TableMapDb,
  {
    measureImage = measureImageInBrowser,
    newId = nanoid,
    rotateFogMask = rotateFogMaskInBrowser,
  }: MapActionDeps = {}
): MapActions {
  const dispatch = (...ops: SharedOp[]) => store.getState().dispatch(...ops);

  return {
    async importImage(file) {
      const campaignId = requireCampaignId(store);
      const scene = await importMapImage(db, campaignId, file, {
        measureImage,
        id: newId(),
      });
      dispatch(
        { kind: "map/add", map: scene },
        { kind: "map/set-active", id: scene.id }
      );
      return scene;
    },

    createBlank(options) {
      const scene = createBlankMapScene({ id: newId(), ...options });
      dispatch(
        { kind: "map/add", map: scene },
        { kind: "map/set-active", id: scene.id }
      );
      return scene;
    },

    async duplicate(id) {
      const { shared } = store.getState();
      const original = findMap(shared, id);
      if (!original) return undefined;
      const campaignId = requireCampaignId(store);
      let fogMaskAssetId: AssetId | null = null;
      if (original.fogMaskAssetId) {
        const mask = await getAsset(db, original.fogMaskAssetId);
        if (mask) {
          fogMaskAssetId = await putAsset(db, {
            id: newId(),
            campaignId,
            kind: "fog-mask",
            blob: mask.blob,
          });
        }
      }
      const copy = duplicateMapScene(original, { id: newId(), fogMaskAssetId });
      const index = store.getState().shared.maps.findIndex((m) => m.id === id);
      dispatch(
        { kind: "map/add", map: copy, index: index < 0 ? undefined : index + 1 },
        { kind: "map/set-active", id: copy.id }
      );
      return copy;
    },

    rename(id, name) {
      dispatch({ kind: "map/rename", id, name });
    },

    async remove(id) {
      const before = referencedAssetIds(store.getState().shared);
      dispatch({ kind: "map/remove", id });
      const after = referencedAssetIds(store.getState().shared);
      for (const assetId of before) {
        if (!after.has(assetId)) await deleteAsset(db, assetId);
      }
    },

    setActive(id) {
      dispatch({ kind: "map/set-active", id });
    },

    setGrid(id, grid) {
      dispatch({ kind: "map/set-grid", id, grid });
    },

    async rotate(id, degrees) {
      const snapshot = findMap(store.getState().shared, id);
      if (!snapshot) return false;
      const previous = snapshot.fogMaskAssetId;
      const campaignId = store.getState().campaignId;
      // The bake is asynchronous; a compaction landing meanwhile would swap
      // the base under it (same choreography as `fogActions.ts`).
      const stillValid = () => {
        const live = findMap(store.getState().shared, id);
        return (
          live !== undefined &&
          live.fogMaskAssetId === previous &&
          live.width === snapshot.width &&
          live.height === snapshot.height &&
          store.getState().campaignId === campaignId
        );
      };

      let fogMaskAssetId: AssetId | null = null;
      if (previous) {
        // Only a bake needs the campaign (the new asset is filed under it).
        if (campaignId === null) throw new Error("No campaign is open.");
        const record = await getAsset(db, previous);
        if (!stillValid()) return false;
        if (record) {
          const turned = await rotateFogMask(record.blob, snapshot, degrees);
          if (!stillValid()) return false;
          fogMaskAssetId = await putAsset(db, {
            id: newId(),
            campaignId,
            kind: "fog-mask",
            blob: turned,
          });
          if (!stillValid()) {
            await deleteAsset(db, fogMaskAssetId);
            return false;
          }
        }
      }
      dispatch({ kind: "map/rotate", id, degrees, fogMaskAssetId });
      if (previous && !referencedAssetIds(store.getState().shared).has(previous)) {
        await deleteAsset(db, previous);
      }
      return true;
    },
  };
}
