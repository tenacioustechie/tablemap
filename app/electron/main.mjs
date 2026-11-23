// @ts-check
/**
 * TableMap desktop shell (ADR 0029): an Electron window around the same
 * static build the browser runs. No Node in the page, no preload, no IPC:
 * the app is unchanged, and the shell only
 *
 * - serves `dist/` from the privileged `app://tablemap` origin (stable
 *   IndexedDB storage, BroadcastChannel between the DM and player windows);
 * - lets the DM window open the player window (`window.open`, ADR 0005) as
 *   a second native window, menu bar hidden, so it can be dragged to the TV;
 * - sends every other link to the system browser and refuses to navigate
 *   away from the app.
 *
 * Campaign export uses the browser download path, which Electron answers
 * with a native Save dialog; import uses the file picker as in a browser.
 * Updates come from GitHub releases (`updater.mjs`, ADR 0031).
 */
import { app, BrowserWindow, net, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  APP_SCHEME,
  APP_START_URL,
  isAppUrl,
  isExternalWebUrl,
  resolveAppFile,
} from "./appPaths.mjs";
import { startUpdates } from "./updater.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "..", "dist");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** @type {Electron.BrowserWindowConstructorOptions["webPreferences"]} */
const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

/** @param {BrowserWindow} win */
function guard(win) {
  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      // The player window (`#/player`): a plain, chrome-less window that can
      // go full screen on the TV. The DM keeps its handle (ADR 0005).
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          backgroundColor: "#000000",
          autoHideMenuBar: true,
          title: "TableMap — Player",
          webPreferences,
        },
      };
    }
    if (isExternalWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isExternalWebUrl(url)) void shell.openExternal(url);
  });
}

/** @type {BrowserWindow | undefined} */
let mainWindow;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#111111",
    title: "TableMap",
    webPreferences,
  });
  win.loadURL(APP_START_URL);
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  mainWindow = win;
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [first] = BrowserWindow.getAllWindows();
    if (first) {
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });

  // Every window the app makes (the player window included) gets the same guards.
  app.on("browser-window-created", (_event, win) => guard(win));

  app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, (request) => {
      const file = resolveAppFile(request.url, distDir);
      if (file === null) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createMainWindow();
    startUpdates(() => mainWindow ?? BrowserWindow.getAllWindows()[0]);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
