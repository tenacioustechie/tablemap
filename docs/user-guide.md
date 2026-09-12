# User Guide

(Filled in by task T014 as features land. Skeleton:)
1. Setting up the TV (extended display, opening the player window, fullscreen)
2. Importing a map and aligning the grid
3. Calibrating to real-world inches
4. Running fog of war during a session
5. Tokens, pings, blackout, splash
6. Saving, backing up, and moving campaigns between computers

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
The DM canvas shows the active map. Scroll the mouse wheel to zoom around the pointer and drag to pan. The zoom level is shown bottom-right; **Fit** brings the whole map back into view. The player screen is not affected: it always shows the whole map fitted to the TV (calibrated 1-inch cells arrive in a later release).

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

## 6. Saving, backing up, and moving campaigns between computers

### Saving
There is no save button. Everything you change in the DM view is written to the browser's local storage (IndexedDB) automatically, a fraction of a second after you stop changing it, and once more when you leave the page. Close the browser, reopen TableMap, go to the DM view: the campaign you had open comes back exactly as you left it, including its name and (as later features land) maps, fog and tokens.

Campaign data lives in the browser profile on this computer only. Clearing site data for TableMap in the browser deletes it. Use export (coming in a later release) for backups and for moving to another machine.

### Managing campaigns
The first page (`#/`, the **TableMap** link in the DM toolbar takes you back there) lists every campaign, most recently changed first. The one currently open in the DM view is marked **open**.

- **Create campaign**: type a name (or leave it blank for "Untitled campaign") and click the button. The new campaign opens in the DM view straight away.
- **Open**: makes that campaign the one the DM view edits and remembers it as the one to resume next time.
- **Rename**: edits the name in place; **Save** or **Cancel**. Renaming the open campaign updates the DM view and the player screen title too.
- **Delete**: click **Delete**, then **Confirm delete**. This removes the campaign and all of its images. If it was the open campaign, the DM view will need a campaign opened again.

Map images and other pictures are stored alongside the campaign in the same browser storage; they are not part of the campaign text and do not slow autosave down. Deleting a map also deletes its image, unless a duplicate still uses it.
