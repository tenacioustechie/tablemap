/**
 * Token helpers shared by both windows (T010, ADR 0015). All pure.
 *
 * A token occupies `size × size` grid cells; its `x`/`y` is the top-left
 * corner of that footprint in map pixels. Snapping puts the top-left on the
 * nearest grid corner, which aligns the whole footprint with the cells for
 * every size (the footprint is a whole number of cells). Dragging on the DM
 * canvas clamps the token so its centre stays on the map, then snaps.
 *
 * Whether the players may see a token is decided here as well
 * (`tokenVisibility`): never when it is flagged hidden, and never while any
 * cell it stands on is fogged — the fog is sampled at the centre of each
 * cell of the footprint. The caller supplies the fog query (the rendered
 * mask in a window, the bitmap raster in tests), so the rule is one function
 * both views and the tests share. Points off the map count as fogged.
 */
import type { GridGeometry, Token, TokenAppearance, TokenSize } from "./model";

export interface TokenPoint {
  x: number;
  y: number;
}

export interface TokenRect extends TokenPoint {
  width: number;
  height: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export const TOKEN_SIZES: readonly TokenSize[] = [1, 2, 3, 4];

export function isTokenSize(x: unknown): x is TokenSize {
  return (TOKEN_SIZES as readonly unknown[]).includes(x);
}

/** Disc colours handed out in turn to new tokens. */
export const TOKEN_PALETTE: readonly string[] = [
  "#d94a4a",
  "#3a7bd5",
  "#3fae5a",
  "#e0a526",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#7f8c8d",
];

/** Badge length the renderer is designed for; the panel limits input to it. */
export const TOKEN_BADGE_MAX_LENGTH = 3;

export type TokenPatch = Partial<Omit<Token, "id">>;

/** Side of a token's footprint in map pixels. */
export function tokenFootprintPx(size: TokenSize, cellSize: number): number {
  return size * cellSize;
}

export function tokenRect(
  token: Pick<Token, "x" | "y" | "size">,
  cellSize: number
): TokenRect {
  const side = tokenFootprintPx(token.size, cellSize);
  return { x: token.x, y: token.y, width: side, height: side };
}

export function tokenCenter(token: Pick<Token, "x" | "y" | "size">, cellSize: number): TokenPoint {
  const half = tokenFootprintPx(token.size, cellSize) / 2;
  return { x: token.x + half, y: token.y + half };
}

/** The top-left that puts a token of `size` centred on `center`. */
export function tokenTopLeftForCenter(
  center: TokenPoint,
  size: TokenSize,
  cellSize: number
): TokenPoint {
  const half = tokenFootprintPx(size, cellSize) / 2;
  return { x: center.x - half, y: center.y - half };
}

/**
 * Snaps a token's top-left to the nearest grid corner. The footprint is a
 * whole number of cells, so this aligns every edge with a grid line for any
 * size. Ties (exactly half a cell) round up, like `Math.round`.
 */
export function snapTokenPosition(point: TokenPoint, grid: GridGeometry): TokenPoint {
  const cell = grid.cellSize;
  return {
    x: grid.offsetX + Math.round((point.x - grid.offsetX) / cell) * cell,
    y: grid.offsetY + Math.round((point.y - grid.offsetY) / cell) * cell,
  };
}

/** Keeps the token's centre on the map (it may hang over the edge). */
export function clampTokenPosition(
  point: TokenPoint,
  size: TokenSize,
  cellSize: number,
  map: MapSize
): TokenPoint {
  const half = tokenFootprintPx(size, cellSize) / 2;
  return {
    x: Math.min(map.width - half, Math.max(-half, point.x)),
    y: Math.min(map.height - half, Math.max(-half, point.y)),
  };
}

/**
 * Where a token ends up when put down at `point` (its top-left): clamped so
 * its centre is on the map, then snapped if the token snaps. Used for the
 * DM's drags and for placing new tokens.
 */
export function placeToken(
  point: TokenPoint,
  token: Pick<Token, "size" | "snapToGrid">,
  grid: GridGeometry,
  map: MapSize
): TokenPoint {
  const clamped = clampTokenPosition(point, token.size, grid.cellSize, map);
  return token.snapToGrid ? snapTokenPosition(clamped, grid) : clamped;
}

/** The grid cells (column, row) a token's footprint covers, given its top-left is snapped. */
export function tokenCells(
  token: Pick<Token, "x" | "y" | "size">,
  grid: GridGeometry
): { col: number; row: number }[] {
  const col0 = Math.round((token.x - grid.offsetX) / grid.cellSize);
  const row0 = Math.round((token.y - grid.offsetY) / grid.cellSize);
  const cells: { col: number; row: number }[] = [];
  for (let r = 0; r < token.size; r++) {
    for (let c = 0; c < token.size; c++) cells.push({ col: col0 + c, row: row0 + r });
  }
  return cells;
}

/**
 * The map points where the fog is sampled for a token: the centre of each
 * cell of its footprint (`size²` points), wherever the token actually is —
 * an unsnapped token is sampled at the centres of its own cell-sized tiles.
 */
export function tokenFogSamplePoints(
  token: Pick<Token, "x" | "y" | "size">,
  cellSize: number
): TokenPoint[] {
  const points: TokenPoint[] = [];
  for (let r = 0; r < token.size; r++) {
    for (let c = 0; c < token.size; c++) {
      points.push({ x: token.x + (c + 0.5) * cellSize, y: token.y + (r + 0.5) * cellSize });
    }
  }
  return points;
}

/** True when the fog hides the map pixel at (x, y). Integer pixel coordinates. */
export type FogQuery = (x: number, y: number) => boolean;

export type TokenVisibility =
  /** Players see it. */
  | "visible"
  /** Flagged hidden by the DM. */
  | "hidden"
  /** At least one cell of its footprint is under fog (or off the map). */
  | "fogged";

/**
 * Whether the players may see a token. `hidden` wins over fog so the DM's
 * intent is reported even for a fogged token.
 */
export function tokenVisibility(
  token: Pick<Token, "x" | "y" | "size" | "hidden">,
  cellSize: number,
  map: MapSize,
  isFogged: FogQuery
): TokenVisibility {
  if (token.hidden) return "hidden";
  for (const p of tokenFogSamplePoints(token, cellSize)) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    if (px < 0 || py < 0 || px >= map.width || py >= map.height) return "fogged";
    if (isFogged(px, py)) return "fogged";
  }
  return "visible";
}

