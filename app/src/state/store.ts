/**
 * The DM window's Zustand store — the single source of truth (ADR 0003).
 *
 * Shared state only changes through `dispatch(op)`. Each dispatch bumps `seq`
 * and notifies op listeners, which is how the sync layer turns local changes
 * into delta messages without diffing state.
 *
 * The player window must never import this module; it gets a read-only
 * mirror instead (see `mirror.ts`). Enforced by ESLint and
 * `src/player/boundary.test.ts`.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  applyOps,
  initialSharedState,
  type SharedOp,
  type SharedState,
} from "./shared";

export interface TableState {
  shared: SharedState;
  /** Number of dispatches applied so far. Carried by every delta/snapshot. */
  seq: number;
  /** Apply one or more ops atomically; they travel as a single delta. */
  dispatch: (...ops: SharedOp[]) => void;
}

export type OpListener = (ops: readonly SharedOp[], seq: number) => void;

export interface TableStore extends StoreApi<TableState> {
  /** Called after every non-empty dispatch. Returns an unsubscribe function. */
  onOps(listener: OpListener): () => void;
}

export function createTableStore(
  initial: SharedState = initialSharedState()
): TableStore {
  const listeners = new Set<OpListener>();
  const store = createStore<TableState>((set, get) => ({
    shared: initial,
    seq: 0,
    dispatch(...ops) {
      if (ops.length === 0) return;
      const { shared, seq } = get();
      const nextSeq = seq + 1;
      set({ shared: applyOps(shared, ops), seq: nextSeq });
      for (const l of [...listeners]) l(ops, nextSeq);
    },
  }));
  return Object.assign(store, {
    onOps(listener: OpListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
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
