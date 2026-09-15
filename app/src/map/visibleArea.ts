/**
 * What the tokens see right now (T107, ADR 0026): the "currently visible"
 * overlay. Both windows derive it from the same shared state — walls, doors,
 * tokens, the grid — so nothing is stored or synced for it. Pure.
 *
 * `visiblePolygons(scene)` is `tokenVisionPolygon` for every seeing token of
 * the scene, hidden ones included (they still see), in document order, with
 * every wall and closed door blocking; a token that sees nothing gives no
 * polygon. `dimActive(scene)` is `mapUsesVision(scene)`: whether the stage
 * dims the revealed areas outside those polygons.
 *
 * `createVisiblePolygonsMemo()` is a one-entry cache for a stage. It keys on
 * the values the polygons depend on — the blocking segments, each seeing
 * token's position, size and vision, the cell size and the map's size — so a
 * fog op, a blind token's edit, a door no one looks through or a snapshot
 * that re-creates equal arrays hands back the previous result (the same
 * array) without casting a ray. A DM dragging a token changes none of them:
 * the store moves the token on the drop.
 */
import type { MapScene } from "../state/model";
import { mapUsesVision, seeingTokens, tokenVisionPolygon } from "../state/vision";
import { blockingSegments, type Segment } from "./visibility";

/** The parts of a scene what the tokens see depends on. */
export type VisibleAreaScene = Pick<MapScene, "walls" | "tokens" | "grid" | "width" | "height">;

/** One polygon per seeing token that sees anything: flat `[x0, y0, …]` in map pixels. */
export type VisiblePolygons = readonly (readonly number[])[];

export const NO_VISIBLE_POLYGONS: VisiblePolygons = [];

/** Whether revealed areas no token currently sees are dimmed on this map (T105's rule). */
export function dimActive(scene: Pick<MapScene, "tokens" | "visionDim">): boolean {
  return mapUsesVision(scene);
}

/** What every seeing token of the scene sees; `segments` defaults to the scene's blocking segments. */
export function visiblePolygons(
  scene: VisibleAreaScene,
  segments: readonly Segment[] = blockingSegments(scene.walls)
): VisiblePolygons {
  const polygons: number[][] = [];
  for (const token of seeingTokens(scene)) {
    const points = tokenVisionPolygon(scene, token, segments);
    if (points.length >= 6) polygons.push(points);
  }
  return polygons.length > 0 ? polygons : NO_VISIBLE_POLYGONS;
}

export type VisiblePolygonsMemo = (scene: VisibleAreaScene) => VisiblePolygons;

function segmentsKey(segments: readonly Segment[]): number[] {
  const key: number[] = [];
  for (const { a, b } of segments) key.push(a.x, a.y, b.x, b.y);
  return key;
}

function tokensKey(scene: VisibleAreaScene): number[] {
  const key = [scene.grid.cellSize, scene.width, scene.height];
  for (const token of scene.tokens) {
    if (token.vision > 0) key.push(token.x, token.y, token.size, token.vision);
  }
  return key;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * A memoised `visiblePolygons` (see the module comment). `compute` is what
 * runs on a miss — tests pass a spy to count them.
 */
export function createVisiblePolygonsMemo(compute = visiblePolygons): VisiblePolygonsMemo {
  let walls: VisibleAreaScene["walls"] | null = null;
  let segments: readonly Segment[] = [];
  let wallKey: number[] = [];
  let tokenKey: number[] | null = null;
  let result: VisiblePolygons = NO_VISIBLE_POLYGONS;
  return (scene) => {
    let wallsChanged = false;
    // The walls array is kept by every op that does not touch walls; only a
    // new array is read, and only different blocking segments count.
    if (scene.walls !== walls) {
      walls = scene.walls;
      const next = blockingSegments(scene.walls);
      const nextKey = segmentsKey(next);
      if (!sameNumbers(nextKey, wallKey)) {
        segments = next;
        wallKey = nextKey;
        wallsChanged = true;
      }
    }
    const nextTokenKey = tokensKey(scene);
    if (!wallsChanged && tokenKey !== null && sameNumbers(nextTokenKey, tokenKey)) return result;
    tokenKey = nextTokenKey;
    result = compute(scene, segments);
    return result;
  };
}
