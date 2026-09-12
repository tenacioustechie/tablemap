// @vitest-environment node
import { nanoid } from "nanoid";
import { displayKey, type DisplayInfo } from "./calibration";
import { createCalibrationSession } from "./calibrationSession";
import { TableMapDb } from "./db";
import {
  getCellUnit,
  getDisplayCalibration,
  setCellUnit,
  setDisplayCalibration,
} from "./persistence";
import { createTableStore } from "./store";

const tv: DisplayInfo = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };
const laptop: DisplayInfo = { width: 1440, height: 900, pixelRatio: 2, left: 0, top: 25 };
const tvCal = { pxPerInch: 40, method: "square" as const, updatedAt: 1 };
const laptopCal = { pxPerInch: 110, method: "diagonal" as const, updatedAt: 2 };

let db: TableMapDb;

beforeEach(() => {
  db = new TableMapDb(`tablemap-test-${nanoid()}`);
});

afterEach(async () => {
  await db.delete();
});

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("calibration session", () => {
  it("loads the cell unit preference on start", async () => {
    await setCellUnit(db, "mm25");
    const store = createTableStore();
    const stop = createCalibrationSession(store, db).start();
    await flush();
    expect(store.getState().presentation.cellUnit).toBe("mm25");
    stop();
  });

  it("loads a display's stored calibration when the player reports that display", async () => {
    await setDisplayCalibration(db, displayKey(tv), tvCal);
    const store = createTableStore();
    const stop = createCalibrationSession(store, db).start();
    expect(store.getState().presentation.calibration).toBeNull();

    store.getState().setPlayerDisplay(tv);
    await flush();
    expect(store.getState().presentation.calibration).toEqual(tvCal);
    stop();
  });

  it("applies a calibration that was stored before the session started (reload)", async () => {
    await setDisplayCalibration(db, displayKey(tv), tvCal);
    const store = createTableStore();
    store.getState().setPlayerDisplay(tv);
    const stop = createCalibrationSession(store, db).start();
    await flush();
    expect(store.getState().presentation.calibration).toEqual(tvCal);
    stop();
  });

  it("switches calibration when the player moves to another display, and drops it for an unknown one", async () => {
    await setDisplayCalibration(db, displayKey(tv), tvCal);
    await setDisplayCalibration(db, displayKey(laptop), laptopCal);
    const store = createTableStore();
    const stop = createCalibrationSession(store, db).start();

    store.getState().setPlayerDisplay(laptop);
    await flush();
    expect(store.getState().presentation.calibration).toEqual(laptopCal);

    store.getState().setPlayerDisplay(tv);
    expect(store.getState().presentation.calibration).toBeNull(); // immediately, never the wrong one
    await flush();
    expect(store.getState().presentation.calibration).toEqual(tvCal);

    store.getState().setPlayerDisplay({ ...tv, left: 0 });
    await flush();
    expect(store.getState().presentation.calibration).toBeNull();
    stop();
  });

  it("ignores a load that completes after the display changed again", async () => {
    await setDisplayCalibration(db, displayKey(tv), tvCal);
    const store = createTableStore();
    const stop = createCalibrationSession(store, db).start();
    store.getState().setPlayerDisplay(tv);
    store.getState().setPlayerDisplay(laptop); // before the tv load resolves
    await flush();
    expect(store.getState().presentation.calibration).toBeNull();
    stop();
  });

  it("save persists for the connected display and applies it, ending the ruler screen", async () => {
    const store = createTableStore();
    const session = createCalibrationSession(store, db);
    const stop = session.start();
    expect(await session.save(tvCal)).toBe(false); // no display yet
    expect(await getDisplayCalibration(db, displayKey(tv))).toBeNull();

    store.getState().setPlayerDisplay(tv);
    store.getState().setPresentation({ target: 96 });
    expect(await session.save(tvCal)).toBe(true);
    expect(store.getState().presentation.calibration).toEqual(tvCal);
    expect(store.getState().presentation.target).toBeNull();
    expect(await getDisplayCalibration(db, displayKey(tv))).toEqual(tvCal);
    stop();

    // A fresh session (reload) finds it again for the same display.
    const store2 = createTableStore();
    const stop2 = createCalibrationSession(store2, db).start();
    store2.getState().setPlayerDisplay({ ...tv });
    await flush();
    expect(store2.getState().presentation.calibration).toEqual(tvCal);
    stop2();
  });

  it("clear removes the stored calibration and turns overview off", async () => {
    await setDisplayCalibration(db, displayKey(tv), tvCal);
    const store = createTableStore();
    const session = createCalibrationSession(store, db);
    const stop = session.start();
    store.getState().setPlayerDisplay(tv);
    await flush();
    store.getState().setPresentation({ overview: true });

    expect(await session.clear()).toBe(true);
    expect(store.getState().presentation).toMatchObject({ calibration: null, overview: false });
    expect(await getDisplayCalibration(db, displayKey(tv))).toBeNull();
    stop();
  });

  it("setCellUnit applies immediately and persists", async () => {
    const store = createTableStore();
    const session = createCalibrationSession(store, db);
    const stop = session.start();
    await session.setCellUnit("mm25");
    expect(store.getState().presentation.cellUnit).toBe("mm25");
    expect(await getCellUnit(db)).toBe("mm25");
    stop();
  });

  it("stop() detaches: later display reports load nothing", async () => {
    await setDisplayCalibration(db, displayKey(tv), tvCal);
    const store = createTableStore();
    const stop = createCalibrationSession(store, db).start();
    stop();
    store.getState().setPlayerDisplay(tv);
    await flush();
    expect(store.getState().presentation.calibration).toBeNull();
  });
});
