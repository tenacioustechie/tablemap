/**
 * The v2 session (T112): one DM's evening with walls, vision and initiative,
 * driven end to end in real Chromium against the "v2 done when" list in
 * `docs/spec.md`, in one flow on the gridded fixture with its grid typed in
 * (`openGriddedMap`):
 *
 *   1. a room two cells wide and three high (x 12–112, y 57–207) is walled
 *      by mouse, with a door in its right wall (y 107–157), well inside two
 *      minutes; a DM reload keeps the segments; a quarter turn of the map
 *      turns every endpoint, and turning back restores them exactly;
 *   2. a disc token, dragged into the room without vision, is given vision 6
 *      (which reveals the room at once; Ctrl+Z) and dragged to the next cell:
 *      the drop reveals exactly the room on the TV — walls block above,
 *      below and at the closed door — and Ctrl+Z removes it (Ctrl+Shift+Z
 *      brings it back for what follows);
 *   3. opening the door widens what the token sees on the TV through the
 *      doorway, out to the radius and no further; closing it re-hides
 *      nothing;
 *   4. what was seen through the door is now dimmed on the TV while the room
 *      stays bright; a second, manual-fog map revealed by hand shows no dim
 *      layer and plain map pixels;
 *   5. back on the first map, after Hide all: a click with the Fill tool
 *      reveals exactly the room's six cells as one `rects` op and stops at
 *      the closed door; with the door opened the next fill runs through it;
 *   6. an initiative list of five — one entry linked to the token — is sorted
 *      and run turn by turn through a full round into round 2 (and one step
 *      back) on the DM's Turns tab and on the TV strip, the current chip
 *      highlighted, the token ringed in gold on both screens on its turn;
 *
 * and finally criterion 1's export / import: the campaign is exported from
 * the manager and imported in a second browser context (its own IndexedDB),
 * where the walls, the door, the vision, the fog log and the initiative are
 * the same document, the DM canvas reports the same segments and a player
 * window there holds the walls and dims.
 *
 * Pixels are sampled at cell centres, clear of the grid lines, the walls,
 * the token and the reveals' feathered edges (`expectMapPixel`). Segments
 * are read from the DM surface's `data-wall-segments` (`kind:x1,y1,x2,y2`,
 * a door followed by `:open` or `:closed`).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  clickMap,
  corner,
  dragMap,
  expectMapPixel,
  GRID,
  GRID_FIXTURE_PATH,
  GRID_FIXTURE_RGB,
  mapPixel,
  nextFrame,
  openGriddedMap,
  openPlayer,
  openTab,
} from "./helpers";

const DM = "dm-map-stage";
const PLAYER = "player-map-stage";
const MAP_RGB = GRID_FIXTURE_RGB;
const BLACK = [0, 0, 0] as const;
/** Player (T107): revealed ground no token sees, under the dim (black at 0.6). */
const MAP_UNSEEN = MAP_RGB.map((c) => Math.round(c * 0.4));
/** `map/TokenLayer.tsx`: TURN_RING_COLOR (#ffd24a) and TURN_RING_GAP_PX. */
const GOLD = [0xff, 0xd2, 0x4a] as const;
const RING_GAP_PX = 4;
/** The fixture's size in map pixels. */
const MAP_SIZE = { width: 400, height: 300 } as const;

/** Centre of grid cell (column, row), in map pixels. */
const cellCentre = (column: number, row: number): [number, number] => {
  const [x, y] = corner(column, row);
  return [x + GRID.cellSize / 2, y + GRID.cellSize / 2];
};

/** Where a new token lands: the map's centre (200, 150), snapped to cell (3, 2). */
const START = cellCentre(3, 2);
/** The two seats in the room, level with the doorway: B first, A where the token stays. */
const SEAT_B = cellCentre(1, 2);
const SEAT_A = cellCentre(0, 2);
/** Room cells clear of the token on SEAT_A. */
const ROOM = [cellCentre(0, 1), cellCentre(1, 1), cellCentre(1, 2), cellCentre(0, 3), cellCentre(1, 3)];
/** Outside, above and below the room: behind its top and bottom walls from both seats, door open or not. */
const ABOVE = cellCentre(1, 0);
const BELOW = cellCentre(1, 5);
/** Outside, straight through the doorway from SEAT_A: 150 and 250 map px away, inside the 300 px radius. */
const BEYOND = cellCentre(3, 2);
const FAR = cellCentre(5, 2);
/** Straight through the doorway too, 353 px from SEAT_A: past vision 6's 300 px (6 × 50). */
const PAST_RADIUS: [number, number] = [390, SEAT_A[1]];
/** The middle of the door. */
const DOOR_MIDDLE: [number, number] = [corner(2, 2)[0], corner(2, 2)[1] + GRID.cellSize / 2];

