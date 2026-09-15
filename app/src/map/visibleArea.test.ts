// @vitest-environment node
/**
 * What the tokens see right now (T107): one polygon per seeing token, doors,
 * no seeing tokens, the dim rule, what the memo keys on, and a drag frame on
 * a 400-segment map.
 */
import { fogFill } from "../state/fog";
import { createBlankMapScene } from "../state/maps";
import type { MapScene, Token } from "../state/model";
import { createToken } from "../state/tokens";
import { tokenVisionPolygon } from "../state/vision";
import { createDoor, createWall, type WallSegment } from "../state/walls";
import {
  createVisiblePolygonsMemo,
  dimActive,
  NO_VISIBLE_POLYGONS,
  visiblePolygons,
} from "./visibleArea";

const disc = { type: "disc" as const, color: "#f00" };

/** A 500 × 400 map of 50 px cells, cut at x = 250 by two walls with a closed door between them (y 150–250). */
function scene(tokens: Token[] = []): MapScene {
  return {
    ...createBlankMapScene({ id: "m", columns: 10, rows: 8, cellSize: 50 }),
    walls: [
      createWall({ id: "top", x1: 250, y1: 0, x2: 250, y2: 150 }),
      createDoor({ id: "door", x1: 250, y1: 150, x2: 250, y2: 250 }),
      createWall({ id: "bottom", x1: 250, y1: 250, x2: 250, y2: 400 }),
    ],
    tokens,
  };
}

/** Vision 6 (300 px) from (125, 200), level with the doorway. */
const seer = createToken({ id: "seer", x: 100, y: 175, appearance: disc, vision: 6 });

const xsOf = (points: readonly number[]) => points.filter((_, i) => i % 2 === 0);
const openDoors = (walls: readonly WallSegment[]): WallSegment[] =>
  walls.map((w) => (w.kind === "door" ? { ...w, open: true } : w));

describe("visiblePolygons", () => {
  it("is empty without a seeing token: no tokens, blind tokens, or a seeing token that sees nothing", () => {
    expect(visiblePolygons(scene())).toBe(NO_VISIBLE_POLYGONS);
    expect(visiblePolygons(scene([{ ...seer, vision: 0 }]))).toBe(NO_VISIBLE_POLYGONS);
    // Off the map: its polygon is empty, so it adds none.
    expect(visiblePolygons(scene([{ ...seer, x: 900, y: 900 }]))).toBe(NO_VISIBLE_POLYGONS);
  });

  it("is each seeing token's vision polygon, hidden ones included, in document order", () => {
    const scout = createToken({ id: "scout", x: 350, y: 50, appearance: disc, vision: 2, hidden: true });
    const blind = createToken({ id: "blind", x: 0, y: 0, appearance: disc });
    const s = scene([scout, blind, seer]);
    const polygons = visiblePolygons(s);
    expect(polygons).toEqual([tokenVisionPolygon(s, scout), tokenVisionPolygon(s, seer)]);
    expect(polygons[0].length).toBeGreaterThanOrEqual(6);
  });

  it("a closed door blocks like a wall; an open one is no segment at all", () => {
    const closed = scene([seer]);
    const [shut] = visiblePolygons(closed);
    expect(Math.max(...xsOf(shut))).toBeLessThanOrEqual(250 + 1e-6);

    const opened = { ...closed, walls: openDoors(closed.walls) };
    const [wide] = visiblePolygons(opened);
    expect(Math.max(...xsOf(wide))).toBeGreaterThan(400); // through the doorway, to the radius
    const doorless = { ...closed, walls: closed.walls.filter((w) => w.kind !== "door") };
    expect(wide).toEqual(visiblePolygons(doorless)[0]);
  });
});

describe("dimActive", () => {
  it("is T105's rule: auto dims while any token sees (hidden ones too), on and off force it", () => {
    expect(dimActive(scene())).toBe(false);
    expect(dimActive(scene([{ ...seer, vision: 0 }]))).toBe(false);
    expect(dimActive(scene([seer]))).toBe(true);
    expect(dimActive(scene([{ ...seer, hidden: true }]))).toBe(true);
    expect(dimActive({ ...scene([seer]), visionDim: "off" })).toBe(false);
    expect(dimActive({ ...scene(), visionDim: "on" })).toBe(true);
  });
});

