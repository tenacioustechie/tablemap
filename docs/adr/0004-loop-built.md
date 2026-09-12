# ADR 0004 — Built by a gated agent loop
Status: accepted

The app is built by an autonomous loop (harness/) working through an ordered backlog. Deterministic non-LLM gates (typecheck, lint, unit, e2e) sit between the agent and every commit; red gates trigger bounded repair attempts, then human escalation via NEEDS-HUMAN.md. Rationale: verification before orchestration — a loop with weak verification compounds mistakes. The backlog, gates and conventions (CLAUDE.md) are the product as much as the code.
