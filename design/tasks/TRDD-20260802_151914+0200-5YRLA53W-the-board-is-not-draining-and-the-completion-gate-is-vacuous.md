---
trdd-id: 5YRLA53W
title: The board is not draining and the completion gate is vacuous on 71 percent of open cards
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T15:19:14+0200
updated: 2026-08-02T15:26:15+0200
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

## Acceptance

- [ ] every `dev` card is either genuinely in progress, or re-columned with a recorded reason
- [ ] `dev` holds a number of cards consistent with the number of workers
- [ ] every card sitting still names a TRUE `blocked-by:` (a blocker that is itself still open)
- [ ] open cards in WORK columns carry a checklist, so the completion gate is not vacuous
- [ ] `updated:` was NOT bumped by any mechanical/format-only edit
- [ ] the census above is re-derived at the end and the deltas recorded

## Approval log

- 2026-08-02T15:19:14+0200 — SELF-MANDATE (Tier 0). Board hygiene inside this project's own scope;
  no baseline, governance, release or cross-team surface.
