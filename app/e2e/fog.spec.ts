/**
 * Fog of war (T007) in real Chromium: new maps are black on the player
 * screen and dimmed on the DM canvas; a rectangle revealed on the DM page
 * shows map pixels on the player page; hide all / reveal all; the reveal
 * reaches the player within the latency budget; fog survives scene
 * switches, a DM reload and a player reload; and a long op log is compacted
 * into a PNG mask that both windows render from.
 *
 * Pixels are read by compositing every layer canvas of a stage onto one
 * canvas in the page (a screenshot of that region, without decoding PNGs
 * in the test runner) and sampling a point.
 */
import { test, expect, type Page } from "@playwright/test";

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

async function importFixture(page: Page) {
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
    await page.getByTestId("fog-reveal-rect-button").click();
    await expect(page.getByTestId("fog-hint")).toBeVisible();
    const box = (await dmStage(page).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 40, cy - 30);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
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
    await expect(page.getByTestId("fog-reveal-rect-button")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fog-reveal-rect-button")).toHaveAttribute("aria-pressed", "false");
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
    await page.getByLabel("Blank map name").fill("Arena");
    await page.getByLabel("Columns").fill("12");
    await page.getByLabel("Rows").fill("8");
    await page.getByLabel("Cell size", { exact: true }).fill("50");
    await page.getByLabel("Background colour").fill("#224466");
    await page.getByRole("button", { name: "Create blank map" }).click();
    const arenaId = (await dmStage(page).getAttribute("data-map-id"))!;
    await expect(playerStage(player)).toHaveAttribute("data-map-id", arenaId);
    await expect(page.getByTestId("fog-op-count")).toHaveText("0");
    // Sampled just off centre: the arena's centre sits on a grid line.
    await expectPixel(player, "player-map-stage", BLACK, 0.52, 0.52);
    await expectPixel(page, "dm-map-stage", [0x11, 0x22, 0x33], 0.52, 0.52);

    await page.getByRole("button", { name: "Show map" }).click();
    await playerShowsFixture(player, mapId);
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
    await page.getByTestId("fog-hide-all").click();
    await expectPixel(player, "player-map-stage", BLACK);
    await expectPixel(page, "dm-map-stage", FIXTURE_DIMMED);
  });
});
