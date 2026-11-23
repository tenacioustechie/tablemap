/**
 * Wall and door tools (T102) in real Chromium, on the gridded fixture with
 * its grid typed in: a four-segment room drawn by clicking near its corners
 * (each click snaps to the corner), a door dragged between two corners,
 * both counted on the DM surface and on the player page (the mirror holds
 * the walls, draws none); Shift skips snapping; with no tool armed a click
 * on a wall selects it (a door is selected from the panel's list), a
 * dragged end handle moves it, Delete removes it, and the player follows
 * each change; a reload brings everything back from the autosaved document.
 *
 * Doors in play (T103): a click on a door opens and closes it with the fog
 * brush armed (painting nothing) and with no tool armed, the Walls panel's
 * door list and its toggle agree with the canvas, the player mirror's
 * `data-doors-open` follows, and a reload keeps the door open.
 *
 * Room fill (T108): two walled rooms sharing a wall with a door; the fog
 * Fill tool previews the hovered room on the DM canvas, a click adds exactly
 * one fog op holding the room's rects, which the player shows (map pixels
 * inside, black beyond the closed door and outside), and one undo takes it
 * back; a click on the door opens it and fills nothing, and the next fill
 * reaches the second room; hide mode hides both in one op.
 *
 * Map-pixel points are turned into screen coordinates from the DM stage's
 * `data-scale` and `data-viewport-x/y` (the gridded-map helpers in
 * `helpers.ts`); the segments are read back from the surface's
 * `data-wall-segments` (`kind:x1,y1,x2,y2;…`, a door followed by `:open` or
 * `:closed`).
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
  nextFrame,
  openGriddedMap,
  openPlayer,
  stageTransform,
  openTab,
  toScreen,
} from "./helpers";

/** Map pixels off a corner that a click still snaps from (12 screen px reach). */
const OFF = 3;

const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const dmSurface = (page: Page) => page.getByTestId("dm-canvas-surface");
const playerView = (player: Page) => player.getByTestId("player-view");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");

interface Segment {
  kind: string;
  ends: [number, number, number, number];
}

/** The DM surface's `data-wall-segments`, parsed. */
async function segments(page: Page): Promise<Segment[]> {
  const raw = (await dmSurface(page).getAttribute("data-wall-segments")) ?? "";
  if (raw === "") return [];
  return raw.split(";").map((entry) => {
    const [kind, coords] = entry.split(":");
    const [x1, y1, x2, y2] = coords.split(",").map(Number);
    return { kind, ends: [x1, y1, x2, y2] };
  });
}

interface StoredSegment {
  kind: string;
  open?: boolean;
  name?: string;
}

