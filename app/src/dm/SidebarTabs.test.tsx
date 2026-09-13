/**
 * The sidebar tab strip on its own (T016): ARIA roles and wiring, arrow-key
 * movement, and the remembered tab through a fake storage. What each tab
 * holds is covered through `DmView` (`DmView.test.tsx` and the panel tests).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  DEFAULT_DM_TAB,
  DM_TABS,
  SidebarTabs,
  TAB_STORAGE_KEY,
  readStoredTab,
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
function Harness({ initial = "maps" as DmTabId }: { initial?: DmTabId }) {
  const [tab, setTab] = useState<DmTabId>(initial);
  return (
    <SidebarTabs active={tab} onSelect={setTab}>
      <p data-testid="panel-content">{tab} panel</p>
    </SidebarTabs>
  );
}

/** The hook under test, driven by clicks on the real strip. */
function Remembered({ storage }: { storage: TabStorage | null }) {
  const [tab, setTab] = useRememberedTab(storage);
  return (
    <SidebarTabs active={tab} onSelect={setTab}>
      <p data-testid="panel-content">{tab} panel</p>
    </SidebarTabs>
  );
}

const tab = (id: DmTabId) => screen.getByTestId(`dm-tab-${id}`);
const panel = () => screen.getByTestId("dm-tabpanel");

describe("SidebarTabs", () => {
  it("renders the five tabs in order with the tabs pattern roles", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Maps", "Fog", "Tokens", "Draw", "Table"]);
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
    render(<Remembered storage={broken} />);
    fireEvent.click(tab("table"));
    expect(panel().dataset.tab).toBe("table");
  });
});
