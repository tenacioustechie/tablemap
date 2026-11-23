# User Guide

TableMap runs a battle map on a TV lying in (or standing beside) your gaming table. You, the DM, work on a laptop: the **DM view** shows the whole map with the fogged parts dimmed and every control. A second browser window, the **player view**, full-screens on the TV and shows only what you have revealed, at true scale, so a mini on a 1-inch base fills exactly one grid cell. There is no server and no account: everything is stored on your computer, in the desktop app or your browser.

1. [Setting up the TV](#1-setting-up-the-tv)
2. [Importing a map and aligning the grid](#2-importing-a-map-and-aligning-the-grid)
3. [Calibrating to real-world inches](#3-calibrating-to-real-world-inches)
4. [Running fog of war during a session](#4-running-fog-of-war-during-a-session)
5. [Positioning the player view, blackout and splash](#5-positioning-the-player-view-blackout-and-splash)
6. [Tokens](#6-tokens)
7. [Walls, vision and initiative](#7-walls-vision-and-initiative)
8. [Notes, drawings and pings](#8-notes-drawings-and-pings)
9. [Saving, backing up, and moving campaigns between computers](#9-saving-backing-up-and-moving-campaigns-between-computers)
10. [Troubleshooting and reference](#10-troubleshooting-and-reference)

## Quick start: from a clean clone to a fogged map on the TV

Ten minutes, start to finish. Each step points at the section that explains it fully.

### What you need
- A laptop running Windows or macOS for the desktop app; or Windows, macOS or Linux with [Node.js](https://nodejs.org) 20 or newer (the project is developed on Node 22) and git to run it from the source code.
- From the source code, a current browser: Chrome, Edge or Firefox. TableMap is tested in Chromium. Both windows must run in the **same browser and the same profile** (not one normal and one private window).
- A TV connected over HDMI as a second, **extended** display.
- A map image (PNG, JPEG or WebP). The repository ships one with a printed grid for trying things out: `app/e2e/fixtures/grid-map.png`.

### Install and start
**Easiest: the desktop app.** Download the installer for your computer from the project's GitHub **Releases** page and install it (*Installing the desktop app* in section 10 has the one extra click Windows and macOS ask for on first launch). It opens straight on the campaign manager; skip to *The DM view at a glance*. Everything in this guide works the same in the desktop app; the player window is a second app window you drag to the TV.

**From the source code**, with Node.js and git:
```bash
git clone <this repository>
cd tablemap/app
npm install
npm run dev
```
Open the address Vite prints, normally `http://localhost:5173/`. That page is the campaign manager. (TableMap is a single page with three hash routes: `#/` the campaign manager, `#/dm` the DM view, `#/player` the player view. You never type the last one: the DM view opens it for you.)

### The DM view at a glance
The DM view is three things. Across the top, a **toolbar**: the player window buttons (**Open player view**, **Fullscreen player view**, **Close player view**), then **Blackout**, **Show splash** and **Turn strip** (the initiative order along the top of the TV, section 7), then the name of the map the TV is showing ("No map shown" until there is one) and a chip with the TV's calibration ("1 inch = 96 px/in", or "Not calibrated"; click it to jump to the **Table** tab), then, whenever a canvas tool is armed, a yellow chip naming it (for example "Fog · reveal brush") with a **Stop (Esc)** button, and at the right the player window's status. Down the left, a **sidebar with seven tabs**, grouped by when you use them: **Maps** (campaign name, map list, import, blank maps, grid), **Fog**, **Tokens**, **Turns** (initiative), **Draw** (drawings and notes), **Walls** (walls and doors), and **Table** (TV calibration and the player view). One tab's controls are shown at a time; click a tab, or press **←** / **→** with a tab focused. The **«** button at the left of the tab strip folds the sidebar down to a narrow strip of tab initials so the canvas gets the room; click **»**, or any of the letters, to open it again. The tab you were on, and whether the sidebar was folded, are remembered on this computer. The rest of the window is the **DM canvas**: the map, dimmed where it is fogged, with a blue rectangle showing what the TV sees.

Tools are armed from their tab and used on the canvas. **Changing to another tab puts the tool down**, so a fog brush or the door tool never lingers on the map while you work in another panel; its settings (mode, brush size, snapping) are kept, so arming it again is one click or key. The chip in the toolbar shows what is armed; click **Stop** (or press **Esc**) to put the tool down, or, with the sidebar folded, click the chip's name to open the tool's tab again.

Almost everything has a single-key shortcut, and the chip shows the key of the armed tool. Press **?** (or click the **?** button in the toolbar) for the cheat sheet: the keys and the mouse gestures on one card, closed with **Esc**. The full list is in section 10. Keys do nothing while you are typing in a text field.

### Ten steps to a fogged map on the TV
1. **Create a campaign.** Type a name and click **Create campaign**. The DM view opens: the toolbar, the sidebar on its **Maps** tab, and a dark canvas that says the campaign has no maps yet.
2. **Import a map.** Drag your image from the file manager anywhere onto the DM view (a "Drop image to import a map" banner appears), or click **Import image** on the **Maps** tab. The map appears on the canvas, dimmed: every new map starts completely fogged. Scroll to zoom, drag to pan, **Fit** to see it all. (Section 2.)
3. **Open the player view.** Click **Open player view** in the toolbar. A chrome-less window opens, entirely black: that is the fogged map. The toolbar now says "Player view: open".
4. **Put it on the TV.** Drag the player window onto the TV and click **Fullscreen player view**. If the toolbar answers "Browser blocked fullscreen from here. Press F in the player window.", click once inside the player window and press **F** (or double-click it). (Section 1.)
5. **Align the grid.** On the **Maps** tab, under **Grid**, click **Align grid…** (the toolbar chip says "Align grid"), then on the DM canvas drag from one corner of a printed square to the opposite corner. The grid snaps to the printed squares; **Cell size (px)** shows the size it found. (Section 2.)
6. **Calibrate the TV.** Open the **Table** tab. **Calibration** now reports the TV, for example "Player display 3840×2160". Either click **Calibrate with a ruler…**, hold a ruler against the TV and grow or shrink the white square until it is exactly one inch, then save; or type the TV's diagonal in inches and click **Use TV size**. From now on one cell on the TV is one inch. (Section 3.)
7. **Reveal the first room.** Open the **Fog** tab; **Reveal** is already selected. Click **Rectangle** (the chip says "Fog · reveal rectangle") and drag a box over the first room on the DM canvas. The moment you let go, that room appears on the TV; everything else stays black. **Brush** paints freehand, **Lasso** draws an outline; **Undo** (Ctrl+Z, Cmd+Z on a Mac) takes any of it back. (Section 4.)
8. **Choose what the TV shows.** The TV cannot show a whole large map at one inch per cell. Drag the blue **Player view** rectangle on the DM canvas to pan the TV; **Recentre player view** on the **Table** tab puts it back in the middle. (Section 5.)
9. **Play.** **Add token** on the **Tokens** tab drops a numbered disc in the middle of the TV area; drag it around. **Blackout** in the toolbar blanks the TV instantly while you set up the next scene. Alt-click the map to ping a spot. (Sections 5, 6 and 8.)
10. **Stop whenever you like.** There is no save button: every change is stored in the browser as you make it. Close both windows; next time, `npm run dev`, open the page, click **Open** on the campaign, and open the player view again. The map, fog, tokens, and the TV's calibration and rotation are all still there. Before you clear browser data or move to another computer, click **Export** next to the campaign on the first page and keep the zip. (Section 9.)

### Five more steps: walls, vision and turns
Once a map is on the TV, five more minutes set up a room the tokens explore by themselves and a fight the players can follow. Section 7 explains every step fully.

11. **Wall a room.** Open the **Walls** tab and click **Wall** (or press **W**). On the DM canvas click the room's corners one after another, starting at one side of the doorway and going round to the other, then press **Esc**. Click **Door** (or press **D**) and drag across the doorway. The TV shows none of it.
12. **Let a token see.** On the **Tokens** tab, drag a token into the room and type 6 into **Vision (cells)**: exactly that room appears on the TV, the walls hiding the rest. From now on, while you drag the token your canvas previews what it would see, and when you let go the TV shows it. **Undo** takes a reveal back.
13. **Open the door.** Click the door on the DM canvas: the token looks through it at once and the TV shows what lies beyond. Click it again to close it: nothing goes back under the fog, but what no token sees any more is dimmed on the TV.
14. **Reveal a room nobody is in.** On the **Fog** tab click **Fill** (or press **F**) and click inside a walled room: every cell up to its walls and closed doors appears on the TV in one go.
15. **Run the fight.** On the **Turns** tab type each combatant's **Name** and **Initiative** and click **Add** (or pick a token from **Add from token…**), then click **Sort**. Click **Turn strip** in the toolbar to show the order along the top of the TV, and **Next** to move the turn: the current name lights up on both screens and the token whose turn it is gets a gold ring.

## 1. Setting up the TV

1. Connect the TV over HDMI and set it as an **extended** display (not mirrored) in your OS display settings.
2. Open TableMap in your browser. The first page lists your campaigns: pick one and click **Open**, or type a name and click **Create campaign**. (**Open DM view** at the bottom, or going straight to `#/dm`, resumes the last campaign you had open; the very first time it creates "Untitled campaign" for you.)
3. In the DM view toolbar click **Open player view**. A separate chrome-less window opens showing the player view (black until a map is loaded). The toolbar status changes to "Player view: open".
4. Drag the player window onto the TV.
5. Click **Fullscreen player view**. If your browser refuses to full-screen a window from another window, the DM view shows a hint: click into the player window and press **F** (or double-click it). Press **F** again, or **Esc**, to leave fullscreen.
6. **Close player view** closes the window from the DM side. Clicking **Open player view** while it is already open just brings it to the front.

The player window never shows any DM controls; everything is driven from the DM view.

If the TV is mounted the other way round from your laptop, turn the player view a quarter turn at a time on the **Table** tab (section 5). TableMap remembers that turn for that TV on this computer, like its calibration: the next time the player window opens on it, it comes back turned the same way, while any other display starts unturned.

### How the two windows stay in sync

The DM window holds the state; the player window only mirrors it. Whatever you change in the DM view appears on the player screen immediately, with no save step. If the player window is closed, reloaded, or opened before the DM view, it asks the DM window for the current state as soon as both are open, so you never need to redo anything to bring it back up to date. Both windows must be open in the same browser on the same computer (the TV is just an extra display).

To try it: type a **Campaign name** on the **Maps** tab of the DM sidebar. While no map is loaded, the player screen shows that name as a dim title; clear the field and the player screen goes back to plain black.

## 2. Importing a map and aligning the grid

### Importing a map image
Drag a PNG, JPEG or WebP file from your file manager anywhere onto the DM view (a "Drop image to import a map" banner appears while you hold it there), or use **Import image** on the **Maps** tab of the sidebar to pick one or more files. Each file becomes a map named after the file, appears in the map list with a thumbnail, and is shown straight away on the DM canvas and on the player screen. Other file types are refused with a message under the picker. Imported images are stored in the browser alongside the campaign, so they are still there after a reload.

### Blank gridded maps
For an improvised encounter, click **New blank map** under the map list on the **Maps** tab to unfold the form (it stays folded until you need it, so the map list keeps the room): give it a name, choose the size in **Columns** and **Rows**, the **Cell size** in pixels (this is also the grid size), and a background **Colour**, then click **Create blank map**. It becomes the active map immediately.

### The map list
The **Maps** tab lists every map in the campaign; the highlighted one is what the player screen shows.
- **Show** makes a map the active scene. The player screen switches at once (images the player has already received switch instantly).
- **Rename** edits the name in place (**Save** / **Cancel**).
- **Duplicate** inserts a copy right after the original, named "… (copy)", and shows it. The copy shares the image but has its own fog and tokens.
- **Delete**, then **Confirm delete**, removes the map. If it was the one being shown, the player screen goes back to the campaign title until you show another map.

### Looking around on the DM canvas
The DM canvas shows the active map. Scroll the mouse wheel to zoom around the pointer and drag to pan. While a tool is armed a plain drag belongs to the tool, so pan by **holding Space and dragging** (the cursor becomes a hand) or by **dragging with the middle mouse button**; the tool stays armed and carries on the moment you let go. The zoom level is shown bottom-right; **Fit** brings the whole map back into view. The player screen is not affected: until you calibrate (section 3) it shows the whole map fitted to the TV; once calibrated its zoom is locked so that one cell is one real inch, and you choose which part of the map the TV shows by dragging the blue **Player view** rectangle (section 5).

### Aligning the grid
Every map starts with a 70-pixel grid at the top-left corner (blank maps use the cell size you chose, so they are already aligned). For an imported image the grid usually needs to be matched to the squares printed on the map. The **Grid** section at the bottom of the **Maps** tab does this for the map currently shown.

1. Zoom in on the DM canvas (mouse wheel) until one printed square is comfortably large.
2. Click **Align grid…** (or press **G**). The cursor becomes a crosshair, a hint appears over the canvas and the toolbar chip says "Align grid".
3. Either **drag** from one corner of a printed square to the diagonally opposite corner, or **click** one corner and then **click** the opposite corner. Any square anywhere on the map will do, and any diagonal.
4. The grid snaps to that square: the cell size becomes the square's size and the grid lines shift to run through its corners. The tool switches itself off. Press **Esc** (or **Cancel alignment**) to leave the tool without changing anything.

If the box you drew is only a few pixels across, the tool says so and lets you try again. For fine tuning, or for maps where you already know the numbers, edit **Cell size (px)**, **Offset X (px)** and **Offset Y (px)** directly; the canvas updates as you type.

### Turning a sideways map
Some maps come scanned or exported on their side. Fix that in the map itself, not on the TV: in the **Grid** section of the **Maps** tab, **Map rotation** has **⟲ 90°** and **⟳ 90°** buttons with the current value between them. Each click turns the map a quarter turn, and *everything on it turns together*: the picture, the grid, the fog you have revealed, the tokens, the walls and doors, your notes and drawings. Both your canvas and the player screen show the turned map at once, the canvas refits to the new shape, and the grid fields update to the turned grid (the cell size stays the same). The original image file is kept as it was; only how far it is turned is saved with the map, so turning costs nothing and can be undone by turning back. Four quarter turns bring the map back exactly.

If a fog tool, the pen or another canvas tool is armed when you turn the map, it is put down first. Fog **Undo** still works after a turn (the changes were turned with the map), but anything you had undone and could have redone is forgotten, as after any new change. The buttons are briefly unavailable while a map with a long fog history is turned (its saved fog picture is being turned too).

This is different from rotating the *player view* (section 5): that turns only what the TV shows, to match which way the TV faces, and leaves the map itself as it is.

### Grid appearance, per screen
The grid can look different on your laptop and on the table. The **DM view** and **Player view** boxes in the Grid section each have their own **Show grid** switch, **Colour** and **Opacity**. A common setup is a bright, fairly opaque grid on the DM view for placing things precisely, and a faint (or hidden) grid on the player screen when the printed map already has one. The cell size and offset are shared: only the look differs.

All grid settings, and the map's rotation, belong to the map, are saved with the campaign and reach the player screen immediately.

### Walls and doors
A map can also carry **walls** and **doors** that follow the rooms printed on it. They block what tokens with vision can see and bound the fog **Fill** tool; they are never shown on the TV, and turning the map (above) turns them with it. Draw them from the **Walls** tab once the grid is aligned, so they snap to its corners: section 7 explains how.

## 3. Calibrating to real-world inches

Once the grid is aligned to the map's squares, calibration makes each of those squares exactly one inch (or 25 mm) on the glass, so a mini on a 1-inch base fills one cell. Calibration belongs to the TV, not to the campaign: do it once per display and every map in every campaign uses it.

### Before you start
Open the player view, move it onto the TV and full-screen it (section 1). The **Calibration** section on the **Table** tab of the DM sidebar reports the display the player window is on (for example "Player display 3840×2160") and whether it is calibrated. If it still says to open the player view, the player window has not connected yet; if it reports your laptop's size, the window has not been moved to the TV yet (it notices within a second of being moved).

Choose what one cell should be: **1 inch** (standard 25.4 mm bases) or **25 mm**. This applies to every display.

### Method A: with a ruler (most accurate)
1. Click **Calibrate with a ruler…**. The player screen replaces the map with a white square.
2. Hold a ruler against the TV and measure the square. Use **+1 / −1 / +10 / −10** (or type a **Square size**) until it is exactly 1 inch (or 25 mm) wide. The square resizes on the TV as you click.
3. Click **It measures 1 inch: save**. The map comes back on the player screen at the calibrated scale.

**Cancel** leaves the ruler screen without changing anything.

### Method B: from the TV's size
If you know the TV's diagonal (the advertised size, e.g. 43") and its native resolution (e.g. 3840 × 2160; the fields are prefilled with what the player window reports), type them under **Or enter the TV size** and click **Use TV size**. This is quick and usually within a percent or two; check with a mini and switch to the ruler if it looks off. Once the display is calibrated these fields fold away under **Recalibrate from the TV size**; click it to type new numbers.

### What calibration does
- The player screen's zoom is locked: whatever the map image's resolution, one grid cell is drawn at the calibrated size. The map starts centred; large maps overflow the TV, so you pan the player view around them by dragging the blue rectangle on the DM canvas (section 5).
- The DM canvas is unaffected; zoom and pan it freely.
- The calibration is saved on this computer for that display. Close everything, reopen, open the player view on the same TV, and it applies again automatically. A different TV (or a rearranged display layout) starts uncalibrated until you calibrate it too; the panel always shows which display it is talking about. **Clear calibration** forgets the current display's value (not its player view rotation, section 5). The chip in the toolbar shows the state at a glance whatever tab you are on: "1 inch = 96 px/in" once calibrated, "Not calibrated" otherwise.

### Overview mode
When you need the players to see the whole map at once (a big battle map, or a splash of the region), tick **Overview: fit the whole map (not to scale)**. The player screen fits the entire map to the TV and shows a small "Overview: not to scale" badge in the corner so nobody measures movement against it. Untick it to return to true scale. Overview is only available once the display is calibrated, and it is not remembered between sessions.

## 4. Running fog of war during a session

Every map starts completely fogged: the player screen shows solid black where the map is, while the DM canvas shows the whole map with the fogged parts dimmed to half brightness, so you always see what the players cannot. The **Fog** tab of the sidebar works on the map currently shown. (Tokens with vision reveal fog by themselves, and the **Fill** tool reveals a walled room in one click: both are in section 7.)

### Revealing and hiding areas
Pick what you want to do and what to do it with:

- **Reveal** / **Hide** — whether the tool clears fog or puts it back. Everything below works the same way in both.
- **Brush** — paint over the map. The **Brush radius** slider sets the size (in map pixels, so it zooms with the map); a single click paints one dot. While you drag, the map shows through under the brush on the DM canvas; when you let go the stroke is applied and the TV shows it at the same moment.
- **Rectangle** — drag across the area. Tiny drags (a click) do nothing.
- **Lasso** — drag around the area; letting go closes the shape.
- **Fill** — click inside a room: every grid cell up to its walls and closed doors, in one go (section 7, *Filling a room*).

Clicking a tool turns it on: the cursor becomes a crosshair, a hint appears over the canvas and the toolbar chip names what is armed, for example "Fog · reveal brush" or "Fog · hide rectangle". The tool stays on, so you can keep painting, until you put it down: press **Esc**, click **Stop** (in the panel or in the chip), click the highlighted tool again, or open another tab (say **Tokens**, to rename a token mid-fight); Esc in the middle of a drag abandons that stroke only. Coming back to **Fog**, the tool is off but your mode, brush size and snapping are as you left them: one click or key (**B**, **X**, …) arms it again. Zooming and panning the DM canvas does not affect what is revealed; shapes are in map pixels, so work at whatever zoom is comfortable. To pan while a tool is armed, hold **Space** and drag, or drag with the middle mouse button (section 2); the tool never sees that drag.

The keyboard is faster mid-session: **R** and **H** choose reveal or hide, **B**, **X**, **L** and **F** the brush, rectangle, lasso or fill, **[** and **]** shrink or grow the brush, **V** puts the tool down. Any fog key arms the tool with the current settings and opens the **Fog** tab if you are elsewhere; the chip shows the key of whatever is armed. **?** shows every shortcut.

Two options apply to the brush, the rectangle and the lasso (the fill always works in whole cells with hard edges, whatever they say):

- **Feathered edges** (on by default) softens the boundary of every reveal or hide over roughly a third of a cell, so rooms fade into darkness instead of ending in a razor line. Turn it off for hard edges.
- **Snap to grid (whole cells)** expands whatever you draw to the grid cells it touches, so a rough brush sweep or a sloppy rectangle reveals exactly whole squares. Snapped shapes always have hard edges. It uses the map's grid as aligned in section 2.

### Undo and redo
**Undo** takes back the last fog change on the map currently shown — a stroke, a rectangle, a lasso, a room fill, a hide all / reveal all, or what a token's vision revealed (section 7) — and **Redo** puts it back. The keyboard works too: **Ctrl+Z** (Cmd+Z on a Mac) to undo, **Ctrl+Shift+Z** or **Ctrl+Y** to redo, as long as you are not typing in a text field. The TV follows every step. Making a new change after undoing discards what could have been redone, as in any editor.

You can undo at least the last twenty changes on a map; usually far more. Once TableMap has folded old changes into the map's saved mask (see below) those particular changes can no longer be undone.

### Hide all / reveal all
**Hide all** puts the whole map back under fog; **Reveal all** removes all of it (useful for a social scene, or to show an overview and then hide it again). Both take effect on the TV immediately, and both can be undone.

### What is remembered
Fog belongs to the map. Switching to another map shows *that* map's fog (a new map is fully fogged); switching back brings the first map's fog back exactly as it was. Fog is saved with the campaign like everything else: reload, reopen, or open the campaign next week and it is where you left it. Duplicating a map copies its fog too.

The panel shows how many fog changes the map is carrying since it was last saved as an image. TableMap folds long histories into a saved mask image automatically ("on a saved mask" appears after the count); you never need to do anything about it, and nothing visible changes when it happens — it always leaves the most recent changes undoable.

If the player window is opened or reloaded mid-session it shows the current fog straight away. While a map's saved mask is still on its way to a freshly opened player window, that map is shown fully fogged there rather than partly revealed, so nothing leaks.

## 5. Positioning the player view, blackout and splash

### The player view rectangle
The DM canvas always shows a blue **Player view** rectangle: exactly the part of the map the TV is showing. A thick white bar on one of its edges marks the edge that is at the top of the TV. The **Player view** section on the **Table** tab tells you what the rectangle is doing.

- Once the display is calibrated (section 3), the rectangle has a solid outline and you can **drag it** to pan the player view; the TV follows as you drag. It cannot leave the map entirely: its centre stays on the map. Switching to another map puts the rectangle back in the middle of that map, and **Recentre player view** does the same on demand. Tokens inside the rectangle are still tokens: a drag that starts on one moves the token (section 6), a drag anywhere else inside the rectangle pans the player view.
- Until the display is calibrated, or while **Overview** is ticked, the TV shows the whole map, so there is nothing to pan: the rectangle is a dashed outline that simply shows how the map fits.
- While a canvas tool is running (grid alignment, a fog tool, the pen or the note tool — the toolbar chip shows which) the rectangle cannot be dragged, so the tool gets every click; press Esc or click **Stop** in the chip first.
- The rectangle's size assumes the player window fills its display. Before a player window has connected, a 1920×1080 TV is assumed; the panel says so.

### Rotating the player view
Players sit on every side of the table, and the TV may be mounted the other way round from your laptop. **⟲ 90°** and **⟳ 90°** in the **Player view** section of the **Table** tab turn the player screen a quarter turn at a time (the current rotation is shown between them). Rotation never changes the scale: a calibrated cell is still one inch on the glass, only the map is turned. The campaign title and the splash turn with it so they read the right way up for the players. With an uncalibrated display the map is refitted to the turned screen, so a wide map turned on its side fits the TV's height instead. The rotation is remembered on this computer for that display, like the calibration: reopen the player view on the same TV and it comes back turned the same way, while a different display starts at 0°. Clearing the calibration does not reset it, and it is not part of an export. (A turn made before the player window has connected is replaced by the display's remembered turn when it does.)

**Which rotation to use.** There are two, and they do different jobs:
- **Map rotation** (**Maps** tab, Grid section, "Rotate map …"; section 2) turns the map itself: the picture, grid, fog, tokens and notes, on your canvas *and* on the TV. Use it when the map was scanned or exported on its side. It is saved with the map and applies to that map only.
- **Player view rotation** (**Table** tab, Player view section, "Rotate player view …"; this section) turns only the TV's picture, of every map, to match which way the TV faces and where the players sit. Your canvas is not turned. It is saved for that display on this computer, not with the campaign.

They add up: a map turned once on the Maps tab and a player view turned once on the Table tab shows the map turned twice on the TV and once on your canvas. If the TV picture is fine but your canvas looks sideways, it is the map that needs turning; if the map looks right on your canvas but wrong on the TV, it is the player view.

### Blackout
**Blackout** in the toolbar turns the player screen solid black at once, whatever it was showing: map, fog, splash, turn strip or ruler screen, and whatever tab the sidebar is on. Use it when you need to move things behind the scenes or take a break. Click **End blackout** to bring the picture back exactly as it was. The button stays highlighted while the blackout is on.

### Splash
**Show splash** in the toolbar covers the player screen with a splash, on demand, until you click **Hide splash**. Out of the box the splash is TableMap's own artwork, letterboxed on black. Under **When no splash image is chosen** in the **Player view** section of the **Table** tab you can pick **Campaign title** instead, which shows the **Campaign name** in large type; **Default artwork** goes back to the artwork. To use your own picture, pick a PNG, JPEG or WebP under **Splash image**; it is shown letterboxed on black and takes precedence over both choices. The thumbnail in the panel always shows what the players will see. **Remove splash image** drops your picture and returns to whichever choice is selected. The splash image and the choice are saved with the campaign; the artwork itself is part of the app, so it never needs to be exported.

Tick **Show splash when switching maps** and every time you show another map the splash goes up over it, so you can position the player view and reveal the first rooms before anybody sees the new scene; click **Hide splash** when you are ready. Leave it unticked for instant scene switches (the default).

If the splash and a blackout are both on, the blackout wins; the splash is still there when the blackout ends. The ruler calibration screen also takes precedence over the splash while it is showing.

## 6. Tokens

Tokens mark where creatures and objects are on the map: coloured discs with a short badge (a letter or number), or round-cropped pictures. They belong to the map, are saved with the campaign and appear on the TV immediately. The **Tokens** tab of the sidebar works on the map currently shown.

### Adding tokens
- **Add token** puts a new disc in the middle of what the TV is showing (the middle of the map until you have calibrated and panned). Each new token gets the next number as its badge and name ("Token 3", badge "3") and the next colour from a small palette; change any of that in the editor below the list.
- **Add image token** asks for a PNG, JPEG or WebP file and makes a token showing that picture, cropped to a circle. Other file types are refused with a message. The picture is stored with the campaign.

The new token is selected straight away, so you can edit it or drag it into place.

### Moving tokens
Drag a token on the DM canvas. With **Snap to grid** on (the default) it jumps from cell to cell as you drag and always lands exactly on whole cells, whatever its size; turn snapping off for a token to put it anywhere. A token cannot be dragged off the map entirely: its centre stays on the map. Dragging is only possible while no canvas tool is running (the toolbar chip shows one if there is), so that those tools get every click; press **Esc** or **Stop** first. Holding **Space** pans the canvas instead of moving a token, whatever is under the pointer. The tool does not stop just because you opened the **Tokens** tab. Tokens standing inside the blue player view rectangle (section 5) can be dragged like any other: the token wins over the rectangle where they overlap. A token with vision shows what it would see while you drag it and reveals that when you let go (section 7, *Vision: tokens that see*).

### Editing a token
Click a token on the canvas, or its entry in the list, to select it (a blue box marks it on the canvas; click the list entry again, or **Done**, to deselect). The editor shows:
- **Name** — for your own reference in the list.
- **Badge** — up to three characters drawn on the token (empty for none). On picture tokens it sits in a small corner pill.
- **Colour** — for disc tokens.
- **Size** — 1×1 to 4×4 cells. A snapping token stays aligned with the grid when you resize it.
- **Vision (cells)** — how far the token can see, in whole grid cells: 0 (the default) means no vision, and the field goes up to 60. Decimals are rounded to whole cells. A hidden token keeps its vision: it still sees, and you decide what that reveals. Dropping a token with vision reveals what it can see, walls and closed doors blocking, and typing a vision above 0 reveals it from where the token stands (section 7, *Vision: tokens that see*). The vision is saved with the map and kept in exports.
- **Snap to grid** — see above. Turning it on snaps the token to the nearest cell at once.
- **Hidden from players** — the token is only ever shown on your canvas (dimmed, with a dashed ring) until you untick it. Use it for the ambush waiting behind the door.
- **Remove token** — deletes it (and its picture, if no other token uses it).

### What the players see
The TV shows a token only when **every cell it stands on has been revealed** and it is not hidden. A token standing in fog is simply not there on the player screen — not dimmed, not outlined — and appears the moment you reveal its last fogged cell; hide the cell again (or undo the reveal) and it disappears again. On your canvas such tokens stay visible, dimmed by the fog like the map under them, with a thin dashed box as a reminder that the players cannot see them. A large token half inside a revealed room is still hidden until the whole of it is in the light, so nothing gives its position away.

Duplicating a map copies its tokens; switching maps shows each map's own tokens. To let tokens reveal what they see, and to put them in a turn order, see section 7.

## 7. Walls, vision and initiative

Three tools for a dungeon crawl and the fights in it, all on the map you have already imported, aligned and calibrated. **Walls and doors** trace the rooms printed on the map. **Vision** lets a token reveal what it can see whenever you move it, so you stop painting fog by hand, and the TV dims what the party saw earlier but cannot see now. **Initiative** keeps the turn order on your laptop and, if you like, along the top edge of the TV, with a gold ring round the token whose turn it is. Each works on its own: walls without vision still bound the **Fill** tool, vision without walls reveals a plain circle, and the turn order needs neither. The TV never shows a wall, a door or a vision radius, only what they reveal.

### Drawing walls and doors
Walls and doors are straight segments, at any angle, that follow the walls printed on the map. They block line-of-sight vision: a token with vision sees up to the walls, and through a door while it is open (*Vision: tokens that see*, below). They also bound the fog **Fill** tool, which reveals a walled room in one click (*Filling a room*, below). On your canvas walls are drawn as orange lines and doors in green: a closed door is a solid bar across the doorway, an open one a thin line swung open (*Doors during play*, below). **They are never shown on the player screen.** Walls belong to the map: they are saved with the campaign, they are in every export, a duplicated map gets a copy, and turning the map (section 2) turns them with it.

Draw them from the **Walls** tab (or press **5**):

1. Click **Wall** (or press **W**). The toolbar chip says "Walls · wall" and the cursor becomes a crosshair. Click each corner of the wall in turn: the first click starts it, every click after that adds one straight segment from the previous corner, so a closed room is five clicks (the last one back on the first corner). A ring under the pointer shows where the next click will land. **Double-click** the last corner, or press **Esc**, to finish; nothing is left half-drawn, because a segment only exists once both its ends are placed. The tool stays on for the next wall; press **Esc** again (or **Stop**) to put it down. You can also press and drag to draw a single segment.
2. Click **Door** (or press **D**) and drag across the doorway: letting go adds a closed door there. A door is only ever one segment. **Leave the doorway out of the wall**: start the room's wall at one side of the doorway and end it at the other. A wall drawn across the doorway as well blocks sight and the fill even while the door is open.
3. **Snap to grid** is on by default: any click or drag end within a finger's width of a grid corner lands exactly on that corner, so walls that follow the printed grid line up perfectly. Hold **Shift** while clicking to place that point exactly where the pointer is (a diagonal wall, a doorway mid-cell), or untick the box to stop snapping altogether.

Every door is labelled on your canvas with a small green tag, **D1**, **D2** and so on, just beside the doorway; the number is the same as in the tab's **Doors** list ("Door 1", "Door 2", …), so you can tell at a glance which door is which. The tags are only on your canvas, never on the TV, and they never get in the way of a click on the door. Delete a door and the others are renumbered to match the list.

**Naming a door.** Click the door's name in the **Doors** list to select it; a **Name** box appears under it in the tab. Type a name, say "Vault" or "Secret door", and press **Enter** (or click anywhere else). The tag on the canvas and the list now say "Vault" instead of "D2" and "Door 2". Press **Esc** while typing to cancel. To go back to the number, empty the box and press **Enter**. Names are up to 40 characters, are saved with the map, and are never sent to the player screen, so "Secret door" stays your secret.

The Walls tab shows how many walls and doors the map has. To change a wall, put every tool down first (**Esc** or **V**), then click it on the canvas: it lights up, the tab says what it is and how long it is in cells, and a handle appears at each end. A click on a door opens or closes it instead (below), so to change a door click its name in the tab's **Doors** list: the canvas centres on it and it is selected the same way. Drag a handle to move that end (it snaps like a drawn point; hold **Shift** to skip). Press **Delete** (or **Backspace**, or click **Delete (Del)** in the tab) to remove it; **Esc**, or opening another tab, just deselects. **Clear walls** (then **Confirm clear walls**) removes all of them.

**Wall edits cannot be undone.** Undo applies to fog only; delete or redraw a segment instead. Switching to another map puts the wall tools down. Opening and closing a door is not an edit and has no undo either: see *Doors during play* below.

### Doors during play
The doors you drew open and close with a click on the canvas, whichever tab is open and whether or not a tool is armed. With the reveal brush in your hand, click the door itself: it swings open. Click it again and it closes. The click only works the door: the brush paints nothing and stays armed, the pen draws nothing, a note waiting to be pinned keeps waiting. The pointer becomes a hand over a door. The exceptions are the tools that click on grid corners, where doors end: while you are drawing walls or doors, or aligning the grid, a click there belongs to that tool (put it down with **Esc** first). A **Space**-drag still pans and an **Alt**-click still pings, door or not.

On your canvas a closed door is a solid green bar across the doorway; an open door is a thin green line swung 45° off the doorway, with a faint dashed line where the door stood. The **Walls** tab lists the map's doors as "Door 1 · closed", "Door 2 · open" and so on, each with an **Open** or **Close** button; the list and the canvas always agree. Click a door's name to select it and centre the canvas on it: that is also how you pick a door to move its ends or delete it, because a click on the door itself opens it.

The TV never shows walls or doors themselves. What a door changes is what tokens with vision can see: opening one lets every seeing token on the map look through it at once, and closing it hides nothing that was already revealed (see *Vision: tokens that see* below). A door's state belongs to the map like everything else: reload, reopen the campaign, or import a backup and every door is open or closed as you left it. Opening and closing doors is not part of the fog undo history.

### Vision: tokens that see
A token whose **Vision (cells)** is above 0 (the token editor, section 6) reveals what it can see: everything within that many grid cells of its centre that no wall or closed door hides (draw the walls first, above; with none, a token reveals a plain circle). You never paint it yourself. It happens when you:

- **Drop the token.** While you drag a token with vision, your canvas shows what it would see from the cell under it: the fog clears there, under a yellow tint with a dashed outline, and follows the token from cell to cell. Nothing reaches the TV while you drag. Let go, and exactly that area is revealed on the TV. A token without vision shows no outline and reveals nothing.
- **Give a token vision.** Typing a vision above 0 into the editor reveals what the token sees from where it stands, straight away.
- **Open or close a door.** Every token on the map with vision looks again at once, so opening a door reveals what lies beyond it. Closing a door never hides anything again: fog only comes back when you hide it yourself.

What vision reveals is an ordinary fog change with the usual feathered edge, so everything in section 4 applies to it. **Undo** (Ctrl+Z) takes back the last reveal and the TV follows; a door opening or closing is one undo step, however many tokens looked again. The **Hide** tools work on top of it, and it is saved with the map. Hidden tokens see too: a scout you hide from the players still reveals what it sees, so leave its vision at 0 if that would give it away. Switching maps or reopening the campaign reveals nothing new, because what was seen is already in the fog. When a token's view is already on the map exactly as it would reveal it (you dropped it back where it stood, or toggled a door it cannot see), nothing is added, so undo is not cluttered with steps that change nothing.

### What the players see with vision on
On a map that uses vision, the TV shows three kinds of ground:

- **What your tokens see right now** is at full brightness: everything any token with vision can see from where it stands. A hidden token's view counts too.
- **What was seen before but no token sees now** stays on the TV, dimmed to a darker shade: the room the party just left, or the corridor behind a door that has closed. Nothing goes back under the fog; the players keep the map they explored.
- **What nobody has seen** stays black.

The bright area follows the tokens. It moves when you drop a token (not while you drag it: like the reveal, the TV changes on the drop), widens the moment you open a door and narrows when you close one. None of this adds a fog change, so undo is unaffected. Tokens standing in a dimmed area are still drawn at full strength on the TV; a token under the fog is still left out, as always. Your own canvas shows the same bright and dimmed areas, only lightly shaded, so you can tell at a glance what the party sees now; while you drag a token with vision, the area it would see from the cell under it shows bright under the yellow preview.

Whether a map dims is the per-map setting **Dim unseen areas on the TV** in the **Fog** tab:

- **Auto** (the default) — dim only while at least one token on this map has vision, hidden tokens included. A map where you run the fog by hand looks exactly as it did before vision existed: nothing is dimmed.
- **On** — always dim on this map. With no token seeing, everything revealed is dimmed.
- **Off** — never dim on this map, even when tokens have vision. Vision still reveals what tokens see.

The line under the setting tells you what it means for the map shown, for example "On: 2 tokens on this map have vision." or "Off: no token on this map has vision.". The setting belongs to the map: it is saved with the campaign, kept in exports and copied when you duplicate the map. What is bright right now is never saved or sent anywhere: each screen works it out from the walls, doors and tokens it already has, so the TV and your canvas always agree.

### Filling a room
Once a room's walls are drawn, one click reveals the whole room, whether or not a token is in it. Click **Fill** on the **Fog** tab, or press **F**; the toolbar chip says "Fog · reveal fill". As you move the pointer over the canvas, the room under it lights up: every grid cell you can reach from the cell under the pointer, going cell to cell, without crossing a wall or a closed door. Click, and exactly those cells are revealed on the TV. In **Hide** mode the same click puts the room back under fog ("Fog · hide fill").

- **Doors.** A closed door stops the fill; an open one lets it through. Click the door itself to open it (the fill stays armed and fills nothing), then click inside the room again to reveal both rooms.
- **Any wall works**, straight along the grid or at an angle: a diagonal wall stops the fill along its whole length. The fill always covers whole cells, so a cell a wall cuts in two is filled with the side its centre is on.
- **The edge of the map** stops the fill too, so a room against the edge needs no wall there.
- **One change.** A fill is a single fog change: **Undo** takes all of it back, and the TV shows it the moment you click.
- **Draw the walls first.** With no walls, or through a gap in a room's walls, the fill spreads to everything it can reach. If that is more than 20,000 cells nothing changes, and the **Fog** tab says the area is too large to fill (the hint over the canvas warns you as soon as you point there). A small map with no walls fills whole, the same as **Reveal all**.

### Running initiative
The **Turns** tab (press **7**) keeps the combat order. It belongs to the campaign, not to a map: it is saved as you go, survives switching maps and reloading either window, and is kept in exports. The players see it once you turn on the turn strip (below).

- **Add an entry**: type a **Name** and its **Initiative** roll and click **Add** (or press Enter). Leave the roll empty for 0 and fill it in later; decimals and negative numbers are fine for breaking ties.
- **Add from token**: pick a token of the map being shown from the **Add from token…** list. The entry takes the token's name ("Token 3" for a token without one) and is linked to it; type the roll in **Initiative** first to use it, otherwise it is 0. A token that is already in the order is greyed out in the list. Linked entries carry a small **token** tag, or **on** and the map's name when their token is on another map.
- **Change a roll** by editing the number in its row. The list does not move until you click **Sort**.
- **Sort** orders the list by roll, highest first; entries with the same roll keep the order they were added in. Whoever's turn it is stays current.
- **Next** and **Prev** move the turn down and up the list, and **Round** counts the rounds: **Next** on the last entry goes back to the top and starts the next round; **Prev** on the first goes back to the bottom of the round before (never below round 1). The current entry is highlighted and named under the buttons. Click any row to make it that entry's turn straight away (the round stays as it is).
- **×** removes an entry. Removing the entry whose turn it is passes the turn on to the next one.
- **Reset** goes back to the top of the list in round 1; **Clear** removes every entry. Both ask you to confirm first.

With the Turns tab chosen (even with the sidebar folded), press **.** for the next turn and **,** for the previous one; on any other tab, or while you are typing in a field, those keys do nothing. On the DM canvas a gold ring circles the token whose turn it is, as long as that token is on the map being shown: an entry without a token, or with its token on another map, gets no ring. Removing a token unlinks its entries. Changes to the order cannot be undone.

**What the players see.** Click **Turn strip** in the toolbar (or tick **Show the turn strip on the TV** on the Turns tab: it is the same switch) and a thin strip runs along the top edge of the TV with every name in the order, the current one in gold, and the round at the end. It follows every change at once — **Next**, **Prev**, a click on a row, **Sort**, an edited name or roll, an entry added or removed — and turns with the player view (section 5), so it always runs along the top of the picture as the players read it. It takes less than a tenth of the screen's height; a long order scrolls sideways by itself so the current name stays in view, and the round stays at the end. Click **Turn strip** again to take it away. The switch is for this session only: it is not saved with the campaign, and it is off again after you reload the DM window. The strip is not shown while the order is empty or while the calibration ruler screen is up, and **Blackout** and the splash cover it like everything else.

The strip names everyone in the order, so a monster the players have not met yet is on the TV as soon as you add it: add it when it appears, give it a name that gives nothing away, or keep the strip off until then. The gold ring on the TV is more careful: it circles the current entry's token only while the players can see that token itself — not while it is **Hidden from players**, and not while any cell it stands on is fogged (section 6, *What the players see*) — so the ring never gives a hidden token away. It is drawn whether or not the strip is on.

### What is saved, what can be undone, what the TV shows

| | Saved with the campaign and exported | Undo | On the TV |
| --- | --- | --- | --- |
| Walls and doors | Yes, with the map; copied with it, turned with it | No: delete or redraw | Never drawn |
| A door opened or closed | Yes, as you left it | The door, no; what tokens saw through it, one step | Only through what it lets tokens see |
| A token's vision, the map's dim setting | Yes, with the map | No: set it back | Only through what they reveal and dim |
| What vision reveals, a room fill | Yes: they are fog | Yes, one step each | At once |
| What is bright right now | No: each screen works it out | Nothing to undo | Bright where tokens see, dimmed elsewhere |
| The turn order, the turn and the round | Yes, with the campaign | No | On the strip, while it is on |
| The **Turn strip** switch | No: this session only | Nothing to undo | The strip itself |
| The gold turn ring | No: it follows the order | Nothing to undo | Round the current token, while the players can see it |

## 8. Notes, drawings and pings

The **Draw** tab of the sidebar works on the map currently shown. Notes and drawings belong to the map and are saved with the campaign; pings are momentary.

### Pinging the table
Hold **Alt** (Option on a Mac) and click anywhere on the DM canvas. A yellow pulse plays at that spot on the TV for two seconds and then disappears by itself; you see the same pulse on your canvas. It works whatever tool you have running, and it works over fog too: the pulse sits on top of the fog and reveals nothing underneath. Use it for "the noise comes from *here*" or to point out where a spell lands.

### Private notes
Notes are for you alone: **they are never shown on the player screen, in any circumstances**. They are not even sent to the player window, so nothing you type can leak onto the table.

1. Click **Add note…** (the toolbar chip says "Place note"), then click the spot on the map the note belongs to. A pink pin appears there and the note opens in a small box beside it.
2. Type whatever you like (several lines are fine). It is saved as you type. **Close** hides the box; **Delete note** removes the note.
3. Click a pin to open its note again; drag a pin to move it. The **Notes** list on the **Draw** tab shows every note on the map by its first line — click one to open it on the canvas, or its **×** to delete it.

Press **Esc** (or **Stop**) to leave the note tool without placing anything. **N** arms the note tool from any tab.

### Drawing on the map
Click **Draw** (or press **P**) to turn the pen on: the cursor becomes a crosshair, the toolbar chip says "Draw · pen" and dragging on the canvas draws a freehand stroke (a click makes a dot). The pen stays on until you press **Esc**, click **Stop**, or click **Draw** again. **E** arms the eraser the same way. Before or between strokes, set:

- **Pen colour** — pick from the swatches or use the colour picker for anything else.
- **Pen width** — in map pixels, so strokes zoom with the map like everything drawn on it.
- **New strokes are shown on** — **Both views** (the default) draws on the TV as well as your canvas; **DM only** keeps the stroke private, like a note. This applies to strokes you draw from then on; existing strokes keep the setting they were drawn with. A shared stroke in a fogged area stays hidden from the players until you reveal that area, like the map beneath it.

**Eraser** (chip: "Draw · eraser") removes whole strokes: click or drag over any part of a stroke and it goes (private and shared strokes alike; the dashed circle shows the eraser's reach). **Clear drawings** removes every stroke on the map, both kinds, in one go. Notes are never affected by the eraser or by clearing.

The TV follows every stroke, erase and clear immediately. Undo applies to fog only; erase or redraw a stroke instead.

## 9. Saving, backing up, and moving campaigns between computers

### Saving
There is no save button. Everything you change in the DM view is written to the browser's local storage (IndexedDB) automatically, a fraction of a second after you stop changing it, and once more when you leave the page. Close the browser, reopen TableMap, go to the DM view: the campaign you had open comes back exactly as you left it, including its name, maps (and how far each is turned), grids, fog, walls and doors (each open or closed as you left it), tokens and their vision, each map's dim setting, notes, drawings, splash image and the turn order with its turn and round. Display calibration (section 3) is saved separately, per TV, and is not part of any campaign. Where the player view is panned, its rotation, blackout, splash and whether the turn strip is on are not saved: a new session starts centred, unrotated, with the map showing and no strip.

Campaign data lives in the browser profile on this computer only. Clearing site data for TableMap in the browser deletes it. Export a campaign (below) for backups and for moving to another machine.

### Backing up a campaign, or moving it to another computer
On the first page, every campaign has an **Export** button. It downloads one file, `<campaign name>.tablemap.zip`, holding everything the campaign is made of: its name, maps, grids, fog (both the saved fog picture and the strokes since), walls and doors, tokens and their vision, notes, drawings, splash image and turn order, with every picture inside the zip. Nothing else is needed; keep the file wherever you keep backups, or copy it to the other computer. The file is an ordinary zip, so you can look inside it, and it opens the same on Windows, macOS and Linux.

To bring a campaign back, use **Import campaign (.zip)** on the first page and choose the file. The campaign appears in the list and can be opened like any other. Importing never replaces anything you already have: if a campaign with the same identity is already there (say you export, keep playing, then import the older file), the import comes in as a second copy and the notice says so; rename or delete whichever you no longer want. An archive from an older TableMap is brought up to date as it is imported; one from a *newer* TableMap is refused with a message asking you to update. A file that is not a TableMap export, or one that is damaged, is refused with a plain message and nothing is changed.

Display calibration is not part of an export: it describes the TV, not the campaign, so calibrate once on each computer you use.

### Managing campaigns
The first page (`#/`, the **TableMap** link in the DM toolbar takes you back there) lists every campaign, most recently changed first. The one currently open in the DM view is marked **open**.

- **Create campaign**: type a name (or leave it blank for "Untitled campaign") and click the button. The new campaign opens in the DM view straight away.
- **Open**: makes that campaign the one the DM view edits and remembers it as the one to resume next time.
- **Rename**: edits the name in place; **Save** or **Cancel**. Renaming the open campaign updates the DM view and the player screen title too.
- **Delete**: click **Delete**, then **Confirm delete**. This removes the campaign and all of its images. If it was the open campaign, the DM view will need a campaign opened again.

Map images, token pictures, saved fog masks and other pictures are stored alongside the campaign in the same browser storage; they are not part of the campaign text and do not slow autosave down. Deleting a map also deletes its image (unless a duplicate still uses it), its fog mask and its tokens' pictures (unless another map's tokens still use them).

## 10. Troubleshooting and reference

### Running it without the dev server
The easiest way is the desktop app (*Installing the desktop app*, below). `npm run dev` is fine for game night too, but you can also build a static copy: `npm run build` writes it to `app/dist`, and `npm run preview` serves that folder locally so you can check it. Any static web server can host the same folder; open it in the browser and everything above applies. Campaign data still lives in the browser that opens it, not on the server.

### The two windows
- **"Open player view" does nothing, or the browser reports a blocked pop-up.** The player window is opened by your click, which browsers normally allow; if yours does not, allow pop-ups for the TableMap address and click again. TableMap reuses the same window, so clicking again never opens a second one.
- **The player window is open but the toolbar says "Player view: closed", or the Calibration section of the Table tab still says to open the player view.** The player window has not connected. Both windows must be in the same browser and the same profile; a private window, a different browser, or the player address typed into another machine cannot see the DM window. Close the player window and click **Open player view** again.
- **"Browser blocked fullscreen from here."** Browsers only let a window full-screen itself in response to a click inside it. Click into the player window and press **F**, or double-click it. **F** or **Esc** leaves fullscreen.
- **The Calibration section reports the laptop's resolution, not the TV's.** The player window is still on the laptop. Drag it to the TV; the panel updates within a second. If you rearrange your displays or change the operating system's display scaling, the TV counts as a new display and needs calibrating again.

### What the TV shows
- **Black although a map is imported.** New maps are fully fogged: reveal something (section 4). If the map is revealed and the TV is still black, check the toolbar: **End blackout** means a blackout is on.
- **The campaign title instead of a map.** No map is being shown. Click **Show** on a map on the **Maps** tab.
- **Clicks on the map paint fog (or draw, or drop a note) instead of panning or moving a token.** A tool is still armed from earlier; the yellow chip in the toolbar names it. Click its **Stop** or press **Esc**. Opening another tab also puts it down.
- **A control you expect is not in the sidebar.** It is on another tab: map list, import, blank maps, grid and map rotation on **Maps**; fog, the fill and the dim setting on **Fog**; tokens and their vision on **Tokens**; the turn order on **Turns**; drawings and notes on **Draw**; walls and doors on **Walls**; calibration, player view rotation, recentre and splash settings on **Table**. Blackout, the splash switch and **Turn strip** are always in the toolbar. If the sidebar is only a narrow strip of letters, it is folded: click **»** or one of the letters to open it. The blank-map form is under **New blank map** on the Maps tab, and the TV-size fields under **Recalibrate from the TV size** on the Table tab once the display is calibrated.
- **The map is on its side on your canvas, or on the TV.** Sideways on both: turn the map (**Map rotation** on the **Maps** tab, section 2). Right on your canvas but wrong on the TV: turn the player view (**Table** tab, section 5).
- **Artwork, a title card or a picture instead of the map.** The splash is up; click **Hide splash** in the toolbar.
- **A row of names across the top of the TV.** That is the initiative order; click **Turn strip** in the toolbar to take it away (section 7, *Running initiative*). It follows the player view's rotation, so on a turned view it runs along whichever edge is the top for the players.
- **The ring is round a token on my canvas but not on the TV.** The TV rings the current token only while the players can see it: untick **Hidden from players** or reveal every cell it stands on (section 6).
- **Parts of the revealed map are darker on the TV.** That ground was seen before but no token with vision sees it now (section 7, *What the players see with vision on*). To stop dimming on a map, set **Dim unseen areas on the TV** on the **Fog** tab to **Off**.
- **A token with vision revealed nothing.** Vision reveals when you let go of the token, when you type a vision above 0 and when a door opens or closes, never while you drag. Check that its **Vision (cells)** is above 0; if what it sees is already revealed there is nothing to add.
- **A token sees through a wall, or the fill spills out of a room.** There is a gap in the walls, or an open door: look at the room's corners on your canvas (with **Snap to grid** on, walls drawn to the same corner join exactly) and at the **Doors** list on the **Walls** tab (section 7).
- **The TV shows only part of the map.** That is true scale: at one inch per cell a large map overflows the TV. Drag the blue rectangle on the DM canvas to pan (section 5) or tick **Overview** to fit the whole map, not to scale (section 3).
- **A mini does not fit the cell.** Recalibrate with a ruler (section 3, method A) and make sure the grid is aligned to the printed squares first (section 2): calibration makes one *grid* cell one inch, so a misaligned grid gives the wrong size.
- **A token is on the DM canvas but not on the TV.** Either it is marked hidden, or some part of it stands on a fogged cell (section 6).

### Installing the desktop app
Each release on the project's GitHub **Releases** page has three downloads: `TableMap-<version>-win-x64.exe` for Windows, `TableMap-<version>-mac-arm64.dmg` for Macs with Apple silicon (M1 and newer) and `TableMap-<version>-mac-x64.dmg` for Intel Macs. They are not signed with a paid Microsoft or Apple certificate, so the first launch takes one extra step:
- **Windows:** run the installer. If SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**.
- **Mac:** open the `.dmg` and drag **TableMap** onto **Applications**. The first time you open it macOS refuses; open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the TableMap message.

**Updates.** The desktop app checks for a new version when it starts and every few hours while it runs. On **Windows** it downloads the update in the background; when it is ready you are asked whether to **Restart now** or **Later**, and "Later" installs it the next time you close TableMap. On a **Mac** it tells you a new version is out and **Download** opens the release page; download the new `.dmg` and drag TableMap into Applications again to replace the old one. Your campaigns are kept either way. Without an internet connection nothing happens and TableMap works as usual.

The desktop app keeps its campaigns separately from any browser: to bring a campaign over from the browser version, **Export** it there and **Import campaign (.zip)** in the app (section 9). **Open player view** opens a second TableMap window; drag it onto the TV and full-screen it as in section 1. To build the installers yourself: `npm run desktop:dist` in `app/` (the installer for the computer you run it on lands in `app/release/`); `npm run desktop` builds and runs the app without installing it.

### Your data
- **Everything vanished.** Campaigns live in the browser's site data for the TableMap address. Clearing that data, using a different browser or a different profile, or opening the app from a different address (say `localhost` instead of `127.0.0.1`) shows an empty list. Import your last export (section 9).
- **Moving to another computer or browser.** Export each campaign, import it there, and calibrate the TV again on that machine (section 9); turn the player view again too if the TV needs it, as that is remembered per display on each computer.

### Keyboard and mouse
Press **?** in the DM view for this list on screen. Single keys work anywhere in the DM view except inside a text field; a fog, draw or wall key arms that tool with the current settings and opens its tab. The turn keys **.** and **,** only work while the Turns tab is the chosen tab.

| Where | Keys | What |
| --- | --- | --- |
| Player window | **F**, or double-click | Enter or leave fullscreen |
| Player window | **Esc** | Leave fullscreen |
| DM canvas | Wheel | Zoom around the pointer |
| DM canvas | Drag | Pan; move a token under the pointer; inside the blue rectangle, pan the TV; with a tool armed, use the tool |
| DM canvas | Space + drag, or middle-button drag | Pan, whatever tool is armed |
| DM canvas | Alt + click (Option on a Mac) | Ping that spot on the TV |
| DM canvas | Click a wall (no tool armed) | Select it; drag an end to move it; Delete removes it |
| DM canvas | Click a door | Open or close it, even with a fog or draw tool armed |
| DM sidebar | Click a tab, or **←** / **→** with a tab focused (**Home** / **End** for the first / last) | Switch between Maps, Fog, Tokens, Turns, Draw, Walls and Table; an armed tool from another tab is put down |
| DM sidebar | **«** / **»** at the left of the tab strip | Fold the sidebar to a strip of tab initials, or open it again (a tab, **1**–**7** or a toolbar chip opens it too) |
| DM toolbar | Click the tool chip's name | Open the tab the armed tool belongs to |
| DM toolbar | Click the calibration chip | Open the Table tab |
| DM toolbar | **Stop** in the tool chip, or the **?** button | Stop the running tool (same as Esc); show the cheat sheet |
| DM view | **1** | Open the Maps tab |
| DM view | **2** | Open the Fog tab |
| DM view | **3** | Open the Tokens tab |
| DM view | **4** | Open the Draw tab |
| DM view | **5** | Open the Walls tab |
| DM view | **6** | Open the Table tab |
| DM view | **7** | Open the Turns tab |
| DM view | **?** | Show or hide this cheat sheet |
| DM view | **V** | Stop the armed tool |
| DM view | **G** | Align grid |
| DM view | **N** | Place a note |
| DM view | **R** | Fog: reveal mode |
| DM view | **H** | Fog: hide mode |
| DM view | **B** | Fog: brush |
| DM view | **X** | Fog: rectangle |
| DM view | **L** | Fog: lasso |
| DM view | **F** | Fog: fill a room |
| DM view | **[** | Fog: smaller brush |
| DM view | **]** | Fog: larger brush |
| DM view | **P** | Draw: pen |
| DM view | **E** | Draw: eraser |
| DM view | **W** | Walls: wall |
| DM view | **D** | Walls: door |
| DM view | **.** | Turns: next turn (Turns tab open) |
| DM view | **,** | Turns: previous turn (Turns tab open) |
| DM view | **Delete** / **Backspace** | Remove the selected wall or door |
| DM view | Esc | Stop the armed tool, or abandon the stroke in progress; close this sheet (with no tool armed: deselect the wall or door) |
| DM view | Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y (Cmd on a Mac) | Undo / redo the last fog change |
