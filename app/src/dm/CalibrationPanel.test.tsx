/**
 * The calibration panel driven through `DmView` with a real store and an
 * in-memory calibration session. The maths has its own unit tests
 * (`state/calibration.test.ts`); persistence is covered by
 * `state/calibrationSession.test.ts`. Here: the ruler flow, the TV-size
 * flow, the unit choice and the overview override, all through the store's
 * `presentation` (which is what the player receives).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import {
  pxPerInchFromDiagonal,
  type CellUnit,
  type DisplayCalibration,
  type DisplayInfo,
} from "../state/calibration";
import type { CalibrationSession } from "../state/calibrationSession";
import { TableMapDb } from "../state/db";
import { createMapActions } from "../state/mapActions";
import { createTableStore, type TableStore } from "../state/store";
import { openTvSizeForm } from "../test/dmPanels";
import { openTab } from "../test/dmTabs";
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

const tv: DisplayInfo = { width: 1920, height: 1080, pixelRatio: 2, left: 1920, top: 0 };

/** A session that keeps calibrations in memory, keyed by nothing (one display at a time). */
function fakeSession(store: TableStore) {
  const saved: DisplayCalibration[] = [];
  const units: CellUnit[] = [];
  const session: CalibrationSession & { saved: DisplayCalibration[]; units: CellUnit[] } = {
    saved,
    units,
    start: () => () => {},
    async save(calibration) {
      if (store.getState().presentation.playerDisplay === null) return false;
      saved.push(calibration);
      store.getState().setPresentation({ calibration, target: null });
      return true;
    },
    async clear() {
      store.getState().setPresentation({ calibration: null, overview: false });
      return true;
    },
    async setCellUnit(unit) {
      units.push(unit);
      store.getState().setPresentation({ cellUnit: unit });
    },
  };
  return session;
}

function renderDm(store: TableStore) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  const session = fakeSession(store);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView
        store={store}
        db={db}
        playerWindow={noWindow}
        mapActions={createMapActions(store, db)}
        calibrationSession={session}
      />
    </MemoryRouter>
  );
  openTab("table");
  return session;
}

const presentation = (store: TableStore) => store.getState().presentation;
const status = () => screen.getByTestId("calibration-status").textContent ?? "";
const rulerButton = () => screen.getByTestId("start-ruler-calibration") as HTMLButtonElement;
const overview = () => screen.getByTestId("overview-toggle") as HTMLInputElement;

