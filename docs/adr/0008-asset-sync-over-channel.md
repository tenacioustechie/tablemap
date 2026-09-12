# ADR 0008: Map images reach the player as `asset` messages on the sync channel

Status: accepted (T004)

## Context
Map images are Blobs in the DM window's IndexedDB (ADR 0007). The player window is render-only and, by the boundary established in T002/T003, never touches storage (`src/player/**` may not import `db`/`persistence`). It still has to paint the active map. ADR 0003 also states that *all* DM→player communication goes through the typed message schema in `state/sync.ts`.

## Decision
- **A fourth message type, `asset`**: `{ type: "asset", v, id, kind, mime, data }` where `data` is the Blob's bytes in base64. Assets are *unsequenced*: they carry no `seq`, the mirror applies them whenever they arrive, and a duplicate for the same id simply replaces the previous Blob. The sequenced state (`snapshot`/`delta`) references assets by id, so state and bytes can arrive in either order; the player renders the map colour/grid immediately and the image when its bytes land.
- **The DM pushes, the player never asks.** `startDmSync` takes an `AssetSource` (the DM view supplies `getAsset` over the campaign database). After the start-up snapshot and after every delta it pushes each referenced asset it has not sent in this session; on a player `hello` it re-sends everything (a fresh window has nothing). Order is `assetIdsForPlayer(state)`: the active map's assets first, then every other map's, so a scene switch to an already-sent map is instant. The player still only ever sends `hello`.
- **The mirror keeps assets in a side table** (`MirrorState.assets: Record<AssetId, Blob>`), pruned to what the current shared state references after every snapshot/delta, so a long session cannot accumulate deleted maps' images.
- **Encoding stays JSON strings** on the existing transport (`encodeMessage`/`decodeMessage` unchanged; `validateMessage` checks the new shape). `state/assetCodec.ts` does Blob↔base64 with `FileReader`/`arrayBuffer`, `btoa`/`atob`.

## Alternatives considered
- **Player reads IndexedDB directly.** Simplest and zero-copy, but it breaks the "player never touches storage" boundary and would not survive the v2 plan of remote player devices over a LAN, where assets *must* travel over the wire.
- **Post Blobs through BroadcastChannel via structured clone.** Zero-copy within one browser, but it changes the transport contract from strings to objects, would need a second validation path, and again does not generalise to a socket transport. Worth revisiting only if profiling shows base64 (about 1.33× the bytes, one encode per asset per player session) is a real cost.
- **A separate channel or `postMessage` on the window handle for binaries.** Rejected by ADR 0003: one channel, one schema.

## Consequences
- `SyncMessage` has four types; `SYNC_MESSAGE_TYPES` and the protocol tests cover the new one. `PROTOCOL_VERSION` stays 1: older players ignore unknown-type messages rather than breaking.
- Fog masks and token images will ride the same message with `kind: "fog-mask"` / `"token-image"`; `sceneAssetIds` already lists them.
- A large campaign sends all its map images to the player at start-up (active map first). If that proves slow on real hardware, the DM could defer non-active maps until they are activated; the protocol needs no change for that.
