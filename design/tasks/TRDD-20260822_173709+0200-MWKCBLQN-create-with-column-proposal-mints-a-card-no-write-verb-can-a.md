---
trdd-id: MWKCBLQN
title: create with column proposal mints a card no write verb can act on
column: ai_review
created: 2026-08-22T17:37:09+0200
updated: 2026-09-04T15:26:25+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:37:09+0200
---

# create with column proposal mints a card no write verb can act on

## Problem
`aimaestro-trdd.sh create --column proposal --min-approval user` (owner authority) writes
`column: proposal` into `design/tasks/`. Zone routing keys on the caller's VERIFIED AUTHORITY; the
column keys on the FLAG; nothing reconciles them.

Measured 2026-08-22 (TRDD-798OAHMX e2e): card `W7B0TC9B` was created that way, `trddgrep validate`
reported `ZONE-MISMATCH` immediately, and `refuse` then returned
`HTTP 409 — Only a proposal can be refused; W7B0TC9B is in tasks` because the write verbs key on
ZONE. The card was inert: invalid to the linter, unreachable by every verb. Only a manual `git mv`
recovered it.

## Proposed fix
Reconcile at the create route: either derive the column from the resolved zone, or refuse a
`--column` that contradicts the zone the authority selects. Silently honouring both is what mints
the unreachable state.

## Verification
Create with `--column proposal` at owner authority; the card must be actionable by `refuse`
without a manual move, and `trddgrep validate` must report no ZONE-MISMATCH.

## Approval log

## Approval log

- 2026-08-22T17:37:09+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Caller census — done AFTER the guard shipped, which is the wrong order

A review asked who else calls `createTrdd`, since the guard went into a LIBRARY function
and the commit message said "the TRDD create route". Fair hit: I tightened a shared function
without enumerating its callers first — the exact discipline TRDD-FRRJ80YQ applied and this
card skipped. Measured now (`grep -rn "createTrdd" app lib services scripts tests`):

| caller | passes a caller-chosen `column`? | effect of the guard |
|---|---|---|
| `app/api/trdd/create/route.ts:52` | yes (`column` from the request body) | refuses before any write — the intended fix |
| `scripts/trddgrep.mjs:1041` | yes (`column: columnVal` from `--column`) | refuses before any write; the CLI catches and exits 2 with `refusing to create — <message>` |
| `tests/unit/trdd-create.test.ts` (7 cases) | some | **7/7 still pass** — no regression |
| `lib/trdd-store.ts:903` | no — a COMMENT referencing this guard, not a call | none |

**No headless-router caller exists** — the grep covered `services/` and returned none, which
matters because that mode reimplements routes by design and is where a half-applied guard
would normally hide.

The CLI is worth one extra line: it already carried a POST-WRITE gate that writes the file,
runs `validateTrddCandidate`, and DELETES it on a violation. So that path was partly covered
before; the guard now refuses earlier, before anything touches disk. The route had no such
gate, which is where an inert card could actually survive.

Verdict: two production callers, both should be guarded, both are, and the pre-existing suite
is green. The finding was legitimate and resolves clean — but the census belonged before the
commit, not after a reviewer asked.

## Implementation

Fix site: `lib/trdd-create.ts`, `createTrdd()` — the mandate branch (`isMandate === true`)
resolved `zone = 'tasks'` unconditionally and validated `column` only against `VALID_COLUMNS`
(the whole vocabulary, including the bracket values `proposal`/`refused`/`completed`/…), never
against which ZONE that column belongs in. So an owner-authority mint with `--column proposal`
passed validation and wrote `column: proposal` into `design/tasks/` — the exact defect this card
reports. The non-mandate path was already safe (it hardcodes `column: 'proposal'`, ignoring any
caller-supplied column).

Added, right after the existing `VALID_COLUMNS` check, a cross-check against the SAME arbiter
`lib/trdd-doctor.ts`'s own ZONE-MISMATCH rule uses — `expectedZone(column, fm)` from
`lib/trdd-vocabulary.ts:146` (already imported into this module's neighbor for `VALID_COLUMNS`/
`AUTHORITY_RANK`). `createTrdd` never writes a `release-via` field (confirmed by reading the
`lines` array before relying on it — see lines constructing the frontmatter above), so `{}` is
the correct `fm` argument for `expectedZone`'s `complete`-with-`release-via` branch.

```ts
if (isMandate) {
  const wantZone = expectedZone(column, {})
  if (wantZone !== null && wantZone !== zone) {
    throw new Error(`column "${column}" belongs in zone "${wantZone}", not "${zone}"`)
  }
}
```

No new module, no refactor of the zone-routing logic — reuse of the existing arbiter per the
task instructions.

**Test:** `tests/unit/trdd-create-zone-column.test.ts` (3 cases): (1) owner authority +
`column: 'proposal'` now THROWS — the bug; (2) owner authority + an ordinary working column
(`dev`) still mints into `tasks/` — positive control that the fix doesn't break normal mints;
(3) below-floor authority + no column override still lands `column: proposal` in `proposals/` —
the already-correct path stays correct.

**Neuter (mandatory, run and restored):** commented out the new guard (`if (false && isMandate)`),
re-ran the 3-test file: exactly test 1 reddened (`expected [Function] to throw an error` — the
`toThrow` assertion), tests 2 and 3 stayed green. Restored the guard, re-ran: 3/3 green. The
neuter is non-vacuous and pins the fix at the intended point.

**Verification run:** `bash scripts/with-node.sh yarn vitest run tests/unit/trdd-create-zone-column.test.ts
tests/unit/trdd-create.test.ts` → 2 files, 10/10 passed (the pre-existing `trdd-create.test.ts`
suite, including its own "author BELOW the floor lands in proposals/" case, is unaffected).
`bash scripts/with-node.sh npx tsc --noEmit` → clean, no output.

**A claim in the dispatch prompt I found FALSE:** the prompt assumed `createTrdd` might write a
`release-via` field and asked me to verify before passing `{}` — confirmed by reading the `lines`
array: this function never writes `release-via`, so `expectedZone`'s `complete` branch always
falls back to the `via === '' → 'archived'` case here, which is correct since nothing in this
card's scope mints a `complete` column with staged release. No other claims in the prompt were
false; the described bug and the named fix site/arbiter were accurate.

**Scope note:** the card's `## Problem` and `## Verification` sections describe the bug as
observed through the shell CLI `aimaestro-trdd.sh create` and the HTTP route (`TRDD-798OAHMX`
e2e, card `W7B0TC9B`). This implementation fixes it at `createTrdd()`, the single server-side
mint function both the CLI and the route funnel through per the module's own header ("the
highest-frequency board mutation... had no server verb, so every plugin agent hand-rolled the
mint... ONE function owns all four now") — so the fix covers every caller without a route-level
or CLI-level patch. I did not independently re-run the shell CLI / HTTP route end-to-end as part
of this task (out of the scope given); the acceptance command specified was the vitest run above,
which passes.
