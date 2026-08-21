---
trdd-id: 5YRLA53W
title: The board is not draining and the completion gate is vacuous on 71 percent of open cards
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T15:19:14+0200
updated: 2026-08-21T23:47:14+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
priority: 0
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T15:19:14+0200
severity: high
effort: large
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [kanban, board-hygiene, trdd-corpus]
---

# The board is not draining and the completion gate is vacuous on 71 percent of open cards

## Why this is a card and not a handoff bullet

"The board is not draining" has been riding in `.janitor/state/agent-handoff.md` as prose for at
least a session, with no card behind it. That is precisely the failure the kanban rule names —
*queueing is a handoff, not a resolution* — so the observation kept being re-surfaced and never
worked. Filing it makes it pullable.

## Measured 2026-08-02T15:1x+0200 — re-derive, do not trust these numbers later

```bash
grep -h '^column:' design/tasks/*.md | sort | uniq -c | sort -rn        # the census
grep -l '^column: dev$' design/tasks/*.md                               # the dev column
```

| column | cards |
|---|---|
| planned | 22 |
| **dev** | **18** |
| todo | 17 |
| testing | 11 |
| design | 9 |
| blocked | 6 |
| backburner | 6 |
| human_review | 4 |
| ai_review | 4 |

**97 open cards. 18 claim `column: dev`, i.e. "someone is working this RIGHT NOW".** There is one
worker. Ten of the 18 were last updated ≥7 days ago; the two oldest at **39d** and **38d**. Seven
carry no `blocked-by:` FIELD AT ALL (not even `[]`), so they cannot even express a reason to sit
still. The `blocked` column itself is healthy — all 6 name a real blocker.

## The mechanical cause, and it is the more useful half

**69 of the 97 open cards (71%) carry NO acceptance checklist — zero `- [ ]` / `- [x]` boxes.**

> **RE-MEASURED 2026-08-06 08:40 — the headline figure in this card's TITLE is now stale, and the
> direction of travel is the useful part.** Open cards without a checklist: **54 of 111 (48%)**,
> down from 71%. Terminal archived cards with a checklist carrying an UNCHECKED box: **0 of 221**.
> Terminal cards with no checklist at all: 120 — all grandfathered, since the gate binds the
> TRANSITION INTO a terminal column and those predate it. The title is left as written because it
> records what was true when the card was filed; this note is the correction, not a rewrite.
>
> **And the gate is no longer merely enforced on paper — it fired today.** `5H5PBNEB` was closed
> to `complete` with zero boxes this morning and `TERMINAL-WITHOUT-CHECKLIST` caught it, which is
> exactly the vacuity TRDD-9QV4ZCYY's "≥1 box" half was added to close. Worth recording how it
> nearly did not surface: `tests/unit/trdd-doctor.test.ts` holds that corpus assertion and was
> ALREADY red on an unrelated uncommitted neuter, so the new finding moved only the failure COUNT
> (5 → 6). A red suite is camouflage for the next red inside it.

```bash
# count open cards with no checklist
for f in design/tasks/*.md; do
  c=$(grep -m1 '^column:' "$f" | sed 's/^column: //')
  case "$c" in complete|published|live|superseded|cancelled) continue;; esac
  [ "$(grep -cE '^- \[[ x~]\]' "$f")" -eq 0 ] && echo "$f"
done | wc -l
```

The completion gate is written over boxes that are *unchecked*. A card with no boxes therefore
**passes it having proven nothing**, and can sit in `dev` indefinitely without tripping anything.
This is the identical vacuous-gate shape recorded for this corpus on 2026-07-31 (TRDD-9QV4ZCYY: a
condition written only over the BAD items is vacuous on an empty set) — recurring here on the
*population* rather than on the rule text. Fixing the columns without fixing this just re-creates
the drift.

## What must NOT be done

**No scripted sweep.** Each card needs a per-card judgement — done-but-unclosed, superseded,
abandoned, genuinely pending — and a script over prose it cannot parse destroys the audit trail it
was meant to repair. Two specific traps:

- **`updated:` must NOT be bumped by a mechanical repair.** The board sorts on it, so a format-only
  pass silently reorders the entire board.
- **A terminal column is FROZEN.** Do not edit the body of a card already `complete`/`published`/
  `live`/`superseded`; only `updated:` and `superseded-by:` may change.

## Shape of the work

