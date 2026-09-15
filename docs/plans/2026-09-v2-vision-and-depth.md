# Plan: v2 — walls, line-of-sight vision, room fill, initiative

Written 2026-09-13. Backlog tasks T101–T112 implement it after the usability series (T015–T019). Hex grids (T113) and remote player devices (T114) are parked in the icebox by decision. This document records the decisions and the reasoning; once a task lands, its ADR, `architecture.md` and the user guide are the source of truth.

## 1. Decisions (agreed 2026-09-13)

| Topic | Decision |
| --- | --- |
| Fog model | **The op log stays authoritative** (ADR 0012 unchanged). Vision commits ordinary `polygon` reveal ops. "Currently visible" is a derived overlay both windows compute from the same shared data. |
| Walls | **Free segments in map pixels**, any angle, each `wall` or `door`; doors carry `open`. The same format serves v3 (wall tiles emit segments). |
| Vision | **Per-token radius in cells** (`Token.vision`, 0 = none). Hidden tokens still see. |
| Dim rule | Revealed-but-not-currently-seen areas dim on the player **only while the map has a token with vision > 0**; per-map override `auto / on / off`. Manual-fog maps look exactly as they do today. |
| Reveal timing | **Live preview on the DM canvas while dragging; commit one reveal op on drop.** The TV changes on drop. |
| Doors in play | **Click a door on the DM canvas** to toggle it; also listed in the Walls panel. |
| Initiative | **Per campaign**, entries are name + value with an optional link to a token; a **player strip** along one TV edge is toggleable per session. |
| Hex grids | **Deferred** (T113, icebox). Everything in this series is cell-shape-agnostic where it is cheap to be (vision, room fill work on the grid abstraction, not on square maths). |
| Remote play | **Parked** (T114, icebox). No transport change in this series. |
| Sequencing | **After T019**: walls need T017's scene rotation and T016's tabs. |

## 2. How the pieces fit

```
walls + doors (shared state, on the wire, never drawn on the player)
        │
        ▼
visibility polygon  ←── token position + vision radius
   (pure maths, map/visibility.ts, both windows)
        │                                │
        ▼                                ▼
reveal op on drop                "currently visible" overlay
(fog log, undo, sync, compaction)   (derived; dims the rest on the player
                                     when the map uses vision)
```

- Walls travel to the player like tokens do: they are needed to compute the overlay there, and the player stage simply never draws them. Same rule as hidden tokens, which the player already holds and does not draw (ADR 0015).
- One reveal op per drop keeps the log small; a door toggle re-runs vision for every seeing token on the map and dispatches those ops **in one `dispatch` call** (one `seq`, one delta, one undo step).
- Room fill is a flood over grid cells bounded by wall/door segments crossing cell edges; its result is one `rects` op, so it reuses the snapped-fog path from T008 unchanged.
- The overlay is a Konva shape (revealed area minus the union of visible polygons) drawn above the fog layer: cheap, no raster, no new asset kind.
- Initiative is shared state (the strip needs it), filtered by nothing; the strip's visibility is DM-only presentation like the grid toggle.

## 3. Schema and dependency chain

| Task | Adds | Schema | Depends |
| --- | --- | --- | --- |
| T101 Walls & doors model + DM render | `MapScene.walls` | v9 | T019 |
| T102 Wall drawing tools | — | — | T101 |
| T103 Doors in play | — | — | T102 |
| T104 Visibility polygon maths | pure module | — | T101 |
| T105 Vision fields | `Token.vision`, `MapScene.visionDim` | v10 | T101 |
| T106 Auto-reveal on drop + live preview | — | — | T103, T104, T105 |
| T107 Currently-visible overlay + dim | — | — | T106 |
| T108 Room click-fill | — | — | T103, T104 |
| T109 Initiative model | `SharedState.initiative` | v11 | T105 |
| T110 Initiative DM tab | — | — | T109 |
| T111 Initiative player strip + turn ring | presentation field | — | T110 |
| T112 v2 session e2e + docs pass | — | — | T107, T108, T111 |

Schema bumps are chained through `depends` so version numbers are assigned in a fixed order (v9 → v10 → v11) whatever the harness picks. T017's scene rotation (`rotateScene`) must turn wall endpoints; T101 extends it.

## 4. Sizing

Each task is scoped like the v1 tasks the harness finished in 15–30 minutes: one schema bump at most, one pure module or one UI surface, its own tests and docs. The pure-maths tasks (T104, T108) have no UI so they can be verified entirely by unit tests; the UI tasks build on them.

## 5. v2 done when (the acceptance list T112 automates)

1. Draw walls and a door on an imported map in under two minutes; they survive reload and export/import; rotating the map turns them.
2. A token with vision 6 dropped in a room reveals exactly that room on the TV (walls block, radius limits); undo removes the reveal.
3. Opening a door widens what the token sees on the next drop without any other action; closing it does not re-hide what was revealed.
4. On a map using vision, revealed areas no token currently sees are dimmed on the TV; on a manual-fog map nothing is dimmed.
5. Click-fill reveals one walled room and stops at closed doors.
6. An initiative list with five entries advances turn by turn and round by round on the DM and on the TV strip; the current token has a ring.

## 6. Consequences for v3
- Wall segments are the format v3's wall tiles emit (T203); T101 must not couple segments to how they were drawn.
- Room fill and vision consume the grid abstraction (`gridLines`, cell membership) so a future hex grid only has to supply cell geometry.
- Tile layers (T202) will be a new scene kind; nothing here assumes `imageAssetId` is non-null.

## 7. Closing note (2026-09-15, T112)

The series is built. T101–T111 implemented it, and T112's `app/e2e/session-v2.spec.ts` drives the list in §5 (the spec's v2 criteria 1–6) end to end in Chromium as one flow. This plan is now a historical record: the decisions it proposed live on in the ADRs, and `docs/architecture.md` and chapter 7 of `docs/user-guide.md` ("Walls, vision and initiative") describe what was built.

- **ADR 0024** — walls and doors as free segments, shared with the player but never drawn there (T101; doors in play, T103).
- **ADR 0025** — the wall tools as a pure gesture machine with grid-corner snapping; selection on the DM canvas; no wall undo (T102).
- **ADR 0026** — visibility by angular sweep, committed as ordinary reveal ops: the maths (T104), the vision fields and schema v10 (T105), the reveal on drop and on a door toggle with the drag preview (T106), the currently-visible overlay and the dim (T107), and room fill as one `rects` op (T108).
- **ADR 0027** — initiative as campaign state (schema v11, T109), the DM's Turns tab (T110), and the players' strip as presentation with the turn ring on the shared stage (T111).

Where the build differs from this plan:
- **ADR numbers.** T102 took 0025 for the wall tools, so the visibility record the backlog calls "ADR 0025" is ADR 0026 and the initiative record it calls "ADR 0026" is ADR 0027.
- **Doors re-run vision at once.** §5.3 says an opened door widens the view "on the next drop"; as §2 already planned, a door toggle re-runs vision for every seeing token straight away (one dispatch, one undo step), and closing a door re-hides nothing.
- **Tab keys.** The Walls tab took `5` and moved Table to `6` (T101); Turns sits after Tokens in the strip but answers to `7` (T110), so the digits no longer follow the strip's order.

Hex grids (T113) and remote player devices (T114) remain in the icebox.
