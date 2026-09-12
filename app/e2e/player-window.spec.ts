import { test, expect, type Page } from "@playwright/test";

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

test.describe("player window", () => {
  test("DM page opens the player page in a new window", async ({ page }) => {
    await page.goto("/#/dm");
    await expect(page.getByTestId("dm-sidebar")).toBeVisible();
    await expect(page.getByTestId("dm-canvas")).toBeVisible();
    await expect(page.getByTestId("player-window-status")).toHaveText(
      "Player view: closed"
    );

    const player = await openPlayer(page);
    await expect(player).toHaveURL(/#\/player$/);
    await expect(player.getByTestId("player-view")).toBeVisible();
    await expect(page.getByTestId("player-window-status")).toHaveText(
      "Player view: open"
    );
    // Opener retains the handle.
    expect(await player.evaluate(() => window.opener !== null)).toBe(true);
  });

  test("player page has no DM controls or chrome", async ({ page }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);

    await expect(player.getByTestId("player-view")).toBeVisible();
    await expect(player.getByTestId("dm-view")).toHaveCount(0);
    await expect(player.getByTestId("dm-controls")).toHaveCount(0);
    await expect(player.getByTestId("dm-sidebar")).toHaveCount(0);
    await expect(player.getByRole("button")).toHaveCount(0);
    await expect(player.getByRole("link")).toHaveCount(0);
    await expect(player.getByRole("heading")).toHaveCount(0);

    const background = await player.evaluate(() =>
      getComputedStyle(document.documentElement).backgroundColor
    );
    expect(background).toBe("rgb(0, 0, 0)");
  });

  test("clicking Open again reuses the existing player window", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    await openPlayer(page);
    const before = page.context().pages().length;
    await page.getByRole("button", { name: "Open player view" }).click();
    // Give a second popup a chance to appear if the code were wrong.
    await page.waitForTimeout(300);
    expect(page.context().pages().length).toBe(before);
  });

  test("DM can close the player window from its retained handle", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await Promise.all([
      player.waitForEvent("close"),
      page.getByRole("button", { name: "Close player view" }).click(),
    ]);
    await expect(page.getByTestId("player-window-status")).toHaveText(
      "Player view: closed"
    );
    await expect(
      page.getByRole("button", { name: "Close player view" })
    ).toBeDisabled();
  });

  test("fullscreen toggle targets the player window", async ({ page }) => {
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    const fullscreen = page.getByRole("button", {
      name: "Fullscreen player view",
    });
    await expect(fullscreen).toBeEnabled();
    await fullscreen.click();

    // Browsers may refuse a cross-window fullscreen request without a gesture
    // in the target window. Either outcome must be surfaced to the DM.
    const status = page.getByTestId("player-window-status");
    const hint = page.getByTestId("fullscreen-hint");
    await expect(status.or(hint).first()).toBeVisible();
    const entered = (await status.textContent()) === "Player view: fullscreen";
    if (entered) {
      expect(
        await player.evaluate(() => document.fullscreenElement !== null)
      ).toBe(true);
      await page
        .getByRole("button", { name: "Exit player fullscreen" })
        .click();
      await expect(status).toHaveText("Player view: open");
    } else {
      await expect(hint).toBeVisible();
      // The in-window fallback: F key inside the player page.
      await player.keyboard.press("f");
      await expect
        .poll(() => player.evaluate(() => document.fullscreenElement !== null))
        .toBe(true);
    }
  });
});
