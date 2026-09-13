/**
 * Wall and door tools (T102) in real Chromium, on the gridded fixture with
 * its grid typed in: a four-segment room drawn by clicking near its corners
 * (each click snaps to the corner), a door dragged between two corners,
 * both counted on the DM surface and on the player page (the mirror holds
 * the walls, draws none); Shift skips snapping; with no tool armed a click
 * on a segment selects it, a dragged end handle moves it, Delete removes
 * it, and the player follows each change; a reload brings everything back
 * from the autosaved document.
 *
 * Map-pixel points are turned into screen coordinates from the DM stage's
 * `data-scale` and `data-viewport-x/y`; the segments are read back from the
 * surface's `data-wall-segments` (`kind:x1,y1,x2,y2;…`).
 */
import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./helpers";

/** `e2e/fixtures/grid-map.png`: 400×300, 50 px squares offset (12, 7). */
const GRID_FIXTURE_PATH = "e2e/fixtures/grid-map.png"; // relative to app/ (Playwright cwd)
const GRID = { cellSize: 50, offsetX: 12, offsetY: 7 };
/** Corner (column, row) of the fixture grid, in map pixels. */
const corner = (column: number, row: number): [number, number] => [
  GRID.offsetX + column * GRID.cellSize,
  GRID.offsetY + row * GRID.cellSize,
];
/** Map pixels off a corner that a click still snaps from (12 screen px reach). */
const OFF = 3;

const dmStage = (page: Page) => page.getByTestId("dm-map-stage");
const dmSurface = (page: Page) => page.getByTestId("dm-canvas-surface");
const playerView = (player: Page) => player.getByTestId("player-view");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  return player;
}

interface StageTransform {
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  vx: number;
  vy: number;
}

async function stageTransform(page: Page): Promise<StageTransform> {
  const stage = dmStage(page);
  const box = (await stage.boundingBox())!;
  return {
    box,
    scale: Number(await stage.getAttribute("data-scale")),
    vx: Number(await stage.getAttribute("data-viewport-x")),
    vy: Number(await stage.getAttribute("data-viewport-y")),
  };
}

/** Screen position of a map-pixel point on the DM stage. */
async function toScreen(page: Page, [mx, my]: [number, number]) {
  const t = await stageTransform(page);
  return { x: t.box.x + t.vx + mx * t.scale, y: t.box.y + t.vy + my * t.scale };
}

async function clickMap(page: Page, point: [number, number]) {
  const s = await toScreen(page, point);
  await page.mouse.click(s.x, s.y);
}

/**
 * Konva redraws a layer's hit graph on the next animation frame after its
 * nodes start listening (the tool was put down, a selection changed); a
 * click landing inside that frame misses. No human clicks that fast.
 */
async function nextFrame(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

async function dragMap(page: Page, from: [number, number], to: [number, number]) {
  const a = await toScreen(page, from);
  const b = await toScreen(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

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

/** Wall counts per map straight from IndexedDB (the autosaved document). */
function storedWallCounts(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (campaigns.result as { state: { maps: { walls: unknown[] }[] } }[])[0];
            resolve((campaign?.state.maps ?? []).map((m) => m.walls.length));
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

    // ---- stop the tool; select the unsnapped door by clicking its middle, delete it with the key.
    await page.getByTestId("wall-stop").click();
    await expect(dmSurface(page)).toHaveAttribute("data-wall-tool", "none");
    await expect(page.getByTestId("tool-status")).toHaveCount(0);
    await nextFrame(page);
    const mid = (s: Segment): [number, number] => [(s.ends[0] + s.ends[2]) / 2, (s.ends[1] + s.ends[3]) / 2];
    await clickMap(page, mid(unsnapped));
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
