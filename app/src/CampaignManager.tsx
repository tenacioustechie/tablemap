/**
 * Campaign manager (route "/"): lists stored campaigns; create, open, rename,
 * delete. Talks to IndexedDB through `state/persistence` and to the DM store
 * only to open/close the campaign the DM view is editing.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ROUTE_DM } from "./routePaths";
import { DEFAULT_CAMPAIGN_NAME, type CampaignSummary } from "./state/campaign";
import { getDb, type TableMapDb } from "./state/db";
import {
  createCampaign,
  deleteCampaign,
  listCampaigns,
  renameCampaign,
  setLastCampaignId,
} from "./state/persistence";
import { openStoredCampaign } from "./state/session";
import { tableStore, useTableStore, type TableStore } from "./state/store";

const styles = {
  main: { padding: 24, maxWidth: 720 },
  form: { display: "flex", gap: 8, marginBottom: 24 },
  input: {
    padding: "6px 8px",
    background: "#0d0d0d",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: 4,
    flex: 1,
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    borderBottom: "1px solid #333",
  },
  name: { fontWeight: 600 },
  meta: { color: "#888", fontSize: 12, marginRight: "auto" },
  badge: {
    fontSize: 11,
    color: "#8cf",
    border: "1px solid #8cf",
    borderRadius: 3,
    padding: "0 4px",
  },
  error: { color: "#f88" },
  empty: { color: "#888" },
} satisfies Record<string, CSSProperties>;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CampaignManagerProps {
  /** Injected in tests; the real app uses the app-wide store. */
  store?: TableStore;
  /** Injected in tests; the real app uses the app-wide database. */
  db?: TableMapDb;
}

export function CampaignManager({
  store = tableStore,
  db = getDb(),
}: CampaignManagerProps) {
  const navigate = useNavigate();
  const openId = useTableStore((s) => s.campaignId, store);
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setCampaigns(await listCampaigns(db));
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    listCampaigns(db).then(
      (list) => {
        if (!cancelled) setCampaigns(list);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [db]);

  /** Runs a storage action, then refreshes the list; errors go to the banner. */
  const run = (action: () => Promise<void>) => {
    setError(null);
    action()
      .then(refresh)
      .catch((e: unknown) => setError(describeError(e)));
  };

  const create = () =>
    run(async () => {
      const name = newName.trim() || DEFAULT_CAMPAIGN_NAME;
      const campaign = await createCampaign(db, name);
      setNewName("");
      store.getState().openCampaign(campaign);
      await setLastCampaignId(db, campaign.id);
      navigate(ROUTE_DM);
    });

  const open = (id: string) =>
    run(async () => {
      if (!(await openStoredCampaign(store, db, id))) {
        throw new Error("That campaign no longer exists.");
      }
      navigate(ROUTE_DM);
    });

  const rename = (id: string, name: string) =>
    run(async () => {
      const trimmed = name.trim() || DEFAULT_CAMPAIGN_NAME;
      await renameCampaign(db, id, trimmed);
      if (store.getState().campaignId === id) {
        store.getState().dispatch({ kind: "campaign/set-name", name: trimmed });
      }
      setEditing(null);
    });

  const remove = (id: string) =>
    run(async () => {
      await deleteCampaign(db, id);
      if (store.getState().campaignId === id) store.getState().closeCampaign();
      setConfirmDeleteId(null);
    });

  return (
    <main data-testid="campaign-manager" style={styles.main}>
      <h1>TableMap</h1>

      <form
        style={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          aria-label="New campaign name"
          placeholder="New campaign name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={styles.input}
        />
        <button type="submit">Create campaign</button>
      </form>

      {error !== null && (
        <p data-testid="campaign-manager-error" role="alert" style={styles.error}>
          {error}
        </p>
      )}

      {campaigns === null ? (
        <p style={styles.empty}>Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <p data-testid="campaign-list-empty" style={styles.empty}>
          No campaigns yet. Create one above.
        </p>
      ) : (
        <ul data-testid="campaign-list" style={styles.list}>
          {campaigns.map((c) => (
            <li
              key={c.id}
              data-testid="campaign-item"
              data-campaign-id={c.id}
              style={styles.item}
            >
              {editing?.id === c.id ? (
                <form
                  style={{ ...styles.form, marginBottom: 0, flex: 1 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(c.id, editing.name);
                  }}
                >
                  <input
                    aria-label="Campaign name"
                    autoFocus
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ id: c.id, name: e.target.value })
                    }
                    style={styles.input}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span data-testid="campaign-item-name" style={styles.name}>
                    {c.name || DEFAULT_CAMPAIGN_NAME}
                  </span>
                  {openId === c.id && (
                    <span data-testid="campaign-open-badge" style={styles.badge}>
                      open
                    </span>
                  )}
                  <span style={styles.meta}>
                    Updated {new Date(c.updatedAt).toLocaleString()}
                  </span>
                  <button type="button" onClick={() => open(c.id)}>
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing({ id: c.id, name: c.name })}
                  >
                    Rename
                  </button>
                  {confirmDeleteId === c.id ? (
                    <>
                      <button type="button" onClick={() => remove(c.id)}>
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(c.id)}
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to={ROUTE_DM} style={{ color: "#8cf" }}>
          Open DM view
        </Link>{" "}
        <span style={styles.meta}>(resumes the last opened campaign)</span>
      </p>
    </main>
  );
}
