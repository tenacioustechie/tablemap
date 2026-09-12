/**
 * Player side of the sync protocol: feeds a mirror store from a transport.
 *
 * The only message a player ever sends is `hello` (a snapshot request): once
 * on start, whenever `reduceMirror` reports it cannot apply what it received
 * or a DM has (re)started, and on `announce()` — the view calls that when the
 * window lands on a different display, so the DM can send that display's
 * calibration (T006). The hello carries the display when `options.display`
 * can describe it. It never sends ops — there is no path from here to the
 * DM store.
 */
import { nanoid } from "nanoid";
import type { DisplayInfo } from "./calibration";
import { reduceMirror, type MirrorStore } from "./mirror";
import { decodeMessage, encodeMessage, hello } from "./sync";
import type { SyncTransport } from "./transport";

export interface PlayerSyncOptions {
  clientId?: string;
  /** Read when each hello is built; undefined sends a hello without a display. */
  display?: () => DisplayInfo | undefined;
}

export interface PlayerSyncHandle {
  /** Detach from the transport. The caller owns (and closes) the transport. */
  stop(): void;
  /** Send another hello (with the current display). */
  announce(): void;
}

export function startPlayerSync(
  mirror: MirrorStore,
  transport: SyncTransport,
  options: PlayerSyncOptions = {}
): PlayerSyncHandle {
  const clientId = options.clientId ?? nanoid();
  let stopped = false;
  const announce = () => {
    if (stopped) return;
    transport.post(encodeMessage(hello("player", clientId, options.display?.())));
  };

  const offMessage = transport.onMessage((raw) => {
    const result = decodeMessage(raw);
    if (!result.ok) return;
    const step = reduceMirror(mirror.getState(), result.message);
    if (step.state !== mirror.getState()) mirror.setState(step.state, true);
    if (step.resync) announce();
  });

  announce();

  return {
    stop() {
      stopped = true;
      offMessage();
    },
    announce,
  };
}
