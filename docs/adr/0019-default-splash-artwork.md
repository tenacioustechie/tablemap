# ADR 0019: Default splash artwork; the title card is a choice (schema v7)

Status: accepted (T015)
Amends ADR 0014.

## Context
ADR 0014 made the splash screen show the campaign's own image when one is chosen and a plain campaign-title card otherwise. The product now has artwork for the splash (`app/src/assets/splash-default.png`, 1672×941), and a new campaign should look finished on the TV before the DM has prepared anything. The title card is still useful — a DM who has named the campaign may prefer it — so it must stay available. Whatever the fallback is, the player window stays render-only: it never reads storage and only receives what the DM sends.

## Decision
- **The default artwork is a static asset, not an asset of the campaign.** The player view and the DM panel import the file by URL (`import defaultSplashUrl from "../assets/splash-default.png"`); Vite bundles and hashes it into `dist/assets/`, and both windows load it from the same origin. Rejected: seeding it into the `assets` table and pushing it over the channel like a splash image — it would be copied into every campaign's storage and every export, the player would depend on the DM having sent it, and the render-only rule would need an exception for something the app already ships.
- **The title card is an explicit choice: `SharedState.splashTitleCard`, schema v7.** The splash's precedence on the player is: the chosen image (`splashImageAssetId`, with the title as the placeholder until it arrives, as before) > the title card when `splashTitleCard` is true > the default artwork. The choice is campaign content like the splash image (ADR 0014): it is autosaved, travels in exports and crosses the channel as part of the shared state, changed through one op, `campaign/set-splash-title-card { on }`. `migrateCampaign` v6 → v7 adds `false`, so an older campaign without a splash image switches from the title card to the artwork, like a new one; a v6 build refuses v7 documents as `newer-schema`. Rejected: making the artwork the only fallback (drops a working feature) and a DM-only preference for the title card (the splash is campaign content and must survive an export; ADR 0014).
- **`data-splash-kind` gains `"default"`; the artwork renders like a custom image** (object-fit contain on black, inside the rotated box) so it reads the right way up for the players at any rotation. The DM panel's thumbnail always shows what is in effect — the image, a title placeholder or the artwork — and the clear button is now "Remove splash image": clearing returns to whichever source is selected, not necessarily the title.
- **The idle screen is unchanged.** With no active map and the splash down the player still shows the campaign title, not the artwork: the idle screen says "connected, nothing shown yet" and the artwork would make it look like a deliberate splash.

## Consequences
- Protocol version stays 1; `isSharedState` is strict, so a stale player tab from a v6 build rejects v7 snapshots as `invalid-shape` (both windows are always served from the same build).
- Every full-state literal in the tests gained the field; the v5 → v6 migration test now expects the v7 field too, because the chain runs on to the current version.
- The artwork's wordmark says "DM Map" while the app is called TableMap; replacing the file is a one-line change and needs no code, so that is left to the owner.
- Not in scope: the DM landing page, the campaign manager and the favicon keep their current look.