interface Segment {
  kind: "wall" | "door";
  ends: [number, number, number, number];
}

/** The polyline clicked corner to corner, then the door dragged across the gap it leaves. */
const WALL_CLICKS = [corner(2, 3), corner(2, 4), corner(0, 4), corner(0, 1), corner(2, 1), corner(2, 2)];
const SEGMENTS: Segment[] = [
  ...WALL_CLICKS.slice(1).map((to, i): Segment => ({ kind: "wall", ends: [...WALL_CLICKS[i], ...to] })),
  { kind: "door", ends: [...corner(2, 2), ...corner(2, 3)] },
];

/** `data-wall-segments` for these segments, every door open or closed. */
function segmentsAttribute(segments: Segment[], doorOpen: boolean): string {
  return segments
    .map(({ kind, ends }) => {
      const entry = `${kind}:${ends.join(",")}`;
      return kind === "door" ? `${entry}:${doorOpen ? "open" : "closed"}` : entry;
    })
    .join(";");
}

/** A clockwise quarter turn of the map (`sceneRotation.ts: rotatePoint`): (x, y) → (H − y, x). */
function turnedClockwise(segments: Segment[]): Segment[] {
  return segments.map(({ kind, ends: [x1, y1, x2, y2] }) => ({
    kind,
    ends: [MAP_SIZE.height - y1, x1, MAP_SIZE.height - y2, x2],
  }));
}

interface StoredDoc {
  name: string;
  activeMapId: string | null;
  maps: {
    id: string;
    visionDim: string;
    walls: unknown[];
    fogOps: unknown[];
    tokens: { id: string; x: number; y: number; vision: number; hidden: boolean }[];
  }[];
  initiative: { entries: unknown[]; turn: number | null; round: number };
}

