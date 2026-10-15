---
name: evolve-workspace
description: Add or revise TOKI workspace folders, AGENTS guidance, skills, document routing, or source-of-truth boundaries. Use for architecture and workflow evolution after checking existing structure; do not use to invent unrelated frameworks or adapters.
---

# Evolve the workspace

1. Read `docs/architecture/extension-policy.md`, directory-map.md, source-of-truth.md, and the applicable AGENTS files. Check current files before assuming the workspace is empty.
2. Classify the proposed information: implementation, formal spec, decision, original source, derived knowledge, task, short-term memory, or reusable procedure. Prefer an existing location with the same responsibility and lifecycle.
3. Define ownership, authoritative scope, read timing, write rules, Git visibility, and lifecycle. Keep the root AGENTS short and route to details; avoid mandatory reading of all context files.
4. Apply WORKFLOW risk and approval rules. Preserve the existing TOKI source layout, public URL, remote, runtime behavior, dependencies, and CI unless their change is explicitly in scope.
5. For Codex-specific behavior, verify current official documentation. Distinguish native discovery from repository conventions; do not claim automatic loading of SOUL, USER, MEMORY, or task records.
6. Create a nested AGENTS only for genuinely distinct local rules. Create a Skill only for a reusable workflow, with clear name/description triggers and minimal resources. Do not add speculative adapters for other tools.
7. Update directory-map, the relevant source-of-truth entries, and necessary indexes. Record lasting architectural tradeoffs in an ADR.
8. Validate local links, Skill format, private-path ignore behavior, staged content, and any affected build/publication boundaries. For documentation-only changes, demonstrate app artifacts remain unchanged without inventing runtime changes.

Deliver an understandable map and accurate verification evidence. Do not automatically promote private work records to shared documentation or archive a task without human acceptance.
