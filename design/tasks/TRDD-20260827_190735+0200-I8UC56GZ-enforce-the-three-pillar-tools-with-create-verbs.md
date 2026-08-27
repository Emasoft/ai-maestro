---
trdd-id: I8UC56GZ
title: The 3-pillars tools have no create verb and no lint-on-write, so G12.1 cannot yet be obeyed
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-27T19:07:35+0200
updated: 2026-08-27T19:31:32+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-27T19:07:35+0200
priority: 0
severity: major
effort: M
release-via: none
labels: [governance, three-pillars, tooling]
npt: []
eht: []
blocked-by: []
relevant-rules: [12]
implementation-commits: [82595e21, 07f2e249]
---

# The 3-pillars tools have no create verb and no lint-on-write

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-27T19:07:35+0200

**USER mandate 2026-08-27T19:07:35+0200, verbatim intent:** *"the trddgrep tool MUST lint every TRDD file when it
access it, and automatically detect and fix the errors autofixable, and report those non
autofixable … even better: the `trddgrep new <params>` command to create a new TRDD should have
created the TRDD file already with all the right fields … ENFORCE via skills and rules the use of
the trddgrep tool (along with prrdgrep and specgrep) … add this to the golden rules of the
3-pillars system."*

**The rule half is DONE: `PRRD G12.1` (added 2026-08-27T19:07:35+0200 via `prrdgrep edit`, lint clean).** This card
is the TOOLING half, without which G12.1 mandates something the tools cannot do.

### LANDED 2026-08-27T19 (this session) — the tooling half is real, not complete

`trddgrep new` and `trddgrep move` exist; the per-document pre-write gate is real. Both verbs
are CLI surface over machinery that ALREADY existed and was reachable only through the HTTP
API — `lib/trdd-create.ts` (minting, mandate routing, injection guards) and `lib/trdd-store.ts`
(promote/refuse/advance/archive, each with the git mv, the rollback and the lock). Nothing of
that was reimplemented. The measured claim below, "no create verb in any of the three tools",
was true of the TOOLS and understated the LIBRARY.

Three defects found while wiring it, each fixed at the primitive rather than the call site:

1. `archiveTrdd` could not express `complete` — its state union was `completed|cancelled|
   superseded`, while `expectedZone` says a `complete` card with `release-via: none` belongs
   in archived/. The only other verb, `advanceColumn`, never moves folders. So the obvious
   dispatch would have left a terminal column in the OPEN zone (the ZONE-MISMATCH this session
   shipped once by hand), and the shape invited the worse fix: renaming `complete` → `completed`
   on the way in, which is the dual write 3P-ZON-05 was amended to kill.
2. `advanceColumn` validated NO column at all. It now refuses a value outside the vocabulary and
   one whose zone is not tasks/ — in the STORE, so the HTTP callers are covered too.
3. The terminal CHECKLIST gate lived only in `rejectIncompleteChecklist`, which returns a
   `NextResponse` — reachable from the route and from nothing else, and keyed on the literal
   string `completed` only. `trddgrep move` would have archived cards the API refuses. It is
   now on `archiveTrdd` itself and covers complete/completed/published/live.

NEUTERS RECORDED (each broke exactly the named tests, positive controls green):
dispatch `per-document` → `per-nothing`: 3 red in `pillar-edit-guard.test.ts`, both positive
controls green.
The second neuter was run COMBINED first — `complete` out of `CHECKLIST_GATED_STATES` AND the
`want === archived` branch unreachable, in one run — which reddened 2 tests and was reported as
"one each". **That attribution was wrong, and it was a guess: two mutations on one code path, one
run.** An adversarial review named it, and the complementary runs settle it:

* checklist set ALONE → exactly **1** red (`refuses to archive as complete when the acceptance
  checklist is not finished`). So the gate IS pinned, by that one test, and that test fails when
  and only when the gate is gone.
