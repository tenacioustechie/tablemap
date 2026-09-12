/**
 * DM side of the sync protocol: publishes the store over a transport.
 *
 * - On start: announce (`hello`) and broadcast a snapshot so any player
 *   window that is already open catches up.
 * - On player `hello`: broadcast a snapshot.
 * - On every dispatch: broadcast the ops as a delta.
 * - Assets (ADR 0008): after the snapshot/delta, push every asset the state
 *   references that this publisher has not sent yet, active map first. A
 *   player `hello` re-sends them all, since a fresh player has nothing.
 *   Assets are read through `options.assets`; without it nothing is pushed.
 */
import { nanoid } from "nanoid";
import { blobToBase64 } from "./assetCodec";
import { assetIdsForPlayer } from "./maps";
import type { AssetId, AssetKind } from "./model";
import type { TableStore } from "./store";
import { asset, decodeMessage, delta, encodeMessage, hello, snapshot } from "./sync";
import type { SyncTransport } from "./transport";

/** Resolves the Blob for an asset id, or undefined if it does not exist. */
export type AssetSource = (
  id: AssetId
) => Promise<{ kind: AssetKind; blob: Blob } | undefined>;

export interface DmSyncOptions {
  clientId?: string;
  assets?: AssetSource;
}

/** Returns a stop function. The caller owns (and closes) the transport. */
export function startDmSync(
  store: TableStore,
  transport: SyncTransport,
  options: DmSyncOptions = {}
): () => void {
  const clientId = options.clientId ?? nanoid();
  const source = options.assets;
  let stopped = false;

  // Ids already pushed this session (or queued to be). Sent in order, one at
  // a time, so the active map's image always goes out first.
  const sent = new Set<AssetId>();
  const queue: AssetId[] = [];
  let draining = false;

  const drain = async () => {
    if (draining || !source) return;
    draining = true;
    try {
      while (queue.length > 0 && !stopped) {
        const id = queue.shift()!;
        try {
          const record = await source(id);
          if (stopped) return;
          if (!record) {
            sent.delete(id);
            continue;
          }
          const data = await blobToBase64(record.blob);
          if (stopped) return;
          transport.post(encodeMessage(asset(id, record.kind, record.blob.type, data)));
        } catch {
          sent.delete(id);
        }
      }
    } finally {
      draining = false;
    }
  };

  const publishAssets = (resendAll: boolean) => {
    if (!source) return;
    if (resendAll) {
      // Forget what was sent, but leave ids still waiting in the queue alone.
      for (const id of [...sent]) if (!queue.includes(id)) sent.delete(id);
    }
    for (const id of assetIdsForPlayer(store.getState().shared)) {
      if (sent.has(id)) continue;
      sent.add(id);
      queue.push(id);
    }
    void drain();
  };

  const sendSnapshot = () => {
    const { seq, shared } = store.getState();
    transport.post(encodeMessage(snapshot(seq, shared)));
  };

  const offMessage = transport.onMessage((raw) => {
    const result = decodeMessage(raw);
    if (!result.ok) return;
    const { message } = result;
    if (message.type === "hello" && message.role === "player") {
      sendSnapshot();
      publishAssets(true);
    }
  });

  const offOps = store.onOps((ops, seq) => {
    transport.post(encodeMessage(delta(seq, ops)));
    publishAssets(false);
  });

  transport.post(encodeMessage(hello("dm", clientId)));
  sendSnapshot();
  publishAssets(false);

  return () => {
    stopped = true;
    queue.length = 0;
    offMessage();
    offOps();
  };
}
