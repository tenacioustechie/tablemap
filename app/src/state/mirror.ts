/**
 * Player-side mirror of the shared state. It is written *only* by the sync
 * receiver (`startPlayerSync`) and read by the player view. There is no
 * dispatch; the player cannot change state.
 *
 * `reduceMirror` is a pure function of (mirror, message) so the protocol
 * semantics — snapshots replace, deltas must be contiguous, gaps trigger a
 * resync — are unit-testable without any transport.
 *
 * Binary assets the DM pushes (ADR 0008) live in `assets`, keyed by id. They
 * are not part of the sequenced state: an `asset` message is applied
 * whenever it arrives, and entries are dropped as soon as the shared state
 * stops referencing them so a long session cannot accumulate old images.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { base64ToBlob } from "./assetCodec";
import { referencedAssetIds } from "./maps";
import type { AssetId } from "./model";
import { applyOps, type SharedState } from "./shared";
import type { SyncMessage } from "./sync";

export type MirrorStatus = "connecting" | "synced";

export type MirrorAssets = Readonly<Record<AssetId, Blob>>;

export interface MirrorState {
  status: MirrorStatus;
  /** Sequence number of the last snapshot/delta applied. */
  seq: number;
  /** Null until the first snapshot arrives. */
  shared: SharedState | null;
  /** Blobs received from the DM, keyed by asset id. */
  assets: MirrorAssets;
}

export function initialMirrorState(): MirrorState {
  return { status: "connecting", seq: 0, shared: null, assets: {} };
}

export interface MirrorStep {
  state: MirrorState;
  /** True when the mirror cannot apply the message and needs a snapshot. */
  resync: boolean;
}

/** Keeps only the assets `shared` still references. Same object if nothing changes. */
function pruneAssets(assets: MirrorAssets, shared: SharedState): MirrorAssets {
  const keep = referencedAssetIds(shared);
  const ids = Object.keys(assets);
  if (ids.every((id) => keep.has(id))) return assets;
  const next: Record<AssetId, Blob> = {};
  for (const id of ids) if (keep.has(id)) next[id] = assets[id];
  return next;
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
        state: {
          status: "synced",
          seq: message.seq,
          shared: message.state,
          assets: pruneAssets(mirror.assets, message.state),
        },
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
      const shared = applyOps(mirror.shared, message.ops);
      return {
        state: {
          status: "synced",
          seq: message.seq,
          shared,
          assets: pruneAssets(mirror.assets, shared),
        },
        resync: false,
      };
    }

    case "asset": {
      let blob: Blob;
      try {
        blob = base64ToBlob(message.data, message.mime);
      } catch {
        return { state: mirror, resync: false };
      }
      return {
        state: { ...mirror, assets: { ...mirror.assets, [message.id]: blob } },
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
