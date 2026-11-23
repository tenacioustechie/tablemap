// @ts-check
/**
 * Wires the update policy (`updatePolicy.mjs`, ADR 0031) to electron-updater,
 * which reads `latest.yml` / `latest-mac.yml` from the newest GitHub
 * release (the `publish` block in package.json tells it where). Failures —
 * offline at game night, GitHub down — are logged and otherwise ignored:
 * an update check must never get in the way of a session.
 */
import { app, dialog, shell } from "electron";
import updaterPackage from "electron-updater";
import {
  availablePrompt,
  downloadedPrompt,
  releasePageUrl,
  UPDATE_CHECK_INTERVAL_MS,
  updateMode,
} from "./updatePolicy.mjs";

const { autoUpdater } = updaterPackage;

/**
 * Starts checking for updates (at start-up, then every few hours).
 * @param {() => Electron.BrowserWindow | undefined} parentWindow the window prompts attach to
 */
export function startUpdates(parentWindow) {
  const mode = updateMode({ platform: process.platform, isPackaged: app.isPackaged, env: process.env });
  if (mode === "off") return;

  autoUpdater.autoDownload = mode === "install";
  autoUpdater.autoInstallOnAppQuit = mode === "install";
  autoUpdater.logger = console;

  /** Each version is offered once per run, however many checks see it. */
  const offered = new Set();

  /** @param {import("./updatePolicy.mjs").UpdatePrompt} prompt */
  const ask = async (prompt) => {
    const parent = parentWindow();
    const options = { type: /** @type {const} */ ("info"), noLink: true, ...prompt };
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return response;
  };

  if (mode === "install") {
    autoUpdater.on("update-downloaded", async (info) => {
      if (offered.has(info.version)) return;
      offered.add(info.version);
      if ((await ask(downloadedPrompt(info.version))) === 0) autoUpdater.quitAndInstall();
    });
  } else {
    autoUpdater.on("update-available", async (info) => {
      if (offered.has(info.version)) return;
      offered.add(info.version);
      if ((await ask(availablePrompt(info.version))) === 0) await shell.openExternal(releasePageUrl(info.version));
    });
  }
  autoUpdater.on("error", (error) => console.warn("TableMap update check failed:", error?.message ?? error));

  const check = () => {
    autoUpdater.checkForUpdates().catch((error) => console.warn("TableMap update check failed:", error?.message ?? error));
  };
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS).unref?.();
}
