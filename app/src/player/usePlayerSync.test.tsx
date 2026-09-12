import { act, render, screen, waitFor } from "@testing-library/react";
import { startDmSync, type AssetSource } from "../state/dmSync";
import { createBlankMapScene, createImageMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { decodeMessage } from "../state/sync";
import { createMemoryHub } from "../state/transport";
import { PlayerView } from "./PlayerView";

const view = () => screen.getByTestId("player-view");

describe("PlayerView + sync", () => {
  it("starts connecting, then mirrors the DM snapshot and deltas", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ ...initialSharedState(), campaignName: "Strahd" });
    startDmSync(dm, hub.connect());

    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(view().dataset.syncStatus).toBe("synced");
    expect(view().dataset.syncSeq).toBe("0");
    expect(screen.getByTestId("player-campaign-name").textContent).toBe(
      "Strahd"
    );

    act(() => {
      dm.getState().dispatch({ kind: "campaign/set-name", name: "Tomb" });
    });
    expect(view().dataset.syncSeq).toBe("1");
    expect(screen.getByTestId("player-campaign-name").textContent).toBe("Tomb");

    act(() => {
      dm.getState().dispatch({ kind: "campaign/set-name", name: "" });
    });
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
  });

  it("shows nothing and reports connecting while no DM is present", () => {
    const hub = createMemoryHub();
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(view().dataset.syncStatus).toBe("connecting");
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
    expect(view().children).toHaveLength(0);
  });

  it("only sends hello messages", () => {
    const hub = createMemoryHub();
    render(<PlayerView createTransport={() => hub.connect()} />);
    const dm = createTableStore();
    act(() => {
      startDmSync(dm, hub.connect());
      dm.getState().dispatch({ kind: "campaign/set-name", name: "x" });
    });
    const fromPlayer = hub.log.filter((e) => e.from === 0);
    expect(fromPlayer.length).toBeGreaterThan(0);
    for (const e of fromPlayer) {
      const r = decodeMessage(e.raw);
      expect(r.ok && r.message.type).toBe("hello");
    }
  });

  it("stays chrome-free with a campaign name shown", () => {
    const hub = createMemoryHub();
    startDmSync(createTableStore({ ...initialSharedState(), campaignName: "Title" }), hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders the active map on a stage instead of the idle title", () => {
    const hub = createMemoryHub();
    const blank = createBlankMapScene({ id: "b", name: "Arena", columns: 2, rows: 2 });
    const dm = createTableStore({
      ...initialSharedState(),
      campaignName: "Strahd",
      maps: [blank],
      activeMapId: null,
    });
    startDmSync(dm, hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(screen.getByTestId("player-campaign-name")).toBeTruthy();
    expect(view().dataset.activeMapId).toBe("");

    act(() => {
      dm.getState().dispatch({ kind: "map/set-active", id: "b" });
    });
    expect(screen.queryByTestId("player-campaign-name")).toBeNull();
    expect(view().dataset.activeMapId).toBe("b");
    const stage = screen.getByTestId("player-map-stage");
    expect(stage.dataset.mapId).toBe("b");
    expect(stage.dataset.mapName).toBe("Arena");
    expect(stage.dataset.imageStatus).toBe("none");
    expect(screen.queryByRole("button")).toBeNull();

    act(() => {
      dm.getState().dispatch({ kind: "map/set-active", id: null });
    });
    expect(screen.queryByTestId("player-map-stage")).toBeNull();
    expect(screen.getByTestId("player-campaign-name")).toBeTruthy();
  });

  it("waits for the map image asset, then loads it once the DM pushes it", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
      const hub = createMemoryHub();
      const scene = createImageMapScene({
        id: "m",
        name: "Crypt",
        imageAssetId: "img",
        width: 10,
        height: 10,
      });
      const dm = createTableStore({
        ...initialSharedState(),
        maps: [scene],
        activeMapId: "m",
      });
      const blob = new Blob(["png"], { type: "image/png" });
      const assets: AssetSource = async (id) =>
        id === "img" ? { kind: "map-image", blob } : undefined;

      const { unmount } = render(<PlayerView createTransport={() => hub.connect()} />);
      await act(async () => {
        startDmSync(dm, hub.connect(), { assets });
      });
      const stage = () => screen.getByTestId("player-map-stage");
      expect(stage().dataset.mapId).toBe("m");
      await waitFor(() => expect(stage().dataset.imageStatus).toBe("loading"));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
      unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    } finally {
      Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
    }
  });

  it("disconnects on unmount", () => {
    const hub = createMemoryHub();
    const { unmount } = render(
      <PlayerView createTransport={() => hub.connect()} />
    );
    unmount();
    const before = hub.log.length;
    startDmSync(createTableStore(), hub.connect());
    // The unmounted player must not have answered or re-requested anything.
    expect(hub.log.slice(before).every((e) => e.from !== 0)).toBe(true);
  });
});
