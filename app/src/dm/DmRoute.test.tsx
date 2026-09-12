import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import {
  createCampaign,
  loadCampaign,
  setLastCampaignId,
} from "../state/persistence";
import { createTableStore, type TableStore } from "../state/store";
import { DmRoute } from "./DmRoute";
import type { PlayerWindowController } from "./playerWindow";

let db: TableMapDb;

beforeEach(() => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
});

afterEach(async () => {
  await db.delete();
});

const noWindow: PlayerWindowController = {
  open: () => null,
  close: () => {},
  isOpen: () => false,
  isFullscreen: () => false,
  toggleFullscreen: async () => "not-open",
  getHandle: () => null,
};

function renderRoute(store: TableStore = createTableStore()) {
  const utils = render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <DmRoute
        store={store}
        db={db}
        autosaveDebounceMs={10}
        playerWindow={noWindow}
      />
    </MemoryRouter>
  );
  return { ...utils, store };
}

const nameInput = () =>
  screen.getByTestId("campaign-name-input") as HTMLInputElement;

describe("DmRoute", () => {
  it("shows a loading state, opens the last campaign, then renders the DM view", async () => {
    const c = await createCampaign(db, "Resume me", { id: "r" });
    await setLastCampaignId(db, "r");
    const { store } = renderRoute();
    expect(screen.getByTestId("dm-loading")).toBeTruthy();
    expect(await screen.findByTestId("dm-view")).toBeTruthy();
    expect(store.getState().campaignId).toBe("r");
    expect(store.getState().shared).toEqual(c.state);
    expect(nameInput().value).toBe("Resume me");
  });

  it("renders immediately when the store already has a campaign open", async () => {
    const store = createTableStore();
    store.getState().openCampaign(await createCampaign(db, "Open", { id: "o" }));
    renderRoute(store);
    expect(screen.getByTestId("dm-view")).toBeTruthy();
    expect(screen.queryByTestId("dm-loading")).toBeNull();
  });

  it("autosaves edits and a reload restores the last campaign exactly", async () => {
    const first = renderRoute();
    await screen.findByTestId("dm-view");
    const id = first.store.getState().campaignId!;

    fireEvent.change(nameInput(), { target: { value: "Curse of" } });
    fireEvent.change(nameInput(), { target: { value: "Curse of Strahd" } });
    await waitFor(async () => {
      expect((await loadCampaign(db, id))?.state.campaignName).toBe(
        "Curse of Strahd"
      );
    });
    const savedState = first.store.getState().shared;
    first.unmount();

    // "Reload": a brand-new store (as after a page load), same database.
    const second = renderRoute(createTableStore());
    await screen.findByTestId("dm-view");
    expect(second.store.getState().campaignId).toBe(id);
    expect(second.store.getState().shared).toEqual(savedState);
    expect(nameInput().value).toBe("Curse of Strahd");
  });

  it("flushes a pending edit when the route unmounts", async () => {
    const { store, unmount } = renderRoute();
    await screen.findByTestId("dm-view");
    const id = store.getState().campaignId!;
    fireEvent.change(nameInput(), { target: { value: "Unsaved?" } });
    unmount();
    await waitFor(async () => {
      expect((await loadCampaign(db, id))?.state.campaignName).toBe("Unsaved?");
    });
  });

  it("shows an error instead of the DM view when storage fails", async () => {
    const broken = new TableMapDb(`tablemap-test-${nanoid()}`);
    await broken.delete();
    vi.spyOn(broken.settings, "get").mockRejectedValue(new Error("quota exceeded"));
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DmRoute store={createTableStore()} db={broken} playerWindow={noWindow} />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("dm-load-error")).toBeTruthy();
    expect(screen.getByTestId("dm-load-error").textContent).toContain(
      "quota exceeded"
    );
    expect(screen.queryByTestId("dm-view")).toBeNull();
  });
});
