/**
 * The /dm route: makes sure a campaign is open in the DM store (load-on-start,
 * ADR 0007), then renders `DmView` and keeps the campaign autosaved for as
 * long as the route is mounted.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTE_CAMPAIGNS } from "../routePaths";
import { startAutosave } from "../state/autosave";
import { getDb, type TableMapDb } from "../state/db";
import { saveCampaignState } from "../state/persistence";
import { bootstrapCampaign } from "../state/session";
import { tableStore, useTableStore, type TableStore } from "../state/store";
import { DmView, type DmViewProps } from "./DmView";

export interface DmRouteProps extends DmViewProps {
  /** Injected in tests; the real app uses the app-wide database. */
  db?: TableMapDb;
  /** Autosave debounce; tests shorten it. */
  autosaveDebounceMs?: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Debounced autosave of the open campaign; flushes on unmount and on page hide. */
export function useAutosave(
  store: TableStore,
  db: TableMapDb,
  debounceMs?: number
): void {
  useEffect(() => {
    const handle = startAutosave(
      store,
      async (id, state) => {
        await saveCampaignState(db, id, state);
      },
      { debounceMs }
    );
    const onPageHide = () => void handle.flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void handle.stop();
    };
  }, [store, db, debounceMs]);
}

export function DmRoute({
  store = tableStore,
  db = getDb(),
  autosaveDebounceMs,
  ...viewProps
}: DmRouteProps) {
  const campaignId = useTableStore((s) => s.campaignId, store);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bootstrapCampaign(store, db).catch((e: unknown) => {
      if (!cancelled) setError(describeError(e));
    });
    return () => {
      cancelled = true;
    };
  }, [store, db]);

  useAutosave(store, db, autosaveDebounceMs);

  if (campaignId !== null) {
    return <DmView store={store} db={db} {...viewProps} />;
  }
  if (error !== null) {
    return (
      <main data-testid="dm-load-error" style={{ padding: 24 }}>
        <h1>Could not open a campaign</h1>
        <p>{error}</p>
        <Link to={ROUTE_CAMPAIGNS} style={{ color: "#8cf" }}>
          Back to campaigns
        </Link>
      </main>
    );
  }
  return (
    <main data-testid="dm-loading" style={{ padding: 24, color: "#aaa" }}>
      Opening campaign…
    </main>
  );
}
