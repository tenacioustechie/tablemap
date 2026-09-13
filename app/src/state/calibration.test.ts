import {
  calibratedCellPx,
  cellInches,
  clampTargetPx,
  clonePlayerPresentation,
  DEFAULT_TARGET_PX,
  defaultPlayerPresentation,
  displayInfoEqual,
  displayKey,
  initialPresentationState,
  initialTargetPx,
  isDisplayCalibration,
  isDisplayInfo,
  isDisplayRotation,
  isPlayerPresentation,
  lockedScale,
  MAX_PX_PER_INCH,
  MIN_PX_PER_INCH,
  playerPresentation,
  playerPresentationEqual,
  presentationForMapSwitch,
  presentationMode,
  pxPerInchFromDiagonal,
  pxPerInchFromSquare,
  readDisplayInfo,
  type DisplayInfo,
} from "./calibration";

const tv: DisplayInfo = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };

describe("display identity", () => {
  it("keys a display by size, pixel ratio and position", () => {
    expect(displayKey(tv)).toBe("1920x1080@1+1920,0");
    expect(displayKey({ ...tv, pixelRatio: 2 })).toBe("1920x1080@2+1920,0");
  });

  it("tells same-sized displays apart by position and compares by key", () => {
    const laptop = { ...tv, left: 0, top: 25 };
    expect(displayKey(laptop)).not.toBe(displayKey(tv));
    expect(displayInfoEqual(tv, { ...tv })).toBe(true);
    expect(displayInfoEqual(tv, laptop)).toBe(false);
    expect(displayInfoEqual(null, null)).toBe(true);
    expect(displayInfoEqual(tv, null)).toBe(false);
  });

  it("validates the shape", () => {
    expect(isDisplayInfo(tv)).toBe(true);
    expect(isDisplayInfo({ ...tv, width: 0 })).toBe(false);
    expect(isDisplayInfo({ ...tv, pixelRatio: NaN })).toBe(false);
    expect(isDisplayInfo({ width: 1, height: 1, pixelRatio: 1 })).toBe(false);
    expect(isDisplayInfo(null)).toBe(false);
  });

  it("reads a window's screen, defaulting a missing position to 0", () => {
    const win = {
      screen: { width: 3840, height: 2160, availLeft: 1440, availTop: 0 },
      devicePixelRatio: 2,
    } as unknown as Window;
    expect(readDisplayInfo(win)).toEqual({
      width: 3840,
      height: 2160,
      pixelRatio: 2,
      left: 1440,
      top: 0,
    });
    const bare = { screen: { width: 800, height: 600 }, devicePixelRatio: 0 } as unknown as Window;
    expect(readDisplayInfo(bare)).toEqual({ width: 800, height: 600, pixelRatio: 1, left: 0, top: 0 });
  });
});

describe("pxPerInch from a measured square", () => {
  it("a square that measures one inch gives its pixel width", () => {
    expect(pxPerInchFromSquare(48, "inch")).toBe(48);
  });

  it("a square that measures 25 mm is slightly less than an inch", () => {
    // 25 mm = 0.984 in, so 48 px / 0.984 in = 48.77 px/in.
    expect(pxPerInchFromSquare(48, "mm25")).toBeCloseTo(48 * (25.4 / 25), 6);
    expect(cellInches("mm25")).toBeCloseTo(0.98425, 5);
    expect(cellInches("inch")).toBe(1);
  });

  it("rejects non-positive, non-finite and implausible sizes", () => {
    expect(pxPerInchFromSquare(0, "inch")).toBeNull();
    expect(pxPerInchFromSquare(-5, "inch")).toBeNull();
    expect(pxPerInchFromSquare(NaN, "inch")).toBeNull();
    expect(pxPerInchFromSquare(MIN_PX_PER_INCH - 1, "inch")).toBeNull();
    expect(pxPerInchFromSquare(MAX_PX_PER_INCH + 1, "inch")).toBeNull();
  });
});

