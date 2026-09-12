/**
 * DM side of the sync protocol: publishes the store over a transport.
 *
 * - On start: announce (`hello`) and broadcast a snapshot so any player
 *   window that is already open catches up.
 * - On player `hello`: broadcast a snapshot.
 * - On every dispatch: broadcast the ops as a delta.
 */
import { nanoid } from "nanoid";
import type { TableStore } from "./store";
import { decodeMessage, delta, encodeMessage, hello, snapshot } from "./sync";
import type { SyncTransport } from "./transport";

export interface DmSyncOptions {
  clientId?: string;
}

/** Returns a stop function. The caller owns (and closes) the transport. */
export function startDmSync(
  store: TableStore,
  transport: SyncTransport,
  options: DmSyncOptions = {}
): () => void {
  const clientId = options.clientId ?? nanoid();

  const sendSnapshot = () => {
    const { seq, shared } = store.getState();
    transport.post(encodeMessage(snapshot(seq, shared)));
  };

  const offMessage = transport.onMessage((raw) => {
    const result = decodeMessage(raw);
    if (!result.ok) return;
    const { message } = result;
    if (message.type === "hello" && message.role === "player") sendSnapshot();
  });

  const offOps = store.onOps((ops, seq) => {
    transport.post(encodeMessage(delta(seq, ops)));
  });

  transport.post(encodeMessage(hello("dm", clientId)));
  sendSnapshot();

  return () => {
    offMessage();
    offOps();
  };
}
