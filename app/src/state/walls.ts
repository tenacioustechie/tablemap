/**
 * Walls and doors (T101, ADR 0024): free line segments in map pixels, any
 * angle, each a plain `wall` or a `door` that is open or closed. Pure and
 * shared by both windows.
 *
 * A segment is a data fact about the scene, not a drawing: it blocks sight
 * (T104's visibility polygon) and room fills (T108), and a door lets them
 * through while it is open. Walls travel to the player like tokens do —
 * the player needs them to compute what is currently visible (T107) — but
 * **no stage ever draws one**: the DM canvas draws them as its own chrome
 * (`dm/WallLayer.tsx`), and `player/boundary.test.ts` keeps that code out
 * of `map/` and `player/`.
 *
 * Nothing here knows how a segment was drawn (T102's tools, or v3's wall
 * tiles emitting segments): the format is the two endpoints and the kind.
 *
 * A door may carry a DM-given `name` (ADR 0030, schema 12): absent means
 * unnamed (the canvas calls it `D<n>`). Names are DM-only: `wallForPlayer`
 * strips them from everything the player window receives.
 */

export type WallKind = "wall" | "door";

export const WALL_KINDS: readonly WallKind[] = ["wall", "door"];

export function isWallKind(x: unknown): x is WallKind {
  return (WALL_KINDS as readonly unknown[]).includes(x);
}

interface SegmentEndpoints {
  /** Map pixels. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type WallSegment =
  | ({ id: string; kind: "wall" } & SegmentEndpoints)
  | ({ id: string; kind: "door"; open: boolean; name?: string } & SegmentEndpoints);

/** The longest door name kept (ADR 0030); longer input is cut. */
export const DOOR_NAME_MAX_LENGTH = 40;

/**
 * A door name as stored: whitespace runs collapsed to one space, trimmed,
 * cut to `DOOR_NAME_MAX_LENGTH`; `undefined` when nothing is left (unnamed).
 */
export function normalizeDoorName(raw: string): string | undefined {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, DOOR_NAME_MAX_LENGTH).trim();
  return name.length > 0 ? name : undefined;
}

/** A stored name is already normalized: non-empty, trimmed, single-spaced, not too long. */
export function isDoorName(x: unknown): x is string {
  return typeof x === "string" && normalizeDoorName(x) === x;
}

export type DoorSegment = Extract<WallSegment, { kind: "door" }>;
export type PlainWallSegment = Extract<WallSegment, { kind: "wall" }>;

/**
 * A partial segment (every field but `id`, each optional), for editors that
 * move one endpoint, flip a door or name it (T102, T103, ADR 0030). `open`
 * and `name` only make sense on a door; `patchWall` drops them from a wall
 * and defaults `open` on a new door. `name: null` removes a door's name.
 */
export interface WallPatch {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  kind?: WallKind;
  open?: boolean;
  name?: string | null;
}

// ---- guards ----------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function hasEndpoints(x: Record<string, unknown>): boolean {
  return isFiniteNumber(x.x1) && isFiniteNumber(x.y1) && isFiniteNumber(x.x2) && isFiniteNumber(x.y2);
}

export function isWallSegment(x: unknown): x is WallSegment {
  if (!isRecord(x) || typeof x.id !== "string" || x.id.length === 0 || !hasEndpoints(x)) {
    return false;
  }
  switch (x.kind) {
    case "wall":
      return true;
    case "door":
      return typeof x.open === "boolean" && (x.name === undefined || isDoorName(x.name));
    default:
      return false;
  }
}

const PATCH_FIELD_GUARDS: Record<keyof WallPatch, (v: unknown) => boolean> = {
  x1: isFiniteNumber,
  y1: isFiniteNumber,
  x2: isFiniteNumber,
  y2: isFiniteNumber,
  kind: isWallKind,
  open: (v) => typeof v === "boolean",
  name: (v) => v === null || isDoorName(v),
};

/** Only known fields, each well-formed; an empty patch is a valid (no-op) patch. */
export function isWallPatch(x: unknown): x is WallPatch {
  if (!isRecord(x)) return false;
  return Object.keys(x).every((key) => {
    const guard = PATCH_FIELD_GUARDS[key as keyof WallPatch];
    return guard !== undefined && guard(x[key]);
  });
}

// ---- geometry ----------------------------------------------------------------

export function segmentLength(segment: SegmentEndpoints): number {
  return Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
}