describe("pxPerInch from diagonal + resolution", () => {
  it("a 43-inch 4K TV at pixel ratio 1 is ~102.5 px/in", () => {
    const value = pxPerInchFromDiagonal({ diagonalInches: 43, widthPx: 3840, heightPx: 2160 });
    expect(value).toBeCloseTo(Math.hypot(3840, 2160) / 43, 6);
    expect(value).toBeCloseTo(102.46, 1);
  });

  it("divides by the pixel ratio so the result is in CSS pixels", () => {
    const physical = pxPerInchFromDiagonal({ diagonalInches: 43, widthPx: 3840, heightPx: 2160 })!;
    const css = pxPerInchFromDiagonal({
      diagonalInches: 43,
      widthPx: 3840,
      heightPx: 2160,
      pixelRatio: 2,
    })!;
    expect(css).toBeCloseTo(physical / 2, 9);
  });

  it("a 55-inch 1080p TV is ~40 px/in", () => {
    expect(
      pxPerInchFromDiagonal({ diagonalInches: 55, widthPx: 1920, heightPx: 1080 })
    ).toBeCloseTo(40.05, 1);
  });

  it("rejects bad inputs and implausible results", () => {
    expect(pxPerInchFromDiagonal({ diagonalInches: 0, widthPx: 1920, heightPx: 1080 })).toBeNull();
    expect(pxPerInchFromDiagonal({ diagonalInches: 55, widthPx: -1, heightPx: 1080 })).toBeNull();
    expect(pxPerInchFromDiagonal({ diagonalInches: NaN, widthPx: 1920, heightPx: 1080 })).toBeNull();
    expect(
      pxPerInchFromDiagonal({ diagonalInches: 55, widthPx: 1920, heightPx: 1080, pixelRatio: 0 })
    ).toBeNull();
    // A "5000-inch" TV: under 1 px/in.
    expect(pxPerInchFromDiagonal({ diagonalInches: 5000, widthPx: 1920, heightPx: 1080 })).toBeNull();
  });
});

describe("locked scale", () => {
  it("makes a cell exactly pxPerInch * cellInches screen pixels whatever the map resolution", () => {
    for (const cellSizePx of [12, 50, 70, 140, 333.3]) {
      const scale = lockedScale(40, "inch", cellSizePx);
      expect(cellSizePx * scale).toBeCloseTo(40, 9);
      const scale25 = lockedScale(40, "mm25", cellSizePx);
      expect(cellSizePx * scale25).toBeCloseTo(40 * (25 / 25.4), 9);
    }
  });

  it("is the calibrated cell size over the map cell size", () => {
    expect(lockedScale(100, "inch", 50)).toBe(2);
    expect(lockedScale(100, "inch", 200)).toBe(0.5);
    expect(calibratedCellPx(100, "inch")).toBe(100);
    expect(calibratedCellPx(100, "mm25")).toBeCloseTo(98.425, 3);
  });

  it("round-trips: calibrating from a square and locking gives that square back", () => {
    const ppi = pxPerInchFromSquare(57, "inch")!;
    expect(70 * lockedScale(ppi, "inch", 70)).toBeCloseTo(57, 9);
    const ppi25 = pxPerInchFromSquare(57, "mm25")!;
    expect(70 * lockedScale(ppi25, "mm25", 70)).toBeCloseTo(57, 9);
  });
});

describe("target square", () => {
  it("starts at the calibrated cell size, or ~1 inch at 96 dpi when uncalibrated", () => {
    expect(initialTargetPx(null, "inch")).toBe(DEFAULT_TARGET_PX);
    expect(initialTargetPx({ pxPerInch: 40, method: "square", updatedAt: 0 }, "inch")).toBe(40);
    expect(initialTargetPx({ pxPerInch: 40, method: "square", updatedAt: 0 }, "mm25")).toBeCloseTo(
      40 * (25 / 25.4),
      9
    );
  });

  it("clamps to a sane range", () => {
    expect(clampTargetPx(1)).toBe(8);
    expect(clampTargetPx(1e9)).toBe(2000);
    expect(clampTargetPx(NaN)).toBe(DEFAULT_TARGET_PX);
    expect(clampTargetPx(96.5)).toBe(96.5);
  });
});

