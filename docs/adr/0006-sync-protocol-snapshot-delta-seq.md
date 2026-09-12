# ADR 0006: Sync protocol — versioned snapshot/delta with sequence numbers

Status: accepted (T002)

## Context
ADR 0003 picked BroadcastChannel as the DM→player transport and called for a typed, versioned, snapshot-then-delta protocol. This ADR fixes the concrete shape so later tasks (fog ops, tokens, viewport) extend it rather than reinvent it. Constraints: the player must be a pure mirror; a reloaded player must recover without DM involvement; the protocol must survive being moved onto a WebSocket/WebRTC transport in v2; and a stale player (old build) must never apply state it does not understand.

## Decision
- **Three message types**, all carrying `v: PROTOCOL_VERSION`:
  - `hello { role, clientId }` — a window announces itself. A *player* hello is a snapshot request. The DM sends one on start for symmetry/diagnostics.
  - `snapshot { seq, state }` — the full `SharedState`.
  - `delta { seq, ops }` — the ops from one DM `dispatch`.
- **Ops, not diffs.** Every change to shared state is a `SharedOp` applied by one pure reducer (`applyOp`) that both windows share. The DM store applies ops locally and the sync layer forwards the identical ops, so the player computes the same state. This is what lets fog reveals travel as operations rather than bitmaps.
- **Sequence numbers.** The DM increments `seq` once per dispatch. Snapshots carry the current `seq`. The player applies a delta only when `seq === last + 1`; it ignores duplicates/stale deltas and, on a gap or a delta before any snapshot, keeps rendering its last good state and re-sends `hello` to obtain a snapshot. Snapshots are authoritative regardless of `seq` (the DM may have restarted).
- **Wire format is a JSON string**, produced by `encodeMessage` and validated by `decodeMessage`. Structured clone would work on BroadcastChannel, but a string is transport-agnostic and forces validation at the boundary. `decodeMessage` never throws and reports `malformed | version-mismatch | unknown-type | invalid-shape`.
- **Player is render-only by construction.** `startPlayerSync` can only emit `hello`. `src/player/**` cannot import the DM store (`state/store`) or the DM publisher (`state/dmSync`); enforced by ESLint and a unit test. Nothing the DM receives can mutate its store: it only reacts to player hellos by sending a snapshot.
- **Transport is an interface** (`post`, `onMessage`, `close`). Production uses BroadcastChannel; tests use an in-memory hub with identical fan-out semantics (no echo to sender). A v2 remote transport implements the same interface.

## Alternatives considered
- **Broadcast the whole state on every change.** Simplest, but fog masks make it far too large, and it gives no ordering guarantee.
- **Structural diffs (JSON patch).** Transport-neutral but the reducer would exist twice (once for the DM UI, once for the patch), and fog ops need semantic replay for undo anyway.
- **Player pulls state through `window.opener`.** Rejected by ADR 0005: DM→player state must go over the typed channel, never DOM access.
- **Per-message acks from the player.** Not needed on a same-machine channel; gap detection via `seq` plus snapshot re-request covers the loss cases at no cost.

## Consequences
- Adding state = extend `SharedState`, add an op kind, extend `applyOp`, `isSharedOp`, `isSharedState`, and their tests. `PROTOCOL_VERSION` is bumped when a change is not backward compatible for a running player window.
- A player window opened before the DM window sits in `connecting` until the DM starts (the DM broadcasts a snapshot on start), so ordering of window launches does not matter.
- `seq` is per DM session, not persisted. Persistence (T003) is a separate concern from sync.
