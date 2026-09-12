# Architecture

Local-first TypeScript SPA. No backend. Ships as static files; runs offline once loaded.

## Windows & sync
- Routes: / campaign manager, /dm DM view, /player player view. Hash router (`createHashRouter`) so static hosting and file:// URLs work. Route table lives in `app/src/routes.tsx`; path constants in `app/src/routePaths.ts` (dependency-free so any module can import them).
- DM view opens /player with window.open (named window `tablemap-player`, `popup` feature for a chrome-less window). The DM window retains the handle in a controller (`app/src/dm/playerWindow.ts`, pure logic with injectable deps; React binding `usePlayerWindow.ts`) and uses it to focus, full-screen and close the player window. Re-clicking "Open" focuses the existing window instead of spawning another. The hook polls the handle (500 ms) for closed/fullscreen changes because no cross-window event survives the popup's own navigation.
- Fullscreen: the DM toggle calls `requestFullscreen` on the player document via the handle. Browsers only honour that from a user gesture in the *target* window, so the request is often denied (it is in headless Chromium). The DM view then shows a hint, and the player view offers an in-window fallback: press **F** or double-click. See ADR 0005. The OS puts the window on the TV (Window Management API where available, manual drag as fallback).
- Player/DM boundary: `src/player/**` must never import from `src/dm/`. Enforced by an ESLint `no-restricted-imports` rule scoped to `src/player` and by a unit test (`src/player/boundary.test.ts`).
- DM layout (`DmView`): top toolbar (player-window controls), left sidebar (tools), main canvas area. Later tasks fill the sidebar and mount the Konva stage in the canvas area.
- **Single source of truth is the DM window Zustand store.** The player window is a dumb mirror: it applies sync messages received over a BroadcastChannel and renders. It never mutates state. Message schema lives in app/src/state/sync.ts (typed, versioned). Full-state snapshot on player connect; deltas after (fog ops are sent as operations, never bitmaps).

## Rendering
- Konva stage with layers bottom-to-top: map image -> grid -> tokens -> annotations -> fog.
- Fog: offscreen canvas mask, black-filled; reveal ops drawn with globalCompositeOperation destination-out (radial-gradient brush for feathering). DM composites the mask at ~50% alpha, player at 100%. Mask persisted as PNG blob; undo via bounded operation log with periodic snapshot compaction.
- Calibration: player stage scale fixed to pxPerInch / gridInchesPerCell; DM stage free pan/zoom.

## Storage
- Dexie (IndexedDB): campaigns, maps (image blobs), fog masks (PNG blobs), settings incl. per-display calibration. Autosave debounced from store subscriptions.
- Export/import: JSZip bundle — campaign.json + assets/ blobs. Schema carries a version number; importers migrate forward.

## Approved dependencies
react, react-dom, react-router-dom, konva, react-konva, zustand, dexie, jszip, nanoid.
Dev: typescript, vite, @vitejs/plugin-react, vitest, @testing-library/react, jsdom, @playwright/test, eslint (+ typescript-eslint), fake-indexeddb (tests).
Anything else needs an ADR.

## Testing strategy
- Unit (Vitest): state slices, sync protocol encode/decode, fog op math, grid/calibration math, persistence round-trips (fake-indexeddb).
- E2E (Playwright): multi-page tests — one context, DM page + player page — asserting the player render reacts to DM actions (fog reveal, blackout, ping, scene switch). Visual sanity via screenshot assertions on the fog layer. The player page is obtained by clicking "Open player view" and awaiting `context.waitForEvent("page")` (see `e2e/player-window.spec.ts`).
- Unit tests that need source text (e.g. the player/DM boundary test) use Vite's `import.meta.glob(..., { query: "?raw" })` rather than Node `fs`, so no Node typings are needed.
