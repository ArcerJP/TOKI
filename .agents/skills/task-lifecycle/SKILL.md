---
name: task-lifecycle
description: Manage a TOKI task from intake through research, implementation, handoff, and human acceptance. Use for substantial changes, resuming work, or moving a task between inbox, notebook, outbox, and archive; skip task folders for simple read-only answers.
---

# Task lifecycle

1. Read `work/AGENTS.md` and `work/WORKFLOW.md` from the repository root. Inspect the relevant task only; do not scan private records without a need.
2. Reuse an existing task when continuing the same objective. Otherwise assign `TASK-YYYYMMDD-short-kebab-description` and use the request template for scope, constraints, acceptance, and open questions.
3. Match the task folder location to request.status. Move the whole folder instead of copying it. Verify resolved paths stay within the intended work directories before any move.
4. Apply proportional research and planning based on WORKFLOW risk. Record actual user authorization; do not invent approvals or repeat an already granted approval within the same scope.
5. Keep code in its real source location. Keep research, plans, and evidence in the task. Promote only lasting, publication-safe information to formal docs.
6. Before handoff, record delivered behavior, checks, limitations, decisions, and next action using the handoff template. Move completed agent work to outbox.
7. Move to archive only after human acceptance. If revision is requested, return to notebook and preserve the prior result as context.

Dynamic task files are private by default. Do not force-add them or transfer their contents to a public PR without authorization and a content review. The workflow document is the authority for lifecycle rules; do not duplicate it here.