/** The campaign document straight from IndexedDB, reduced to what v2 added and where things stand. */
function storedDoc(page: Page): Promise<StoredDoc | null> {
  return page.evaluate(
    () =>
      new Promise<StoredDoc | null>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (campaigns.result as { name: string; state: Omit<StoredDoc, "name"> }[])[0];
            if (!campaign) return resolve(null);
            const { state } = campaign;
            resolve({
              name: campaign.name,
              activeMapId: state.activeMapId,
              maps: state.maps.map((m) => ({
                id: m.id,
                visionDim: m.visionDim,
                walls: m.walls,
                fogOps: m.fogOps,
                tokens: m.tokens.map((t) => ({ id: t.id, x: t.x, y: t.y, vision: t.vision, hidden: t.hidden })),
              })),
              initiative: state.initiative,
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

/** Polls until a stage shows `expected` at a point, and checks that it is a dim: darker than the map, lighter than black. */
async function expectUnseen(page: Page, testId: string, point: [number, number]) {
  await expectMapPixel(page, testId, point, MAP_UNSEEN);
  const actual = await mapPixel(page, testId, point);
  expect(actual.every((c, i) => c < MAP_RGB[i] - 8 && c > 8), `a dim, got ${actual.join(",")}`).toBe(true);
}

test.describe("session v2 (T112)", () => {
  test("walls and a door survive reload, rotation and export; vision reveals the room and looks through the door; the dim; click-fill; five in initiative on both screens", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const { player, mapId } = await openGriddedMap(page);
    await page.getByTestId("campaign-name-input").fill("Vision night");
    const dmStage = page.getByTestId(DM);
    const surface = page.getByTestId("dm-canvas-surface");
    const playerView = player.getByTestId("player-view");
    const playerStage = player.getByTestId(PLAYER);
    const undo = () => page.keyboard.press("Control+z");
    const closed = segmentsAttribute(SEGMENTS, false);

    // ---- 1. walls and a door, drawn by mouse in well under two minutes ------------------------------
    const startedAt = Date.now();
    await openTab(page, "walls");
    await page.getByTestId("wall-tool-wall").click();
    for (const point of WALL_CLICKS) await clickMap(page, point);
    await page.keyboard.press("Escape");
    await expect(surface).toHaveAttribute("data-walls", "5");
    await page.getByTestId("wall-tool-door").click();
    await dragMap(page, corner(2, 2), corner(2, 3));
    await expect(surface).toHaveAttribute("data-walls", "6");
    await page.getByTestId("wall-stop").click();
    await expect(surface).toHaveAttribute("data-wall-tool", "none");
    expect(Date.now() - startedAt).toBeLessThan(120_000);
    await expect(surface).toHaveAttribute("data-wall-segments", closed);
    await expect(page.getByTestId("wall-summary")).toHaveText("5 walls, 1 door.");
    await expect(playerView).toHaveAttribute("data-walls", "6");
    await expect(playerView).toHaveAttribute("data-doors-open", "0");

    // A reload keeps them; the player gets them in the fresh snapshot.
    await expect.poll(async () => (await storedDoc(page))?.maps[0]?.walls.length).toBe(6);
    await page.reload();
    await expect(dmStage).toHaveAttribute("data-map-id", mapId);
    await expect(surface).toHaveAttribute("data-wall-segments", closed);
    await expect(playerView).toHaveAttribute("data-sync-seq", "1");
    await expect(playerView).toHaveAttribute("data-walls", "6");

    // A quarter turn of the map turns every endpoint; turning back restores them exactly.
    await openTab(page, "maps");
    await page.getByTestId("map-rotate-cw").click();
    await expect(page.getByTestId("map-rotation-value")).toHaveText("90°");
    await expect(surface).toHaveAttribute("data-map-size", `${MAP_SIZE.height},${MAP_SIZE.width}`);
    await expect(surface).toHaveAttribute("data-wall-segments", segmentsAttribute(turnedClockwise(SEGMENTS), false));
    await expect(playerStage).toHaveAttribute("data-map-size", `${MAP_SIZE.height},${MAP_SIZE.width}`);
    await expect(playerView).toHaveAttribute("data-walls", "6");
    await page.getByTestId("map-rotate-ccw").click();
    await expect(page.getByTestId("map-rotation-value")).toHaveText("0°");
    await expect(surface).toHaveAttribute("data-wall-segments", closed);
    await expect(playerStage).toHaveAttribute("data-map-size", `${MAP_SIZE.width},${MAP_SIZE.height}`);
    await expect(page.getByLabel("Grid offset X")).toHaveValue(String(GRID.offsetX));
    await expect(page.getByLabel("Grid offset Y")).toHaveValue(String(GRID.offsetY));

    // ---- 2. vision 6 dropped in the room reveals exactly the room; undo removes it -------------------
    await openTab(page, "tokens");
    await page.getByTestId("token-add").click();
    await expect(dmStage).toHaveAttribute("data-tokens", "1");
    const tokenId = (await page.getByTestId("token-editor").getAttribute("data-token-id"))!;
    await expect.poll(async () => (await storedDoc(page))?.maps[0]?.tokens[0]).toMatchObject({ x: 162, y: 107 });
    await dragMap(page, START, SEAT_B);
    await expect.poll(async () => (await storedDoc(page))?.maps[0]?.tokens[0]).toMatchObject({ x: 62, y: 107 });
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expect(playerStage).toHaveAttribute("data-dim", "false");

    // Typed in, vision 6 reveals the room from where the token stands; Ctrl+Z takes it back.
    await page.getByTestId("token-vision").fill("6");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, ROOM[4], MAP_RGB);
    await page.getByTestId("token-vision").blur();
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, ROOM[4], BLACK);

    // Dropped on the next cell: the move and one reveal — exactly the room on the TV.
    const seqDrag = Number(await playerView.getAttribute("data-sync-seq"));
    await dragMap(page, SEAT_B, SEAT_A);
    await expect(playerView).toHaveAttribute("data-sync-seq", String(seqDrag + 2));
    await expect.poll(async () => (await storedDoc(page))?.maps[0]?.tokens[0]).toMatchObject({ x: 12, y: 107, vision: 6 });
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage).toHaveAttribute("data-tokens-shown", "1");
    for (const inside of ROOM) await expectMapPixel(player, PLAYER, inside, MAP_RGB);
    for (const outside of [ABOVE, BELOW, BEYOND, FAR]) await expectMapPixel(player, PLAYER, outside, BLACK);
    await undo();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "0");
    for (const inside of ROOM) await expectMapPixel(player, PLAYER, inside, BLACK);
    await page.keyboard.press("Control+Shift+z");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, PLAYER, ROOM[0], MAP_RGB);

    // ---- 3. the door opened widens the view through the doorway, out to the radius; closed, nothing re-hidden
    await openTab(page, "walls");
    await page.getByTestId("door-toggle").click();
    await expect(playerView).toHaveAttribute("data-doors-open", "1");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "2");
    await expectMapPixel(player, PLAYER, BEYOND, MAP_RGB);
    await expectMapPixel(player, PLAYER, FAR, MAP_RGB);
    await expectMapPixel(player, PLAYER, PAST_RADIUS, BLACK);
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    await expectMapPixel(player, PLAYER, ABOVE, BLACK);
    await page.getByTestId("door-toggle").click();
    await expect(playerView).toHaveAttribute("data-doors-open", "0");
    await expect(surface).toHaveAttribute("data-wall-segments", closed);

    // ---- 4. the dim: seen before but not now is dimmed on the TV; the room the token sees stays bright
    await expect(playerStage).toHaveAttribute("data-dim", "true");
    await expect(playerStage).toHaveAttribute("data-dim-polygons", "1");
    await expectUnseen(player, PLAYER, BEYOND);
    await expectUnseen(player, PLAYER, FAR);
    for (const inside of ROOM) await expectMapPixel(player, PLAYER, inside, MAP_RGB);
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    // The narrower view was revealed already: closing added no op.
    await expect(playerStage).toHaveAttribute("data-fog-ops", "2");

    // A manual-fog map: the fixture again, revealed by hand. No dim layer, plain map pixels.
    await openTab(page, "maps");
    await page.getByTestId("map-file-input").setInputFiles(GRID_FIXTURE_PATH);
    await expect(dmStage).not.toHaveAttribute("data-map-id", mapId);
    await expect(dmStage).toHaveAttribute("data-image-status", "loaded");
    const manualMapId = (await dmStage.getAttribute("data-map-id"))!;
    await expect(playerStage).toHaveAttribute("data-map-id", manualMapId);
    await expect(playerStage).toHaveAttribute("data-image-status", "loaded");
    await openTab(page, "fog");
    await expect(page.getByTestId("vision-dim-hint")).toHaveAttribute("data-uses-vision", "false");
    await page.getByTestId("fog-reveal-all").click();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage).toHaveAttribute("data-dim", "false");
    await expect(dmStage).toHaveAttribute("data-dim", "false");
    for (const point of [BEYOND, FAR, ROOM[4]]) await expectMapPixel(player, PLAYER, point, MAP_RGB);

    // Back to the vision map: the dim is there again.
    await openTab(page, "maps");
    await page.getByTestId("map-item").first().getByRole("button", { name: /^Show / }).click();
    await expect(dmStage).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage).toHaveAttribute("data-fog-status", "ready");
    await expect(playerStage).toHaveAttribute("data-dim", "true");
    await expectUnseen(player, PLAYER, BEYOND);

    // ---- 5. click-fill after Hide all: exactly the room, stopped by the closed door ------------------
    await openTab(page, "fog");
    await page.getByTestId("fog-hide-all").click();
    await expect(playerStage).toHaveAttribute("data-fog-ops", "3");
    await expectMapPixel(player, PLAYER, ROOM[0], BLACK);
    await expectMapPixel(player, PLAYER, BEYOND, BLACK);
    await page.keyboard.press("f");
    await expect(surface).toHaveAttribute("data-fog-tool", "fill");
    await expect(page.getByTestId("tool-status")).toContainText("Fog · reveal fill");
    await clickMap(page, ROOM[1]);
    await expect(page.getByTestId("fog-op-count")).toHaveText("4");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "4");
    const roomRects = { kind: "rects", rects: [12, 57, 100, 50, 12, 107, 100, 50, 12, 157, 100, 50] };
    await expect
      .poll(async () => (await storedDoc(page))?.maps[0]?.fogOps.at(-1))
      .toEqual({ type: "shape", mode: "reveal", shape: roomRects });
    for (const inside of ROOM) await expectMapPixel(player, PLAYER, inside, MAP_RGB);
    for (const outside of [BEYOND, FAR, ABOVE, BELOW]) await expectMapPixel(player, PLAYER, outside, BLACK);

    // The door clicked open (the fill stays armed; the token looks through), then a fill runs through it:
    // below the room, which the token cannot see, is revealed — dimmed — now.
    await nextFrame(page);
    await clickMap(page, DOOR_MIDDLE);
    await expect(playerView).toHaveAttribute("data-doors-open", "1");
    await expect(playerStage).toHaveAttribute("data-fog-ops", "5");
    await expect(surface).toHaveAttribute("data-fog-tool", "fill");
    await expectMapPixel(player, PLAYER, BELOW, BLACK);
    await clickMap(page, ROOM[4]);
    await expect(playerStage).toHaveAttribute("data-fog-ops", "6");
    await expectUnseen(player, PLAYER, BELOW);
    await expectUnseen(player, PLAYER, ABOVE);
    await clickMap(page, DOOR_MIDDLE);
    await expect(playerView).toHaveAttribute("data-doors-open", "0");
    await page.keyboard.press("Escape");
    await expect(dmStage).toHaveAttribute("data-tool", "none");

    // ---- 6. five in initiative, a full round on the DM and the TV strip, the token ringed on its turn -
    await openTab(page, "turns");
    const addEntry = async (name: string, value: string) => {
      await page.getByTestId("initiative-name").fill(name);
      await page.getByTestId("initiative-value").fill(value);
      await page.getByTestId("initiative-add").click();
    };
    await addEntry("Wolf", "4");
    await addEntry("Aria", "18");
    await page.getByTestId("initiative-value").fill("15");
    await page.getByTestId("initiative-add-token").selectOption(tokenId);
    await addEntry("Goblin", "9");
    await addEntry("Borin", "12");
    await expect(page.getByTestId("initiative-item")).toHaveCount(5);
    await page.getByTestId("initiative-sort").click();
    const order = ["Aria", "Token 1", "Borin", "Goblin", "Wolf"];
    await expect(page.getByTestId("initiative-item-name")).toHaveText(order);
    await expect(page.getByTestId("initiative-item").nth(1)).toHaveAttribute("data-linked", "true");

    const strip = player.getByTestId("player-initiative-strip");
    const chips = player.getByTestId("player-initiative-entry");
    const currentChip = player.locator('[data-testid="player-initiative-entry"][data-current="true"]');
    const currentItem = page.locator('[data-testid="initiative-item"][data-current="true"]');
    await page.getByTestId("initiative-strip-toggle").click();
    await expect(strip).toBeVisible();
    await expect(chips).toHaveText(order);
    await expect(player.getByTestId("player-initiative-round")).toHaveText("Round 1");
    await expect(currentChip).toHaveCount(0);

    const scale = Number(await playerStage.getAttribute("data-scale"));
    const ringTop: [number, number] = [SEAT_A[0], SEAT_A[1] - GRID.cellSize / 2 - RING_GAP_PX / scale];
    /** One turn: the DM's list, its status line and round, the TV's chip and round, and the ring on both. */
    const expectTurn = async (name: string, round: number) => {
      await expect(currentItem.getByTestId("initiative-item-name")).toHaveText(name);
      await expect(page.getByTestId("initiative-current")).toHaveText(`${name}'s turn.`);
      await expect(page.getByTestId("initiative-round")).toHaveText(`Round ${round}`);
      await expect(currentChip).toHaveText(name);
      await expect(player.getByTestId("player-initiative-round")).toHaveText(`Round ${round}`);
      const ringed = name === "Token 1" ? tokenId : "";
      await expect(playerStage).toHaveAttribute("data-turn-ring", ringed);
      await expect(dmStage).toHaveAttribute("data-turn-ring", ringed);
    };

    for (const [index, name] of order.entries()) {
      const seq = Number(await playerView.getAttribute("data-sync-seq"));
      await page.getByTestId("initiative-next").click();
      await expectTurn(name, 1);
      await expect(playerView).toHaveAttribute("data-sync-seq", String(seq + 1));
      if (index === 1) await expectMapPixel(player, PLAYER, ringTop, GOLD, 24);
      if (index === 2) await expectMapPixel(player, PLAYER, ringTop, MAP_RGB, 12);
    }
    // Next on the last entry starts round 2 at the top; Prev goes back to the end of round 1; Next again.
    await page.getByTestId("initiative-next").click();
    await expectTurn("Aria", 2);
    await page.getByTestId("initiative-prev").click();
    await expectTurn("Wolf", 1);
    await page.getByTestId("initiative-next").click();
    await expectTurn("Aria", 2);
    await page.getByTestId("initiative-next").click();
    await expectTurn("Token 1", 2);
    await expectMapPixel(player, PLAYER, ringTop, GOLD, 24);

    // ---- 1 (again). export on this machine, import on another: walls, door, vision, fog, initiative --
    await expect
      .poll(async () => (await storedDoc(page))?.initiative)
      .toMatchObject({ turn: 1, round: 2, entries: expect.arrayContaining([expect.anything()]) });
    await expect.poll(async () => (await storedDoc(page))?.maps[0]?.fogOps.length).toBe(
      Number(await dmStage.getAttribute("data-fog-ops"))
    );
    const original = (await storedDoc(page))!;
    expect(original.name).toBe("Vision night");
    expect(original.maps.map((m) => m.id)).toEqual([mapId, manualMapId]);
    expect(original.maps[0].walls).toHaveLength(6);
    expect(original.maps[0].tokens).toEqual([{ id: tokenId, x: 12, y: 107, vision: 6, hidden: false }]);
    expect(original.initiative.entries).toHaveLength(5);

    await page.getByRole("link", { name: "TableMap" }).click();
    const item = page.getByTestId("campaign-item");
    await expect(item).toHaveCount(1);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      item.getByRole("button", { name: "Export" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Vision-night.tablemap.zip");
    const archivePath = (await download.path())!;
    expect(archivePath).toBeTruthy();

    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await otherPage.goto(`${baseURL}/#/`);
      await expect(otherPage.getByTestId("campaign-list-empty")).toBeVisible();
      await otherPage.getByTestId("campaign-import-input").setInputFiles(archivePath);
      await expect(otherPage.getByTestId("campaign-manager-notice")).toHaveText('Imported "Vision night".');
      expect(await storedDoc(otherPage)).toEqual(original);

      await otherPage.getByTestId("campaign-item").getByRole("button", { name: "Open" }).click();
      const otherSurface = otherPage.getByTestId("dm-canvas-surface");
      await expect(otherPage.getByTestId(DM)).toHaveAttribute("data-map-id", mapId);
      await expect(otherSurface).toHaveAttribute("data-wall-segments", closed);
      await openTab(otherPage, "walls");
      await expect(otherPage.getByTestId("wall-summary")).toHaveText("5 walls, 1 door.");
      await expect(otherPage.getByTestId("door-select")).toHaveText("Door 1 · closed");
      await openTab(otherPage, "turns");
      await expect(otherPage.getByTestId("initiative-item-name")).toHaveText(order);
      await expect(otherPage.getByTestId("initiative-current")).toHaveText("Token 1's turn.");
      await expect(otherPage.getByTestId("initiative-round")).toHaveText("Round 2");
      await expect(otherPage.getByTestId(DM)).toHaveAttribute("data-turn-ring", tokenId);

      const otherPlayer = await openPlayer(otherPage);
      const otherPlayerView = otherPlayer.getByTestId("player-view");
      await expect(otherPlayerView).toHaveAttribute("data-sync-status", "synced");
      await expect(otherPlayer.getByTestId(PLAYER)).toHaveAttribute("data-map-id", mapId);
      await expect(otherPlayerView).toHaveAttribute("data-walls", "6");
      await expect(otherPlayerView).toHaveAttribute("data-doors-open", "0");
      await expect(otherPlayer.getByTestId(PLAYER)).toHaveAttribute("data-dim", "true");
      await expect(otherPlayer.getByTestId(PLAYER)).toHaveAttribute("data-turn-ring", tokenId);
    } finally {
      await other.close();
    }
  });
});
