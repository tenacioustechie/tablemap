import { startAutosave, type SaveFn } from "./autosave";
import { newCampaign } from "./campaign";
import type { SharedState } from "./shared";
import { createTableStore } from "./store";

const setName = (name: string) => ({ kind: "campaign/set-name", name }) as const;

function harness(debounceMs = 100) {
  const store = createTableStore();
  const saves: { id: string; state: SharedState }[] = [];
  const save = vi.fn<SaveFn>(async (id, state) => {
    saves.push({ id, state });
  });
  const onError = vi.fn();
  const handle = startAutosave(store, save, { debounceMs, onError });
  return { store, saves, save, onError, handle };
}

/** Let queued save promises settle without advancing fake timers. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing while no campaign is open", async () => {
    const { store, save } = harness();
    store.getState().dispatch(setName("scratch"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("opening a campaign is not a change to save", async () => {
    const { store, save } = harness();
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("debounces a burst of edits into one save of the final state", async () => {
    const { store, saves, save, handle } = harness(100);
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));

    store.getState().dispatch(setName("a"));
    await vi.advanceTimersByTimeAsync(60);
    store.getState().dispatch(setName("ab"));
    await vi.advanceTimersByTimeAsync(60);
    store.getState().dispatch(setName("abc"));
    expect(save).not.toHaveBeenCalled(); // timer keeps resetting
    expect(handle.isPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(99);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saves[0].id).toBe("c1");
    expect(saves[0].state.campaignName).toBe("abc");
    expect(handle.isPending()).toBe(false);
  });

  it("separate bursts produce separate saves", async () => {
    const { store, saves } = harness(100);
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));
    store.getState().dispatch(setName("one"));
    await vi.advanceTimersByTimeAsync(100);
    store.getState().dispatch(setName("two"));
    await vi.advanceTimersByTimeAsync(100);
    expect(saves.map((s) => s.state.campaignName)).toEqual(["one", "two"]);
  });

  it("flush writes a pending change immediately", async () => {
    const { store, save, handle } = harness(10_000);
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));
    store.getState().dispatch(setName("now"));
    await handle.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await handle.flush(); // nothing pending: no extra write
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("stop flushes and then ignores further changes", async () => {
    const { store, save, handle } = harness(10_000);
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));
    store.getState().dispatch(setName("last"));
    await handle.stop();
    expect(save).toHaveBeenCalledTimes(1);
    store.getState().dispatch(setName("after"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("switching campaigns flushes what was pending for the previous one", async () => {
    const { store, saves } = harness(10_000);
    store.getState().openCampaign(newCampaign("A", { id: "a" }));
    store.getState().dispatch(setName("A edited"));
    store.getState().openCampaign(newCampaign("B", { id: "b" }));
    await settle();
    expect(saves).toEqual([
      { id: "a", state: expect.objectContaining({ campaignName: "A edited" }) },
    ]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toHaveLength(1); // B was only opened, never edited
  });

  it("closing the campaign flushes it and stops saving", async () => {
    const { store, saves } = harness(10_000);
    store.getState().openCampaign(newCampaign("A", { id: "a" }));
    store.getState().dispatch(setName("pending"));
    store.getState().closeCampaign();
    await settle();
    expect(saves.map((s) => s.id)).toEqual(["a"]);
    store.getState().dispatch(setName("nobody home"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toHaveLength(1);
  });

  it("serialises saves so a slow write cannot be overtaken by a later one", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const store = createTableStore();
    const save = vi.fn<SaveFn>((_id, state) => {
      order.push(`start ${state.campaignName}`);
      if (state.campaignName === "slow") {
        return new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push("end slow");
            resolve();
          };
        });
      }
      order.push(`end ${state.campaignName}`);
      return Promise.resolve();
    });
    startAutosave(store, save, { debounceMs: 10 });
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));
    store.getState().dispatch(setName("slow"));
    await vi.advanceTimersByTimeAsync(10);
    store.getState().dispatch(setName("fast"));
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(["start slow"]);
    releaseFirst();
    await settle();
    expect(order).toEqual(["start slow", "end slow", "start fast", "end fast"]);
  });

  it("reports save failures and keeps going", async () => {
    const { store, save, onError } = harness(10);
    save.mockRejectedValueOnce(new Error("disk full"));
    store.getState().openCampaign(newCampaign("S", { id: "c1" }));
    store.getState().dispatch(setName("first"));
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full" }));
    store.getState().dispatch(setName("second"));
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
