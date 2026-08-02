---
trdd-id: RTHFRI4P
title: 33 wiki lessons carry no keywords so recall cannot find them
column: human_review
scope: project
project-id: ai-maestro
created: 2026-08-02T18:06:52+0200
updated: 2026-08-02T18:41:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T18:06:52+0200
severity: medium
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [wikimem, recall, tech-debt]
---

# 33 wiki lessons carry no keywords so recall cannot find them

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

`memgrep lint .claude/project/memory/` reports **33 × `lesson-no-keywords`** and **33 ×
`lesson-no-id`** (the same 33 footnotes — an older lesson form), plus **4 × `atom-oversized`**.
Zero ERRORs; these are all WARN.

**Why this is not cosmetic.** `~/.claude/rules/markdown-memory-recall.md` states it plainly:
`keywords:` is the RECALL SURFACE, and **"No keywords ⇒ no recall ⇒ the memory does not exist."**
So 33 lessons — each one a `DO NOT … BECAUSE … DO … instead` guardrail someone paid for by making
the mistake — are currently reachable only by a reader who already opened the right page. That is
the opposite of what a lesson is for: you need it when you do NOT yet know which page it is on.

**NEXT ACTION:** for each of the 13 pages below, rewrite its `[^N]` footnotes into the full atom
form — `[id:…, status:valid, keywords:"…", ocd:…, lmd:…]` — preserving the prose verbatim. The
`keywords:` must carry the **SYMPTOM phrases a future session will search with**, not the jargon of
the fix. Comma splits FIELDS, space splits KEY-PHRASES, so each phrase is `underscore_joined`;
written `a phrase, another phrase`, everything after the first comma is silently DROPPED.

**The pages** (all pre-existing — `ocd` June/July 2026; none of the 26 pages created by the
2026-08-02 CLAUDE.md migration are affected, they used the full form):

`agent-claims-the-api-was-never-delivered` · `agent-control-monitor-api` ·
`agent-launch-preconditions` · `an-unenforced-rule-produces-a-success-not-an-error` ·
`folder-adoption-import` · `governance-password-invalidation` · `marketplace-plugin-registration` ·
`plugin-install-no-git-tag-satisfying` · `session-control-subagent-gate` · `team-creation` ·
`token-optimization` · `trdd-conventions` ·
`two-server-modes-the-headless-router-reimplements-routes`

**DO NOT** reword or shorten a lesson while adding its keywords. The prose is the guardrail; this
task adds an address, it does not re-author the content. And do NOT delete a lesson to clear a
warning — an unfindable lesson is a bug, a deleted one is a loss.

## Problem

Found while closing TRDD-K8VC7J71 (the CLAUDE.md → wikimem migration). Chasing the link-law
warnings surfaced the rest of the WARN backlog, which had never been triaged — it was invisible
because every check anyone ran counted ERRORs only, and `memgrep lint` grades all of this WARN.
That is the same shape as the one-sided links: *"zero lint ERRORs"* was true, and told nobody
anything about whether the corpus was findable.

## Verification

```bash
memgrep lint .claude/project/memory/ 2>&1 | grep -c 'lesson-no-keywords'   # target: 0
memgrep lint .claude/project/memory/ 2>&1 | grep -c 'lesson-no-id'         # target: 0
memgrep validate .claude/project/memory/                                    # must stay exit 0
```

And the check that actually matters, per page touched: run
`memgrep recall "<a symptom the lesson addresses>" .claude/project/memory` and confirm the page
comes back. A keyword list that does not surface its own page under a plausible symptom query has
added an address to the wrong street.

## Estimated risk

LOW. Content-preserving edits to a git-tracked store, each one validated. No code, no runtime, no
dependency. The only way to do harm is to reword a lesson while re-addressing it.

## Acceptance

- [x] all 33 footnotes carry `id:`, `status:`, `keywords:`, `ocd:`, `lmd:`
- [x] `memgrep lint` reports 0 `lesson-no-keywords` and 0 `lesson-no-id` — verified independently
- [x] `memgrep validate` still exits 0
- [x] recall probed on 3 pages — 2 hit at rank 1, 1 at rank 3 (correct page)
- [x] no prose reworded — the diff's every deleted line is an old `[^N]: [ocd:` header (34 ins / 33 del)
- [ ] the 4 `atom-oversized` WARNs are triaged — split or explicitly accepted with a reason

## Approval log

- 2026-08-02T18:06:52+0200 — SELF-MANDATE (min-approval-requirement: none). A docs chore inside the
  authoring agent's own scope: no baseline deviation, no cross-team reach, no governance change,
  reversible. No approval request was sent.

## Outcome — 2026-08-02

All 33 addressed across 13 pages. **One defect found that the lint list did not name:** `[^7]` in
`agent-control-monitor-api.md` HAD a `keywords:` field but was missing the commas separating it from
`ocd:`/`lmd:`, so the parser never saw it — a lesson that looks addressed to a human reading the file
and is invisible to recall. That is the same failure class the field's own syntax rule warns about
(comma splits FIELDS, space splits PHRASES), and it is worse than a missing field because nothing
reports it. The `--check`-style guard for it is that `lesson-no-keywords` counts PARSED keywords,
not grep hits.

Remaining: the 4 `atom-oversized` WARNs, untouched — splitting an atom changes what a page asserts
and is a judgement call, not a mechanical pass.
