/**
 * Vision (T106) in real Chromium, on the gridded fixture with its grid typed
 * in (the gridded-map helpers from `helpers.ts`, shared with
 * `walls.spec.ts`): a room two cells wide and three high (x 12–112,
 * y 57–207) walled by mouse, with a door in its right wall (y 107–157), and
 * a disc token added mid-map, outside the room.
 *
 * Dragged into the room without vision, the token shows no preview and
 * reveals nothing. Vision 6 typed into the token editor reveals the room at
 * once; Ctrl+Z takes it back. Dragged by mouse to the next cell, the DM
 * canvas previews what it would see — mid-drag the fog is punched through
 * inside the room under the preview tint — while the player's sync seq does
 * not move; the drop sends the move and then one reveal, which shows exactly
 * the room: map-coloured inside on the DM canvas and the player, fogged
 * below the room and beyond the closed door. Ctrl+Z undoes it. Opening the
 * door reveals beyond the doorway at once, closing it hides nothing, and
 * undo takes the two re-runs back one step each; with the door open (its
 * re-run undone) the next drop looks through it; undo again.
 *
 * Pixels are sampled at cell centres, clear of the grid lines, the walls,
 * the token and the reveal's feathered edge (`expectMapPixel`).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  clickMap,
  corner,
  dragMap,
  expectMapPixel,
  GRID,
  GRID_FIXTURE_RGB,
  openGriddedMap,
  openTab,
} from "./helpers";

const DM = "dm-map-stage";
const PLAYER = "player-map-stage";
const MAP_RGB = GRID_FIXTURE_RGB;
const BLACK = [0, 0, 0] as const;
/** The fixture under the DM's half-opaque fog. */
const MAP_DIMMED = MAP_RGB.map((c) => Math.round(c / 2));
/** The fixture with the fog punched through and the reveal preview's tint, rgba(255, 204, 102, 0.2), over it. */
const MAP_PREVIEWED = [255, 204, 102].map((c, i) => Math.round(c * 0.2 + MAP_RGB[i] * 0.8));

/** Centre of grid cell (column, row), in map pixels. */
const cellCentre = (column: number, row: number): [number, number] => {
  const [x, y] = corner(column, row);
  return [x + GRID.cellSize / 2, y + GRID.cellSize / 2];
};

/** Where a new token lands: the map's centre (200, 150), snapped to cell (3, 2). */
const START = cellCentre(3, 2);
/** Two seats in the room, both level with the doorway. */
const SEAT_A = cellCentre(0, 2);
const SEAT_B = cellCentre(1, 2);
/** Inside the room, below the seats. */
const INSIDE = cellCentre(0, 3);
/** Outside, below the room: behind the bottom wall from both seats, door open or not. */
const BELOW = cellCentre(1, 5);
/** Outside, straight through the doorway from both seats (where the token started). */
const BEYOND = cellCentre(3, 2);

interface StoredToken {
  x: number;
  y: number;
  vision: number;
}

