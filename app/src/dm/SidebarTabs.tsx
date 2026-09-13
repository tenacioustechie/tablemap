/**
 * The DM sidebar's tab strip (T016): five tabs grouped by phase of use, one
 * panel mounted at a time. Pure presentation — the active tab is DM-window
 * UI state remembered in `localStorage` (`tablemap.dm.tab`), nothing in the
 * store or on the wire. Follows the WAI-ARIA tabs pattern: `role="tablist"`
 * / `role="tab"` with `aria-selected` + `aria-controls`, roving `tabIndex`,
 * Left / Right (and Home / End) move between tabs and select as they go.
 */
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export const DM_TABS = [
  { id: "maps", label: "Maps" },
  { id: "fog", label: "Fog" },
  { id: "tokens", label: "Tokens" },
  { id: "draw", label: "Draw" },
  { id: "table", label: "Table" },
] as const;

export type DmTabId = (typeof DM_TABS)[number]["id"];

export const DEFAULT_DM_TAB: DmTabId = "maps";

export function isDmTabId(value: unknown): value is DmTabId {
  return DM_TABS.some((t) => t.id === value);
}

export const TAB_STORAGE_KEY = "tablemap.dm.tab";

/** The slice of `Storage` the tab memory needs; tests pass a plain object. */
export interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage` where the browser allows it (it may throw when disabled). */
export function defaultTabStorage(): TabStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The remembered tab, or Maps when nothing (valid) is stored or storage fails. */
export function readStoredTab(storage: TabStorage | null | undefined): DmTabId {
  try {
    const value = storage?.getItem(TAB_STORAGE_KEY);
    return isDmTabId(value) ? value : DEFAULT_DM_TAB;
  } catch {
    return DEFAULT_DM_TAB;
  }
}

/** The active tab as React state, read from and written through to `storage`. */
export function useRememberedTab(
  storage: TabStorage | null | undefined = defaultTabStorage()
): [DmTabId, (id: DmTabId) => void] {
  const [tab, setTabState] = useState<DmTabId>(() => readStoredTab(storage));
  const setTab = useCallback(
    (id: DmTabId) => {
      setTabState(id);
      try {
        storage?.setItem(TAB_STORAGE_KEY, id);
      } catch {
        // A full or disabled storage only costs the memory, not the switch.
      }
    },
    [storage]
  );
  return [tab, setTab];
}

const styles = {
  root: {
    display: "grid",
    gridTemplateRows: "auto 1fr",
    minHeight: 0,
    height: "100%",
  },
  tablist: {
    display: "flex",
    flexWrap: "wrap",
    borderBottom: "1px solid #333",
    background: "#111",
  },
  tab: {
    flex: "1 0 auto",
    padding: "8px 6px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#aaa",
    fontSize: 13,
    cursor: "pointer",
  },
  tabActive: {
    color: "#fff",
    borderBottomColor: "#8cf",
    background: "#161616",
  },
  panel: {
    minHeight: 0,
    overflowY: "auto",
    padding: 12,
  },
} satisfies Record<string, CSSProperties>;

export interface SidebarTabsProps {
  active: DmTabId;
  onSelect: (id: DmTabId) => void;
  /** The active tab's panel content; the caller mounts only that tab's panels. */
  children: ReactNode;
}

const tabElementId = (id: DmTabId) => `dm-tab-${id}`;
const panelElementId = (id: DmTabId) => `dm-tabpanel-${id}`;

export function SidebarTabs({ active, onSelect, children }: SidebarTabsProps) {
  const buttons = useRef<Partial<Record<DmTabId, HTMLButtonElement | null>>>({});

  const moveTo = (index: number) => {
    const next = DM_TABS[(index + DM_TABS.length) % DM_TABS.length].id;
    onSelect(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        moveTo(index + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveTo(index - 1);
        break;
      case "Home":
        e.preventDefault();
        moveTo(0);
        break;
      case "End":
        e.preventDefault();
        moveTo(DM_TABS.length - 1);
        break;
    }
  };

  return (
    <div style={styles.root}>
      <div role="tablist" aria-label="DM tools" data-testid="dm-tablist" style={styles.tablist}>
        {DM_TABS.map((t, index) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={tabElementId(t.id)}
              aria-selected={selected}
              aria-controls={panelElementId(t.id)}
              tabIndex={selected ? 0 : -1}
              data-testid={tabElementId(t.id)}
              style={selected ? { ...styles.tab, ...styles.tabActive } : styles.tab}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelElementId(active)}
        aria-labelledby={tabElementId(active)}
        data-testid="dm-tabpanel"
        data-tab={active}
        style={styles.panel}
      >
        {children}
      </div>
    </div>
  );
}
