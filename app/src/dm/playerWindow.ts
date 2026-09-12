/**
 * Player-window controller. The DM window owns the handle returned by
 * window.open and uses it to focus, full-screen, and close the player view.
 * Pure logic with injectable dependencies so it is unit-testable without a
 * real browser window.
 */
import { PLAYER_ROUTE_HASH } from "../routePaths";

export const PLAYER_WINDOW_NAME = "tablemap-player";

/**
 * `popup` asks the browser for a chrome-less window (no tab strip / address
 * bar), which is what we want on the TV. Size is a sane default; the DM drags
 * it onto the TV and full-screens it.
 */
export const PLAYER_WINDOW_FEATURES = "popup=yes,width=1280,height=720";

export type FullscreenResult = "entered" | "exited" | "not-open" | "denied";

export interface PlayerWindowController {
  /** Open the player window, or focus it if it is already open. */
  open(): Window | null;
  /** Close the player window if open. */
  close(): void;
  /** True while the window is open (handle exists and not closed). */
  isOpen(): boolean;
  /** True while the player document is in fullscreen. */
  isFullscreen(): boolean;
  /** Enter/exit fullscreen on the player document. */
  toggleFullscreen(): Promise<FullscreenResult>;
  /** Raw handle for callers that need it (e.g. sync, later tasks). */
  getHandle(): Window | null;
}

export interface PlayerWindowDeps {
  openWindow: (url: string, name: string, features: string) => Window | null;
  playerUrl: () => string;
}

export function resolvePlayerUrl(base: string): string {
  return new URL(PLAYER_ROUTE_HASH, base).toString();
}

const browserDeps: PlayerWindowDeps = {
  openWindow: (url, name, features) => window.open(url, name, features),
  playerUrl: () => resolvePlayerUrl(window.location.href),
};

export function createPlayerWindowController(
  deps: PlayerWindowDeps = browserDeps
): PlayerWindowController {
  let handle: Window | null = null;

  /** Returns the handle only if it still points at a live window. */
  const live = (): Window | null => {
    if (handle && handle.closed) handle = null;
    return handle;
  };

  const playerDocument = (): Document | null => {
    const w = live();
    if (!w) return null;
    try {
      return w.document;
    } catch {
      // Cross-origin navigation would throw; treat as unavailable.
      return null;
    }
  };

  return {
    getHandle: live,
    isOpen: () => live() !== null,
    isFullscreen: () => playerDocument()?.fullscreenElement != null,

    open() {
      const existing = live();
      if (existing) {
        existing.focus();
        return existing;
      }
      handle = deps.openWindow(
        deps.playerUrl(),
        PLAYER_WINDOW_NAME,
        PLAYER_WINDOW_FEATURES
      );
      return handle;
    },

    close() {
      live()?.close();
      handle = null;
    },

    async toggleFullscreen() {
      const doc = playerDocument();
      if (!doc) return "not-open";
      try {
        if (doc.fullscreenElement) {
          await doc.exitFullscreen();
          return "exited";
        }
        await doc.documentElement.requestFullscreen();
        return "entered";
      } catch {
        // Browsers require a user gesture *in the player window* for
        // requestFullscreen; a click in the DM window may not count.
        return "denied";
      }
    },
  };
}
