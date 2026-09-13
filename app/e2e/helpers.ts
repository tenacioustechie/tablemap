/**
 * Shared Playwright helpers. The DM sidebar's tabs (T016): every spec that
 * reaches a panel control opens the tab that holds it first, because
 * inactive tab panels are not in the DOM. And the setup-once forms behind
 * disclosures (T019): the blank-map form and, once calibrated, the TV-size
 * fieldset.
 */
import { expect, type Page } from "@playwright/test";

export type DmTabId = "maps" | "fog" | "tokens" | "draw" | "table";

/** Clicks the tab and waits for its panel: `dm-tab-<id>` → `dm-tabpanel[data-tab=<id>]`. */
export async function openTab(page: Page, id: DmTabId): Promise<void> {
  await page.getByTestId(`dm-tab-${id}`).click();
  await expect(page.getByTestId("dm-tabpanel")).toHaveAttribute("data-tab", id);
}

/** Maps tab, "New blank map" open: the blank-map form is in the DOM. */
export async function openBlankMapForm(page: Page): Promise<void> {
  await openTab(page, "maps");
  const disclosure = page.getByTestId("blank-map-disclosure");
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
  await expect(page.getByTestId("blank-map-form")).toBeVisible();
}

/**
 * Table tab, TV-size fieldset in the DOM. It is open on its own while the
 * display is uncalibrated and behind a disclosure once it is calibrated.
 */
export async function openTvSizeForm(page: Page): Promise<void> {
  await openTab(page, "table");
  const disclosure = page.getByTestId("tv-size-disclosure");
  if ((await disclosure.count()) > 0 && (await disclosure.getAttribute("aria-expanded")) !== "true") {
    await disclosure.click();
  }
  await expect(page.getByTestId("calibration-tv-size")).toBeVisible();
}
