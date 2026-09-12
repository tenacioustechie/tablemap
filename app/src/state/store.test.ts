import { createTableStore, tableStore } from "./store";

describe("table store", () => {
  it("starts at seq 0 with initial shared state", () => {
    const store = createTableStore();
    expect(store.getState().seq).toBe(0);
    expect(store.getState().shared).toEqual({ campaignName: "" });
  });

  it("dispatch applies ops and bumps seq once per dispatch", () => {
    const store = createTableStore();
    store.getState().dispatch({ kind: "campaign/set-name", name: "A" });
    expect(store.getState()).toMatchObject({ seq: 1, shared: { campaignName: "A" } });
    store.getState().dispatch(
      { kind: "campaign/set-name", name: "B" },
      { kind: "campaign/set-name", name: "C" }
    );
    expect(store.getState()).toMatchObject({ seq: 2, shared: { campaignName: "C" } });
  });

  it("an empty dispatch is ignored", () => {
    const store = createTableStore();
    const listener = vi.fn();
    store.onOps(listener);
    store.getState().dispatch();
    expect(store.getState().seq).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies op listeners with the ops and the new seq, after state updates", () => {
    const store = createTableStore();
    const seen: { seq: number; nameInStore: string }[] = [];
    const off = store.onOps((ops, seq) => {
      expect(ops).toEqual([{ kind: "campaign/set-name", name: "A" }]);
      seen.push({ seq, nameInStore: store.getState().shared.campaignName });
    });
    store.getState().dispatch({ kind: "campaign/set-name", name: "A" });
    expect(seen).toEqual([{ seq: 1, nameInStore: "A" }]);
    off();
    store.getState().dispatch({ kind: "campaign/set-name", name: "B" });
    expect(seen).toHaveLength(1);
  });

  it("exposes a shared app-wide store instance", () => {
    expect(tableStore.getState().dispatch).toBeTypeOf("function");
  });
});
