import { newCampaign } from "./campaign";
import { createBlankMapScene } from "./maps";
import { initialSharedState, type SharedOp } from "./shared";
import { createTableStore, tableStore } from "./store";

describe("table store", () => {
  it("starts at seq 0 with initial shared state", () => {
    const store = createTableStore();
    expect(store.getState().seq).toBe(0);
    expect(store.getState().shared).toEqual({
      campaignName: "",
      maps: [],
      activeMapId: null,
      splashImageAssetId: null,
      splashTitleCard: false,
      initiative: { entries: [], turn: null, round: 1 },
    });
    expect(store.getState().campaignId).toBeNull();
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

  it("openCampaign sets the campaign id and replaces shared state in one commit", () => {
    const store = createTableStore();
    store.getState().dispatch({ kind: "campaign/set-name", name: "scratch" });
    const campaign = newCampaign("Strahd", { id: "c1", now: 1000 });
    const commits: { campaignId: string | null; name: string }[] = [];
    store.subscribe((s) =>
      commits.push({ campaignId: s.campaignId, name: s.shared.campaignName })
    );
    const ops: SharedOp[][] = [];
    store.onOps((o) => ops.push([...o]));

    store.getState().openCampaign(campaign);
    expect(store.getState().campaignId).toBe("c1");
    expect(store.getState().shared).toEqual(campaign.state);
    expect(store.getState().seq).toBe(2);
    expect(commits).toEqual([{ campaignId: "c1", name: "Strahd" }]);
    expect(ops).toEqual([[{ kind: "campaign/replace", state: campaign.state }]]);
  });

  it("closeCampaign clears the id and resets shared state", () => {
    const store = createTableStore();
    store.getState().openCampaign(newCampaign("Strahd", { id: "c1" }));
    store.getState().closeCampaign();
    expect(store.getState().campaignId).toBeNull();
    expect(store.getState().shared).toEqual(initialSharedState());
    expect(store.getState().seq).toBe(2);
  });

  it("exposes a shared app-wide store instance", () => {
    expect(tableStore.getState().dispatch).toBeTypeOf("function");
  });

  it("sendPing records the ping (DM-only, unsequenced) and notifies ping listeners, once per id (T011)", () => {
    const store = createTableStore();
    const seen: string[] = [];
    const off = store.onPing((p) => seen.push(p.id));
    const ops: unknown[] = [];
    store.onOps((o) => ops.push(o));
    expect(store.getState().pings).toEqual([]);
    const now = Date.now();
    store.getState().sendPing({ id: "p1", mapId: "m", x: 1, y: 2, at: now });
    store.getState().sendPing({ id: "p2", mapId: "m", x: 3, y: 4, at: now + 1 });
    store.getState().sendPing({ id: "p1", mapId: "m", x: 9, y: 9, at: now + 2 });
    expect(store.getState().pings.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(seen).toEqual(["p1", "p2"]);
    expect(ops).toEqual([]);
    expect(store.getState().seq).toBe(0);
    off();
    store.getState().sendPing({ id: "p3", mapId: "m", x: 0, y: 0, at: now + 3 });
    expect(seen).toEqual(["p1", "p2"]);
    expect(store.getState().pings).toHaveLength(3);
  });
});

describe("presentation (DM-only, T006)", () => {
  const tv = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };
  const laptop = { width: 1440, height: 900, pixelRatio: 2, left: 0, top: 25 };
  const calibration = { pxPerInch: 40, method: "square" as const, updatedAt: 1 };

  it("starts uncalibrated with no display, and is not part of shared state or seq", () => {
    const store = createTableStore();
    expect(store.getState().presentation).toEqual({
      playerDisplay: null,
      calibration: null,
      cellUnit: "inch",
      overview: false,
      target: null,
      rotation: 0,
      center: null,
      blackout: false,
      splash: false,
      initiativeStrip: false,
      splashOnSwitch: false,
    });
    const ops = vi.fn();
    store.onOps(ops);
    store.getState().setPresentation({ overview: true, target: 96 });
    expect(store.getState().presentation).toMatchObject({ overview: true, target: 96 });
    expect(store.getState().seq).toBe(0);
    expect(ops).not.toHaveBeenCalled();
    expect(store.getState().shared).toEqual(initialSharedState());
  });

  it("setPresentation is a no-op (same object) when nothing changes", () => {
    const store = createTableStore();
    const before = store.getState().presentation;
    store.getState().setPresentation({ overview: false });
    store.getState().setPresentation({});
    expect(store.getState().presentation).toBe(before);
  });

  it("setPlayerDisplay keeps the calibration for the same display and drops it for another", () => {
    const store = createTableStore();
    store.getState().setPlayerDisplay(tv);
    store.getState().setPresentation({ calibration });
    store.getState().setPlayerDisplay({ ...tv });
    expect(store.getState().presentation.calibration).toEqual(calibration);

    store.getState().setPlayerDisplay(laptop);
    expect(store.getState().presentation).toMatchObject({ playerDisplay: laptop, calibration: null });

    store.getState().setPresentation({ calibration });
    store.getState().setPlayerDisplay(null);
    expect(store.getState().presentation).toMatchObject({ playerDisplay: null, calibration: null });
  });

  it("a scene switch drops the pan centre in the same commit, other ops keep it (T009)", () => {
    const a = createBlankMapScene({ id: "a", columns: 2, rows: 2 });
    const b = createBlankMapScene({ id: "b", columns: 2, rows: 2 });
    const store = createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId: "a" });
    store.getState().setPresentation({ center: { x: 5, y: 6 }, rotation: 90, blackout: true });
    store.getState().dispatch({ kind: "campaign/set-name", name: "still a" });
    store.getState().dispatch({ kind: "map/set-active", id: "a" }); // no-op switch
    expect(store.getState().presentation.center).toEqual({ x: 5, y: 6 });

    const seen: ({ x: number; y: number } | null)[] = [];
    store.onOps(() => seen.push(store.getState().presentation.center));
    store.getState().dispatch({ kind: "map/set-active", id: "b" });
    expect(seen).toEqual([null]); // reset before op listeners run: one consistent delta
    expect(store.getState().presentation).toMatchObject({ center: null, rotation: 90, blackout: true });
    expect(store.getState().presentation.splash).toBe(false);

    // Removing the active map and replacing the campaign count as switches too.
    store.getState().setPresentation({ center: { x: 1, y: 1 } });
    store.getState().dispatch({ kind: "map/remove", id: "b" });
    expect(store.getState().shared.activeMapId).toBeNull();
    expect(store.getState().presentation.center).toBeNull();
    store.getState().dispatch({ kind: "map/set-active", id: "a" });
    store.getState().setPresentation({ center: { x: 1, y: 1 } });
    store.getState().openCampaign(newCampaign("Other", { id: "c2" }));
    expect(store.getState().presentation.center).toBeNull();
  });

  it("turning the active map drops the pan centre in the same commit; other maps and the splash are left alone (T017)", () => {
    const a = createBlankMapScene({ id: "a", columns: 2, rows: 3 });
    const b = createBlankMapScene({ id: "b", columns: 2, rows: 2 });
    const store = createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId: "a" });
    store.getState().setPresentation({ center: { x: 5, y: 6 }, rotation: 90, splashOnSwitch: true });

    // Another map turning is nothing to the player view.
    store.getState().dispatch({ kind: "map/rotate", id: "b", degrees: 90, fogMaskAssetId: null });
    expect(store.getState().presentation.center).toEqual({ x: 5, y: 6 });

    const seen: ({ x: number; y: number } | null)[] = [];
    store.onOps(() => seen.push(store.getState().presentation.center));
    store.getState().dispatch({ kind: "map/rotate", id: "a", degrees: 90, fogMaskAssetId: null });
    expect(seen).toEqual([null]); // reset before op listeners run: one consistent delta
    expect(store.getState().shared.maps[0]).toMatchObject({ width: a.height, height: a.width, imageRotation: 90 });
    // The TV rotation is untouched, and a turn is not a switch: no splash.
    expect(store.getState().presentation).toMatchObject({ center: null, rotation: 90, splash: false });

    // With no centre set the presentation object is unchanged (no spurious message).
    const before = store.getState().presentation;
    store.getState().dispatch({ kind: "map/rotate", id: "a", degrees: 180, fogMaskAssetId: null });
    expect(store.getState().presentation).toBe(before);
  });

  it("with splashOnSwitch, switching to a map raises the splash; it stays until turned off", () => {
    const a = createBlankMapScene({ id: "a", columns: 2, rows: 2 });
    const b = createBlankMapScene({ id: "b", columns: 2, rows: 2 });
    const store = createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId: "a" });
    store.getState().dispatch({ kind: "map/set-active", id: "b" });
    expect(store.getState().presentation.splash).toBe(false);

    store.getState().setPresentation({ splashOnSwitch: true });
    store.getState().dispatch({ kind: "map/set-active", id: "a" });
    expect(store.getState().presentation.splash).toBe(true);
    store.getState().dispatch({ kind: "map/set-active", id: "b" });
    expect(store.getState().presentation.splash).toBe(true);
    store.getState().setPresentation({ splash: false });
    // Switching to "no map" shows the idle title, not the splash.
    store.getState().dispatch({ kind: "map/set-active", id: null });
    expect(store.getState().presentation.splash).toBe(false);
    // Turning the splash off never happens on a switch; a manual splash survives one.
    store.getState().setPresentation({ splash: true, splashOnSwitch: false });
    store.getState().dispatch({ kind: "map/set-active", id: "a" });
    expect(store.getState().presentation.splash).toBe(true);
  });

  it("opening or closing a campaign leaves the presentation alone (it belongs to the display)", () => {
    const store = createTableStore();
    store.getState().setPlayerDisplay(tv);
    store.getState().setPresentation({ calibration, cellUnit: "mm25" });
    store.getState().openCampaign(newCampaign("Strahd", { id: "c1" }));
    store.getState().closeCampaign();
    expect(store.getState().presentation).toMatchObject({
      playerDisplay: tv,
      calibration,
      cellUnit: "mm25",
    });
  });
});