1. **Triage the 18 `dev` cards individually**, reading each STATE block. Classify: done-but-unclosed
   → close it; superseded → `superseded` + `superseded-by:`; abandoned → `cancelled` with the
   reason; genuinely pending → back to `todo`/`planned` unless it is actually being worked; blocked
   → `blocked` with a TRUE `blocked-by:`.
2. **WIP must match capacity.** One worker means roughly ONE card in `dev`. Everything else is a
   lie the only view anyone consults tells them.
3. **Backfill checklists** on the open cards that lack them, so the gate stops being decorative.
   Highest value on cards already near a terminal column.
4. **Consider a lint** for "an open card in a WORK column with no checklist" — but only after the
   backfill, or it emits 69 warnings on day one and gets routed around.

## Triage log — start here, this is the running record

**2026-08-02T15:2x+0200 — first pass, 4 of 18 `dev` cards. `dev` 18 → 14.**

The hypothesis that started this pass was WRONG and is recorded rather than quietly dropped: I
expected the four cards nearest done (16/17, 10/11, 8/9, 5/6) to be *done-but-unclosed*, i.e. cheap
closures. **Not one of them was.** Every one had a genuinely open box. Forcing them closed would
have been precisely the damage the "no scripted sweep" rule exists to prevent — and the box counts,
which is all a script can see, pointed the wrong way.

The real drainage turned out to be different: **three of the four were not workable by ANYONE**, yet
sat in `dev` claiming active work.

| card | remaining box | judgement | → |
|---|---|---|---|
| `DQ6XN2VP` | declare each pipeline's R51.7 invariants | real pending work, nobody on it | `todo` |
| `Y8VPE3NS` | OBSERVE two empirical PTY unknowns | needs a real wedged agent; armed and waiting | `todo` |
| `OX5TT5OT` | end-to-end re-login — *"this is the human's step, at the host"* | only the USER can advance it | `human_review` |
| `FKGMNGJB` | repair 2 archived cards | ~~blocked on `janitor#139` — **verified OPEN, 0 comments, untouched since 2026-07-30**~~ → **#139 CLOSED 2026-08-05; claim written 2026-08-02 and dead 3 days later. Corrected 2026-08-21.** | `todo` + `external-refs` |

