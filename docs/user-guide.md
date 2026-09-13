# User Guide

TableMap runs a battle map on a TV lying in (or standing beside) your gaming table. You, the DM, work on a laptop: the **DM view** shows the whole map with the fogged parts dimmed and every control. A second browser window, the **player view**, full-screens on the TV and shows only what you have revealed, at true scale, so a mini on a 1-inch base fills exactly one grid cell. There is no server and no account: everything is stored in your browser.

1. [Setting up the TV](#1-setting-up-the-tv)
2. [Importing a map and aligning the grid](#2-importing-a-map-and-aligning-the-grid)
3. [Calibrating to real-world inches](#3-calibrating-to-real-world-inches)
4. [Running fog of war during a session](#4-running-fog-of-war-during-a-session)
5. [Positioning the player view, blackout and splash](#5-positioning-the-player-view-blackout-and-splash)
6. [Tokens](#6-tokens)
7. [Notes, drawings and pings](#7-notes-drawings-and-pings)
8. [Saving, backing up, and moving campaigns between computers](#8-saving-backing-up-and-moving-campaigns-between-computers)
9. [Troubleshooting and reference](#9-troubleshooting-and-reference)

## Quick start: from a clean clone to a fogged map on the TV

Ten minutes, start to finish. Each step points at the section that explains it fully.

### What you need
- A laptop running Windows, macOS or Linux with [Node.js](https://nodejs.org) 20 or newer (the project is developed on Node 22) and git.
- A current browser: Chrome, Edge or Firefox. TableMap is tested in Chromium. Both windows must run in the **same browser and the same profile** (not one normal and one private window).
- A TV connected over HDMI as a second, **extended** display.
- A map image (PNG, JPEG or WebP). The repository ships one with a printed grid for trying things out: `app/e2e/fixtures/grid-map.png`.

### Install and start
```bash
git clone <this repository>
cd tablemap/app
npm install
npm run dev
```
Open the address Vite prints, normally `http://localhost:5173/`. That page is the campaign manager. (TableMap is a single page with three hash routes: `#/` the campaign manager, `#/dm` the DM view, `#/player` the player view. You never type the last one: the DM view opens it for you.)

### Ten steps to a fogged map on the TV
1. **Create a campaign.** Type a name and click **Create campaign**. The DM view opens: a toolbar, a sidebar, and a dark canvas that says the campaign has no maps yet.
2. **Import a map.** Drag your image from the file manager anywhere onto the DM view (a "Drop image to import a map" banner appears), or click **Import image** in the **Maps** panel. The map appears on the canvas, dimmed: every new map starts completely fogged. Scroll to zoom, drag to pan, **Fit** to see it all. (Section 2.)
3. **Open the player view.** Click **Open player view** in the toolbar. A chrome-less window opens, entirely black: that is the fogged map. The toolbar now says "Player view: open".
4. **Put it on the TV.** Drag the player window onto the TV and click **Fullscreen player view**. If the toolbar answers "Browser blocked fullscreen from here. Press F in the player window.", click once inside the player window and press **F** (or double-click it). (Section 1.)
5. **Align the grid.** In the sidebar under **Tools > Grid**, click **Align grid…**, then on the DM canvas drag from one corner of a printed square to the opposite corner. The grid snaps to the printed squares; **Cell size (px)** shows the size it found. (Section 2.)
6. **Calibrate the TV.** **Tools > Calibration** now reports the TV, for example "Player display 3840×2160". Either click **Calibrate with a ruler…**, hold a ruler against the TV and grow or shrink the white square until it is exactly one inch, then save; or type the TV's diagonal in inches and click **Use TV size**. From now on one cell on the TV is one inch. (Section 3.)
7. **Reveal the first room.** Under **Tools > Fog of war**, **Reveal** is already selected. Click **Rectangle** and drag a box over the first room on the DM canvas. The moment you let go, that room appears on the TV; everything else stays black. **Brush** paints freehand, **Lasso** draws an outline; **Undo** (Ctrl+Z, Cmd+Z on a Mac) takes any of it back. (Section 4.)
8. **Choose what the TV shows.** The TV cannot show a whole large map at one inch per cell. Drag the blue **Player view** rectangle on the DM canvas to pan the TV; **Recentre player view** under **Tools > Player view** puts it back in the middle. (Section 5.)
9. **Play.** **Add token** under **Tools > Tokens** drops a numbered disc in the middle of the TV area; drag it around. **Blackout** in the toolbar blanks the TV instantly while you set up the next scene. Alt-click the map to ping a spot. (Sections 5 to 7.)
10. **Stop whenever you like.** There is no save button: every change is stored in the browser as you make it. Close both windows; next time, `npm run dev`, open the page, click **Open** on the campaign, and open the player view again. The map, fog, tokens and the TV's calibration are all still there. Before you clear browser data or move to another computer, click **Export** next to the campaign on the first page and keep the zip. (Section 8.)

## 1. Setting up the TV

1. Connect the TV over HDMI and set it as an **extended** display (not mirrored) in your OS display settings.
2. Open TableMap in your browser. The first page lists your campaigns: pick one and click **Open**, or type a name and click **Create campaign**. (**Open DM view** at the bottom, or going straight to `#/dm`, resumes the last campaign you had open; the very first time it creates "Untitled campaign" for you.)
3. In the DM view toolbar click **Open player view**. A separate chrome-less window opens showing the player view (black until a map is loaded). The toolbar status changes to "Player view: open".
4. Drag the player window onto the TV.
5. Click **Fullscreen player view**. If your browser refuses to full-screen a window from another window, the DM view shows a hint: click into the player window and press **F** (or double-click it). Press **F** again, or **Esc**, to leave fullscreen.
6. **Close player view** closes the window from the DM side. Clicking **Open player view** while it is already open just brings it to the front.

The player window never shows any DM controls; everything is driven from the DM view.

### How the two windows stay in sync

The DM window holds the state; the player window only mirrors it. Whatever you change in the DM view appears on the player screen immediately, with no save step. If the player window is closed, reloaded, or opened before the DM view, it asks the DM window for the current state as soon as both are open, so you never need to redo anything to bring it back up to date. Both windows must be open in the same browser on the same computer (the TV is just an extra display).

To try it: type a **Campaign name** in the DM sidebar. While no map is loaded, the player screen shows that name as a dim title; clear the field and the player screen goes back to plain black.

## 2. Importing a map and aligning the grid

### Importing a map image
Drag a PNG, JPEG or WebP file from your file manager anywhere onto the DM view (a "Drop image to import a map" banner appears while you hold it there), or use **Import image** in the **Maps** panel of the sidebar to pick one or more files. Each file becomes a map named after the file, appears in the map list with a thumbnail, and is shown straight away on the DM canvas and on the player screen. Other file types are refused with a message under the picker. Imported images are stored in the browser alongside the campaign, so they are still there after a reload.

### Blank gridded maps
For an improvised encounter, use the **Blank gridded map** form under the map list: give it a name, choose the size in **Columns** and **Rows**, the **Cell size** in pixels (this is also the grid size), and a background **Colour**, then click **Create blank map**. It becomes the active map immediately.

### The map list
The **Maps** panel lists every map in the campaign; the highlighted one is what the player screen shows.
- **Show** makes a map the active scene. The player screen switches at once (images the player has already received switch instantly).
- **Rename** edits the name in place (**Save** / **Cancel**).
- **Duplicate** inserts a copy right after the original, named "… (copy)", and shows it. The copy shares the image but has its own fog and tokens.
- **Delete**, then **Confirm delete**, removes the map. If it was the one being shown, the player screen goes back to the campaign title until you show another map.

### Looking around on the DM canvas
The DM canvas shows the active map. Scroll the mouse wheel to zoom around the pointer and drag to pan. The zoom level is shown bottom-right; **Fit** brings the whole map back into view. The player screen is not affected: until you calibrate (section 3) it shows the whole map fitted to the TV; once calibrated its zoom is locked so that one cell is one real inch, and you choose which part of the map the TV shows by dragging the blue **Player view** rectangle (section 5).

### Aligning the grid
Every map starts with a 70-pixel grid at the top-left corner (blank maps use the cell size you chose, so they are already aligned). For an imported image the grid usually needs to be matched to the squares printed on the map. The **Grid** section under **Tools** in the sidebar does this for the map currently shown.

1. Zoom in on the DM canvas (mouse wheel) until one printed square is comfortably large.
2. Click **Align grid…**. The cursor becomes a crosshair and a hint appears over the canvas.
3. Either **drag** from one corner of a printed square to the diagonally opposite corner, or **click** one corner and then **click** the opposite corner. Any square anywhere on the map will do, and any diagonal.
4. The grid snaps to that square: the cell size becomes the square's size and the grid lines shift to run through its corners. The tool switches itself off. Press **Esc** (or **Cancel alignment**) to leave the tool without changing anything.

If the box you drew is only a few pixels across, the tool says so and lets you try again. For fine tuning, or for maps where you already know the numbers, edit **Cell size (px)**, **Offset X (px)** and **Offset Y (px)** directly; the canvas updates as you type.

### Grid appearance, per screen
The grid can look different on your laptop and on the table. The **DM view** and **Player view** boxes in the Grid section each have their own **Show grid** switch, **Colour** and **Opacity**. A common setup is a bright, fairly opaque grid on the DM view for placing things precisely, and a faint (or hidden) grid on the player screen when the printed map already has one. The cell size and offset are shared: only the look differs.

All grid settings belong to the map, are saved with the campaign and reach the player screen immediately.

## 3. Calibrating to real-world inches

Once the grid is aligned to the map's squares, calibration makes each of those squares exactly one inch (or 25 mm) on the glass, so a mini on a 1-inch base fills one cell. Calibration belongs to the TV, not to the campaign: do it once per display and every map in every campaign uses it.

### Before you start
Open the player view, move it onto the TV and full-screen it (section 1). The **Calibration** section under **Tools** in the DM sidebar reports the display the player window is on (for example "Player display 3840×2160") and whether it is calibrated. If it still says to open the player view, the player window has not connected yet; if it reports your laptop's size, the window has not been moved to the TV yet (it notices within a second of being moved).

Choose what one cell should be: **1 inch** (standard 25.4 mm bases) or **25 mm**. This applies to every display.

### Method A: with a ruler (most accurate)
1. Click **Calibrate with a ruler…**. The player screen replaces the map with a white square.
2. Hold a ruler against the TV and measure the square. Use **+1 / −1 / +10 / −10** (or type a **Square size**) until it is exactly 1 inch (or 25 mm) wide. The square resizes on the TV as you click.
3. Click **It measures 1 inch: save**. The map comes back on the player screen at the calibrated scale.

**Cancel** leaves the ruler screen without changing anything.

### Method B: from the TV's size
If you know the TV's diagonal (the advertised size, e.g. 43") and its native resolution (e.g. 3840 × 2160; the fields are prefilled with what the player window reports), type them under **Or enter the TV size** and click **Use TV size**. This is quick and usually within a percent or two; check with a mini and switch to the ruler if it looks off.

### What calibration does
- The player screen's zoom is locked: whatever the map image's resolution, one grid cell is drawn at the calibrated size. The map starts centred; large maps overflow the TV, so you pan the player view around them by dragging the blue rectangle on the DM canvas (section 5).
- The DM canvas is unaffected; zoom and pan it freely.
- The calibration is saved on this computer for that display. Close everything, reopen, open the player view on the same TV, and it applies again automatically. A different TV (or a rearranged display layout) starts uncalibrated until you calibrate it too; the panel always shows which display it is talking about. **Clear calibration** forgets the current display's value.

### Overview mode
When you need the players to see the whole map at once (a big battle map, or a splash of the region), tick **Overview: fit the whole map (not to scale)**. The player screen fits the entire map to the TV and shows a small "Overview: not to scale" badge in the corner so nobody measures movement against it. Untick it to return to true scale. Overview is only available once the display is calibrated, and it is not remembered between sessions.

## 4. Running fog of war during a session

Every map starts completely fogged: the player screen shows solid black where the map is, while the DM canvas shows the whole map with the fogged parts dimmed to half brightness, so you always see what the players cannot. The **Fog of war** section under **Tools** in the sidebar works on the map currently shown.

### Revealing and hiding areas
Pick what you want to do and what to do it with:

- **Reveal** / **Hide** — whether the tool clears fog or puts it back. Everything below works the same way in both.
- **Brush** — paint over the map. The **Brush radius** slider sets the size (in map pixels, so it zooms with the map); a single click paints one dot. While you drag, the map shows through under the brush on the DM canvas; when you let go the stroke is applied and the TV shows it at the same moment.
- **Rectangle** — drag across the area. Tiny drags (a click) do nothing.
- **Lasso** — drag around the area; letting go closes the shape.

Clicking a tool turns it on: the cursor becomes a crosshair and a hint appears over the canvas. The tool stays on, so you can keep painting. Press **Esc**, click **Stop**, or click the highlighted tool again to go back to panning; Esc in the middle of a drag abandons that stroke only. Zooming and panning the DM canvas does not affect what is revealed; shapes are in map pixels, so work at whatever zoom is comfortable.

Two options apply to all three tools:

- **Feathered edges** (on by default) softens the boundary of every reveal or hide over roughly a third of a cell, so rooms fade into darkness instead of ending in a razor line. Turn it off for hard edges.
- **Snap to grid (whole cells)** expands whatever you draw to the grid cells it touches, so a rough brush sweep or a sloppy rectangle reveals exactly whole squares. Snapped shapes always have hard edges. It uses the map's grid as aligned in section 2.

### Undo and redo
**Undo** takes back the last fog change on the map currently shown — a stroke, a rectangle, a lasso, or a hide all / reveal all — and **Redo** puts it back. The keyboard works too: **Ctrl+Z** (Cmd+Z on a Mac) to undo, **Ctrl+Shift+Z** or **Ctrl+Y** to redo, as long as you are not typing in a text field. The TV follows every step. Making a new change after undoing discards what could have been redone, as in any editor.

You can undo at least the last twenty changes on a map; usually far more. Once TableMap has folded old changes into the map's saved mask (see below) those particular changes can no longer be undone.

### Hide all / reveal all
**Hide all** puts the whole map back under fog; **Reveal all** removes all of it (useful for a social scene, or to show an overview and then hide it again). Both take effect on the TV immediately, and both can be undone.

### What is remembered
Fog belongs to the map. Switching to another map shows *that* map's fog (a new map is fully fogged); switching back brings the first map's fog back exactly as it was. Fog is saved with the campaign like everything else: reload, reopen, or open the campaign next week and it is where you left it. Duplicating a map copies its fog too.

The panel shows how many fog changes the map is carrying since it was last saved as an image. TableMap folds long histories into a saved mask image automatically ("on a saved mask" appears after the count); you never need to do anything about it, and nothing visible changes when it happens — it always leaves the most recent changes undoable.

If the player window is opened or reloaded mid-session it shows the current fog straight away. While a map's saved mask is still on its way to a freshly opened player window, that map is shown fully fogged there rather than partly revealed, so nothing leaks.

## 5. Positioning the player view, blackout and splash

### The player view rectangle
The DM canvas always shows a blue **Player view** rectangle: exactly the part of the map the TV is showing. A thick white bar on one of its edges marks the edge that is at the top of the TV. The **Player view** section under **Tools** tells you what the rectangle is doing.

- Once the display is calibrated (section 3), the rectangle has a solid outline and you can **drag it** to pan the player view; the TV follows as you drag. It cannot leave the map entirely: its centre stays on the map. Switching to another map puts the rectangle back in the middle of that map, and **Recentre player view** does the same on demand. Tokens inside the rectangle are still tokens: a drag that starts on one moves the token (section 6), a drag anywhere else inside the rectangle pans the player view.
- Until the display is calibrated, or while **Overview** is ticked, the TV shows the whole map, so there is nothing to pan: the rectangle is a dashed outline that simply shows how the map fits.
- While a canvas tool is running (grid alignment or a fog tool) the rectangle cannot be dragged, so the tool gets every click; press Esc or stop the tool first.
- The rectangle's size assumes the player window fills its display. Before a player window has connected, a 1920×1080 TV is assumed; the panel says so.

### Rotating the player view
Players sit on every side of the table, and the TV may be mounted the other way round from your laptop. **⟲ 90°** and **⟳ 90°** in the **Player view** section turn the player screen a quarter turn at a time (the current rotation is shown between them). Rotation never changes the scale: a calibrated cell is still one inch on the glass, only the map is turned. The campaign title and the splash turn with it so they read the right way up for the players. With an uncalibrated display the map is refitted to the turned screen, so a wide map turned on its side fits the TV's height instead. Rotation is not remembered between sessions.

### Blackout
**Blackout** in the toolbar turns the player screen solid black at once, whatever it was showing: map, fog, splash or ruler screen. Use it when you need to move things behind the scenes or take a break. Click **End blackout** to bring the picture back exactly as it was. The button stays highlighted while the blackout is on.

### Splash
**Show splash** in the toolbar covers the player screen with a splash, on demand, until you click **Hide splash**. Out of the box the splash is TableMap's own artwork, letterboxed on black. Under **When no splash image is chosen** in the **Player view** section you can pick **Campaign title** instead, which shows the **Campaign name** in large type; **Default artwork** goes back to the artwork. To use your own picture, pick a PNG, JPEG or WebP under **Splash image**; it is shown letterboxed on black and takes precedence over both choices. The thumbnail in the panel always shows what the players will see. **Remove splash image** drops your picture and returns to whichever choice is selected. The splash image and the choice are saved with the campaign; the artwork itself is part of the app, so it never needs to be exported.

Tick **Show splash when switching maps** and every time you show another map the splash goes up over it, so you can position the player view and reveal the first rooms before anybody sees the new scene; click **Hide splash** when you are ready. Leave it unticked for instant scene switches (the default).

If the splash and a blackout are both on, the blackout wins; the splash is still there when the blackout ends. The ruler calibration screen also takes precedence over the splash while it is showing.

## 6. Tokens

Tokens mark where creatures and objects are on the map: coloured discs with a short badge (a letter or number), or round-cropped pictures. They belong to the map, are saved with the campaign and appear on the TV immediately. The **Tokens** section under **Tools** in the sidebar works on the map currently shown.

### Adding tokens
- **Add token** puts a new disc in the middle of what the TV is showing (the middle of the map until you have calibrated and panned). Each new token gets the next number as its badge and name ("Token 3", badge "3") and the next colour from a small palette; change any of that in the editor below the list.
- **Add image token** asks for a PNG, JPEG or WebP file and makes a token showing that picture, cropped to a circle. Other file types are refused with a message. The picture is stored with the campaign.

The new token is selected straight away, so you can edit it or drag it into place.

### Moving tokens
Drag a token on the DM canvas. With **Snap to grid** on (the default) it jumps from cell to cell as you drag and always lands exactly on whole cells, whatever its size; turn snapping off for a token to put it anywhere. A token cannot be dragged off the map entirely: its centre stays on the map. Dragging is only possible while no fog or grid tool is running, so that those tools get every click; press **Esc** or **Stop** first. Tokens standing inside the blue player view rectangle (section 5) can be dragged like any other: the token wins over the rectangle where they overlap.

### Editing a token
Click a token on the canvas, or its entry in the list, to select it (a blue box marks it on the canvas; click the list entry again, or **Done**, to deselect). The editor shows:
- **Name** — for your own reference in the list.
- **Badge** — up to three characters drawn on the token (empty for none). On picture tokens it sits in a small corner pill.
- **Colour** — for disc tokens.
- **Size** — 1×1 to 4×4 cells. A snapping token stays aligned with the grid when you resize it.
- **Snap to grid** — see above. Turning it on snaps the token to the nearest cell at once.
- **Hidden from players** — the token is only ever shown on your canvas (dimmed, with a dashed ring) until you untick it. Use it for the ambush waiting behind the door.
- **Remove token** — deletes it (and its picture, if no other token uses it).

### What the players see
The TV shows a token only when **every cell it stands on has been revealed** and it is not hidden. A token standing in fog is simply not there on the player screen — not dimmed, not outlined — and appears the moment you reveal its last fogged cell; hide the cell again (or undo the reveal) and it disappears again. On your canvas such tokens stay visible, dimmed by the fog like the map under them, with a thin dashed box as a reminder that the players cannot see them. A large token half inside a revealed room is still hidden until the whole of it is in the light, so nothing gives its position away.

Duplicating a map copies its tokens; switching maps shows each map's own tokens.

## 7. Notes, drawings and pings

The **Annotations** section under **Tools** in the sidebar works on the map currently shown. Notes and drawings belong to the map and are saved with the campaign; pings are momentary.

### Pinging the table
Hold **Alt** (Option on a Mac) and click anywhere on the DM canvas. A yellow pulse plays at that spot on the TV for two seconds and then disappears by itself; you see the same pulse on your canvas. It works whatever tool you have running, and it works over fog too: the pulse sits on top of the fog and reveals nothing underneath. Use it for "the noise comes from *here*" or to point out where a spell lands.

### Private notes
Notes are for you alone: **they are never shown on the player screen, in any circumstances**. They are not even sent to the player window, so nothing you type can leak onto the table.

1. Click **Add note…**, then click the spot on the map the note belongs to. A pink pin appears there and the note opens in a small box beside it.
2. Type whatever you like (several lines are fine). It is saved as you type. **Close** hides the box; **Delete note** removes the note.
3. Click a pin to open its note again; drag a pin to move it. The **Notes** list in the sidebar shows every note on the map by its first line — click one to open it on the canvas, or its **×** to delete it.

Press **Esc** (or **Stop**) to leave the note tool without placing anything.

### Drawing on the map
Click **Draw** to turn the pen on: the cursor becomes a crosshair and dragging on the canvas draws a freehand stroke (a click makes a dot). The pen stays on until you press **Esc**, click **Stop**, or click **Draw** again. Before or between strokes, set:

- **Pen colour** — pick from the swatches or use the colour picker for anything else.
- **Pen width** — in map pixels, so strokes zoom with the map like everything drawn on it.
- **New strokes are shown on** — **Both views** (the default) draws on the TV as well as your canvas; **DM only** keeps the stroke private, like a note. This applies to strokes you draw from then on; existing strokes keep the setting they were drawn with. A shared stroke in a fogged area stays hidden from the players until you reveal that area, like the map beneath it.

**Eraser** removes whole strokes: click or drag over any part of a stroke and it goes (private and shared strokes alike; the dashed circle shows the eraser's reach). **Clear drawings** removes every stroke on the map, both kinds, in one go. Notes are never affected by the eraser or by clearing.

The TV follows every stroke, erase and clear immediately. Undo applies to fog only; erase or redraw a stroke instead.

## 8. Saving, backing up, and moving campaigns between computers

### Saving
There is no save button. Everything you change in the DM view is written to the browser's local storage (IndexedDB) automatically, a fraction of a second after you stop changing it, and once more when you leave the page. Close the browser, reopen TableMap, go to the DM view: the campaign you had open comes back exactly as you left it, including its name, maps, grids, fog, tokens, notes, drawings and splash image. Display calibration (section 3) is saved separately, per TV, and is not part of any campaign. Where the player view is panned, its rotation, blackout and splash are not saved: a new session starts centred, unrotated, with the map showing.

Campaign data lives in the browser profile on this computer only. Clearing site data for TableMap in the browser deletes it. Export a campaign (below) for backups and for moving to another machine.

### Backing up a campaign, or moving it to another computer
On the first page, every campaign has an **Export** button. It downloads one file, `<campaign name>.tablemap.zip`, holding everything the campaign is made of: its name, maps, grids, fog (both the saved fog picture and the strokes since), tokens, notes, drawings and splash image, with every picture inside the zip. Nothing else is needed; keep the file wherever you keep backups, or copy it to the other computer. The file is an ordinary zip, so you can look inside it, and it opens the same on Windows, macOS and Linux.

To bring a campaign back, use **Import campaign (.zip)** on the first page and choose the file. The campaign appears in the list and can be opened like any other. Importing never replaces anything you already have: if a campaign with the same identity is already there (say you export, keep playing, then import the older file), the import comes in as a second copy and the notice says so; rename or delete whichever you no longer want. An archive from an older TableMap is brought up to date as it is imported; one from a *newer* TableMap is refused with a message asking you to update. A file that is not a TableMap export, or one that is damaged, is refused with a plain message and nothing is changed.

Display calibration is not part of an export: it describes the TV, not the campaign, so calibrate once on each computer you use.

### Managing campaigns
The first page (`#/`, the **TableMap** link in the DM toolbar takes you back there) lists every campaign, most recently changed first. The one currently open in the DM view is marked **open**.

- **Create campaign**: type a name (or leave it blank for "Untitled campaign") and click the button. The new campaign opens in the DM view straight away.
- **Open**: makes that campaign the one the DM view edits and remembers it as the one to resume next time.
- **Rename**: edits the name in place; **Save** or **Cancel**. Renaming the open campaign updates the DM view and the player screen title too.
- **Delete**: click **Delete**, then **Confirm delete**. This removes the campaign and all of its images. If it was the open campaign, the DM view will need a campaign opened again.

Map images, token pictures, saved fog masks and other pictures are stored alongside the campaign in the same browser storage; they are not part of the campaign text and do not slow autosave down. Deleting a map also deletes its image (unless a duplicate still uses it), its fog mask and its tokens' pictures (unless another map's tokens still use them).

## 9. Troubleshooting and reference

### Running it without the dev server
`npm run dev` is fine for game night, but you can also build a static copy: `npm run build` writes it to `app/dist`, and `npm run preview` serves that folder locally so you can check it. Any static web server can host the same folder; open it in the browser and everything above applies. Campaign data still lives in the browser that opens it, not on the server.

### The two windows
- **"Open player view" does nothing, or the browser reports a blocked pop-up.** The player window is opened by your click, which browsers normally allow; if yours does not, allow pop-ups for the TableMap address and click again. TableMap reuses the same window, so clicking again never opens a second one.
- **The player window is open but the toolbar says "Player view: closed", or the Calibration panel still says to open the player view.** The player window has not connected. Both windows must be in the same browser and the same profile; a private window, a different browser, or the player address typed into another machine cannot see the DM window. Close the player window and click **Open player view** again.
- **"Browser blocked fullscreen from here."** Browsers only let a window full-screen itself in response to a click inside it. Click into the player window and press **F**, or double-click it. **F** or **Esc** leaves fullscreen.
- **The Calibration panel reports the laptop's resolution, not the TV's.** The player window is still on the laptop. Drag it to the TV; the panel updates within a second. If you rearrange your displays or change the operating system's display scaling, the TV counts as a new display and needs calibrating again.

### What the TV shows
- **Black although a map is imported.** New maps are fully fogged: reveal something (section 4). If the map is revealed and the TV is still black, check the toolbar: **End blackout** means a blackout is on.
- **The campaign title instead of a map.** No map is being shown. Click **Show** on a map in the **Maps** panel.
- **Artwork, a title card or a picture instead of the map.** The splash is up; click **Hide splash** in the toolbar.
- **The TV shows only part of the map.** That is true scale: at one inch per cell a large map overflows the TV. Drag the blue rectangle on the DM canvas to pan (section 5) or tick **Overview** to fit the whole map, not to scale (section 3).
- **A mini does not fit the cell.** Recalibrate with a ruler (section 3, method A) and make sure the grid is aligned to the printed squares first (section 2): calibration makes one *grid* cell one inch, so a misaligned grid gives the wrong size.
- **A token is on the DM canvas but not on the TV.** Either it is marked hidden, or some part of it stands on a fogged cell (section 6).

### Your data
- **Everything vanished.** Campaigns live in the browser's site data for the TableMap address. Clearing that data, using a different browser or a different profile, or opening the app from a different address (say `localhost` instead of `127.0.0.1`) shows an empty list. Import your last export (section 8).
- **Moving to another computer or browser.** Export each campaign, import it there, and calibrate the TV again on that machine (section 8).

### Keyboard and mouse
| Where | Keys | What |
| --- | --- | --- |
| Player window | **F**, or double-click | Enter or leave fullscreen |
| Player window | **Esc** | Leave fullscreen |
| DM canvas | Mouse wheel | Zoom around the pointer |
| DM canvas | Drag | Pan the DM canvas; with a token under the pointer, move it; inside the blue rectangle, pan the TV |
| DM canvas | **Alt**-click (Option on a Mac) | Ping that spot on the TV |
| DM view | **Esc** | Stop the running tool, or abandon the stroke in progress |
| DM view | **Ctrl+Z** (Cmd+Z) | Undo the last fog change |
| DM view | **Ctrl+Shift+Z** or **Ctrl+Y** (Cmd on a Mac) | Redo |
