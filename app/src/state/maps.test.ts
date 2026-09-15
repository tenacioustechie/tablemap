import {
  activeMap,
  assetIdsForPlayer,
  createBlankMapScene,
  createImageMapScene,
  DEFAULT_BLANK_MAP_COLOR,
  duplicateMapScene,
  findMap,
  referencedAssetIds,
  remapAssetIds,
  sceneAssetIds,
} from "./maps";
import { defaultGridSettings, isMapScene, type MapScene } from "./model";
import { initialSharedState, type SharedState } from "./shared";

describe("scene constructors", () => {
  it("createImageMapScene builds a fully fogged, empty scene of the image's size", () => {
    const scene = createImageMapScene({
      id: "m1",
      name: "Crypt",
      imageAssetId: "img",
      width: 1920,
      height: 1080,
    });
    expect(scene).toEqual({
      id: "m1",
      name: "Crypt",
      imageAssetId: "img",
      backgroundColor: "#000000",
      width: 1920,
      height: 1080,
      imageRotation: 0,
      grid: defaultGridSettings(),
      fogMaskAssetId: null,
      fogOps: [],
      fogOpsFrom: 0,
      tokens: [],
      annotations: [],
      walls: [],
      visionDim: "auto",
    });
    expect(isMapScene(scene)).toBe(true);
    // Fully fogged: no base and nothing revealed; vision dims by the tokens (T105).
    expect(createBlankMapScene({ columns: 2, rows: 2 })).toMatchObject({
      fogMaskAssetId: null,
      fogOps: [],
      fogOpsFrom: 0,
      visionDim: "auto",
    });
    expect(createImageMapScene({ name: "a", imageAssetId: "i", width: 1, height: 1 }).id).not.toBe(
      createImageMapScene({ name: "a", imageAssetId: "i", width: 1, height: 1 }).id
    );
  });

  it("createBlankMapScene sizes the map from cells and matches the grid to it", () => {
    const scene = createBlankMapScene({
      id: "b",
      columns: 30,
      rows: 20,
      cellSize: 50,
      color: "#123456",
    });
    expect(scene.imageAssetId).toBeNull();
    expect(scene.width).toBe(1500);
    expect(scene.height).toBe(1000);
    expect(scene.backgroundColor).toBe("#123456");
    expect(scene.grid).toMatchObject({
      cellSize: 50,
      offsetX: 0,
      offsetY: 0,
      dm: { visible: true },
      player: { visible: true },
    });
    expect(scene.name).toBe("Blank map");
    expect(isMapScene(scene)).toBe(true);
  });

  it("createBlankMapScene applies defaults and clamps nonsense sizes", () => {
    const scene = createBlankMapScene({ columns: 0.4, rows: -3 });
    expect(scene.width).toBe(defaultGridSettings().cellSize);
    expect(scene.height).toBe(defaultGridSettings().cellSize);
    expect(scene.backgroundColor).toBe(DEFAULT_BLANK_MAP_COLOR);
    expect(isMapScene(scene)).toBe(true);
  });
});

describe("duplicateMapScene", () => {
  const original: MapScene = {
    ...createImageMapScene({ id: "o", name: "Orig", imageAssetId: "img", width: 10, height: 10 }),
    fogMaskAssetId: "fog-o",
    tokens: [
      {
        id: "t",
        name: "Goblin",
        appearance: { type: "disc", color: "#0f0" },
        badge: "1",
        x: 0,
        y: 0,
        size: 1,
        snapToGrid: true,
        hidden: false,
        vision: 4,
      },
    ],
    annotations: [
      { id: "d", kind: "drawing", points: [0, 0, 1, 1], color: "#f00", strokeWidth: 2, visibility: "all" },
    ],
    walls: [
      { id: "w", kind: "wall", x1: 0, y1: 0, x2: 50, y2: 0 },
      { id: "door", kind: "door", x1: 50, y1: 0, x2: 80, y2: 0, open: true },
    ],
    visionDim: "off",
  };

  it("copies everything under a new id and name, sharing the image asset", () => {
    const copy = duplicateMapScene(original, { id: "c" });
    expect(copy.id).toBe("c");
    expect(copy.name).toBe("Orig (copy)");
    expect(copy.imageAssetId).toBe("img");
    expect(copy.fogMaskAssetId).toBeNull();
    expect(copy.tokens).toEqual(original.tokens);
    expect(copy.annotations).toEqual(original.annotations);
    // Walls (T101) are copied, not shared.
    expect(copy.walls).toEqual(original.walls);
    expect(copy.walls).not.toBe(original.walls);
    expect(copy.walls[0]).not.toBe(original.walls[0]);
    // So are the vision fields (T105).
    expect(copy.visionDim).toBe("off");
    expect(copy.tokens[0].vision).toBe(4);
    expect(isMapScene(copy)).toBe(true);
  });

  it("copies the fog op log and history index, without sharing the op objects", () => {
    const fogged: MapScene = {
      ...original,
      fogOps: [
        { type: "shape", mode: "reveal", shape: { kind: "polygon", points: [0, 0, 5, 0, 5, 5] } },
        { type: "fill", mode: "hide" },
      ],
      fogOpsFrom: 7,
    };
    const copy = duplicateMapScene(fogged, { id: "c" });
    expect(copy.fogOps).toEqual(fogged.fogOps);
    expect(copy.fogOpsFrom).toBe(7);
    expect(copy.fogOps[0]).not.toBe(fogged.fogOps[0]);
    const shape = copy.fogOps[0].type === "shape" ? copy.fogOps[0].shape : null;
    const originalShape = fogged.fogOps[0].type === "shape" ? fogged.fogOps[0].shape : null;
    expect(shape && shape.kind === "polygon" && shape.points).not.toBe(
      originalShape && originalShape.kind === "polygon" && originalShape.points
    );
  });

  it("is a deep copy: nested objects are not shared", () => {
    const copy = duplicateMapScene(original, { id: "c", fogMaskAssetId: "fog-c" });
    expect(copy.fogMaskAssetId).toBe("fog-c");
    expect(copy.grid).not.toBe(original.grid);
    expect(copy.tokens[0]).not.toBe(original.tokens[0]);
    expect(copy.tokens[0].appearance).not.toBe(original.tokens[0].appearance);
    const drawing = copy.annotations[0];
    expect(drawing.kind === "drawing" && drawing.points).not.toBe(
      original.annotations[0].kind === "drawing" && original.annotations[0].points
    );
  });
});

