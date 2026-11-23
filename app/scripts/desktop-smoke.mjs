/**
 * Desktop smoke test (ADR 0029): launches the *packaged* app that
 * `npm run desktop:dist` left in `release/` and checks what only the shell
 * can break — the app loads from `app://tablemap`, the DM view mounts,
 * IndexedDB storage works, the player window opens as a second native
 * window and BroadcastChannel sync reaches it. CI runs it on the macOS and
 * Windows builds before they are released.
 *
 *   node scripts/desktop-smoke.mjs [path/to/TableMap executable]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const CANDIDATES = {
  darwin: [
    "release/mac-arm64/TableMap.app/Contents/MacOS/TableMap",
    "release/mac/TableMap.app/Contents/MacOS/TableMap",
    "release/mac-universal/TableMap.app/Contents/MacOS/TableMap",
  ],
  win32: ["release/win-unpacked/TableMap.exe"],
  linux: ["release/linux-unpacked/tablemap"],
};

function findExecutable() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const found = (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p));
  if (!found) throw new Error(`No packaged app found; run "npm run desktop:dist" first.`);
  return path.resolve(found);
}

function check(condition, message) {
  if (!condition) throw new Error(`desktop smoke: ${message}`);
  console.log(`  ok  ${message}`);
}

const executablePath = findExecutable();
console.log(`desktop smoke: ${executablePath}`);
// No update checks from a test run (ADR 0031).
const app = await electron.launch({
  executablePath,
  timeout: 60_000,
  env: { ...process.env, TABLEMAP_DISABLE_UPDATES: "1" },
});
try {
  const dm = await app.firstWindow();
  await dm.waitForLoadState();
  check((await dm.evaluate(() => location.origin)) === "app://tablemap", "served from app://tablemap");
  await dm.getByRole("heading", { name: "TableMap" }).waitFor({ timeout: 30_000 });
  check(true, "campaign manager renders");

  await dm.evaluate(() => {
    location.hash = "#/dm";
  });
  await dm.getByTestId("dm-view").waitFor({ timeout: 30_000 });
  check(true, "DM view mounts");
  const name = `Smoke ${Date.now()}`;
  await dm.getByTestId("campaign-name-input").fill(name);

  const [player] = await Promise.all([
    app.waitForEvent("window", { timeout: 30_000 }),
    dm.getByRole("button", { name: "Open player view" }).click(),
  ]);
  await player.waitForLoadState();
  check(player.url().endsWith("#/player"), "player window opens in the app");
  await player.getByTestId("player-view").waitFor({ timeout: 30_000 });
  await player.getByText(name).first().waitFor({ timeout: 15_000 });
  check(true, "player window receives sync over BroadcastChannel");

  const databases = await dm.evaluate(() => indexedDB.databases().then((d) => d.map((x) => x.name)));
  check(databases.includes("tablemap"), "IndexedDB campaign storage is available");
  console.log("desktop smoke: passed");
} finally {
  await app.close();
}
