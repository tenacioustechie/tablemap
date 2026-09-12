/**
 * The v1 session (T013): one DM sitting down with a map and a TV, driven
 * end to end in real Chromium against the acceptance criteria in
 * `docs/spec.md`:
 *
 *   1. import a map and align a square grid in under a minute;
 *   3. the player window full-screens and shows only revealed areas;
 *   4. brushing fog away updates the TV in real time, and undo works;
 *   5. close everything and reopen: campaign, fog, calibration intact;
 *   6. export on one machine, import on another: everything matches.
 *
 * (2 — a 1-inch mini fits one cell on the actual TV — is physical; the
 * calibration is driven through the TV-size path here and checked as a
 * locked player scale.) The "other machine" of criterion 6 is a second
 * browser context: its own IndexedDB, nothing shared with the first.
 *
 * Pixels are read by compositing a stage's layer canvases (see
 * `fog.spec.ts`); map-pixel points are turned into screen / canvas
 * coordinates from the stage's `data-scale` and `data-viewport-x/y`.
 * Grid maths use the geometry the alignment tool actually derived (read
 * back from IndexedDB) so a sub-pixel mouse rounding cannot skew later
 * steps.
 */
import { test, expect, type Page } from "@playwright/test";

/** `e2e/fixtures/grid-map.png`: 400×300, 50 px squares offset (12, 7). */
const GRID_FIXTURE_PATH = "e2e/fixtures/grid-map.png"; // relative to app/ (Playwright cwd)
const GRID_FIXTURE = { width: 400, height: 300, cellSize: 50, offsetX: 12, offsetY: 7 } as const;
/** The fixture's background (`BACKGROUND` in `scripts/make-grid-fixture.mjs`). */
const MAP_RGB = [70, 60, 50] as const;
/** The background under the DM's 50 % fog. */
const MAP_DIMMED = MAP_RGB.map((c) => Math.round(c / 2));
const BLACK = [0, 0, 0] as const;
/** `PING_COLOR` in `src/map/PingLayer.tsx`. */
const PING_RGB = [255, 204, 0] as const;
/** The first colour of `TOKEN_PALETTE` in `src/state/tokens.ts`. */
const TOKEN_RGB = [0xd9, 0x4a, 0x4a] as const;
/** hypot(1920, 1080) / 55 in = 40.0529 px per inch; with 50 px cells a locked scale of 0.8011. */
const TV = { width: "1920", height: "1080", diagonal: "55", pxPerInch: 40.0529 } as const;
/** Spec: reveal visible on the TV < 100 ms. Generous on CI machines (`CI` set). */
const onCi = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI
);
const REVEAL_LATENCY_MS = onCi ? 1000 : 100;

// ---- page handles ---------------------------------------------------------------

async function openPlayer(page: Page) {
  const [player] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  await expect(player.getByTestId("player-view")).toHaveAttribute("data-sync-status", "synced");
  return player;
}

const playerView = (player: Page) => player.getByTestId("player-view");
const playerStage = (player: Page) => player.getByTestId("player-map-stage");
const dmStage = (page: Page) => page.getByTestId("dm-map-stage");

// ---- pixels ----------------------------------------------------------------------

function compositePixel(page: Page, stageTestId: string, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(
    ({ testId, fx, fy }) => {
      const canvases = Array.from(
        document.querySelectorAll<HTMLCanvasElement>(`[data-testid="${testId}"] canvas`)
      );
      if (canvases.length === 0) throw new Error("no stage canvases");
      const { width, height } = canvases[0];
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      for (const c of canvases) ctx.drawImage(c, 0, 0);
      const { data } = ctx.getImageData(Math.floor(width * fx), Math.floor(height * fy), 1, 1);
      return [data[0], data[1], data[2]];
    },
    { testId: stageTestId, fx, fy }
  );
}

const closeTo = (actual: number[], expected: readonly number[], tolerance = 6) =>
  [0, 1, 2].every((i) => Math.abs(actual[i] - expected[i]) <= tolerance);

interface StageTransform {
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  vx: number;
  vy: number;
}

async function stageTransform(page: Page, testId: string): Promise<StageTransform> {
  const stage = page.getByTestId(testId);
  const box = (await stage.boundingBox())!;
  return {
    box,
    scale: Number(await stage.getAttribute("data-scale")),
    vx: Number(await stage.getAttribute("data-viewport-x")),
    vy: Number(await stage.getAttribute("data-viewport-y")),
  };
}

