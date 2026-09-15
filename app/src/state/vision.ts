/**
 * Vision fields (T105, ADR 0026): which tokens see, and whether a map uses
 * vision. Pure and shared by both windows.
 *
 * T105 adds only the data — `Token.vision`, a radius in whole cells (0 = no
 * vision), and `MapScene.visionDim`, the per-map dim override — and these
 * helpers over it. T106 reveals what a dropped token sees from its
 * `tokenCentre` — `tokenVisionPolygon`, which the DM canvas also previews
 * while the token is dragged; T107 dims revealed areas no token currently
 * sees on the player while `mapUsesVision`.
 *
 * A hidden token still sees: the DM hid it from the players, not its eyes,
 * and decides what its vision reveals.
 */
import { blockingSegments, visibilityPolygon, visionRadiusPx, type Segment } from "../map/visibility";
import type { MapScene, Token } from "./model";
import { tokenCenter, type TokenPoint } from "./tokens";

/** The largest vision the token editor offers, in cells. The model accepts any whole number ≥ 0. */
export const TOKEN_VISION_MAX = 60;

/** A number typed into the editor as a vision: whole cells, 0..`TOKEN_VISION_MAX`; NaN is 0. */
export function clampTokenVision(cells: number): number {
  if (Number.isNaN(cells)) return 0;
  return Math.min(TOKEN_VISION_MAX, Math.max(0, Math.round(cells)));
}

/** The tokens of a scene that see (vision above 0), hidden ones included, in document order. */
export function seeingTokens(scene: Pick<MapScene, "tokens">): Token[] {
  return scene.tokens.filter((token) => token.vision > 0);
}

/**
 * Whether a map uses vision, i.e. whether the player dims revealed areas no
 * token currently sees (T107): always for `on`, never for `off`, and for
 * `auto` while any token on the map — hidden or not — has vision. A map
 * whose fog is run by hand (`auto`, nobody sees) therefore looks exactly as
 * it did before vision existed.
 */
export function mapUsesVision(scene: Pick<MapScene, "tokens" | "visionDim">): boolean {
  switch (scene.visionDim) {
    case "on":
      return true;
    case "off":
      return false;
    case "auto":
      return scene.tokens.some((token) => token.vision > 0);
  }
}

/** Where a token sees from: the centre of its footprint, in map pixels. */
export function tokenCentre(token: Pick<Token, "x" | "y" | "size">, cellSize: number): TokenPoint {
  return tokenCenter(token, cellSize);
}

/**
 * What a token sees (T106, ADR 0026): the visibility polygon from its
 * `tokenCentre` within `visionRadiusPx(vision, cellSize)`, with the scene's
 * walls and closed doors blocking — flat `[x0, y0, …]` in map pixels, `[]`
 * without vision. A caller that asks often may pass the blocking `segments`
 * it already has.
 */
export function tokenVisionPolygon(
  scene: Pick<MapScene, "walls" | "grid" | "width" | "height">,
  token: Pick<Token, "x" | "y" | "size" | "vision">,
  segments?: readonly Segment[]
): number[] {
  const radius = visionRadiusPx(token.vision, scene.grid.cellSize);
  if (radius === 0) return [];
  return visibilityPolygon(
    tokenCentre(token, scene.grid.cellSize),
    radius,
    segments ?? blockingSegments(scene.walls),
    scene
  );
}
