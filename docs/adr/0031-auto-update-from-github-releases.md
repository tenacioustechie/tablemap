# ADR 0031: Auto-update the desktop app from GitHub releases

Status: accepted. Builds on ADR 0029 (Electron desktop app, CI releases).

## Context
Installers go to a group of players who will not watch the repository. Once the first version is out, any fix must reach them without anyone remembering to download it again. Releases already live on GitHub (ADR 0029). The builds are not code-signed: there is no paid Apple Developer ID or Windows certificate.

## Decision
- **electron-updater** (a runtime dependency of the desktop shell only; nothing in `src/` imports it) with electron-builder's **GitHub provider** (`package.json` → `build.publish`: this repository, `releaseType: release`). electron-builder writes the update feed next to the installers — `latest.yml` for Windows, `latest-mac.yml` for macOS (which needs the `zip` target as well as the DMG) — and CI attaches the feed, the zips and the blockmaps to every tagged release. The packaged app carries `app-update.yml` naming the repository and reads the newest published release. Rejected: a hand-written GitHub API check — it would reimplement version comparison, differential downloads and the Windows installer handoff that electron-updater already does.
- **Windows installs, macOS notifies** (`electron/updatePolicy.mjs: updateMode`, wired up in `electron/updater.mjs`). On Windows (NSIS) an update downloads in the background and installs when the app quits; when it is ready the DM is asked "Restart now" or "Later" (default **Later**: a dialog must not end a session by accident). Squirrel.Mac refuses to install updates into apps without an Apple Developer ID signature, so on macOS the app only checks and offers **Download**, which opens the release page in the browser. With a Developer ID, `updateMode` returns `install` on macOS too and nothing else changes. Each version is offered once per run.
- **When**: at start-up and every four hours (`UPDATE_CHECK_INTERVAL_MS`). Never when unpackaged (`npm run desktop`) or with `TABLEMAP_DISABLE_UPDATES=1` (the CI smoke test sets it). A failed check — offline at the table, GitHub unreachable — is logged and ignored.

## Consequences
- **The repository must be public** for installed apps to read releases, and a release must be published (not a draft or pre-release) to be offered. Until the first public release, checks fail with a 404, harmlessly.
- Releases are about twice as large (each Mac architecture ships a DMG for people and a zip for the updater).
- Unsigned Windows updates are not signature-checked by the updater; they come over HTTPS from this repository's releases only. Signing later (electron-builder `CSC_*` secrets) adds the check.
- Tests: `src/desktop.test.ts` (the policy per platform, the release page URL, the prompts, and that the publish block names the repository the policy points at). CI checks the feed file exists for each platform before uploading.
