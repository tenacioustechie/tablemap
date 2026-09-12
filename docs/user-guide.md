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

Map images and other pictures are stored alongside the campaign in the same browser storage; they are not part of the campaign text and do not slow autosave down.
