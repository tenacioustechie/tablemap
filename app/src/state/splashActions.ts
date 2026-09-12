/**
 * The campaign's splash image on the DM side (T009, ADR 0014): choose an
 * image file (stored as a `splash-image` asset, referenced from
 * `SharedState.splashImageAssetId`, pushed to the player like any asset) or
 * go back to the title card. The previous image is deleted once nothing
 * references it. Same shape as `mapActions.ts`: assets through the
 * database, state through `store.dispatch`. Off-limits to `src/player/**`.
 */
import { nanoid } from "nanoid";
import type { TableMapDb } from "./db";
import { imageMimeType, MapImportError } from "./mapActions";
import { referencedAssetIds } from "./maps";
import { deleteAsset, putAsset } from "./persistence";
import type { AssetId } from "./model";
import type { TableStore } from "./store";

export interface SplashActions {
  /** Stores the file as the splash image and selects it. Throws `MapImportError` for other file types. */
  setImage(file: File): Promise<AssetId>;
  /** Back to the title card; deletes the image if nothing else references it. */
  clearImage(): Promise<void>;
}

export interface SplashActionDeps {
  newId?: () => string;
}

export function createSplashActions(
  store: TableStore,
  db: TableMapDb,
  { newId = nanoid }: SplashActionDeps = {}
): SplashActions {
  const select = async (assetId: AssetId | null) => {
    const before = referencedAssetIds(store.getState().shared);
    store.getState().dispatch({ kind: "campaign/set-splash-image", assetId });
    const after = referencedAssetIds(store.getState().shared);
    for (const id of before) if (!after.has(id)) await deleteAsset(db, id);
  };

  return {
    async setImage(file) {
      const campaignId = store.getState().campaignId;
      if (campaignId === null) throw new Error("No campaign is open.");
      const mime = imageMimeType(file);
      if (mime === null) throw new MapImportError("unsupported-type", file.name);
      const blob = file.type === mime ? file : file.slice(0, file.size, mime);
      const assetId = await putAsset(db, { id: newId(), campaignId, kind: "splash-image", blob });
      await select(assetId);
      return assetId;
    },

    async clearImage() {
      if (store.getState().shared.splashImageAssetId === null) return;
      await select(null);
    },
  };
}
