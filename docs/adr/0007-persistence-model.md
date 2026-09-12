# ADR 0007: Persistence — campaign document + asset Blobs, debounced autosave

Status: accepted (T003)

## Context
ADR 0001 fixed local-first storage in IndexedDB via Dexie. T003 has to decide what a stored campaign *is*, how binary data (map images, fog masks, token art) is kept, how the DM store gets written without the UI calling "save", and what the DM window opens on start. The same document shape will later feed zip export/import, and the sync protocol (ADR 0006) already has a `SharedState` that must eventually carry maps, tokens and fog.

## Decision
- **The campaign document is metadata + `SharedState`.** `Campaign = { schemaVersion, id, name, createdAt, updatedAt, state: SharedState }` (`state/campaign.ts`). There is one definition of "what a campaign contains" (`SharedState`, `state/shared.ts`, now `{ campaignName, maps, activeMapId }` with the scene model from `state/model.ts`); persistence stores it, sync ships it. `name` is a denormalised, indexed copy of `state.campaignName` for listing.
- **Binary data is never inside the document.** Map images, token images and fog-mask PNGs are Blobs in a separate `assets` table keyed by `AssetId`; the document references them by id (`MapScene.imageAssetId`, `fogMaskAssetId`, `TokenAppearance.assetId`). The JSON document stays small, structured-clone stays cheap, and export can copy assets straight into `assets/` in the zip.
- **`schemaVersion` on every document.** `migrateCampaign` brings older documents forward on load (writing them back) and refuses newer ones with a typed error, so an old build never silently loads a document it does not understand. Dexie's own `version(n)` is reserved for *index* changes.
- **Opening a campaign is an op.** `openCampaign(campaign)` sets the DM-only `campaignId` and applies `campaign/replace` in one store commit. Because it is a normal op, connected player windows receive it as a delta and need no special "campaign changed" message.
- **Autosave is a debounced store subscription** (`state/autosave.ts`): any change to `shared` while a campaign is open schedules a write of the latest state 400 ms later; bursts coalesce; writes are serialised so a slow write cannot be overtaken; switching or closing the campaign flushes first; the DM route flushes on unmount and on `pagehide`. Nothing in the UI calls "save".
- **Load-on-start** (`state/session.ts`): the DM route opens the last opened campaign, else the most recently updated one, else creates "Untitled campaign". Concurrent bootstraps for one store share a promise so StrictMode cannot create two defaults. The campaign manager (`/`) opens campaigns explicitly and records the last opened id.

## Alternatives considered
- **Serialise Blobs as base64 inside the document.** Simple, but a few map images push the document to tens of MB, every autosave rewrites all of it, and structured clone / JSON.stringify time becomes visible.
- **Persist the raw Zustand state with `zustand/middleware` persist.** No control over Blob handling, timing, or schema versioning; storage would be a side effect of state shape instead of a documented format.
- **Immediate write on every dispatch.** Fog brush drags dispatch at 60 fps; debouncing is required, and doing it in one place is simpler than per-feature throttling.
- **A "campaign changed" sync message.** Rejected: replacing state is expressible as an op, which keeps the protocol at three message types.

## Consequences
- Adding persistent data = extend `SharedState`/`model.ts` and its guards. Nothing else in persistence changes; a breaking shape change bumps `SCHEMA_VERSION` and adds a migration step.
- Features that create Blobs (map import, fog mask snapshots) call `putAsset` and store the returned id in state; deleting a campaign deletes its assets by `campaignId`.
- Fog masks will be written through the same debounce; the op log for undo stays in memory (spec: undo is per session).
- Persistence tests run under Node (`// @vitest-environment node`) because jsdom's `Blob` is not structured-cloneable by fake-indexeddb.
