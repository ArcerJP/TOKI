---
name: research-plan-implement
description: Investigate and deliver nontrivial TOKI code, architecture, security, data, or infrastructure changes. Use when a change spans files, has uncertain behavior, or needs a plan and meaningful verification; apply lighter handling to clear local edits.
---

# Research, plan, implement

1. Read the root AGENTS and the target area's AGENTS, then the relevant spec and source. Use `work/WORKFLOW.md` for risk classification and `docs/architecture/source-of-truth.md` for conflicting evidence.
2. For L2/L3 work, create or resume a task with task-lifecycle. Research unknowns using current primary sources and code evidence. Distinguish observations, assumptions, and recommendations; ask about unresolved requirements before dependent implementation.
3. Write a proportional plan covering scope, exclusions, steps, acceptance, verification, and rollback. L3 needs research and human authorization; the user's existing explicit request can authorize the same scope. Record its basis accurately.
4. Implement the smallest coherent change in the actual source tree. Preserve unrelated user edits, existing app layout, and authorized product behavior. Do not change auth, live data, dependencies, or publication scope incidentally.
5. Verify the intended behavior and relevant regressions. Use existing test commands and necessary checks; do not add tests that only mirror the implementation or document headings. Record untested portions honestly.
6. Review the diff for scope, security, privacy, consistency, and maintainability. Update the appropriate formal spec or ADR, avoiding copies of raw research.
7. Handoff the result and remaining limitations. Use git-workflow for any authorized commit, push, or PR action.

Changing a plan does not create user authorization for additional risk. Pause dependent actions if scope expands into unapproved publication, secrets, destructive changes, or personal data access.
