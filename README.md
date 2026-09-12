# TableMap

Battle-map + fog-of-war software for a TV tabletop. DM view runs on a laptop (Windows/macOS/Linux), player view full-screens on the table TV via a second browser window. Local-first web app — no backend, no accounts.

**Using it:** [`docs/user-guide.md`](docs/user-guide.md) starts with a quick start that takes a new user from a clean clone to a fogged map on the TV. Full product spec: [`docs/spec.md`](docs/spec.md). Architecture: [`docs/architecture.md`](docs/architecture.md).

## Layout

```
app/       The application (Vite + React + TypeScript + Konva)
backlog/   Ordered task files — the build plan, one file per task
harness/   Loop-mode agent harness that works through the backlog
docs/      Spec, architecture, ADRs, user guide (docs-as-code)
```

## Run the app

Prerequisites: [Node.js](https://nodejs.org) 20 or newer (developed on Node 22) with npm, git, and a current browser (Chrome, Edge or Firefox; tested in Chromium).

```bash
git clone <this repository>
cd tablemap/app
npm install
npm run dev        # open the printed URL (http://localhost:5173/), / -> campaign manager
```

The DM view opens the player window for you; drag that window onto the TV. The whole flow — import, grid alignment, calibration, fog — is in the [user guide](docs/user-guide.md).

To run it without the dev server:

```bash
npm run build      # static site in app/dist
npm run preview    # serve app/dist locally to check it
```

## Develop

Gates (must be green before any task is "done"):

```bash
npm run typecheck && npm run lint && npm run test   # fast gates
npm run e2e                                         # Playwright (needs: npx playwright install chromium)
npm run e2e:headed                                  # the same suite in a visible browser
```

The unit suite includes `src/docs.test.ts`, which fails when this README, the user guide, the architecture doc or the ADRs drift from the app (scripts, file paths, ADR numbers, schema version, dependencies, the UI labels the guide quotes). Update the docs with the code.

## Run the build loop (harness)

Prereq: [Claude Code](https://code.claude.com/docs/en/headless) installed and authenticated, git repo initialised with a clean working tree.

```bash
node harness/loop.mjs            # work through backlog until done/blocked/budget
node harness/loop.mjs --once     # single task, then stop
node harness/loop.mjs --dry-run  # show what would run
touch STOP                       # graceful stop after current task
```

The harness picks the next `status: todo` task whose dependencies are done, hands it to `claude -p` with the task file + `CLAUDE.md` conventions, runs the gates, commits on green, and escalates to `NEEDS-HUMAN.md` on repeated red. Progress ledger: `PROGRESS.md`; per-attempt metrics: `harness/metrics.jsonl`. Details in [`harness/README.md`](harness/README.md).

## Working on it by hand

Same rules as the agent: pick a task, keep gates green, update the task file status, commit per task. Conventions in [`CLAUDE.md`](CLAUDE.md).
