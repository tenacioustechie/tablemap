# Plan: DM usability pass, default splash artwork, map rotation

Written 2026-09-13 after T014 (v1 complete). Backlog tasks T015–T019 implement it, in that order. This document holds the review and the design decisions so the task files can stay short; it is not normative once a task is done — the ADRs, `architecture.md` and the user guide are.

## 1. Review of the DM view as built

The DM view is one 260 px sidebar that stacks seven sections top to bottom (Campaign name, Maps, Grid, Fog of war, Tokens, Annotations, Calibration, Player view) plus a toolbar (player window, blackout, splash, status). Everything works; the problems are all about reach and orientation during a live session:

1. **Scrolling through every tool.** Fog, tokens and notes — the three things a DM touches every minute — sit below the map list, the import form and the blank-map form, and above calibration and splash settings that are touched once per evening. On a laptop screen the sidebar scrolls two to three screens.
2. **The running tool is invisible once scrolled away.** A fog brush stays armed after the panel scrolls out of view; the only cue is the cursor. With tabs this gets worse, not better, unless the toolbar says what is armed.
3. **No panning while a tool is armed.** The stage's drag-pan is off whenever a pointer tool runs (`DmCanvas` → `MapStage` `draggable={interactive && !pointerTool}`), so revealing a big map means Esc, drag, re-arm, repeatedly. Wheel zoom still works.
4. **Everything is mouse-only** except fog undo/redo and Esc. Reveal/hide, brush/rect/lasso, pen/eraser, note and align are all clicks in the sidebar.
5. **Setup-once controls take permanent space**: the blank-map form is always expanded; calibration's TV-size fieldset and the ruler flow are always rendered.
6. **The map cannot be turned**, only the TV. A map scanned or exported sideways has to be fixed in another program, and the TV rotation is the wrong tool for it: it turns the DM's frame of reference with it, and it is forgotten on reload (ADR 0014 lists per-display rotation as a follow-up).
7. **The splash is a plain title card** until the DM picks an image; the product now has artwork for it.

