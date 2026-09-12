/**
 * Transport abstraction under the sync protocol. Production uses a
 * BroadcastChannel (same origin, same browser — ADR 0003). Tests use an
 * in-memory hub with the same fan-out semantics: a post is delivered to every
 * *other* endpoint on the hub, never echoed back to the sender.
 */
import { SYNC_CHANNEL_NAME } from "./sync";

export type RawHandler = (raw: string) => void;

export interface SyncTransport {
  /** Broadcast an encoded message to every other endpoint. */
  post(raw: string): void;
  /** Subscribe to incoming raw messages. Returns an unsubscribe function. */
  onMessage(handler: RawHandler): () => void;
  /** Release the underlying channel. Posting afterwards is a no-op. */
  close(): void;
}

export type TransportFactory = () => SyncTransport;

export function createBroadcastTransport(
  name: string = SYNC_CHANNEL_NAME
): SyncTransport {
  if (typeof BroadcastChannel === "undefined") return createNullTransport();
  const channel = new BroadcastChannel(name);
  const handlers = new Set<RawHandler>();
  let closed = false;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "string") return;
    for (const h of handlers) h(event.data);
  };
  return {
    post(raw) {
      if (!closed) channel.postMessage(raw);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      channel.close();
    },
  };
}

/** Used where no channel is available (e.g. jsdom). Delivers nothing. */
export function createNullTransport(): SyncTransport {
  return { post() {}, onMessage: () => () => {}, close() {} };
}

export interface MemoryHub {
  connect(): SyncTransport;
  /** Every raw message posted through the hub, in order, with its sender. */
  readonly log: readonly { from: number; raw: string }[];
}

/** In-memory replacement for a BroadcastChannel, for unit tests. */
export function createMemoryHub(): MemoryHub {
  interface Endpoint {
    id: number;
    handlers: Set<RawHandler>;
    closed: boolean;
  }
  const endpoints = new Set<Endpoint>();
  const log: { from: number; raw: string }[] = [];
  let nextId = 0;

  return {
    log,
    connect() {
      const me: Endpoint = { id: nextId++, handlers: new Set(), closed: false };
      endpoints.add(me);
      return {
        post(raw) {
          if (me.closed) return;
          log.push({ from: me.id, raw });
          for (const other of endpoints) {
            if (other === me || other.closed) continue;
            for (const h of [...other.handlers]) h(raw);
          }
        },
        onMessage(handler) {
          me.handlers.add(handler);
          return () => me.handlers.delete(handler);
        },
        close() {
          me.closed = true;
          me.handlers.clear();
          endpoints.delete(me);
        },
      };
    },
  };
}