* archive dispatch ALONE → **2** red (both). The branch is UPSTREAM of the checklist gate: with it
  unreachable the dispatcher falls through to `advanceColumn`, which never archives, so the
  checklist test cannot reach the gate at all.

So the true mapping is 1-and-2, not one-each. The combined run produced the right COUNT for the
wrong reason, which is exactly why a count is not an attribution — the repo`s own lesson
("run the complement before naming the cause"), violated here by its own author and caught only
because something else went looking.

STILL OPEN, and why each is not a hidden landmine: `split`/`supersede`/`merge`, `migrate`
(82 cards still carry `approval-tier:`), the structured setters, `fix` auto-invocation on the
write paths, create verbs for prrdgrep/specgrep, and META-MISSING (154 warns — `assignee`/
`created-by` on cards nobody can now attribute; `new` writes them, so the count stops GROWING).
`edit` gates BEFORE the write rather than linting after, which is stronger than the box asks.

**USER ACTION REQUIRED — `PRRD G12.1` now carries a FALSE caveat, and only the USER may fix it.**
Its MEASURED CAVEAT block (PRRD.md:161-171) says the "refuses a malformed write" clause is "NOT
YET TRUE for TRDDs" and cites `pillarPreWriteCheck` early-returning a no-op at
`lib/pillar/edit-guard.ts:181`. As of commit 82595e21 that is no longer so: the per-document
branch is a real gate, pinned by three refusal tests and a recorded neuter. G12.1 is GOLDEN, so
no agent may edit it — the caveat stands until the USER strikes it. It is flagged here rather
than left implicit for the caveat`s own stated reason, pointed the other way: a rule that DENIES
a protection it now provides teaches its readers not to trust the tool that provides it.

### Measured 2026-08-27T19:07:35+0200

| claim | reality |
|---|---|
| `trddgrep new` | **does not exist.** Verbs are: board · next · why · unblocks · roots · show · search · lint · validate · fix · edit · env · index-verify. No create/new/add/init |
| `prrdgrep` create verb | **does not exist** (show · search · edit · lint · env) |
| `specgrep` create verb | **does not exist** — verbs READ from `specgrep help`, not grep-counted: show · search · edit · lint · env. No create under any name (`new`/`init`/`scaffold`/`mint`) |
| lint on access/update | `prrdgrep edit` states its gate enforces the lint predicates pre-write; `trddgrep edit` is lock+CAS-guarded but **no post-write lint is documented** |
| enforcement rule before today | **none.** The only "never hand-author, use the write verbs" text in the whole rules corpus was `markdown-memory-recall.md:142`, for **memgrep**. The memory system had this discipline; 3-pillars had the linters and no mandate |

**Evidence this is not theoretical:** every malformed card in this corpus was hand-written. On
2026-08-27 this session hand-authored TRDD-GFX57106 with a `cat > file <<EOF`, then tried twice to
insert frontmatter with a python regex anchored on a `created-by:` line the card did not have —
both inserts **failed silently**, the card claimed a park it did not carry, and `trddgrep validate`
reading its usual 5 ERRORs was consistent with the fields being ABSENT, so running it confirmed
nothing. A create verb would have written `created-by:` in the first place; a lint-on-write would
have refused the no-op.

**BOOTSTRAP NOTE, stated rather than hidden:** this card itself is hand-authored, because the verb
it asks for does not exist. It is the LAST card that may be, and box 1 is what makes that true.

## Acceptance

