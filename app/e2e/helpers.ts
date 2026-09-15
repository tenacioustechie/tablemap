/**
 * Shared Playwright helpers. The DM sidebar's tabs (T016): every spec that
 * reaches a panel control opens the tab that holds it first, because
 * inactive tab panels are not in the DOM. And the setup-once forms behind
 * disclosures (T019): the blank-map form and, once calibrated, the TV-size
 * fieldset.
 *
 * The gridded-map helpers (T102, shared with T106's vision spec): the grid
 * fixture opened with its grid typed in and the player window showing it,
 * map-pixel points turned into screen coordinates from a stage's
 * `data-scale` and `data-viewport-x/y`, clicks and drags on the DM stage,
 * and a stage's colour at a map-pixel point (every layer canvas composited
 * over black, polled because Konva draws on the next animation frame).
 */
import { expect, type Page } from "@playwright/test";

/** `e2e/fixtures/grid-map.png`: 400×300, 50 px squares offset (12, 7). */
export const GRID_FIXTURE_PATH = "e2e/fixtures/grid-map.png"; // relative to app/ (Playwright cwd)
export const GRID = { cellSize: 50, offsetX: 12, offsetY: 7 };
/** The grid fixture's colour between its white grid lines (`scripts/make-grid-fixture.mjs`). */
export const GRID_FIXTURE_RGB = [70, 60, 50] as const;
/** Corner (column, row) of the fixture grid, in map pixels. */
export const corner = (column: number, row: number): [number, number] => [
  GRID.offsetX + column * GRID.cellSize,
  GRID.offsetY + row * GRID.cellSize,
];

export async function openPlayer(page: Page): Promise<Page> {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

export interface StageTransform {
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  vx: number;
  vy: number;
}

export async function stageTransform(page: Page, stageTestId = "dm-map-stage"): Promise<StageTransform> {
  const stage = page.getByTestId(stageTestId);
  const box = (await stage.boundingBox())!;
  return {
    box,
    scale: Number(await stage.getAttribute("data-scale")),
    vx: Number(await stage.getAttribute("data-viewport-x")),
    vy: Number(await stage.getAttribute("data-viewport-y")),
  };
}

/** Screen position of a map-pixel point on the DM stage. */
export async function toScreen(page: Page, [mx, my]: [number, number]) {
  const t = await stageTransform(page);
  return { x: t.box.x + t.vx + mx * t.scale, y: t.box.y + t.vy + my * t.scale };
}

export async function clickMap(page: Page, point: [number, number]) {
  const s = await toScreen(page, point);
  await page.mouse.click(s.x, s.y);
}

/**
 * Konva redraws a layer's hit graph on the next animation frame after its
 * nodes start listening (the tool was put down, a selection changed); a
 * click landing inside that frame misses. No human clicks that fast.
 */
export async function nextFrame(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

/** A mouse drag on the DM stage between two map-pixel points; `midway` runs before the release. */
export async function dragMap(
  page: Page,
  from: [number, number],
  to: [number, number],
  midway?: () => Promise<void>
) {
  const a = await toScreen(page, from);
  const b = await toScreen(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  if (midway) await midway();
  await page.mouse.up();
}

/** The gridded fixture imported and its grid typed in, with the player window open and showing it. */
export async function openGriddedMap(page: Page): Promise<{ player: Page; mapId: string }> {
  await page.goto("/#/dm");
  const player = await openPlayer(page);
  await expect(player.getByTestId("player-view")).toHaveAttribute("data-sync-status", "synced");
  await openTab(page, "maps");
  await page.getByTestId("map-file-input").setInputFiles(GRID_FIXTURE_PATH);
  const dmStage = page.getByTestId("dm-map-stage");
  await expect(dmStage).toHaveAttribute("data-image-status", "loaded");
  const mapId = (await dmStage.getAttribute("data-map-id"))!;
  await page.getByLabel("Grid cell size").fill(String(GRID.cellSize));
  await page.getByLabel("Grid offset X").fill(String(GRID.offsetX));
  await page.getByLabel("Grid offset Y").fill(String(GRID.offsetY));
  await expect(player.getByTestId("player-map-stage")).toHaveAttribute("data-map-id", mapId);
  return { player, mapId };
}

/** The colour a stage shows at a map-pixel point: its layer canvases composited over black. */
export async function mapPixel(page: Page, stageTestId: string, [mx, my]: [number, number]): Promise<number[]> {
  const t = await stageTransform(page, stageTestId);
  const fx = (t.vx + mx * t.scale) / t.box.width;
  const fy = (t.vy + my * t.scale) / t.box.height;
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

/** Polls until a stage shows `expected` (within `tolerance` per channel) at a map-pixel point. */
export async function expectMapPixel(
  page: Page,
  stageTestId: string,
  point: [number, number],
  expected: readonly number[],
  tolerance = 4
) {
  await expect
    .poll(async () => {
      const actual = await mapPixel(page, stageTestId, point);
      return expected.every((c, i) => Math.abs(actual[i] - c) <= tolerance) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

export type DmTabId = "maps" | "fog" | "tokens" | "turns" | "draw" | "walls" | "table";

/** Clicks the tab and waits for its panel: `dm-tab-<id>` → `dm-tabpanel[data-tab=<id>]`. */
export async function openTab(page: Page, id: DmTabId): Promise<void> {
  await page.getByTestId(`dm-tab-${id}`).click();
  await expect(page.getByTestId("dm-tabpanel")).toHaveAttribute("data-tab", id);
}

/** Maps tab, "New blank map" open: the blank-map form is in the DOM. */
export async function openBlankMapForm(page: Page): Promise<void> {
  await openTab(page, "maps");
  const disclosure = page.getByTestId("blank-map-disclosure");
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
  await expect(page.getByTestId("blank-map-form")).toBeVisible();
}

/**
 * Table tab, TV-size fieldset in the DOM. It is open on its own while the
 * display is uncalibrated and behind a disclosure once it is calibrated.
 */
export async function openTvSizeForm(page: Page): Promise<void> {
  await openTab(page, "table");
  const disclosure = page.getByTestId("tv-size-disclosure");
  if ((await disclosure.count()) > 0 && (await disclosure.getAttribute("aria-expanded")) !== "true") {
    await disclosure.click();
  }
  await expect(page.getByTestId("calibration-tv-size")).toBeVisible();
}
