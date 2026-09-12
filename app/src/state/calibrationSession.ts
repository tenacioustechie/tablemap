/**
 * Keeps the DM store's presentation in step with stored calibration (T006,
 * ADR 0011). Pure logic over a store + database, no React:
 *
 * - `start()` loads the cell-unit preference and, whenever the store learns
 *   which display the player window is on, loads that display's calibration
 *   from the settings table into the store (which the sync layer then pushes
 *   to the player). Stale loads (the display changed meanwhile, or the DM
 *   saved something newer) are dropped.
 * - `save` / `clear` write the connected display's calibration and apply it.
 * - `setCellUnit` writes the preference and applies it.
 *
 * Nothing under `src/player/` may import this: it touches storage.
 */
import {
  displayKey,
  type CellUnit,
  type DisplayCalibration,
} from "./calibration";
import type { TableMapDb } from "./db";
import {
  getCellUnit,
  getDisplayCalibration,
  setCellUnit as persistCellUnit,
  setDisplayCalibration,
} from "./persistence";
import type { TableStore } from "./store";

export interface CalibrationSession {
  /** Subscribe and load. Returns the stop function. */
  start(): () => void;
  /** Persist for the connected display and apply. False when no player display is known. */
  save(calibration: DisplayCalibration): Promise<boolean>;
  /** Forget the connected display's calibration. False when no display is known. */
  clear(): Promise<boolean>;
  setCellUnit(unit: CellUnit): Promise<void>;
}

export function createCalibrationSession(
  store: TableStore,
  db: TableMapDb
): CalibrationSession {
  const currentKey = (): string | null => {
    const display = store.getState().presentation.playerDisplay;
    return display ? displayKey(display) : null;
  };

  // Loads apply only if nothing newer happened meanwhile: another display
  // report, or a write by the DM. Writes bump the counters to invalidate
  // whatever is in flight.
  let calibrationGeneration = 0;
  let unitGeneration = 0;

  return {
    start() {
      let stopped = false;
      let loadedKey: string | null = null;

      const loadFor = (key: string) => {
        const mine = ++calibrationGeneration;
        void getDisplayCalibration(db, key).then((calibration) => {
          if (stopped || mine !== calibrationGeneration || currentKey() !== key) return;
          store.getState().setPresentation({ calibration });
        });
      };

      const sync = () => {
        const key = currentKey();
        if (key === loadedKey) return;
        loadedKey = key;
        if (key !== null) loadFor(key);
      };

      const unitAtStart = unitGeneration;
      void getCellUnit(db).then((cellUnit) => {
        if (stopped || unitGeneration !== unitAtStart) return;
        store.getState().setPresentation({ cellUnit });
      });
      const unsubscribe = store.subscribe(sync);
      sync();

      return () => {
        stopped = true;
        unsubscribe();
      };
    },

    async save(calibration) {
      const key = currentKey();
      if (key === null) return false;
      await setDisplayCalibration(db, key, calibration);
      calibrationGeneration++;
      if (currentKey() === key) {
        store.getState().setPresentation({ calibration, target: null });
      }
      return true;
    },

    async clear() {
      const key = currentKey();
      if (key === null) return false;
      await setDisplayCalibration(db, key, null);
      calibrationGeneration++;
      if (currentKey() === key) {
        store.getState().setPresentation({ calibration: null, overview: false });
      }
      return true;
    },

    async setCellUnit(unit) {
      unitGeneration++;
      store.getState().setPresentation({ cellUnit: unit });
      await persistCellUnit(db, unit);
    },
  };
}
