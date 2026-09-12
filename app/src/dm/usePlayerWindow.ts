import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPlayerWindowController,
  type FullscreenResult,
  type PlayerWindowController,
} from "./playerWindow";

/** How often we re-check the handle for closed/fullscreen changes. */
export const PLAYER_WINDOW_POLL_MS = 500;

export interface PlayerWindowStatus {
  open: boolean;
  fullscreen: boolean;
}

export interface UsePlayerWindow {
  status: PlayerWindowStatus;
  lastFullscreenResult: FullscreenResult | null;
  open: () => void;
  close: () => void;
  toggleFullscreen: () => Promise<void>;
}

/**
 * React binding for the player-window controller. There is no reliable event
 * for "the popup was closed" or "the popup left fullscreen" that survives the
 * popup's own navigation, so the hook polls the handle while it is open.
 */
export function usePlayerWindow(
  controller?: PlayerWindowController
): UsePlayerWindow {
  const ref = useRef<PlayerWindowController | null>(null);
  if (ref.current === null) {
    ref.current = controller ?? createPlayerWindowController();
  }
  const ctl = ref.current;

  const [status, setStatus] = useState<PlayerWindowStatus>({
    open: false,
    fullscreen: false,
  });
  const [lastFullscreenResult, setLastFullscreenResult] =
    useState<FullscreenResult | null>(null);

  const refresh = useCallback(() => {
    setStatus({ open: ctl.isOpen(), fullscreen: ctl.isFullscreen() });
  }, [ctl]);

  useEffect(() => {
    if (!status.open) return;
    const id = setInterval(refresh, PLAYER_WINDOW_POLL_MS);
    return () => clearInterval(id);
  }, [status.open, refresh]);

  const open = useCallback(() => {
    ctl.open();
    setLastFullscreenResult(null);
    refresh();
  }, [ctl, refresh]);

  const close = useCallback(() => {
    ctl.close();
    setLastFullscreenResult(null);
    refresh();
  }, [ctl, refresh]);

  const toggleFullscreen = useCallback(async () => {
    const result = await ctl.toggleFullscreen();
    setLastFullscreenResult(result);
    refresh();
  }, [ctl, refresh]);

  return { status, lastFullscreenResult, open, close, toggleFullscreen };
}
