import { act, render, screen } from "@testing-library/react";
import { startDmSync } from "../state/dmSync";
import { createTableStore } from "../state/store";
import { decodeMessage } from "../state/sync";
import { createMemoryHub } from "../state/transport";
import { PlayerView } from "./PlayerView";

const view = () => screen.getByTestId("player-view");

describe("PlayerView + sync", () => {
  it("starts connecting, then mirrors the DM snapshot and deltas", () => {
    const hub = createMemoryHub();
    const dm = createTableStore({ campaignName: "Strahd" });
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
    startDmSync(createTableStore({ campaignName: "Title" }), hub.connect());
    render(<PlayerView createTransport={() => hub.connect()} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
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
