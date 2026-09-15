/**
 * Vision (T106, T107) in real Chromium, on the gridded fixture with its grid
 * typed in (the gridded-map helpers from `helpers.ts`, shared with
 * `walls.spec.ts`): a room two cells wide and three high (x 12–112,
 * y 57–207) walled by mouse, with a door in its right wall (y 107–157), and
 * a disc token added mid-map, outside the room.
 *
 * The reveal (T106). Dragged into the room without vision, the token shows
 * no preview and reveals nothing. Vision 6 typed into the token editor
 * reveals the room at once; Ctrl+Z takes it back. Dragged by mouse to the
 * next cell, the DM canvas previews what it would see — mid-drag the fog is
 * punched through inside the room under the preview tint — while the
 * player's sync seq does not move; the drop sends the move and then one
 * reveal, which shows exactly the room: map-coloured inside on the DM canvas
 * and the player, fogged below the room and beyond the closed door (on the
 * DM canvas under the light dim too, since the token does not see there).
 * Ctrl+Z undoes it. Opening the door reveals beyond the doorway at once,
 * closing it hides nothing (the player shows it dimmed: revealed, no longer
 * seen), and undo takes the two re-runs back one step each; with the door
 * open (its re-run undone) the next drop looks through it; undo again.
 *
 * The dim (T107). The whole map is revealed by hand first, so vision adds no
 * fog op and every change on screen is the derived overlay's. With nobody
 * seeing there is no dim layer, and the player's composited pixels are
 * recorded. Vision 6 outside the room dims the room (behind its wall) and
 * leaves what the token sees bright, on both screens; `off` gives the
 * recorded pixels back exactly, `on` dims everything once nobody sees, and
 * `auto` with nobody seeing gives the recorded pixels back again. A drop
 * into the room moves the bright area there; opening the door widens it
 * through the doorway and closing it narrows it, the fog log unchanged.
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
  mapPixel,
  nextFrame,
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
/** Player (T107): revealed ground no token sees, under the dim (black at 0.6). */
const MAP_UNSEEN = MAP_RGB.map((c) => Math.round(c * 0.4));
/** DM canvas (T107): revealed ground no token sees, under the light dim (black at 0.25). */
const MAP_UNSEEN_DM = MAP_RGB.map((c) => Math.round(c * 0.75));
/** DM canvas (T107): fogged ground no token sees, under the half-opaque fog and the light dim. */
const MAP_DIMMED_UNSEEN_DM = MAP_RGB.map((c) => Math.round(c * 0.5 * 0.75));

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
/** Inside the room, behind its right wall from START (T107). */
const ROOM = cellCentre(1, 3);
/** Outside, two cells right of START and level with the doorway: seen from START, and from the seats only through the open door (T107). */
const EAST = cellCentre(5, 2);

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

/** The room: five walls clicked corner to corner (Esc ends the polyline), then the door; the tool put down. */
async function drawRoom(page: Page): Promise<void> {
  const surface = page.getByTestId("dm-canvas-surface");
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
}

/** A disc token added from the Tokens tab: it lands on START, without vision. */
async function addToken(page: Page): Promise<void> {
  await openTab(page, "tokens");
  await page.getByTestId("token-add").click();
  await expect(page.getByTestId(DM)).toHaveAttribute("data-tokens", "1");
  await expect.poll(() => storedToken(page)).toMatchObject({ x: 162, y: 107, vision: 0 });
}

/**
 * Everything a stage shows — its canvases composited over black, as
 * `mapPixel` does — as the canvas count, the size and an FNV-1a hash of
 * every pixel.
 */
function stagePixels(page: Page, testId: string): Promise<string> {
  return page.evaluate((id) => {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>(`[data-testid="${id}"] canvas`));
    if (canvases.length === 0) throw new Error("no stage canvases");
    const { width, height } = canvases[0];
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    for (const canvas of canvases) ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 0x01000193);
    return `${canvases.length} canvases, ${width}x${height}, #${(hash >>> 0).toString(16)}`;
  }, testId);
}

/** `stagePixels` once two readings an animation frame apart agree. */
async function settledPixels(page: Page, testId: string): Promise<string> {
  let last = await stagePixels(page, testId);
  for (let attempt = 0; attempt < 50; attempt++) {
    await nextFrame(page);
    const next = await stagePixels(page, testId);
    if (next === last) return next;
    last = next;
  }
  throw new Error(`${testId} never settled`);
}

/** Polls until a stage shows `expected` at a point, and checks that it is a dim: darker than the map, lighter than black. */
async function expectUnseen(page: Page, testId: string, point: [number, number], expected: readonly number[]) {
  await expectMapPixel(page, testId, point, expected);
  const actual = await mapPixel(page, testId, point);
  expect(actual.every((c, i) => c < MAP_RGB[i] - 8 && c > 8), `a dim, got ${actual.join(",")}`).toBe(true);
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

    // ---- the room with its door; a disc token lands outside it, without vision.
    await drawRoom(page);
    await addToken(page);
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
    await expect(dmStage).toHaveAttribute("data-dim", "false");

    // ---- vision 6 from the token editor reveals the room at once; Ctrl+Z takes it back.
    await page.getByTestId("token-vision").fill("6");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage).toHaveAttribute("data-dim", "true");
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
      await expectMapPixel(page, DM, BELOW, MAP_DIMMED_UNSEEN_DM);
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
    await expectMapPixel(page, DM, BELOW, MAP_DIMMED_UNSEEN_DM);
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);
    await expectMapPixel(page, DM, BEYOND, MAP_DIMMED_UNSEEN_DM);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, INSIDE, BLACK);
    await expectMapPixel(page, DM, INSIDE, MAP_DIMMED);

    // ---- opening the door re-runs vision at once: the doorway's far side appears. Closing it hides
    //      nothing: the far side stays revealed, dimmed now that the token no longer sees it (T107).
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
    await expectUnseen(player, PLAYER, BEYOND, MAP_UNSEEN);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectUnseen(player, PLAYER, BEYOND, MAP_UNSEEN);
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

