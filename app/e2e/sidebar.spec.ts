/**
 * The tabbed DM sidebar and the toolbar's tool status chip (T016) in real
 * Chromium: seven tabs (T101 added Walls, T110 Turns) with the ARIA tabs pattern and arrow keys, one panel
 * at a time; an armed fog brush survives a detour through the Tokens tab
 * and the chip says so throughout; the chip's Stop ends the tool and its
 * name opens the owning tab; the last tab is restored after a reload while
 * a fresh browser opens on Maps; and the Fog tab fits a 768 px-tall window.
 */
import { test, expect, type Page } from "@playwright/test";
import { openBlankMapForm, openTab, type DmTabId } from "./helpers";

const TABS: DmTabId[] = ["maps", "fog", "tokens", "turns", "draw", "walls", "table"];

async function createBlankMap(page: Page, name: string) {
  await openBlankMapForm(page);
  await page.getByLabel("Blank map name").fill(name);
  await page.getByLabel("Columns").fill("12");
  await page.getByLabel("Rows").fill("8");
  await page.getByLabel("Cell size", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Create blank map" }).click();
  await expect(page.getByTestId("dm-map-stage")).toHaveAttribute("data-map-name", name);
}

const tab = (page: Page, id: DmTabId) => page.getByTestId(`dm-tab-${id}`);
const panel = (page: Page) => page.getByTestId("dm-tabpanel");
const chip = (page: Page) => page.getByTestId("tool-status");
const stage = (page: Page) => page.getByTestId("dm-map-stage");

test.describe("DM sidebar tabs (T016)", () => {
  test("seven tabs in order, Maps first; each shows its own panels; arrow keys move between them", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    const tablist = page.getByRole("tablist", { name: "DM tools" });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab")).toHaveText(["Maps", "Fog", "Tokens", "Turns", "Draw", "Walls", "Table"]);
    for (const id of TABS) await expect(tab(page, id)).toHaveAttribute("data-testid", `dm-tab-${id}`);
    await expect(panel(page)).toHaveAttribute("data-tab", "maps");
    await expect(tab(page, "maps")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute("data-tab", "maps");

    // Maps: campaign name, map list, grid.
    await expect(page.getByTestId("campaign-name-input")).toBeVisible();
    await expect(page.getByTestId("map-panel")).toBeVisible();
    await expect(page.getByTestId("grid-panel")).toBeVisible();
    await expect(page.getByTestId("fog-panel")).toHaveCount(0);

    await openTab(page, "fog");
    await expect(page.getByTestId("fog-panel")).toBeVisible();
    await expect(page.getByTestId("map-panel")).toHaveCount(0);
    await expect(tab(page, "maps")).toHaveAttribute("aria-selected", "false");
    await expect(tab(page, "fog")).toHaveAttribute("aria-selected", "true");

    await openTab(page, "tokens");
    await expect(page.getByTestId("token-panel")).toBeVisible();
    await expect(page.getByTestId("fog-panel")).toHaveCount(0);

    await openTab(page, "turns");
    await expect(page.getByTestId("initiative-panel")).toBeVisible();
    await expect(page.getByTestId("token-panel")).toHaveCount(0);

    await openTab(page, "draw");
    await expect(page.getByTestId("annotation-panel")).toBeVisible();
    await expect(page.getByTestId("initiative-panel")).toHaveCount(0);

    await openTab(page, "walls");
    await expect(page.getByTestId("walls-panel")).toBeVisible();
    await expect(page.getByTestId("annotation-panel")).toHaveCount(0);

    await openTab(page, "table");
    await expect(page.getByTestId("calibration-panel")).toBeVisible();
    await expect(page.getByTestId("player-view-panel")).toBeVisible();
    await expect(page.getByTestId("walls-panel")).toHaveCount(0);

    // The toolbar is the same on every tab.
    await expect(page.getByTestId("blackout-toggle")).toBeVisible();
    await expect(page.getByTestId("splash-toggle")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open player view" })).toBeVisible();
    await expect(page.getByTestId("player-window-status")).toBeVisible();

    // Keyboard: Left / Right move (and wrap), the moved-to tab takes focus.
    await tab(page, "table").focus();
    await page.keyboard.press("ArrowRight");
    await expect(panel(page)).toHaveAttribute("data-tab", "maps");
    await expect(tab(page, "maps")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(panel(page)).toHaveAttribute("data-tab", "fog");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(panel(page)).toHaveAttribute("data-tab", "table");
    await expect(tab(page, "table")).toBeFocused();
  });

  test("another tab puts an armed fog brush down; the chip shows the tool, Stop ends it, its name opens the tab", async ({
    page,
  }) => {
    await page.goto("/#/dm");
    await expect(chip(page)).toHaveCount(0);
    await createBlankMap(page, "Arena");

    await openTab(page, "fog");
    await page.getByTestId("fog-tool-brush").click();
    await expect(page.getByTestId("fog-tool-brush")).toHaveAttribute("aria-pressed", "true");
    await expect(stage(page)).toHaveAttribute("data-tool", "active");
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toContainText("Fog · reveal brush");
    await expect(chip(page)).toHaveAttribute("data-tab", "fog");

    // Tokens: opening another tab puts the brush down (ADR 0028).
    await openTab(page, "tokens");
    await expect(page.getByTestId("fog-panel")).toHaveCount(0);
    await expect(chip(page)).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute("data-tool", "none");
    await page.getByTestId("token-add").click();
    await page.getByTestId("token-name").fill("Orc");
    await expect(page.getByTestId("token-item")).toContainText("Orc");

    await openTab(page, "fog");
    await expect(page.getByTestId("fog-tool-brush")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("fog-stop")).toHaveCount(0);

    // Stop from the chip: same as Esc.
    await page.getByTestId("fog-tool-brush").click();
    await expect(chip(page)).toContainText("Fog · reveal brush");
    await page.getByTestId("tool-stop").click();
    await expect(chip(page)).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute("data-tool", "none");
    await expect(page.getByTestId("fog-tool-brush")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("fog-stop")).toHaveCount(0);

    // Mode and tool are in the label; with the sidebar folded, the name click opens the owning tab.
    await page.getByTestId("fog-mode-hide").click();
    await page.getByTestId("fog-tool-rect").click();
    await expect(chip(page)).toContainText("Fog · hide rectangle");
    await page.getByTestId("sidebar-toggle").click();
    await expect(panel(page)).toHaveCount(0);
    await page.getByTestId("tool-status-name").click();
    await expect(panel(page)).toHaveAttribute("data-tab", "fog");
    await expect(page.getByTestId("fog-tool-rect")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(chip(page)).toHaveCount(0);

    // The other tools have chips too.
    await openTab(page, "draw");
    await page.getByTestId("draw-mode-draw").click();
    await expect(chip(page)).toContainText("Draw · pen");
    await page.getByTestId("draw-mode-erase").click();
    await expect(chip(page)).toContainText("Draw · eraser");
    await page.getByTestId("note-tool").click();
    await expect(chip(page)).toContainText("Place note");
    await expect(chip(page)).toHaveAttribute("data-tab", "draw");
    await page.getByTestId("tool-stop").click();
    await expect(chip(page)).toHaveCount(0);
    // Another tab puts the note tool down too.
    await page.getByTestId("note-tool").click();
    await expect(chip(page)).toContainText("Place note");
    await openTab(page, "maps");
    await expect(chip(page)).toHaveCount(0);
    await page.getByTestId("align-grid-button").click();
    await expect(chip(page)).toContainText("Align grid");
    await expect(chip(page)).toHaveAttribute("data-tab", "maps");
    await page.getByTestId("tool-stop").click();
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByTestId("align-hint")).toHaveCount(0);
  });

  test("the last tab is restored after a reload; a fresh browser opens on Maps", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/#/dm");
    await expect(panel(page)).toHaveAttribute("data-tab", "maps");
    await openTab(page, "tokens");
    expect(await page.evaluate(() => localStorage.getItem("tablemap.dm.tab"))).toBe("tokens");

    await page.reload();
    await expect(panel(page)).toHaveAttribute("data-tab", "tokens");
    await expect(page.getByTestId("token-panel")).toBeVisible();
    await expect(page.getByTestId("map-panel")).toHaveCount(0);

    await openTab(page, "table");
    await page.goto("about:blank");
    await page.goto("/#/dm");
    await expect(panel(page)).toHaveAttribute("data-tab", "table");

    const other = await browser.newContext();
    try {
      const fresh = await other.newPage();
      await fresh.goto(`${baseURL}/#/dm`);
      await expect(panel(fresh)).toHaveAttribute("data-tab", "maps");
      await expect(fresh.getByTestId("campaign-name-input")).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test("nothing scrolls off on a 768 px-tall window with the Fog tab open", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/#/dm");
    await createBlankMap(page, "Arena");
    await openTab(page, "fog");
    // The panel at its tallest: a tool armed, so the Stop button is showing too.
    await page.getByTestId("fog-tool-brush").click();
    await expect(page.getByTestId("fog-stop")).toBeVisible();
    await expect(chip(page)).toBeVisible();

    const fit = await panel(page).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      pageOverflow: document.documentElement.scrollHeight - innerHeight,
    }));
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    expect(fit.pageOverflow).toBeLessThanOrEqual(0);
    // First and last controls of the panel are fully on screen, unscrolled.
    await expect(page.getByTestId("fog-mode-reveal")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("fog-reveal-all")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("fog-op-count")).toBeInViewport({ ratio: 1 });
    expect(await panel(page).evaluate((el) => el.scrollTop)).toBe(0);
  });
});
