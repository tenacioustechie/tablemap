/**
 * Player view rotation (T009): the TV in the table may be mounted at any
 * quarter turn relative to how the DM looks at the map, and players sit on
 * every side, so the DM can rotate the player view in 90-degree steps.
 * Rotation never changes the scale: a calibrated cell stays one inch
 * whichever way the map is turned (`map/playerView.ts`).
 *
 * Degrees, clockwise on screen (the canvas convention: y points down).
 */
export type Rotation = 0 | 90 | 180 | 270;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export function isRotation(x: unknown): x is Rotation {
  return (ROTATIONS as readonly unknown[]).includes(x);
}

/** Normalises any multiple of 90 into a `Rotation`; other values become 0. */
export function normalizeRotation(degrees: number): Rotation {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) return 0;
  const r = ((degrees % 360) + 360) % 360;
  return isRotation(r) ? r : 0;
}

export function rotateClockwise(rotation: Rotation): Rotation {
  return normalizeRotation(rotation + 90);
}

export function rotateCounterClockwise(rotation: Rotation): Rotation {
  return normalizeRotation(rotation - 90);
}

/** True when the rotation swaps the map's width and height on screen. */
export function isQuarterTurn(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}

export type MapEdge = "top" | "right" | "bottom" | "left";

/**
 * Which edge of the *map* ends up along the top of the TV. A clockwise
 * quarter turn brings the map's left edge to the top.
 */
export function mapEdgeAtTop(rotation: Rotation): MapEdge {
  switch (rotation) {
    case 0:
      return "top";
    case 90:
      return "left";
    case 180:
      return "bottom";
    case 270:
      return "right";
  }
}
