import { test, expect } from "@playwright/test";

test("routes render", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "TableMap" })).toBeVisible();
  await page.goto("/#/player");
  await expect(page.getByTestId("player-view")).toBeVisible();
});
