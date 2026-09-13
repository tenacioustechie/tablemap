/**
 * The DM sidebar's tab strip (T016): five tabs grouped by phase of use, one
 * panel mounted at a time. Pure presentation — the active tab is DM-window
 * UI state remembered in `localStorage` (`tablemap.dm.tab`), nothing in the
 * store or on the wire. Follows the WAI-ARIA tabs pattern: `role="tablist"`
 * / `role="tab"` with `aria-selected` + `aria-controls`, roving `tabIndex`,
 * Left / Right (and Home / End) move between tabs and select as they go.
 *
 * T019 adds a collapse button in the strip (`sidebar-toggle`): collapsed,
 * the strip shows only each tab's initial and no panel, and choosing a tab
 * expands it again. Remembered next to the tab (`tablemap.dm.sidebar`).
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
export const SIDEBAR_STORAGE_KEY = "tablemap.dm.sidebar";

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

/** Whether the sidebar was left collapsed; expanded when nothing (valid) is stored or storage fails. */
export function readStoredSidebarCollapsed(storage: TabStorage | null | undefined): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** The sidebar's collapsed state as React state, read from and written through to `storage`. */
export function useRememberedSidebar(
  storage: TabStorage | null | undefined = defaultTabStorage()
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(() =>
    readStoredSidebarCollapsed(storage)
  );
  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      try {
        storage?.setItem(SIDEBAR_STORAGE_KEY, next ? "collapsed" : "expanded");
      } catch {
        // As for the tab: a failed write costs the memory, not the change.
      }
    },
    [storage]
  );
  return [collapsed, setCollapsed];
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
    alignItems: "stretch",
    borderBottom: "1px solid #333",
    background: "#111",
  },
  tablistCollapsed: {
    flexDirection: "column",
    flexWrap: "nowrap",
    borderBottom: "none",
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
  tabCollapsed: {
    flex: "0 0 auto",
    padding: "10px 0",
    borderBottom: "none",
    borderLeft: "2px solid transparent",
    fontWeight: 600,
  },
  tabActive: {
    color: "#fff",
    borderBottomColor: "#8cf",
    background: "#161616",
  },
  tabActiveCollapsed: {
    color: "#fff",
    borderLeftColor: "#8cf",
    background: "#161616",
  },
  toggle: {
    flex: "0 0 auto",
    padding: "8px 10px",
    background: "none",
    border: "none",
    color: "#aaa",
    fontSize: 13,
    cursor: "pointer",
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
  /** Collapsed: only the tab initials and the toggle show; no panel is mounted. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The active tab's panel content; the caller mounts only that tab's panels. */
  children: ReactNode;
}

const tabElementId = (id: DmTabId) => `dm-tab-${id}`;
const panelElementId = (id: DmTabId) => `dm-tabpanel-${id}`;

export function SidebarTabs({
  active,
  onSelect,
  collapsed,
  onCollapsedChange,
  children,
}: SidebarTabsProps) {
  const buttons = useRef<Partial<Record<DmTabId, HTMLButtonElement | null>>>({});

  // Choosing a tab (click or arrow key) always shows its panel: a collapsed
  // sidebar expands on the way.
  const choose = (id: DmTabId) => {
    onSelect(id);
    if (collapsed) onCollapsedChange(false);
  };

  const moveTo = (index: number) => {
    const next = DM_TABS[(index + DM_TABS.length) % DM_TABS.length].id;
    choose(next);
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
    <div style={styles.root} data-collapsed={collapsed ? "true" : "false"}>
      <div
        role="tablist"
        aria-label="DM tools"
        aria-orientation={collapsed ? "vertical" : "horizontal"}
        data-testid="dm-tablist"
        style={collapsed ? { ...styles.tablist, ...styles.tablistCollapsed } : styles.tablist}
      >
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onCollapsedChange(!collapsed)}
          style={styles.toggle}
        >
          {collapsed ? "»" : "«"}
        </button>
        {DM_TABS.map((t, index) => {
          const selected = t.id === active;
          const base = collapsed ? { ...styles.tab, ...styles.tabCollapsed } : styles.tab;
          const activeStyle = collapsed ? styles.tabActiveCollapsed : styles.tabActive;
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
              aria-controls={collapsed ? undefined : panelElementId(t.id)}
              aria-label={t.label}
              title={collapsed ? t.label : undefined}
              tabIndex={selected ? 0 : -1}
              data-testid={tabElementId(t.id)}
              style={selected ? { ...base, ...activeStyle } : base}
              onClick={() => choose(t.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {collapsed ? t.label[0] : t.label}
            </button>
          );
        })}
      </div>
      {!collapsed && (
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
      )}
    </div>
  );
}
