# Architecture

Local-first TypeScript SPA. No backend. Ships as static files; runs offline once loaded.

## Windows & sync
- Routes: / campaign manager, /dm DM view, /player player view.
- DM view opens /player with window.open; the OS puts it on the TV (Window Management API where available, manual drag as fallback), Fullscreen API for chrome-free display.
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
- E2E (Playwright): multi-page tests — one context, DM page + player page — asserting the player render reacts to DM actions (fog reveal, blackout, ping, scene switch). Visual sanity via screenshot assertions on the fog layer.