/** Screen position of a map-pixel point on a stage. */
const toScreen = (t: StageTransform, mx: number, my: number) => ({
  x: t.box.x + t.vx + mx * t.scale,
  y: t.box.y + t.vy + my * t.scale,
});

/** The colour a stage shows at a map-pixel point; polled (Konva draws on the next frame). */
async function expectMapPixel(
  page: Page,
  stageTestId: string,
  point: readonly [number, number],
  expected: readonly number[]
) {
  const t = await stageTransform(page, stageTestId);
  const fx = (t.vx + point[0] * t.scale) / t.box.width;
  const fy = (t.vy + point[1] * t.scale) / t.box.height;
  await expect
    .poll(async () => {
      const actual = await compositePixel(page, stageTestId, fx, fy);
      return closeTo(actual, expected) ? "match" : `got ${actual.join(",")}`;
    })
    .toBe("match");
}

/** A drag on the DM stage through map-pixel points. */
async function dragMap(page: Page, points: readonly (readonly [number, number])[], steps = 6) {
  const t = await stageTransform(page, "dm-map-stage");
  const [first, ...rest] = points;
  const s0 = toScreen(t, first[0], first[1]);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (const [mx, my] of rest) {
    const s = toScreen(t, mx, my);
    await page.mouse.move(s.x, s.y, { steps });
  }
  await page.mouse.up();
}

async function altClickMap(page: Page, mx: number, my: number) {
  const { x, y } = toScreen(await stageTransform(page, "dm-map-stage"), mx, my);
  await page.keyboard.down("Alt");
  await page.mouse.click(x, y);
  await page.keyboard.up("Alt");
}

// ---- storage ---------------------------------------------------------------------

interface StoredGrid {
  cellSize: number;
  offsetX: number;
  offsetY: number;
}
interface StoredToken {
  id: string;
  x: number;
  y: number;
  hidden: boolean;
}
interface StoredMap {
  id: string;
  name: string;
  width: number;
  height: number;
  grid: StoredGrid;
  fogOps: number;
  tokens: StoredToken[];
  annotations: number;
}
interface StoredCampaign {
  id: string;
  name: string;
  maps: StoredMap[];
  activeMapId: string | null;
  assets: { id: string; kind: string; type: string; size: number }[];
}