/** The first map's first token in the autosaved document. */
function storedToken(page: Page): Promise<StoredToken | undefined> {
  return page.evaluate(
    () =>
      new Promise<StoredToken | undefined>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (campaigns.result as { state: { maps: { tokens: StoredToken[] }[] } }[])[0];
            resolve(campaign?.state.maps[0]?.tokens[0]);
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

test.describe("vision (T106)", () => {
  test("a seeing token reveals its room on drop after a live preview, looks through an open door, and undo takes each reveal back", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { player } = await openGriddedMap(page);
    const dmStage = page.getByTestId(DM);
    const surface = page.getByTestId("dm-canvas-surface");
    const playerStage = player.getByTestId(PLAYER);
    const playerView = player.getByTestId("player-view");
    const undo = () => page.keyboard.press("Control+z");

    // ---- the room: five walls clicked corner to corner (Esc ends the polyline), then the door.
    await openTab(page, "walls");
    await page.getByTestId("wall-tool-wall").click();
    for (const point of [corner(2, 3), corner(2, 4), corner(0, 4), corner(0, 1), corner(2, 1), corner(2, 2)]) {
      await clickMap(page, point);
    }
    await page.keyboard.press("Escape");
    await expect(surface).toHaveAttribute("data-walls", "5");
    await page.getByTestId("wall-tool-door").click();
    await dragMap(page, corner(2, 2), corner(2, 3));
    await expect(surface).toHaveAttribute("data-walls", "6");
    await expect(surface).toHaveAttribute("data-doors-open", "0");
    await page.getByTestId("wall-stop").click();
    await expect(surface).toHaveAttribute("data-wall-tool", "none");

    // ---- a disc token lands outside the room, without vision.
    await openTab(page, "tokens");
    await page.getByTestId("token-add").click();
    await expect(dmStage).toHaveAttribute("data-tokens", "1");
    await expect.poll(() => storedToken(page)).toMatchObject({ x: 162, y: 107, vision: 0 });
    await expect(dmStage).toHaveAttribute("data-fog-ops", "0");

    // ---- dragged into the room without vision: no preview, and the move is all that is sent.
    const seqBlind = Number(await playerView.getAttribute("data-sync-seq"));
    await dragMap(page, START, SEAT_A, async () => {
      await expect(surface).toHaveAttribute("data-token-tool", "active");
      await expectMapPixel(page, DM, INSIDE, MAP_DIMMED);
      await expect(surface).toHaveAttribute("data-vision-preview", "0");
    });
    await expect.poll(() => storedToken(page)).toMatchObject({ x: 12, y: 107 });
    await expect(playerView).toHaveAttribute("data-sync-seq", String(seqBlind + 1));
    await expect(dmStage).toHaveAttribute("data-fog-ops", "0");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");

    // ---- vision 6 from the token editor reveals the room at once; Ctrl+Z takes it back.
    await page.getByTestId("token-vision").fill("6");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, INSIDE, MAP_RGB);
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);
    await page.getByTestId("token-vision").blur();
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, INSIDE, BLACK);

    // ---- dragged by mouse to the next cell: a live preview on the DM canvas, nothing sent until release.
    const seqDrag = Number(await playerView.getAttribute("data-sync-seq"));
    await dragMap(page, SEAT_A, SEAT_B, async () => {
      await expect(surface).not.toHaveAttribute("data-vision-preview", "0");
      await expectMapPixel(page, DM, INSIDE, MAP_PREVIEWED);
      await expectMapPixel(page, DM, BELOW, MAP_DIMMED);
      await expect(dmStage).toHaveAttribute("data-fog-ops", "0");
      await expect(playerView).toHaveAttribute("data-sync-seq", String(seqDrag));
    });
    await expect(surface).toHaveAttribute("data-vision-preview", "0");
    // The drop: the move, then one reveal — exactly the room, on both screens.
    await expect(playerView).toHaveAttribute("data-sync-seq", String(seqDrag + 2));
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expect(dmStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, INSIDE, MAP_RGB);
    await expectMapPixel(page, DM, INSIDE, MAP_RGB);
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    await expectMapPixel(page, DM, BELOW, MAP_DIMMED);
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);
    await expectMapPixel(page, DM, BEYOND, MAP_DIMMED);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, INSIDE, BLACK);
    await expectMapPixel(page, DM, INSIDE, MAP_DIMMED);

    // ---- opening the door re-runs vision at once: the doorway's far side appears. Closing it hides nothing.
    await openTab(page, "walls");
    await page.getByTestId("door-toggle").click();
    await expect(playerView).toHaveAttribute("data-doors-open", "1");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, BEYOND, MAP_RGB);
    await expectMapPixel(player, PLAYER, INSIDE, MAP_RGB);
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    await page.getByTestId("door-toggle").click();
    await expect(playerView).toHaveAttribute("data-doors-open", "0");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "2");
    await expectMapPixel(player, PLAYER, BEYOND, MAP_RGB);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, BEYOND, MAP_RGB);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);

    // ---- the door open again and its re-run undone (doors are not undone): the next drop looks through it.
    await page.getByTestId("door-toggle").click();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expect(playerView).toHaveAttribute("data-doors-open", "1");
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);
    await dragMap(page, SEAT_B, SEAT_A);
    await expect.poll(() => storedToken(page)).toMatchObject({ x: 12, y: 107, vision: 6 });
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, BEYOND, MAP_RGB);
    await expectMapPixel(page, DM, BEYOND, MAP_RGB);
    await expectMapPixel(player, PLAYER, INSIDE, MAP_RGB);
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);
  });
});
