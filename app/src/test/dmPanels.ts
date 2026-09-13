/**
 * Opens the setup-once forms that sit behind disclosures in a rendered
 * `DmView` (T019). Tests that fill the blank-map form or the TV-size
 * fieldset call these first; they open the owning tab on the way.
 */
import { fireEvent, screen } from "@testing-library/react";
import { openTab } from "./dmTabs";

/** Maps tab → "New blank map" open → the form is in the DOM. */
export function openBlankMapForm(): void {
  openTab("maps");
  const disclosure = screen.getByTestId("blank-map-disclosure");
  if (disclosure.getAttribute("aria-expanded") !== "true") fireEvent.click(disclosure);
  expect(screen.getByTestId("blank-map-form")).toBeTruthy();
}

/**
 * Table tab → the TV-size fieldset is in the DOM. It is open on its own
 * while the display is uncalibrated and behind a disclosure once calibrated.
 */
export function openTvSizeForm(): void {
  openTab("table");
  const disclosure = screen.queryByTestId("tv-size-disclosure");
  if (disclosure && disclosure.getAttribute("aria-expanded") !== "true") fireEvent.click(disclosure);
  expect(screen.getByTestId("calibration-tv-size")).toBeTruthy();
}
