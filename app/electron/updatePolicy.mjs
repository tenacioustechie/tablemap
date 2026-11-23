// @ts-check
/**
 * Auto-update policy for the desktop shell (ADR 0031), pure so Vitest can
 * check it without Electron; `updater.mjs` wires it to electron-updater.
 *
 * - **Windows** (`install`): a new GitHub release is downloaded in the
 *   background and installed when the app quits; the DM is offered a
 *   restart now.
 * - **macOS** (`notify`): Squirrel.Mac only installs updates into apps
 *   signed with an Apple Developer ID, which these builds are not, so the
 *   app checks for a new release and offers to open its download page.
 *   With a Developer ID this becomes `install` like Windows.
 * - `off` when running unpackaged (`npm run desktop`), or when
 *   `TABLEMAP_DISABLE_UPDATES=1` (the CI smoke test).
 */

export const RELEASES_OWNER = "tenacioustechie";
export const RELEASES_REPO = "tablemap";
/** How often a running app checks again after the check at start-up. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** @typedef {"off" | "install" | "notify"} UpdateMode */

/**
 * @param {{ platform: string; isPackaged: boolean; env: Record<string, string | undefined> }} context
 * @returns {UpdateMode}
 */
export function updateMode({ platform, isPackaged, env }) {
  if (!isPackaged || env.TABLEMAP_DISABLE_UPDATES === "1") return "off";
  if (platform === "win32") return "install";
  return "notify";
}

/**
 * The GitHub page a Mac user downloads `version` from.
 * @param {string} version e.g. "1.2.0" (a leading "v" is tolerated)
 */
export function releasePageUrl(version) {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/${RELEASES_OWNER}/${RELEASES_REPO}/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * @typedef {{ title: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }} UpdatePrompt
 */

/**
 * Windows: the update is downloaded. Button 0 restarts now; 1 waits for quit.
 * @param {string} version
 * @returns {UpdatePrompt}
 */
export function downloadedPrompt(version) {
  return {
    title: "Update ready",
    message: `TableMap ${version} is ready to install.`,
    detail:
      "Restart now to update, or keep playing: it installs by itself the next time you close TableMap. Your campaigns are saved automatically.",
    buttons: ["Restart now", "Later"],
    defaultId: 1,
    cancelId: 1,
  };
}

/**
 * macOS: a newer release exists. Button 0 opens its download page.
 * @param {string} version
 * @returns {UpdatePrompt}
 */
export function availablePrompt(version) {
  return {
    title: "Update available",
    message: `TableMap ${version} is available.`,
    detail:
      "Download it from the release page and drag it into Applications to replace this version. Your campaigns are kept.",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  };
}
