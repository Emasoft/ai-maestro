---
trdd-id: 5YRLA53W
title: The board is not draining and the completion gate is vacuous on 71 percent of open cards
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T15:19:14+0200
updated: 2026-08-02T15:19:14+0200
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
