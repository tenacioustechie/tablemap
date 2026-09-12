/**
 * Annotations (T011) in real Chromium: an Alt-click on the DM canvas makes
 * a pulse appear on the player page and it expires by itself; a note
 * pinned on the DM canvas never appears on the player page (not in its
 * pixels, not in its DOM, not after a reload); freehand drawings show on
 * the player only when drawn for both views, and clear-layer removes them.
 *
 * Pixels are read by compositing a stage's layer canvases (see
 * `fog.spec.ts`); map-pixel points are turned into screen / canvas
 * coordinates from the stage's `data-scale` and `data-viewport-x/y`.
 */
import { test, expect, type Page } from "@playwright/test";

const ARENA_RGB = [0x22, 0x44, 0x66] as const;
const BLACK = [0, 0, 0] as const;
/** `PING_COLOR` in `src/map/PingLayer.tsx`. */
const PING_RGB = [255, 204, 0] as const;
const RED = [255, 0, 0] as const;

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

const closeTo = (actual: number[], expected: readonly number[], tolerance = 6) =>
  [0, 1, 2].every((i) => Math.abs(actual[i] - expected[i]) <= tolerance);

async function expectPixel(page: Page, stageTestId: string, expected: readonly number[], fx: number, fy: number) {
  await expect
    .poll(async () => {
      const actual = await compositePixel(page, stageTestId, fx, fy);
      return closeTo(actual, expected) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

const playerView = (player: Page) => player.getByTestId("player-view");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");
const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const dmSurface = (page: Page) => page.getByTestId("dm-canvas-surface");

const attr = async (locator: ReturnType<Page["getByTestId"]>, name: string) =>
  Number(await locator.getAttribute(name));

/** Screen coordinates of a map point on the DM canvas. */
async function dmScreenPoint(page: Page, mx: number, my: number) {
  const box = (await dmStage(page).boundingBox())!;
  const s = await attr(dmStage(page), "data-scale");
  const vx = await attr(dmStage(page), "data-viewport-x");
  const vy = await attr(dmStage(page), "data-viewport-y");
  return { x: box.x + vx + mx * s, y: box.y + vy + my * s };
}

/** A map point on the player stage as a fraction of the stage canvas. */
async function playerFraction(player: Page, mx: number, my: number) {
  const box = (await playerStage(player).boundingBox())!;
  const s = await attr(playerStage(player), "data-scale");
  const vx = await attr(playerStage(player), "data-viewport-x");
  const vy = await attr(playerStage(player), "data-viewport-y");
  return { fx: (vx + mx * s) / box.width, fy: (vy + my * s) / box.height };
}

/** A map point on the DM stage as a fraction of the stage canvas. */
async function dmFraction(page: Page, mx: number, my: number) {
  const box = (await dmStage(page).boundingBox())!;
  const s = await attr(dmStage(page), "data-scale");
  const vx = await attr(dmStage(page), "data-viewport-x");
  const vy = await attr(dmStage(page), "data-viewport-y");
  return { fx: (vx + mx * s) / box.width, fy: (vy + my * s) / box.height };
}

async function altClickMap(page: Page, mx: number, my: number) {
  const { x, y } = await dmScreenPoint(page, mx, my);
  await page.keyboard.down("Alt");
  await page.mouse.click(x, y);
  await page.keyboard.up("Alt");
}

async function dragMap(page: Page, from: [number, number], to: [number, number]) {
  const a = await dmScreenPoint(page, from[0], from[1]);
  const b = await dmScreenPoint(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

async function createBlankMap(page: Page, name: string, columns: number, rows: number, cellSize: number) {
  await page.getByLabel("Blank map name").fill(name);
  await page.getByLabel("Columns").fill(String(columns));
  await page.getByLabel("Rows").fill(String(rows));
  await page.getByLabel("Cell size", { exact: true }).fill(String(cellSize));
  await page.getByLabel("Background colour").fill("#224466");
  await page.getByRole("button", { name: "Create blank map" }).click();
  await expect(dmStage(page)).toHaveAttribute("data-map-name", name);
}

/** Nothing on the player page mentions the note, in its markup or its text. */
async function expectNoNoteOnPlayer(player: Page, text: string) {
  expect(await player.content()).not.toContain(text);
  expect(await player.evaluate(() => document.body.innerText)).not.toContain(text);
  await expect(player.getByTestId("note-popover")).toHaveCount(0);
  await expect(player.getByRole("textbox")).toHaveCount(0);
}

test.describe("annotations (T011)", () => {
  test("a ping pulses on the player page and expires; a note never reaches the player; drawings follow their visibility", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");
    // 600 x 400 map px, fully fogged: the player page is black where the map is.
    await createBlankMap(page, "Arena", 12, 8, 50);
    await expect(playerStage(player)).toHaveAttribute("data-map-name", "Arena");
    await expect(playerStage(player)).toHaveAttribute("data-pings", "0");

    // Sampled points are mid-cell (50 px cells) so no grid line is under them.
    // ---- ping: Alt-click on the DM canvas -> pulse on the player over the fog, then gone.
    const pingAt = { x: 175, y: 125 };
    const pingFraction = await playerFraction(player, pingAt.x, pingAt.y);
    await expectPixel(player, "player-map-stage", BLACK, pingFraction.fx, pingFraction.fy);
    await altClickMap(page, pingAt.x, pingAt.y);
    await expect(playerStage(player)).toHaveAttribute("data-pings", "1");
    await expect(dmStage(page)).toHaveAttribute("data-pings", "1");
    await expectPixel(player, "player-map-stage", PING_RGB, pingFraction.fx, pingFraction.fy);
    // Auto-expiry: the pulse lasts 2 s.
    await expect(playerStage(player)).toHaveAttribute("data-pings", "0", { timeout: 5000 });
    await expectPixel(player, "player-map-stage", BLACK, pingFraction.fx, pingFraction.fy);
    // A ping is not an annotation and did not change the map.
    await expect(dmStage(page)).toHaveAttribute("data-annotations", "0");
    await expect(playerStage(player)).toHaveAttribute("data-annotations", "0");

    // ---- note: pinned on the DM canvas, edited in the popover, invisible on the player.
    await page.getByTestId("fog-reveal-all").click();
    const noteAt = { x: 425, y: 325 };
    const noteFraction = await playerFraction(player, noteAt.x, noteAt.y);
    await expectPixel(player, "player-map-stage", ARENA_RGB, noteFraction.fx, noteFraction.fy);
    await page.getByTestId("note-tool").click();
    await expect(dmSurface(page)).toHaveAttribute("data-note-tool", "placing");
    const notePoint = await dmScreenPoint(page, noteAt.x, noteAt.y);
    await page.mouse.click(notePoint.x, notePoint.y);
    await expect(dmSurface(page)).toHaveAttribute("data-notes", "1");
    await expect(dmSurface(page)).toHaveAttribute("data-note-tool", "none");
    const secret = "SECRET-LEVER-OPENS-VAULT";
    await page.getByTestId("note-text").fill(secret);
    await expect(page.getByTestId("note-item")).toContainText(secret);
    await expect(dmStage(page)).toHaveAttribute("data-annotations", "1");
    // The DM canvas draws the marker (pink) where the player shows plain map.
    const dmNoteFraction = await dmFraction(page, noteAt.x, noteAt.y);
    await expect
      .poll(async () => closeTo(await compositePixel(page, "dm-map-stage", dmNoteFraction.fx, dmNoteFraction.fy), ARENA_RGB))
      .toBe(false);
    await expect(playerStage(player)).toHaveAttribute("data-annotations", "0");
    await expectPixel(player, "player-map-stage", ARENA_RGB, noteFraction.fx, noteFraction.fy);
    await expectNoNoteOnPlayer(player, secret);

    // ---- drawings: a stroke for both views shows on the player, a DM-only one does not.
    await page.getByTestId("note-popover-close").click();
    await page.getByTestId("draw-mode-draw").click();
    await expect(dmSurface(page)).toHaveAttribute("data-drawing", "draw");
    await page.getByTestId("draw-color").fill("#ff0000");
    await page.getByTestId("draw-width").fill("24");
    await expect(page.getByTestId("draw-width-value")).toHaveText("24");
    await dragMap(page, [100, 125], [200, 125]);
    await expect(dmStage(page)).toHaveAttribute("data-annotations", "2");
    await expect(playerStage(player)).toHaveAttribute("data-annotations", "1");
    await expect(playerStage(player)).toHaveAttribute("data-annotations-shown", "1");
    const sharedMid = await playerFraction(player, 175, 125);
    await expectPixel(player, "player-map-stage", RED, sharedMid.fx, sharedMid.fy);

    await page.getByTestId("draw-visibility").selectOption("dm");
    await dragMap(page, [100, 325], [200, 325]);
    await expect(dmStage(page)).toHaveAttribute("data-annotations", "3");
    await expect(dmStage(page)).toHaveAttribute("data-annotations-shown", "2");
    const dmOnlyMid = await dmFraction(page, 175, 325);
    await expectPixel(page, "dm-map-stage", RED, dmOnlyMid.fx, dmOnlyMid.fy);
    await expect(playerStage(player)).toHaveAttribute("data-annotations", "1");
    const playerDmOnlyMid = await playerFraction(player, 175, 325);
    await expectPixel(player, "player-map-stage", ARENA_RGB, playerDmOnlyMid.fx, playerDmOnlyMid.fy);

    // A reloaded player (fresh snapshot) still gets neither the note nor the DM-only stroke.
    await player.reload();
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");
    await expect(playerStage(player)).toHaveAttribute("data-annotations", "1");
    await expectNoNoteOnPlayer(player, secret);
    await expectPixel(player, "player-map-stage", RED, sharedMid.fx, sharedMid.fy);
    await expectPixel(player, "player-map-stage", ARENA_RGB, playerDmOnlyMid.fx, playerDmOnlyMid.fy);

    // Clear the layer: both strokes go, the note stays.
    await page.getByTestId("draw-clear").click();
    await expect(dmStage(page)).toHaveAttribute("data-annotations", "1");
    await expect(playerStage(player)).toHaveAttribute("data-annotations", "0");
    await expectPixel(player, "player-map-stage", ARENA_RGB, sharedMid.fx, sharedMid.fy);
    await expect(page.getByTestId("note-item")).toContainText(secret);

    // The player page is still chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);
  });
});