describe("CalibrationPanel", () => {
  it("waits for a player display before offering calibration", () => {
    const store = createTableStore();
    renderDm(store);
    expect(status()).toMatch(/open the player view/i);
    expect(rulerButton().disabled).toBe(true);
    expect(overview().disabled).toBe(true);
    expect(screen.queryByTestId("calibration-tv-size")).toBeNull();
  });

  it("describes the connected display and its calibration state", () => {
    const store = createTableStore();
    renderDm(store);
    act(() => store.getState().setPlayerDisplay(tv));
    expect(status()).toMatch(/1920×1080 \(2× pixels\)/);
    expect(status()).toMatch(/not calibrated/i);
    expect(rulerButton().disabled).toBe(false);

    act(() =>
      store.getState().setPresentation({
        calibration: { pxPerInch: 40.25, method: "diagonal", updatedAt: 1 },
      })
    );
    expect(status()).toMatch(/calibrated, 40\.3 px per inch \(from the TV size\)/);
    expect(status()).toMatch(/One cell = 40\.3 px = 1 inch/);
  });

  it("ruler flow: shows the target on the player, grows/shrinks it, saves px per inch", async () => {
    const store = createTableStore();
    const session = renderDm(store);
    act(() => store.getState().setPlayerDisplay(tv));

    fireEvent.click(rulerButton());
    expect(presentation(store).target).toBe(96);
    fireEvent.click(screen.getByRole("button", { name: "Grow by 10" }));
    fireEvent.click(screen.getByRole("button", { name: "Grow by 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrink by 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrink by 10" }));
    fireEvent.click(screen.getByRole("button", { name: "Grow by 10" }));
    expect(presentation(store).target).toBe(106);
    fireEvent.change(screen.getByLabelText("Target square size"), { target: { value: "48.5" } });
    expect(presentation(store).target).toBe(48.5);
    fireEvent.change(screen.getByLabelText("Target square size"), { target: { value: "" } });
    expect(presentation(store).target).toBe(48.5);

    await act(async () => {
      fireEvent.click(screen.getByTestId("save-ruler-calibration"));
    });
    expect(session.saved).toEqual([
      { pxPerInch: 48.5, method: "square", updatedAt: expect.any(Number) },
    ]);
    expect(presentation(store).target).toBeNull();
    expect(presentation(store).calibration?.pxPerInch).toBe(48.5);
    expect(screen.queryByTestId("ruler-calibration")).toBeNull();
  });

  it("ruler flow in 25 mm mode converts the square to px per inch and can be cancelled", async () => {
    const store = createTableStore();
    const session = renderDm(store);
    act(() => {
      store.getState().setPlayerDisplay(tv);
      store.getState().setPresentation({ cellUnit: "mm25" });
    });
    fireEvent.click(rulerButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(presentation(store).target).toBeNull();
    expect(session.saved).toEqual([]);

    fireEvent.click(rulerButton());
    fireEvent.change(screen.getByLabelText("Target square size"), { target: { value: "50" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-ruler-calibration"));
    });
    expect(session.saved[0].pxPerInch).toBeCloseTo(50 * (25.4 / 25), 9);
  });

  it("the ruler screen starts from the calibrated cell size when recalibrating", () => {
    const store = createTableStore();
    renderDm(store);
    act(() => {
      store.getState().setPlayerDisplay(tv);
      store.getState().setPresentation({
        calibration: { pxPerInch: 42, method: "square", updatedAt: 1 },
      });
    });
    fireEvent.click(rulerButton());
    expect(presentation(store).target).toBe(42);
  });

  it("TV-size flow: prefills the native resolution, previews, applies with the pixel ratio", async () => {
    const store = createTableStore();
    const session = renderDm(store);
    act(() => store.getState().setPlayerDisplay(tv));
    openTvSizeForm();
    const width = screen.getByLabelText("TV resolution width") as HTMLInputElement;
    const height = screen.getByLabelText("TV resolution height") as HTMLInputElement;
    expect(width.value).toBe("3840");
    expect(height.value).toBe("2160");
    const apply = screen.getByRole("button", { name: "Use TV size" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("TV diagonal in inches"), { target: { value: "43" } });
    const expected = pxPerInchFromDiagonal({
      diagonalInches: 43,
      widthPx: 3840,
      heightPx: 2160,
      pixelRatio: 2,
    })!;
    expect(screen.getByTestId("tv-size-preview").textContent).toBe(`${expected.toFixed(1)} px per inch`);
    expect(apply.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(apply);
    });
    expect(session.saved).toEqual([
      { pxPerInch: expected, method: "diagonal", updatedAt: expect.any(Number) },
    ]);
    expect(presentation(store).calibration?.method).toBe("diagonal");
  });

  it("once calibrated, the TV-size fieldset sits behind a disclosure; opened, it recalibrates (T019)", async () => {
    const store = createTableStore();
    const session = renderDm(store);
    act(() => store.getState().setPlayerDisplay(tv));
    // Uncalibrated: open on its own, no disclosure.
    expect(screen.getByTestId("calibration-tv-size")).toBeTruthy();
    expect(screen.queryByTestId("tv-size-disclosure")).toBeNull();

    act(() =>
      store.getState().setPresentation({
        calibration: { pxPerInch: 40, method: "square", updatedAt: 1 },
      })
    );
    const disclosure = screen.getByTestId("tv-size-disclosure");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("calibration-tv-size")).toBeNull();
    expect(screen.queryByLabelText("TV diagonal in inches")).toBeNull();
    // The ruler path and the rest of the panel are untouched.
    expect(rulerButton().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Clear calibration" })).toBeTruthy();

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("calibration-tv-size")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("TV diagonal in inches"), { target: { value: "43" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use TV size" }));
    });
    expect(session.saved).toHaveLength(1);
    expect(presentation(store).calibration?.method).toBe("diagonal");
    // Still open until closed again.
    expect(screen.getByTestId("calibration-tv-size")).toBeTruthy();
    fireEvent.click(disclosure);
    expect(screen.queryByTestId("calibration-tv-size")).toBeNull();

    // The shared helper opens it whichever state it is in.
    openTvSizeForm();
    expect(screen.getByTestId("calibration-tv-size")).toBeTruthy();
    openTvSizeForm();
    expect(screen.getByTestId("calibration-tv-size")).toBeTruthy();
  });

  it("TV-size flow rejects impossible numbers", () => {
    const store = createTableStore();
    renderDm(store);
    act(() => store.getState().setPlayerDisplay(tv));
    openTvSizeForm();
    fireEvent.change(screen.getByLabelText("TV diagonal in inches"), { target: { value: "0" } });
    expect(screen.getByTestId("tv-size-error")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use TV size" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cell unit radios go through the session; overview toggles only once calibrated", () => {
    const store = createTableStore();
    const session = renderDm(store);
    fireEvent.click(screen.getByLabelText("Cell is 25 mm"));
    expect(session.units).toEqual(["mm25"]);
    expect(presentation(store).cellUnit).toBe("mm25");
    expect((screen.getByLabelText("Cell is 25 mm") as HTMLInputElement).checked).toBe(true);

    expect(overview().disabled).toBe(true);
    act(() => {
      store.getState().setPlayerDisplay(tv);
      store.getState().setPresentation({
        calibration: { pxPerInch: 40, method: "square", updatedAt: 1 },
      });
    });
    expect(overview().disabled).toBe(false);
    fireEvent.click(overview());
    expect(presentation(store).overview).toBe(true);
    fireEvent.click(overview());
    expect(presentation(store).overview).toBe(false);
  });

  it("clear calibration goes through the session", async () => {
    const store = createTableStore();
    renderDm(store);
    act(() => {
      store.getState().setPlayerDisplay(tv);
      store.getState().setPresentation({
        calibration: { pxPerInch: 40, method: "square", updatedAt: 1 },
        overview: true,
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear calibration" }));
    });
    expect(presentation(store)).toMatchObject({ calibration: null, overview: false });
    expect(screen.queryByRole("button", { name: "Clear calibration" })).toBeNull();
  });
});