/** Every map's segments straight from IndexedDB (the autosaved document). */
function storedWalls(page: Page): Promise<StoredSegment[][]> {
  return page.evaluate(
    () =>
      new Promise<StoredSegment[][]>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (campaigns.result as { state: { maps: { walls: StoredSegment[] }[] } }[])[0];
            resolve((campaign?.state.maps ?? []).map((m) => m.walls));
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

/** Wall counts per map in the autosaved document. */
async function storedWallCounts(page: Page): Promise<number[]> {
  return (await storedWalls(page)).map((walls) => walls.length);
}

/** Every map's fog log straight from IndexedDB (the autosaved document). */
function storedFogOps(page: Page): Promise<unknown[][]> {
  return page.evaluate(
    () =>
      new Promise<unknown[][]>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (campaigns.result as { state: { maps: { fogOps: unknown[] }[] } }[])[0];
            resolve((campaign?.state.maps ?? []).map((m) => m.fogOps));
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

test.describe("walls and doors (T102)", () => {
  test("draw a room and a door by mouse, snapped to corners; select, move an end, delete; the player follows; a reload keeps them", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/#/dm");
    const player = await openPlayer(page);
    await expect(playerView(player)).toHaveAttribute("data-sync-status", "synced");

    // The gridded fixture with its grid typed in.
    await openTab(page, "maps");
    await page.getByTestId("map-file-input").setInputFiles(GRID_FIXTURE_PATH);
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await page.getByLabel("Grid cell size").fill(String(GRID.cellSize));
    await page.getByLabel("Grid offset X").fill(String(GRID.offsetX));
    await page.getByLabel("Grid offset Y").fill(String(GRID.offsetY));
    await expect(playerStage(player)).toHaveAttribute("data-map-id", mapId);
    await expect(playerView(player)).toHaveAttribute("data-walls", "0");

    // ---- a four-segment room: five clicks near the corners, Esc to finish.
    const startedAt = Date.now();
    await openTab(page, "walls");
    await page.getByTestId("wall-tool-wall").click();
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "wall");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-snap", "true");
    await expect(page.getByTestId("tool-status")).toContainText("Walls · wall");
    await expect(page.getByTestId("wall-hint")).toBeVisible();
    const [c11, c31, c33, c13] = [corner(1, 1), corner(3, 1), corner(3, 3), corner(1, 3)];
    await clickMap(page, [c11[0] + OFF, c11[1] - OFF]);
    await expect(dmSurface(page)).toHaveAttribute("data-wall-gesture", "drawing");
    await clickMap(page, [c31[0] - OFF, c31[1] + OFF]);
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "1");
    await clickMap(page, [c33[0] + OFF, c33[1] + OFF]);
    await clickMap(page, [c13[0] - OFF, c13[1] - OFF]);
    await clickMap(page, [c11[0] + OFF, c11[1] + OFF]);
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "4");
    await page.keyboard.press("Escape");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-gesture", "idle");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "wall"); // Esc ended the polyline, not the tool
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "4");
    expect(await segments(page)).toEqual([
      { kind: "wall", ends: [...c11, ...c31] },
      { kind: "wall", ends: [...c31, ...c33] },
      { kind: "wall", ends: [...c33, ...c13] },
      { kind: "wall", ends: [...c13, ...c11] },
    ]);

    // ---- a door on the right wall, dragged between two corners; a double-click ends the polyline too.
    await page.getByTestId("wall-tool-door").click();
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "door");
    await expect(page.getByTestId("tool-status")).toContainText("Walls · door");
    const c32 = corner(3, 2);
    await dragMap(page, [c31[0] + OFF, c31[1] - OFF], [c32[0] - OFF, c32[1] + OFF]);
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "5");
    expect((await segments(page))[4]).toEqual({ kind: "door", ends: [...c31, ...c32] });
    expect(Date.now() - startedAt).toBeLessThan(60_000);
    await expect(page.getByTestId("wall-summary")).toHaveText("4 walls, 1 door.");
    await expect(playerView(player)).toHaveAttribute("data-walls", "5");
    // The player page draws nothing of them and stays chrome-free.
    await expect(player.getByRole("button")).toHaveCount(0);

    await page.getByTestId("wall-tool-wall").click();
    const [c41, c43] = [corner(4, 1), corner(4, 3)];
    await clickMap(page, c41);
    await page.mouse.dblclick(...Object.values(await toScreen(page, c43)) as [number, number]);
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "6");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-gesture", "idle");
    expect((await segments(page))[5]).toEqual({ kind: "wall", ends: [...c41, ...c43] });

    // ---- Shift skips snapping: a door dragged near two corners lands where the pointer was.
    await page.getByTestId("wall-tool-door").click();
    await page.keyboard.down("Shift");
    await dragMap(page, [c13[0] + OFF, c13[1] + OFF], [c33[0] - OFF, c33[1] + OFF]);
    await page.keyboard.up("Shift");
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "7");
    const unsnapped = (await segments(page))[6];
    expect(unsnapped.kind).toBe("door");
    expect(Math.abs(unsnapped.ends[0] - c13[0])).toBeGreaterThan(1);
    expect(Math.abs(unsnapped.ends[2] - c33[0])).toBeGreaterThan(1);
    expect(Math.abs(unsnapped.ends[1] - c13[1])).toBeGreaterThan(1);

    // ---- stop the tool; select the unsnapped door from the panel's door list (a click on a door
    // on the canvas opens it, T103), delete it with the key.
    await page.getByTestId("wall-stop").click();
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "none");
    await expect(page.getByTestId("tool-status")).toHaveCount(0);
    const mid = (s: Segment): [number, number] => [(s.ends[0] + s.ends[2]) / 2, (s.ends[1] + s.ends[3]) / 2];
    await expect(page.getByTestId("door-select")).toHaveText(["Door 1 · closed", "Door 2 · closed"]);
    await page.getByTestId("door-select").nth(1).click();
    await expect(dmSurface(page)).not.toHaveAttribute("data-wall-selected", "");
    await expect(page.getByTestId("wall-selected")).toHaveAttribute("data-wall-kind", "door");
    await expect(page.getByTestId("wall-selected-kind")).toHaveText("door (closed)");
    await page.keyboard.press("Delete");
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "6");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-selected", "");
    await expect(page.getByTestId("wall-selected")).toHaveCount(0);
    await expect(playerView(player)).toHaveAttribute("data-walls", "6");

    // ---- select the top wall, drag its far end one cell to the right (snapped); the player gets the delta.
    const top = (await segments(page))[0];
    await nextFrame(page);
    await clickMap(page, mid(top));
    await expect(page.getByTestId("wall-selected-kind")).toHaveText("wall");
    await expect(page.getByTestId("wall-selected-length")).toHaveText("2 cells");
    const seqBefore = Number(await playerView(player).getAttribute("data-sync-seq"));
    const c41off: [number, number] = [c41[0] - OFF, c41[1] + OFF];
    await dragMap(page, c31, c41off);
    await expect.poll(async () => (await segments(page))[0]).toEqual({ kind: "wall", ends: [...c11, ...c41] });
    await expect(page.getByTestId("wall-selected-length")).toHaveText("3 cells");
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "6");
    await expect.poll(() => playerView(player).getAttribute("data-sync-seq").then(Number)).toBe(seqBefore + 1);
    await expect(playerView(player)).toHaveAttribute("data-walls", "6");
    // The panel's Delete removes the selected wall too; Esc would only deselect.
    await page.keyboard.press("Escape");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-selected", "");
    await nextFrame(page);
    await clickMap(page, mid((await segments(page))[5]));
    await page.getByTestId("wall-delete").click();
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "5");
    await expect(playerView(player)).toHaveAttribute("data-walls", "5");
    const before = await segments(page);
    expect(before).toHaveLength(5);
    expect(before[0]).toEqual({ kind: "wall", ends: [...c11, ...c41] });

    // ---- autosaved; a reload brings the same segments back, and the player gets them in the new snapshot.
    await expect.poll(() => storedWallCounts(page)).toEqual([5]);
    await page.reload();
    await expect(dmStage(page)).toHaveAttribute("data-map-id", mapId);
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "5");
    expect(await segments(page)).toEqual(before);
    await expect(playerView(player)).toHaveAttribute("data-sync-seq", "1");
    await expect(playerView(player)).toHaveAttribute("data-walls", "5");
    await openTab(page, "walls");
    await expect(page.getByTestId("wall-summary")).toHaveText("4 walls, 1 door.");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "none");
  });
});

