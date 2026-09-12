import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CampaignManager } from "./CampaignManager";
import { ROUTE_CAMPAIGNS, ROUTE_DM } from "./routePaths";
import { TableMapDb } from "./state/db";
import {
  createCampaign,
  getLastCampaignId,
  listCampaigns,
  loadCampaign,
} from "./state/persistence";
import { createTableStore, type TableStore } from "./state/store";

let db: TableMapDb;

beforeEach(() => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
});

afterEach(async () => {
  await db.delete();
});

function renderManager(store: TableStore = createTableStore()) {
  const utils = render(
    <MemoryRouter
      initialEntries={[ROUTE_CAMPAIGNS]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path={ROUTE_CAMPAIGNS}
          element={<CampaignManager store={store} db={db} />}
        />
        <Route path={ROUTE_DM} element={<div data-testid="dm-stub" />} />
      </Routes>
    </MemoryRouter>
  );
  return { ...utils, store };
}

const items = () => screen.getAllByTestId("campaign-item");
const itemNamed = (name: string) =>
  items().find(
    (li) => within(li).getByTestId("campaign-item-name").textContent === name
  )!;
const button = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("button", { name });

describe("CampaignManager", () => {
  it("lists stored campaigns, most recently updated first", async () => {
    await createCampaign(db, "Older", { now: 1 });
    await createCampaign(db, "Newer", { now: 2 });
    renderManager();
    await screen.findByTestId("campaign-list");
    expect(
      items().map((li) => within(li).getByTestId("campaign-item-name").textContent)
    ).toEqual(["Newer", "Older"]);
  });

  it("shows an empty state when there are no campaigns", async () => {
    renderManager();
    expect(await screen.findByTestId("campaign-list-empty")).toBeTruthy();
  });

  it("creates a campaign, opens it in the store and goes to the DM view", async () => {
    const { store } = renderManager();
    await screen.findByTestId("campaign-list-empty");
    fireEvent.change(screen.getByLabelText("New campaign name"), {
      target: { value: "  Tomb of Annihilation  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));

    expect(await screen.findByTestId("dm-stub")).toBeTruthy();
    const list = await listCampaigns(db);
    expect(list.map((c) => c.name)).toEqual(["Tomb of Annihilation"]);
    expect(store.getState().campaignId).toBe(list[0].id);
    expect(store.getState().shared.campaignName).toBe("Tomb of Annihilation");
    expect(await getLastCampaignId(db)).toBe(list[0].id);
  });

  it("uses a default name when the new-campaign field is blank", async () => {
    renderManager();
    await screen.findByTestId("campaign-list-empty");
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await screen.findByTestId("dm-stub");
    expect((await listCampaigns(db)).map((c) => c.name)).toEqual([
      "Untitled campaign",
    ]);
  });

  it("opens an existing campaign", async () => {
    const c = await createCampaign(db, "Strahd", { id: "s" });
    const { store } = renderManager();
    await screen.findByTestId("campaign-list");
    fireEvent.click(button(itemNamed("Strahd"), "Open"));
    expect(await screen.findByTestId("dm-stub")).toBeTruthy();
    expect(store.getState().campaignId).toBe("s");
    expect(store.getState().shared).toEqual(c.state);
    expect(await getLastCampaignId(db)).toBe("s");
  });

  it("marks the campaign that is currently open in the DM store", async () => {
    const c = await createCampaign(db, "Live", { id: "l" });
    await createCampaign(db, "Other", { id: "o" });
    const store = createTableStore();
    store.getState().openCampaign(c);
    renderManager(store);
    await screen.findByTestId("campaign-list");
    expect(within(itemNamed("Live")).getByTestId("campaign-open-badge")).toBeTruthy();
    expect(within(itemNamed("Other")).queryByTestId("campaign-open-badge")).toBeNull();
  });

  it("renames a campaign in storage and in the store when it is open", async () => {
    const c = await createCampaign(db, "Before", { id: "b" });
    const store = createTableStore();
    store.getState().openCampaign(c);
    renderManager(store);
    await screen.findByTestId("campaign-list");

    fireEvent.click(button(itemNamed("Before"), "Rename"));
    const input = screen.getByLabelText("Campaign name") as HTMLInputElement;
    expect(input.value).toBe("Before");
    fireEvent.change(input, { target: { value: "After" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(itemNamed("After")).toBeTruthy());
    expect((await loadCampaign(db, "b"))?.state.campaignName).toBe("After");
    expect(store.getState().shared.campaignName).toBe("After");
  });

  it("rename can be cancelled", async () => {
    await createCampaign(db, "Keep", { id: "k" });
    renderManager();
    await screen.findByTestId("campaign-list");
    fireEvent.click(button(itemNamed("Keep"), "Rename"));
    fireEvent.change(screen.getByLabelText("Campaign name"), {
      target: { value: "Nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(itemNamed("Keep")).toBeTruthy();
    expect((await loadCampaign(db, "k"))?.name).toBe("Keep");
  });

  it("deletes only after confirmation and closes it in the store if open", async () => {
    const c = await createCampaign(db, "Doomed", { id: "d" });
    await createCampaign(db, "Survivor", { id: "s" });
    const store = createTableStore();
    store.getState().openCampaign(c);
    renderManager(store);
    await screen.findByTestId("campaign-list");

    fireEvent.click(button(itemNamed("Doomed"), "Delete"));
    fireEvent.click(button(itemNamed("Doomed"), "Cancel"));
    expect(items()).toHaveLength(2);
    expect(await loadCampaign(db, "d")).toBeTruthy();

    fireEvent.click(button(itemNamed("Doomed"), "Delete"));
    fireEvent.click(button(itemNamed("Doomed"), "Confirm delete"));
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(itemNamed("Survivor")).toBeTruthy();
    expect(await loadCampaign(db, "d")).toBeUndefined();
    expect(store.getState().campaignId).toBeNull();
  });

  it("surfaces storage errors", async () => {
    vi.spyOn(db.campaigns, "orderBy").mockImplementation(() => {
      throw new Error("storage exploded");
    });
    renderManager();
    expect(
      (await screen.findByTestId("campaign-manager-error")).textContent
    ).toContain("storage exploded");
  });
});
