import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createMirrorStore } from "../state/mirror";
import { startPlayerSync } from "../state/playerSync";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { decodeMessage } from "../state/sync";
import { createMemoryHub } from "../state/transport";
import { DmView } from "./DmView";

function renderDm(store = createTableStore(), hub = createMemoryHub()) {
  const utils = render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <DmView store={store} createTransport={() => hub.connect()} />
    </MemoryRouter>
  );
  return { ...utils, store, hub };
}

const input = () =>
  screen.getByTestId("campaign-name-input") as HTMLInputElement;

describe("DmView + sync", () => {
  it("renders the campaign name from the store and dispatches edits", () => {
    const { store } = renderDm(createTableStore({ ...initialSharedState(), campaignName: "Old" }));
    expect(input().value).toBe("Old");
    fireEvent.change(input(), { target: { value: "New" } });
    expect(store.getState().shared.campaignName).toBe("New");
    expect(store.getState().seq).toBe(1);
    expect(input().value).toBe("New");
  });

  it("publishes over the injected transport and answers player hellos", () => {
    const { store, hub } = renderDm();
    const types = () =>
      hub.log.map((e) => {
        const r = decodeMessage(e.raw);
        return r.ok ? r.message.type : "invalid";
      });
    expect(types()).toEqual(["hello", "snapshot"]);

    const mirror = createMirrorStore();
    act(() => {
      startPlayerSync(mirror, hub.connect());
    });
    expect(mirror.getState().status).toBe("synced");

    fireEvent.change(input(), { target: { value: "Live" } });
    expect(mirror.getState().shared?.campaignName).toBe("Live");
    expect(store.getState().shared.campaignName).toBe("Live");
    expect(types()).not.toContain("invalid");
  });

  it("stops publishing when unmounted", () => {
    const { store, hub, unmount } = renderDm();
    const before = hub.log.length;
    unmount();
    act(() => {
      store.getState().dispatch({ kind: "campaign/set-name", name: "x" });
    });
    expect(hub.log.length).toBe(before);
  });

  it("works without an injected transport (BroadcastChannel or null transport)", () => {
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DmView store={createTableStore()} />
      </MemoryRouter>
    );
    expect(input()).toBeTruthy();
  });
});