⚠ **The row above is the sharpest instance of this card's own thesis, so it is struck rather than
deleted.** The claim was not lazy — it was *checked*, and it recorded the check ("verified OPEN, 0
comments, untouched since 2026-07-30"). That is exactly what made it dangerous: a bare "blocked on
`janitor#139`" invites the next reader to look, while a dated verification **forecloses** the look.
It went stale 3 days after it was written and survived 16 more. A verification claim with no expiry
is a claim that gets more trusted as it gets less true. Found by the hub-authorized stale-blocker
sweep, 2026-08-21 (report: `reports/orchestrator/20260821_164101+0200-blocker-sweep-and-checkbox-census.md`),
which measured **9 of 12** externally-cited blockers already closed.

**A finding worth more than the four moves:** `FKGMNGJB`'s last box IS the two `BODY-STATE-CLAIM`
ERRORs that `trddgrep validate` reports on every run and that every session has been calling
"pre-existing frozen-card noise". They are not unowned — they are one card's last box, frozen behind
an external ruling. A known-issue list that outlives its issue starts hiding new ones.

**VOCABULARY GAP, recorded rather than papered over.** There is no honest way to say *"blocked on
something outside the corpus"*. `blocked-by:` takes TRDD ids only (all 6 blocked cards name one), so
a card waiting on a GitHub issue cannot use `column: blocked` without making `blocked-by:` a lie.
The existing precedent ([[35VKIGTC]] ← `janitor#167`) is `todo` + `external-refs:`, which is what
was followed — but `todo` asserts *"ready to be pulled"*, which is also false. Both available
answers are wrong in different directions. Worth a `blocked-external` column, or letting
`blocked-by:` carry an external ref.

**second pass, 5 cards, `dev` 14 → 9 — RECONSTRUCTED after the fact, and that is itself a finding.**

⚠ **The second pass wrote its reasons into each card and never wrote its entry here.** Commit
`179b7d51` touches the five cards below and **does not touch this file**. So the only place the
number "9 of 18" existed was `.janitor/state/agent-handoff.md` — a scratch file, not the record. The
table below is reconstructed from that commit and from each card's own `## ⏹ TRIAGE` block, which is
possible only because the per-card reasons WERE written. Had the pass done what the third pass did
(reasons here, not in the cards), the hole would have been unrecoverable.

| card | → | its own recorded reason |
|---|---|---|
| `903b7a20` | `todo` | explicit *"REMAINING (pick up in fresh context)"* list; untouched **20d**; 514 lines, no checklist |
| `WLWHVMKT` | `todo` | core fix landed E2E, but its STATE names **3 new blockers the E2E discovered** — closing would strand them |
| `96ZED7BA` | `todo` | concrete NEXT ACTION (SCEN-014 S017/S019/S023); nobody on it for **21d** |
| `TBGGUA2V` | `human_review` | *"batch gated on a USER cost-decision"* — no agent can advance it; claimed `dev` for **38d** |
| `N1FYP2AW` | `backburner` | its own STATE says **DEFERRED until the token-burn emergency lifts** — `backburner` is the column that means exactly that |

**2026-08-02T15:3x+0200 — third pass, the last 9 `dev` cards. `dev` 9 → 1.**

⚠ **Reasons are recorded HERE, not in each card**, unlike the first two passes — a deliberate
trade under context pressure, stated so it reads as a decision and not an oversight. This log is
the designated running record; `git log` on each file resolves to the same commit.

| card | age | what its own STATE says | → |
|---|---|---|---|
| `1GGQ4HWY` | 15d | USER REFRAMED it (replace the janitor daemon, don't coordinate) — large infra, pending | `todo` |
| `CHN16JXZ` | 10d | "Phase A (DETECTION) landed" — Phase B pending | `todo` |
| `U6AS2YWB` | 8d | "UNBLOCKED 2026-07-24 — both blockers complete"; 3 boxes still open | `todo` |
| `8C1Z42GV` | 8d | "NEXT ACTION: this is now PURE DATA — append a `ContinuityClientEntry` per client" | `todo` |
| `L55IYKL4` | 3d | "UNBLOCKED … read ai-maestro#96 before touching anything"; 5 boxes open | `todo` |
| `44RGLOO8` | 3d | *"Do not act on this without the USER … until the credential is rotated. An agent must never rotate a credential."* | **`human_review`** |
| `AQTGAY60` | 2d | real `DeleteAgent` defect, 2 boxes open | `todo` |
| `HW72YBZW` | 1d | implementation half of the SPS63XHA ruling; nobody on it | `todo` |
| `CVQJNW3A` | 1d | "THE REPAIR LEG IS BUILT AND WIRED … **It is NOT armed**" | `todo` |

**`5YRLA53W` itself moves `todo` → `dev`** — because it is the one card actually being worked, which
is the whole point of the exercise. **`dev` is now 1, matching capacity exactly.**

**The pattern across all 18, worth more than any single move:** not one card was abandoned, and not
one was done-but-unclosed. Every single one was *mis-filed* — deferred by its own text, gated on a
human, blocked externally, or simply pending with nobody on it. `dev` was never a record of work in
progress; it was where cards went and stopped. That is why the column count, not any individual
card, was the defect.

**⚠ The third pass's "reasons here, not in each card" trade was the WRONG call, and the second pass
is why.** I justified it as a context-pressure trade at the time. Then reconstructing the second
pass proved the opposite discipline is what saved it: the reasons survived in the CARDS when the
log entry was never written. A card carries its own reason to whoever opens it; a central log is a
single point of loss and is not read by anyone working one card. **Write the reason into the card;
the log is the index.** The nine cards moved in the third pass therefore carry no in-card triage
note — a known, recorded debt, not an oversight.

## Final census — measured 2026-08-02, both ends of the same instrument

```bash
grep -h '^column:' design/tasks/*.md | sort | uniq -c | sort -rn
```

| column | at census (97 cards) | now (98 cards) | Δ |
|---|---|---|---|
| todo | 17 | **31** | +14 |
| planned | 22 | 22 | — |
| testing | 11 | 11 | — |
| design | 9 | 9 | — |
| human_review | 4 | 7 | +3 |
| backburner | 6 | 7 | +1 |
| blocked | 6 | 6 | — |
| ai_review | 4 | 4 | — |
| **dev** | **18** | **1** | **−17** |

It reconciles exactly, and checking that it does is the point of re-deriving: 18 `dev` cards moved
out (14 → `todo`, 3 → `human_review`, 1 → `backburner`), this card moved `todo` → `dev`, and the
98th card is this one, created after the census was taken. `trddgrep validate` exits 1 with the same
**2** frozen-card `BODY-STATE-CLAIM` ERRORs as before (`7123D51A`, `C7A81642` — [[FKGMNGJB]]'s last
box), so the pass introduced no new corpus finding.

**What this does NOT fix.** `dev` is now honest; the board is not yet draining. Thirty-one `todo`
cards with one worker is a queue, and a queue only means something if something PULLS from it. The
next failure mode is the mirror of this one: cards that correctly say `todo` and still never move.

## The external-blocker sweep — 2 of 15 had already cleared, one of them 17 days ago

Writing the checklist for [[O8NCNRWO]] meant verifying its blocker, and its blocker was **closed**.
That turned one card's checklist into a corpus-wide question, so every open card's `external-refs:`
was checked live:

```bash
# every open card parked on a GitHub issue
for f in design/tasks/*.md design/proposals/*.md; do
  grep -m1 '^external-refs:' "$f" | grep -q 'issues/' && grep -H -m1 '^trdd-id:' "$f"; done
# then: gh issue view <n> --repo Emasoft/<repo> --json state
```

**15 referenced issues. 13 genuinely OPEN. 2 CLOSED:**

| issue | closed | consequence |
|---|---|---|
| `ai-maestro-plugin#17` | 2026-07-16, plugin v2.10.0 | **[[O8NCNRWO]] sat at `ai_review` for 17 days after its one remaining item became runnable.** Its own text said the e2e was *"observable only after the hook stops dropping the counter"* — it has been observable since |
| `ai-maestro-janitor#137` | — | cited by [[AQTGAY60]] as downstream-impact CONTEXT, not as a blocker. Nothing unblocked; noted so the next reader does not re-check it |

**⚠ THE SWEEP ITSELF WAS INCOMPLETE, by exactly the mechanism it was documenting.** It grepped
`external-refs:` for the substring `issues/` — and [[JT3U4ZVM]], the card with **twelve** external
refs and by far the most externally-dependent on the board, writes them as
`gh:Emasoft/ai-maestro-plugin#24`. No `issues/`, so the sweep reported it as having none. Found only
because it was the next card in the checklist backfill. There are at least four spellings in use
(`github.com/…/issues/N`, `https://github.com/…/issues/N`, `gh:owner/repo#N`, and a bare repo URL),
so **enumerate the spellings before declaring an absence** — a needle keyed on one shape reports a
confident clean about a set it never scanned.

Re-checked with that spelling, JT3U4ZVM is the **third** instance in this same column:

| card | its own claim | measured 2026-08-02 |
|---|---|---|
| [[JT3U4ZVM]] | PR `ai-maestro-plugin#25` is *"the single highest-value open item in the whole ecosystem … one click"*, and without it *"the entire fleet breaks again at the next version bump"* | **landed 20 days ago** — rebased onto `main` and shipped in v2.9.0, the tag step is durably in that repo's `publish.py`, and three releases since each carry their resolver tag. All 4 of its other external items (`#24`, `cms#2`, `CPV#163`) are CLOSED too |

**Three of the four `ai_review` cards were parked on external state that had already resolved.**
That is no longer an anecdote; it is the column's dominant failure mode.

### The sweep re-run properly — 47 refs, not 15, and 15 of them CLOSED

Re-extracted spelling-agnostically (all four forms, via a Python regex union rather than one
grep substring). **The first sweep saw 15 refs and missed 32 — 68% of them.**

```bash
# the corrected extractor: every spelling, from the frontmatter line only
python3 -c "…"  # github.com/o/r/(issues|pull)/N  ·  gh:o/r#N  ·  o/r#N
# then, per ref: gh issue view N --repo o/r --json state,closedAt
```

**47 distinct refs · 32 OPEN · 15 CLOSED.** The closed ones, by how long they have been closed:

| closed | ref | cards still pointing at it |
|---|---|---|
| 07-13 | `ai-maestro-plugin#24`, `#25` | [[JT3U4ZVM]] — **resolved above** |
| 07-14 · 07-16 · 07-23 | `maintainer-agent#28`, `orchestrator-agent#28`, `autonomous-agent#13` | [[JT3U4ZVM]] — the per-repo tag asks, all done |
| 07-16 | `ai-maestro-plugin#17` | [[O8NCNRWO]] — **resolved above** |
| **07-16** | **`janitor#78`** (heartbeat fire-cost) | **`WF0UE9BC` (planned) — 17 days, unexamined** |
| **07-28** | **`janitor#82`** (oauth_rotator keychain reads) | **`1GGQ4HWY` (todo) — unexamined** |
| **07-28** | **`janitor#118`, `#123`** (wikimem spec, memgrep validate) | **`L55IYKL4` (todo) — unexamined** |
| **07-30** | **`AgentlensPro#2`, `#3`** | **`WF0UE9BC` (planned), `KCRMSNL7` (design) — unexamined** |
| 07-30 | `janitor#137` | `AQTGAY60` — cited as CONTEXT, not a blocker; nothing to unblock |
| 08-01 | `janitor#100` (the absorb-the-daemon coordination) | 8 cards: `1GGQ4HWY` `9ZIF82HI` `CHN16JXZ` `DXJZM3BW` `H24DF6ZC` `JAU1ES1C` `KCRMSNL7` `P7RPOR5O`. Closed **yesterday** — not yet stale, but it is the single most-referenced external item on the board and worth a deliberate read |
| 08-02 | `ai-maestro-plugin#29` | `RIFM4UXN` — closed today |

**Resolved 2026-08-02, and the shape of the answers is the lesson.** All five were read. **Not one
was "a blocker that cleared."** A CLOSED state and a resolved dependency are different facts, and
only the closing COMMENT distinguishes them:

- `janitor#82` → [[1GGQ4HWY]]: closed, and **the flap it reports is still real** (their
  `TRDD-V5RXQ4NB`). What changed is its severity — two mitigations landed. It hands the card a
  **constraint** (*no unattended ACL-touching `security` op; prompting cures are interactive-only*),
  so a faithful port must carry the mitigations, not the pre-mitigation shape. Treating "CLOSED" as
  "solved" would have ported the bug.
- `janitor#118` → [[L55IYKL4]]: **shipped the artefact the card was waiting for** — the ~1300-line
  wikimem/memgrep spec, in every release from v0.62.0. And it explains the confusion: the file
  genuinely had **0 lines** in the cached v0.60.1, so the earlier reading was a *correct read of a
  stale cache*, not a misreading.
- `janitor#123` → [[L55IYKL4]]: closed by **correcting its own first explanation** — a retry ladder,
  not a cached finding, with the ticket store project-local at `.janitor/state/tickets/`.
- `janitor#78` + `AgentlensPro#2` → [[WF0UE9BC]]: the whole card had **shipped**, including the one
  step a model structurally cannot do (the npm publish). Re-columned `planned` → `human_review`.
- `AgentlensPro#3` → [[KCRMSNL7]]: the reciprocal contract, LOCKED in their CI.

**A second resting column, found the same way.** [[WF0UE9BC]] sat at `column: planned` — which
asserts *not started* — 17 days after its code landed and every dependency resolved. `planned` is
as unexamined as `dev` was, and a completed card frozen there is invisible in exactly the same way.
The sweep found it; reading the board never would have.

One reassurance from the same sweep: `9ZIF82HI` sits in `column: blocked` citing `janitor#100`, but
its `blocked-by:` names **`1GGQ4HWY`**, a TRDD that is genuinely open — so its `blocked` claim is
TRUE and the linter's invariant holds. The closed issue was context, not the blocker.

**The systemic finding, which is worth more than the two moves.** Nothing ever re-checks an external
blocker. A `blocked-by:` naming a TRDD is re-evaluated on every lint — `trdd-graph` reports a
dangling or already-closed blocker. A blocker living in `external-refs:` prose is checked exactly
once, by whoever wrote it, and then never again. So the vocabulary gap is not merely a labelling
inconvenience: **it is why an externally-blocked card cannot be noticed as unblocked**, which is the
same "silently abandoned" failure `BLOCKED-WITHOUT-BLOCKER` exists to prevent, one level out.

Two cards ([[FKGMNGJB]], [[35VKIGTC]]) carry their blocker in the BODY and not in `external-refs:`
at all, so even a sweep like this one misses them unless it greps prose. Both were checked by hand;
both blockers are open.

## The gate had no enforcer — and the "wait for the backfill" objection was measured wrong

Item 4 above said *"consider a lint … but only after the backfill, or it emits 69 warnings on day
one and gets routed around."* Both halves turned out to be wrong, and the measurement is what
showed it.

**First, the rule was already there and nothing ran it.** `aimaestro-trdd-approval.md` §D4 step 5b
declares the checklist requirement a **hard gate** on every terminal transition.
`grep -rn checklist lib/ scripts/` returned **zero hits** across the entire toolchain. So the
2026-07-31 repair of that rule's own vacuity (TRDD-9QV4ZCYY — a condition stated only over
UNCHECKED boxes passes a card with NO boxes) changed the text and nothing else: **a fix to a gate
is worth exactly what enforces it.** That is the same vacuity one level up, and it is the more
useful finding of this card.

**Second, the 69 was the wrong population.** The gate binds cards going *into* a terminal column;
the 69 are OPEN cards. Measured over the set the gate actually sees:

| terminal cards | count |
|---|---|
| grandfathered (`updated` < 2026-07-31, frozen by IND base §12) | 165 |
| past the boundary, compliant | **33** |
| past the boundary, would be flagged | **0** |

**Zero findings on day one**, and 33 consecutive compliant closures — the discipline is already
being followed; what was missing is what makes it survive a lapse. So the lint is a pure ratchet
and there was never a reason to wait for the backfill. Landed as `TERMINAL-WITHOUT-CHECKLIST` and
`TERMINAL-WITH-OPEN-BOX` in `lib/trdd-doctor.ts`, both ERROR, neither autofixable — a tool cannot
invent a checklist and must never tick a box.

Because it is silent on the live corpus, "design/ lints clean" cannot tell this rule from a blind
one, so all 15 tests seed their shape and **six neuters** pin them; each of the four deliberate
exclusions (grandfathered · cancelled/superseded · non-terminal · fenced code) falls to exactly
one. Two neuters redden the LIVE-corpus gate, which is the empirical proof that the 165
grandfathered cards are real and would flood the report.

**What is still open is the backfill, and it is smaller than recorded.** Scoped to the columns the
acceptance box names — WORK plus `human_review` — it is **19 cards**, not 69: 11 `testing`,
4 `ai_review`, 4 `human_review`. The other 50 are `planned`/`todo`/`design`/`backburner`, where a
checklist is premature by design (a `planned` card has not been designed yet). Each of the 19 needs
a real read to write a truthful checklist; inventing one from the title would be fabrication, which
is the same damage as a scripted sweep.

## ⏹ HANDOFF 2026-08-02T17:02 — `dev` → `todo`, preempted by a direct USER directive

**Stopping work on this card, and saying so rather than letting it keep claiming `dev`.** The USER
gave a new directive mid-turn: stop storing in `CLAUDE.md` what belongs in the wikimem, migrate it
out, and leave only build/install/test/branch/push plus an overview. That is now the priority, so
this card moves to `todo` — a card in `dev` asserts someone is working it RIGHT NOW, and after this
edit nobody is.

**Everything is committed; nothing is half-done.** 17 of 19 checklists are written and committed;
the P7XKV3N9 verification that was in flight was finished (`a4b97003`) rather than abandoned, since
its live checks were already run and dropping them would have thrown the evidence away.

**What is left is genuinely small and genuinely low-priority:** 2 checklists, [[44RGLOO8]] and
[[TBGGUA2V]], both already sitting in `human_review` — i.e. both already waiting on the human, so
neither is blocked by this card's pause.

**Read before resuming:** the METHOD is in the Acceptance box below, and it is the part worth
keeping — a checklist is TRANSCRIPTION, and every claim is re-verified live rather than copied.
Nine of the seventeen cards had a claim that did not survive that.

## Acceptance

- [x] every `dev` card is either genuinely in progress, or re-columned with a recorded reason —
      all 18, across three passes; reasons in-card for 9, in the log for 9 (debt recorded above)
- [x] `dev` holds a number of cards consistent with the number of workers — **1 card, 1 worker**
- [ ] every card sitting still names a TRUE `blocked-by:` (a blocker that is itself still open) —
      the `blocked` column's 6 all do, and all 15 external refs are now verified (2 had cleared).
      **BLOCKED ON THE VOCABULARY GAP** above: [[FKGMNGJB]] and [[35VKIGTC]] wait on GitHub issues
      and `blocked-by:` takes TRDD ids only, so they sit in `todo` claiming "ready to pull". The
      sweep proved the cost is not cosmetic — an external blocker is checked once and never again,
      so a card cannot be noticed as unblocked. Not closable without a corpus-level answer
      **⏹ 2026-08-21 — BOTH NAMED INSTANCES ARE RESOLVED, and re-measuring them PROVED the general
      claim rather than dissolving it.** Neither card sits in `todo` any more: `FKGMNGJB` is
      `complete` and archived, `35VKIGTC` is `backburner` (an honest resting state, parked for two
      reasons that do not depend on any issue). **And BOTH external blockers — janitor `#139` and
      `#167` — are CLOSED, which nothing on the board noticed for weeks.** `35VKIGTC` still carries
      `external-refs: [janitor#167]` pointing at a closed issue and its STATE still names
      *"continuing the existing thread"* as the route; the thread is gone. That is this box's own
      complaint happening again, to the very card it cites, while the box stayed open — so the
      instances close and **the gap does not.** Still needs the corpus-level answer.
      **⏹ 2026-08-21T22:56 — THE CORPUS-LEVEL ANSWER NOW HAS A CARD, AND THIS ONE FINALLY OBEYS
      ITSELF.** The gap is tracked as [[8GBIQMEP]] (*"the board cannot express an external blocker
      so external waits go stale unwatched — 9 of 12 cited issues already closed"*), `column: todo`,
      unblocked. This box demands that **every card sitting still names a TRUE `blocked-by:`** —
      and until this edit *this card* sat still in `todo` with `blocked-by: []`, waiting on exactly
      that gap, **naming nothing**. It was its own best counter-example and had been for 19 days.
      So the box does not close: the gap is real and open. What changes is that the card now
      declares its blocker (`blocked-by: [8GBIQMEP]`, `column: blocked`, `pre-block-column: todo`),
      which is the only honest column for *"my remaining work is gated on someone else's card"*.
      **An untrue column is worse than an unstarted card** — it hides the stall from the one view
      anyone checks, which is the whole thesis of this TRDD.
- [x] the completion gate is ENFORCED, not merely written — `TERMINAL-WITHOUT-CHECKLIST` +
      `TERMINAL-WITH-OPEN-BOX` in `lib/trdd-doctor.ts`, 15 tests, 6 neuters, 0 findings today
- [x] open cards in WORK columns carry a checklist — **19 of 19, then 22 of 22.** Each needed a
      real read; inventing a checklist from the title is fabrication, the same damage as a
      scripted sweep. Every one was transcription, not authorship — the cards already stated what
      they promised.
      **CLOSED 2026-08-06 08:40, re-measured rather than assumed.** The two that were outstanding
      ([[44RGLOO8]], [[TBGGUA2V]]) now carry 9 boxes each. Full sweep today: `dev` 1, `testing` 2,
      `ai_review` 3, `human_review` 16 — **22 cards, ZERO without a checklist** (lowest count is 6
      boxes). Note the population moved under this box while it was open (19 → 22 as cards entered
      and left the WORK columns), so "all of them" is the only form of this claim that stays true;
      a count would have gone stale again.

      **AND TRANSCRIBING IS NOT COPYING — six cards' claims did not survive re-running.** The
      checklist is worth writing because writing it forces the check:
      - [[DXJZM3BW]] promised a 5-field ceiling guard TWICE and had none (`toMatchObject` passes on
        a superset — the exact direction a token-adjacent field arrives from). Written + neutered.
      - [[YPIRL5RA]]'s DEFECT 2 safe-state gate was pinned by NOTHING: 7 of the 8 files importing
        the module `vi.mock` it away, so a grep reads like coverage. Written + 2 neuters.
      - [[95IKXQI6]]'s two installer guards were "isolated logic tested" in a run that left no
        trace — including the DOWNGRADE guard the USER's mandate named, whose failure is silent.
        Written; and the neuters then found a fixture passing for an accidental reason (a relative
        path resolved against a CWD whose parent happens to contain the directory).
      - **[[YPIRL5RA]]'s "build green" box found the BUILD BROKEN** — red since `675f5a9f`, owned by
        [[D8OYFG35]], invisible to `tsc` because a route module's exports are a closed set enforced
        only by Next.js's generated types. Fixed + ratcheted (`34e2be76`).
      - [[7HRDAD0U]] and [[JAU1ES1C]] each had a STATE whose "NEXT" a later block already answered.
      - [[CJWC3JLU]]'s literal criterion (`git log -1` cites the TRDD) was an instantaneous
        observation that becomes a permanently-failing box; transcribed by intent instead.
      - [[7U927FCM]] asked for gate-flag tests **by name** and shipped only half; the flag decides
        APP ENTRY, so wrong in one direction is a MAESTRO locked out of their own host.
      - [[K2WJH7RF]] Part 3 was DONE and three documents still said it was not — including
        `CLAUDE.md`, twice, the file loaded into every session.
      - [[BF3JN4TL]]'s headless verification item had no test *and could not have one* as the suite
        stands (every headless case 401s before `authorize()` is reached).
      - [[CC9PY337]]'s fence was made to FIRE rather than assumed, and its 0-IMPACT keychain delta
        re-measured at 0/0.
      - [[P7XKV3N9]]'s route was untested while its INGREDIENTS were — and the neuter showed the
        anti-oracle ORDER was pinned by nothing.
      Most of those are gaps a *count* of checklists would score as done.
- [x] the 5 stale external refs the corrected sweep surfaced — all read and recorded IN the cards.
      **Not one was simply "a blocker that cleared"**, and reading each closing COMMENT rather than
      its STATE is what made the difference: `janitor#82` closed while the flap it reports *remains
      real* (tracked as their `TRDD-V5RXQ4NB`) and hands [[1GGQ4HWY]] a design constraint, not an
      unblocking; `janitor#118` **shipped the artefact** [[L55IYKL4]] was waiting for (the ~1300-line
      wikimem spec, from v0.62.0) and diagnosed why the earlier reading was a correct read of a
      *stale cache*; `janitor#123` corrected its own first explanation; [[WF0UE9BC]] had shipped
      entirely, including the one owner-gated step
- [x] read `janitor#100` deliberately — done, recorded in full on [[KCRMSNL7]]. It closed as
      **superseded** by the janitor's shipped two-backend split, and its conclusion is one fact the
      8 cards all depend on: **the yield is BINARY ON LIVENESS, not on capabilities.** A live server
      takes all five absorbed chores; the `capabilities` array we publish is never consulted.
      Verified by effect (the liveness file was 16 s old, so the janitor is yielding right now)
- [x] `ai-maestro#95` and `#102` are OPEN and **both are stale** — the rotator tick is armed and
      beating (status 27 s old; its verdict is `reauth-needed`/`refresh-dead`, a real state needing
      the human), and #102's root cause — a reader stat'ing `version-update-request` against a
      writer that writes `version-update-requested.flag` — is fixed in `lib/janitor-control.ts:48`.
      Closing them is an outward-facing action on our own tracker: the human's call, not a
      housekeeping side effect.
      **RE-VERIFIED 2026-08-06 08:55 (read-only — the assertion, not the action):** both are
      still `OPEN`, last updated 2026-08-05, with 7 and 12 comments. So this box's claim is
      CURRENT, not a stale citation, and the item is still live rather than quietly resolved.
      Deliberately NOT commented on either: a status update is adjacent to the closing this box
      reserves for the human, and the box is about the decision, not the paperwork. Note #102
      (*the absorbed version-update chore is not running*) now has substantial new evidence from
      today's work on that very lane — [[PE54D95Q]] — which is worth carrying into whatever the
      human decides.
      **⏹ CLOSED 2026-08-21T22:56 — BOTH HALVES RESOLVED, NEITHER BY THIS CARD.** Measured just
      now, not inherited: `gh issue view` reports **`#102` CLOSED at 2026-08-21T19:59:40Z** — the
      fleet-recovery ask-queue pass closed it with a citation, which is precisely the "human's
      call" this box was reserving, taken through the sanctioned route rather than as a
      housekeeping side effect. **`#95` is still OPEN and is no longer stale**: its title is
      *"Server absorbs oauth-rotator-tick but does not run it"*, i.e. it is the external tracking
      issue for [[X4RK1NUW]], which is `todo`/P0/`min-approval-requirement: none` and is being
      worked **right now** as unit 1 of `reports/colony/DELEGATION-p0-drain.md`. An open issue with
      live work behind it is a correct open issue. So the box's premise — *both open, both stale* —
      is false in both halves, and the box closes on evidence rather than on a decision.
- [x] `updated:` was NOT bumped by any mechanical/format-only edit — every bump this session
      accompanied a real `column:` change, which does change what the card asserts
- [x] the census above is re-derived at the end and the deltas recorded — and it reconciles

## Approval log

- 2026-08-02T15:19:14+0200 — SELF-MANDATE (Tier 0). Board hygiene inside this project's own scope;
  no baseline, governance, release or cross-team surface.
