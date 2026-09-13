/**
 * Map rotation (T017, ADR 0021) in real Chromium: the DM turns a map a
 * quarter turn and the image, grid, fog and everything else on it turn
 * together on both windows, with the base fog mask baked turned on a real
 * canvas; undo keeps working on the turned log and redo is cleared; the
 * player view's own TV rotation is a separate control that composes on top
 * without touching the calibrated scale.
 *
 * Pixels are read by compositing a stage's layer canvases (see
 * `fog.spec.ts`); map-pixel points are turned into stage coordinates from
 * the stage's reported transform, honouring the player's TV rotation.
 */
import { test, expect, type Page } from "@playwright/test";
import { openTab, openTvSizeForm } from "./helpers";

/** `e2e/fixtures/grid-map.png`: 400×300, 50 px squares offset (12, 7). */
const GRID_FIXTURE_PATH = "e2e/fixtures/grid-map.png"; // relative to app/ (Playwright cwd)
const GRID = { width: 400, height: 300, cellSize: 50, offsetX: 12, offsetY: 7 } as const;
/** The fixture's background between the (white) grid lines. */
const MAP_RGB = [70, 60, 50] as const;
const MAP_DIMMED = MAP_RGB.map((c) => Math.round(c / 2));
const BLACK = [0, 0, 0] as const;
/** Must match `FOG_COMPACT_AT` / `FOG_KEEP_OPS` in `src/state/fogActions.ts`. */
const FOG_COMPACT_AT = 64;
const FOG_KEEP_OPS = 32;

/** Centre of a fixture cell (column, row) in map pixels. */
const cellCentre = (column: number, row: number): [number, number] => [
  GRID.offsetX + (column + 0.5) * GRID.cellSize,
  GRID.offsetY + (row + 0.5) * GRID.cellSize,
];
/** Where a point of a 400×300 scene lands after a clockwise quarter turn: (H − y, x). */
const turned = ([x, y]: [number, number]): [number, number] => [GRID.height - y, x];

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

function compositePixel(page: Page, stageTestId: string, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(
    ({ testId, fx, fy }) => {
      const canvases = Array.from(
        document.querySelectorAll<HTMLCanvasElement>(`[data-testid="${testId}"] canvas`)
      );
      if (canvases.length === 0) throw new Error("no stage canvases");
      const { width, height } = canvases[0];
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      for (const c of canvases) ctx.drawImage(c, 0, 0);
      const { data } = ctx.getImageData(Math.floor(width * fx), Math.floor(height * fy), 1, 1);
      return [data[0], data[1], data[2]];
    },
    { testId: stageTestId, fx, fy }
  );
}

const closeTo = (actual: number[], expected: readonly number[], tolerance = 4) =>
  [0, 1, 2].every((i) => Math.abs(actual[i] - expected[i]) <= tolerance);

interface StageTransform {
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  vx: number;
  vy: number;
  rotation: number;
}

async function stageTransform(page: Page, testId: string): Promise<StageTransform> {
  const stage = page.getByTestId(testId);
  const box = (await stage.boundingBox())!;
  return {
    box,
    scale: Number(await stage.getAttribute("data-scale")),
    vx: Number(await stage.getAttribute("data-viewport-x")),
    vy: Number(await stage.getAttribute("data-viewport-y")),
    rotation: Number(await stage.getAttribute("data-rotation")),
  };
}

/** Stage pixel of a map point: translation + rotate(point × scale) (quarter turns, clockwise). */
function toStage(t: StageTransform, mx: number, my: number) {
  const x = mx * t.scale;
  const y = my * t.scale;
  const r = ((t.rotation % 360) + 360) % 360;
  const rx = r === 0 ? x : r === 90 ? -y : r === 180 ? -x : y;
  const ry = r === 0 ? y : r === 90 ? x : r === 180 ? -y : -x;
  return { x: t.vx + rx, y: t.vy + ry };
}