/** The campaign document and asset rows, straight from IndexedDB. */
function stored(page: Page): Promise<StoredCampaign | null> {
  return page.evaluate(
    () =>
      new Promise<StoredCampaign | null>((resolve, reject) => {
        const open = indexedDB.open("tablemap");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["campaigns", "assets"]);
          const campaigns = tx.objectStore("campaigns").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            db.close();
            const campaign = (
              campaigns.result as {
                id: string;
                name: string;
                state: {
                  maps: (Omit<StoredMap, "fogOps" | "annotations" | "tokens"> & {
                    fogOps: unknown[];
                    annotations: unknown[];
                    tokens: StoredToken[];
                  })[];
                  activeMapId: string | null;
                };
              }[]
            )[0];
            if (!campaign) return resolve(null);
            resolve({
              id: campaign.id,
              name: campaign.name,
              activeMapId: campaign.state.activeMapId,
              maps: campaign.state.maps.map((m) => ({
                id: m.id,
                name: m.name,
                width: m.width,
                height: m.height,
                grid: { cellSize: m.grid.cellSize, offsetX: m.grid.offsetX, offsetY: m.grid.offsetY },
                fogOps: m.fogOps.length,
                tokens: m.tokens.map((t) => ({ id: t.id, x: t.x, y: t.y, hidden: t.hidden })),
                annotations: m.annotations.length,
              })),
              assets: (assets.result as { id: string; kind: string; blob: Blob }[])
                .map((a) => ({ id: a.id, kind: a.kind, type: a.blob?.type ?? "", size: a.blob?.size ?? 0 }))
                .sort((a, b) => a.id.localeCompare(b.id)),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

const storedMap = async (page: Page) => (await stored(page))?.maps[0];

// ---- grid geometry ---------------------------------------------------------------

/** The top-left corner and the centre of cell (column, row) under a grid. */
function cell(grid: StoredGrid, column: number, row: number) {
  const x = grid.offsetX + column * grid.cellSize;
  const y = grid.offsetY + row * grid.cellSize;
  return {
    x,
    y,
    centre: [x + grid.cellSize / 2, y + grid.cellSize / 2] as const,
    /** Inside the disc of a 1×1 token on this cell, clear of its centred badge. */
    tokenSample: [x + grid.cellSize * 0.22, y + grid.cellSize / 2] as const,
  };
}

// ---- latency probes (as in fog.spec.ts) ------------------------------------------

async function armLatencyProbes(page: Page, player: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __dmActionAt: number };
    const stamp = () => {
      w.__dmActionAt = Date.now();
    };
    document.addEventListener("click", stamp, true);
    document.addEventListener("mouseup", stamp, true);
  });
  await player.evaluate(() => {
    const w = window as unknown as { __playerFogAt: number };
    w.__playerFogAt = 0;
    new MutationObserver(() => {
      w.__playerFogAt = Date.now();
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-fog-history"],
    });
  });
}

async function measuredLatency(page: Page, player: Page): Promise<number> {
  const at = await page.evaluate(() => (window as unknown as { __dmActionAt: number }).__dmActionAt);
  await expect
    .poll(() => player.evaluate(() => (window as unknown as { __playerFogAt: number }).__playerFogAt))
    .toBeGreaterThanOrEqual(at);
  const seen = await player.evaluate(() => (window as unknown as { __playerFogAt: number }).__playerFogAt);
  return seen - at;
}

// ---- the session steps -----------------------------------------------------------

/** Criterion 1: import the gridded fixture and align the grid to one of its squares. */
async function importAndAlign(page: Page): Promise<StoredGrid> {
  const startedAt = Date.now();
  await page.getByTestId("map-file-input").setInputFiles(GRID_FIXTURE_PATH);
  await expect(dmStage(page)).toHaveAttribute("data-map-name", "grid-map");
  await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
  await expect(page.getByLabel("Grid cell size")).toHaveValue("70"); // the default, not yet aligned

  await page.getByTestId("align-grid-button").click();
  await expect(page.getByTestId("align-hint")).toBeVisible();
  await expect(dmStage(page)).toHaveAttribute("data-tool", "active");
  // Drag across the printed square at column 2, row 2 (corner to opposite corner).
  const { cellSize, offsetX, offsetY } = GRID_FIXTURE;
  await dragMap(page, [
    [offsetX + 2 * cellSize, offsetY + 2 * cellSize],
    [offsetX + 3 * cellSize, offsetY + 3 * cellSize],
  ]);
  // The tool switches itself off and the fields show the derived geometry.
  await expect(page.getByTestId("align-hint")).toHaveCount(0);
  await expect(dmStage(page)).toHaveAttribute("data-tool", "none");
  await expect(page.getByTestId("align-grid-button")).toHaveAttribute("aria-pressed", "false");
  // Mouse events carry whole screen pixels, so the derived square is within
  // a map pixel of the printed one (and its corner within 1.5 px, the error
  // of the corner plus twice the cell size error, wrapped into the first cell).
  const field = async (label: string) => Number(await page.getByLabel(label).inputValue());
  await expect.poll(() => field("Grid cell size")).not.toBe(70);
  const derived = {
    cellSize: await field("Grid cell size"),
    offsetX: await field("Grid offset X"),
    offsetY: await field("Grid offset Y"),
  };
  expect(Math.abs(derived.cellSize - cellSize)).toBeLessThanOrEqual(1);
  expect(Math.abs(derived.offsetX - offsetX)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(derived.offsetY - offsetY)).toBeLessThanOrEqual(1.5);
  expect(Date.now() - startedAt).toBeLessThan(60_000);

  // Autosaved; later maths use exactly what the tool derived.
  await expect.poll(async () => (await storedMap(page))?.grid).toEqual(derived);
  return derived;
}

/** The TV-size calibration path: a locked player scale of pxPerInch / cellSize. */
async function calibrate(page: Page, player: Page, grid: StoredGrid) {
  await expect(page.getByTestId("calibration-status")).toContainText(/Player display \d+×\d+/);
  await page.getByLabel("TV resolution width").fill(TV.width);
  await page.getByLabel("TV resolution height").fill(TV.height);
  await page.getByLabel("TV diagonal in inches").fill(TV.diagonal);
  await page.getByRole("button", { name: "Use TV size" }).click();
  await expectCalibrated(page, player, grid);
}

const lockedScale = (grid: StoredGrid) => (TV.pxPerInch / grid.cellSize).toFixed(4);

async function expectCalibrated(page: Page, player: Page, grid: StoredGrid) {
  await expect(page.getByTestId("calibration-status")).toContainText(/from the TV size/);
  await expect(playerView(player)).toHaveAttribute("data-view-mode", "calibrated");
  await expect(playerStage(player)).toHaveAttribute("data-scale", lockedScale(grid));
}

/** Criterion 3 (the fullscreen half): the DM's button, or the F key inside the player. */
async function fullscreenPlayer(page: Page, player: Page) {
  await page.getByRole("button", { name: "Fullscreen player view" }).click();
  // The request is asynchronous: either the player document goes fullscreen,
  // or the browser refuses a cross-window request without a gesture in the
  // target window and the DM is told to press F there (ADR 0005).
  const inFullscreen = () => player.evaluate(() => document.fullscreenElement !== null);
  const outcome = async () =>
    (await inFullscreen())
      ? "entered"
      : (await page.getByTestId("fullscreen-hint").count()) > 0
        ? "denied"
        : "pending";
  await expect.poll(outcome).not.toBe("pending");
  if ((await outcome()) === "denied") await player.keyboard.press("f");
  await expect.poll(inFullscreen).toBe(true);
  await expect(page.getByTestId("player-window-status")).toHaveText("Player view: fullscreen");
}

test.describe("session (T013)", () => {
  test("import, align, calibrate, fullscreen, reveal, undo, tokens, ping, blackout; close everything and reopen", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/#/dm");
    await page.getByTestId("campaign-name-input").fill("Session night");
    const player = await openPlayer(page);

    // ---- 1. import + align -------------------------------------------------------
    const grid = await importAndAlign(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await expect(playerStage(player)).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage(player)).toHaveAttribute("data-image-status", "loaded");
    await expect(playerStage(player)).toHaveAttribute("data-fog-status", "ready");

    // ---- 2. calibrate (mock display: the TV-size path) ---------------------------
    await calibrate(page, player, grid);

    // ---- 3. fullscreen, only revealed areas ---------------------------------------
    await fullscreenPlayer(page, player);
    // Fully fogged: the TV is black where the map is; the DM sees it dimmed.
    const inside = cell(grid, 2, 2).centre;
    const outside = cell(grid, 6, 4).centre;
    await expectMapPixel(player, "player-map-stage", inside, BLACK);
    await expectMapPixel(player, "player-map-stage", outside, BLACK);
    await expectMapPixel(page, "dm-map-stage", inside, MAP_DIMMED);

    // ---- 4. reveal in real time; undo / redo ---------------------------------------
    await armLatencyProbes(page, player);
    await page.getByTestId("fog-tool-rect").click();
    // Cells 1..4 × 1..4, dragged a little past the cell corners so the feathered
    // edge stays clear of the sampled centres.
    const revealFrom = cell(grid, 1, 1);
    const revealTo = cell(grid, 5, 5);
    await dragMap(page, [
      [revealFrom.x - 6, revealFrom.y - 6],
      [revealTo.x + 6, revealTo.y + 6],
    ]);
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "1");
    expect(await measuredLatency(page, player)).toBeLessThan(REVEAL_LATENCY_MS);
    await expectMapPixel(player, "player-map-stage", inside, MAP_RGB);
    await expectMapPixel(page, "dm-map-stage", inside, MAP_RGB);
    await expectMapPixel(player, "player-map-stage", outside, BLACK);
    await page.keyboard.press("Escape");
    await expect(dmStage(page)).toHaveAttribute("data-tool", "none");

    await page.getByTestId("fog-undo").click();
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "0");
    await expectMapPixel(player, "player-map-stage", inside, BLACK);
    await expectMapPixel(page, "dm-map-stage", inside, MAP_DIMMED);
    await page.getByTestId("fog-redo").click();
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "1");
    await expectMapPixel(player, "player-map-stage", inside, MAP_RGB);

    // ---- 5. tokens -------------------------------------------------------------------
    // A new disc lands mid-TV (the map's centre), snapped to the aligned grid: cell (3, 2).
    await page.getByTestId("token-add").click();
    await expect(page.getByTestId("token-count")).toHaveText("(1)");
    await expect(dmStage(page)).toHaveAttribute("data-tokens", "1");
    await expect(playerStage(player)).toHaveAttribute("data-tokens-shown", "1");
    const home = cell(grid, 3, 2);
    await expect.poll(async () => (await storedMap(page))?.tokens[0]).toMatchObject({ x: home.x, y: home.y });
    await expectMapPixel(player, "player-map-stage", home.tokenSample, TOKEN_RGB);
    await expectMapPixel(page, "dm-map-stage", home.tokenSample, TOKEN_RGB);

    // Dragged onto a fogged cell it vanishes from the TV (still drawn, dimmed, for the DM).
    // The token stands inside the player-view rectangle, which is draggable too
    // (calibrated): the token, not the rectangle, must take the drag.
    const surface = page.getByTestId("dm-canvas-surface");
    await expect(surface).toHaveAttribute("data-player-draggable", "true");
    const centreBefore = await surface.getAttribute("data-player-center");
    const fogged = cell(grid, 6, 4);
    await dragMap(page, [home.centre, fogged.centre], 8);
    await expect.poll(async () => (await storedMap(page))?.tokens[0]).toMatchObject({ x: fogged.x, y: fogged.y });
    await expect(dmStage(page)).toHaveAttribute("data-tokens-fogged", "1");
    await expect(playerStage(player)).toHaveAttribute("data-tokens-shown", "0");
    await expectMapPixel(player, "player-map-stage", fogged.tokenSample, BLACK);
    // Back into the light, at cell (2, 3).
    const seat = cell(grid, 2, 3);
    await dragMap(page, [fogged.centre, seat.centre], 8);
    await expect.poll(async () => (await storedMap(page))?.tokens[0]).toMatchObject({ x: seat.x, y: seat.y });
    await expect(playerStage(player)).toHaveAttribute("data-tokens-shown", "1");
    await expectMapPixel(player, "player-map-stage", seat.tokenSample, TOKEN_RGB);
    await expect(surface).toHaveAttribute("data-player-center", centreBefore!);
    // Hidden from players: gone from the TV, back when unhidden.
    await page.getByTestId("token-hidden").check();
    await expect(playerStage(player)).toHaveAttribute("data-tokens-shown", "0");
    await expectMapPixel(player, "player-map-stage", seat.tokenSample, MAP_RGB);
    await page.getByTestId("token-hidden").uncheck();
    await expect(playerStage(player)).toHaveAttribute("data-tokens-shown", "1");
    await expectMapPixel(player, "player-map-stage", seat.tokenSample, TOKEN_RGB);
    await page.getByTestId("token-deselect").click();

    // ---- 6. ping ---------------------------------------------------------------------
    const pingAt = cell(grid, 6, 2).centre;
    await altClickMap(page, pingAt[0], pingAt[1]);
    await expect(playerStage(player)).toHaveAttribute("data-pings", "1");
    await expectMapPixel(player, "player-map-stage", pingAt, PING_RGB);
    await expect(playerStage(player)).toHaveAttribute("data-pings", "0", { timeout: 5000 });
    await expectMapPixel(player, "player-map-stage", pingAt, BLACK);

    // ---- 7. blackout -----------------------------------------------------------------
    await page.getByTestId("blackout-toggle").click();
    await expect(playerView(player)).toHaveAttribute("data-blackout", "true");
    await expect(player.getByTestId("player-blackout")).toBeVisible();
    expect(
      await player.evaluate(() => {
        const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2) as HTMLElement | null;
        return el?.dataset.testid;
      })
    ).toBe("player-blackout");
    await page.getByTestId("blackout-toggle").click();
    await expect(player.getByTestId("player-blackout")).toHaveCount(0);
    await expectMapPixel(player, "player-map-stage", inside, MAP_RGB);

    // ---- 8. close everything, reopen ---------------------------------------------------
    await expect.poll(() => storedMap(page)).toMatchObject({
      grid,
      fogOps: 1,
      tokens: [{ x: seat.x, y: seat.y, hidden: false }],
    });
    await Promise.all([player.waitForEvent("close"), player.close()]);
    await expect(page.getByTestId("player-window-status")).toHaveText("Player view: closed");
    await page.goto("about:blank");
    await page.goto("/#/dm");

    await expect(page.getByTestId("campaign-name-input")).toHaveValue("Session night");
    await expect(dmStage(page)).toHaveAttribute("data-map-id", mapId);
    await expect(dmStage(page)).toHaveAttribute("data-image-status", "loaded");
    await expect(dmStage(page)).toHaveAttribute("data-fog-status", "ready");
    await expect(dmStage(page)).toHaveAttribute("data-fog-ops", "1");
    await expect(dmStage(page)).toHaveAttribute("data-tokens", "1");
    expect(Number(await page.getByLabel("Grid cell size").inputValue())).toBe(grid.cellSize);
    expect(Number(await page.getByLabel("Grid offset X").inputValue())).toBe(grid.offsetX);
    expect(Number(await page.getByLabel("Grid offset Y").inputValue())).toBe(grid.offsetY);
    await expectMapPixel(page, "dm-map-stage", inside, MAP_RGB);
    await expectMapPixel(page, "dm-map-stage", outside, MAP_DIMMED);
    await expectMapPixel(page, "dm-map-stage", seat.tokenSample, TOKEN_RGB);

    // A new player window: the same picture, and the calibration for its display again.
    const reopened = await openPlayer(page);
    await expect(playerStage(reopened)).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage(reopened)).toHaveAttribute("data-fog-status", "ready");
    await expectCalibrated(page, reopened, grid);
    await expect(playerStage(reopened)).toHaveAttribute("data-fog-ops", "1");
    await expect(playerStage(reopened)).toHaveAttribute("data-tokens-shown", "1");
    await expectMapPixel(reopened, "player-map-stage", inside, MAP_RGB);
    await expectMapPixel(reopened, "player-map-stage", outside, BLACK);
    await expectMapPixel(reopened, "player-map-stage", seat.tokenSample, TOKEN_RGB);
    // Still no way to change anything from the TV.
    await expect(reopened.getByRole("button")).toHaveCount(0);
    await expect(reopened.getByRole("textbox")).toHaveCount(0);
  });

  test("export on one machine, import on another: the campaign, fog, grid, tokens and pictures match", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/#/dm");
    await page.getByTestId("campaign-name-input").fill("Travelling campaign");
    const player = await openPlayer(page);

    // A campaign with something in it: an aligned map, a reveal, a token, a note and a drawing.
    const grid = await importAndAlign(page);
    const mapId = (await dmStage(page).getAttribute("data-map-id"))!;
    await expect(playerStage(player)).toHaveAttribute("data-map-id", mapId);
    await expect(playerStage(player)).toHaveAttribute("data-fog-status", "ready");
    await page.getByTestId("fog-tool-rect").click();
    const from = cell(grid, 1, 1);
    const to = cell(grid, 5, 5);
    await dragMap(page, [
      [from.x - 6, from.y - 6],
      [to.x + 6, to.y + 6],
    ]);
    await expect(playerStage(player)).toHaveAttribute("data-fog-ops", "1");
    await page.keyboard.press("Escape");
    await page.getByTestId("token-add").click();
    await page.getByTestId("token-name").fill("Rogue");
    await page.getByTestId("token-deselect").click();
    const seat = cell(grid, 3, 2);
    await expect.poll(async () => (await storedMap(page))?.tokens[0]).toMatchObject({ x: seat.x, y: seat.y });
    await expectMapPixel(player, "player-map-stage", seat.tokenSample, TOKEN_RGB);
    await page.getByTestId("note-tool").click();
    const noteAt = cell(grid, 6, 4).centre;
    const notePoint = toScreen(await stageTransform(page, "dm-map-stage"), noteAt[0], noteAt[1]);
    await page.mouse.click(notePoint.x, notePoint.y);
    await page.getByTestId("note-text").fill("Trapdoor under the rug");
    await page.getByTestId("note-popover-close").click();
    await page.getByTestId("draw-mode-draw").click();
    await dragMap(page, [cell(grid, 1, 5).centre, cell(grid, 3, 5).centre]);
    await expect(dmStage(page)).toHaveAttribute("data-annotations", "2");
    await page.keyboard.press("Escape");

    const inside = cell(grid, 2, 2).centre;
    const outside = cell(grid, 6, 2).centre;
    await expectMapPixel(player, "player-map-stage", inside, MAP_RGB);
    await expectMapPixel(player, "player-map-stage", outside, BLACK);
    await expect.poll(() => storedMap(page)).toMatchObject({ fogOps: 1, annotations: 2 });
    const original = (await stored(page))!;
    expect(original.assets.map((a) => a.kind)).toEqual(["map-image"]);

    // ---- export: the manager's Export button hands the browser one zip ----------------
    await page.getByRole("link", { name: "TableMap" }).click();
    const item = page.getByTestId("campaign-item");
    await expect(item).toHaveCount(1);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      item.getByRole("button", { name: "Export" }).click(),
    ]);
    // `archiveFileName`: spaces become dashes so the name travels between file systems.
    expect(download.suggestedFilename()).toBe("Travelling-campaign.tablemap.zip");
    await expect(page.getByTestId("campaign-manager-notice")).toContainText("Exported");
    const archivePath = await download.path();
    expect(archivePath).not.toBeNull();

    // ---- import on "another machine": a fresh browser context, empty storage -----------
    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await otherPage.goto(`${baseURL}/#/`);
      await expect(otherPage.getByTestId("campaign-list-empty")).toBeVisible();
      await otherPage.getByTestId("campaign-import-input").setInputFiles(archivePath!);
      await expect(otherPage.getByTestId("campaign-manager-notice")).toHaveText(
        'Imported "Travelling campaign".'
      );
      const otherItem = otherPage.getByTestId("campaign-item");
      await expect(otherItem).toHaveCount(1);
      await expect(otherItem.getByTestId("campaign-item-name")).toHaveText("Travelling campaign");

      // The document and the pictures are the same, ids included (nothing to clash with).
      const copy = (await stored(otherPage))!;
      expect(copy).toEqual(original);

      // Opened on the other machine, both screens show the same picture.
      await otherItem.getByRole("button", { name: "Open" }).click();
      await expect(dmStage(otherPage)).toHaveAttribute("data-map-id", mapId);
      await expect(dmStage(otherPage)).toHaveAttribute("data-image-status", "loaded");
      await expect(dmStage(otherPage)).toHaveAttribute("data-fog-ops", "1");
      await expect(dmStage(otherPage)).toHaveAttribute("data-tokens", "1");
      await expect(dmStage(otherPage)).toHaveAttribute("data-annotations", "2");
      await expect(otherPage.getByTestId("note-item")).toContainText("Trapdoor under the rug");
      expect(Number(await otherPage.getByLabel("Grid cell size").inputValue())).toBe(grid.cellSize);
      expect(Number(await otherPage.getByLabel("Grid offset X").inputValue())).toBe(grid.offsetX);
      expect(Number(await otherPage.getByLabel("Grid offset Y").inputValue())).toBe(grid.offsetY);
      await expect(otherPage.getByTestId("token-item")).toContainText("Rogue");
      await expectMapPixel(otherPage, "dm-map-stage", inside, MAP_RGB);
      await expectMapPixel(otherPage, "dm-map-stage", outside, MAP_DIMMED);
      await expectMapPixel(otherPage, "dm-map-stage", seat.tokenSample, TOKEN_RGB);

      const otherPlayer = await openPlayer(otherPage);
      await expect(playerStage(otherPlayer)).toHaveAttribute("data-map-id", mapId);
      await expect(playerStage(otherPlayer)).toHaveAttribute("data-image-status", "loaded");
      await expect(playerStage(otherPlayer)).toHaveAttribute("data-fog-status", "ready");
      await expect(playerStage(otherPlayer)).toHaveAttribute("data-fog-ops", "1");
      await expect(playerStage(otherPlayer)).toHaveAttribute("data-tokens-shown", "1");
      await expect(playerStage(otherPlayer)).toHaveAttribute("data-annotations", "1");
      await expectMapPixel(otherPlayer, "player-map-stage", inside, MAP_RGB);
      await expectMapPixel(otherPlayer, "player-map-stage", outside, BLACK);
      await expectMapPixel(otherPlayer, "player-map-stage", seat.tokenSample, TOKEN_RGB);
      expect(await otherPlayer.content()).not.toContain("Trapdoor");
      // Calibration is per display, not per campaign: the other machine starts uncalibrated.
      await expect(playerView(otherPlayer)).toHaveAttribute("data-view-mode", "uncalibrated");
    } finally {
      await other.close();
    }
  });
});
