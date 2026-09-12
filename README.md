# TableMap

Battle-map + fog-of-war software for a TV tabletop. DM view runs on a laptop (Windows/macOS), player view full-screens on the table TV via a second browser window. Local-first web app — no backend, no accounts.

Full product spec: [`docs/spec.md`](docs/spec.md). Architecture: [`docs/architecture.md`](docs/architecture.md).

## Layout

```
app/       The application (Vite + React + TypeScript + Konva)
backlog/   Ordered task files — the build plan, one file per task
harness/   Loop-mode agent harness that works through the backlog
docs/      Spec, architecture, ADRs, user guide (docs-as-code)
```

## Run the app

```bash
cd app
npm install
npm run dev        # open the printed URL, / -> campaign manager
```

Gates (must be green before any task is "done"):

```bash
npm run typecheck && npm run lint && npm run test   # fast gates
npm run e2e                                         # Playwright (needs: npx playwright install)
```

## Run the build loop (harness)

Prereq: [Claude Code](https://code.claude.com/docs/en/headless) installed and authenticated, git repo initialised with a clean working tree.

```bash
node harness/loop.mjs            # work through backlog until done/blocked/budget
node harness/loop.mjs --once     # single task, then stop
node harness/loop.mjs --dry-run  # show what would run
touch STOP                       # graceful stop after current task
```

The harness picks the next `status: todo` task whose dependencies are done, hands it to `claude -p` with the task file + `CLAUDE.md` conventions, runs the gates, commits on green, and escalates to `NEEDS-HUMAN.md` on repeated red. Progress ledger: `PROGRESS.md`; per-attempt metrics: `harness/metrics.jsonl`.

## Working on it by hand

Same rules as the agent: pick a task, keep gates green, update the task file status, commit per task. Conventions in [`CLAUDE.md`](CLAUDE.md).
