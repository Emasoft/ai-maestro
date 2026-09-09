---
trdd-id: 8D9ZYZX9
title: trddgrep new mints project-scope cards without scope and project-id
column: backburner
created: 2026-09-06T02:23:03+0200
updated: 2026-09-10T01:40:40+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-06T02:23:03+0200
blocked-by: []
scope: project
project-id: ai-maestro
---

# trddgrep new mints project-scope cards without scope and project-id

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-10

**Boxes 1, 2 and 4 are CLOSED** (`b922e73f` + the two `trddgrep set` repairs). **Box 3 is
STRUCK, not deferred: its premise is false**, and the only remaining work on this card is an
owner ruling on whether to re-specify it.

**WHY BOX 3 WAS STRUCK.** The box asked for a `trddgrep validate` WARN on a project-zone card
lacking `project-id`. `lib/trdd-doctor.ts:776-789` carries the admission criterion for exactly
that list, and it is not a style note — it is a decision with a measurement behind it: *"Each
entry names the CONSUMER that silently misreads the card when the field is absent — that is what
keeps these false-positive-free"*, and widening the list once *"added 218 findings that named no
broken reader, which is a wall, and a wall is how a linter gets routed around."* The comment
names `project-id:` **specifically** as deliberately excluded.

Box 3 cannot meet that criterion. **This card argues the WARN purely from the overlay — a rule
saying a field is REQUIRED — and never names a consumer that breaks without it.** Those are
different claims. The measurement in this card's own Problem section is the evidence against it:
five `project-id` hits in `lib/` and `scripts/`, four of them prose and one a fixture generator.
**Nothing reads the field.** The cross-project query it exists for is still hypothetical.

So box 3 would have been the first entry in that list to fail the list's own admission test, and
it would have fired on ~104 live cards on its first run with no repair path shipped alongside.
The card was written without knowledge of the doctor's comment; that makes it a box with a
falsified premise, and the discipline is to strike and re-specify it, not to implement it and
rewrite the comment that would have caught it.

**NEXT ACTION — the OWNER's:** rule on one of
(a) leave `project-id` unlinted until a consumer exists — the doctor's stated criterion, and the
default if nobody rules;
(b) name the consumer (a cross-project board query) and re-specify box 3 against it, shipping the
104-card repair in the same change;
(c) overturn the FP-free criterion itself — a linter-policy decision, and then the :776-789
comment is AMENDED with a dated line, never replaced: it is the only artifact of the 218-finding
measurement.

**Boxes 1+2 cover BOTH producers.** `createTrdd` has exactly two callers — `scripts/trddgrep.mjs`
and `app/api/trdd/create/route.ts` — and they share the function, so one fix covers the CLI and
the server mint. A THIRD frontmatter producer exists and is NOT fixed: `lib/trdd-doctor.ts:1536`
builds frontmatter for a legacy card that has none, and omits both fields. Recorded, not scoped
here.

**One test in this work is deliberately non-pinning, and says so.** The `slice(4)` neuter reddens
nothing: an under-slice of a fence that is never shorter than 4 chars only ever leaves leading
whitespace, which `/m` tolerates. Two of the first five fixtures I wrote were vacuous for reasons
of that shape, and the neuter runs are what surfaced it. The green run is recorded in the test
rather than hidden.

**REVIEW HISTORY (2026-09-10), condensed — three post-write rounds, all applied or disclosed.**
ROUND 2 found two real parse defects, both fixed: a DUPLICATE `project-id:` (a regex takes the
FIRST; YAML readers disagree — 1.2 calls it an error, js-yaml throws, permissive ones take the
LAST — and both values are well-formed, so the value guard cannot see it), and a UTF-8 BOM that
failed the fence test. The duplicate is fixed by REFUSING rather than picking, which **DEVIATES
from that round's recommendation of last-wins** — recorded as a finding rejected with its reason,
never silently dropped. `readProjectId` also lost its `export`. ROUND 3 replaced the LITERAL,
invisible U+FEFF in BOTH the source and the test fixture with `String.fromCharCode(0xfeff)` — the
sufficient reason is that an invisible character in source is UNREVIEWABLE; the
whitespace-normalisation risk is hypothetical and is not the justification — and made the strip a
loop for a doubled BOM. ROUND 4 found that loop UNPINNED while its comment advertised it
(`while` → `if` passed all 20 tests), so a doubled-BOM test now pins it; the recorded
"remove the BOM strip" neuter was RE-MEASURED at 2 red rather than carried forward from 1.

**The no-new-failures claim, and exactly what it covers.** Measured over `trdd-doctor` +
`pillar-grep-cli` ONLY — any other suite reading the corpus is unmeasured. One-variable A/B in a
throwaway worktree at HEAD: cards as committed, then the same three reverted to `d8d039cc` in the
SAME tree; failure MESSAGES byte-identical. A positive control then broke this card deliberately
(`column: complete` over an unchecked box) and the suites DID redden differently — so the
instrument is not blind to these files, which is what the first attempt could not establish.
**The durable fact, which outlives the counts: the residual failures name TRDD-271764MC, a
different, owner-gated card.** And the control's own lesson: the failure COUNT stayed 2 in both
the broken and the clean run — only the messages moved, so a count-only comparison proves nothing.

**COLUMN — `backburner`, and why not `todo` or `blocked`.** `todo` means pullable and this card is
not: its only remaining work is a ruling. `blocked` needs a runnable blocker probe, and a human
decision has none — `blocked-by: [decision: owner]` parses as a YAML object and drew 3 validate
findings, so forcing it would have bought a column with a malformed value. `backburner` is the
honest park, and it stays drift-eligible.

