# Architecture

Local-first TypeScript SPA. No backend. Ships as static files; runs offline once loaded.

## Windows & sync
- Routes: / campaign manager, /dm DM view, /player player view. Hash router (`createHashRouter`) so static hosting and file:// URLs work. Route table lives in `app/src/routes.tsx`; path constants in `app/src/routePaths.ts` (dependency-free so any module can import them).
- DM view opens /player with window.open (named window `tablemap-player`, `popup` feature for a chrome-less window). The DM window retains the handle in a controller (`app/src/dm/playerWindow.ts`, pure logic with injectable deps; React binding `usePlayerWindow.ts`) and uses it to focus, full-screen and close the player window. Re-clicking "Open" focuses the existing window instead of spawning another. The hook polls the handle (500 ms) for closed/fullscreen changes because no cross-window event survives the popup's own navigation.
- Fullscreen: the DM toggle calls `requestFullscreen` on the player document via the handle. Browsers only honour that from a user gesture in the *target* window, so the request is often denied (it is in headless Chromium). The DM view then shows a hint, and the player view offers an in-window fallback: press **F** or double-click. See ADR 0005. The OS puts the window on the TV (Window Management API where available, manual drag as fallback).
- Player/DM boundary: `src/player/**` must never import from `src/dm/`. Enforced by an ESLint `no-restricted-imports` rule scoped to `src/player` and by a unit test (`src/player/boundary.test.ts`).
- DM layout (`DmView`): top toolbar (player-window controls), left sidebar (tools), main canvas area. Later tasks fill the sidebar and mount the Konva stage in the canvas area.
- **Single source of truth is the DM window Zustand store.** The player window is a dumb mirror: it applies sync messages received over a BroadcastChannel and renders. It never mutates state. Message schema lives in app/src/state/sync.ts (typed, versioned). Full-state snapshot on player connect; deltas after (fog ops are sent as operations, never bitmaps).

### State & sync modules (`app/src/state/`)
- `shared.ts` — `SharedState` (the only state the player ever sees) plus `SharedOp`, the discriminated union of operations that change it, and the pure reducer `applyOp`. Both windows run the same reducer. Later tasks extend the state and add op kinds here.
- `store.ts` — the DM store (`createTableStore`, app-wide `tableStore`, `useTableStore` hook). Shared state changes only via `dispatch(...ops)`, which applies the reducer, bumps `seq` by one per dispatch and notifies `onOps` listeners. **`src/player/**` may not import this module** (ESLint `no-restricted-imports` + `boundary.test.ts`).
- `sync.ts` — the protocol (ADR 0006): `PROTOCOL_VERSION`, `SYNC_CHANNEL_NAME`, message types `hello` / `snapshot` / `delta`, constructors, `encodeMessage` (JSON string) and `decodeMessage`/`validateMessage` (never throw; reject other versions, unknown types and bad shapes).
- `transport.ts` — `SyncTransport` interface (`post`, `onMessage`, `close`). `createBroadcastTransport` wraps a BroadcastChannel; `createMemoryHub` is the in-test replacement with the same fan-out (never echoes to the sender); `createNullTransport` is used where BroadcastChannel is missing.
- `mirror.ts` — the player-side `MirrorState` (`connecting | synced`, `seq`, `shared | null`) and the pure `reduceMirror(mirror, message)`: snapshots always replace; a delta applies only if `seq === mirror.seq + 1`; stale/duplicate deltas are ignored; a gap, or a delta before any snapshot, sets `resync` so the caller re-requests a snapshot.
- `dmSync.ts` — `startDmSync(store, transport)`: on start sends `hello(dm)` + a snapshot (so already-open players catch up), answers every player `hello` with a snapshot, and forwards each dispatch as one `delta`. Ignores all other traffic; nothing received can mutate the DM store.
- `playerSync.ts` — `startPlayerSync(mirror, transport)`: sends `hello(player)` on start and whenever `reduceMirror` asks for a resync; writes decoded messages into the mirror. **The player only ever sends `hello`.**
- React bindings: `dm/useDmSync.ts` (DM view) and `player/usePlayerSync.ts` (player view) create the transport inside an effect so StrictMode's double mount gets a fresh channel; both views accept an injected `createTransport` for tests. `PlayerView` exposes `data-sync-status` / `data-sync-seq` on its root for e2e assertions.
- Reconnect: a reloaded player window is simply a new endpoint; its `hello` fetches a full snapshot and deltas resume from that `seq`. A player opened before the DM stays `connecting` until the DM's start-up snapshot arrives.

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
- Unit (Vitest): state slices, sync protocol encode/decode, fog op math, grid/calibration math, persistence round-trips (fake-indexeddb). Sync is tested end-to-end without a browser by wiring `startDmSync` and `startPlayerSync` through `createMemoryHub` (`src/state/syncDrivers.test.ts`).
- E2E (Playwright): multi-page tests — one context, DM page + player page — asserting the player render reacts to DM actions (fog reveal, blackout, ping, scene switch). Visual sanity via screenshot assertions on the fog layer. The player page is obtained by clicking "Open player view" and awaiting `context.waitForEvent("page")` (see `e2e/player-window.spec.ts`). `e2e/sync.spec.ts` covers live updates, snapshot-on-open, player reload and a player opened before the DM.
- Unit tests that need source text (e.g. the player/DM boundary test) use Vite's `import.meta.glob(..., { query: "?raw" })` rather than Node `fs`, so no Node typings are needed.
