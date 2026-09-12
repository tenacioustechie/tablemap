# ADR 0005: Player window control from the DM window

Status: accepted (T001)

## Context
The player view must run in its own window on the TV, chrome-free and full screen, while the DM drives everything from the laptop. The DM view needs to open, focus, full-screen and close that window. Browsers restrict two of those operations:
- `window.open` must be triggered by a user gesture, otherwise the popup is blocked.
- `Element.requestFullscreen()` requires transient user activation **in the document that is being full-screened**. User activation is tracked per window and does not propagate from an opener to a popup, so calling `playerWindow.document.documentElement.requestFullscreen()` from a click in the DM window is denied by Chromium (confirmed in headless Chromium in our e2e run) and Firefox.

## Decision
- The DM window opens `/player` with `window.open(url, "tablemap-player", "popup=yes,width=1280,height=720")` and **retains the handle** in a small controller (`src/dm/playerWindow.ts`). The named window plus a liveness check (`handle.closed`) means repeated clicks focus the existing window instead of opening duplicates.
- The controller exposes `toggleFullscreen()` which attempts the cross-window Fullscreen API call and reports `entered | exited | denied | not-open`. It never throws.
- On `denied`, the DM view shows a hint and the **player view provides an in-window fallback**: `F` key or double-click toggles fullscreen on its own document. Exiting fullscreen (`exitFullscreen`) does not need a gesture, so it works cross-window regardless.
- Window state (open/fullscreen) is polled every 500 ms while a handle exists. Same-origin events on the popup (`pagehide`, `fullscreenchange`) are unreliable because listeners attached to the initial `about:blank` document are lost when the popup navigates.
- `src/player/**` may not import from `src/dm/**`; enforced by ESLint and a unit test.

## Alternatives considered
- **Message the player window to full-screen itself** (BroadcastChannel/postMessage). Does not help: the player window still lacks user activation. Also T002 owns the sync channel; T001 must not invent one.
- **Window Management API `fullscreen` feature on `window.open`** (Chromium, requires the `window-management` permission). Promising for a later task (placing the window on a chosen screen, T006 calibration), but permission-gated and Chromium-only, so it is not the baseline.
- **Not retaining the handle** and relying on the DM to alt-tab. Rejected: the spec calls for close/fullscreen control from the DM side.

## Consequences
- Fullscreen from the DM side is best-effort; the user guide documents the F-key fallback.
- The polling interval is a tiny cost and keeps the hook simple and robust.
- Later tasks can pass the retained handle (`getHandle()`) to whatever needs it, but DM→player *state* must still go over the typed sync channel (ADR 0003), never via direct DOM access to the popup.
