import { test, expect, type Page } from "@playwright/test";

/** Reads campaign names straight from IndexedDB, bypassing the app. */
function storedCampaignNames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("campaigns").objectStore("campaigns").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(
              (all.result as { name: string }[]).map((c) => c.name).sort()
            );
          };
        };
      })
  );
}

const nameInput = (page: Page) => page.getByTestId("campaign-name-input");

test.describe("persistence", () => {
  test("reloading the DM window restores the last campaign", async ({ page }) => {
    await page.goto("/#/dm");
    await expect(nameInput(page)).toHaveValue("Untitled campaign");

    await nameInput(page).fill("Curse of Strahd");
    await expect.poll(() => storedCampaignNames(page)).toEqual(["Curse of Strahd"]);

    await page.reload();
    await expect(nameInput(page)).toHaveValue("Curse of Strahd");
    await expect.poll(() => storedCampaignNames(page)).toEqual(["Curse of Strahd"]);
  });

  test("campaign manager creates, lists, renames and deletes campaigns", async ({
    page,
  }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("campaign-list-empty")).toBeVisible();

    await page.getByLabel("New campaign name").fill("Tomb of Annihilation");
    await page.getByRole("button", { name: "Create campaign" }).click();
    await expect(nameInput(page)).toHaveValue("Tomb of Annihilation");

    await page.getByRole("link", { name: "TableMap" }).click();
    const item = page.getByTestId("campaign-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId("campaign-item-name")).toHaveText(
      "Tomb of Annihilation"
    );
    await expect(item.getByTestId("campaign-open-badge")).toBeVisible();

    await item.getByRole("button", { name: "Rename" }).click();
    await item.getByLabel("Campaign name", { exact: true }).fill("Tomb");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(item.getByTestId("campaign-item-name")).toHaveText("Tomb");

    await item.getByRole("button", { name: "Open" }).click();
    await expect(nameInput(page)).toHaveValue("Tomb");

    await page.getByRole("link", { name: "TableMap" }).click();
    await item.getByRole("button", { name: "Delete" }).click();
    await item.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByTestId("campaign-list-empty")).toBeVisible();
    await expect.poll(() => storedCampaignNames(page)).toEqual([]);
  });
});