/** The segment's endpoints as two points, for the maths modules. */
export function segmentPoints(segment: SegmentEndpoints): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: segment.x1, y: segment.y1 },
    { x: segment.x2, y: segment.y2 },
  ];
}

/** Whether the segment blocks: a wall always, a door while it is closed. */
export function isBlocking(segment: WallSegment): boolean {
  return segment.kind === "wall" || !segment.open;
}

export function isDoor(segment: WallSegment): segment is DoorSegment {
  return segment.kind === "door";
}

export function doorsOf(walls: readonly WallSegment[]): DoorSegment[] {
  return walls.filter(isDoor);
}

/** The doors currently open (T103): what both windows report as `data-doors-open`. */
export function openDoorsOf(walls: readonly WallSegment[]): DoorSegment[] {
  return walls.filter((w): w is DoorSegment => isDoor(w) && w.open);
}

// ---- construction --------------------------------------------------------------

export interface NewWallOptions extends SegmentEndpoints {
  id: string;
}

export function createWall({ id, x1, y1, x2, y2 }: NewWallOptions): PlainWallSegment {
  return { id, kind: "wall", x1, y1, x2, y2 };
}

export interface NewDoorOptions extends NewWallOptions {
  open?: boolean;
  /** Normalized through `normalizeDoorName`; blank means unnamed. */
  name?: string;
}

export function createDoor({ id, x1, y1, x2, y2, open = false, name }: NewDoorOptions): DoorSegment {
  const door: DoorSegment = { id, kind: "door", x1, y1, x2, y2, open };
  const normalized = name === undefined ? undefined : normalizeDoorName(name);
  return normalized === undefined ? door : { ...door, name: normalized };
}

/** What the canvas and the Doors list call a door: its name, else `fallback`. */
export function doorDisplayName(door: DoorSegment, fallback: string): string {
  return door.name ?? fallback;
}

export function cloneWall(segment: WallSegment): WallSegment {
  return { ...segment };
}

/** Field-by-field equality (kind, endpoints, and `open` and `name` for doors). */
export function wallsEqual(a: WallSegment, b: WallSegment): boolean {
  if (a.id !== b.id || a.kind !== b.kind) return false;
  if (a.x1 !== b.x1 || a.y1 !== b.y1 || a.x2 !== b.x2 || a.y2 !== b.y2) return false;
  return a.kind === "door" && b.kind === "door" ? a.open === b.open && a.name === b.name : true;
}

/** Equality of whole lists, in order. */
export function wallListsEqual(a: readonly WallSegment[], b: readonly WallSegment[]): boolean {
  return a.length === b.length && a.every((w, i) => wallsEqual(w, b[i]));
}

/**
 * The segment with `patch` applied; the same object when nothing changes.
 * Turning a door into a wall drops `open` and `name`; turning a wall into a
 * door gives it `open` (the patch's, else closed). A door keeps its name
 * unless the patch sets one (normalized; blank or `null` removes it).
 */
export function patchWall(segment: WallSegment, patch: WallPatch): WallSegment {
  const kind = patch.kind ?? segment.kind;
  const endpoints: SegmentEndpoints = {
    x1: patch.x1 ?? segment.x1,
    y1: patch.y1 ?? segment.y1,
    x2: patch.x2 ?? segment.x2,
    y2: patch.y2 ?? segment.y2,
  };
  const previousName = segment.kind === "door" ? segment.name : undefined;
  const name =
    patch.name === undefined ? previousName : patch.name === null ? undefined : normalizeDoorName(patch.name);
  const next: WallSegment =
    kind === "door"
      ? {
          id: segment.id,
          kind: "door",
          ...endpoints,
          open: patch.open ?? (segment.kind === "door" ? segment.open : false),
          ...(name === undefined ? {} : { name }),
        }
      : { id: segment.id, kind: "wall", ...endpoints };
  return wallsEqual(segment, next) ? segment : next;
}

/**
 * The segment as the player window may know it (ADR 0030): a door without
 * its DM-given name. The same object when there is nothing to strip.
 */
export function wallForPlayer(segment: WallSegment): WallSegment {
  if (segment.kind !== "door" || segment.name === undefined) return segment;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the field
  const { name, ...rest } = segment;
  return rest;
}

export function findWall(
  scene: { walls: readonly WallSegment[] } | undefined,
  id: string
): WallSegment | undefined {
  return scene?.walls.find((w) => w.id === id);
}
