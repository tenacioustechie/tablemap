/**
 * Player view control (T009) in real Chromium: blackout and splash cover the
 * player page the moment the DM clicks; the splash shows the default artwork
 * (T015: a bundled file the player page loads from the dev server), the
 * campaign title when chosen, or the chosen image, and can be raised by a
 * scene switch; dragging the
 * viewport rectangle on the DM canvas pans the calibrated player view; a
 * quarter turn rotates the player stage without touching the calibrated
 * scale, and rotates a fitted map so it fits the other way round.
 *
 * Pixels are read by compositing a stage's layer canvases (see
 * `fog.spec.ts`); DOM overlays are checked with `elementFromPoint`.
 */
import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./helpers";

const FIXTURE_PATH = "e2e/fixtures/map.png"; // relative to app/ (Playwright cwd)
const FIXTURE_RGB = [230, 120, 20] as const;
const ARENA_RGB = [0x22, 0x44, 0x66] as const;
const BLACK = [0, 0, 0] as const;

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

async function expectPixel(page: Page, stageTestId: string, expected: readonly number[], fx = 0.5, fy = 0.5) {
  await expect
    .poll(async () => {
      const actual = await compositePixel(page, stageTestId, fx, fy);
      return closeTo(actual, expected) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

/** The element under the middle of the player page and its computed background. */
function centreElement(player: Page): Promise<{ testId: string; background: string; coversPage: boolean }> {
  return player.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2) as HTMLElement | null;
    if (!el) return { testId: "", background: "", coversPage: false };
    const box = el.getBoundingClientRect();
    return {
      testId: el.dataset.testid ?? el.tagName.toLowerCase(),
      background: getComputedStyle(el).backgroundColor,
      coversPage: box.left <= 0 && box.top <= 0 && box.right >= innerWidth && box.bottom >= innerHeight,
    };
  });
}

const playerView = (player: Page) => player.getByTestId("player-view");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");
const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const dmSurface = (page: Page) => page.getByTestId("dm-canvas-surface");

async function createBlankMap(page: Page, name: string, columns: number, rows: number, cellSize: number) {
  await openTab(page, "maps");
  await page.getByLabel("Blank map name").fill(name);
  await page.getByLabel("Columns").fill(String(columns));
  await page.getByLabel("Rows").fill(String(rows));
  await page.getByLabel("Cell size", { exact: true }).fill(String(cellSize));
  await page.getByLabel("Background colour").fill("#224466");
  await page.getByRole("button", { name: "Create blank map" }).click();
  await expect(dmStage(page)).toHaveAttribute("data-map-name", name);
}

const attr = async (locator: ReturnType<Page["getByTestId"]>, name: string) =>
  Number(await locator.getAttribute(name));
const point = (value: string | null) => (value ?? "").split(",").map(Number);

