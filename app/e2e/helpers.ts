/**
 * Shared Playwright helpers. Only the DM sidebar's tabs live here (T016):
 * every spec that reaches a panel control opens the tab that holds it first,
 * because inactive tab panels are not in the DOM.
 */
import { expect, type Page } from "@playwright/test";

export type DmTabId = "maps" | "fog" | "tokens" | "draw" | "table";

/** Clicks the tab and waits for its panel: `dm-tab-<id>` → `dm-tabpanel[data-tab=<id>]`. */
export async function openTab(page: Page, id: DmTabId): Promise<void> {
  await page.getByTestId(`dm-tab-${id}`).click();
  await expect(page.getByTestId("dm-tabpanel")).toHaveAttribute("data-tab", id);
}
