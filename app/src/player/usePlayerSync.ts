import { useEffect, useState } from "react";
import {
  displayKey,
  isDisplayInfo,
  readDisplayInfo,
  type DisplayInfo,
} from "../state/calibration";
import { createMirrorStore, type MirrorStore } from "../state/mirror";
import { startPlayerSync } from "../state/playerSync";
import {
  createBroadcastTransport,
  type TransportFactory,
} from "../state/transport";

/** Module-level so the default is referentially stable across renders. */
export const defaultPlayerTransport: TransportFactory = () =>
  createBroadcastTransport();

export type ReadDisplay = () => DisplayInfo | undefined;

/** The real window's screen; undefined where it is unknown (jsdom reports 0×0). */
export const defaultReadDisplay: ReadDisplay = () => {
  const display = readDisplayInfo(window);
  return isDisplayInfo(display) ? display : undefined;
};

/**
 * How often to check whether the window moved to another display. There is
 * no cross-browser event for it, so we poll cheaply and also check on
 * `resize` (entering fullscreen on the TV fires one).
 */
export const DISPLAY_POLL_MS = 1000;

/**
 * Creates a read-only mirror of the DM state and keeps it fed from the sync
 * channel while mounted. Returns the mirror store for the view to read.
 * Re-announces (a new hello carrying the display) whenever the window lands
 * on a different screen, so the DM can apply that screen's calibration.
 */
export function usePlayerSync(
  createTransport: TransportFactory = defaultPlayerTransport,
  readDisplay: ReadDisplay = defaultReadDisplay
): MirrorStore {
  const [mirror] = useState(createMirrorStore);

  useEffect(() => {
    const transport = createTransport();
    const sync = startPlayerSync(mirror, transport, { display: readDisplay });

    const keyOf = () => {
      const display = readDisplay();
      return display ? displayKey(display) : null;
    };
    let lastKey = keyOf();
    const check = () => {
      const key = keyOf();
      if (key === lastKey) return;
      lastKey = key;
      sync.announce();
    };
    window.addEventListener("resize", check);
    const timer = setInterval(check, DISPLAY_POLL_MS);

    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", check);
      sync.stop();
      transport.close();
    };
  }, [mirror, createTransport, readDisplay]);

  return mirror;
}
