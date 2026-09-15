/**
 * The sidebar tab strip on its own (T016): ARIA roles and wiring, arrow-key
 * movement, and the remembered tab through a fake storage. T019: the
 * collapse toggle and the remembered collapsed state. What each tab holds
 * is covered through `DmView` (`DmView.test.tsx` and the panel tests).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  DEFAULT_DM_TAB,
  DM_TABS,
  SIDEBAR_STORAGE_KEY,
  SidebarTabs,
  TAB_STORAGE_KEY,
  readStoredSidebarCollapsed,
  readStoredTab,
  useRememberedSidebar,
  useRememberedTab,
  type DmTabId,
  type TabStorage,
} from "./SidebarTabs";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: TabStorage & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
  return storage;
}

/** A controlled harness: the panel shows which tab is open. */
function Harness({
  initial = "maps" as DmTabId,
  initialCollapsed = false,
}: {
  initial?: DmTabId;
  initialCollapsed?: boolean;
}) {
  const [tab, setTab] = useState<DmTabId>(initial);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <SidebarTabs active={tab} onSelect={setTab} collapsed={collapsed} onCollapsedChange={setCollapsed}>
      <p data-testid="panel-content">{tab} panel</p>
    </SidebarTabs>
  );
}

/** The hooks under test, driven by clicks on the real strip. */
function Remembered({ storage }: { storage: TabStorage | null }) {
  const [tab, setTab] = useRememberedTab(storage);
  const [collapsed, setCollapsed] = useRememberedSidebar(storage);
  return (
    <SidebarTabs active={tab} onSelect={setTab} collapsed={collapsed} onCollapsedChange={setCollapsed}>
      <p data-testid="panel-content">{tab} panel</p>
    </SidebarTabs>
  );
}

const tab = (id: DmTabId) => screen.getByTestId(`dm-tab-${id}`);
const panel = () => screen.getByTestId("dm-tabpanel");
const toggle = () => screen.getByTestId("sidebar-toggle");

describe("SidebarTabs", () => {
  it("renders the seven tabs in order with the tabs pattern roles", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    // T101 adds Walls after Draw; T110 adds Turns after Tokens.
    expect(tabs.map((t) => t.textContent)).toEqual(["Maps", "Fog", "Tokens", "Turns", "Draw", "Walls", "Table"]);
    expect(tabs.map((t) => t.dataset.testid)).toEqual(DM_TABS.map((t) => `dm-tab-${t.id}`));
    expect(list.contains(tabs[0])).toBe(true);
    expect(tab("maps").getAttribute("aria-selected")).toBe("true");
    expect(tab("fog").getAttribute("aria-selected")).toBe("false");
    // Roving tabindex: only the selected tab is in the tab order.
    expect(tab("maps").tabIndex).toBe(0);
    expect(tab("fog").tabIndex).toBe(-1);
    // The panel is labelled by, and controlled from, the selected tab.
    expect(panel().getAttribute("role")).toBe("tabpanel");
    expect(panel().dataset.tab).toBe("maps");
    expect(tab("maps").getAttribute("aria-controls")).toBe(panel().id);
    expect(panel().getAttribute("aria-labelledby")).toBe(tab("maps").id);
    expect(screen.getByTestId("panel-content").textContent).toBe("maps panel");
  });

  it("a click selects a tab and swaps the panel", () => {
    render(<Harness />);
    fireEvent.click(tab("tokens"));
    expect(tab("tokens").getAttribute("aria-selected")).toBe("true");
    expect(tab("maps").getAttribute("aria-selected")).toBe("false");
    expect(panel().dataset.tab).toBe("tokens");
    expect(tab("tokens").getAttribute("aria-controls")).toBe(panel().id);
    expect(screen.getByTestId("panel-content").textContent).toBe("tokens panel");
  });

  it("Left / Right arrows move between tabs (wrapping) and select as they go; Home / End jump", () => {
    render(<Harness />);
    tab("maps").focus();
    fireEvent.keyDown(tab("maps"), { key: "ArrowRight" });
    expect(panel().dataset.tab).toBe("fog");
    expect(document.activeElement).toBe(tab("fog"));
    fireEvent.keyDown(tab("fog"), { key: "ArrowRight" });
    expect(panel().dataset.tab).toBe("tokens");
    fireEvent.keyDown(tab("tokens"), { key: "ArrowLeft" });
    expect(panel().dataset.tab).toBe("fog");
    expect(document.activeElement).toBe(tab("fog"));
    fireEvent.keyDown(tab("fog"), { key: "ArrowLeft" });
    fireEvent.keyDown(tab("maps"), { key: "ArrowLeft" });
    expect(panel().dataset.tab).toBe("table");
    fireEvent.keyDown(tab("table"), { key: "ArrowRight" });
    expect(panel().dataset.tab).toBe("maps");
    fireEvent.keyDown(tab("maps"), { key: "End" });
    expect(panel().dataset.tab).toBe("table");
    fireEvent.keyDown(tab("table"), { key: "Home" });
    expect(panel().dataset.tab).toBe("maps");
    // Other keys are left alone.
    fireEvent.keyDown(tab("maps"), { key: "ArrowDown" });
    expect(panel().dataset.tab).toBe("maps");
  });

  it("remembers the chosen tab in the storage under tablemap.dm.tab", () => {
    const storage = fakeStorage();
    render(<Remembered storage={storage} />);
    expect(panel().dataset.tab).toBe("maps");
    fireEvent.click(tab("draw"));
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("draw");
    fireEvent.keyDown(tab("draw"), { key: "ArrowRight" });
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("walls");
    fireEvent.keyDown(tab("walls"), { key: "ArrowRight" });
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("table");
  });

  it("starts on the remembered tab, and on Maps when nothing valid is stored", () => {
    const remembered = fakeStorage({ [TAB_STORAGE_KEY]: "fog" });
    const { unmount } = render(<Remembered storage={remembered} />);
    expect(panel().dataset.tab).toBe("fog");
    unmount();

    const junk = fakeStorage({ [TAB_STORAGE_KEY]: "kitchen" });
    const second = render(<Remembered storage={junk} />);
    expect(panel().dataset.tab).toBe("maps");
    second.unmount();

    render(<Remembered storage={null} />);
    expect(panel().dataset.tab).toBe(DEFAULT_DM_TAB);
  });

  it("survives a storage that throws", () => {
    const broken: TabStorage = {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readStoredTab(broken)).toBe("maps");
    expect(readStoredSidebarCollapsed(broken)).toBe(false);
    render(<Remembered storage={broken} />);
    fireEvent.click(tab("table"));
    expect(panel().dataset.tab).toBe("table");
    fireEvent.click(toggle());
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
  });
});

