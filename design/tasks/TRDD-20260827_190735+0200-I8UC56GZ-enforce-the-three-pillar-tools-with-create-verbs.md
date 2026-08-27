---
trdd-id: I8UC56GZ
title: The 3-pillars tools have no create verb and no lint-on-write, so G12.1 cannot yet be obeyed
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-27T19:07:35+0200
updated: 2026-08-27T20:33:30+0200
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
effort: L
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

MIGRATION LANDED, and NOT as a `migrate` verb — the rules forbade the obvious shape. The approval
rules say migrate `approval-tier:` "on next touch, never in a mass rewrite", and `trddgrep fix` IS
a mass rewrite, so the repair lives on the WRITE paths (`migrateLegacyApprovalTier`, wired into
BOTH `editAt` and `advanceColumn`) and a card migrates as work reaches it. It refuses the two
ambiguous shapes rather than guessing: fields present and DISAGREEING is APPROVAL-FIELD-CONFLICT,
an ERROR whose whole point is that picking a side silently hands two readers different required
approvers, and an undecodable number is left for a human.

Found while measuring it: `APPROVAL-TIER-DEPRECATED` declared `autofixable: Boolean(decoded)` —
TRUE for 82 cards `fix` has never touched. A linter promising a repair its own fixer does not
make, which is this repo`s lint-vs-fix predicate drift pointed the other way round. The flag now
reads false and says where the repair actually happens. `fix`s all-clear also claimed "every TRDD
already carries a valid frontmatter" — a claim about the CORPUS from a tool that knows only what
IT repairs; narrowed to what it can actually assert.

CORRECTION — "82 cards carry `approval-tier:`" was a COUNT standing in for an IDENTIFICATION, and
comparing it to one settled a real gap. Identified: **83** files contain a line starting
`approval-tier:`; **82** carry it in FRONTMATTER (all `APPROVAL-TIER-DEPRECATED`, and **zero**
`APPROVAL-FIELD-CONFLICT`, so the migration declines none of them). The 83rd is
**TRDD-Z3T7DVL4**, which carries `approval-tier: 2` at line 427 inside a YAML example in its
BODY while its frontmatter declares `min-approval-requirement: user` and no tier line. The doctor
was right never to warn about it; the tally simply could not see it.

That shape now has a test, and the first version of that test was VACUOUS. It used a body value
that DISAGREED with the frontmatter, so the conflict guard refused the migration and the body line
survived for a reason that had nothing to do with the head-slice guard under test — the neuter
reddened NOTHING, which is a finding about the test, not the code. Re-fixtured with an AGREEING
value (`approval-tier: 0` beside `min-approval-requirement: none`), which is the only shape that
reaches the replace; the same neuter now reds exactly that one test. The head-slice early return
is the only thing standing between a document-wide `.replace()` and a silent edit to a card`s
documentation, and until now nothing pinned it.

NEUTER: the migration is wired at TWO call sites, and
killing them one at a time reds exactly one test each, a different one — `editAt` → the archive
test, `advanceColumn` → the in-place test. The first draft of that test pinned only one site;
removing both reddened one test, which would have read as full coverage.

STILL OPEN, and why each is not a hidden landmine: `split`/`supersede`/`merge`
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
- [x] **`migrate`** — the on-next-touch field migrations the rules already mandate
      (`approval-tier:` → `min-approval-requirement:`, v1 `status:` → `column:`), applied by the
      tool instead of by each agent remembering
