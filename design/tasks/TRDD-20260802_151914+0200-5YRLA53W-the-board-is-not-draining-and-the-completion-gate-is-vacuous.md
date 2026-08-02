---
trdd-id: 5YRLA53W
title: The board is not draining and the completion gate is vacuous on 71 percent of open cards
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-02T15:19:14+0200
updated: 2026-08-02T15:47:11+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
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
| `FKGMNGJB` | repair 2 archived cards | blocked on `janitor#139` — **verified OPEN, 0 comments, untouched since 2026-07-30** | `todo` + `external-refs` |

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

## Acceptance

- [x] every `dev` card is either genuinely in progress, or re-columned with a recorded reason —
      all 18, across three passes; reasons in-card for 9, in the log for 9 (debt recorded above)
- [x] `dev` holds a number of cards consistent with the number of workers — **1 card, 1 worker**
- [ ] every card sitting still names a TRUE `blocked-by:` (a blocker that is itself still open) —
      the `blocked` column's 6 all do. **BLOCKED ON THE VOCABULARY GAP** above: [[FKGMNGJB]] and
      [[35VKIGTC]] wait on GitHub issues and `blocked-by:` takes TRDD ids only, so they sit in
      `todo` claiming "ready to pull". Not closable without a corpus-level answer
- [x] the completion gate is ENFORCED, not merely written — `TERMINAL-WITHOUT-CHECKLIST` +
      `TERMINAL-WITH-OPEN-BOX` in `lib/trdd-doctor.ts`, 15 tests, 6 neuters, 0 findings today
- [ ] open cards in WORK columns carry a checklist — **untouched, and it is 19 cards, not 69**
      (11 `testing`, 4 `ai_review`, 4 `human_review`). Each needs a real read; inventing a
      checklist from the title is fabrication, the same damage as a scripted sweep
- [x] `updated:` was NOT bumped by any mechanical/format-only edit — every bump this session
      accompanied a real `column:` change, which does change what the card asserts
- [x] the census above is re-derived at the end and the deltas recorded — and it reconciles

## Approval log

- 2026-08-02T15:19:14+0200 — SELF-MANDATE (Tier 0). Board hygiene inside this project's own scope;
  no baseline, governance, release or cross-team surface.
