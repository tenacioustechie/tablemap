# ADR 0009: Schema version 2 — `MapScene.backgroundColor`

Status: accepted (T004)

## Context
Blank gridded maps (spec: "solid colour, chosen size") need a colour. `MapScene` (schema v1, T003) had `imageAssetId: null` for blank maps but no colour field. ADR 0007 says a breaking document-shape change bumps `SCHEMA_VERSION` and adds a migration step; an optional field would have avoided the bump but left every renderer guessing a default.

## Decision
- `MapScene.backgroundColor: string` (required; CSS colour) painted under the image and filling a blank map. `isMapScene` requires it, and now also requires positive `width`/`height`.
- `SCHEMA_VERSION = 2`. `migrateCampaign` gains its first real step: v1 documents get `backgroundColor: LEGACY_MAP_BACKGROUND` (`#3b3b3b`) on every map, then `schemaVersion = 2`. (No v1 document in the wild has maps, since T003 never created any, but the step keeps the mechanism honest and is unit-tested.)
- `AssetKind` moves from `db.ts` to `model.ts` (re-exported by `db.ts`) because the sync protocol now needs it and must not import the Dexie module.

## Consequences
- Documents written by this build are refused by the T003 build (`newer-schema`), as designed.
- Future additive fields follow the same pattern: bump, add a `case N:` in `migrateCampaign`, test it.
