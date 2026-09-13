/**
 * Fog of war (T007) in real Chromium: new maps are black on the player
 * screen and dimmed on the DM canvas; a rectangle revealed on the DM page
 * shows map pixels on the player page; hide all / reveal all; the reveal
 * reaches the player within the latency budget; fog survives scene
 * switches, a DM reload and a player reload; a long op log is compacted
 * into a PNG mask that both windows render from; and (T018) the DM can pan
 * with Space or the middle button while the brush is armed, arm tools by
 * key and read the `?` cheat sheet.
 *
 * Pixels are read by compositing every layer canvas of a stage onto one
 * canvas in the page (a screenshot of that region, without decoding PNGs
 * in the test runner) and sampling a point.
 */
import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./helpers";

const FIXTURE_PATH = "e2e/fixtures/map.png"; // relative to app/ (Playwright cwd)
/** The fixture's interior colour (see the generator notes in docs/architecture.md). */
const FIXTURE_RGB = [230, 120, 20] as const;
/** Spec: reveal visible on the TV < 100 ms. Generous on CI machines (`CI` set). */
const onCi = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI
);
const REVEAL_LATENCY_MS = onCi ? 1000 : 100;
/** Must match `FOG_COMPACT_AT` / `FOG_KEEP_OPS` in `src/state/fogActions.ts`. */
const FOG_COMPACT_AT = 64;
const FOG_KEEP_OPS = 32;

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

/**
 * Composites the stage's layer canvases (image, grid, fog, ...) and returns
 * the colour at the given fraction of the stage size. Konva draws on the
 * next animation frame, so callers poll.
 */
