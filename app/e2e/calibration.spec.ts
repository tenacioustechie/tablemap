/**
 * Physical calibration (T006) against real Chromium: the player window
 * reports its screen, the ruler screen shows a square of the requested size,
 * saving locks the player scale so a cell is that many CSS pixels whatever
 * the map's cell size, overview un-locks it visibly, and the calibration
 * comes back after reloading the player window and the DM window.
 */
import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./helpers";

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

async function createBlankMap(page: Page, name: string, cellSize: number) {
  await openTab(page, "maps");
  await page.getByLabel("Blank map name").fill(name);
  await page.getByLabel("Cell size", { exact: true }).fill(String(cellSize));
  await page.getByRole("button", { name: "Create blank map" }).click();
  await expect(page.getByTestId("dm-map-stage")).toHaveAttribute("data-map-name", name);
}

/** Names of the maps in the stored campaign document, straight from IndexedDB. */
function storedMapNames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("campaigns");
          const campaigns = tx.objectStore("campaigns").getAll();
          tx.oncomplete = () => {
            db.close();
            const docs = campaigns.result as { state: { maps: { name: string }[] } }[];
            resolve(docs.flatMap((doc) => doc.state.maps.map((m) => m.name)));
          };
        };
      })
  );
}

const playerView = (player: Page) => player.getByTestId("player-view");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");

test.describe("physical calibration", () => {
  test("ruler calibration locks the player scale per cell size, overview un-locks it, reloads keep it", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "uncalibrated");

    // The DM learns which display the player window is on.
    await openTab(page, "table");
    const status = page.getByTestId("calibration-status");
    await expect(status).toContainText(/Player display \d+×\d+/);
    await expect(status).toContainText(/not calibrated/i);

    // Ruler screen: a square of exactly the requested CSS pixels.
    await page.getByTestId("start-ruler-calibration").click();
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrating");
    const target = player.getByTestId("calibration-target");
    await expect(target).toHaveAttribute("data-size-px", "96");
    await page.getByRole("button", { name: "Grow by 10" }).click();
    await expect(target).toHaveAttribute("data-size-px", "106");
    expect(await target.evaluate((el) => el.getBoundingClientRect().width)).toBe(106);

    await page.getByTestId("save-ruler-calibration").click();
    await expect(status).toContainText(/calibrated, 106\.0 px per inch/);
    await expect(player.getByTestId("calibration-target")).toHaveCount(0);

    // Locked scale: cell size × scale == 106 for maps with different cell sizes.
    await createBlankMap(page, "Fifty", 50);
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
    await expect(playerStage(player)).toHaveAttribute("data-map-name", "Fifty");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "2.1200");
    await createBlankMap(page, "Hundred", 100);
    await expect(playerStage(player)).toHaveAttribute("data-map-name", "Hundred");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0600");

    // Overview visibly un-calibrates.
    await openTab(page, "table");
    await page.getByTestId("overview-toggle").check();
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "overview");
    await expect(player.getByTestId("player-overview-badge")).toContainText(/not to scale/i);
    await expect(playerStage(player)).not.toHaveAttribute("data-scale", "1.0600");
    await page.getByTestId("overview-toggle").uncheck();
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
    await expect(player.getByTestId("player-overview-badge")).toHaveCount(0);

    // A reloaded player window gets its calibration again.
    await player.reload();
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0600");

    // A reloaded DM window learns the display from the open player and reapplies it.
    // (Wait for autosave first so the reloaded DM opens the campaign with both maps.)
    await expect.poll(() => storedMapNames(page)).toEqual(["Fifty", "Hundred"]);
    await page.reload();
    await openTab(page, "table");
    await expect(page.getByTestId("calibration-status")).toContainText(/calibrated, 106\.0 px per inch/);
    await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0600");

    // The player is still chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);
  });

  test("TV size calibration and 25 mm cells", async ({ page }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await openTab(page, "table");
    await expect(page.getByTestId("calibration-status")).toContainText(/Player display/);

    await page.getByLabel("TV resolution width").fill("1920");
    await page.getByLabel("TV resolution height").fill("1080");
    await page.getByLabel("TV diagonal in inches").fill("55");
    // hypot(1920, 1080) / 55 / devicePixelRatio(1) = 40.05 px/in
    await expect(page.getByTestId("tv-size-preview")).toHaveText("40.1 px per inch");
    await page.getByRole("button", { name: "Use TV size" }).click();
    await expect(page.getByTestId("calibration-status")).toContainText(/from the TV size/);

    await createBlankMap(page, "Arena", 40);
    await expect(playerStage(player)).toHaveAttribute("data-scale", "1.0013");

    await openTab(page, "table");
    await page.getByLabel("Cell is 25 mm").check();
    // 40.0529 * 25 / 25.4 / 40 = 0.98555 -> "0.9856"
    await expect(playerStage(player)).toHaveAttribute("data-scale", "0.9856");
    await expect(page.getByTestId("calibration-status")).toContainText(/= 25 mm/);
  });
});
