---
name: git-workflow
description: Review, stage, commit, push, or prepare a pull request for authorized TOKI changes while preserving existing history and private workspace records. Use before Git publication operations or when resolving repository workflow questions.
---

# Git workflow

1. Inspect `git status --short --branch`, the current diff, and the existing remote. Preserve user changes. Reuse the existing repository and authorized destination; do not reinitialize Git or change account settings unnecessarily.
2. Confirm publication is within the user's request or existing authorization. Public repositories require review of the exact outgoing content. Do not require a second approval for an already authorized push of the same scope.
3. Run checks appropriate to the changes. Keep generated files, raw sources, dynamic work records, personal settings, real schedules, and secrets out of staging. Use `git check-ignore` for new exclusion rules; ignore rules do not untrack existing files.
4. Stage explicit paths. Inspect `git diff --cached --stat`, `git diff --cached`, and `git diff --cached --check`. Confirm no unrelated changes or sensitive data are included.
5. Use a concise Conventional Commit message describing the final change. Never force-push, rewrite shared history, or discard edits without explicit authority.
6. Push only to the established authorized branch or prepare a PR according to the task. Use `.github/PULL_REQUEST_TEMPLATE.md` when applicable; write multiline bodies through a structured argument or body file. Never include private task contents or secrets.
7. Confirm remote/CI state and report what is verified, failed, or pending. If a PR is created in Codex, attach its actual URL with the available artifact tool.

If login or a privilege is missing, complete local reviewable work first and identify the exact blocker. Do not print tokens or request secrets in chat. `.gitignore` is a guard against accidental staging, not an access-control system.
