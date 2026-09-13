/**
 * Walls and doors (T101, ADR 0024): the segment guards, the patch guard,
 * length, equality, patching and the small helpers.
 */
import {
  cloneWall,
  createDoor,
  createWall,
  doorsOf,
  findWall,
  isBlocking,
  isDoor,
  isWallKind,
  isWallPatch,
  isWallSegment,
  patchWall,
  segmentLength,
  segmentPoints,
  WALL_KINDS,
  wallListsEqual,
  wallsEqual,
  type WallSegment,
} from "./walls";

const wall: WallSegment = { id: "w1", kind: "wall", x1: 10, y1: 20, x2: 40, y2: 60 };
const closedDoor: WallSegment = { id: "d1", kind: "door", x1: 0, y1: 0, x2: 30, y2: 0, open: false };
const openDoor: WallSegment = { id: "d2", kind: "door", x1: 5, y1: 5, x2: 5, y2: 55, open: true };

/** The object without one key (a plain record, as unknown input would be). */
const without = (value: object, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

describe("wall guards", () => {
  it("knows the two kinds", () => {
    expect(WALL_KINDS).toEqual(["wall", "door"]);
    expect(isWallKind("wall")).toBe(true);
    expect(isWallKind("door")).toBe(true);
    expect(isWallKind("window")).toBe(false);
    expect(isWallKind(undefined)).toBe(false);
  });

  it("accepts well-formed walls and doors", () => {
    expect(isWallSegment(wall)).toBe(true);
    expect(isWallSegment(closedDoor)).toBe(true);
    expect(isWallSegment(openDoor)).toBe(true);
    // Any angle, any length, negative and fractional coordinates.
    expect(isWallSegment({ id: "w", kind: "wall", x1: -1.5, y1: 2.25, x2: -1.5, y2: 2.25 })).toBe(true);
  });

  it("rejects missing or malformed fields, an empty id and unknown kinds", () => {
    expect(isWallSegment(null)).toBe(false);
    expect(isWallSegment([])).toBe(false);
    expect(isWallSegment({ ...wall, id: "" })).toBe(false);
    expect(isWallSegment({ ...wall, id: 7 })).toBe(false);
    expect(isWallSegment({ ...wall, kind: "fence" })).toBe(false);
    for (const field of ["x1", "y1", "x2", "y2"] as const) {
      expect(isWallSegment({ ...wall, [field]: NaN }), field).toBe(false);
      expect(isWallSegment({ ...wall, [field]: "3" }), field).toBe(false);
      expect(isWallSegment(without(wall, field)), field).toBe(false);
    }
    // A door needs its `open` flag, as a boolean.
    expect(isWallSegment(without(closedDoor, "open"))).toBe(false);
    expect(isWallSegment({ ...closedDoor, open: "no" })).toBe(false);
    expect(isWallSegment({ ...closedDoor, open: 0 })).toBe(false);
    // A wall may carry `open` (ignored), but it is not what makes it a door.
    expect(isWallSegment({ ...wall, open: true })).toBe(true);
  });

  it("isWallPatch accepts only known fields, each well-formed; an empty patch is fine", () => {
    expect(isWallPatch({})).toBe(true);
    expect(isWallPatch({ x1: 1 })).toBe(true);
    expect(isWallPatch({ x1: 1, y1: 2, x2: 3, y2: 4, kind: "door", open: true })).toBe(true);
    expect(isWallPatch({ open: false })).toBe(true);
    expect(isWallPatch({ x1: NaN })).toBe(false);
    expect(isWallPatch({ x1: "1" })).toBe(false);
    expect(isWallPatch({ kind: "fence" })).toBe(false);
    expect(isWallPatch({ open: "yes" })).toBe(false);
    expect(isWallPatch({ id: "w" })).toBe(false);
    expect(isWallPatch({ colour: "#fff" })).toBe(false);
    expect(isWallPatch(null)).toBe(false);
    expect(isWallPatch("x")).toBe(false);
  });
});

describe("segment geometry", () => {
  it("segmentLength is the Euclidean distance between the endpoints", () => {
    expect(segmentLength(wall)).toBe(50);
    expect(segmentLength(closedDoor)).toBe(30);
    expect(segmentLength({ x1: 3, y1: 3, x2: 3, y2: 3 })).toBe(0);
    expect(segmentLength({ x1: 0, y1: 0, x2: -3, y2: -4 })).toBe(5);
  });

  it("segmentPoints gives the two endpoints in order", () => {
    expect(segmentPoints(wall)).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 60 },
    ]);
  });

  it("a wall always blocks, a door only while closed", () => {
    expect(isBlocking(wall)).toBe(true);
    expect(isBlocking(closedDoor)).toBe(true);
    expect(isBlocking(openDoor)).toBe(false);
    expect(isDoor(wall)).toBe(false);
    expect(isDoor(closedDoor)).toBe(true);
    expect(doorsOf([wall, closedDoor, openDoor])).toEqual([closedDoor, openDoor]);
  });
});

