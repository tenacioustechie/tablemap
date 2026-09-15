/**
 * Initiative on the TV (T111) in real Chromium, on the gridded fixture
 * (`openGriddedMap`) with the whole map revealed and one disc token added
 * mid-map. The DM builds an order on the Turns tab — Xan, the token, Zed —
 * and turns the strip on from the toolbar: the player page shows a thin
 * strip along its top edge with the three names; each **Next** moves the
 * highlighted chip within one delta (the player's `data-sync-seq` + 1). On
 * the token's turn the TV rings the token (gold pixels on the ring), and
 * stops ringing it while it is hidden from players or under fog, while the
 * DM canvas keeps its ring and the strip keeps the name. A quarter turn of
 * the player view puts the strip along the physical right edge, still thin
 * and topmost there; blackout and the splash are the element under the
 * strip's middle while they are up. A long order scrolls to keep the
 * current chip inside the strip, and the switch — toolbar or Turns tab —
 * takes the strip away again.
 *
 * DOM overlays are checked with `elementFromPoint`; ring pixels by
 * compositing the player stage's layer canvases (`expectMapPixel`).
 */
import { test, expect, type Page } from "@playwright/test";
import { corner, expectMapPixel, GRID, GRID_FIXTURE_RGB, openGriddedMap, openTab } from "./helpers";

const DM = "dm-map-stage";
const PLAYER = "player-map-stage";
/** `map/TokenLayer.tsx`: TURN_RING_COLOR (#ffd24a) and TURN_RING_GAP_PX. */
const GOLD = [0xff, 0xd2, 0x4a] as const;
const RING_GAP_PX = 4;
/** Where a new token lands: the centre of cell (3, 2), top-left (162, 107). */
const TOKEN_CENTRE: [number, number] = [corner(3, 2)[0] + GRID.cellSize / 2, corner(3, 2)[1] + GRID.cellSize / 2];

const playerView = (player: Page) => player.getByTestId("player-view");
const strip = (player: Page) => player.getByTestId("player-initiative-strip");
const chips = (player: Page) => player.getByTestId("player-initiative-entry");
const currentChip = (player: Page) => player.locator('[data-testid="player-initiative-entry"][data-current="true"]');
const seqOf = async (player: Page) => Number(await playerView(player).getAttribute("data-sync-seq"));

/** A map point on the top of the ring round the token, clear of the fixture's grid lines. */
async function ringTop(player: Page): Promise<[number, number]> {
  const scale = Number(await player.getByTestId(PLAYER).getAttribute("data-scale"));
  return [TOKEN_CENTRE[0], TOKEN_CENTRE[1] - GRID.cellSize / 2 - RING_GAP_PX / scale];
}

/** The test id of the element under a page point, or of its nearest ancestor that has one. */
function testIdAt(player: Page, x: number, y: number): Promise<string> {
  return player.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-testid]");
      return el?.dataset.testid ?? "";
    },
    { x, y }
  );
}

