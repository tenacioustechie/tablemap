# ADR 0030: Doors can be named by the DM; names never reach the player

Status: accepted. Builds on ADR 0028 (door labels on the DM canvas) and amends ADR 0024 (a door segment gains an optional field). Schema 12.

## Context
ADR 0028 labelled every door `D1`, `D2`, … on the DM canvas. Players asked to name doors themselves ("Vault", "Secret door", "Front gate"), which the numbers cannot do. A name is DM knowledge: "Secret door" on the players' side would give the game away, even though the player window never draws walls.

## Decision
- **A door may carry `name?: string`** (`state/walls.ts`). Absent means unnamed; the canvas then shows `Dn` and the Walls panel "Door n". A stored name is normalized (`normalizeDoorName`: whitespace runs collapsed, trimmed, cut to `DOOR_NAME_MAX_LENGTH`, 40) and never empty, and `isWallSegment` refuses anything else (`isDoorName`), so a loaded or received document cannot hold a blank or untrimmed name. `createDoor` takes an optional name, `patchWall` takes `name: string | null` (`null` or blank removes it; a door turned into a wall loses it), and `wallsEqual` compares it.
- **No new op.** Renaming is a `map/wall-set` of the patched door, like moving an end. It autosaves, exports and imports with the map like every other segment field.
- **Names are stripped from the wire.** `wallForPlayer` drops a door's name; `annotations.ts: sceneForPlayer` applies it to every scene (so snapshots, `campaign/replace` and `map/add` carry no names) and `opForPlayer` to every `map/wall-set`. The player's mirror therefore never holds a name, the same rule as DM-only notes (ADR 0016). Rejected: sending names and relying on the player not to draw them — the data would still sit in the TV window.
- **UI.** Selecting a door (from the Doors list) shows a **Name** field (`door-name-input`, placeholder its `Dn` label) in the Walls panel: the draft commits on Enter or blur as one `map/wall-set` (nothing when unchanged), Esc restores the stored name without deselecting the door. Named doors read "Vault · open" in the list and `Vault` on the canvas tag, which grows to fit (`doorLabelWidth` measures the text).
- **Schema 11 → 12 with no data change**, like v4 → v5: every v11 document is valid v12, and the bump makes an older build refuse a newer document (`newer-schema`) instead of silently dropping the names when it next saves.

## Consequences
- `data-door-labels` on the DM surface is now a JSON array of the shown labels (names can contain commas).
- Tests: `state/walls.test.ts` (normalization, guards, create / patch / equality, `wallForPlayer`), `state/annotations.test.ts` (no name in any scene, snapshot or op the player receives), `state/campaign.test.ts` (v11 → v12), `dm/WallsPanel.test.tsx` (the field's commit, revert and sync), `dm/WallLayer.test.tsx` (named tags and their width), `e2e/walls.spec.ts` (rename, autosave, reload).
