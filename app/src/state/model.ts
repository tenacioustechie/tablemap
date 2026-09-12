/**
 * Scene-level data model (ADR 0007).
 *
 * These types describe what lives inside a campaign: maps, and the grid,
 * tokens and annotations on each map. `SharedState` (`shared.ts`) embeds
 * them, so they travel to the player window and are persisted as part of the
 * campaign document (`campaign.ts`).
 *
 * Binary data never lives here. Map images, token images and fog masks are
 * referenced by `AssetId` and stored as Blobs in their own IndexedDB table
 * (`db.ts`), so the JSON document stays small and export can copy assets as
 * files.
 *
 * T003 defines the shapes; later tasks add the ops that create and edit them.
 */

/**
 * Written into every persisted campaign document. Bump on breaking changes
 * and add a migration step in `campaign.ts`.
 *
 * History: 1 = T003 initial shape; 2 = T004 adds `MapScene.backgroundColor`.
 */
export const SCHEMA_VERSION = 2;

export type AssetId = string;

/** What an asset Blob is; stored alongside it and carried by sync messages. */
export type AssetKind = "map-image" | "token-image" | "fog-mask";

export const ASSET_KINDS: readonly AssetKind[] = [
  "map-image",
  "token-image",
  "fog-mask",
];

export function isAssetKind(x: unknown): x is AssetKind {
  return (ASSET_KINDS as readonly unknown[]).includes(x);
}

/** Square-grid settings for one map, in map-image pixels. */
export interface GridSettings {
  /** Size of one cell in map pixels. */
  cellSize: number;
  /** Offset of the grid origin from the image origin, in map pixels. */
  offsetX: number;
  offsetY: number;
  visible: boolean;
  /** CSS colour of the grid lines. */
  color: string;
  /** 0..1 */
  opacity: number;
}

export type TokenSize = 1 | 2 | 3 | 4;

export type TokenAppearance =
  | { type: "image"; assetId: AssetId }
  | { type: "disc"; color: string };

export interface Token {
  id: string;
  name: string;
  appearance: TokenAppearance;
  /** Short letter/number badge drawn on the token; empty for none. */
  badge: string;
  /** Position of the token's top-left corner, in map pixels. */
  x: number;
  y: number;
  /** Footprint in cells (1x1 .. 4x4). */
  size: TokenSize;
  snapToGrid: boolean;
  /** Hidden tokens render on the DM view only. */
  hidden: boolean;
}

export type AnnotationVisibility = "dm" | "all";

export type Annotation =
  | {
      id: string;
      kind: "note";
      /** Map pixels. */
      x: number;
      y: number;
      text: string;
      /** Notes are DM-only by spec; kept explicit so renderers never guess. */
      visibility: "dm";
    }
  | {
      id: string;
      kind: "drawing";
      /** Flat [x0, y0, x1, y1, ...] in map pixels. */
      points: number[];
      color: string;
      strokeWidth: number;
      visibility: AnnotationVisibility;
    };

/** One scene: background image + grid + fog + tokens + annotations. */
export interface MapScene {
  id: string;
  name: string;
  /** Background image blob; null is a blank gridded map. */
  imageAssetId: AssetId | null;
  /** CSS colour painted under the image (all of a blank map shows it). */
  backgroundColor: string;
  /** Scene size in map pixels (image size, or chosen size for blank maps). */
  width: number;
  height: number;
  grid: GridSettings;
  /** Fog mask PNG blob; null means fully fogged (the state of a new map). */
  fogMaskAssetId: AssetId | null;
  tokens: Token[];
  annotations: Annotation[];
}

export function defaultGridSettings(): GridSettings {
  return {
    cellSize: 70,
    offsetX: 0,
    offsetY: 0,
    visible: true,
    color: "#ffffff",
    opacity: 0.3,
  };
}

// ---- type guards ----------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

export function isGridSettings(x: unknown): x is GridSettings {
  return (
    isRecord(x) &&
    isFiniteNumber(x.cellSize) &&
    x.cellSize > 0 &&
    isFiniteNumber(x.offsetX) &&
    isFiniteNumber(x.offsetY) &&
    typeof x.visible === "boolean" &&
    typeof x.color === "string" &&
    isFiniteNumber(x.opacity)
  );
}

export function isTokenAppearance(x: unknown): x is TokenAppearance {
  if (!isRecord(x)) return false;
  switch (x.type) {
    case "image":
      return isNonEmptyString(x.assetId);
    case "disc":
      return typeof x.color === "string";
    default:
      return false;
  }
}

export function isToken(x: unknown): x is Token {
  return (
    isRecord(x) &&
    isNonEmptyString(x.id) &&
    typeof x.name === "string" &&
    isTokenAppearance(x.appearance) &&
    typeof x.badge === "string" &&
    isFiniteNumber(x.x) &&
    isFiniteNumber(x.y) &&
    (x.size === 1 || x.size === 2 || x.size === 3 || x.size === 4) &&
    typeof x.snapToGrid === "boolean" &&
    typeof x.hidden === "boolean"
  );
}

export function isAnnotation(x: unknown): x is Annotation {
  if (!isRecord(x) || !isNonEmptyString(x.id)) return false;
  switch (x.kind) {
    case "note":
      return (
        isFiniteNumber(x.x) &&
        isFiniteNumber(x.y) &&
        typeof x.text === "string" &&
        x.visibility === "dm"
      );
    case "drawing":
      return (
        Array.isArray(x.points) &&
        x.points.every(isFiniteNumber) &&
        typeof x.color === "string" &&
        isFiniteNumber(x.strokeWidth) &&
        (x.visibility === "dm" || x.visibility === "all")
      );
    default:
      return false;
  }
}

export function isMapScene(x: unknown): x is MapScene {
  return (
    isRecord(x) &&
    isNonEmptyString(x.id) &&
    typeof x.name === "string" &&
    (x.imageAssetId === null || isNonEmptyString(x.imageAssetId)) &&
    typeof x.backgroundColor === "string" &&
    isFiniteNumber(x.width) &&
    x.width > 0 &&
    isFiniteNumber(x.height) &&
    x.height > 0 &&
    isGridSettings(x.grid) &&
    (x.fogMaskAssetId === null || isNonEmptyString(x.fogMaskAssetId)) &&
    Array.isArray(x.tokens) &&
    x.tokens.every(isToken) &&
    Array.isArray(x.annotations) &&
    x.annotations.every(isAnnotation)
  );
}