- [x] `trddgrep new --title … --column … --task-type …` creates a card with EVERY mandatory field
      populated (including `assignee`/`created-by`, whose absence is today's `META-MISSING`), a
      minted collision-checked id, both timestamps, and the correct zone folder — then lints it and
      refuses to leave a file that would not pass `validate`
- [ ] Same for `prrdgrep` (a rule) and `specgrep` (a clause/spec), or a recorded reason why the
      shape differs
- [ ] Every write path (`new`, `edit`, `fix`) lints AFTER the write and reports non-autofixable
      findings on stderr; a write that would leave the file invalid is refused, not warned about
- [x] A neuter recorded for each: break the post-write lint, confirm exactly one named test reds
- [x] The three tools' `help` states the mandate and points at `PRRD G12.1`
- [ ] `META-MISSING` reaches 0 on the corpus, or each remaining case is explained in place

### The model is `memgrep` — match its surface, not just its linter (USER, 2026-08-27)

*"take example from the memgrep tool from the janitor. it handles all: creating, updating,
recalling, migrating, merging, splitting, etc. For TRDD the trddgrep must also handle the
transition from the proposal folder to the tasks folder and finally the archived folder
automatically."*

memgrep's verbs, measured: `new-page` · `add-atom` · `add-lesson` · `edit` · `migrate` · `lint` ·
`validate` · `recall` · `find` · `overview` · `atom` · `links` · `index` · `reindex`. trddgrep has
only the QUERY + `lint`/`validate`/`fix`/`edit` half; every verb that CREATES or MOVES is missing.

- [x] **`trddgrep move <id> <column>` performs the column edit AND the zone `git mv` as ONE
      operation.** This is the sharpest case: a transition today is two hand steps — edit
      `column:`, then `git mv` between `design/proposals|tasks|archived|refused` — and doing one
      without the other is how a card ends terminal-in-the-open-zone (this session shipped exactly
      that defect once already, and its own linter caught it). The verb picks the zone from the
      target column, bumps `updated:`, appends the `## Approval log` line where the transition
      requires one, and refuses a transition the column state machine forbids
- [ ] **`split` / `supersede` / `merge`** — the derived-TRDD operations, which today are pure
      hand-authoring: creating NPT/EHT children with `parent-trdd:` + the parent's `npt:`/`eht:`
      back-pointers written on BOTH ends (the depth-1 invariant the D4 watchdog checks), and
      `supersede` writing `superseded-by:` + archiving as itself
- [ ] **`migrate`** — the on-next-touch field migrations the rules already mandate
      (`approval-tier:` → `min-approval-requirement:`, v1 `status:` → `column:`), applied by the
      tool instead of by each agent remembering
- [ ] **Structured field updates** (`set`, `add-box`, `check-box`, `append-state`) so an agent
      never regex-patches frontmatter — the failure that produced TWO silent no-ops on
      TRDD-GFX57106 this session
- [x] **The TRDD pre-write gate is a NO-OP today — make it real.** `pillarPreWriteCheck` early-
      returns `() => {}` for any kind that is not `per-line` (`lib/pillar/edit-guard.ts:181`;
      `lintPillarLines` likewise at `:373`), and TRDD is `mode: 'per-document'`
      (`lib/pillar/kinds.ts:127`) while prrd and spec are `per-line` (`:162`, `:196`). So
      `trddgrep edit` gives the lock + CAS staleness guard and NO field validation: it writes
      `column: banana` without complaint. `PRRD G12.1` carries a measured caveat saying so until
      this box is done
- [ ] **`fix` (the autofixer) is never invoked automatically by any write path** — the USER's
      directive is "detect AND fix the autofixable"; today `fix` is a verb a human remembers to
      run. Wire it into the write paths, or record why not

## Approval log

- 2026-08-27T19:07:35+0200 — MANDATE issued by the USER (min-approval-requirement: none; issuer authority >= approver).
  Pre-approved: no approval request was sent. The USER also set `PRRD G12.1` the same minute.
- 2026-08-27T19:31:31+0200 — column → verify_assumptions. tooling half landed; see the LANDED block
- 2026-08-27T19:31:31+0200 — column → plan. tooling half landed; see the LANDED block
- 2026-08-27T19:31:31+0200 — column → dispatch. tooling half landed; see the LANDED block
- 2026-08-27T19:31:32+0200 — column → dev. tooling half landed; see the LANDED block
