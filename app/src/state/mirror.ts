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
import {
  clonePlayerPresentation,
  defaultPlayerPresentation,
  playerPresentationEqual,
  type PlayerPresentation,
} from "./calibration";
import { referencedAssetIds } from "./maps";
import type { AssetId } from "./model";
import { addPing, type Ping } from "./ping";
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
  /** How to present scenes on this display (T006); the latest `presentation` message. */
  presentation: PlayerPresentation;
  /** Recent pings (T011); the view draws the ones still active (`ping.ts`). */
  pings: readonly Ping[];
}

export function initialMirrorState(): MirrorState {
  return {
    status: "connecting",
    seq: 0,
    shared: null,
    assets: {},
    presentation: defaultPlayerPresentation(),
    pings: [],
  };
}

export interface MirrorStep {
  state: MirrorState;
  /**
   * True when the player should (re)announce itself: it cannot apply the
   * message and needs a snapshot, or a DM just started and needs to learn
   * which display this player is on.
   */
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
      // A DM that (re)starts sends a snapshot right after its hello, so the
      // state needs nothing. But that DM has never heard from this player:
      // announce again so it learns the display and sends its calibration.
      return { state: mirror, resync: message.role === "dm" };

    case "snapshot":
      // Snapshots are authoritative regardless of seq (the DM may have
      // restarted and reset its counter).
      return {
        state: {
          status: "synced",
          seq: message.seq,
          shared: message.state,
          assets: pruneAssets(mirror.assets, message.state),
          presentation: mirror.presentation,
          pings: mirror.pings,
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
          presentation: mirror.presentation,
          pings: mirror.pings,
        },
        resync: false,
      };
    }

    case "ping": {
      const pings = addPing(mirror.pings, message.ping);
      if (pings === mirror.pings) return { state: mirror, resync: false };
      return { state: { ...mirror, pings }, resync: false };
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

    case "presentation": {
      if (playerPresentationEqual(mirror.presentation, message.presentation)) {
        return { state: mirror, resync: false };
      }
      return {
        state: { ...mirror, presentation: clonePlayerPresentation(message.presentation) },
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
