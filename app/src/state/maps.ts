/**
 * Pure helpers for map scenes: constructors for imported and blank maps,
 * duplication, and the asset bookkeeping both windows need (which assets a
 * state references, and in which order the player should receive them).
 *
 * Nothing here touches storage or the store; `mapActions.ts` does the
 * asynchronous parts (decoding images, writing Blobs) and dispatches ops.
 */
import { nanoid } from "nanoid";
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
    tokens: [],
    annotations: [],
  };
}

/**
 * A deep copy of `scene` under a new id. The image asset is shared (images
 * are immutable); the fog mask is per map, so the caller must pass the id of
 * a *copied* mask (or null) via `fogMaskAssetId`.
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

/** Every asset id the whole state references (deduplicated). */
export function referencedAssetIds(state: SharedState): Set<AssetId> {
  const ids = new Set<AssetId>();
  for (const map of state.maps) for (const id of sceneAssetIds(map)) ids.add(id);
  return ids;
}

/**
 * Assets the player window needs, most urgent first: the active map's, then
 * every other map's (so a scene switch is instant once they have arrived).
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
  for (const map of state.maps) sceneAssetIds(map).forEach(push);
  return ordered;
}
