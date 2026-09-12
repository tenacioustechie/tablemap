/**
 * Debounced autosave from a store subscription (ADR 0007).
 *
 * Watches `shared` on the DM store. Every change while a campaign is open
 * (re)starts a timer; when it fires, the latest shared state is handed to
 * `save`. Saves are serialised so a slow write can never be overtaken by a
 * later one. Opening a different campaign flushes anything pending for the
 * previous one first, and the freshly opened state is taken as the baseline
 * (it came from storage, nothing to write).
 *
 * Pure logic with an injectable `save`; no IndexedDB here.
 */
import type { SharedState } from "./shared";
import type { TableStore } from "./store";

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 400;

export type SaveFn = (campaignId: string, state: SharedState) => Promise<void>;

export interface AutosaveOptions {
  debounceMs?: number;
  /** Called when `save` rejects. Default: `console.error`. */
  onError?: (error: unknown) => void;
}

export interface AutosaveHandle {
  /** Write any pending change now; resolves once all queued saves finish. */
  flush(): Promise<void>;
  /** Stop watching, then flush. */
  stop(): Promise<void>;
  /** True while a change is waiting for the debounce timer. */
  isPending(): boolean;
}

export function startAutosave(
  store: TableStore,
  save: SaveFn,
  {
    debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
    onError = (error) => console.error("autosave failed", error),
  }: AutosaveOptions = {}
): AutosaveHandle {
  let baseline: SharedState = store.getState().shared;
  let pending: { campaignId: string; state: SharedState } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = (): Promise<void> => {
    clearTimer();
    if (pending) {
      const { campaignId, state } = pending;
      pending = null;
      queue = queue.then(() => save(campaignId, state)).catch(onError);
    }
    return queue;
  };

  const schedule = (campaignId: string, state: SharedState) => {
    pending = { campaignId, state };
    clearTimer();
    timer = setTimeout(() => void flush(), debounceMs);
  };

  const unsubscribe = store.subscribe((next, prev) => {
    if (next.campaignId !== prev.campaignId) {
      // Different (or no) document: settle the old one, start clean.
      void flush();
      baseline = next.shared;
      return;
    }
    if (next.campaignId === null || next.shared === baseline) return;
    baseline = next.shared;
    schedule(next.campaignId, next.shared);
  });

  return {
    flush,
    isPending: () => pending !== null,
    async stop() {
      unsubscribe();
      await flush();
    },
  };
}
