/**
 * Opens a DM sidebar tab in a rendered `DmView` (T016). Panel tests that
 * drive controls through `DmView` call this first: only the active tab's
 * panels are mounted.
 */
import { fireEvent, screen } from "@testing-library/react";
import type { DmTabId } from "../dm/SidebarTabs";

export function openTab(id: DmTabId): void {
  fireEvent.click(screen.getByTestId(`dm-tab-${id}`));
  expect(screen.getByTestId("dm-tabpanel").dataset.tab).toBe(id);
}