- [~] **Structured field updates** — `set` DONE; `add-box`/`check-box`/`append-state` remain.
      `trddgrep set <id> <field> <value>` writes ONE frontmatter field with no line number
      anywhere in the call, INSERTS the field when absent (the shape a regex patch fails at
      silently — the GFX57106 failure), refuses `column` (half a transition; move owns it),
      refuses a newline in the value (the injection shape), and is judged by the SAME candidate
      gate as `edit`. `--no-bump` for a mechanical repair, because the board sorts on `updated:`.
      SCOPE, because "the same gate as edit" is true and easy to over-read: it is the same
      PREDICATE, and that predicate polices SEVEN things (column · a pipeline value in `status:` ·
      trdd-id shape · a colon in `title` · the three ISO date fields · min-approval-requirement).
      `set` writes ANY field, so `severity: not-a-severity` LANDS — measured, and now pinned by a
      test that asserts it lands. Field vocabularies beyond those seven are the doctor`s to report.
      Latent coupling, named rather than left implicit: the gate`s "before" side is POST-migration,
      so a violation the tier migration itself introduced would be invisible to it. It cannot
      happen today (the migration only ever writes a decoded ladder title, which the predicate
      accepts), so it is a coupling to watch, not a defect.
      The three BODY setters are the remainder; this card was updated with `set` itself.
      (original box text) so an agent
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
- [x] **Body setters DONE** — `append <id> <heading> <line>` and `check-box <id> <n> [--uncheck]`, both addressing a SECTION or an ORDINAL instead of a line number. `append` inserts at the named section's own end (not EOF — a card may carry a later section, and this one does), creates it when absent, and refuses a newline that could open a second `---` fence. `check-box` skips fenced code so its ordinals ARE the terminal gate's ordinals, and refuses a tick that changes nothing rather than reporting a no-op as success. `supersede` needed no verb: `move <id> superseded --superseded-by ID` already writes the column, the zone move and `superseded-by:` — verified end to end.
- [x] **`fix` auto-invocation — MEASURED, and the answer is not to wire it.** `trddgrep fix --dry-run` reports ZERO autofixable findings on the live corpus, so auto-invocation would build machinery for an empty set. The repairs `fix` owns (missing frontmatter, a Z-date, status→column, a bad id shape, title-from-H1, a derived back-link) are for cards the write gate now REFUSES to create in the first place; the one repair that genuinely needed to happen on touch — the retired `approval-tier:` on 82 cards — is wired into the write paths already, and could not have gone into `fix` because the rules forbid migrating it in a mass rewrite. Auto-invoking a CORPUS sweeper on every single-card write is that same forbidden mass rewrite, wearing a trigger.
- [ ] **prrdgrep/specgrep create verbs — MEASURED, and the reason is now a SPEC, not an excuse.** A PRRD rule CAN be added through `prrdgrep edit` today, but only by anchoring on a NON-RULE line: anchoring on the last rule (the obvious choice) is REFUSED by the version gate, because replacing a rule line with itself-plus-a-new-rule reads as that rule's TEXT changing without a version bump — measured, exit 2, `bump it to G1.2`. So the workaround exists, is proxy-shaped, and its most natural form is a trap. That is an argument for building `prrdgrep add <tier> <text>` (pick the next globally-unique NUMBER — the gate already computes uniqueness across both tiers — version .1, insert after the last rule), not for recording a reason. Left open deliberately with the shape written down.
- [x] **CORRECTION to the `fix` entry above — its premise was FALSE, and finding out why found a live bug.** That entry read "zero autofixable findings" off `trddgrep fix --dry-run` printing "nothing to repair". Those are not the same proposition, and a review challenged it as circular (my own `autofixable: false` flip on APPROVAL-TIER-DEPRECATED one commit earlier). Measuring `lintCorpus` DIRECTLY instead of asking the fixer: **3 autofixable findings existed** (BODY-STATE-CLAIM on 70A521D9, EAC02238, EF0C6C0A). Not circular — just wrong, and in a way only an independent measurement could show. All 3 sit on TERMINAL cards: the FIXER carries `!frozen` deliberately (IND step 12 freezes a terminal body, permitting removal only of a line that FALSELY contradicts the column — the disagreeing case, not this one) while the LINTER's flag did not, so it promised a repair the fixer correctly declines. Same class as APPROVAL-TIER-DEPRECATED on this card, and subtler: that flag was unconditionally wrong, this one only on the frozen subset, so the corpus-wide run looked clean while the promise was live. Flag now carries the condition; autofixable is 0 by MEASUREMENT, not by the fixer's own report; pinned with a frozen/non-frozen twin fixture and a neuter. The decision not to auto-invoke `fix` stands, and its causal order is: the set is empty BECAUSE approval-tier was reclassified and re-homed to the write paths and this flag was corrected — not independently of either.
- [x] **specgrep MEASURED too — the trap is prrdgrep-only.** The entry above generalised from prrdgrep to specgrep without testing specgrep, across a difference it named. Measured: SPEC has no version-bump clause (its guard is clause-id STABILITY), so replacing a clause line with itself-plus-a-new-clause is not refused for that reason. The trap is PRRD-specific; the missing-append-verb gap is shared.
- [x] **The flag change re-justified from the RULE, not from a comment.** A review caught that I picked which side of a two-way disagreement to change by reading a comment written by the side I kept — the fixer's, which claims its own freeze behaviour is correct. Read the IND text directly (`trdd-design-tasks.md` step 12): the exception permits removing a body line **FALSELY, MACHINE-VERIFIABLY contradicting** the terminal column. My case is the AGREEING one, which the exception does not cover, so the freeze holds and the flag is right. The review's worry — that the fixer over-refuses a case IND permits — is about the CONTRADICTING case, which the fixer declines everywhere via its `agrees` guard, deliberately (MAY is not MUST; auto-resolving a disagreement loses work). Verified independently; the conclusion is unchanged and its authority is now the rule.
- [ ] **`prrdgrep add` — BUILT, then REVERTED, and the spec it was built from was WRONG in two ways only the real document could show.** The spec (written from a toy fixture): mint max-number+1, version .1, insert after the last rule. Measured against the live PRRD: (1) **rules are MULTI-LINE** — G12.1 spans lines 146-172 with a BLANK LINE at 161 inside it, so "the line after the declaration" is INSIDE the previous rule's body and neither "next line" nor "stop at the first blank" finds its end; (2) **the tiers are SEPARATE SECTIONS** (GOLDEN, then `---`, then `## SILVER rules` at 176), so appending after the last rule of EITHER tier puts a silver rule in the golden section. Each would corrupt the project's constitution — the exact failure G12.1 exists to prevent, committed by the tool built to enforce it. Also learned by walking into it: `replaceAtLines` treats a multi-line `replace` as ONE line's content, so anchoring on a declaration hands the gate a line that keeps its id and changes its text, and it correctly refuses — the trap is real and the verb hit it. CORRECTED SPEC: the insertion point is the end of the TIER'S OWN section (before its trailing `---`), found by section heading, never by proximity to a rule; a rule's block ends at the next section divider, not the next blank. The 80%-correct implementation (id minting, the `--user` gate that keeps GOLDEN user-only, the specgrep refusal) is in `git stash@{0}`, not thrown away.
- [x] **The corruption is now MEASURED, and the corrected spec above was itself wrong.** (1) MEASURED: ran the stashed verb against a COPY of the live PRRD. It SUCCEEDED and inserted `- **S13.1**` at line **147** — inside G12.1's multi-line body, in the **GOLDEN** section, for a **silver** rule. Both predicted corruptions, demonstrated rather than inferred. The sharper half: it FAILED on my toy fixture (empty `expect` on the trailing newline) and SUCCEEDED on the real document — **the fixture was hiding the bug by failing for an unrelated reason.** Had the fixture carried one non-empty following line, this would have shipped. (2) MEASURED, on a rule that is NOT last: mid-section rules are separated by a BARE BLANK LINE followed by a `- **` declaration (G7.1/G8.1/G9.1/G10.1/G11.1 at 108/116/121/135/140, blanks at 107/115/120/134/139). So "a rule's block ends at the next section divider" — my own correction one entry above — is wrong for every rule except the LAST, and would swallow every following rule in the section. I generalised a terminator from G12.1, whose block happens to end at a divider because it is last. RE-CORRECTED: a rule's block ends at a blank line FOLLOWED BY a declaration, or at a section divider, whichever comes first — and note the internal blank at 161 does not terminate G12.1 because 162 is prose, not a declaration, so the predicate is consistent with both shapes. The insertion strategy does not need the terminator at all: append at the end of the TIER'S OWN section.

## Approval log

- 2026-08-27T19:07:35+0200 — MANDATE issued by the USER (min-approval-requirement: none; issuer authority >= approver).
  Pre-approved: no approval request was sent. The USER also set `PRRD G12.1` the same minute.
- 2026-08-27T19:31:31+0200 — column → verify_assumptions. tooling half landed; see the LANDED block
- 2026-08-27T19:31:31+0200 — column → plan. tooling half landed; see the LANDED block
- 2026-08-27T19:31:31+0200 — column → dispatch. tooling half landed; see the LANDED block
- 2026-08-27T19:31:32+0200 — column → dev. tooling half landed; see the LANDED block
