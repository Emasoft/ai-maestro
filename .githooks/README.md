# .githooks/ — project-scoped git hooks

Git hooks that ship with this repo. Unlike `.git/hooks/` (which is per-clone
and not tracked), these are git-tracked so every developer gets the same
behavior on every clone.

## One-time activation (per clone)

After cloning the repo, run:

```bash
git config core.hooksPath .githooks
```

That tells git to look for hooks in this directory instead of `.git/hooks/`.
A tracked `scripts/setup-git-hooks.sh` (if present) performs this config.

## Hooks

| Hook | What it does |
|------|--------------|
| `pre-push` | 1. Auto-archives reports older than 48h from `reports/` to `reports_dev/` and auto-commits the move. 2. Delegates to Git LFS pre-push. |
| `post-checkout` | Delegates to Git LFS post-checkout (preserves LFS smudge). |
| `post-commit` | Delegates to Git LFS post-commit. |
| `post-merge` | Delegates to Git LFS post-merge. |

## Notes

- The `pre-push` archive step refuses to run if `reports/` has uncommitted
  changes, to protect in-flight work. Commit or stash first.
- All Git LFS logic is preserved — this layout does not drop LFS support.
- The archive threshold is controlled by `ARCHIVE_THRESHOLD_DAYS` (default
  `2` = 48 hours). See `.claude/scripts/archive-old-reports.sh`.
