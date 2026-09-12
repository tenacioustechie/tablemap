import { useEffect, useState } from "react";
import { createMirrorStore, type MirrorStore } from "../state/mirror";
import { startPlayerSync } from "../state/playerSync";
import {
  createBroadcastTransport,
  type TransportFactory,
} from "../state/transport";

/** Module-level so the default is referentially stable across renders. */
export const defaultPlayerTransport: TransportFactory = () =>
  createBroadcastTransport();

/**
 * Creates a read-only mirror of the DM state and keeps it fed from the sync
 * channel while mounted. Returns the mirror store for the view to read.
 */
export function usePlayerSync(
  createTransport: TransportFactory = defaultPlayerTransport
): MirrorStore {
  const [mirror] = useState(createMirrorStore);

  useEffect(() => {
    const transport = createTransport();
    const stop = startPlayerSync(mirror, transport);
    return () => {
      stop();
      transport.close();
    };
  }, [mirror, createTransport]);

  return mirror;
}
