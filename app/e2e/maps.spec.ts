import { test, expect, type Page } from "@playwright/test";
import { openBlankMapForm, openTab } from "./helpers";

/** Served by the Vite dev server from the project root. */
const FIXTURE_URL = "/e2e/fixtures/map.png";
const FIXTURE_PATH = "e2e/fixtures/map.png"; // relative to app/ (Playwright cwd)
/** The fixture's interior colour (see the generator notes in docs/architecture.md). */
const FIXTURE_RGB = [230, 120, 20] as const;

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

/** Colour of the pixel at the centre of a stage's bottom (image) layer. */
function centrePixel(page: Page, stageTestId: string): Promise<number[]> {
  return page.evaluate((testId) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      `[data-testid="${testId}"] canvas`
    );
    if (!canvas) throw new Error("no stage canvas");
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    );
    return [data[0], data[1], data[2]];
  }, stageTestId);
}

const closeTo = (actual: number[], expected: readonly number[]) =>
  [0, 1, 2].every((i) => Math.abs(actual[i] - expected[i]) <= 3);

/** Konva draws on the next animation frame, so poll rather than sample once. */
async function expectCentreColour(
  page: Page,
  stageTestId: string,
  expected: readonly number[]
) {
  await expect
    .poll(async () => {
      const actual = await centrePixel(page, stageTestId);
      return closeTo(actual, expected) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

interface StoredSummary {
  maps: { name: string; imageAssetId: string | null }[];
  activeMapId: string | null;
  assets: { id: string; kind: string; size: number; isBlob: boolean }[];
}

/** Reads the campaign document and asset rows straight from IndexedDB. */
function stored(page: Page): Promise<StoredSummary> {
  return page.evaluate(
    () =>
      new Promise<StoredSummary>((resolve, reject) => {
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
                  maps: { name: string; imageAssetId: string | null }[];
                  activeMapId: string | null;
                };
              }[]
            )[0];
            resolve({
              maps: campaign?.state.maps ?? [],
              activeMapId: campaign?.state.activeMapId ?? null,
              assets: (assets.result as { id: string; kind: string; blob: Blob }[]).map(
                (a) => ({
                  id: a.id,
                  kind: a.kind,
                  size: a.blob?.size ?? 0,
                  isBlob: a.blob instanceof Blob,
                })
              ),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

const mapItems = (page: Page) => page.getByTestId("map-item");
const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");

async function importFixture(page: Page) {
  await page.getByTestId("map-file-input").setInputFiles(FIXTURE_PATH);
  await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
}

test.describe("map import + Konva stage", () => {
  test("an imported image renders on the DM canvas, persists as a Blob and survives reload", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    await openTab(page, "maps");
    await expect(page.getByTestId("map-list-empty")).toBeVisible();

    await importFixture(page);
    await expect(mapItems(page)).toHaveCount(1);
    await expect(mapItems(page).first().getByTestId("map-item-name")).toHaveText("map");
    await expect(mapItems(page).first()).toHaveAttribute("data-active", "true");
    await expect(dmStage(page)).toHaveAttribute("data-map-name", "map");
    await expectCentreColour(page, "dm-map-stage", FIXTURE_RGB);

    // Blob in IndexedDB + map record in the campaign document (autosave).
    await expect
      .poll(async () => (await stored(page)).maps.map((m) => m.name))
      .toEqual(["map"]);
    const before = await stored(page);
    expect(before.assets).toHaveLength(1);
    expect(before.assets[0]).toMatchObject({ kind: "map-image", isBlob: true });
    expect(before.assets[0].size).toBeGreaterThan(0);
    expect(before.maps[0].imageAssetId).toBe(before.assets[0].id);
    expect(before.activeMapId).not.toBeNull();

    await page.reload();
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    await expect(mapItems(page)).toHaveCount(1);
    await expectCentreColour(page, "dm-map-stage", FIXTURE_RGB);
    expect(await stored(page)).toEqual(before);
  });

  test("dropping an image file onto the DM view imports it", async ({ page }) => {
    await page.goto("/#/dm");
    await openTab(page, "maps");
    const dataTransfer = await page.evaluateHandle(async (url) => {
      const blob = await (await fetch(url)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "dropped-cave.png", { type: "image/png" }));
      return dt;
    }, FIXTURE_URL);
    const root = page.getByTestId("dm-view");
    await root.dispatchEvent("dragover", { dataTransfer });
    await expect(page.getByTestId("drop-overlay")).toBeVisible();
    await root.dispatchEvent("drop", { dataTransfer });
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
    await expect(mapItems(page).first().getByTestId("map-item-name")).toHaveText("dropped-cave");
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    await expectCentreColour(page, "dm-map-stage", FIXTURE_RGB);
  });

  test("the active map appears on the player page and scene switches follow", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    await openTab(page, "maps");
    const player = await openPlayer(page);
    await expect(player.getByTestId("player-campaign-name")).toHaveText("Untitled campaign");

    await importFixture(page);
    const imageMapId = await dmStage(page).getAttribute("data-map-id");
    await expect(playerStage(player)).toHaveAttribute("data-map-id", imageMapId!);
    await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
    await expect(player.getByTestId("player-campaign-name")).toHaveCount(0);
    await expectCentreColour(player, "player-map-stage", FIXTURE_RGB);

    // Blank gridded map with a chosen colour and size becomes the active scene.
    await openBlankMapForm(page);
    await page.getByLabel("Blank map name").fill("Arena");
    await page.getByLabel("Columns").fill("12");
    await page.getByLabel("Rows").fill("8");
    await page.getByLabel("Cell size", { exact: true }).fill("50");
    await page.getByLabel("Background colour").fill("#224466");
    await page.getByRole("button", { name: "Create blank map" }).click();
    await expect(mapItems(page)).toHaveCount(2);
    await expect(mapItems(page).nth(1).getByTestId("map-item-name")).toHaveText("Arena");
    await expect(mapItems(page).nth(1)).toContainText("600×400");
    const blankId = await dmStage(page).getAttribute("data-map-id");
    expect(blankId).not.toBe(imageMapId);
    await expect(playerStage(player)).toHaveAttribute("data-map-id", blankId!);
    await expect(playerStage(player)).toHaveAttribute("data-map-name", "Arena");
    await expectCentreColour(player, "player-map-stage", [0x22, 0x44, 0x66]);
    await expectCentreColour(page, "dm-map-stage", [0x22, 0x44, 0x66]);

    // Switch back: the player already holds the image, so it shows at once.
    await page.getByRole("button", { name: "Show map" }).click();
    await expect(playerStage(player)).toHaveAttribute("data-map-id", imageMapId!);
    await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
    await expectCentreColour(player, "player-map-stage", FIXTURE_RGB);

    // A reloaded player window gets the state and the image again.
    await player.reload();
    await expect(playerStage(player)).toHaveAttribute("data-map-id", imageMapId!);
    await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
    await expectCentreColour(player, "player-map-stage", FIXTURE_RGB);

    // The player page is still chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);
  });

  test("rename, duplicate and delete manage the map list", async ({ page }) => {
    await page.goto("/#/dm");
    await openTab(page, "maps");
    await importFixture(page);

    await page.getByRole("button", { name: "Rename map" }).click();
    await page.getByLabel("Map name", { exact: true }).fill("Crypt");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(mapItems(page).first().getByTestId("map-item-name")).toHaveText("Crypt");
    await expect(dmStage(page)).toHaveAttribute("data-map-name", "Crypt");

    await page.getByRole("button", { name: "Duplicate Crypt" }).click();
    await expect(mapItems(page)).toHaveCount(2);
    await expect(mapItems(page).nth(1).getByTestId("map-item-name")).toHaveText("Crypt (copy)");
    await expect(mapItems(page).nth(1)).toHaveAttribute("data-active", "true");
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    // The copy shares the image: still one asset.
    await expect.poll(async () => (await stored(page)).maps.length).toBe(2);
    expect((await stored(page)).assets).toHaveLength(1);

    await page.getByRole("button", { name: "Delete Crypt (copy)" }).click();
    await page.getByRole("button", { name: "Confirm delete Crypt (copy)" }).click();
    await expect(mapItems(page)).toHaveCount(1);
    await expect(dmStage(page)).toHaveCount(0); // the active map was deleted
    await expect.poll(async () => (await stored(page)).maps.length).toBe(1);
    expect((await stored(page)).assets).toHaveLength(1);

    await page.getByRole("button", { name: "Delete Crypt" }).click();
    await page.getByRole("button", { name: "Confirm delete Crypt" }).click();
    await expect(page.getByTestId("map-list-empty")).toBeVisible();
    await expect.poll(async () => (await stored(page)).assets.length).toBe(0);
  });

  test("wheel zooms and dragging pans the DM canvas", async ({ page }) => {
    await page.goto("/#/dm");
    await openTab(page, "maps");
    await importFixture(page);
    const stage = dmStage(page);
    const before = Number(await stage.getAttribute("data-scale"));
    const box = (await stage.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => stage.getAttribute("data-scale").then(Number)).toBeGreaterThan(before);
    await expect(page.getByTestId("canvas-zoom")).not.toHaveText(`${Math.round(before * 100)}%`);

    // Drag: the centre pixel moves off the map's interior after a big pan.
    await expectCentreColour(page, "dm-map-stage", FIXTURE_RGB);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 200, { steps: 5 });
    await page.mouse.move(cx + box.width, cy + box.height, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => closeTo(await centrePixel(page, "dm-map-stage"), FIXTURE_RGB))
      .toBe(false);

    await page.getByTestId("canvas-fit").click();
    await expect.poll(() => stage.getAttribute("data-scale").then(Number)).toBeCloseTo(before, 3);
    await expectCentreColour(page, "dm-map-stage", FIXTURE_RGB);
  });
});
