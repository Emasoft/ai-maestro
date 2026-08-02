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

**Check it — a clone that skipped this step silently gets none of these hooks:**

```bash
git config --get core.hooksPath      # want: .githooks
```

If it prints `.git/hooks` (or nothing), this directory is inert on your machine: `.git/hooks/`
holds only the `git lfs install` boilerplate, so you are missing the pre-push report archiving and
the post-checkout data-loss warning, and editing a file in here changes nothing for you. That was
the state of the primary checkout until 2026-08-02, which is exactly how a tracked hook can look
maintained and be dead.

## Hooks

| Hook | What it does |
|------|--------------|
| `pre-push` | 1. Auto-archives reports older than 48h from `reports/` to `reports_dev/` and auto-commits the move. 2. Delegates to Git LFS pre-push. |
| `post-checkout` | 1. Warns when a **file** checkout just overwrote the working tree (see below). 2. Delegates to Git LFS post-checkout (preserves LFS smudge). |
| `post-commit` | Delegates to Git LFS post-commit. |
| `post-merge` | Delegates to Git LFS post-merge. |

## Notes

- The `pre-push` archive step refuses to run if `reports/` has uncommitted
  changes, to protect in-flight work. Commit or stash first.
- All Git LFS logic is preserved — this layout does not drop LFS support.
- The archive threshold is controlled by `ARCHIVE_THRESHOLD_DAYS` (default
  `2` = 48 hours). See `.claude/scripts/archive-old-reports.sh`.

## The post-checkout data-loss warning

`git checkout -- <path>` and `git restore <path>` overwrite the working-tree file from the index
and print nothing. Unstaged content has no reflog, so there is no undo. Git prompts before a
*branch* switch would lose changes; for the pathspec form it stays silent, because discarding is
precisely what that command means.

The case that bites is when it is not what you meant: reverting a deliberate **temporary** edit —
a neutered guard, a debug print — in a file that also holds real uncommitted work. The revert
cannot tell them apart and takes both. On 2026-08-02 that cost four edits in this repo, and the
worse half was that the next test run then measured the *original* code and reported green,
hiding the loss inside the very output meant to catch mistakes.

Git passes a third argument: `1` = branch checkout, `0` = file checkout. Combined with HEAD not
moving, that is exactly the destructive shape, and the hook warns on it and appends a line to
`.git/file-checkout-audit.log` (bounded to the last 500 entries).

**This hook cannot PREVENT the loss** — git has no `pre-checkout` hook, so by the time it runs the
content is already gone. Do not mistake it for a safety net; what it buys is time-to-notice.
Prevention lives one layer up, where a command can still be refused:

| layer | what it does |
|---|---|
| `scripts/dev/neuter` | refuses to neuter a file that has uncommitted changes, and restores by verified blob hash |
| `.claude/scripts/git-restore-guard.sh` | `PreToolUse(Bash)` — blocks a restore whose target path is dirty (escape: `AIM_ALLOW_DIRTY_RESTORE=1`, or `# discard-ok`) |

The hook never exits non-zero on its own account: a failing `post-checkout` breaks LFS smudge for
every checkout in the repo, which is far worse than a missed warning.