/** The colour a stage shows at a map-pixel point. */
async function expectMapPixel(
  page: Page,
  stageTestId: string,
  point: [number, number],
  expected: readonly number[]
) {
  await expect
    .poll(async () => {
      const t = await stageTransform(page, stageTestId);
      const s = toStage(t, point[0], point[1]);
      const actual = await compositePixel(page, stageTestId, s.x / t.box.width, s.y / t.box.height);
      return closeTo(actual, expected) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

/** A drag on the DM stage through map-pixel points. */
async function dragMap(page: Page, points: [number, number][], steps = 6) {
  const t = await stageTransform(page, "dm-map-stage");
  const [first, ...rest] = points;
  const s0 = toStage(t, first[0], first[1]);
  await page.mouse.move(t.box.x + s0.x, t.box.y + s0.y);
  await page.mouse.down();
  for (const [mx, my] of rest) {
    const s = toStage(t, mx, my);
    await page.mouse.move(t.box.x + s.x, t.box.y + s.y, { steps });
  }
  await page.mouse.up();
}

interface StoredMap {
  imageRotation: number;
  width: number;
  height: number;
  fogOps: number;
  fogOpsFrom: number;
  fogMaskAssetId: string | null;
  grid: { cellSize: number; offsetX: number; offsetY: number };
}

/** The active map's document and the fog-mask asset ids, straight from IndexedDB. */
function stored(page: Page): Promise<{ map: StoredMap | null; fogMasks: string[] }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns", "assets"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            db.close();
            const doc = (campaigns.result as { state: { maps: (StoredMap & { fogOps: unknown[] })[] } }[])[0];
            const m = doc?.state.maps[0];
            resolve({
              map: m
                ? {
                    imageRotation: m.imageRotation,
                    width: m.width,
                    height: m.height,
                    fogOps: m.fogOps.length,
                    fogOpsFrom: m.fogOpsFrom,
                    fogMaskAssetId: m.fogMaskAssetId,
                    grid: { cellSize: m.grid.cellSize, offsetX: m.grid.offsetX, offsetY: m.grid.offsetY },
                  }
                : null,
              fogMasks: (assets.result as { id: string; kind: string }[])
                .filter((a) => a.kind === "fog-mask")
                .map((a) => a.id),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const dmSurface = (page: Page) => page.getByTestId("dm-canvas-surface");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");
const playerView = (player: Page) => player.getByTestId("player-view");

async function expectFogOps(page: Page, player: Page, count: number) {
  await expect(dmStage(page)).toHaveAttribute("data-fog-ops", String(count));
  await expect(playerStage(player)).toHaveAttribute("data-fog-ops", String(count));
}

async function expectBothReady(page: Page, player: Page) {
  await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
  await expect(playerStage(player)).toHaveAttribute("data-fog-status", "ready");
}

test.describe("map rotation (T017)", () => {
  test("a quarter turn turns image, grid, fog and the baked mask on both windows; undo works, redo is cleared; the TV rotation is separate", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");

    // TV-size calibration so the player scale is locked: hypot(1920, 1080) / 55 = 40.05 px/in,
    // over the fixture's 50 px cells = 0.8011.
    await openTab(page, "table");
    await expect(page.getByTestId("calibration-status")).toContainText(/Player display/);
    await openTvSizeForm(page);
    await page.getByLabel("TV resolution width").fill("1920");
    await page.getByLabel("TV resolution height").fill("1080");
    await page.getByLabel("TV diagonal in inches").fill("55");
    await page.getByRole("button", { name: "Use TV size" }).click();
    await expect(page.getByTestId("calibration-status")).toContainText(/from the TV size/);

    // Import the gridded fixture and type its grid in.
    await openTab(page, "maps");
    await page.getByTestId("map-file-input").setInputFiles(GRID_FIXTURE_PATH);
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await page.getByLabel("Grid cell size").fill(String(GRID.cellSize));
    await page.getByLabel("Grid offset X").fill(String(GRID.offsetX));
    await page.getByLabel("Grid offset Y").fill(String(GRID.offsetY));
    await expect(playerStage(player)).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
    const LOCKED_SCALE = "0.8011";
    await expect(playerStage(player)).toHaveAttribute("data-scale", LOCKED_SCALE);
    await expect(page.getByTestId("map-rotation-value")).toHaveText("0°");
    await expect(dmSurface(page)).toHaveAttribute("data-map-size", `${GRID.width},${GRID.height}`);
    await expect(playerStage(player)).toHaveAttribute("data-map-size", `${GRID.width},${GRID.height}`);

    // Give the map a base mask: 64 alternating fills compact into a PNG (the last one hides).
    await openTab(page, "fog");
    for (let i = 0; i < FOG_COMPACT_AT; i++) {
      await page.getByTestId(i % 2 === 0 ? "fog-reveal-all" : "fog-hide-all").click();
    }
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", String(FOG_KEEP_OPS));
    await expect(dmStage(page)).toHaveAttribute("data-fog-history", String(FOG_COMPACT_AT));
    await expect.poll(async () => (await stored(page)).map?.fogMaskAssetId).toEqual(expect.any(String));
    const maskBefore = (await stored(page)).map!.fogMaskAssetId!;
    await expectBothReady(page, player);

    // Reveal one whole cell (2, 1) with the snapping rectangle, then a second one and undo it,
    // so the redo stack holds something.
    const cell = cellCentre(2, 1);
    const elsewhere = cellCentre(0, 1);
    await page.getByTestId("fog-tool-rect").click();
    await page.getByTestId("fog-snap").check();
    await dragMap(page, [[cell[0] - 15, cell[1] - 15], [cell[0] + 15, cell[1] + 15]]);
    let ops = FOG_KEEP_OPS + 1;
    await expectFogOps(page, player, ops);
    await expectMapPixel(player, "player-map-stage", cell, MAP_RGB);
    await expectMapPixel(player, "player-map-stage", elsewhere, BLACK);
    const other = cellCentre(5, 3);
    await dragMap(page, [[other[0] - 15, other[1] - 15], [other[0] + 15, other[1] + 15]]);
    await expectFogOps(page, player, ++ops);
    await page.getByTestId("fog-undo").click();
    await expectFogOps(page, player, --ops);
    await expect(page.getByTestId("fog-redo")).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dmStage(page)).toHaveAttribute("data-tool", "none");
    await expect.poll(async () => (await stored(page)).map?.fogOps).toBe(ops);

    // Turn the map clockwise. Everything reports the swapped size on both windows.
    await openTab(page, "maps");
    await page.getByTestId("map-rotate-cw").click();
    await expect(page.getByTestId("map-rotation-value")).toHaveText("90°");
    await expect(dmSurface(page)).toHaveAttribute("data-map-size", `${GRID.height},${GRID.width}`);
    await expect(dmSurface(page)).toHaveAttribute("data-map-rotation", "90");
    await expect(dmStage(page)).toHaveAttribute("data-image-rotation", "90");
    await expect(playerStage(player)).toHaveAttribute("data-map-size", `${GRID.height},${GRID.width}`);
    await expect(playerStage(player)).toHaveAttribute("data-image-rotation", "90");
    await expectFogOps(page, player, ops);
    await expect(dmStage(page)).toHaveAttribute("data-fog-history", String(FOG_COMPACT_AT + 1));
    // The grid turned with it: cell size kept, origin (12, 7) -> (300 - 7, 12) wrapped.
    await expect(page.getByLabel("Grid cell size")).toHaveValue(String(GRID.cellSize));
    await expect(page.getByLabel("Grid offset X")).toHaveValue(String((GRID.height - GRID.offsetY) % GRID.cellSize));
    await expect(page.getByLabel("Grid offset Y")).toHaveValue(String(GRID.offsetX));
    // The calibrated scale is untouched (same cell size) and the player view is not rotated.
    await expect(playerStage(player)).toHaveAttribute("data-scale", LOCKED_SCALE);
    await expect(playerStage(player)).toHaveAttribute("data-rotation", "0");
    await expect(playerView(player)).toHaveAttribute("data-rotation", "0");

    // The base mask was baked turned: a new fog-mask asset, the old one gone, and both
    // windows render from it — the revealed cell is at its turned position, the old one is black.
    await expect
      .poll(async () => (await stored(page)).map?.fogMaskAssetId)
      .toEqual(expect.not.stringMatching(new RegExp(`^${maskBefore}$`)));
    const doc = await stored(page);
    expect(doc.map).toMatchObject({ imageRotation: 90, width: GRID.height, height: GRID.width, fogOps: ops });
    expect(doc.fogMasks).toEqual([doc.map!.fogMaskAssetId]);
    await expectBothReady(page, player);
    await expectMapPixel(player, "player-map-stage", turned(cell), MAP_RGB);
    await expectMapPixel(page, "dm-map-stage", turned(cell), MAP_RGB);
    await expectMapPixel(player, "player-map-stage", cell, BLACK);
    await expectMapPixel(page, "dm-map-stage", cell, MAP_DIMMED);
    await expectMapPixel(player, "player-map-stage", turned(elsewhere), BLACK);

    // Redo was cleared; undo still works on the turned log, and redo then holds the turned op.
    await openTab(page, "fog");
    await expect(page.getByTestId("fog-redo")).toBeDisabled();
    await expect(page.getByTestId("fog-undo")).toBeEnabled();
    await page.getByTestId("fog-undo").click();
    await expectFogOps(page, player, --ops);
    await expectMapPixel(player, "player-map-stage", turned(cell), BLACK);
    await page.getByTestId("fog-redo").click();
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", turned(cell), MAP_RGB);

    // Now turn the *player view*: a separate control. The scale is preserved, the map
    // rotation is untouched, and the turned cell is still where the map says it is.
    await openTab(page, "table");
    await page.getByRole("button", { name: "Rotate player view clockwise" }).click();
    await expect(playerView(player)).toHaveAttribute("data-rotation", "90");
    await expect(playerStage(player)).toHaveAttribute("data-rotation", "90");
    await expect(playerStage(player)).toHaveAttribute("data-scale", LOCKED_SCALE);
    await expect(page.getByTestId("rotation-value")).toHaveText("90°");
    await expect(playerStage(player)).toHaveAttribute("data-image-rotation", "90");
    await expect(dmSurface(page)).toHaveAttribute("data-map-rotation", "90");
    await expectMapPixel(player, "player-map-stage", turned(cell), MAP_RGB);
    await expectMapPixel(player, "player-map-stage", cell, BLACK);

    // Turning the map back leaves the TV rotation where it was.
    await openTab(page, "maps");
    await page.getByTestId("map-rotate-ccw").click();
    await expect(page.getByTestId("map-rotation-value")).toHaveText("0°");
    await expect(dmSurface(page)).toHaveAttribute("data-map-size", `${GRID.width},${GRID.height}`);
    await expect(playerStage(player)).toHaveAttribute("data-map-size", `${GRID.width},${GRID.height}`);
    await expect(page.getByLabel("Grid offset X")).toHaveValue(String(GRID.offsetX));
    await expect(page.getByLabel("Grid offset Y")).toHaveValue(String(GRID.offsetY));
    await expect(playerStage(player)).toHaveAttribute("data-rotation", "90");
    await expect(playerStage(player)).toHaveAttribute("data-scale", LOCKED_SCALE);
    await expectBothReady(page, player);
    await expectMapPixel(player, "player-map-stage", cell, MAP_RGB);
    await expectMapPixel(player, "player-map-stage", elsewhere, BLACK);
    await expect.poll(async () => (await stored(page)).map?.imageRotation).toBe(0);

    // The player page is still chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);
  });
});