/** Visibility of every token of a scene, by token id. */
export function sceneTokenVisibility(
  scene: { tokens: readonly Token[]; grid: GridGeometry; width: number; height: number },
  isFogged: FogQuery
): Record<string, TokenVisibility> {
  const result: Record<string, TokenVisibility> = {};
  for (const token of scene.tokens) {
    result[token.id] = tokenVisibility(token, scene.grid.cellSize, scene, isFogged);
  }
  return result;
}

export function isTokenVisibleToPlayers(
  token: Pick<Token, "x" | "y" | "size" | "hidden">,
  cellSize: number,
  map: MapSize,
  isFogged: FogQuery
): boolean {
  return tokenVisibility(token, cellSize, map, isFogged) === "visible";
}

// ---- construction -----------------------------------------------------------

export interface NewTokenOptions {
  id: string;
  /** Top-left in map pixels; the caller places it (`placeToken`). */
  x: number;
  y: number;
  appearance: TokenAppearance;
  name?: string;
  badge?: string;
  size?: TokenSize;
  snapToGrid?: boolean;
  hidden?: boolean;
  /** Vision radius in cells (T105); 0 = none. */
  vision?: number;
}

export function createToken({
  id,
  x,
  y,
  appearance,
  name = "",
  badge = "",
  size = 1,
  snapToGrid = true,
  hidden = false,
  vision = 0,
}: NewTokenOptions): Token {
  return { id, name, appearance: { ...appearance }, badge, x, y, size, snapToGrid, hidden, vision };
}

export function cloneToken(token: Token): Token {
  return { ...token, appearance: { ...token.appearance } };
}

export function tokenAppearanceEqual(a: TokenAppearance, b: TokenAppearance): boolean {
  if (a.type !== b.type) return false;
  return a.type === "image" && b.type === "image"
    ? a.assetId === b.assetId
    : a.type === "disc" && b.type === "disc" && a.color === b.color;
}

/** The token with `patch` applied; the same object when nothing changes. */
export function patchToken(token: Token, patch: TokenPatch): Token {
  let changed = false;
  const next: Token = { ...token };
  const assign = <K extends keyof TokenPatch>(key: K, value: Token[K]) => {
    if (token[key] === value) return;
    next[key] = value;
    changed = true;
  };
  for (const key of Object.keys(patch) as (keyof TokenPatch)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === "appearance") {
      const appearance = value as TokenAppearance;
      if (!tokenAppearanceEqual(token.appearance, appearance)) {
        next.appearance = { ...appearance };
        changed = true;
      }
    } else {
      assign(key, value as Token[typeof key]);
    }
  }
  return changed ? next : token;
}

/**
 * How the DM's lists name a token: its name, else "Token <badge>", else
 * "Token" (the token list, and an initiative entry added from a token — T110).
 */
export function tokenLabel(token: Pick<Token, "name" | "badge">): string {
  return token.name !== "" ? token.name : token.badge !== "" ? `Token ${token.badge}` : "Token";
}

/** A default name and badge for the n-th token on a map (1-based). */
export function defaultTokenLabels(ordinal: number): { name: string; badge: string } {
  return { name: `Token ${ordinal}`, badge: String(ordinal) };
}

export function defaultTokenColor(ordinal: number): string {
  return TOKEN_PALETTE[(Math.max(1, ordinal) - 1) % TOKEN_PALETTE.length];
}