test.describe("player view control (T009)", () => {
  test("blackout and splash cover the player page at once; the splash shows the artwork, the title, an image, and follows scene switches", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");
    await openTab(page, "maps");
    await page.getByTestId("campaign-name-input").fill("Curse of Strahd");

    await page.getByTestId("map-file-input").setInputFiles(FIXTURE_PATH);
    await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
    await openTab(page, "fog");
    await page.getByTestId("fog-reveal-all").click();
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);

    // Blackout: an opaque black element over the whole page, the stage still underneath.
    await page.getByTestId("blackout-toggle").click();
    await expect(playerView(player)).toHaveAttribute("data-blackout", "true");
    await expect(player.getByTestId("player-blackout")).toBeVisible();
    expect(await centreElement(player)).toEqual({
      testId: "player-blackout",
      background: "rgb(0, 0, 0)",
      coversPage: true,
    });
    await expect(playerStage(player)).toHaveCount(1);
    await expect(page.getByTestId("blackout-toggle")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("blackout-toggle").click();
    await expect(player.getByTestId("player-blackout")).toHaveCount(0);
    await expect(playerView(player)).toHaveAttribute("data-blackout", "false");
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);

    // Splash: the default artwork over the scene (T015), decoded from the bundled file.
    await page.getByTestId("splash-toggle").click();
    await expect(playerView(player)).toHaveAttribute("data-splash", "true");
    const splash = player.getByTestId("player-splash");
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute("data-splash-kind", "default");
    const image = player.getByTestId("player-splash-image");
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", /splash-default/);
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1672);
    await expect(player.getByTestId("player-splash-title")).toHaveCount(0);
    await openTab(page, "table");
    await expect(page.getByTestId("splash-thumb")).toHaveAttribute("data-splash-kind", "default");
    await expect(page.getByTestId("splash-source-default")).toBeChecked();

    // The title card is a choice.
    await page.getByTestId("splash-source-title").check();
    await expect(splash).toHaveAttribute("data-splash-kind", "title");
    await expect(player.getByTestId("player-splash-title")).toHaveText("Curse of Strahd");
    await expect(player.getByTestId("player-splash-image")).toHaveCount(0);
    await expect(page.getByTestId("splash-thumb")).toHaveAttribute("data-splash-kind", "title");
    await expect(page.getByTestId("splash-thumb")).toHaveText("Curse of Strahd");
    const splashBox = (await splash.boundingBox())!;
    const pageSize = await player.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(splashBox.width).toBe(pageSize.width);
    expect(splashBox.height).toBe(pageSize.height);
    expect((await centreElement(player)).testId).toMatch(/^player-splash/);
    await expect(playerStage(player)).toHaveCount(1);

    // Blackout wins over the splash, and lifting it brings the splash back.
    await page.getByTestId("blackout-toggle").click();
    expect((await centreElement(player)).testId).toBe("player-blackout");
    await page.getByTestId("blackout-toggle").click();
    await expect(splash).toBeVisible();
    expect((await centreElement(player)).testId).toMatch(/^player-splash/);

    // A chosen image replaces the title card, and is pushed to the player like any asset.
    await page.getByTestId("splash-file-input").setInputFiles(FIXTURE_PATH);
    await expect(page.getByTestId("clear-splash-image")).toBeVisible();
    await expect(splash).toHaveAttribute("data-splash-kind", "image");
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(320);
    await expect(player.getByTestId("player-splash-title")).toHaveCount(0);
    await expect(page.getByTestId("splash-thumb")).toHaveAttribute("data-splash-kind", "image");
    // Clearing it returns to whichever source is chosen: the title card now, the artwork after switching.
    await page.getByTestId("clear-splash-image").click();
    await expect(splash).toHaveAttribute("data-splash-kind", "title");
    await expect(player.getByTestId("player-splash-title")).toHaveText("Curse of Strahd");
    await page.getByTestId("splash-source-default").check();
    await expect(splash).toHaveAttribute("data-splash-kind", "default");
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1672);
    await page.getByTestId("splash-file-input").setInputFiles(FIXTURE_PATH);
    await expect(splash).toHaveAttribute("data-splash-kind", "image");
    await page.getByTestId("clear-splash-image").click();
    await expect(splash).toHaveAttribute("data-splash-kind", "default");
    await expect(page.getByTestId("clear-splash-image")).toHaveCount(0);

    await page.getByTestId("splash-toggle").click();
    await expect(player.getByTestId("player-splash")).toHaveCount(0);
    await expect(playerView(player)).toHaveAttribute("data-splash", "false");
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);

    // With the preference on, switching scenes raises the splash until the DM hides it.
    await openTab(page, "table");
    await page.getByTestId("splash-on-switch").check();
    await createBlankMap(page, "Arena", 12, 8, 50);
    await expect(playerStage(player)).toHaveAttribute("data-map-name", "Arena");
    await expect(player.getByTestId("player-splash")).toBeVisible();
    await expect(page.getByTestId("splash-toggle")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("splash-toggle").click();
    await expect(player.getByTestId("player-splash")).toHaveCount(0);
    await page.getByRole("button", { name: "Show map" }).click();
    await expect(playerStage(player)).toHaveAttribute("data-map-name", "map");
    await expect(player.getByTestId("player-splash")).toBeVisible();
    await page.getByTestId("splash-toggle").click();
    await expect(player.getByTestId("player-splash")).toHaveCount(0);

    // The player page is still chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);
  });

  test("dragging the viewport rectangle pans the calibrated player view; rotation keeps the scale and re-fits an uncalibrated map", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await openTab(page, "table");
    await expect(page.getByTestId("calibration-status")).toContainText(/Player display/);

    // TV-size calibration: hypot(1920, 1080) / 55 = 40.05 px/in.
    await page.getByLabel("TV resolution width").fill("1920");
    await page.getByLabel("TV resolution height").fill("1080");
    await page.getByLabel("TV diagonal in inches").fill("55");
    await page.getByRole("button", { name: "Use TV size" }).click();
    await expect(page.getByTestId("calibration-status")).toContainText(/from the TV size/);

    // 1600 x 800 map px with 40 px cells: locked scale 1.0013.
    await createBlankMap(page, "Arena", 40, 20, 40);
    await openTab(page, "fog");
    await page.getByTestId("fog-reveal-all").click();
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0013");
    await expect(playerView(player)).toHaveAttribute("data-view-center", "800,400");
    await expect(dmSurface(page)).toHaveAttribute("data-player-center", "800,400");
    await expect(dmSurface(page)).toHaveAttribute("data-player-draggable", "true");

    const pageBox = (await playerView(player).boundingBox())!;
    const s = await attr(playerStage(player), "data-scale");
    // The map's centre sits in the middle of the player page.
    expect(await attr(playerStage(player), "data-viewport-x")).toBeCloseTo(pageBox.width / 2 - 800 * s, 0);
    expect(await attr(playerStage(player), "data-viewport-y")).toBeCloseTo(pageBox.height / 2 - 400 * s, 0);

    // Drag the rectangle on the DM canvas by (+120, +60) screen px.
    const dmBox = (await dmStage(page).boundingBox())!;
    const ds = await attr(dmStage(page), "data-scale");
    const dx0 = await attr(dmStage(page), "data-viewport-x");
    const dy0 = await attr(dmStage(page), "data-viewport-y");
    const startX = dmBox.x + dx0 + 800 * ds;
    const startY = dmBox.y + dy0 + 400 * ds;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY + 20, { steps: 4 });
    await page.mouse.move(startX + 120, startY + 60, { steps: 8 });
    await page.mouse.up();

    const expected = { x: 800 + 120 / ds, y: 400 + 60 / ds };
    await expect
      .poll(async () => point(await dmSurface(page).getAttribute("data-player-center")))
      .toEqual([expect.closeTo(expected.x, 0), expect.closeTo(expected.y, 0)]);
    await expect
      .poll(async () => point(await playerView(player).getAttribute("data-view-center")))
      .toEqual([expect.closeTo(expected.x, 0), expect.closeTo(expected.y, 0)]);
    // The player stage moved accordingly; the DM canvas itself did not pan.
    expect(await attr(playerStage(player), "data-viewport-x")).toBeCloseTo(pageBox.width / 2 - expected.x * s, 0);
    expect(await attr(playerStage(player), "data-viewport-y")).toBeCloseTo(pageBox.height / 2 - expected.y * s, 0);
    expect(await attr(dmStage(page), "data-viewport-x")).toBe(dx0);
    expect(await attr(dmStage(page), "data-viewport-y")).toBe(dy0);
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0013");

    // A quarter turn keeps the scale (one cell is still 40.05 px) and turns the transform.
    await openTab(page, "table");
    await page.getByRole("button", { name: "Rotate player view clockwise" }).click();
    await expect(playerView(player)).toHaveAttribute("data-rotation", "90");
    await expect(playerStage(player)).toHaveAttribute("data-rotation", "90");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0013");
    await expect(page.getByTestId("rotation-value")).toHaveText("90°");
    // rotate90((cx, cy) * s) = (-cy * s, cx * s): x = W/2 + cy*s, y = H/2 - cx*s.
    expect(await attr(playerStage(player), "data-viewport-x")).toBeCloseTo(pageBox.width / 2 + expected.y * s, 0);
    expect(await attr(playerStage(player), "data-viewport-y")).toBeCloseTo(pageBox.height / 2 - expected.x * s, 0);
    await expect(dmSurface(page)).toHaveAttribute("data-player-rotation", "90");
    await page.getByRole("button", { name: "Rotate player view counter-clockwise" }).click();
    await expect(playerStage(player)).toHaveAttribute("data-rotation", "0");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0013");

    await page.getByTestId("recentre-player-view").click();
    await expect(playerView(player)).toHaveAttribute("data-view-center", "800,400");

    // Uncalibrated: the map is fitted to the display, and a quarter turn fits it the other way.
    await page.getByRole("button", { name: "Clear calibration" }).click();
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "uncalibrated");
    await expect(dmSurface(page)).toHaveAttribute("data-player-draggable", "false");
    const { width: W, height: H } = pageBox;
    const fit0 = Math.min(W / 1600, H / 800);
    await expect(playerStage(player)).toHaveAttribute("data-scale", fit0.toFixed(4));
    // Mid-cell map point (1220, 420) shows the map colour.
    const mid0 = { x: (1220 * fit0 + (W - 1600 * fit0) / 2) / W, y: (420 * fit0 + (H - 800 * fit0) / 2) / H };
    await expectPixel(player, "player-map-stage", ARENA_RGB, mid0.x, mid0.y);

    await page.getByRole("button", { name: "Rotate player view clockwise" }).click();
    const fit90 = Math.min(H / 1600, W / 800);
    await expect(playerStage(player)).toHaveAttribute("data-scale", fit90.toFixed(4));
    await expect(playerStage(player)).toHaveAttribute("data-rotation", "90");
    // The turned map is 800 * fit90 wide on screen: just outside it is black, mid-cell inside is map colour.
    const outside = { x: (W / 2 + 400 * fit90 + 15) / W, y: 0.5 };
    expect(outside.x).toBeLessThan(1);
    await expectPixel(player, "player-map-stage", BLACK, outside.x, outside.y);
    // Map point (1220, 420) -> rotate90(((1220 - 800), (420 - 400)) * fit90) + centre = (W/2 - 20 * fit90, H/2 + 420 * fit90).
    const mid90 = { x: (W / 2 - 20 * fit90) / W, y: (H / 2 + 420 * fit90) / H };
    await expectPixel(player, "player-map-stage", ARENA_RGB, mid90.x, mid90.y);
    // Straight again, the same screen point is inside the wide map.
    await page.getByRole("button", { name: "Rotate player view counter-clockwise" }).click();
    await expect(playerStage(player)).toHaveAttribute("data-scale", fit0.toFixed(4));
    await expectPixel(player, "player-map-stage", ARENA_RGB, mid0.x, mid0.y);

    await expect(player.getByRole("button")).toHaveCount(0);
  });
});