test.describe("doors in play (T103)", () => {
  test("a click on a door opens and closes it with the fog brush armed or not; the panel, the player mirror and a reload agree", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { player, mapId } = await openGriddedMap(page);
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "0");

    // ---- one door, dragged between two corners.
    await openTab(page, "walls");
    await page.getByTestId("wall-tool-door").click();
    const [c11, c21] = [corner(1, 1), corner(2, 1)];
    await dragMap(page, c11, c21);
    await expect(dmSurface(page)).toHaveAttribute("data-walls", "1");
    const closed = `door:${c11},${c21}:closed`;
    const open = `door:${c11},${c21}:open`;
    await expect(dmSurface(page)).toHaveAttribute("data-wall-segments", closed);
    await expect(page.getByTestId("door-select")).toHaveText("Door 1 · closed");
    await expect(dmSurface(page)).toHaveAttribute("data-doors-open", "0");
    await page.getByTestId("wall-stop").click();
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "none");
    const doorMiddle: [number, number] = [(c11[0] + c21[0]) / 2, c11[1]];

    // ---- the door is labelled on the DM canvas as the panel names it (ADR 0028): a
    // door-coloured tag just above the doorway's middle; the player stage has none.
    await expect(dmSurface(page)).toHaveAttribute("data-door-labels", JSON.stringify(["D1"]));
    const { scale } = await stageTransform(page);
    // 14 screen px above the middle (DOOR_LABEL_OFFSET_PX), 9 px left: the tag's fill, clear of its text.
    const tagFill: [number, number] = [doorMiddle[0] - 9 / scale, doorMiddle[1] - 14 / scale];
    await expectMapPixel(page, "dm-map-stage", tagFill, [94, 230, 176], 16);

    // ---- the reveal brush armed (the Fog tab now open): a click on the door opens it and paints nothing.
    await page.keyboard.press("b");
    await expect(dmSurface(page)).toHaveAttribute("data-fogging", "reveal");
    await expect(page.getByTestId("dm-tabpanel")).toHaveAttribute("data-tab", "fog");
    await expect(dmSurface(page)).toHaveAttribute("data-doors-clickable", "true");
    const fogOps = (await dmStage(page).getAttribute("data-fog-ops"))!;
    await nextFrame(page);
    await clickMap(page, doorMiddle);
    await expect(dmSurface(page)).toHaveAttribute("data-wall-segments", open);
    await expect(dmSurface(page)).toHaveAttribute("data-doors-open", "1");
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "1");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", fogOps);
    await expect(dmSurface(page)).toHaveAttribute("data-fogging", "reveal");
    // Clicking again closes it; still no paint.
    await clickMap(page, doorMiddle);
    await expect(dmSurface(page)).toHaveAttribute("data-wall-segments", closed);
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "0");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", fogOps);

    // ---- no tool armed, the Walls tab open: the panel's toggle opens it, the canvas click closes it, the list follows.
    await page.keyboard.press("v");
    await expect(dmSurface(page)).toHaveAttribute("data-fogging", "false");
    await openTab(page, "walls");
    await expect(page.getByTestId("door-select")).toHaveText("Door 1 · closed");
    await page.getByTestId("door-toggle").click();
    await expect(page.getByTestId("door-select")).toHaveText("Door 1 · open");
    await expect(page.getByTestId("door-toggle")).toHaveText("Close");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-segments", open);
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "1");
    await nextFrame(page);
    await clickMap(page, doorMiddle);
    await expect(page.getByTestId("door-select")).toHaveText("Door 1 · closed");
    await expect(dmSurface(page)).toHaveAttribute("data-wall-segments", closed);
    await expect(dmSurface(page)).toHaveAttribute("data-wall-selected", "");
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "0");
    await clickMap(page, doorMiddle);
    await expect(page.getByTestId("door-select")).toHaveText("Door 1 · open");
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "1");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", fogOps);

    // ---- naming it (ADR 0030): pick it from the list, type a name, Enter. The list and the
    // canvas show the name, autosaved; the player's copy never carries it; it survives the reload below.
    await page.getByTestId("door-select").click();
    await page.getByTestId("door-name-input").fill("Secret door");
    await page.getByTestId("door-name-input").press("Enter");
    await expect(page.getByTestId("door-select")).toHaveText("Secret door · open");
    await expect(dmSurface(page)).toHaveAttribute("data-door-labels", JSON.stringify(["Secret door"]));
    await page.keyboard.press("Escape");

    // ---- autosaved open; a reload keeps it open, and the player's fresh snapshot carries it.
    await expect.poll(() => storedWalls(page)).toEqual([
      [expect.objectContaining({ kind: "door", open: true, name: "Secret door" })],
    ]);
    await page.reload();
    await expect(dmStage(page)).toHaveAttribute("data-map-id", mapId);
    await expect(dmSurface(page)).toHaveAttribute("data-wall-segments", open);
    await expect(dmSurface(page)).toHaveAttribute("data-doors-open", "1");
    await expect(playerView(player)).toHaveAttribute("data-sync-seq", "1");
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "1");
    await openTab(page, "walls");
    await expect(page.getByTestId("door-select")).toHaveText("Secret door · open");
    await expect(dmSurface(page)).toHaveAttribute("data-door-labels", JSON.stringify(["Secret door"]));
  });
});

