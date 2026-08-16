---
trdd-id: 5TELESBL
title: Five wikimem pages carry no metadata.topic and are unreachable from the generated index
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:32:44+0200
updated: 2026-08-16T21:39:15+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-16T20:32:44+0200
derived: true
derived-kind: eht
parent-trdd: BRRJK57P
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [6e08f2a2]
priority: 2
severity: medium
effort: S
labels: [memory, wikimem, discoverability, hub-self-audit]
external-refs: []
---

# Five wikimem pages exist, hold real knowledge, and cannot be found

## Problem

`node scripts/wikimem-index.mjs --check` exits 1 with **5 pages missing `metadata.topic:`**:

- `janitor-chore-absorbability`
- `model-scoped-window-fallback`
- `public-repo-personal-data`
- `settings-file-watcher-ledger`
- `trdd-d4-watchdog`

The topic index at the bottom of `CLAUDE.md` is **generated** from that field
(`node scripts/wikimem-index.mjs --write CLAUDE.md`). A page with no topic never appears in it, so
a reader navigating from the index — which is the documented front door, and the one CLAUDE.md
tells every session to use — cannot reach these five by that route.

## Root cause

Not measured. The field is required by the checker but nothing blocks a write without it, so a page
authored outside the `wikimem-index` flow acquires no topic and the gap is invisible until someone
runs `--check` by hand. Whether that is the mechanism here is unverified — five pages is a small
enough set to read their git history and find out, and that is part of this task rather than an
assumption to build on.

## Why this matters more than five missing fields

**A page that cannot be found has the availability of a page that does not exist.** This is the same
shape as the evening's largest finding, recorded on the parent card: `ATOM-DXFF-KOY4` already
carried the worker-liveness lesson in USER memory, and four sessions independently re-derived it in
one evening at roughly six worker-hours because recall never surfaced it. The knowledge existed and
the retrieval failed.

Here the retrieval failure is mechanical and cheap to fix, which is exactly why it should not be
left: the corpus is only worth its recall rate.

## Proposed fix

1. Read each of the five pages and assign the `metadata.topic:` its content actually warrants —
   **not** a topic guessed from the filename. A wrong topic files a page under a heading nobody
   with that symptom will look at, which preserves the defect while satisfying the checker.
2. Re-run `node scripts/wikimem-index.mjs --check` → must exit 0.
3. Regenerate: `node scripts/wikimem-index.mjs --write CLAUDE.md --write .claude/project/memory/ai-maestro-overview.md`.
4. Commit the five pages and the regenerated index together, so the index and its sources cannot
   disagree in history.

## Verification

- `node scripts/wikimem-index.mjs --check` exits **0** (currently exits 1 naming all five).
- Each of the five names appears in the generated index block in `CLAUDE.md`.
- `memgrep recall "<a symptom phrase from each page>" .claude/project/memory` returns that page —
  this is the check that matters, because the index and the recall surface are different mechanisms
  and fixing one does not prove the other. **Choose the symptom phrases before running it**, or the
  test degrades into confirming whatever comes back.

## Estimated risk

LOW. Additive frontmatter on five pages plus a regenerated index. No dependency.

The one real risk is the fix being cosmetic — satisfying `--check` with topics that do not describe
the content — which would close the card while leaving the pages exactly as unfindable. The recall
check in Verification exists to catch that and must not be skipped.

## Acceptance

- [x] `node scripts/wikimem-index.mjs --check` exits **0** (was exit 1 naming all five).
- [x] All five pages carry a `metadata.topic:` assigned from their **description** — what a reader
      arriving with that symptom is asking — and never guessed from the filename.
- [x] Every topic lands inside the **existing** 10-topic vocabulary; no new topic invented.
- [x] All five appear in the generated index in **both** `CLAUDE.md` and
      `.claude/project/memory/ai-maestro-overview.md` (verified 1 hit each, both files).
- [x] **Recall test, symptom phrases chosen BEFORE the run** (one per page, from each description):
      all five return their own page in the **top 3**.
- [x] `memgrep validate` OK · `memgrep lint` 0 findings at or above ERROR.

## Outcome

| page | topic | pre-chosen symptom → top-3 |
|---|---|---|
| `janitor-chore-absorbability` | reliability-patterns | *"should we absorb chore X"* ✓ |
| `model-scoped-window-fallback` | reliability-patterns | *"why did the rotator evict the whole fleet over ONE model"* ✓ |
| `public-repo-personal-data` | security-and-auth | *"a personal email reached a tracked file"* ✓ |
| `settings-file-watcher-ledger` | reliability-patterns | *"who changed my settings.json"* ✓ |
| `trdd-d4-watchdog` | design-system | *"what is the D3 objective floor"* ✓ |

**Two notes for whoever edits these pages next**, both of which cost a failed pass here:

1. **The `tier:` line is not uniform** — three pages are `component`, two are `aspect`. An anchor
   sampled from one page fails on the others, which is how the first pass landed 3 of 5. Do not
   generalise a frontmatter anchor from a single example.
2. **A mid-line anchor needs `printf '%s'`, not a heredoc** — the heredoc appends a newline the
   anchor does not have, and `memgrep edit` correctly refuses with *"no match"*.

## Approval log

- 2026-08-16T21:39:15+0200 — COMPLETED by the hub session. All 6 acceptance boxes met;
  verified by the pre-chosen recall test, not by the checker's exit code alone. Commit 6e08f2a2.
- 2026-08-16T20:32:44+0200 — MANDATE issued by the hub session (min-approval-requirement: none).
  Pre-approved: Tier-0 — in-scope, local, reversible, additive, this repo's own docs. Derived (EHT)
  from TRDD-BRRJK57P's axis-1 pass. No approval request was sent.
