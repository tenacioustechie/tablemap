import {
  activeMap,
  assetIdsForPlayer,
  createBlankMapScene,
  createImageMapScene,
  DEFAULT_BLANK_MAP_COLOR,
  duplicateMapScene,
  findMap,
  referencedAssetIds,
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
      grid: defaultGridSettings(),
      fogMaskAssetId: null,
      tokens: [],
      annotations: [],
    });
    expect(isMapScene(scene)).toBe(true);
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
      },
    ],
    annotations: [
      { id: "d", kind: "drawing", points: [0, 0, 1, 1], color: "#f00", strokeWidth: 2, visibility: "all" },
    ],
  };

  it("copies everything under a new id and name, sharing the image asset", () => {
    const copy = duplicateMapScene(original, { id: "c" });
    expect(copy.id).toBe("c");
    expect(copy.name).toBe("Orig (copy)");
    expect(copy.imageAssetId).toBe("img");
    expect(copy.fogMaskAssetId).toBeNull();
    expect(copy.tokens).toEqual(original.tokens);
    expect(copy.annotations).toEqual(original.annotations);
    expect(isMapScene(copy)).toBe(true);
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
        { id: "t", name: "", appearance: { type: "image", assetId: "tok" }, badge: "", x: 0, y: 0, size: 1, snapToGrid: false, hidden: false },
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

  it("referencedAssetIds deduplicates across maps", () => {
    expect([...referencedAssetIds(state)].sort()).toEqual(["fog-a", "img-a", "tok"]);
    expect(referencedAssetIds(initialSharedState()).size).toBe(0);
  });

  it("assetIdsForPlayer puts the active map first, then the rest, without repeats", () => {
    expect(assetIdsForPlayer(state)).toEqual(["img-a", "tok", "fog-a"]);
    expect(assetIdsForPlayer({ ...state, activeMapId: null })).toEqual(["img-a", "fog-a", "tok"]);
  });
});