async function stripMiddle(player: Page): Promise<{ x: number; y: number }> {
  const box = (await strip(player).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function addEntry(page: Page, name: string, value: string) {
  await page.getByTestId("initiative-name").fill(name);
  await page.getByTestId("initiative-value").fill(value);
  await page.getByTestId("initiative-add").click();
}

async function setTokenHidden(page: Page, hidden: boolean) {
  await openTab(page, "tokens");
  if ((await page.getByTestId("token-editor").count()) === 0) {
    await page.getByTestId("token-item").getByRole("button").click();
  }
  const box = page.getByTestId("token-hidden");
  if (hidden) await box.check();
  else await box.uncheck();
}

test.describe("initiative on the TV (T111)", () => {
  test("the strip follows Next along the top edge, turns with the view, sits under blackout and splash; the ring shows only round a visible token", async ({
    page,
  }) => {
    const { player } = await openGriddedMap(page);
    await openTab(page, "fog");
    await page.getByTestId("fog-reveal-all").click();
    await openTab(page, "tokens");
    await page.getByTestId("token-add").click();
    await expect(page.getByTestId(DM)).toHaveAttribute("data-tokens", "1");
    const tokenId = (await page.getByTestId("token-editor").getAttribute("data-token-id"))!;
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-tokens-shown", "1");

    // The order: Xan, the token (linked), Zed.
    await openTab(page, "turns");
    await addEntry(page, "Xan", "20");
    await page.getByTestId("initiative-value").fill("15");
    await page.getByTestId("initiative-add-token").selectOption(tokenId);
    await addEntry(page, "Zed", "5");
    await expect(page.getByTestId("initiative-item")).toHaveCount(3);

    // Off until the DM turns it on.
    await expect(playerView(player)).toHaveAttribute("data-initiative-strip", "false");
    await expect(strip(player)).toHaveCount(0);
    await page.getByTestId("initiative-strip-toggle").click();
    await expect(page.getByTestId("initiative-strip-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("initiative-strip-checkbox")).toBeChecked();
    await expect(playerView(player)).toHaveAttribute("data-initiative-strip", "true");
    await expect(strip(player)).toBeVisible();
    await expect(chips(player)).toHaveText(["Xan", "Token 1", "Zed"]);
    await expect(player.getByTestId("player-initiative-round")).toHaveText("Round 1");
    await expect(currentChip(player)).toHaveCount(0);

    // Along the top edge, thin.
    const page0 = await player.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const top = (await strip(player).boundingBox())!;
    expect(top.y).toBeCloseTo(0, 0);
    expect(top.x).toBeCloseTo(0, 0);
    expect(top.width).toBeCloseTo(page0.width, 0);
    expect(top.height).toBeGreaterThan(10);
    expect(top.height).toBeLessThanOrEqual(page0.height * 0.08);

    // Next on the DM: the highlight moves within one delta.
    const seq = await seqOf(player);
    await page.getByTestId("initiative-next").click();
    await expect(currentChip(player)).toHaveText("Xan");
    await expect(playerView(player)).toHaveAttribute("data-sync-seq", String(seq + 1));
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", "");

    // The token's turn: highlighted, and ringed on the TV because the players can see it.
    await page.getByTestId("initiative-next").click();
    await expect(currentChip(player)).toHaveText("Token 1");
    await expect(playerView(player)).toHaveAttribute("data-sync-seq", String(seq + 2));
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", tokenId);
    await expect(page.getByTestId(DM)).toHaveAttribute("data-turn-ring", tokenId);
    await expectMapPixel(player, PLAYER, await ringTop(player), GOLD, 24);

    // Hidden from players: no ring on the TV; the DM keeps its ring, the strip its name.
    await setTokenHidden(page, true);
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-tokens-shown", "0");
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", "");
    await expect(page.getByTestId(DM)).toHaveAttribute("data-turn-ring", tokenId);
    await expect(currentChip(player)).toHaveText("Token 1");
    await expectMapPixel(player, PLAYER, await ringTop(player), GRID_FIXTURE_RGB, 12);
    await setTokenHidden(page, false);
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", tokenId);

    // Under fog: the same.
    await openTab(page, "fog");
    await page.getByTestId("fog-hide-all").click();
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-tokens-shown", "0");
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", "");
    await expect(page.getByTestId(DM)).toHaveAttribute("data-turn-ring", tokenId);
    await page.getByTestId("fog-reveal-all").click();
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", tokenId);
    await expectMapPixel(player, PLAYER, await ringTop(player), GOLD, 24);

    // The strip is the topmost thing along its edge...
    let middle = await stripMiddle(player);
    expect(await testIdAt(player, middle.x, middle.y)).toMatch(/^player-initiative-/);

    // ...until the blackout or the splash covers it; it is there again when they lift.
    await page.getByTestId("blackout-toggle").click();
    await expect(player.getByTestId("player-blackout")).toBeVisible();
    expect(await testIdAt(player, middle.x, middle.y)).toBe("player-blackout");
    await page.getByTestId("blackout-toggle").click();
    await expect(player.getByTestId("player-blackout")).toHaveCount(0);
    expect(await testIdAt(player, middle.x, middle.y)).toMatch(/^player-initiative-/);
    await page.getByTestId("splash-toggle").click();
    await expect(player.getByTestId("player-splash")).toBeVisible();
    expect(await testIdAt(player, middle.x, middle.y)).toMatch(/^player-splash/);
    await page.getByTestId("splash-toggle").click();
    await expect(player.getByTestId("player-splash")).toHaveCount(0);

    // A quarter turn: the strip runs down the physical right edge, readable from that side.
    await openTab(page, "table");
    await page.getByLabel("Rotate player view clockwise").click();
    await expect(playerView(player)).toHaveAttribute("data-rotation", "90");
    await expect(strip(player).locator("xpath=..")).toHaveAttribute("data-rotation", "90");
    await expect
      .poll(async () => {
        const box = (await strip(player).boundingBox())!;
        return Math.round(box.x + box.width);
      })
      .toBe(page0.width);
    const turned = (await strip(player).boundingBox())!;
    expect(turned.y).toBeCloseTo(0, 0);
    expect(turned.height).toBeCloseTo(page0.height, 0);
    expect(turned.width).toBeCloseTo(top.height, 0);
    expect(turned.width).toBeLessThanOrEqual(page0.height * 0.08);
    await expect(currentChip(player)).toHaveText("Token 1");
    middle = await stripMiddle(player);
    expect(await testIdAt(player, middle.x, middle.y)).toMatch(/^player-initiative-/);
    await page.getByLabel("Rotate player view counter-clockwise").click();
    await expect(playerView(player)).toHaveAttribute("data-rotation", "0");
    await expect.poll(async () => Math.round((await strip(player).boundingBox())!.y)).toBe(0);

    // A long order scrolls to keep the current chip inside the strip.
    await openTab(page, "turns");
    for (let i = 1; i <= 16; i++) {
      await page.getByTestId("initiative-name").fill(`Goblin warrior ${i}`);
      await page.getByTestId("initiative-name").press("Enter");
    }
    await expect(chips(player)).toHaveCount(19);
    const list = player.getByTestId("player-initiative-list");
    const inView = async () => {
      const outer = (await list.boundingBox())!;
      const chip = (await currentChip(player).boundingBox())!;
      return chip.x >= outer.x - 1 && chip.x + chip.width <= outer.x + outer.width + 1 ? "in view" : "clipped";
    };
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByTestId("initiative-item").last().click();
    await expect(currentChip(player)).toHaveText("Goblin warrior 16");
    await expect.poll(inView).toBe("in view");
    await page.getByTestId("initiative-item").first().click();
    await expect(currentChip(player)).toHaveText("Xan");
    await expect.poll(inView).toBe("in view");

    // Off from the Turns tab, back on and off from the toolbar.
    await page.getByTestId("initiative-strip-checkbox").uncheck();
    await expect(strip(player)).toHaveCount(0);
    await expect(page.getByTestId("initiative-strip-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("initiative-strip-toggle").click();
    await expect(strip(player)).toBeVisible();
    await page.getByTestId("initiative-strip-toggle").click();
    await expect(strip(player)).toHaveCount(0);
    await expect(playerView(player)).toHaveAttribute("data-initiative-strip", "false");
    // The ring does not depend on the strip.
    await page.getByTestId("initiative-item").nth(1).click();
    await expect(player.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", tokenId);
  });
});