describe("createVisiblePolygonsMemo", () => {
  function memo() {
    const compute = vi.fn(visiblePolygons);
    return { visible: createVisiblePolygonsMemo(compute), compute };
  }

  it("hands back the same result through changes that cannot move what a token sees", () => {
    const { visible, compute } = memo();
    const blind = createToken({ id: "blind", x: 0, y: 0, appearance: disc });
    const base = scene([seer, blind]);
    const first = visible(base);
    expect(first).toEqual(visiblePolygons(base));
    expect(first).toHaveLength(1);
    expect(compute).toHaveBeenCalledTimes(1);

    const unchanged: MapScene[] = [
      // A fog op: a new scene object sharing the walls and the tokens.
      { ...base, fogOps: [fogFill("reveal")], fogOpsFrom: 4 },
      // The seeing token renamed and hidden, the blind one moved, then removed.
      { ...base, tokens: [{ ...seer, name: "Scout", hidden: true }, { ...blind, x: 300 }] },
      { ...base, tokens: [seer] },
      // Equal walls in new arrays (a snapshot), an open door added, the grid's offset and the dim setting.
      { ...base, walls: base.walls.map((w) => ({ ...w })) },
      { ...base, walls: [...base.walls, createDoor({ id: "d2", x1: 0, y1: 0, x2: 50, y2: 0, open: true })] },
      { ...base, grid: { ...base.grid, offsetX: 7 } },
      { ...base, visionDim: "on" },
    ];
    for (const next of unchanged) expect(visible(next)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes once for each change that may: a seeing token moved, resized, re-sighted or added; a door opened; a wall added; the cells or the map resized", () => {
    const { visible, compute } = memo();
    let current = scene([seer]);
    let last = visible(current);
    const steps: ((s: MapScene) => MapScene)[] = [
      (s) => ({ ...s, tokens: [{ ...s.tokens[0], x: 150 }] }),
      (s) => ({ ...s, tokens: [{ ...s.tokens[0], size: 2 }] }),
      (s) => ({ ...s, tokens: [{ ...s.tokens[0], vision: 3 }] }),
      (s) => ({ ...s, tokens: [...s.tokens, createToken({ id: "two", x: 400, y: 50, appearance: disc, vision: 1 })] }),
      (s) => ({ ...s, walls: openDoors(s.walls) }),
      (s) => ({ ...s, walls: [...s.walls, createWall({ id: "w2", x1: 0, y1: 300, x2: 200, y2: 300 })] }),
      (s) => ({ ...s, grid: { ...s.grid, cellSize: 40 } }),
      (s) => ({ ...s, width: 450 }),
    ];
    steps.forEach((step, i) => {
      current = step(current);
      const next = visible(current);
      expect(next).not.toBe(last);
      expect(next).toEqual(visiblePolygons(current));
      expect(compute).toHaveBeenCalledTimes(i + 2);
      // Asked again with nothing changed: no work.
      expect(visible({ ...current })).toBe(next);
      expect(compute).toHaveBeenCalledTimes(i + 2);
      last = next;
    });
  });

  it("drops to no polygons when the last token stops seeing, and back", () => {
    const { visible } = memo();
    const s = scene([seer]);
    expect(visible(s)).toHaveLength(1);
    expect(visible({ ...s, tokens: [{ ...seer, vision: 0 }] })).toBe(NO_VISIBLE_POLYGONS);
    expect(visible(s)).toEqual(visiblePolygons(s));
  });
});

describe("a drag on a 400-segment map", () => {
  /** A small deterministic generator, so the walls are the same on every run. */
  function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  }

  /** 58 × 58 cells of 70 px (4060 px), 400 walls of 20–100 px scattered round a token with vision 12. */
  function busyMap(): MapScene {
    const next = random(107);
    const centre = 2030;
    const radius = 12 * 70;
    const walls = Array.from({ length: 400 }, (_, i) => {
      const angle = next() * 2 * Math.PI;
      const distance = 40 + next() * (radius - 100);
      const cx = centre + Math.cos(angle) * distance;
      const cy = centre + Math.sin(angle) * distance;
      const heading = next() * Math.PI;
      const half = 10 + next() * 40;
      return createWall({
        id: `w${i}`,
        x1: cx - Math.cos(heading) * half,
        y1: cy - Math.sin(heading) * half,
        x2: cx + Math.cos(heading) * half,
        y2: cy + Math.sin(heading) * half,
      });
    });
    const token = createToken({ id: "seer", x: centre - 35, y: centre - 35, appearance: disc, vision: 12 });
    return { ...createBlankMapScene({ id: "busy", columns: 58, rows: 58, cellSize: 70 }), walls, tokens: [token] };
  }

  it("each frame computes the preview and reuses the overlay: well inside a 60 Hz frame, the overlay computed once until the drop", () => {
    const map = busyMap();
    const { visible, compute } = (() => {
      const spy = vi.fn(visiblePolygons);
      return { visible: createVisiblePolygonsMemo(spy), compute: spy };
    })();
    expect(visible(map)[0].length).toBeGreaterThan(400 * 2);
    const token = map.tokens[0];

    const frames: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      // The store is untouched while dragging: every re-render passes a scene equal to the last.
      const rendered = frame % 2 === 0 ? map : { ...map };
      const started = performance.now();
      const preview = tokenVisionPolygon(map, { ...token, x: token.x + (frame % 10) * 7 });
      const overlay = visible(rendered);
      frames.push(performance.now() - started);
      expect(preview.length).toBeGreaterThanOrEqual(6);
      expect(overlay).toHaveLength(1);
    }
    expect(compute).toHaveBeenCalledTimes(1);
    frames.sort((a, b) => a - b);
    expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(16);

    // The drop moves the token in the store: one recompute, then a fog op reuses it.
    const dropped: MapScene = { ...map, tokens: [{ ...token, x: token.x + 70 }] };
    const started = performance.now();
    const after = visible(dropped);
    expect(performance.now() - started).toBeLessThan(50);
    const revealed: MapScene = { ...dropped, fogOps: [fogFill("reveal")] };
    expect(visible(revealed)).toBe(after);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("visibleArea.ts source", () => {
  const source = Object.values(
    import.meta.glob<string>("./visibleArea.ts", { query: "?raw", import: "default", eager: true })
  )[0];

  it("imports only pure modules and uses no any", () => {
    expect(source).toBeTruthy();
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../state/model", "../state/vision", "./visibility"]);
    expect(source).not.toMatch(/\b(window|navigator|HTMLCanvasElement|OffscreenCanvas|Konva|react-konva)\b/);
    expect(source).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
  });
});