## Problem
`trddgrep new` (its mint path is lib/trdd-create.ts, called from scripts/trddgrep.mjs) mints a PROJECT-scope card without `scope:` and without `project-id:`, although the ai-maestro overlay (rules/aimaestro/aimaestro-trdd-approval.md, "Scope discriminators"; rules/aimaestro/aimaestro-kanban-multiagent.md) says a `scope: project` card MUST carry `project-id` — the discriminator that binds the card to the project board. Measured 2026-09-06 over design/tasks + design/proposals (193 cards, every column — not the board's `todo` count): 105 carry `scope: project` (no other scope value occurs), 90 carry `project-id:`; 26 `scope: project` cards and 78 cards carrying neither field lack `project-id` — 104 in total; TRDD-OUAQARPL and TRDD-6B1ND5TD, both minted by the verb this week, carry neither. No code under lib/ or scripts/ writes `project-id` (the same grep finds the `mandated-by` writer at lib/trdd-create.ts:205, so its coverage is not in doubt). The PRRD frontmatter carries `project-id: ai-maestro`, so the value is one read away. `trddgrep validate --min-severity error` and the doctor both pass such cards (the IND base says the field is "lint-enforced incrementally"), so the gap is invisible until a cross-project query keys on `project-id`.

A second observation, recorded for a ruling and NOT a box on this card: at Tier 0 the create library writes `mandated-by` as the AUTHOR's authority rank (lib/trdd-create.ts:205 — `mandated-by: ${opts.authorAuthority}`, introduced by commit 744cc331 on TRDD-40DYBI4T, 2026-08-20; `git log -S authorAuthority` on that file shows no other commit), so `none` there means "an author holding no approval authority", which is what the §D4 comparison authority(mandated-by) >= authority(min-approval-requirement) needs on one ladder; the overlay's mandate section instead says "'self' at `none`". Tool and rule text disagree on the Tier-0 spelling; which was intended is the ruling requested, and the rule text lives in a governance file, so aligning either side is a MANAGER-tier decision at minimum. This card only records the disagreement; it is NOT routed anywhere an approver drains — the USER, who holds the MANAGER role in this hub session, is told directly in the session reply, and a proposal in design/proposals with min-approval-requirement manager is the formal route if the USER wants one.

## Proposed fix
In lib/trdd-create.ts: when the repo's design/requirements/PRRD.md carries a `project-id:` frontmatter field, emit `scope: project` and `project-id: <that value>`; when the PRRD or the field is absent, mint the card unchanged and print ONE warning naming the missing source — never refuse the mint (trddgrep is installed globally and serves repos without a PRRD; a fail-fast here would be a fleet-wide regression). Add a `trddgrep validate` WARN for a project-zone card lacking `project-id`, where project-zone means: the card sits under a project repo's design/ AND its `scope:` is `project` or absent (a `scope: local` or `scope: user` card found there is a separate misfiling defect, excluded from this WARN because such a card MUST NOT carry project-id; the corpus has none today — all 105 `scope:` values are `project`). WARN only: promoting it to ERROR would redden the `--min-severity error` commit gate on every unrepaired card until a sweep, and the overlay's migration policy is migrate-on-next-touch, never a mass rewrite; ERROR becomes admissible only when validate reports zero remaining project-zone cards lacking `project-id`. The 104 existing cards are repaired as each is next touched, via `trddgrep set`.

## Acceptance
- [x] A card minted by `trddgrep new` in this repo carries `scope: project` and `project-id: ai-maestro` — `b922e73f`
- [x] Minting with the PRRD `project-id:` absent still succeeds and prints one named warning (unit test) — `b922e73f`
- [ ] ~~`trddgrep validate` WARNS on a project-zone card lacking `project-id`~~ — **STRUCK 2026-09-10, premise falsified; see the STATE block. Needs an owner ruling, not an implementation.**
- [x] The two minted-this-week cards (OUAQARPL, 6B1ND5TD) are repaired on next touch via `trddgrep set`, not by a sweep — done 2026-09-10

## Approval log

- 2026-09-06T02:23:03+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-06T02:30:11+0200 — Review notes on the corrected body (four precisions, none a box). (1) "routes it to the MANAGER queue by this sentence" over-states: a sentence on a Tier-0 card in design/tasks sits in no queue any approver drains — the mandated-by spelling question is NOT routed by this card; the USER, who holds the MANAGER role in this hub session, is told directly in the session reply, and a proposal in design/proposals with min-approval-requirement manager is the formal route if the USER wants one. (2) Provenance of the tool's behaviour: lib/trdd-create.ts writes mandated-by as the author's authority rank since commit 744cc331 (2026-08-20, TRDD-40DYBI4T, server-side minting); that shows what the tool does, not which spelling was intended — the intent question is exactly the ruling requested, so "the overlay is the outlier" is withdrawn as a judgment. (3) Exit condition for the WARN: promoting the validate rule to ERROR becomes admissible only when validate reports zero project-zone cards lacking project-id; until then it stays WARN, so the nag has a closure path. (4) The 104 split into two repair classes — 26 cards that say scope: project and lack only project-id, and 78 that carry neither field, where the path rule (under design/ of a project repo) makes them project-scope and the repair is two fields; "project-zone" in the acceptance means "path under a project's design/ regardless of the scope field", so both classes are in scope. By ai-maestro-hub-session.
