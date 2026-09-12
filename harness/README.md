# Harness — loop mode

Autonomous build loop. Each iteration:

1. Pick the next backlog task: `status: todo`, all `depends` done, lowest id.
2. Mark it `doing`. Build a prompt = task file + pointers to CLAUDE.md/spec + gate commands.
3. Run `claude -p` (headless Claude Code, docs: https://code.claude.com/docs/en/headless) with scoped allowed tools.
4. Run deterministic gates in `app/` (typecheck, lint, unit; e2e if the task says so). The agent is told to run them too, but the harness re-runs them itself — the harness result is the truth.
5. Green → mark `done`, `git commit` the whole tree, append `PROGRESS.md` + `harness/metrics.jsonl`.
6. Red → repair attempt: re-invoke the agent with the gate output (max `maxRepairAttemptsPerTask`). Still red → mark `blocked`, write `NEEDS-HUMAN.md`, park the partial work on a side branch (`onBlocked: "branch"`, named `loop/blocked/<id>-<timestamp>`), return the working tree to the last green commit, continue with any independent task.
7. Stop when: no runnable tasks, `maxTasksPerRun` / `maxMinutesPerRun` hit, or a `STOP` file exists in the repo root.

## Usage

```bash
node harness/loop.mjs             # full run
node harness/loop.mjs --once      # one task
node harness/loop.mjs --dry-run   # print the plan, run nothing
node harness/loop.mjs --task T007 # force a specific task
touch STOP                        # graceful stop after current task
```

First run, once:

```bash
cd app && npm install && npx playwright install chromium
git config user.name "you" && git config user.email "you@example"
```

## Resuming a blocked task

`NEEDS-HUMAN.md` and `PROGRESS.md` name the branch holding the partial work. To continue from it:

```bash
git switch loop/blocked/T011-2026-09-12T06-19-08   # inspect / fix by hand, or:
node harness/loop.mjs --task T011                   # let the agent finish on that branch
git switch main && git merge loop/blocked/T011-...  # once green
```

Or leave the branch alone, set the task back to `status: todo`, and rerun the loop for a fresh attempt.

`onBlocked` accepts `"branch"` (default), `"reset"` (old behaviour: `git reset --hard`, work lost) or `"keep"` (leave the dirty tree in place; only sensible with `--once`).

## Design notes

- Gates are non-LLM and sit between every agent action and every commit — red output cannot compound into later tasks.
- Per-task commits on green keep the tree resumable and reviewable (`git log --oneline`).
- Review model is your choice: run the loop on a branch (`git switch -c loop/v1`) and review the diff/PR, or let commits land on main for a personal project. The harness does not care which.
- Escalation over stalling: ambiguous tasks get a best-guess implementation with the assumption recorded in the task Notes; hard failures escalate to `NEEDS-HUMAN.md` rather than looping forever.
- `--allowedTools` is deliberately scoped (edits + the gate commands + npm install). Widen it consciously, not by default.
- Watch `harness/metrics.jsonl` over time: repairs-per-task and cost-per-task trending down means the conventions/backlog are improving; trending up means a task is under-specified — fix the task file, not the agent.
