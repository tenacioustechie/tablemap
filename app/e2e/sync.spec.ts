import { test, expect, type Page } from "@playwright/test";

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

const nameInput = (page: Page) => page.getByTestId("campaign-name-input");
const playerTitle = (player: Page) => player.getByTestId("player-campaign-name");

test.describe("DM -> player sync", () => {
  test("a value changed on the DM page appears on the player page", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await expect(player.getByTestId("player-view")).toHaveAttribute(
      "data-sync-status",
      "synced"
    );
    await expect(playerTitle(player)).toHaveCount(0);

    await nameInput(page).fill("Curse of Strahd");
    await expect(playerTitle(player)).toHaveText("Curse of Strahd");

    await nameInput(page).fill("Tomb of Annihilation");
    await expect(playerTitle(player)).toHaveText("Tomb of Annihilation");

    await nameInput(page).fill("");
    await expect(playerTitle(player)).toHaveCount(0);
  });

  test("a player opened after edits receives the full state via snapshot", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    await nameInput(page).fill("Set before open");
    const player = await openPlayer(page);
    await expect(playerTitle(player)).toHaveText("Set before open");
  });

  test("reloading the player window recovers full state and keeps syncing", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await nameInput(page).fill("Before reload");
    await expect(playerTitle(player)).toHaveText("Before reload");

    await player.reload();
    await expect(player.getByTestId("player-view")).toHaveAttribute(
      "data-sync-status",
      "synced"
    );
    await expect(playerTitle(player)).toHaveText("Before reload");

    await nameInput(page).fill("After reload");
    await expect(playerTitle(player)).toHaveText("After reload");
  });

  test("a stand-alone player tab waits, then syncs when the DM appears", async ({
    page,
    context,
  }) => {
    const player = await context.newPage();
    await player.goto("/#/player");
    await expect(player.getByTestId("player-view")).toHaveAttribute(
      "data-sync-status",
      "connecting"
    );

    await page.goto("/#/dm");
    await expect(player.getByTestId("player-view")).toHaveAttribute(
      "data-sync-status",
      "synced"
    );
    await nameInput(page).fill("Late DM");
    await expect(playerTitle(player)).toHaveText("Late DM");
  });

  test("the player page carries no way to change state", async ({ page }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await nameInput(page).fill("Read only");
    await expect(playerTitle(player)).toHaveText("Read only");
    await expect(player.getByRole("textbox")).toHaveCount(0);
    await expect(player.getByRole("button")).toHaveCount(0);
    await expect(player.locator("[contenteditable]")).toHaveCount(0);
  });
});
