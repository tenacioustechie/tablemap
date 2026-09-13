/**
 * Map management UI, driven through `DmView` so the drop zone, the file
 * picker, the list and the canvas are all exercised together. Map actions
 * are faked here (the pipeline itself is tested in `state/mapActions.test`);
 * one test wires the real actions to check the store -> list -> canvas path.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { TableMapDb } from "../state/db";
import { createMapActions, type MapActions } from "../state/mapActions";
import { createBlankMapScene, createImageMapScene } from "../state/maps";
import { initialSharedState, type SharedState } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { openBlankMapForm } from "../test/dmPanels";
import { DmView } from "./DmView";
import type { PlayerWindowController } from "./playerWindow";

const noWindow: PlayerWindowController = {
  open: () => null,
  close: () => {},
  isOpen: () => false,
  isFullscreen: () => false,
  toggleFullscreen: async () => "not-open",
  getHandle: () => null,
};

function fakeActions(): MapActions {
  return {
    importImage: vi.fn(async (file: File) =>
      createImageMapScene({ name: file.name, imageAssetId: "img", width: 10, height: 10 })
    ),
    createBlank: vi.fn((o) => createBlankMapScene(o)),
    duplicate: vi.fn(async () => undefined),
    rename: vi.fn(),
    remove: vi.fn(async () => {}),
    setActive: vi.fn(),
    setGrid: vi.fn(),
    rotate: vi.fn(async () => true),
  };
}

function renderDm(store: TableStore, mapActions?: MapActions) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  const utils = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} mapActions={mapActions} />
    </MemoryRouter>
  );
  return { ...utils, db };
}

const twoMaps: SharedState = {
  ...initialSharedState(),
  campaignName: "C",
  maps: [
    createImageMapScene({ id: "a", name: "Crypt", imageAssetId: "img-a", width: 100, height: 50 }),
    createBlankMapScene({ id: "b", name: "Arena", columns: 2, rows: 2 }),
  ],
  activeMapId: "a",
};

const png = (name = "cave.png") => new File(["x"], name, { type: "image/png" });

describe("MapPanel via DmView", () => {
  it("lists maps with thumbnails, marking the active one", () => {
    renderDm(createTableStore(twoMaps), fakeActions());
    const items = screen.getAllByTestId("map-item");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByTestId("map-item-name").textContent).toBe("Crypt");
    expect(items[0].dataset.active).toBe("true");
    expect(items[1].dataset.active).toBe("false");
    expect(within(items[1]).getByTestId("map-thumb").style.background).toBe(
      "rgb(59, 59, 59)"
    );
    expect(screen.queryByTestId("map-list-empty")).toBeNull();
  });

  it("shows an empty message and a placeholder canvas without maps", () => {
    renderDm(createTableStore(), fakeActions());
    expect(screen.getByTestId("map-list-empty")).toBeTruthy();
    expect(screen.queryByTestId("dm-map-stage")).toBeNull();
  });

  it("imports files picked with the file input", async () => {
    const actions = fakeActions();
    renderDm(createTableStore(twoMaps), actions);
    const input = screen.getByTestId("map-file-input") as HTMLInputElement;
    const files = [png("one.png"), png("two.webp")];
    await act(async () => {
      fireEvent.change(input, { target: { files } });
    });
    await waitFor(() => expect(actions.importImage).toHaveBeenCalledTimes(2));
    expect(actions.importImage).toHaveBeenNthCalledWith(1, files[0]);
    expect(actions.importImage).toHaveBeenNthCalledWith(2, files[1]);
    expect(screen.queryByTestId("map-import-error")).toBeNull();
  });

  it("imports files dropped anywhere on the DM view and shows a drop overlay meanwhile", async () => {
    const actions = fakeActions();
    renderDm(createTableStore(twoMaps), actions);
    const root = screen.getByTestId("dm-view");
    const file = png("dropped.png");
    const dataTransfer = { files: [file], types: ["Files"], dropEffect: "" };

    fireEvent.dragOver(root, { dataTransfer });
    expect(root.dataset.dragging).toBe("true");
    expect(screen.getByTestId("drop-overlay")).toBeTruthy();

    await act(async () => {
      fireEvent.drop(root, { dataTransfer });
    });
    expect(root.dataset.dragging).toBe("false");
    await waitFor(() => expect(actions.importImage).toHaveBeenCalledWith(file));
  });

  it("reports unsupported files and import failures without importing them", async () => {
    const actions = fakeActions();
    (actions.importImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom")
    );
    renderDm(createTableStore(twoMaps), actions);
    const input = screen.getByTestId("map-file-input");
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] },
      });
    });
    expect(screen.getByTestId("map-import-error").textContent).toMatch(/notes\.pdf/);
    expect(actions.importImage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.change(input, { target: { files: [png()] } });
    });
    await waitFor(() =>
      expect(screen.getByTestId("map-import-error").textContent).toBe("boom")
    );
  });

  it("keeps the blank-map form behind a closed disclosure; the import stays visible (T019)", () => {
    renderDm(createTableStore(twoMaps), fakeActions());
    expect(screen.getByTestId("map-file-input")).toBeTruthy();
    const disclosure = screen.getByTestId("blank-map-disclosure");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("blank-map-form")).toBeNull();
    expect(screen.queryByLabelText("Blank map name")).toBeNull();

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("blank-map-form")).toBeTruthy();
    expect(disclosure.getAttribute("aria-controls")).toBe(
      screen.getByTestId("blank-map-form").parentElement?.id
    );
    expect(screen.getByTestId("map-file-input")).toBeTruthy();

    fireEvent.click(disclosure);
    expect(screen.queryByTestId("blank-map-form")).toBeNull();
  });

  it("creates a blank map from the form with the chosen size and colour", () => {
    const actions = fakeActions();
    renderDm(createTableStore(), actions);
    openBlankMapForm();
    fireEvent.change(screen.getByLabelText("Blank map name"), { target: { value: "Tavern" } });
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Cell size"), { target: { value: "64" } });
    fireEvent.change(screen.getByLabelText("Background colour"), { target: { value: "#224466" } });
    fireEvent.submit(screen.getByTestId("blank-map-form"));
    expect(actions.createBlank).toHaveBeenCalledWith({
      name: "Tavern",
      columns: 12,
      rows: 8,
      cellSize: 64,
      color: "#224466",
    });
  });

  it("refuses an invalid blank map size", () => {
    const actions = fakeActions();
    renderDm(createTableStore(), actions);
    openBlankMapForm();
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "0" } });
    const button = screen.getByRole("button", { name: "Create blank map" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.submit(screen.getByTestId("blank-map-form"));
    expect(actions.createBlank).not.toHaveBeenCalled();
  });

  it("show / rename / duplicate / delete call the actions", async () => {
    const actions = fakeActions();
    renderDm(createTableStore(twoMaps), actions);
    const arena = screen.getAllByTestId("map-item")[1];

    fireEvent.click(within(arena).getByRole("button", { name: "Show Arena" }));
    expect(actions.setActive).toHaveBeenCalledWith("b");

    fireEvent.click(within(arena).getByRole("button", { name: "Rename Arena" }));
    fireEvent.change(within(arena).getByLabelText("Map name"), { target: { value: "Pit" } });
    fireEvent.click(within(arena).getByRole("button", { name: "Save" }));
    expect(actions.rename).toHaveBeenCalledWith("b", "Pit");

    fireEvent.click(within(arena).getByRole("button", { name: "Duplicate Arena" }));
    expect(actions.duplicate).toHaveBeenCalledWith("b");

    fireEvent.click(within(arena).getByRole("button", { name: "Delete Arena" }));
    expect(actions.remove).not.toHaveBeenCalled();
    fireEvent.click(within(arena).getByRole("button", { name: "Confirm delete Arena" }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("b"));
  });

  it("with real actions: a blank map appears in the list and on the canvas", () => {
    const store = createTableStore({ ...initialSharedState(), campaignName: "C" });
    const db = new TableMapDb(`tablemap-test-${nanoid()}`);
    const actions = createMapActions(store, db, { newId: () => "blank" });
    // Real actions need an open campaign.
    store.setState({ campaignId: "camp" });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DmView store={store} db={db} playerWindow={noWindow} mapActions={actions} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("dm-map-stage")).toBeNull();
    openBlankMapForm();
    fireEvent.submit(screen.getByTestId("blank-map-form"));
    expect(store.getState().shared.activeMapId).toBe("blank");
    expect(screen.getAllByTestId("map-item")).toHaveLength(1);
    const stage = screen.getByTestId("dm-map-stage");
    expect(stage.dataset.mapId).toBe("blank");
    expect(stage.dataset.imageStatus).toBe("none");
    expect(screen.getByTestId("canvas-zoom")).toBeTruthy();
  });
});