test.describe("room fill (T108)", () => {
  const DM = "dm-map-stage";
  const PLAYER = "player-map-stage";
  const MAP_RGB = GRID_FIXTURE_RGB;
  const BLACK = [0, 0, 0] as const;
  /** The fixture under the DM's half-opaque fog. */
  const MAP_DIMMED = MAP_RGB.map((c) => Math.round(c / 2));
  /** The fixture with the fog punched through and the reveal preview's tint, rgba(255, 204, 102, 0.2), over it. */
  const MAP_PREVIEWED = [255, 204, 102].map((c, i) => Math.round(c * 0.2 + MAP_RGB[i] * 0.8));
  /** Centre of grid cell (column, row), in map pixels. */
  const centre = (column: number, row: number): [number, number] => {
    const [x, y] = corner(column, row);
    return [x + GRID.cellSize / 2, y + GRID.cellSize / 2];
  };

  test("a click fills exactly the walled room as one op the player mirrors; one undo step; a closed door stops it, an open one lets it through", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { player } = await openGriddedMap(page);
    const surface = dmSurface(page);
    const opCount = page.getByTestId("fog-op-count");
    const chip = page.getByTestId("tool-status");

    // ---- two rooms two cells by three: A over columns 0–1, B over 2–3, rows 1–3, sharing the wall on
    //      corner column 2 with a door across row 2. The outline, the two halves of the middle wall, the door.
    await openTab(page, "walls");
    await page.getByTestId("wall-tool-wall").click();
    for (const point of [corner(0, 1), corner(4, 1), corner(4, 4), corner(0, 4), corner(0, 1)]) {
      await clickMap(page, point);
    }
    await page.keyboard.press("Escape");
    await expect(surface).toHaveAttribute("data-walls", "4");
    for (const [from, to] of [
      [corner(2, 1), corner(2, 2)],
      [corner(2, 3), corner(2, 4)],
    ]) {
      await clickMap(page, from);
      await clickMap(page, to);
      await page.keyboard.press("Escape");
      await expect(surface).toHaveAttribute("data-wall-gesture", "idle");
    }
    await expect(surface).toHaveAttribute("data-walls", "6");
    await page.getByTestId("wall-tool-door").click();
    await dragMap(page, corner(2, 2), corner(2, 3));
    await expect(surface).toHaveAttribute("data-walls", "7");
    await expect(surface).toHaveAttribute("data-doors-open", "0");

    // ---- F arms the fill from the Walls tab: the Fog tab opens, the chip names it.
    await page.keyboard.press("f");
    await expect(page.getByTestId("dm-tabpanel")).toHaveAttribute("data-tab", "fog");
    await expect(surface).toHaveAttribute("data-fog-tool", "fill");
    await expect(chip).toContainText("Fog · reveal fill");
    await expect(page.getByTestId("tool-status-key")).toHaveText("F");
    await expect(opCount).toHaveText("0");

    // ---- hovering room A previews it on the DM canvas only.
    const hover = await toScreen(page, centre(0, 2));
    await page.mouse.move(hover.x, hover.y);
    await expect(surface).toHaveAttribute("data-fill-cell", "0,2");
    await expect(surface).toHaveAttribute("data-fill-preview", "room");
    await expectMapPixel(page, DM, centre(1, 3), MAP_PREVIEWED);
    await expectMapPixel(page, DM, centre(2, 2), MAP_DIMMED);
    await expectMapPixel(player, PLAYER, centre(1, 3), BLACK);
    await expect(opCount).toHaveText("0");

    // ---- a click: one op, exactly room A's cells, on the player too; beyond the closed door and outside stay black.
    const seq = Number(await playerView(player).getAttribute("data-sync-seq"));
    await clickMap(page, centre(0, 2));
    await expect(opCount).toHaveText("1");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "1");
    await expect(playerView(player)).toHaveAttribute("data-sync-seq", String(seq + 1));
    const roomA = { kind: "rects", rects: [12, 57, 100, 50, 12, 107, 100, 50, 12, 157, 100, 50] };
    await expect.poll(() => storedFogOps(page)).toEqual([[{ type: "shape", mode: "reveal", shape: roomA }]]);
    for (const [column, row] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) {
      await expectMapPixel(player, PLAYER, centre(column, row), MAP_RGB);
    }
    for (const outside of [centre(2, 2), centre(3, 1), centre(1, 0), centre(1, 4), centre(4, 2)]) {
      await expectMapPixel(player, PLAYER, outside, BLACK);
    }
    await expectMapPixel(page, DM, centre(2, 2), MAP_DIMMED);

    // ---- one undo step takes the whole room back; redo restores it.
    await page.keyboard.press("Control+z");
    await expect(opCount).toHaveText("0");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, PLAYER, centre(0, 1), BLACK);
    await expectMapPixel(player, PLAYER, centre(1, 3), BLACK);
    await page.keyboard.press("Control+Shift+z");
    await expect(opCount).toHaveText("1");
    await expectMapPixel(player, PLAYER, centre(1, 3), MAP_RGB);

    // ---- a click on the door, the fill still armed, opens it and fills nothing.
    await nextFrame(page);
    await clickMap(page, [corner(2, 2)[0], corner(2, 2)[1] + GRID.cellSize / 2]);
    await expect(surface).toHaveAttribute("data-doors-open", "1");
    await expect(playerView(player)).toHaveAttribute("data-doors-open", "1");
    await expect(opCount).toHaveText("1");
    await expect(surface).toHaveAttribute("data-fog-tool", "fill");

    // ---- filling room A again reaches room B through the doorway, and nothing outside.
    await clickMap(page, centre(1, 1));
    await expect(opCount).toHaveText("2");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "2");
    for (const inside of [centre(2, 2), centre(3, 1), centre(3, 3), centre(0, 3)]) {
      await expectMapPixel(player, PLAYER, inside, MAP_RGB);
    }
    for (const outside of [centre(4, 2), centre(2, 0), centre(2, 4)]) {
      await expectMapPixel(player, PLAYER, outside, BLACK);
    }

    // ---- hide mode: a click in room B hides both rooms in one op; undo brings them back.
    await page.keyboard.press("h");
    await expect(chip).toContainText("Fog · hide fill");
    await clickMap(page, centre(3, 2));
    await expect(opCount).toHaveText("3");
    await expectMapPixel(player, PLAYER, centre(0, 1), BLACK);
    await expectMapPixel(player, PLAYER, centre(3, 3), BLACK);
    await page.keyboard.press("Control+z");
    await expect(opCount).toHaveText("2");
    await expectMapPixel(player, PLAYER, centre(3, 3), MAP_RGB);
  });
});
