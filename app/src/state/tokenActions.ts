/**
 * The DM's token operations over a store + database (T010, ADR 0015):
 * adding disc and image tokens, editing them, moving them (with the snap and
 * clamp rules of `tokens.ts`) and removing them. Image tokens store their
 * file as a `token-image` asset, pushed to the player like any asset and
 * deleted once nothing references it. Same shape as `mapActions.ts`: assets
 * through the database, state through `store.dispatch` only.
 * Off-limits to `src/player/**`.
 */
import { nanoid } from "nanoid";
import type { TableMapDb } from "./db";
import { imageMimeType, MapImportError } from "./mapActions";
import { findMap, referencedAssetIds } from "./maps";
import type { MapScene, Token, TokenSize } from "./model";
import { deleteAsset, putAsset } from "./persistence";
import type { TableStore } from "./store";
import {
  createToken,
  defaultTokenColor,
  defaultTokenLabels,
  patchToken,
  placeToken,
  tokenTopLeftForCenter,
  type TokenPatch,
  type TokenPoint,
} from "./tokens";

export interface AddTokenOptions {
  /** Map point the new token is centred on; the map's centre when omitted. */
  at?: TokenPoint;
  name?: string;
  badge?: string;
  size?: TokenSize;
  /** Default true. */
  snapToGrid?: boolean;
  /** Default false. */
  hidden?: boolean;
  /** Disc colour; the next palette colour when omitted. */
  color?: string;
}

export interface TokenActions {
  /** Adds a coloured disc; undefined for an unknown map. */
  addDisc(mapId: string, options?: AddTokenOptions): Token | undefined;
  /**
   * Stores the file as a `token-image` asset and adds a token showing it.
   * Throws `MapImportError` for other file types; writes nothing on failure.
   */
  addImage(mapId: string, file: File, options?: AddTokenOptions): Promise<Token>;
  /**
   * Changes some fields. Turning snapping on (or resizing a snapping token)
   * also snaps the position; a patch that changes nothing dispatches nothing.
   */
  update(mapId: string, tokenId: string, patch: TokenPatch): void;
  /** Puts the token's top-left at `topLeft`, clamped to the map and snapped if it snaps. */
  move(mapId: string, tokenId: string, topLeft: TokenPoint): void;
  /** Removes the token and its image asset if nothing else references it. */
  remove(mapId: string, tokenId: string): Promise<void>;
}

export interface TokenActionDeps {
  newId?: () => string;
}

export function createTokenActions(
  store: TableStore,
  db: TableMapDb,
  { newId = nanoid }: TokenActionDeps = {}
): TokenActions {
  const scene = (mapId: string): MapScene | undefined =>
    findMap(store.getState().shared, mapId);

  const build = (
    map: MapScene,
    appearance: Token["appearance"],
    { at, name, badge, size = 1, snapToGrid = true, hidden = false }: AddTokenOptions
  ): Token => {
    const ordinal = map.tokens.length + 1;
    const labels = defaultTokenLabels(ordinal);
    const center = at ?? { x: map.width / 2, y: map.height / 2 };
    const wanted = tokenTopLeftForCenter(center, size, map.grid.cellSize);
    const { x, y } = placeToken(wanted, { size, snapToGrid }, map.grid, map);
    return createToken({
      id: newId(),
      x,
      y,
      appearance,
      name: name ?? labels.name,
      badge: badge ?? labels.badge,
      size,
      snapToGrid,
      hidden,
    });
  };

  const add = (map: MapScene, token: Token) => {
    store.getState().dispatch({ kind: "map/token-add", id: map.id, token });
  };

  return {
    addDisc(mapId, options = {}) {
      const map = scene(mapId);
      if (!map) return undefined;
      const color = options.color ?? defaultTokenColor(map.tokens.length + 1);
      const token = build(map, { type: "disc", color }, options);
      add(map, token);
      return token;
    },

    async addImage(mapId, file, options = {}) {
      const campaignId = store.getState().campaignId;
      if (campaignId === null) throw new Error("No campaign is open.");
      if (!scene(mapId)) throw new Error("Unknown map.");
      const mime = imageMimeType(file);
      if (mime === null) throw new MapImportError("unsupported-type", file.name);
      const blob = file.type === mime ? file : file.slice(0, file.size, mime);
      const assetId = await putAsset(db, { id: newId(), campaignId, kind: "token-image", blob });
      const map = scene(mapId);
      if (!map) {
        await deleteAsset(db, assetId);
        throw new Error("The map was removed while the image was being stored.");
      }
      const token = build(map, { type: "image", assetId }, options);
      add(map, token);
      return token;
    },

    update(mapId, tokenId, patch) {
      const map = scene(mapId);
      const token = map?.tokens.find((t) => t.id === tokenId);
      if (!map || !token) return;
      let full: TokenPatch = { ...patch };
      const snapToGrid = patch.snapToGrid ?? token.snapToGrid;
      const size = patch.size ?? token.size;
      const resnap =
        (patch.snapToGrid === true && !token.snapToGrid) ||
        (patch.size !== undefined && patch.size !== token.size);
      if (resnap) {
        const at = { x: patch.x ?? token.x, y: patch.y ?? token.y };
        full = { ...full, ...placeToken(at, { size, snapToGrid }, map.grid, map) };
      }
      // A patch that changes nothing would still travel as a delta: skip it.
      if (patchToken(token, full) === token) return;
      store.getState().dispatch({ kind: "map/token-update", id: mapId, tokenId, patch: full });
    },

    move(mapId, tokenId, topLeft) {
      const map = scene(mapId);
      const token = map?.tokens.find((t) => t.id === tokenId);
      if (!map || !token) return;
      const { x, y } = placeToken(topLeft, token, map.grid, map);
      store.getState().dispatch({ kind: "map/token-update", id: mapId, tokenId, patch: { x, y } });
    },

    async remove(mapId, tokenId) {
      if (!scene(mapId)?.tokens.some((t) => t.id === tokenId)) return;
      const before = referencedAssetIds(store.getState().shared);
      store.getState().dispatch({ kind: "map/token-remove", id: mapId, tokenId });
      const after = referencedAssetIds(store.getState().shared);
      for (const id of before) if (!after.has(id)) await deleteAsset(db, id);
    },
  };
}
