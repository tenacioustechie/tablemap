/**
 * Physical calibration (T006, ADR 0011): making one grid cell measure one
 * real inch (or 25 mm) on the TV in the table.
 *
 * Everything here is pure. The moving parts:
 * - `DisplayInfo` — what a player window can tell about the screen it is on
 *   (`window.screen` size in CSS px, device pixel ratio, position). It is
 *   sent in the player's `hello`; `displayKey` turns it into the settings key
 *   calibration is stored under, so re-opening the player window on the same
 *   TV finds its calibration again.
 * - `DisplayCalibration` — the stored result: CSS pixels per physical inch
 *   on that display, plus how it was measured.
 * - Derivations: `pxPerInchFromSquare` (the DM grows a target square on the
 *   player screen until a ruler says it is one cell wide) and
 *   `pxPerInchFromDiagonal` (TV diagonal + native resolution).
 * - `lockedScale` — the player stage scale that makes a cell exactly
 *   `cellInches` wide regardless of the map image's own resolution.
 * - `PlayerPresentation` — the subset the player window needs, carried by the
 *   `presentation` sync message. The DM-only `PresentationState` in the store
 *   also remembers which display is connected and the loaded calibration.
 */
// ---- displays -------------------------------------------------------------

/** What a player window reports about its screen, in CSS pixels. */
export interface DisplayInfo {
  width: number;
  height: number;
  /** `window.devicePixelRatio`: physical pixels per CSS pixel. */
  pixelRatio: number;
  /**
   * Position of the screen in the virtual desktop (`screen.availLeft/Top`
   * where the browser exposes them; 0 otherwise). Tells two same-sized
   * displays apart.
   */
  left: number;
  top: number;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPositiveNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

function isFinite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function isDisplayInfo(x: unknown): x is DisplayInfo {
  return (
    isRecord(x) &&
    isPositiveNumber(x.width) &&
    isPositiveNumber(x.height) &&
    isPositiveNumber(x.pixelRatio) &&
    isFinite(x.left) &&
    isFinite(x.top)
  );
}

/**
 * The settings key a display's calibration is stored under. Size, pixel
 * ratio and position: the best identity a web page gets without the Window
 * Management permission. Rearranging displays changes the key (recalibrate).
 */
export function displayKey(display: DisplayInfo): string {
  const { width, height, pixelRatio, left, top } = display;
  return `${width}x${height}@${pixelRatio}+${left},${top}`;
}

export function displayInfoEqual(a: DisplayInfo | null, b: DisplayInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return displayKey(a) === displayKey(b);
}

/** Reads `DisplayInfo` from a window (`window.screen`). */
export function readDisplayInfo(win: Window): DisplayInfo {
  const screen = win.screen as Screen & { availLeft?: unknown; availTop?: unknown };
  return {
    width: screen.width,
    height: screen.height,
    pixelRatio: win.devicePixelRatio || 1,
    left: isFinite(screen.availLeft) ? screen.availLeft : 0,
    top: isFinite(screen.availTop) ? screen.availTop : 0,
  };
}

// ---- physical cell size ----------------------------------------------------

/** How big one cell is on the table: a 1-inch square or a 25 mm square. */
export type CellUnit = "inch" | "mm25";

export const CELL_UNITS: readonly CellUnit[] = ["inch", "mm25"];

export const MM_PER_INCH = 25.4;

/** One cell's physical width in inches. */
export const CELL_INCHES: Record<CellUnit, number> = {
  inch: 1,
  mm25: 25 / MM_PER_INCH,
};

export const CELL_UNIT_LABELS: Record<CellUnit, string> = {
  inch: "1 inch",
  mm25: "25 mm",
};

export function isCellUnit(x: unknown): x is CellUnit {
  return (CELL_UNITS as readonly unknown[]).includes(x);
}

export function cellInches(unit: CellUnit): number {
  return CELL_INCHES[unit];
}

// ---- calibration ----------------------------------------------------------

export type CalibrationMethod = "square" | "diagonal";

/** Stored per display (settings table). CSS pixels per physical inch. */
export interface DisplayCalibration {
  pxPerInch: number;
  method: CalibrationMethod;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * Sanity bounds on CSS px per inch. A 32" 720p TV is ~46; a phone at 3×
 * pixel ratio is still under 200 CSS px/in. Below 10 or above 600 is a typo.
 */
export const MIN_PX_PER_INCH = 10;
export const MAX_PX_PER_INCH = 600;

export function isPlausiblePxPerInch(x: unknown): x is number {
  return isFinite(x) && x >= MIN_PX_PER_INCH && x <= MAX_PX_PER_INCH;
}

export function isDisplayCalibration(x: unknown): x is DisplayCalibration {
  return (
    isRecord(x) &&
    isPlausiblePxPerInch(x.pxPerInch) &&
    (x.method === "square" || x.method === "diagonal") &&
    isFinite(x.updatedAt)
  );
}

/**
 * Measured-square path: the target square on the player screen is `sizePx`
 * CSS pixels wide and the DM has adjusted it until a ruler says it is exactly
 * one cell (1 inch or 25 mm). Null when the result is implausible.
 */
export function pxPerInchFromSquare(sizePx: number, unit: CellUnit): number | null {
  if (!isPositiveNumber(sizePx)) return null;
  const value = sizePx / cellInches(unit);
  return isPlausiblePxPerInch(value) ? value : null;
}

export interface DiagonalInput {
  /** The TV's advertised diagonal, in inches. */
  diagonalInches: number;
  /** Native resolution in physical pixels. */
  widthPx: number;
  heightPx: number;
  /** The player window's device pixel ratio; converts physical px to CSS px. */
  pixelRatio?: number;
}

/**
 * Diagonal + resolution path: physical pixels per inch is the pixel diagonal
 * over the physical diagonal; dividing by the pixel ratio gives CSS px per
 * inch, which is what the stage scale needs. Null when any input is not a
 * positive number or the result is implausible.
 */
export function pxPerInchFromDiagonal({
  diagonalInches,
  widthPx,
  heightPx,
  pixelRatio = 1,
}: DiagonalInput): number | null {
  if (
    !isPositiveNumber(diagonalInches) ||
    !isPositiveNumber(widthPx) ||
    !isPositiveNumber(heightPx) ||
    !isPositiveNumber(pixelRatio)
  ) {
    return null;
  }
  const value = Math.hypot(widthPx, heightPx) / diagonalInches / pixelRatio;
  return isPlausiblePxPerInch(value) ? value : null;
}

/**
 * The stage scale that makes a cell of `cellSizePx` map pixels exactly
 * `cellInches(unit)` inches wide on a display with `pxPerInch`:
 * cell screen px = cellSizePx * scale = pxPerInch * cellInches.
 */
export function lockedScale(pxPerInch: number, unit: CellUnit, cellSizePx: number): number {
  return (pxPerInch * cellInches(unit)) / cellSizePx;
}

/** Screen pixels one cell occupies once calibrated (what the ruler should read). */
export function calibratedCellPx(pxPerInch: number, unit: CellUnit): number {
  return pxPerInch * cellInches(unit);
}

/** Target square size when the ruler screen starts: the current cell, else ~1" at 96 dpi. */
export const DEFAULT_TARGET_PX = 96;
export const MIN_TARGET_PX = 8;
export const MAX_TARGET_PX = 2000;

export function initialTargetPx(calibration: DisplayCalibration | null, unit: CellUnit): number {
  const px = calibration ? calibratedCellPx(calibration.pxPerInch, unit) : DEFAULT_TARGET_PX;
  return clampTargetPx(px);
}

export function clampTargetPx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_TARGET_PX;
  return Math.min(MAX_TARGET_PX, Math.max(MIN_TARGET_PX, px));
}

// ---- presentation ---------------------------------------------------------

/**
 * What the player window needs to present a scene (the `presentation`
 * message). `pxPerInch` null means "not calibrated for this display: fit the
 * map to the window". `target` non-null puts the player on the ruler screen
 * showing a square of that many CSS pixels.
 */
export interface PlayerPresentation {
  pxPerInch: number | null;
  cellUnit: CellUnit;
  /** DM override: show the whole map fitted to the window, not to scale. */
  overview: boolean;
  target: number | null;
}

export function defaultPlayerPresentation(): PlayerPresentation {
  return { pxPerInch: null, cellUnit: "inch", overview: false, target: null };
}

export function isPlayerPresentation(x: unknown): x is PlayerPresentation {
  return (
    isRecord(x) &&
    (x.pxPerInch === null || isPlausiblePxPerInch(x.pxPerInch)) &&
    isCellUnit(x.cellUnit) &&
    typeof x.overview === "boolean" &&
    (x.target === null || isPositiveNumber(x.target))
  );
}

export function playerPresentationEqual(a: PlayerPresentation, b: PlayerPresentation): boolean {
  return (
    a.pxPerInch === b.pxPerInch &&
    a.cellUnit === b.cellUnit &&
    a.overview === b.overview &&
    a.target === b.target
  );
}

export type PresentationMode = "calibrating" | "calibrated" | "overview" | "uncalibrated";

/** How the player should show the scene right now. */
export function presentationMode(p: PlayerPresentation): PresentationMode {
  if (p.target !== null) return "calibrating";
  if (p.pxPerInch === null) return "uncalibrated";
  return p.overview ? "overview" : "calibrated";
}

/** DM-only state behind the presentation (lives in the DM store, never persisted with a campaign). */
export interface PresentationState {
  /** Display the player window last reported; null before any player hello. */
  playerDisplay: DisplayInfo | null;
  /** Calibration for `playerDisplay`, loaded from settings; null = not calibrated. */
  calibration: DisplayCalibration | null;
  cellUnit: CellUnit;
  overview: boolean;
  /** Ruler-screen target size (CSS px) while calibrating; null otherwise. */
  target: number | null;
}

export function initialPresentationState(): PresentationState {
  return {
    playerDisplay: null,
    calibration: null,
    cellUnit: "inch",
    overview: false,
    target: null,
  };
}

/** What the player gets from the DM-only state. */
export function playerPresentation(state: PresentationState): PlayerPresentation {
  return {
    pxPerInch: state.calibration?.pxPerInch ?? null,
    cellUnit: state.cellUnit,
    overview: state.overview,
    target: state.target,
  };
}
