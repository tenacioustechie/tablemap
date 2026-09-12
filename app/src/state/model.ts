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
import { isFogOp, type FogOp } from "./fog";

/**
 * Written into every persisted campaign document. Bump on breaking changes
 * and add a migration step in `campaign.ts`.
 *
 * History: 1 = T003 initial shape; 2 = T004 adds `MapScene.backgroundColor`;
 * 3 = T005 splits grid style into per-view `GridSettings.dm` / `.player`;
 * 4 = T007 adds the fog operation log `MapScene.fogOps`;
 * 5 = T008 adds the `stroke` and `rects` fog shapes and per-op `feather`
 *     (no data changes; older builds must refuse rather than misread);
 * 6 = T009 adds `SharedState.splashImageAssetId` (the campaign's splash
 *     image; ADR 0014).
 */
export const SCHEMA_VERSION = 6;

export type AssetId = string;

/** What an asset Blob is; stored alongside it and carried by sync messages. */
export type AssetKind = "map-image" | "token-image" | "fog-mask" | "splash-image";

export const ASSET_KINDS: readonly AssetKind[] = [
  "map-image",
  "token-image",
  "fog-mask",
  "splash-image",
];

export function isAssetKind(x: unknown): x is AssetKind {
  return (ASSET_KINDS as readonly unknown[]).includes(x);
}

/** The two renderings of a scene; each has its own grid style. */
export type GridView = "dm" | "player";

export const GRID_VIEWS: readonly GridView[] = ["dm", "player"];

/** How the grid overlay looks in one view (ADR 0010). */
export interface GridStyle {
  visible: boolean;
  /** CSS colour of the grid lines. */
  color: string;
  /** 0..1 */
  opacity: number;
}

/** Where the grid lines fall, in map-image pixels. Shared by both views. */
export interface GridGeometry {
  /** Size of one cell in map pixels. */
  cellSize: number;
  /**
   * Offset of the grid origin from the image origin, in map pixels. Any
   * value is legal; the renderer wraps it into the first cell.
   */
  offsetX: number;
  offsetY: number;
}

/** Square-grid settings for one map: geometry plus a style per view. */
export interface GridSettings extends GridGeometry {
  dm: GridStyle;
  player: GridStyle;
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
  /**
   * The fog mask's *base*: a PNG (`fog-mask` asset) the fog ops are applied
   * on top of; null means the base is fully fogged (the state of a new map).
   * Written by compaction of the op log (ADR 0012).
   */
  fogMaskAssetId: AssetId | null;
  /** Fog operations applied after the base, oldest first (ADR 0012). */
  fogOps: FogOp[];
  /**
   * Position of `fogOps[0]` in the map's whole fog history (ops ever
   * applied). Compaction drops ops from the front and advances this, so a
   * renderer that has applied ops up to some history index can tell which
   * entries of a shorter log are new to it.
   */
  fogOpsFrom: number;
  tokens: Token[];
  annotations: Annotation[];
}

export function defaultGridStyle(): GridStyle {
  return { visible: true, color: "#ffffff", opacity: 0.3 };
}

export function defaultGridSettings(): GridSettings {
  return {
    cellSize: 70,
    offsetX: 0,
    offsetY: 0,
    dm: defaultGridStyle(),
    player: defaultGridStyle(),
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

export function isGridView(x: unknown): x is GridView {
  return (GRID_VIEWS as readonly unknown[]).includes(x);
}

export function isGridStyle(x: unknown): x is GridStyle {
  return (
    isRecord(x) &&
    typeof x.visible === "boolean" &&
    typeof x.color === "string" &&
    isFiniteNumber(x.opacity) &&
    x.opacity >= 0 &&
    x.opacity <= 1
  );
}

export function isGridGeometry(x: unknown): x is GridGeometry {
  return (
    isRecord(x) &&
    isFiniteNumber(x.cellSize) &&
    x.cellSize > 0 &&
    isFiniteNumber(x.offsetX) &&
    isFiniteNumber(x.offsetY)
  );
}

export function isGridSettings(x: unknown): x is GridSettings {
  return (
    isRecord(x) &&
    isGridGeometry(x) &&
    isGridStyle(x.dm) &&
    isGridStyle(x.player)
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
    Array.isArray(x.fogOps) &&
    x.fogOps.every(isFogOp) &&
    isFiniteNumber(x.fogOpsFrom) &&
    Number.isInteger(x.fogOpsFrom) &&
    x.fogOpsFrom >= 0 &&
    Array.isArray(x.tokens) &&
    x.tokens.every(isToken) &&
    Array.isArray(x.annotations) &&
    x.annotations.every(isAnnotation)
  );
}
