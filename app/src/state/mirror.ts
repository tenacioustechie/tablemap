/**
 * Player-side mirror of the shared state. It is written *only* by the sync
 * receiver (`startPlayerSync`) and read by the player view. There is no
 * dispatch; the player cannot change state.
 *
 * `reduceMirror` is a pure function of (mirror, message) so the protocol
 * semantics — snapshots replace, deltas must be contiguous, gaps trigger a
 * resync — are unit-testable without any transport.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { applyOps, type SharedState } from "./shared";
import type { SyncMessage } from "./sync";

export type MirrorStatus = "connecting" | "synced";

export interface MirrorState {
  status: MirrorStatus;
  /** Sequence number of the last snapshot/delta applied. */
  seq: number;
  /** Null until the first snapshot arrives. */
  shared: SharedState | null;
}

export function initialMirrorState(): MirrorState {
  return { status: "connecting", seq: 0, shared: null };
}

export interface MirrorStep {
  state: MirrorState;
  /** True when the mirror cannot apply the message and needs a snapshot. */
  resync: boolean;
}

export function reduceMirror(
  mirror: MirrorState,
  message: SyncMessage
): MirrorStep {
  switch (message.type) {
    case "hello":
      // The DM sends a snapshot right after its own hello; nothing to do.
      return { state: mirror, resync: false };

    case "snapshot":
      // Snapshots are authoritative regardless of seq (the DM may have
      // restarted and reset its counter).
      return {
        state: { status: "synced", seq: message.seq, shared: message.state },
        resync: false,
      };

    case "delta": {
      if (mirror.shared === null) {
        // No baseline yet: we cannot apply ops. Ask for a snapshot.
        return { state: mirror, resync: true };
      }
      if (message.seq <= mirror.seq) {
        // Duplicate or stale; already reflected.
        return { state: mirror, resync: false };
      }
      if (message.seq !== mirror.seq + 1) {
        // Missed at least one delta. Keep rendering what we have, resync.
        return { state: mirror, resync: true };
      }
      return {
        state: {
          status: "synced",
          seq: message.seq,
          shared: applyOps(mirror.shared, message.ops),
        },
        resync: false,
      };
    }
  }
}

export type MirrorStore = StoreApi<MirrorState>;

export function createMirrorStore(): MirrorStore {
  return createStore<MirrorState>(() => initialMirrorState());
}

export function useMirror<T>(
  store: MirrorStore,
  selector: (state: MirrorState) => T
): T {
  return useStore(store, selector);
}
