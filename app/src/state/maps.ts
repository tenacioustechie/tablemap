/**
 * Pure helpers for map scenes: constructors for imported and blank maps,
 * duplication, and the asset bookkeeping both windows need (which assets a
 * state references, and in which order the player should receive them).
 *
 * Nothing here touches storage or the store; `mapActions.ts` does the
 * asynchronous parts (decoding images, writing Blobs) and dispatches ops.
 */
import { nanoid } from "nanoid";
import { cloneFogOp } from "./fog";
import {
  defaultGridSettings,
  type AssetId,
  type GridSettings,
  type MapScene,
} from "./model";
import type { SharedState } from "./shared";

export const DEFAULT_BLANK_MAP_COLOR = "#3b3b3b";
export const DEFAULT_BLANK_MAP_NAME = "Blank map";
/** Blank map defaults, in cells; the DM can change them in the form. */
export const DEFAULT_BLANK_MAP_COLUMNS = 30;
export const DEFAULT_BLANK_MAP_ROWS = 20;

export interface ImageMapOptions {
  id?: string;
  name: string;
  imageAssetId: AssetId;
  width: number;
  height: number;
  grid?: GridSettings;
}

/** A scene for an imported image. New maps are fully fogged (null mask). */
export function createImageMapScene({
  id = nanoid(),
  name,
  imageAssetId,
  width,
  height,
  grid = defaultGridSettings(),
}: ImageMapOptions): MapScene {
  return {
    id,
    name,
    imageAssetId,
    backgroundColor: "#000000",
    width,
    height,
    grid,
    fogMaskAssetId: null,
    fogOps: [],
    fogOpsFrom: 0,
    tokens: [],
    annotations: [],
  };
}

export interface BlankMapOptions {
  id?: string;
  name?: string;
  /** Size in cells. */
  columns: number;
  rows: number;
  /** Cell size in map pixels; also becomes the grid's cell size. */
  cellSize?: number;
  color?: string;
}

/** A blank gridded map: a solid colour of `columns` x `rows` cells. */
export function createBlankMapScene({
  id = nanoid(),
  name = DEFAULT_BLANK_MAP_NAME,
  columns,
  rows,
  cellSize = defaultGridSettings().cellSize,
  color = DEFAULT_BLANK_MAP_COLOR,
}: BlankMapOptions): MapScene {
  const cols = Math.max(1, Math.floor(columns));
  const rws = Math.max(1, Math.floor(rows));
  const cell = Math.max(1, cellSize);
  return {
    id,
    name,
    imageAssetId: null,
    backgroundColor: color,
    width: cols * cell,
    height: rws * cell,
    grid: { ...defaultGridSettings(), cellSize: cell, offsetX: 0, offsetY: 0 },
    fogMaskAssetId: null,
    fogOps: [],
    fogOpsFrom: 0,
    tokens: [],
    annotations: [],
  };
}

/**
 * A deep copy of `scene` under a new id. The image asset is shared (images
 * are immutable); the fog mask is per map, so the caller must pass the id of
 * a *copied* base mask (or null) via `fogMaskAssetId`. The fog op log is
 * copied, so the copy starts with the same fog as the original.
 */
export function duplicateMapScene(
  scene: MapScene,
  {
    id = nanoid(),
    name = `${scene.name} (copy)`,
    fogMaskAssetId = null,
  }: { id?: string; name?: string; fogMaskAssetId?: AssetId | null } = {}
): MapScene {
  return {
    ...scene,
    id,
    name,
    fogMaskAssetId,
    fogOps: scene.fogOps.map(cloneFogOp),
    grid: { ...scene.grid, dm: { ...scene.grid.dm }, player: { ...scene.grid.player } },
    tokens: scene.tokens.map((t) => ({ ...t, appearance: { ...t.appearance } })),
    annotations: scene.annotations.map((a) =>
      a.kind === "drawing" ? { ...a, points: [...a.points] } : { ...a }
    ),
  };
}

export function findMap(state: SharedState, id: string | null): MapScene | undefined {
  return id === null ? undefined : state.maps.find((m) => m.id === id);
}

export function activeMap(state: SharedState): MapScene | undefined {
  return findMap(state, state.activeMapId);
}

/** Every asset id one scene references, image first. */
export function sceneAssetIds(scene: MapScene): AssetId[] {
  const ids: AssetId[] = [];
  if (scene.imageAssetId) ids.push(scene.imageAssetId);
  if (scene.fogMaskAssetId) ids.push(scene.fogMaskAssetId);
  for (const token of scene.tokens) {
    if (token.appearance.type === "image") ids.push(token.appearance.assetId);
  }
  return ids;
}

/** Every asset id the whole state references (deduplicated), incl. the splash image. */
export function referencedAssetIds(state: SharedState): Set<AssetId> {
  const ids = new Set<AssetId>();
  for (const map of state.maps) for (const id of sceneAssetIds(map)) ids.add(id);
  if (state.splashImageAssetId) ids.add(state.splashImageAssetId);
  return ids;
}

/**
 * Rewrites every asset reference in `state` through `mapping`; ids the mapping
 * does not name are kept. Import uses it when an archive's asset ids clash
 * with assets already in storage (T012, ADR 0017).
 */
export function remapAssetIds(
  state: SharedState,
  mapping: ReadonlyMap<AssetId, AssetId>
): SharedState {
  const remap = <T extends AssetId | null>(id: T): T =>
    id === null ? id : ((mapping.get(id) ?? id) as T);
  return {
    ...state,
    splashImageAssetId: remap(state.splashImageAssetId),
    maps: state.maps.map((map) => ({
      ...map,
      imageAssetId: remap(map.imageAssetId),
      fogMaskAssetId: remap(map.fogMaskAssetId),
      tokens: map.tokens.map((token) =>
        token.appearance.type === "image"
          ? {
              ...token,
              appearance: { type: "image", assetId: remap(token.appearance.assetId) },
            }
          : token
      ),
    })),
  };
}

/**
 * Assets the player window needs, most urgent first: the active map's, then
 * the splash image (it may be shown at any moment), then every other map's
 * (so a scene switch is instant once they have arrived).
 */
export function assetIdsForPlayer(state: SharedState): AssetId[] {
  const seen = new Set<AssetId>();
  const ordered: AssetId[] = [];
  const push = (id: AssetId) => {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };
  const active = activeMap(state);
  if (active) sceneAssetIds(active).forEach(push);
  if (state.splashImageAssetId) push(state.splashImageAssetId);
  for (const map of state.maps) sceneAssetIds(map).forEach(push);
  return ordered;
}
