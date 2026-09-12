/**
 * The DM window's Zustand store — the single source of truth (ADR 0003).
 *
 * Shared state only changes through `dispatch(op)`. Each dispatch bumps `seq`
 * and notifies op listeners, which is how the sync layer turns local changes
 * into delta messages without diffing state.
 *
 * `campaignId` is DM-only bookkeeping: which persisted document the shared
 * state belongs to. `openCampaign` sets it and replaces the shared state in
 * one commit, so the autosaver (ADR 0007) can tell "a different campaign was
 * opened" apart from "the current campaign changed".
 *
 * The player window must never import this module; it gets a read-only
 * mirror instead (see `mirror.ts`). Enforced by ESLint and
 * `src/player/boundary.test.ts`.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  displayInfoEqual,
  initialPresentationState,
  presentationForMapSwitch,
  type DisplayInfo,
  type PresentationState,
} from "./calibration";
import type { Campaign } from "./campaign";
import { addPing, type Ping } from "./ping";
import {
  applyOps,
  initialSharedState,
  type SharedOp,
  type SharedState,
} from "./shared";

export interface TableState {
  /** Id of the persisted campaign `shared` belongs to; null before any is opened. */
  campaignId: string | null;
  shared: SharedState;
  /** Number of dispatches applied so far. Carried by every delta/snapshot. */
  seq: number;
  /**
   * How the player window presents scenes (calibration, overview, ruler
   * screen; T006; pan centre, rotation, blackout, splash; T009). DM-only: it
   * belongs to the display and the session, not the campaign, so it is
   * neither part of `shared` nor sequenced — the sync layer pushes it as its
   * own `presentation` message whenever it changes. A dispatch that changes
   * the active map also resets the pan centre (`presentationForMapSwitch`).
   */
  presentation: PresentationState;
  /**
   * Recent pings the DM sent (T011): DM-only, transient, for the DM canvas's
   * own pulse. Bounded by `addPing`; not part of `shared` nor sequenced.
   */
  pings: readonly Ping[];
  /** Apply one or more ops atomically; they travel as a single delta. */
  dispatch: (...ops: SharedOp[]) => void;
  /** Record a ping locally and notify `onPing` listeners (the sync layer posts it). */
  sendPing: (ping: Ping) => void;
  /** Make `campaign` the current document and replace the shared state with its state. */
  openCampaign: (campaign: Campaign) => void;
  /** Forget the current document and reset the shared state. */
  closeCampaign: () => void;
  /** Patch the presentation. Same object (no notification) when nothing changes. */
  setPresentation: (patch: Partial<PresentationState>) => void;
  /**
   * Record the display a player window reported. A different display drops
   * the loaded calibration (it belonged to the old one) until the session
   * loads the right one; the same display keeps it.
   */
  setPlayerDisplay: (display: DisplayInfo | null) => void;
}

export type OpListener = (ops: readonly SharedOp[], seq: number) => void;
export type PingListener = (ping: Ping) => void;

export interface TableStore extends StoreApi<TableState> {
  /** Called after every non-empty dispatch. Returns an unsubscribe function. */
  onOps(listener: OpListener): () => void;
  /** Called for every `sendPing`. Returns an unsubscribe function. */
  onPing(listener: PingListener): () => void;
}

export function createTableStore(
  initial: SharedState = initialSharedState()
): TableStore {
  const listeners = new Set<OpListener>();
  const pingListeners = new Set<PingListener>();
  const store = createStore<TableState>((set, get) => {
    const commit = (
      ops: readonly SharedOp[],
      patch: Partial<Pick<TableState, "campaignId">> = {}
    ) => {
      if (ops.length === 0) return;
      const { shared, seq, presentation } = get();
      const nextSeq = seq + 1;
      const nextShared = applyOps(shared, ops);
      // The pan centre belongs to the active map (T009): a scene switch
      // recentres the player view (and raises the splash if the DM asked).
      const nextPresentation =
        nextShared.activeMapId === shared.activeMapId
          ? presentation
          : presentationForMapSwitch(presentation, nextShared.activeMapId);
      set({ ...patch, shared: nextShared, seq: nextSeq, presentation: nextPresentation });
      for (const l of [...listeners]) l(ops, nextSeq);
    };
    return {
      campaignId: null,
      shared: initial,
      seq: 0,
      presentation: initialPresentationState(),
      pings: [],
      dispatch(...ops) {
        commit(ops);
      },
      sendPing(ping) {
        const pings = addPing(get().pings, ping);
        if (pings === get().pings) return; // a duplicate id: already sent
        set({ pings });
        for (const l of [...pingListeners]) l(ping);
      },
      setPresentation(patch) {
        const current = get().presentation;
        const next = { ...current, ...patch };
        const changed = (Object.keys(next) as (keyof PresentationState)[]).some(
          (k) => next[k] !== current[k]
        );
        if (changed) set({ presentation: next });
      },
      setPlayerDisplay(display) {
        const current = get().presentation;
        if (displayInfoEqual(current.playerDisplay, display)) {
          if (current.playerDisplay !== display) {
            set({ presentation: { ...current, playerDisplay: display } });
          }
          return;
        }
        set({
          presentation: { ...current, playerDisplay: display, calibration: null },
        });
      },
      openCampaign(campaign) {
        commit([{ kind: "campaign/replace", state: campaign.state }], {
          campaignId: campaign.id,
        });
      },
      closeCampaign() {
        commit([{ kind: "campaign/replace", state: initialSharedState() }], {
          campaignId: null,
        });
      },
    };
  });
  return Object.assign(store, {
    onOps(listener: OpListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onPing(listener: PingListener) {
      pingListeners.add(listener);
      return () => {
        pingListeners.delete(listener);
      };
    },
  });
}

/** The app-wide DM store. Tests create their own via `createTableStore`. */
export const tableStore: TableStore = createTableStore();

export function useTableStore<T>(
  selector: (state: TableState) => T,
  store: TableStore = tableStore
): T {
  return useStore(store, selector);
}
