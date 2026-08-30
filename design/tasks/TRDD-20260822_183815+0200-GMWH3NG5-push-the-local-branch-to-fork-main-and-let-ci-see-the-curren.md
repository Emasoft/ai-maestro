---
trdd-id: GMWH3NG5
title: Push the local branch to fork main and let CI see the current tree
column: todo
blocked-by: []
blocker-probe: sh -c 'git branch -r --contains HEAD 2>/dev/null | grep -q "fork/main" && echo on-fork-main || echo not-pushed'
blocker-holds-if: not-match:on-fork-main
created: 2026-08-22T18:38:15+0200
updated: 2026-08-30T02:17:14+0200
current-owner: user
created-by: user
task-type: infra
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T18:38:15+0200
assignee: ai-maestro-hub
priority: 1
labels: [ci, main-branch, owner-act, durability, hub-blocked]
external-refs: [TRDD-N4SDG0ML]
---

# Push the local branch to fork main and let CI see the current tree

# Push the local work to `fork/main` and let CI see the current tree

Descoped out of **TRDD-N4SDG0ML** (make-main-ci-green), whose last two acceptance boxes were
gated on this act and on nothing else. Filed because that card's own words are exactly right:
*a green run on a stale `main` is a true statement about the wrong tree.*

## The measurement (re-derive it — the numbers below have a silent timestamp)

```bash
gh run list --repo Emasoft/ai-maestro --branch main --limit 5 \
  --json status,conclusion,name,createdAt,headSha
git rev-list --left-right --count fork/main...HEAD
git rev-parse --abbrev-ref HEAD
```

Taken 2026-08-22T18:5x+0200:

- `fork/main` CI — the five most recent runs are **all `success`**, newest
  `2026-08-21T18:09:28Z` at `f75f72fa`.
- `git rev-list --left-right --count fork/main...HEAD` → **`0  157`**. Local `governance-rules`
  is **157 commits ahead** of `fork/main`, 0 behind.

So the newest green describes a tree that is missing 157 commits of local work. CI has never
run any of it.

## Why an agent cannot do this

`Emasoft/ai-maestro` is **PUBLIC**, and *never push to a shared repository unless explicitly
told* is a standing prohibition that the owner's decide-on-my-behalf delegation does not
revoke (it was re-confirmed verbatim alongside the never-touch-`23blocks-OS` limit). The act
is also owner-identity-facing, which is the D3 objective floor for `min-approval-requirement:
user`. This is a gate on AUTHORITY, not on effort — the work itself is one command.

## The second-order fact that makes this bigger than a push

`vitest.config.ts` on `main` includes `tests/**/*.test.ts`, and **`origin/main` holds 30 test
files while this branch holds 432**. Whenever this branch reaches a CI-visible `main`, roughly
400 files reach GitHub CI for the FIRST time — which is precisely the event that created
N4SDG0ML in the first place, about to repeat at ~13x. Expect a red first run and budget for
it; a red run here is the system working, not a regression.

Note the branch also carries the class-3 files N4SDG0ML named
(`cli-help-exit-contract`, `teams-stats-verb`, `check-decoupling-blank-is-not-a-finding`,
`oauth-rotator-supervisor`). They pass locally on macOS; their green on a Linux runner has
been **assumed from their absence**, never observed. The historical signatures were
HOME-relative fixtures (`EACCES mkdir '/home/.claude'`) and an incomplete mock — fix the
FIXTURES if they redden, never the tests.

## Do NOT

- Do not touch `23blocks-OS/ai-maestro` in any way (no push, no PR, no issue) — standing
  owner prohibition.
- Do not rewrite history to make the push smaller.
- Do not force-push.

## Acceptance

- [ ] The owner authorizes and performs the push of the current branch to `Emasoft/ai-maestro`
- [ ] A CI run exists whose `headSha` equals the pushed local HEAD (not an older `main`)
- [ ] That run is green, or every failure it surfaces is triaged into its own card with the
      per-file isolation rule applied (never diagnosed from the interleaved suite log)

## Approval log

- 2026-08-30T02:17:14+0200 — column UNCHANGED (`todo`); a runnable canaried probe added, and one
  measurement recorded. **A `todo` → `blocked` move was attempted here and REVERTED**, because the
  premise was wrong and the linter is the thing that said so — worth writing down so the next
  session does not re-attempt it.
  The reasoning was: box 1 is *"the owner authorizes and performs the push"*, an act no agent may
  perform, so a card asserting `todo` looked like it was claiming agent-pickable work.
  `BLOCKED-WITHOUT-BLOCKER` refused it: `column: blocked` REQUIRES a non-empty `blocked-by:`
  naming a real TRDD, and `GRAPH-UNKNOWN-BLOCKER` refused a free-text blocker
  (`owner-act-push-to-fork-main` was truncated to `OWNER-AC` and demanded to exist). So **in this
  corpus `blocked` means "blocked on another CARD", and `todo` does NOT assert agent-workability**
  — it asserts open-and-not-card-blocked. By that model this card was never lying, and the four
  sibling `owner-act` cards (`YUK66AJO`, `N6V7WB69`, `L58QB3FR`, `WMNE9OU3`) are not either.
  Minting a blocker card whose only content is "the owner must push" would be ceremony duplicating
  box 1, so it was not done. The `approval` column is not the answer either: this card is already
  `approved: true` (USER mandate), so parking it there would contradict its own approval record —
  which is why the `2LIS20K1` precedent does not transfer (that card carries no `approved:` field).
  **What IS new and verified:** `git branch -r --contains HEAD` returns **nothing** — HEAD
  `7c6b364e` is on no remote branch at all — and `fork/main` is at `f75f72fa`. CI has never seen
  this tree; the block is real and current, only not expressible as a `blocked-by:` edge.
  The probe is canaried the safe way (`not-match:`): a timeout or a moved path yields no
  `on-fork-main`, so it reads as STILL-BLOCKED rather than as cleared (`BLOCKER-PROBE-NO-CANARY`
  — a bare `match:` here would have been fail-open). Positive-controlled: it prints `not-pushed`.
- 2026-08-22T18:38:15+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.

### Fleet addition — 2026-08-22T20:03:45+0200 — ai-maestro-chief-of-staff

COS first reported figures for the wrong repo (they measured `~/ai-maestro`, the server repo,
because the drain task was there), then re-measured their own plugin repo and retracted. Their
corrected, first-hand numbers:

- **repo:** `Emasoft/ai-maestro-chief-of-staff` · **branch:** `main` → `origin` · tree clean
- **6 commits ahead**, fast-forward, no version bump needed (plugin.json already 2.32.7)
- HEAD `2086f63d` returns HTTP 422 *"No commit found for SHA"* — genuinely absent from GitHub
- three TRDDs are stranded behind it (EZUFLTOL, P4OB78ST, 3ICG52TO)

Caveat they flagged: their working tree carries one uncommitted modification in a **sibling** repo
(`emasoft-chief-of-staff`), unrelated; `ai-maestro-chief-of-staff` itself is clean, so pushing it
carries nothing of theirs.

**This is a REQUEST for the owner, not an authorization.** Neither COS nor this session may push.
