# TableMap — Product Spec

Software for a DM running in-person games on a horizontal TV embedded in a table. DM controls everything from a laptop (Windows/macOS); the TV shows a full-screen player view via HDMI extended display. Physical minis sit on the glass, so the on-screen grid must match real inch/25mm squares.

Non-goals (v1): remote/online play, voice/video, rules automation, character sheets, dice.

## Concepts
- **Campaign**: saved collection of maps + state.
- **Map (Scene)**: background image + grid + fog state + tokens + annotations.
- **DM View**: full editing UI; fogged areas dimmed ~50% so the DM sees everything.
- **Player View**: render-only, chrome-free, full screen; fogged areas fully opaque.

## v1 — Core

### Map management
- Import background image (PNG/JPG/WebP), drag-and-drop. Multiple maps per campaign; instant scene switch (player view pauses/crossfades). Map list with thumbnails; duplicate/rename/delete. Blank gridded map for improvised encounters.

### Grid
- Square grid. Alignment tool: drag two corners of one map square to set cell size + offset. Overlay toggle, opacity/colour per view.
- **Physical calibration**: measure one on-screen square against a ruler (or enter TV diagonal); app computes px/inch so one cell = 1 inch (or 25 mm) on the glass. Locks player-view zoom. Stored per display.

### Fog of war
- New maps fully fogged. Reveal: brush (adjustable radius), rectangle, polygon lasso. Re-hide: same shapes; hide-all/reveal-all. Grid-snapped and freehand modes. Feathered edge (default on). Undo/redo >= 20 steps. Persists per map, autosaved.
- Rendering: DM dimmed, player opaque. Perf: reveal visible on TV <100 ms, 60 fps brush drag.

### Tokens
- Image or coloured-disc tokens, letter/number badges. Sizes 1x1 to 4x4 cells, grid snap toggle. DM drag to move. Per-token hidden flag. Tokens under fog never render on player view.

### Annotations & table tools
- DM-only pinned notes. Ping (animated pulse on player view). Freehand draw layer with per-view visibility. **Blackout** button. Splash/title screen between scenes.

### Player view control
- Pan via viewport rectangle on DM view; zoom locked to calibration with explicit overview override. Rotate in 90-degree steps. Player window opens via window.open, full-screens on the TV, remembers display.

### Persistence
- Autosave locally (IndexedDB). Export/import campaign as one zip (JSON + images) — moves between machines/OSes.

## v2 — Vision & depth
- Dynamic line-of-sight: draw walls/doors; tokens with vision radius auto-reveal. Explored-but-not-visible dim layer. Hex grids. Room click-fill reveal (uses wall data). Initiative tracker. Remote player devices (phones join via LAN) — introduces a lightweight sync server or WebRTC.

Decisions (2026-09-13, `docs/plans/2026-09-v2-vision-and-depth.md`): fog stays an op log and vision commits reveal ops; walls are free segments; vision is per token; hex grids and remote devices are deferred.

### Acceptance criteria (v2 done when...)
1. Draw walls and a door on an imported map in under two minutes; they survive reload and export/import; rotating the map turns them.
2. A token with vision 6 dropped in a room reveals exactly that room on the TV (walls block, radius limits); undo removes the reveal.
3. Opening a door widens what the token sees; closing it does not re-hide what was revealed.
4. On a map using vision, revealed areas no token currently sees are dimmed on the TV; on a manual-fog map nothing is dimmed.
5. Click-fill reveals one walled room and stops at closed doors.
6. An initiative list of five entries advances turn by turn and round by round on the DM and on the TV strip; the current token has a ring.

## v3 — Tiling map builder
Build maps inside the app instead of importing finished images.
- **Tilesets**: import a tileset image, slice by grid (cell size + margin/spacing), name/tag tiles. Ship one CC0 starter set.
- **Layered painting**: floor / walls / props layers; paint, rectangle-fill, bucket-fill; eraser; stamp multi-cell props with rotation/flip.
- **Auto-tiling**: edge-aware tiles (walls, water, cliffs) via standard bitmask/Wang-tile rules so painted regions join up cleanly.
- **Variant randomisation**: scatter random variants within a tile group (e.g. 4 floor textures).
- **Output**: builder scenes are first-class maps — fog, tokens, calibration all work on them directly; optionally bake to PNG for export.
- **Bridge to v2**: wall-layer tiles emit wall segments, feeding line-of-sight for free.

## Acceptance criteria (v1 done when...)
1. Import a map and align a square grid in under a minute.
2. Calibrate so a 1-inch mini fits one cell on the actual TV.
3. Player window full-screens on the TV, shows only revealed areas.
4. Brush fog away, TV updates in real time; undo works.
5. Close everything, reopen — campaign, fog, calibration intact.
6. Export on Windows, import on a MacBook, everything matches.
