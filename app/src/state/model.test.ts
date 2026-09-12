import {
  defaultGridSettings,
  isAnnotation,
  isGridSettings,
  isMapScene,
  isToken,
  SCHEMA_VERSION,
  type Annotation,
  type MapScene,
  type Token,
} from "./model";

const token: Token = {
  id: "t1",
  name: "Goblin",
  appearance: { type: "disc", color: "#0f0" },
  badge: "1",
  x: 70,
  y: 140,
  size: 1,
  snapToGrid: true,
  hidden: false,
};

const note: Annotation = {
  id: "a1",
  kind: "note",
  x: 10,
  y: 10,
  text: "Trap here",
  visibility: "dm",
};

const drawing: Annotation = {
  id: "a2",
  kind: "drawing",
  points: [0, 0, 10, 10, 20, 5],
  color: "#f00",
  strokeWidth: 3,
  visibility: "all",
};

const scene: MapScene = {
  id: "m1",
  name: "Crypt",
  imageAssetId: "asset-1",
  backgroundColor: "#000000",
  width: 2000,
  height: 1500,
  grid: defaultGridSettings(),
  fogMaskAssetId: null,
  tokens: [token, { ...token, id: "t2", appearance: { type: "image", assetId: "img" } }],
  annotations: [note, drawing],
};

describe("data model", () => {
  it("has a positive integer schema version", () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("default grid settings validate, with one style per view", () => {
    const grid = defaultGridSettings();
    expect(isGridSettings(grid)).toBe(true);
    expect(grid.dm).toEqual(grid.player);
    expect(grid.dm).not.toBe(grid.player);
    expect(isGridSettings({ ...grid, cellSize: 0 })).toBe(false);
    expect(isGridSettings({ ...grid, dm: { ...grid.dm, opacity: "1" } })).toBe(false);
    expect(isGridSettings({ ...grid, player: { ...grid.player, opacity: 1.5 } })).toBe(false);
    expect(isGridSettings({ ...grid, player: undefined })).toBe(false);
    // The pre-v3 flat shape is not accepted at the current version.
    expect(
      isGridSettings({ cellSize: 70, offsetX: 0, offsetY: 0, visible: true, color: "#fff", opacity: 0.3 })
    ).toBe(false);
  });

  it("accepts well-formed tokens and rejects bad sizes/appearances", () => {
    expect(isToken(token)).toBe(true);
    expect(isToken({ ...token, size: 5 })).toBe(false);
    expect(isToken({ ...token, appearance: { type: "image" } })).toBe(false);
    expect(isToken({ ...token, x: NaN })).toBe(false);
    expect(isToken({ ...token, id: "" })).toBe(false);
  });

  it("accepts both annotation kinds and rejects unknown ones", () => {
    expect(isAnnotation(note)).toBe(true);
    expect(isAnnotation(drawing)).toBe(true);
    expect(isAnnotation({ ...note, visibility: "all" })).toBe(false);
    expect(isAnnotation({ ...drawing, points: [1, "2"] })).toBe(false);
    expect(isAnnotation({ id: "x", kind: "arrow" })).toBe(false);
  });

  it("validates a full scene, including nested tokens and annotations", () => {
    expect(isMapScene(scene)).toBe(true);
    expect(isMapScene({ ...scene, imageAssetId: null })).toBe(true);
    expect(isMapScene({ ...scene, imageAssetId: "" })).toBe(false);
    expect(isMapScene({ ...scene, tokens: [{ id: "t" }] })).toBe(false);
    expect(isMapScene({ ...scene, annotations: "none" })).toBe(false);
    expect(isMapScene({ ...scene, grid: {} })).toBe(false);
    expect(isMapScene({ ...scene, backgroundColor: undefined })).toBe(false);
    expect(isMapScene({ ...scene, width: 0 })).toBe(false);
  });

  it("scenes reference binary assets by id only", () => {
    // No property of a scene may hold a Blob: images live in the assets table.
    const holdsBlob = (value: unknown): boolean =>
      value instanceof Blob ||
      (typeof value === "object" &&
        value !== null &&
        Object.values(value).some(holdsBlob));
    expect(holdsBlob(scene)).toBe(false);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });
});