## 2. Target layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ TableMap  DM view  [Open player] [Fullscreen] [Close]  │ [Blackout] │
│ [Show splash]   ● Fog · reveal brush  [Stop (Esc)]   Player: open    │
├─────────────┬────────────────────────────────────────────────────────┤
│ Maps  Fog   │                                                        │
│ Tokens Draw │                     DM canvas                          │
│ Table       │                                                        │
│ ─────────── │                                                        │
│ (panel of   │                                                        │
│  the chosen │                                                        │
│  tab)       │                                                        │
└─────────────┴────────────────────────────────────────────────────────┘
```

Five tabs, grouped by *when* the DM uses them:

| Tab | Contents | Phase |
| --- | --- | --- |
| **Maps** | Campaign name; map list (show / rename / duplicate / delete); import; blank map (collapsed disclosure, T019); **Grid**: align, map rotation (T017), per-view grid style | Prep |
| **Fog** | Fog of war panel as today | Play |
| **Tokens** | Token panel as today | Play |
| **Draw** | Drawings + notes (the Annotations panel) | Play |
| **Table** | Calibration; player view (TV rotation, recentre, splash on switch, splash source) | Setup |

The toolbar keeps the one-click session controls (player window, blackout, splash) and gains a **tool status chip**: the armed tool's name, its shortcut and a Stop button; clicking it opens the tab that owns the tool. Blackout and splash stay in the toolbar on purpose: they must be reachable whatever tab is open.

Switching tabs never disarms a tool: the DM opens Tokens to tweak a badge while the reveal brush stays ready. The chip is what keeps that safe.

## 3. Design decisions

### 3.1 Default splash artwork (T015)
- The artwork lives at `app/src/assets/splash-default.png` (moved from the repo-root `assets/` drop, 1672×941 PNG). It is imported by URL so Vite bundles and hashes it; both windows load it from the same origin. The player never reads storage, so a static asset is the only kind of "default" the render-only rule allows.
- Precedence on the player: the campaign's own image (`splashImageAssetId`) > the campaign-title card when the DM asked for it > the default artwork. The title card is still the placeholder while a chosen image has not arrived over the channel.
- Keeping the title card as an explicit choice needs one boolean in `SharedState` (`splashTitleCard`, default false) → schema v7. Rejected: making the artwork the only fallback (drops a working feature) and a DM-only preference (the splash is campaign content and travels in exports; ADR 0014).
- Not in scope: the DM landing page / campaign manager and the browser favicon. The artwork's wordmark says "DM Map" while the app is called TableMap — worth a decision by the owner, not by a task.

### 3.2 Tabs (T016)
- Pure presentation: no store changes. A `dm/SidebarTabs` component with `role="tablist"`/`role="tab"`, keyboard-navigable, `data-testid="dm-tab-<id>"`. The chosen tab is remembered in `localStorage` (DM-window UI state, like nothing else in the store) and defaults to Maps when the campaign has no maps.
- Inactive tab panels are unmounted. Every tool setting already lives in `DmView` or the store, so tools survive the switch; only transient form drafts (rename box, blank-map fields, TV-size fields) reset, which is acceptable.
- Cost: every e2e spec and DmView-driven unit test that reaches a panel control must open the tab first. One shared helper each (`e2e/helpers.ts` `openTab`, and a test-side helper), applied mechanically.

### 3.3 Map rotation separate from TV rotation (T017)
ADR 0014 rejected rotating the image *inside* the player transform because fog, tokens and annotations are all in map pixels. The right place is one level down: rotation is a **document operation on the scene** that turns every map-pixel thing at once, so both windows keep seeing one consistent coordinate space, and the TV rotation stays a presentation-only quarter turn on top.

- `MapScene.imageRotation: 0 | 90 | 180 | 270` (schema v8) — how far the stored image asset is turned clockwise when drawn. `width`/`height` are always the *turned* size. The original asset is never re-encoded (no lossy round trip, no 8k-pixel canvas in memory).
- Op `map/rotate { id, degrees: 90 | 180 | 270, fogMaskAssetId }` applied by a pure `rotateScene` (`state/sceneRotation.ts`): swaps width/height on a quarter turn, adds to `imageRotation`, turns the grid origin (cell size unchanged), every token's centre, every note, every drawing point and every fog op's shape (`rect`/`rects` corners re-normalised, `circle` centre, `polygon`/`stroke` points; `fill` untouched). Quarter turn clockwise of point p with the old size (W, H): `(x, y) → (H − y, x)`; 180: `(W − x, H − y)`; 270: `(y, W − x)`.
- The fog **base mask** is a bitmap, so the DM side bakes a turned copy on a canvas (as compaction does), stores it as a new `fog-mask` asset, dispatches the op with its id, and deletes the old asset — the same choreography as `map/fog-compact`. Ops in the log are turned in place, so **undo keeps working**; the redo stack is cleared.
- The store drops the pan centre when the active map turns (its coordinates are stale), exactly like a map switch. The DM canvas refits. The player rebuilds its fog canvas because the scene size changed.
- UI: **Map rotation ⟲ / ⟳** in the Grid section of the Maps tab, labelled "Rotate map", deliberately apart from "Rotate player view" in the Table tab; the user guide explains the difference (map = the document, for a sideways scan; player view = which way the TV faces).

### 3.4 Ergonomics (T018)
- Pan while a tool is armed: middle-button drag, or hold **Space** and drag. Implemented in `DmCanvas` as a temporary "pan override" that wins over the tool's pointer handling.
- Single-key shortcuts outside text fields, all documented in a `?` cheat-sheet overlay: tabs `1`–`5`; `V` stop tool; fog `R`/`H` mode, `B` brush, `X` rectangle, `L` lasso, `[`/`]` radius; draw `P` pen, `E` eraser; `N` note; `G` align grid; existing undo/redo/Esc unchanged.
- A pure keymap (`dm/shortcuts.ts`: event → command) keeps the mapping unit-testable and the chip's hints in one place.

### 3.5 Polish (T019)
- Sidebar 300 px, collapsible (button in the tab strip; remembered). Blank-map form behind a "New blank map" disclosure. Toolbar shows the active map's name and a calibration chip ("1 inch · 96 px/in", or "Not calibrated" with a link to the Table tab).
- TV rotation remembered per display, stored next to the display's calibration and applied when the player window reports that display — the follow-up ADR 0014 named.

## 4. Task map

| Task | Depends | Schema | e2e | Why this order |
| --- | --- | --- | --- | --- |
| T015 Default splash artwork | T014 | v7 | yes | Small, independent, fixes schema numbering before T017 |
| T016 Tabbed DM sidebar | T014 | — | yes | Every later UI task places controls in a tab |
| T017 Map rotation | T015, T016 | v8 | yes | Needs the Maps tab and the next schema number |
| T018 Pan while armed + shortcuts | T016 | — | yes | Shortcuts name tabs; the chip shows hints |
| T019 Sidebar/toolbar polish + remembered TV rotation | T016, T017 | — | no | Touches the same tab strip and toolbar last |

## 5. Considered and parked
- A floating tool palette over the canvas instead of tabs: more clicks on the canvas, harder to keep render-only boundaries obvious; tabs are the smaller step and can host a palette later.
- Free-angle map rotation: breaks the grid (cells would no longer be axis-aligned) and the fog rasteriser; quarter turns cover the scan/export case.
- Auto-hiding the sidebar in a "play mode": T019's collapse button plus shortcuts gets most of the benefit without a second UI mode.
