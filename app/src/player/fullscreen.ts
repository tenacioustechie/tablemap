/**
 * Local fullscreen toggle for the player window. Browsers only honour
 * requestFullscreen from a user gesture in *this* window, so the player view
 * wires this to a key press / double-click as a fallback when the DM window's
 * cross-window request is denied.
 */
export async function toggleLocalFullscreen(
  doc: Document = document
): Promise<boolean> {
  try {
    if (doc.fullscreenElement) {
      await doc.exitFullscreen();
      return false;
    }
    await doc.documentElement.requestFullscreen();
    return true;
  } catch {
    return doc.fullscreenElement != null;
  }
}

/** Keys that toggle fullscreen in the player window. */
export function isFullscreenKey(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === "f" || event.key === "F";
}
