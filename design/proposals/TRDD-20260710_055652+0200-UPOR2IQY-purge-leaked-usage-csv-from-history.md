---
trdd-id: UPOR2IQY
title: Decide how to purge the leaked usage-export CSV from public git history
column: proposal
created: 2026-07-10T05:56:52+0200
updated: 2026-08-22T15:01:54+0200
current-owner: ai-maestro-session
created-by: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: M
task-type: security
labels: [security, privacy, git-history, public-repo]
parent-trdd: null
npt: []
eht: []
min-approval-requirement: user
mandate: false
approved: false
relevant-rules: []
release-via: none
audit-requirements: [security-scan]
review-requirements: [human-review]
impacts: []
external-refs: []
---

# TRDD-UPOR2IQY — purge the leaked usage-export CSV from public git history

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**Blocked on the USER. Nothing here may be executed without an explicit, exact,
approved command.** Every option below is irreversible, outward-facing, and touches
the history of a public repository — Tier 3 by every trigger in the ladder.

The already-done, reversible half landed as `186322e8`: `logs_dev/` added to
`.gitignore` and the file untracked with `--cached` (it stays on disk; nothing was
deleted). That closed the gap and took the blob out of this branch's tip, so it can no
longer reach `main` by a merge. **It did not undo the exposure.**

## What leaked

`logs_dev/usage-export-2026-03-22.csv` — committed 2026-03-23 in `26d958ed`
("fix: cross-platform issues in plugin scripts"), 1.5 MB, 10,274 data rows.

| Column | What it exposes |
|---|---|
| `repo` | the absolute path of every project on the owner's machine (`/Users/<user>/agents/…`, `/Users/<user>/Code/…`) |
| `account` | the owner's **private** email address — the one `CLAUDE.md` deliberately keeps out of git by configuring the `…@users.noreply.github.com` committer identity |
| `timestamp`, `model`, `input_tokens`, `output_tokens` | a per-request activity trace: when the owner works, on what, with which model |

`Emasoft/ai-maestro` is **PUBLIC**. Verified: `gh repo view … --json visibility` →
`PUBLIC`. Exposed since 2026-03-23 — roughly 3.5 months.

No credentials, tokens, or keys are present. The commit author/committer emails
throughout history are correctly the noreply address; the private address leaks *only*
through this file's contents.

## Blast radius

`26d958ed` is reachable from **34 pushed branches** on the public fork:

| Class | Count | Examples |
|---|---|---|
| Stale / disposable | 27 | `fork/p0-*`, `fork/worktree-agent-*`, `fork/backup/*` |
| Live or meaningful | 7 | `fork/governance-rules`, `fork/feature/team-governance`, `fork/feature/jsonl-session-browser`, `fork/batch3-proposals-r6-extensions`, … |

Not present on `fork/main` nor on the upstream `origin/main` (23blocks-OS). Nothing in
the repo references the file, so removing it breaks nothing.

## The options

**A — accept the residual.** Do nothing further. The untrack already prevents the file
reaching `main`. Cost: the address and the activity trace stay permanently readable via
the history of those 34 branches, and via anyone's existing fork or clone.

**B — delete the stale branches, rewrite the live ones.** Delete the 27 disposable
remote branches (they are leftovers of past worktrees and p0 fixes; confirm none is
load-bearing first). Then rewrite the remaining 7 with `git filter-repo --invert-paths
--path logs_dev/usage-export-2026-03-22.csv` and force-push each. Cost: rewrites public
history — every open PR against those branches is invalidated, every existing clone
diverges, and `--force` push is on the forbidden list without an explicit
command-and-approval. Benefit: removes the blob from every branch this repo controls.

**C — B, plus ask GitHub Support to purge the unreachable objects.** After a rewrite,
GitHub still serves the old commit SHAs from its cache indefinitely; only Support can
expire them. Required if the goal is "the URL stops working", not merely "the branch no
longer contains it".

**What none of them can do:** a public repo is mirrored, forked, and scraped. Anyone who
cloned since March has the row. If the address matters, treating it as *disclosed* and
deciding whether to change it is the only remedy that does not depend on GitHub.

## Recommendation

**C, scoped down.** Start by deleting the 27 stale branches — that is 79% of the blast
radius removed with no history rewrite and no force-push, and those branches have no
value. Re-measure; if the remaining 7 justify it, rewrite and force-push only those,
then file the Support request. If the USER judges the address not worth a rewrite, **A**
is a defensible choice and this TRDD closes as `refused` — but that should be a decision
on the record, not the default that happens by not deciding.

## What must NOT happen without the USER's exact approved command

- Any `git push --force` / `--force-with-lease`.
- Any `git filter-repo`, `filter-branch`, or BFG run.
- Any deletion of a remote branch.

## Approval log

- 2026-07-10T05:56:52+0200 — FILED by ai-maestro-session (min-approval-requirement: user).
  The reversible half (`.gitignore` + untrack) was executed as Tier-0 harm reduction and
  is already pushed (`186322e8`). Everything in this TRDD is Tier 3: irreversible,
  public-facing, and touching shared identity. Standing by.

## Notes and lessons learned

## RE-MEASURED 2026-08-22T15:0x — the "not on main" premise is STALE, and it understates severity

Verified first-hand, metadata only — the blob's CONTENT was never read, printed, or copied:

```
git cat-file -t 0b72a0d2        → blob
git cat-file -s 0b72a0d2        → 1525763              (~1.5 MB)
path in history                 → logs_dev/usage-export-2026-03-22.csv
git branch -r --contains <c>    → fork/main, fork/HEAD, fork/governance-rules
git check-ignore -v <path>      → .gitignore:134  logs_dev/
```

**It is reachable from `fork/main`, and `fork` is `Emasoft/ai-maestro` — a PUBLIC repo.** Any
statement in this card that the blob sits only on side branches is superseded: it is on the
default branch of a public repository.

**The recurrence is closed; the blob was never purged.** The path is gitignored today, and one of
the commits touching it is titled *"fix(gitignore): a _dev folder was tracked, and it published
private data"* — so the leak was stopped going forward and the history was left as it was. That is
the ordinary shape of this bug, and it is why a card like this goes stale in the SAFE-sounding
direction: everything visible looks fixed.

**Still OWNER-ONLY, and nothing was attempted.** A history purge is irreversible and rewrites a
published branch — Tier 3 by any reading, and doubly forbidden to this session (no push, no
history rewrite). Recorded here rather than acted on.

**Re-derive rather than trust these lines** — a reachability fact has a silent timestamp:
`git branch -r --contains $(git log --all --format=%H --find-object=0b72a0d2 | head -1)`