describe("construction and equality", () => {
  it("createWall / createDoor build segments; a door is closed unless asked", () => {
    expect(createWall({ id: "w", x1: 1, y1: 2, x2: 3, y2: 4 })).toEqual({ id: "w", kind: "wall", x1: 1, y1: 2, x2: 3, y2: 4 });
    expect(createDoor({ id: "d", x1: 1, y1: 2, x2: 3, y2: 4 })).toEqual({ id: "d", kind: "door", x1: 1, y1: 2, x2: 3, y2: 4, open: false });
    expect(createDoor({ id: "d", x1: 1, y1: 2, x2: 3, y2: 4, open: true }).open).toBe(true);
  });

  it("cloneWall is a fresh, equal object", () => {
    const copy = cloneWall(openDoor);
    expect(copy).toEqual(openDoor);
    expect(copy).not.toBe(openDoor);
  });

  it("wallsEqual compares id, kind, endpoints and a door's open flag", () => {
    expect(wallsEqual(wall, { ...wall })).toBe(true);
    expect(wallsEqual(wall, { ...wall, id: "other" })).toBe(false);
    expect(wallsEqual(wall, { ...wall, x2: 41 })).toBe(false);
    expect(wallsEqual(wall, { ...wall, y1: 21 })).toBe(false);
    expect(wallsEqual(closedDoor, { ...closedDoor })).toBe(true);
    expect(wallsEqual(closedDoor, { ...closedDoor, open: true })).toBe(false);
    // Same endpoints, different kind.
    expect(wallsEqual(wall, { id: "w1", kind: "door", x1: 10, y1: 20, x2: 40, y2: 60, open: false })).toBe(false);
    // The endpoints' order matters: a segment is directed as stored.
    expect(wallsEqual(wall, { ...wall, x1: 40, y1: 60, x2: 10, y2: 20 })).toBe(false);
  });

  it("wallListsEqual compares whole lists in order", () => {
    expect(wallListsEqual([wall, closedDoor], [{ ...wall }, { ...closedDoor }])).toBe(true);
    expect(wallListsEqual([wall, closedDoor], [closedDoor, wall])).toBe(false);
    expect(wallListsEqual([wall], [wall, closedDoor])).toBe(false);
    expect(wallListsEqual([], [])).toBe(true);
  });

  it("findWall looks a segment up by id, tolerating no scene", () => {
    const scene = { walls: [wall, closedDoor] };
    expect(findWall(scene, "d1")).toBe(closedDoor);
    expect(findWall(scene, "nope")).toBeUndefined();
    expect(findWall(undefined, "w1")).toBeUndefined();
  });
});

describe("patchWall", () => {
  it("moves endpoints and flips doors, returning the same object when nothing changes", () => {
    expect(patchWall(wall, {})).toBe(wall);
    expect(patchWall(wall, { x1: 10, y2: 60 })).toBe(wall);
    expect(patchWall(wall, { x2: 45 })).toEqual({ ...wall, x2: 45 });
    expect(patchWall(closedDoor, { open: true })).toEqual({ ...closedDoor, open: true });
    expect(patchWall(closedDoor, { open: false })).toBe(closedDoor);
    // The original is untouched.
    expect(wall.x2).toBe(40);
  });

  it("changing the kind adds or drops the door flag", () => {
    expect(patchWall(wall, { kind: "door" })).toEqual({ id: "w1", kind: "door", x1: 10, y1: 20, x2: 40, y2: 60, open: false });
    expect(patchWall(wall, { kind: "door", open: true })).toMatchObject({ kind: "door", open: true });
    const asWall = patchWall(openDoor, { kind: "wall" });
    expect(asWall).toEqual({ id: "d2", kind: "wall", x1: 5, y1: 5, x2: 5, y2: 55 });
    expect("open" in asWall).toBe(false);
    // `open` on a wall that stays a wall is ignored.
    expect(patchWall(wall, { open: true })).toBe(wall);
  });
});
