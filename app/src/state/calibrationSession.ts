/**
 * Keeps the DM store's presentation in step with stored calibration (T006,
 * ADR 0011) and the per-display player view rotation (T019, ADR 0023).
 * Pure logic over a store + database, no React:
 *
 * - `start()` loads the cell-unit preference and, whenever the store learns
 *   which display the player window is on, loads that display's calibration
 *   and remembered rotation from the settings table into the store (which
 *   the sync layer then pushes to the player). A display without a stored
 *   rotation is put at 0. Stale loads (the display changed meanwhile, or the
 *   DM saved something newer) are dropped.
 * - While a display is known, every change to `presentation.rotation` is
 *   written under that display's key, so the next time the player window
 *   reports the same display the TV comes back turned the same way.
 * - `save` / `clear` write the connected display's calibration and apply it.
 *   Clearing the calibration leaves the rotation alone.
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
  getDisplayRotation,
  setCellUnit as persistCellUnit,
  setDisplayCalibration,
  setDisplayRotation,
} from "./persistence";
import type { Rotation } from "./rotation";
import type { TableStore } from "./store";

export interface CalibrationSession {
  /** Subscribe and load. Returns the stop function. */
  start(): () => void;
  /** Persist for the connected display and apply. False when no player display is known. */
  save(calibration: DisplayCalibration): Promise<boolean>;
  /** Forget the connected display's calibration (not its rotation). False when no display is known. */
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
  let rotationGeneration = 0;
  let unitGeneration = 0;

  return {
    start() {
      let stopped = false;
      let loadedKey: string | null = null;
      // The rotation the session last saw in the store: a store value that
      // differs from it is a change by the DM (to be remembered for the
      // display), whereas a load applies through `applyRotation`, which
      // updates it first so the subscription does not write the value back.
      let seenRotation: Rotation = store.getState().presentation.rotation;

      const applyRotation = (rotation: Rotation) => {
        seenRotation = rotation;
        store.getState().setPresentation({ rotation });
      };

      const loadFor = (key: string) => {
        const mine = ++calibrationGeneration;
        void getDisplayCalibration(db, key).then((calibration) => {
          if (stopped || mine !== calibrationGeneration || currentKey() !== key) return;
          store.getState().setPresentation({ calibration });
        });
        const mineRotation = ++rotationGeneration;
        void getDisplayRotation(db, key).then((rotation) => {
          if (stopped || mineRotation !== rotationGeneration || currentKey() !== key) return;
          applyRotation(rotation);
        });
      };

      const sync = () => {
        const key = currentKey();
        if (key !== loadedKey) {
          loadedKey = key;
          if (key !== null) loadFor(key);
        }
        const { rotation } = store.getState().presentation;
        if (rotation !== seenRotation) {
          seenRotation = rotation;
          if (key !== null) {
            // The DM's choice wins over a load still in flight for this display.
            rotationGeneration++;
            void setDisplayRotation(db, key, rotation);
          }
        }
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
