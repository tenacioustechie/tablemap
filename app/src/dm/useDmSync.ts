import { useEffect } from "react";
import { startDmSync, type AssetSource } from "../state/dmSync";
import type { TableStore } from "../state/store";
import {
  createBroadcastTransport,
  type TransportFactory,
} from "../state/transport";

/** Module-level so the default is referentially stable across renders. */
export const defaultDmTransport: TransportFactory = () =>
  createBroadcastTransport();

/**
 * Publishes the DM store to player windows for as long as the component is
 * mounted. The transport is created inside the effect so StrictMode's
 * mount/unmount/mount cycle gets a fresh channel each time. `assets` lets
 * the publisher push referenced Blobs (ADR 0008); without it only state
 * travels.
 */
export function useDmSync(
  store: TableStore,
  createTransport: TransportFactory = defaultDmTransport,
  assets?: AssetSource
): void {
  useEffect(() => {
    const transport = createTransport();
    const stop = startDmSync(store, transport, { assets });
    return () => {
      stop();
      transport.close();
    };
  }, [store, createTransport, assets]);
}