describe("presentation", () => {
  it("derives what the player needs from the DM-only state", () => {
    const state = initialPresentationState();
    expect(playerPresentation(state)).toEqual(defaultPlayerPresentation());
    expect(
      playerPresentation({
        ...state,
        calibration: { pxPerInch: 42, method: "diagonal", updatedAt: 1 },
        cellUnit: "mm25",
        overview: true,
        target: 50,
        rotation: 180,
        center: { x: 3, y: 4 },
        blackout: true,
        splash: true,
        splashOnSwitch: true,
      })
    ).toEqual({
      pxPerInch: 42,
      cellUnit: "mm25",
      overview: true,
      target: 50,
      rotation: 180,
      center: { x: 3, y: 4 },
      blackout: true,
      splash: true,
    });
  });

  it("a map switch drops the centre and raises the splash only when asked (T009)", () => {
    const base = { ...initialPresentationState(), center: { x: 1, y: 2 } };
    expect(presentationForMapSwitch(base, "m")).toMatchObject({ center: null, splash: false });
    expect(presentationForMapSwitch({ ...base, splashOnSwitch: true }, "m")).toMatchObject({
      center: null,
      splash: true,
    });
    expect(presentationForMapSwitch({ ...base, splashOnSwitch: true }, null).splash).toBe(false);
    const untouched = { ...initialPresentationState(), splash: true };
    expect(presentationForMapSwitch(untouched, "m")).toBe(untouched);
    const initial = initialPresentationState();
    expect(presentationForMapSwitch(initial, null)).toBe(initial);
    expect(presentationForMapSwitch(initial, "m")).toBe(initial);
  });

  it("modes: calibrating beats everything, then uncalibrated, overview, calibrated", () => {
    const base = defaultPlayerPresentation();
    expect(presentationMode(base)).toBe("uncalibrated");
    expect(presentationMode({ ...base, target: 96 })).toBe("calibrating");
    expect(presentationMode({ ...base, pxPerInch: 40, target: 96 })).toBe("calibrating");
    expect(presentationMode({ ...base, pxPerInch: 40 })).toBe("calibrated");
    expect(presentationMode({ ...base, pxPerInch: 40, overview: true })).toBe("overview");
    expect(presentationMode({ ...base, overview: true })).toBe("uncalibrated");
  });

  it("validates and compares presentations", () => {
    const p = { ...defaultPlayerPresentation(), pxPerInch: 40 };
    expect(isPlayerPresentation(p)).toBe(true);
    expect(isPlayerPresentation({ ...p, center: { x: 1, y: 2 }, rotation: 270 })).toBe(true);
    expect(isPlayerPresentation({ ...p, pxPerInch: 5 })).toBe(false);
    expect(isPlayerPresentation({ ...p, cellUnit: "cm" })).toBe(false);
    expect(isPlayerPresentation({ ...p, target: -1 })).toBe(false);
    expect(isPlayerPresentation({ ...p, overview: "yes" })).toBe(false);
    expect(isPlayerPresentation({ ...p, rotation: 45 })).toBe(false);
    expect(isPlayerPresentation({ ...p, center: { x: 1 } })).toBe(false);
    expect(isPlayerPresentation({ ...p, center: undefined })).toBe(false);
    expect(isPlayerPresentation({ ...p, blackout: "no" })).toBe(false);
    expect(isPlayerPresentation({ ...p, splash: null })).toBe(false);
    const d = defaultPlayerPresentation();
    expect(playerPresentationEqual(d, defaultPlayerPresentation())).toBe(true);
    expect(playerPresentationEqual(d, { ...d, target: 1 })).toBe(false);
    expect(playerPresentationEqual({ ...d, center: { x: 1, y: 2 } }, { ...d, center: { x: 1, y: 2 } })).toBe(true);
    expect(playerPresentationEqual({ ...d, center: { x: 1, y: 2 } }, { ...d, center: { x: 1, y: 3 } })).toBe(false);
    expect(playerPresentationEqual({ ...d, center: { x: 1, y: 2 } }, d)).toBe(false);
    expect(playerPresentationEqual(d, { ...d, rotation: 90 })).toBe(false);
    expect(playerPresentationEqual(d, { ...d, blackout: true })).toBe(false);
    expect(playerPresentationEqual(d, { ...d, splash: true })).toBe(false);
    const copy = clonePlayerPresentation({ ...d, center: { x: 1, y: 2 } });
    expect(copy).toEqual({ ...d, center: { x: 1, y: 2 } });
    expect(clonePlayerPresentation(d).center).toBeNull();
  });

  it("validates stored calibrations", () => {
    expect(isDisplayCalibration({ pxPerInch: 40, method: "square", updatedAt: 1 })).toBe(true);
    expect(isDisplayCalibration({ pxPerInch: 4000, method: "square", updatedAt: 1 })).toBe(false);
    expect(isDisplayCalibration({ pxPerInch: 40, method: "guess", updatedAt: 1 })).toBe(false);
    expect(isDisplayCalibration(undefined)).toBe(false);
    // A calibration record never carries the rotation: that is its sibling record (T019).
    expect(isDisplayCalibration({ pxPerInch: 40, method: "square", updatedAt: 1, rotation: 90 })).toBe(true);
  });

  it("validates stored per-display rotations (T019): a quarter turn and a timestamp", () => {
    for (const rotation of [0, 90, 180, 270]) {
      expect(isDisplayRotation({ rotation, updatedAt: 1 })).toBe(true);
    }
    expect(isDisplayRotation({ rotation: 45, updatedAt: 1 })).toBe(false);
    expect(isDisplayRotation({ rotation: "90", updatedAt: 1 })).toBe(false);
    expect(isDisplayRotation({ rotation: 90 })).toBe(false);
    expect(isDisplayRotation({ rotation: 90, updatedAt: NaN })).toBe(false);
    expect(isDisplayRotation(90)).toBe(false);
    expect(isDisplayRotation(null)).toBe(false);
    expect(isDisplayRotation(undefined)).toBe(false);
  });
});
