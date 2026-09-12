# Backlog

One file per task, worked in dependency order. The harness (and humans) obey the same format.

Front matter fields:
- id: T001            unique
- title: ...
- status: todo | doing | done | blocked | icebox
- depends: [T001]     tasks that must be done first
- e2e: true|false     whether the e2e gate runs for this task

Body sections: **Goal**, **Acceptance criteria** (checkboxes), **Test requirements**, **Notes** (agent appends assumptions/decisions here).

Rules: only the harness or a human flips status. Icebox tasks (v2/v3) are parked, not scheduled.
