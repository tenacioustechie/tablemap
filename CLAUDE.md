# TableMap — Agent Conventions

You are building TableMap per `docs/spec.md`. Work on exactly ONE task per invocation — the task file content is in your prompt.

## Hard rules
1. Implement only the current task. Do not start other backlog tasks. Small, incidental refactors needed for the task are fine.
2. Definition of done = the task's acceptance criteria are met AND all gates pass:
   `cd app && npm run typecheck && npm run lint && npm run test` (plus `npm run e2e` when the task front matter says `e2e: true`).
3. Every task ships tests. New logic → unit tests (Vitest). New user-visible behaviour → extend/add Playwright e2e where the task asks for it. Never weaken, skip, or delete existing tests to get green; fix the code instead. If a test is genuinely wrong, change it and say so in the task file's Notes.
4. Docs are code. If behaviour, commands, or architecture change: update `docs/architecture.md`, `docs/user-guide.md`, and the task file's Notes section in the same change. New significant technical decisions get an ADR in `docs/adr/`.
5. Do not modify `harness/`, `backlog/` task statuses, or `CLAUDE.md` — the harness owns those.
6. Do not add dependencies beyond those listed in `docs/architecture.md` without recording an ADR justifying it.
7. If the task is ambiguous: make the lowest-risk reasonable assumption, implement it, and record the assumption under `## Notes` in your summary output. Do not stall.

## Stack (fixed — see ADRs)
Vite, React 18, TypeScript strict, Konva/react-konva (canvas), Zustand (state), BroadcastChannel (DM↔player sync), Dexie/IndexedDB (storage), JSZip (export), Vitest, Playwright, ESLint.

## Structure
- `app/src/state/` — store, sync protocol, persistence. Pure logic here, heavily unit-tested.
- `app/src/dm/` — DM view UI. `app/src/player/` — player view (render-only; must never import DM UI).
- `app/src/map/` — Konva stage, layers (map image, grid, fog, tokens, annotations).
- All DM→player communication goes through the typed message schema in `state/sync.ts`. No other channel.

## Style
- TypeScript strict; no `any` unless annotated with a reason.
- Player view is render-only: it receives state, it never mutates it.
- Fog is authoritative in the store as a mask bitmap + operation log for undo; rendering derives from it.
- Prefer plain functions + Zustand slices over classes.
