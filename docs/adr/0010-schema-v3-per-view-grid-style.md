# ADR 0010: Schema version 3 — per-view grid style, `map/set-grid`, two-corner alignment

Status: accepted (T005)

## Context
The spec asks for the grid overlay's toggle, opacity and colour to be set "per view": the DM often wants a strong grid for placing things, while the player screen may want a faint one or none (the printed map already has squares). Schema v2 `GridSettings` had a single `visible` / `color` / `opacity`. The player window renders from the shared state, so its style must travel with the map; and the DM's own style should persist with the campaign too. The spec also asks for an alignment tool: "drag two corners of one map square to set cell size + offset".

## Decision
- `GridSettings` = `GridGeometry` (`cellSize`, `offsetX`, `offsetY`, map pixels) + `dm: GridStyle` + `player: GridStyle` (`visible`, `color`, `opacity` in 0..1). Both styles live in the map (shared state), not in DM-only UI state, so they persist and export with the campaign and the player never needs a side channel. `MapStage` takes `gridView` and draws exactly one of the two.
- `SCHEMA_VERSION = 3`; `migrateCampaign` gains a v2 → v3 step that copies the flat style into both views (offset/cell size unchanged; a grid already in the new shape passes through). The fallthrough `switch` became an ordered `MIGRATION_STEPS` list because TypeScript's `noFallthroughCasesInSwitch` rejects chained non-empty cases.
- One op, `map/set-grid { id, grid }`, replaces a map's whole `GridSettings`. Partial/nested patch ops were considered and rejected: the settings are a handful of scalars, a full replacement is trivially validated with `isGridSettings`, and every UI control simply spreads the current settings. The reducer deep-copies the payload and is a no-op when nothing changed (`gridSettingsEqual`).
- Alignment maths (`alignGridToSquare`): cell size = mean of the box's width and height (a real square gives equal sides; averaging halves the error of one slightly-off click), offset = the box's top-left corner wrapped into `[0, cellSize)`. Corner order and diagonal do not matter. Boxes under 4 px on a side are rejected rather than producing an absurd grid.
- Interaction is a pure state machine (`map/alignment.ts`) fed with map-pixel pointer events by the canvas, supporting both a drag and two clicks; the click/drag threshold is 6 *screen* pixels so it feels the same at every zoom. The stage exposes a generic `pointerTool` + `overlay` so later tools (fog rectangle/lasso, T007) can reuse the same hook instead of adding event props per tool.

## Consequences
- Documents written by this build are refused by T004 builds (`newer-schema`), as designed; T003/T004 documents migrate on load.
- Any code that read `grid.visible` / `grid.color` / `grid.opacity` must pick a view (`grid.dm` / `grid.player`).
- Later per-view settings (e.g. calibration-locked zoom, T006) follow the same shape: a `dm`/`player` pair on the shared object when the player must know it, DM-only state otherwise.
