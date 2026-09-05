---
trdd-id: D552QXOU
title: The janitor TRDD id matcher cannot parse legacy v1 filenames so those cards vanish from four detectors
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T04:40:10+0200
updated: 2026-09-05T04:40:10+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: unassigned
task-type: bugfix
priority: 2
severity: medium
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-05T04:40:10+0200
blocked-by: []
npt: []
eht: []
parent-trdd: UAP7ZEJL
derived: true
derived-kind: eht
labels: [janitor, upstream, trdd-tooling, board-reporting]
external-refs: [TRDD-UAP7ZEJL]
---

# The janitor TRDD id matcher cannot parse legacy v1 filenames so those cards vanish from four detectors

## ⏵ STATE — READ THIS FIRST — 2026-09-05

**The defect is PROVEN and its local symptom is already fixed. What is open is a DECISION about
method, in another repo.** TRDD-UAP7ZEJL diagnosed it and renamed this project's two affected
files (`f6f4664e`), so ai-maestro is currently clean. The matcher is unchanged, so the defect
recurs the moment anyone adds a card with a legacy-shaped name.

**The defect.** `_TRDD_ID_RE` in the janitor's `scripts/lib/trdd_common.py` (v3.4.14, ~line 196)
admits exactly two filename shapes:

```
TRDD-<YYYYMMDD_HHMMSS±HHMM>-<id8>-<slug>.md     # current spec
TRDD-<36-char UUID>-<slug>.md                    # legacy UUID
```

A `v1-migrated` card named `TRDD-<8hex>-<slug>.md` — no timestamp segment, an 8-char id rather
than a 36-char UUID — matches **neither** branch, so `extract_uid` returns `None`.

**What that costs.** Verified site-by-site on 2026-09-05 (see UAP7ZEJL for the full table): four
of the five files under `janitor/scripts/detectors/` that read TRDD files gate on a non-`None`
uid and silently skip the card — `trdd-drift.py` (5 sites), `trdd-reminder.py:190`,
`trdd-cross-card-blindspot.py:245`, and `trdd-state-reconciliation.py:481` (indirectly, via
`trdd_common.parse_trdd_record:764`). `dispatch.py::_board_summary_bit` drops it from the board
count too. Only `report-to-trdd-drift.py` sees it, because it substring-matches against
concatenated card *text* and never touches the id.

**Why it is a bug and not a naming preference: every affected card carries a valid `trdd-id:` in
its own frontmatter.** The id is present and readable; the matcher keys on the filename anyway.
A card can therefore be fully spec-conformant in content and invisible to the tooling.

## Why this is worth its own card

UAP7ZEJL fixed the DATA (two files renamed). This is the fix to the INSTRUMENT, and it belongs
to a different repository — `Emasoft/ai-maestro-janitor` — so it cannot be done from here. Left
as a sentence in a chat log it would be lost; the whole point of a card is that it survives the
conversation that produced it.

## The decision the USER owns

Per `~/.claude/rules/how-to-fix-issues-of-other-projects.md`, a bug in another project has
exactly two permitted routes, and the choice is the user's:

1. **File an issue** on `Emasoft/ai-maestro-janitor` describing the symptom and the reproducer.
   Recommended default — the fix touches an id matcher three detectors share, which is the
   maintainer's call to scope.
2. **Fork → clone to `/tmp` → fix → push → PR.** Only if the user explicitly asks for the patch
   to be authored here.

**Neither has been done.** Nothing in this repo may be edited to fix it, and the janitor's
working tree must not be touched.

## The fix, if it goes upstream

Widen `_TRDD_ID_RE` to admit the bare-8-char legacy shape, e.g. a third alternative
`([0-9A-Za-z]{8})` guarded so it cannot swallow the timestamp branch. Note the existing comment
above that regex already says the matcher was consolidated (TRDD-15ECPBSA) *so that stale v2
TRDDs would stop being dropped* — this is the same class of failure the consolidation was meant
to end, one shape further back.

## Reproducer

```bash
# In any project with a janitor-managed board:
touch 'design/tasks/TRDD-deadbeef-some-legacy-card.md'   # add valid frontmatter with column: todo
# The card is absent from the heartbeat's `open board: N in todo`,
# and from trdd-drift / trdd-reminder / trdd-cross-card-blindspot / trdd-state-reconciliation.
```

## Acceptance

- [ ] The user chooses route 1 (issue) or route 2 (fork+PR), or declines both
- [ ] If route 1: the issue is filed on `Emasoft/ai-maestro-janitor` with the symptom, the
      reproducer above, and the downstream impact, and its URL is recorded here
- [ ] If route 2: the PR is opened from a fork cloned to `/tmp`, never from a local edit of the
      janitor's tree, and its URL is recorded here
- [ ] If declined: the reason is recorded here and this card is closed as `cancelled`, so the
      known-latent defect is on the record rather than forgotten

## Approval log

- 2026-09-05T04:40:10+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: authoring a TRDD is an EXEMPT intake operation, and this card only RECORDS a
  proven defect plus the routes for fixing it — it changes no other project's source and
  performs no cross-repo action. The route itself is a USER decision and is left open above.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
