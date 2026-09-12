/**
 * Player side of the sync protocol: feeds a mirror store from a transport.
 *
 * The only message a player ever sends is `hello` (a snapshot request): once
 * on start, and again whenever `reduceMirror` reports it cannot apply what it
 * received. It never sends ops — there is no path from here to the DM store.
 */
import { nanoid } from "nanoid";
import { reduceMirror, type MirrorStore } from "./mirror";
import { decodeMessage, encodeMessage, hello } from "./sync";
import type { SyncTransport } from "./transport";

export interface PlayerSyncOptions {
  clientId?: string;
}

/** Returns a stop function. The caller owns (and closes) the transport. */
export function startPlayerSync(
  mirror: MirrorStore,
  transport: SyncTransport,
  options: PlayerSyncOptions = {}
): () => void {
  const clientId = options.clientId ?? nanoid();
  const requestSnapshot = () =>
    transport.post(encodeMessage(hello("player", clientId)));

  const offMessage = transport.onMessage((raw) => {
    const result = decodeMessage(raw);
    if (!result.ok) return;
    const step = reduceMirror(mirror.getState(), result.message);
    if (step.state !== mirror.getState()) mirror.setState(step.state, true);
    if (step.resync) requestSnapshot();
  });

  requestSnapshot();

  return () => {
    offMessage();
  };
}