describe("SidebarTabs collapse (T019)", () => {
  it("the toggle collapses the strip to the tab initials with no panel, and expands it again", () => {
    render(<Harness initial="fog" />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Collapse sidebar");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Expand sidebar");
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    expect(screen.queryByTestId("panel-content")).toBeNull();
    // The tabs are still there, by name, showing only their initial.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["M", "F", "T", "T", "D", "W", "T"]);
    expect(screen.getByRole("tab", { name: "Tokens" })).toBe(tab("tokens"));
    expect(tab("fog").getAttribute("aria-selected")).toBe("true");
    expect(tab("fog").getAttribute("aria-controls")).toBeNull();
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel().dataset.tab).toBe("fog");
    expect(screen.getByTestId("panel-content").textContent).toBe("fog panel");
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("choosing a tab while collapsed, by click or arrow key, expands the sidebar on that tab", () => {
    render(<Harness initialCollapsed />);
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    fireEvent.click(tab("draw"));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel().dataset.tab).toBe("draw");

    fireEvent.click(toggle());
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    fireEvent.keyDown(tab("draw"), { key: "ArrowRight" });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel().dataset.tab).toBe("walls");
    expect(document.activeElement).toBe(tab("walls"));
  });

  it("remembers the collapsed state under tablemap.dm.sidebar, next to the tab", () => {
    const storage = fakeStorage();
    const first = render(<Remembered storage={storage} />);
    fireEvent.click(tab("tokens"));
    fireEvent.click(toggle());
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("collapsed");
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("tokens");
    first.unmount();

    // "Reload": collapsed, on the remembered tab.
    const second = render(<Remembered storage={storage} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("dm-tabpanel")).toBeNull();
    expect(tab("tokens").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(toggle());
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("expanded");
    expect(panel().dataset.tab).toBe("tokens");
    second.unmount();

    // A tab chosen while collapsed writes both.
    storage.data.set(SIDEBAR_STORAGE_KEY, "collapsed");
    render(<Remembered storage={storage} />);
    fireEvent.click(tab("fog"));
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("expanded");
    expect(storage.data.get(TAB_STORAGE_KEY)).toBe("fog");
  });

  it("starts expanded when nothing valid is stored", () => {
    expect(readStoredSidebarCollapsed(fakeStorage({ [SIDEBAR_STORAGE_KEY]: "sideways" }))).toBe(false);
    expect(readStoredSidebarCollapsed(fakeStorage())).toBe(false);
    expect(readStoredSidebarCollapsed(null)).toBe(false);
    expect(readStoredSidebarCollapsed(fakeStorage({ [SIDEBAR_STORAGE_KEY]: "collapsed" }))).toBe(true);
    render(<Remembered storage={null} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel().dataset.tab).toBe(DEFAULT_DM_TAB);
  });
});
