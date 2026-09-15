/**
 * Vision fields (T105, ADR 0026): which tokens see, and whether a map uses
 * vision. Pure and shared by both windows.
 *
 * T105 adds only the data — `Token.vision`, a radius in whole cells (0 = no
 * vision), and `MapScene.visionDim`, the per-map dim override — and these
 * helpers over it. T106 reveals what a dropped token sees from its
 * `tokenCentre`; T107 dims revealed areas no token currently sees on the
 * player while `mapUsesVision`.
 *
 * A hidden token still sees: the DM hid it from the players, not its eyes,
 * and decides what its vision reveals.
 */
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
