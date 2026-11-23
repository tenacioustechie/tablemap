// @ts-check
/**
 * Pure helpers for the desktop shell (ADR 0029), kept apart from
 * `main.mjs` so Vitest can check them without Electron.
 *
 * The built SPA (`dist/`) is served from a privileged custom scheme,
 * `app://tablemap/…`, rather than `file://`: a real, stable origin is what
 * IndexedDB (campaign storage) and BroadcastChannel (DM ↔ player sync) are
 * keyed by, and `file://` gives an opaque one.
 */
import path from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "tablemap";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
/** The DM / campaign manager entry; the router is a hash router, so this is the only page. */
export const APP_START_URL = `${APP_ORIGIN}/index.html`;

/**
 * The file under `root` that an `app://tablemap/…` request asks for, or
 * `null` when the URL is not ours or escapes `root` (`..`, encoded or not).
 * `/` is `index.html`. The query and hash never matter.
 *
 * @param {string} requestUrl
 * @param {string} root absolute path of the built `dist/` directory
 * @returns {string | null}
 */
export function resolveAppFile(requestUrl, root) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  const relative = pathname === "/" || pathname === "" ? "index.html" : pathname.replace(/^\/+/, "");
  const base = path.resolve(root);
  const file = path.resolve(base, relative);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

/**
 * Whether a URL belongs to the app itself (the player window, a reload);
 * anything else is opened in the system browser, never inside the app.
 *
 * @param {string} target
 * @returns {boolean}
 */
export function isAppUrl(target) {
  try {
    // Not `origin`: Node reports "null" for every non-special scheme.
    const url = new URL(target);
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
  } catch {
    return false;
  }
}

/**
 * Whether a URL may be handed to the system browser: web links only.
 *
 * @param {string} target
 * @returns {boolean}
 */
export function isExternalWebUrl(target) {
  try {
    const { protocol } = new URL(target);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
