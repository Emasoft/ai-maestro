---
trdd-id: 2G1AR7BB
title: TRDD write gate disagreement on mandated-by field between CLI set and API route
column: todo
created: 2026-09-06T03:01:01+0200
updated: 2026-09-06T03:05:57+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-06T03:01:01+0200
---

# TRDD write gate disagreement on mandated-by field between CLI set and API route

## Problem

Two frontmatter write gates for a TRDD's `mandated-by:` field disagree. `lib/trdd-store.ts:395` `editTrdd` (the only writer used by the API route `app/api/trdd/[id]/route.ts:88`, via `PATCH /api/trdd/[id]`) calls `validateTrddFieldEdits` (imported at `lib/trdd-store.ts:28` from `./trdd-edit-guard`), which reads `mandated-by` and ranks it on the authority ladder (`lib/trdd-edit-guard.ts:213`). `lib/trdd-store.ts:927` `setTrddField` — the function backing `trddgrep set` (`scripts/trddgrep.mjs` case 'set' at line 1093, importing `setTrddField` at line 1107) — instead calls `introducedViolations`/`candidateFrontmatter` from `lib/pillar/trdd-candidate.ts` (imported at `lib/trdd-store.ts:30`), which never checks `mandated-by` at all. The CLI's own comment at `lib/trdd-store.ts:937-938` enumerates seven fields its gate covers (column, a pipeline value in status:, trdd-id shape, a colon in title, the three ISO date fields, min-approval-requirement) — `mandated-by` is not among them, and `scripts/trddgrep.mjs` never calls `editTrdd` (0 occurrences of the string `editTrdd` in that file). Net effect: the API route's gate reads `mandated-by` and ranks it on the authority ladder while the CLI's gate never reads it, so the two write paths cannot agree on that field; whether the API gate actually REFUSES an off-ladder value is described by `lib/trdd-doctor.ts:51` and was not exercised when this card was minted — the first acceptance box is the measurement.

## Evidence

- `lib/trdd-store.ts:395` `export function editTrdd(`; `:409` the only call of `validateTrddFieldEdits(`; only external caller `app/api/trdd/[id]/route.ts:88`.
- `lib/trdd-store.ts:927` `export function setTrddField(`; `:972-974` calls `introducedViolations(candidateFrontmatter(before), candidateFrontmatter(after), zone)` (imported `lib/trdd-store.ts:30` from `./pillar/trdd-candidate`).
- `lib/pillar/trdd-candidate.ts:37/58/132` define `candidateFrontmatter` / `validateTrddCandidate` / `introducedViolations`.
- `scripts/trddgrep.mjs`: case 'set' at line 1093 imports `setTrddField` at 1107; case 'append' at 1125 imports `appendTrddSection` at 1139; the string `editTrdd` occurs 0 times.
- `grep -c "mandated-by\|mandatedBy" lib/pillar/trdd-candidate.ts` = 0; the same grep on `lib/trdd-edit-guard.ts` = 2 (the guard reads the field and ranks it on the authority ladder, aliasing `self`→`none` at `lib/trdd-edit-guard.ts:213`).
- Zero cross-imports between the two modules: `lib/pillar/trdd-candidate.ts` mentions `trdd-edit-guard`/`validateTrddFieldEdits` 0 times; `lib/trdd-edit-guard.ts` mentions `trdd-candidate`/`validateTrddCandidate`/`introducedViolations` 0 times.
- Source: `reports/lean-worker/20260906_025334+0200-trdd-store-guard-trace.md` (worker trace), re-grepped by the coordinator.

## Proposed fix

Two options, neither chosen here:

(a) Route `setTrddField` (and therefore `trddgrep set`) through the same `mandated-by` predicate the API route enforces via `validateTrddFieldEdits`, so both write paths agree.

(b) Add the `mandated-by` authority-ladder check (with the `self`→`none` alias) into `validateTrddCandidate`/`introducedViolations` in `lib/pillar/trdd-candidate.ts`, so the CLI's zone/candidate validator covers it directly.

Note: the canonical spelling of the top rung — `self` vs `none` — is a pending USER ruling (see `rules/aimaestro/aimaestro-trdd-approval.md` "min-approval-requirement supersedes approval-tier" / the `maestro` vs `user` alias precedent). This fix must not pre-empt that ruling; it should preserve whichever alias the guard already applies (`lib/trdd-edit-guard.ts:213`) until the USER decides.

## Acceptance

- [ ] a test proves `trddgrep set <id> mandated-by <off-ladder value>` is refused with the same reason the API route gives
- [ ] a test proves `trddgrep set <id> mandated-by self` and `trddgrep set <id> mandated-by none` are both accepted (readers alias them)





## Approval log

- 2026-09-06T03:01:01+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-06T03:00:38+0200 — minted from measurements in reports/lean-worker/20260906_025334+0200-trdd-store-guard-trace.md; self-mandate (min-approval none). (Re-homed under the single Approval log heading; the 03:00:38 stamp is the original mint-time line.)
