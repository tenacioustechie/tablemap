/**
 * DM side of the sync protocol: publishes the store over a transport.
 *
 * - On start: announce (`hello`) and broadcast a snapshot so any player
 *   window that is already open catches up, then the presentation.
 * - On player `hello`: remember the display it reports (DM-only bookkeeping,
 *   never shared state), broadcast a snapshot and the presentation.
 * - On every dispatch: broadcast the ops as a delta.
 * - Presentation (ADR 0011): whenever the store's DM-only presentation
 *   changes in a way the player can see, broadcast one `presentation`
 *   message. Unsequenced; the latest wins.
 * - Assets (ADR 0008): after the snapshot/delta, push every asset the state
 *   references that this publisher has not sent yet, active map first. A
 *   hello from a player this publisher has not served yet re-sends them all
 *   (a fresh window has nothing); a known player re-announcing (it moved to
 *   another display) only gets the snapshot and presentation again.
 *   Assets are read through `options.assets`; without it nothing is pushed.
 * - Annotations (T011, ADR 0016): DM-only annotations (notes, DM-only
 *   drawings) never leave this window. Every snapshot goes out as
 *   `sharedStateForPlayer` and every delta as `opsForPlayer`; the seq still
 *   advances by one per dispatch so the player stays contiguous (a dispatch
 *   that only touched notes becomes a delta of harmless ops).
 * - Pings (T011): every `store.sendPing` is posted as one unsequenced `ping`.
 */
import { nanoid } from "nanoid";
import { opsForPlayer, sharedStateForPlayer } from "./annotations";
import { blobToBase64 } from "./assetCodec";
import {
  playerPresentation,
  playerPresentationEqual,
  type PlayerPresentation,
} from "./calibration";
import { assetIdsForPlayer } from "./maps";
import type { AssetId, AssetKind } from "./model";
import type { TableStore } from "./store";
import {
  asset,
  decodeMessage,
  delta,
  encodeMessage,
  hello,
  ping,
  presentation,
  snapshot,
} from "./sync";
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
  /** Players that have received a full asset push this session. */
  const servedPlayers = new Set<string>();

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
    transport.post(encodeMessage(snapshot(seq, sharedStateForPlayer(shared))));
  };

  let lastPresentation: PlayerPresentation | null = null;
  const sendPresentation = () => {
    lastPresentation = playerPresentation(store.getState().presentation);
    transport.post(encodeMessage(presentation(lastPresentation)));
  };

  const offMessage = transport.onMessage((raw) => {
    const result = decodeMessage(raw);
    if (!result.ok) return;
    const { message } = result;
    if (message.type === "hello" && message.role === "player") {
      if (message.display) store.getState().setPlayerDisplay(message.display);
      sendSnapshot();
      sendPresentation();
      const fresh = !servedPlayers.has(message.clientId);
      servedPlayers.add(message.clientId);
      publishAssets(fresh);
    }
  });

  const offOps = store.onOps((ops, seq) => {
    transport.post(encodeMessage(delta(seq, opsForPlayer(ops))));
    publishAssets(false);
  });

  const offPing = store.onPing((value) => {
    transport.post(encodeMessage(ping(value)));
  });

  const offPresentation = store.subscribe((state) => {
    const next = playerPresentation(state.presentation);
    if (lastPresentation && playerPresentationEqual(lastPresentation, next)) return;
    sendPresentation();
  });

  transport.post(encodeMessage(hello("dm", clientId)));
  sendSnapshot();
  sendPresentation();
  publishAssets(false);

  return () => {
    stopped = true;
    queue.length = 0;
    offMessage();
    offOps();
    offPing();
    offPresentation();
  };
}