describe("asset bookkeeping", () => {
  const scene = (id: string, image: string | null, fog: string | null = null): MapScene => ({
    ...createImageMapScene({ id, name: id, imageAssetId: image ?? "x", width: 1, height: 1 }),
    imageAssetId: image,
    fogMaskAssetId: fog,
  });
  const state: SharedState = {
    ...initialSharedState(),
    maps: [
      scene("a", "img-a", "fog-a"),
      scene("b", null),
      { ...scene("c", "img-a"), tokens: [
        { id: "t", name: "", appearance: { type: "image", assetId: "tok" }, badge: "", x: 0, y: 0, size: 1, snapToGrid: false, hidden: false, vision: 0 },
      ] },
    ],
    activeMapId: "c",
  };

  it("findMap / activeMap", () => {
    expect(findMap(state, "b")?.id).toBe("b");
    expect(findMap(state, "zzz")).toBeUndefined();
    expect(findMap(state, null)).toBeUndefined();
    expect(activeMap(state)?.id).toBe("c");
    expect(activeMap({ ...state, activeMapId: null })).toBeUndefined();
  });

  it("sceneAssetIds lists image, fog mask and token images", () => {
    expect(sceneAssetIds(state.maps[0])).toEqual(["img-a", "fog-a"]);
    expect(sceneAssetIds(state.maps[1])).toEqual([]);
    expect(sceneAssetIds(state.maps[2])).toEqual(["img-a", "tok"]);
  });

  it("referencedAssetIds deduplicates across maps and includes the splash image", () => {
    expect([...referencedAssetIds(state)].sort()).toEqual(["fog-a", "img-a", "tok"]);
    expect(referencedAssetIds(initialSharedState()).size).toBe(0);
    expect([...referencedAssetIds({ ...state, splashImageAssetId: "splash" })].sort()).toEqual([
      "fog-a",
      "img-a",
      "splash",
      "tok",
    ]);
  });

  it("assetIdsForPlayer puts the active map first, then the splash image, then the rest, without repeats", () => {
    expect(assetIdsForPlayer(state)).toEqual(["img-a", "tok", "fog-a"]);
    expect(assetIdsForPlayer({ ...state, activeMapId: null })).toEqual(["img-a", "fog-a", "tok"]);
    expect(assetIdsForPlayer({ ...state, splashImageAssetId: "splash" })).toEqual([
      "img-a",
      "tok",
      "splash",
      "fog-a",
    ]);
    expect(assetIdsForPlayer({ ...state, splashImageAssetId: "img-a" })).toEqual(["img-a", "tok", "fog-a"]);
  });

  it("remapAssetIds rewrites every reference in the mapping and keeps the rest (T012)", () => {
    const withSplash: SharedState = { ...state, splashImageAssetId: "splash" };
    const mapping = new Map([
      ["img-a", "img-z"],
      ["tok", "tok-z"],
      ["splash", "splash-z"],
    ]);
    const remapped = remapAssetIds(withSplash, mapping);
    expect(remapped.maps[0].imageAssetId).toBe("img-z");
    expect(remapped.maps[0].fogMaskAssetId).toBe("fog-a");
    expect(remapped.maps[1].imageAssetId).toBeNull();
    expect(remapped.maps[2].imageAssetId).toBe("img-z");
    expect(remapped.maps[2].tokens.map((t) => t.appearance)).toEqual([
      { type: "image", assetId: "tok-z" },
    ]);
    expect(remapped.splashImageAssetId).toBe("splash-z");
    expect([...referencedAssetIds(remapped)].sort()).toEqual(["fog-a", "img-z", "splash-z", "tok-z"]);
    // Everything else is unchanged, and the input was not mutated.
    expect(remapAssetIds(remapped, new Map([["img-z", "img-a"], ["tok-z", "tok"], ["splash-z", "splash"]]))).toEqual(withSplash);
    expect(withSplash.maps[0].imageAssetId).toBe("img-a");
    expect(remapAssetIds(withSplash, new Map())).toEqual(withSplash);
  });
});