function compositePixel(
  page: Page,
  stageTestId: string,
  fx = 0.5,
  fy = 0.5
): Promise<number[]> {
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
const BLACK = [0, 0, 0] as const;
/** The fixture under 50 % black: what the DM sees where fog remains. */
const FIXTURE_DIMMED = FIXTURE_RGB.map((c) => Math.round(c / 2));

async function expectPixel(
  page: Page,
  stageTestId: string,
  expected: readonly number[],
  fx = 0.5,
  fy = 0.5
) {
  await expect
    .poll(async () => {
      const actual = await compositePixel(page, stageTestId, fx, fy);
      return closeTo(actual, expected) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

interface StoredFog {
  maps: { name: string; fogOps: number; fogOpsFrom: number; fogMaskAssetId: string | null }[];
  assets: { id: string; kind: string; type: string; size: number }[];
}

/** Reads fog state and asset rows straight from IndexedDB. */
function stored(page: Page): Promise<StoredFog> {
  return page.evaluate(
    () =>
      new Promise<StoredFog>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns", "assets"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (
              campaigns.result as {
                state: {
                  maps: {
                    name: string;
                    fogOps: unknown[];
                    fogOpsFrom: number;
                    fogMaskAssetId: string | null;
                  }[];
                };
              }[]
            )[0];
            resolve({
              maps: (campaign?.state.maps ?? []).map((m) => ({
                name: m.name,
                fogOps: m.fogOps.length,
                fogOpsFrom: m.fogOpsFrom,
                fogMaskAssetId: m.fogMaskAssetId,
              })),
              assets: (assets.result as { id: string; kind: string; blob: Blob }[]).map((a) => ({
                id: a.id,
                kind: a.kind,
                type: a.blob?.type ?? "",
                size: a.blob?.size ?? 0,
              })),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");

/** Where a stage draws the map: its box on screen plus the viewport it reports. */
interface StageTransform {
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  vx: number;
  vy: number;
}

async function stageTransform(page: Page, testId: string): Promise<StageTransform> {
  const stage = page.getByTestId(testId);
  const box = (await stage.boundingBox())!;
  return {
    box,
    scale: Number(await stage.getAttribute("data-scale")),
    vx: Number(await stage.getAttribute("data-viewport-x")),
    vy: Number(await stage.getAttribute("data-viewport-y")),
  };
}

/** Screen position of a map-pixel point on the DM stage. */
const toScreen = (t: StageTransform, mx: number, my: number) => ({
  x: t.box.x + t.vx + mx * t.scale,
  y: t.box.y + t.vy + my * t.scale,
});

/** The colour a stage shows at a map-pixel point. */
async function expectMapPixel(
  page: Page,
  stageTestId: string,
  point: [number, number],
  expected: readonly number[]
) {
  const t = await stageTransform(page, stageTestId);
  const fx = (t.vx + point[0] * t.scale) / t.box.width;
  const fy = (t.vy + point[1] * t.scale) / t.box.height;
  await expectPixel(page, stageTestId, expected, fx, fy);
}

/** Polls until the pixel is neither black nor the fixture colour: a feathered edge. */
async function expectMapPixelBetween(page: Page, stageTestId: string, point: [number, number]) {
  const t = await stageTransform(page, stageTestId);
  const fx = (t.vx + point[0] * t.scale) / t.box.width;
  const fy = (t.vy + point[1] * t.scale) / t.box.height;
  await expect
    .poll(async () => {
      const [r] = await compositePixel(page, stageTestId, fx, fy);
      // The fixture's red channel is 230; black is 0. Anything clearly in between is a soft edge.
      return r > 40 && r < 190 ? "between" : `red ${r}`;
    })
    .toBe("between");
}

/** A brush / lasso drag on the DM stage through map-pixel points. */
async function dragMap(page: Page, points: [number, number][], steps = 6) {
  const t = await stageTransform(page, "dm-map-stage");
  const [first, ...rest] = points;
  const s0 = toScreen(t, first[0], first[1]);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (const [mx, my] of rest) {
    const s = toScreen(t, mx, my);
    await page.mouse.move(s.x, s.y, { steps });
  }
  await page.mouse.up();
}

async function expectFogOps(page: Page, player: Page, count: number) {
  await expect(dmStage(page)).toHaveAttribute("data-fog-ops", String(count));
  await expect(playerStage(player)).toHaveAttribute("data-fog-ops", String(count));
}

async function importFixture(page: Page) {
  await openTab(page, "maps");
  await page.getByTestId("map-file-input").setInputFiles(FIXTURE_PATH);
  await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
}

async function playerShowsFixture(player: Page, mapId: string) {
  await expect(playerStage(player)).toHaveAttribute("data-map-id", mapId);
  await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
  await expect(playerStage(player)).toHaveAttribute("data-fog-status", "ready");
}

/**
 * Timestamps for the latency check. The DM page records the wall-clock time
 * of its last click / mouse-up (before React handles it); the player page
 * records when its stage's fog history counter last changed (the same
 * commit that repaints the fog canvas). Both are `Date.now()`, comparable
 * across windows of one browser.
 */
async function armLatencyProbes(page: Page, player: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __dmActionAt: number };
    const stamp = () => {
      w.__dmActionAt = Date.now();
    };
    document.addEventListener("click", stamp, true);
    document.addEventListener("mouseup", stamp, true);
  });
  await player.evaluate(() => {
    const w = window as unknown as { __playerFogAt: number };
    w.__playerFogAt = 0;
    new MutationObserver(() => {
      w.__playerFogAt = Date.now();
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-fog-history"],
    });
  });
}

async function measuredLatency(page: Page, player: Page): Promise<number> {
  const at = await page.evaluate(() => (window as unknown as { __dmActionAt: number }).__dmActionAt);
  await expect
    .poll(() => player.evaluate(() => (window as unknown as { __playerFogAt: number }).__playerFogAt))
    .toBeGreaterThanOrEqual(at);
  const seen = await player.evaluate(() => (window as unknown as { __playerFogAt: number }).__playerFogAt);
  return seen - at;
}

test.describe("fog of war", () => {
  test("a new map is black on the player and dimmed on the DM; a revealed rectangle shows map pixels within the latency budget", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await importFixture(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await playerShowsFixture(player, mapId);
    await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "0");

    // Blackout by default: the player sees nothing of the map, the DM sees it dimmed.
    await expectPixel(player, "player-map-stage", BLACK);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED);

    await armLatencyProbes(page, player);
    await openTab(page, "fog");
    await page.getByTestId("fog-tool-rect").click();
    await expect(page.getByTestId("fog-hint")).toBeVisible();
    // Big enough that the default feathered edge stays well away from the centre.
    const box = (await dmStage(page).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 120, cy - 90);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 90, { steps: 4 });
    await page.mouse.up();

    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "1");
    const latency = await measuredLatency(page, player);
    expect(latency).toBeLessThan(REVEAL_LATENCY_MS);

    // The revealed rectangle shows the map on the player and undimmed on the DM;
    // the rest stays black / dimmed.
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);
    await expectPixel(page, "dm-map-stage", FIXTURE_RGB);
    await expectPixel(player, "player-map-stage", BLACK, 0.2, 0.5);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED, 0.2, 0.5);

    // The tool stays on for the next rectangle; Esc leaves it.
    await expect(page.getByTestId("fog-tool-rect")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fog-tool-rect")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("fog-hint")).toHaveCount(0);

    // The player page is still chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);
  });

  test("hide all / reveal all sync fast; fog survives scene switches, a DM reload and a player reload", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await importFixture(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await playerShowsFixture(player, mapId);
    await expectPixel(player, "player-map-stage", BLACK);
    await armLatencyProbes(page, player);

    await openTab(page, "fog");
    await page.getByTestId("fog-reveal-all").click();
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);
    expect(await measuredLatency(page, player)).toBeLessThan(REVEAL_LATENCY_MS);
    await expectPixel(page, "dm-map-stage", FIXTURE_RGB);

    await page.getByTestId("fog-hide-all").click();
    await expectPixel(player, "player-map-stage", BLACK);
    expect(await measuredLatency(page, player)).toBeLessThan(REVEAL_LATENCY_MS);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED);

    await page.getByTestId("fog-reveal-all").click();
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);
    await expect(page.getByTestId("fog-op-count")).toHaveText("3");

    // Another scene starts fully fogged; switching back keeps the first one's fog.
    await openTab(page, "maps");
    await page.getByLabel("Blank map name").fill("Arena");
    await page.getByLabel("Columns").fill("12");
    await page.getByLabel("Rows").fill("8");
    await page.getByLabel("Cell size", { exact: true }).fill("50");
    await page.getByLabel("Background colour").fill("#224466");
    await page.getByRole("button", { name: "Create blank map" }).click();
    const arenaId = (await dmStage(page).getAttribute("data-map-id"))!;
    await expect(playerStage(player)).toHaveAttribute("data-map-id", arenaId);
    await openTab(page, "fog");
    await expect(page.getByTestId("fog-op-count")).toHaveText("0");
    // Sampled just off centre: the arena's centre sits on a grid line.
    await expectPixel(player, "player-map-stage", BLACK, 0.52, 0.52);
    await expectPixel(page, "dm-map-stage", [0x11, 0x22, 0x33], 0.52, 0.52);

    await openTab(page, "maps");
    await page.getByRole("button", { name: "Show map" }).click();
    await playerShowsFixture(player, mapId);
    await openTab(page, "fog");
    await expect(page.getByTestId("fog-op-count")).toHaveText("3");
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);

    // Autosaved: the log is in the campaign document.
    await expect
      .poll(async () => (await stored(page)).maps.map((m) => m.fogOps))
      .toEqual([3, 0]);

    // DM reload: the fog comes back from storage, the open player follows the new snapshot.
    await page.reload();
    await expect(dmStage(page)).toHaveAttribute("data-map-id", mapId);
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "3");
    await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
    await expectPixel(page, "dm-map-stage", FIXTURE_RGB);
    // The reloaded DM's start-up snapshot (seq 1: the campaign was opened) replaced the mirror.
    await expect(player.getByTestId("player-view")).toHaveAttribute("data-sync-seq", "1");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "3");
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);
    await openTab(page, "fog"); // the reloaded DM remembers the tab; make sure anyway
    await page.getByTestId("fog-hide-all").click();
    await expectPixel(player, "player-map-stage", BLACK);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED);

    // Player reload: a fresh mirror replays the same log.
    await player.reload();
    await playerShowsFixture(player, mapId);
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "4");
    await expectPixel(player, "player-map-stage", BLACK);
    await page.getByTestId("fog-reveal-all").click();
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);
  });

  test("a feathered brush stroke reveals on the player; undo and redo are reflected on both windows (T008)", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await importFixture(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await playerShowsFixture(player, mapId);
    await expectPixel(player, "player-map-stage", BLACK);

    // Brush, default radius 40 map px, feather on (default): a stroke along y = 100.
    await openTab(page, "fog");
    await page.getByTestId("fog-tool-brush").click();
    await expect(page.getByTestId("fog-hint")).toContainText(/reveal with the brush/i);
    await expect(page.getByTestId("fog-feather")).toBeChecked();
    await dragMap(page, [
      [90, 100],
      [230, 100],
    ]);
    await expectFogOps(page, player, 1);
    // Along the stroke: revealed on both; well outside it: still fogged.
    await expectMapPixel(player, "player-map-stage", [160, 100], FIXTURE_RGB);
    await expectMapPixel(page, "dm-map-stage", [160, 100], FIXTURE_RGB);
    await expectMapPixel(player, "player-map-stage", [160, 170], BLACK);
    // The feathered edge: at the stroke's boundary the player sees a mix, not a hard cut.
    await expectMapPixelBetween(player, "player-map-stage", [160, 140]);

    // Undo: the log shrinks on both windows and the player is black again.
    await page.getByTestId("fog-undo").click();
    await expectFogOps(page, player, 0);
    await expectMapPixel(player, "player-map-stage", [160, 100], BLACK);
    await expectMapPixel(page, "dm-map-stage", [160, 100], FIXTURE_DIMMED);
    await expect(page.getByTestId("fog-undo")).toBeDisabled();
    await expect(page.getByTestId("fog-redo")).toBeEnabled();

    // Redo brings the same stroke back; Ctrl+Z / Ctrl+Shift+Z do the same from the keyboard.
    await page.getByTestId("fog-redo").click();
    await expectFogOps(page, player, 1);
    await expectMapPixel(player, "player-map-stage", [160, 100], FIXTURE_RGB);
    await page.keyboard.press("Control+z");
    await expectFogOps(page, player, 0);
    await expectMapPixel(player, "player-map-stage", [160, 100], BLACK);
    await page.keyboard.press("Control+Shift+z");
    await expectFogOps(page, player, 1);
    await expectMapPixel(player, "player-map-stage", [160, 100], FIXTURE_RGB);

    // The undone log is what gets autosaved.
    await expect.poll(async () => (await stored(page)).maps[0]?.fogOps).toBe(1);
  });

  test("all six tool / mode combinations, snap to grid and hard edges sync to the player (T008)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await importFixture(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await playerShowsFixture(player, mapId);
    const centre: [number, number] = [160, 100];
    await expectMapPixel(player, "player-map-stage", centre, BLACK);
    let ops = 0;
    await openTab(page, "fog");

    // Snap to grid (default 70 px cells from the image origin): a small
    // rectangle inside cell (1, 1) reveals the whole cell and nothing else.
    await page.getByTestId("fog-tool-rect").click();
    await page.getByTestId("fog-snap").check();
    await expect(page.getByTestId("fog-hint")).toContainText("whole cells");
    await dragMap(page, [[95, 95], [120, 120]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", [75, 75], FIXTURE_RGB);
    await expectMapPixel(player, "player-map-stage", [135, 135], FIXTURE_RGB);
    await expectMapPixel(player, "player-map-stage", [65, 75], BLACK);
    await expectMapPixel(player, "player-map-stage", [75, 145], BLACK);
    await expectMapPixel(page, "dm-map-stage", [75, 75], FIXTURE_RGB);
    await page.getByTestId("fog-undo").click();
    await expectFogOps(page, player, --ops);
    await expectMapPixel(player, "player-map-stage", [75, 75], BLACK);
    await page.getByTestId("fog-snap").uncheck();

    // 1. Brush reveal (radius 70, feathered) along y = 100.
    await page.getByTestId("fog-tool-brush").click();
    await page.getByTestId("fog-brush-radius").fill("70");
    await dragMap(page, [[120, 100], [200, 100]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, FIXTURE_RGB);
    // 2. Brush hide, radius 30, feather off: a hard edge around the hidden band.
    await page.getByTestId("fog-mode-hide").click();
    await page.getByTestId("fog-feather").uncheck();
    await page.getByTestId("fog-brush-radius").fill("30");
    await dragMap(page, [[120, 100], [200, 100]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, BLACK);
    await expectMapPixel(player, "player-map-stage", [160, 100 + 26], BLACK);
    // Just outside the hidden band the earlier reveal still shows in full.
    await expectMapPixel(player, "player-map-stage", [160, 100 + 36], FIXTURE_RGB);
    // 3. Rectangle reveal.
    await page.getByTestId("fog-mode-reveal").click();
    await page.getByTestId("fog-tool-rect").click();
    await dragMap(page, [[130, 80], [190, 120]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, FIXTURE_RGB);
    // 4. Rectangle hide.
    await page.getByTestId("fog-mode-hide").click();
    await dragMap(page, [[130, 80], [190, 120]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, BLACK);
    // 5. Lasso reveal: a diamond around the centre.
    await page.getByTestId("fog-mode-reveal").click();
    await page.getByTestId("fog-tool-lasso").click();
    await dragMap(page, [[160, 60], [200, 100], [160, 140], [120, 100]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, FIXTURE_RGB);
    // 6. Lasso hide.
    await page.getByTestId("fog-mode-hide").click();
    await dragMap(page, [[160, 60], [200, 100], [160, 140], [120, 100]]);
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, BLACK);

    // Undo twice, redo once: both windows agree at every step.
    await page.getByTestId("fog-undo").click();
    await expectFogOps(page, player, --ops);
    await expectMapPixel(player, "player-map-stage", centre, FIXTURE_RGB); // the lasso hide is gone
    await expectMapPixel(page, "dm-map-stage", centre, FIXTURE_RGB);
    await page.getByTestId("fog-undo").click();
    await expectFogOps(page, player, --ops);
    await expectMapPixel(player, "player-map-stage", centre, BLACK); // the rectangle hide again
    await page.getByTestId("fog-redo").click();
    await expectFogOps(page, player, ++ops);
    await expectMapPixel(player, "player-map-stage", centre, FIXTURE_RGB);
    await expectMapPixel(page, "dm-map-stage", centre, FIXTURE_RGB);

    // A player opened afresh replays the same log to the same picture.
    await player.reload();
    await playerShowsFixture(player, mapId);
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", String(ops));
    await expectMapPixel(player, "player-map-stage", centre, FIXTURE_RGB);
    // Left of the rectangle and the lasso: the hidden brush band and the revealed halo.
    await expectMapPixel(player, "player-map-stage", [100, 100], BLACK);
    await expectMapPixel(player, "player-map-stage", [100, 136], FIXTURE_RGB);
  });

  test("brush drag on a 4k-wide map: frames keep coming during the drag and the stroke commits within budget (T008 perf smoke)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    // 64 columns x 64 px = 4096 px wide, 32 rows = 2048 px tall.
    await openTab(page, "maps");
    await page.getByLabel("Blank map name").fill("Huge");
    await page.getByLabel("Columns").fill("64");
    await page.getByLabel("Rows").fill("32");
    await page.getByLabel("Cell size", { exact: true }).fill("64");
    await page.getByRole("button", { name: "Create blank map" }).click();
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await expect(playerStage(player)).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage(player)).toHaveAttribute("data-fog-status", "ready");

    await openTab(page, "fog");
    await page.getByTestId("fog-tool-brush").click();
    await page.getByTestId("fog-brush-radius").fill("120");

    // Frame timing during the drag, and mouse-up -> mask committed (the DOM
    // attribute changes in the same commit that repaints the 4k mask canvas).
    await page.evaluate(() => {
      const w = window as unknown as {
        __frames: number[];
        __stop: () => void;
        __upAt: number;
        __committedAt: number;
      };
      w.__frames = [];
      let last = performance.now();
      let running = true;
      const tick = (now: number) => {
        w.__frames.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      w.__stop = () => {
        running = false;
      };
      document.addEventListener(
        "mouseup",
        () => {
          w.__upAt = performance.now();
        },
        true
      );
      w.__committedAt = 0;
      new MutationObserver(() => {
        w.__committedAt = performance.now();
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-fog-ops"] });
    });

    // A long zig-zag drag across the map: ~150 pointer events.
    await dragMap(
      page,
      [
        [200, 300],
        [1200, 1500],
        [2200, 300],
        [3200, 1500],
        [3900, 400],
      ],
      36
    );
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "1");

    const stats = await page.evaluate(() => {
      const w = window as unknown as {
        __frames: number[];
        __stop: () => void;
        __upAt: number;
        __committedAt: number;
      };
      w.__stop();
      const frames = w.__frames.slice(1).sort((a, b) => a - b);
      const p = (q: number) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))];
      return {
        frames: frames.length,
        median: p(0.5),
        p95: p(0.95),
        max: frames[frames.length - 1],
        commitMs: w.__committedAt - w.__upAt,
      };
    });
    console.log(`[perf] 4096x2048 brush drag: ${JSON.stringify(stats)}`);
    expect(stats.frames).toBeGreaterThan(10);
    // Smoke budgets, generous for CI: the median frame is at 60 Hz pace, and
    // committing one stroke op to the 4k mask (plus the React commit) is quick.
    expect(stats.median).toBeLessThan(onCi ? 50 : 25);
    expect(stats.commitMs).toBeLessThan(onCi ? 1000 : 250);

    // The DM's mask really was updated: a point on the path is undimmed.
    await expectMapPixel(page, "dm-map-stage", [1200, 1500], [0x3b, 0x3b, 0x3b]);
    await expectMapPixel(player, "player-map-stage", [1200, 1500], [0x3b, 0x3b, 0x3b]);
  });

  test("pan while the brush is armed: a Space-drag and a middle-drag move the DM viewport without painting, keys arm tools, ? lists the shortcuts (T018)", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    await importFixture(page);
    await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "0");
    const surface = page.getByTestId("dm-canvas-surface");
    const tabpanel = page.getByTestId("dm-tabpanel");
    const chip = page.getByTestId("tool-status");
    const blur = () =>
      page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Arm the brush by key from the Maps tab: the Fog tab opens, the chip shows the key.
    await blur();
    await page.keyboard.press("b");
    await expect(tabpanel).toHaveAttribute("data-tab", "fog");
    await expect(page.getByTestId("fog-tool-brush")).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toContainText("Fog · reveal brush");
    await expect(page.getByTestId("tool-status-key")).toHaveText("B");
    await expect(dmStage(page)).toHaveAttribute("data-tool", "active");
    await expect(surface).toHaveCSS("cursor", "crosshair");

    // Space-drag: the viewport moves by the drag, the tool stays armed, nothing is painted.
    const before = await stageTransform(page, "dm-map-stage");
    const cx = before.box.x + before.box.width / 2;
    const cy = before.box.y + before.box.height / 2;
    await page.mouse.move(cx, cy);
    await page.keyboard.down("Space");
    await expect(surface).toHaveAttribute("data-pan-override", "space");
    await expect(surface).toHaveCSS("cursor", "grab");
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 50, { steps: 4 });
    await expect(dmStage(page)).toHaveAttribute("data-panning", "true");
    await expect(dmStage(page)).toHaveAttribute("data-tool", "active");
    await page.mouse.up();
    await page.keyboard.up("Space");
    await expect(dmStage(page)).toHaveAttribute("data-panning", "false");
    await expect(surface).toHaveAttribute("data-pan-override", "none");
    const afterSpace = await stageTransform(page, "dm-map-stage");
    expect(afterSpace.vx - before.vx).toBeCloseTo(80, 0);
    expect(afterSpace.vy - before.vy).toBeCloseTo(50, 0);
    expect(afterSpace.scale).toBe(before.scale);
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "0");
    await expect(surface).toHaveAttribute("data-fogging", "reveal");
    await expect(surface).toHaveAttribute("data-fog-gesture", "idle");
    await expect(surface).toHaveCSS("cursor", "crosshair");
    await expect(page.getByTestId("fog-tool-brush")).toHaveAttribute("aria-pressed", "true");

    // Middle-drag: the same, with no key held.
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cx - 30, cy + 20, { steps: 4 });
    await expect(dmStage(page)).toHaveAttribute("data-panning", "true");
    await page.mouse.up({ button: "middle" });
    await expect(dmStage(page)).toHaveAttribute("data-panning", "false");
    const afterMiddle = await stageTransform(page, "dm-map-stage");
    expect(afterMiddle.vx - afterSpace.vx).toBeCloseTo(-30, 0);
    expect(afterMiddle.vy - afterSpace.vy).toBeCloseTo(20, 0);
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "0");
    await expect(surface).toHaveAttribute("data-fogging", "reveal");

    // Released: a normal drag reveals, under the moved viewport.
    await dragMap(page, [
      [90, 100],
      [230, 100],
    ]);
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(page, "dm-map-stage", [160, 100], FIXTURE_RGB);

    // More keys: mode and tool, stop, tabs.
    await page.keyboard.press("h");
    await expect(surface).toHaveAttribute("data-fogging", "hide");
    await page.keyboard.press("x");
    await expect(surface).toHaveAttribute("data-fog-tool", "rect");
    await expect(page.getByTestId("tool-status-key")).toHaveText("X");
    await page.keyboard.press("3");
    await expect(tabpanel).toHaveAttribute("data-tab", "tokens");
    await expect(chip).toContainText("Fog · hide rectangle");
    await page.keyboard.press("v");
    await expect(chip).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-fogging", "false");
    await expect(tabpanel).toHaveAttribute("data-tab", "tokens");

    // Inside the campaign-name input a key is just typing.
    await page.keyboard.press("1");
    await expect(tabpanel).toHaveAttribute("data-tab", "maps");
    const name = page.getByTestId("campaign-name-input");
    await name.fill("Camp");
    await name.press("b");
    await name.press("2");
    await expect(name).toHaveValue("Campb2");
    await expect(chip).toHaveCount(0);
    await expect(tabpanel).toHaveAttribute("data-tab", "maps");

    // The cheat sheet: ? opens it, Esc closes it and only it.
    await blur();
    await page.keyboard.press("b");
    await expect(surface).toHaveAttribute("data-fogging", "hide");
    await page.keyboard.press("?");
    const help = page.getByTestId("shortcut-help");
    await expect(help).toBeVisible();
    await expect(help.getByTestId("shortcut-row")).toHaveCount(18);
    await expect(help).toContainText("Space + drag");
    await expect(help).toContainText("Fog: brush");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-fogging", "hide");
    await expect(chip).toContainText("Fog · hide brush");
    await page.keyboard.press("Escape");
    await expect(surface).toHaveAttribute("data-fogging", "false");
    await expect(chip).toHaveCount(0);
    await page.getByTestId("shortcut-help-button").click();
    await expect(help).toBeVisible();
    await page.getByTestId("shortcut-help-close").click();
    await expect(help).toHaveCount(0);
  });

  test("a long op log is compacted into a PNG mask, which both windows render from", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await importFixture(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await playerShowsFixture(player, mapId);

    // Alternate reveal / hide up to the threshold; the last op hides.
    await openTab(page, "fog");
    for (let i = 0; i < FOG_COMPACT_AT; i++) {
      await page.getByTestId(i % 2 === 0 ? "fog-reveal-all" : "fog-hide-all").click();
    }
    const kept = FOG_KEEP_OPS;
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", String(kept));
    await expect(dmStage(page)).toHaveAttribute("data-fog-history", String(FOG_COMPACT_AT));
    await expect(page.getByTestId("fog-panel")).toContainText("on a saved mask");

    // The baked PNG is a real image asset owned by the campaign and referenced by the map.
    await expect
      .poll(async () => (await stored(page)).maps[0]?.fogOps)
      .toBe(kept);
    const doc = await stored(page);
    expect(doc.maps[0].fogOpsFrom).toBe(FOG_COMPACT_AT - kept);
    const mask = doc.assets.find((a) => a.kind === "fog-mask");
    expect(mask).toBeDefined();
    expect(mask!.type).toBe("image/png");
    expect(mask!.size).toBeGreaterThan(0);
    expect(doc.maps[0].fogMaskAssetId).toBe(mask!.id);
    expect(doc.assets.filter((a) => a.kind === "fog-mask")).toHaveLength(1);

    // Both windows end up rendering base + remaining ops, with the same result.
    await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
    await expect(playerStage(player)).toHaveAttribute("data-fog-status", "ready");
    await expect(playerStage(player)).toHaveAttribute("data-fog-history", String(FOG_COMPACT_AT));
    await expectPixel(player, "player-map-stage", BLACK);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED);
    await page.getByTestId("fog-reveal-all").click();
    await expectPixel(player, "player-map-stage", FIXTURE_RGB);
    await expectPixel(page, "dm-map-stage", FIXTURE_RGB);

    // After a reload the DM rebuilds from the PNG and the log.
    await expect.poll(async () => (await stored(page)).maps[0]?.fogOps).toBe(kept + 1);
    await page.reload();
    await expect(dmStage(page)).toHaveAttribute("data-map-id", mapId);
    await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
    await expect(dmStage(page)).toHaveAttribute("data-fog-history", String(FOG_COMPACT_AT + 1));
    await expectPixel(page, "dm-map-stage", FIXTURE_RGB);
    await openTab(page, "fog");
    await page.getByTestId("fog-hide-all").click();
    await expectPixel(player, "player-map-stage", BLACK);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED);
  });
});