test.describe("vision dim (T107)", () => {
  test("revealed ground no token sees is dimmed on the player; off, on and a manual-fog map; the bright area moves on a drop and widens with a door", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { player } = await openGriddedMap(page);
    const dmStage = page.getByTestId(DM);
    const playerStage = player.getByTestId(PLAYER);
    const playerView = player.getByTestId("player-view");
    const vision = page.getByTestId("token-vision");
    const dimSetting = page.getByTestId("vision-dim");
    const setVision = async (cells: string) => {
      await openTab(page, "tokens");
      await vision.fill(cells);
      await vision.blur();
    };
    const setDim = async (value: "auto" | "on" | "off") => {
      await openTab(page, "fog");
      await dimSetting.selectOption(value);
    };

    await drawRoom(page);
    await addToken(page);
    // Adding a token selects it: its editor is open.
    await expect(page.getByTestId("token-editor")).toBeVisible();

    // ---- a manual-fog map: all revealed by hand, nobody sees. No dim layer; the player's pixels are recorded.
    await openTab(page, "fog");
    await page.getByTestId("fog-reveal-all").click();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage).toHaveAttribute("data-image-status", "loaded");
    await expect(playerStage).toHaveAttribute("data-dim", "false");
    await expect(dmStage).toHaveAttribute("data-dim", "false");
    await expectMapPixel(player, PLAYER, ROOM, MAP_RGB);
    await expectMapPixel(player, PLAYER, EAST, MAP_RGB);
    await expectMapPixel(page, DM, ROOM, MAP_RGB);
    const manual = await settledPixels(player, PLAYER);

    // ---- vision 6 at START: bright where it sees, dimmed behind the room's wall — and no fog op added.
    await setVision("6");
    await expect(playerStage).toHaveAttribute("data-dim", "true");
    await expect(playerStage).toHaveAttribute("data-dim-polygons", "1");
    await expect(dmStage).toHaveAttribute("data-dim", "true");
    await expectMapPixel(player, PLAYER, EAST, MAP_RGB);
    await expectUnseen(player, PLAYER, ROOM, MAP_UNSEEN);
    await expectMapPixel(page, DM, EAST, MAP_RGB);
    await expectUnseen(page, DM, ROOM, MAP_UNSEEN_DM);
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    expect(await stagePixels(player, PLAYER)).not.toBe(manual);

    // ---- off removes the dim: the player's canvases and pixels are the manual map's, exactly.
    await setDim("off");
    await expect(playerStage).toHaveAttribute("data-dim", "false");
    await expect(dmStage).toHaveAttribute("data-dim", "false");
    await expect.poll(() => stagePixels(player, PLAYER)).toBe(manual);

    // ---- on forces it, even with nobody seeing: everything revealed is dimmed.
    await setDim("on");
    await expect(playerStage).toHaveAttribute("data-dim", "true");
    await setVision("0");
    await expect(playerStage).toHaveAttribute("data-dim-polygons", "0");
    await expect(playerStage).toHaveAttribute("data-dim", "true");
    await expectUnseen(player, PLAYER, EAST, MAP_UNSEEN);
    await expectUnseen(player, PLAYER, ROOM, MAP_UNSEEN);

    // ---- auto with nobody seeing: no dim layer, the manual map's pixels again.
    await setDim("auto");
    await expect(playerStage).toHaveAttribute("data-dim", "false");
    await expect.poll(() => stagePixels(player, PLAYER)).toBe(manual);

    // ---- vision 6 again, then the token dropped in the room (door closed): the bright area moves with it.
    await setVision("6");
    await expect(playerStage).toHaveAttribute("data-dim", "true");
    await expectMapPixel(player, PLAYER, EAST, MAP_RGB);
    await dragMap(page, START, SEAT_A);
    await expect.poll(() => storedToken(page)).toMatchObject({ x: 12, y: 107, vision: 6 });
    await expectMapPixel(player, PLAYER, ROOM, MAP_RGB);
    await expectUnseen(player, PLAYER, EAST, MAP_UNSEEN);
    await expectUnseen(player, PLAYER, BELOW, MAP_UNSEEN);
    await expectMapPixel(page, DM, ROOM, MAP_RGB);
    await expectUnseen(page, DM, EAST, MAP_UNSEEN_DM);
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");

    // ---- the door opened: the token sees through it at once, with no new reveal; closed again: dimmed again.
    await openTab(page, "walls");
    await page.getByTestId("door-toggle").click();
    await expect(playerView).toHaveAttribute("data-doors-open", "1");
    await expectMapPixel(player, PLAYER, EAST, MAP_RGB);
    await expectMapPixel(page, DM, EAST, MAP_RGB);
    await expectUnseen(player, PLAYER, BELOW, MAP_UNSEEN);
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await page.getByTestId("door-toggle").click();
    await expect(playerView).toHaveAttribute("data-doors-open", "0");
    await expectUnseen(player, PLAYER, EAST, MAP_UNSEEN);
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
  });
});
