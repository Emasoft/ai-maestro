---
trdd-id: UAP7ZEJL
title: The heartbeat todo count and a direct grep disagree by exactly one card
scope: project
project-id: ai-maestro
column: complete
created: 2026-09-05T03:13:47+0200
updated: 2026-09-05T04:17:12+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: unassigned
task-type: bugfix
priority: 2
severity: low
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-05T03:13:47+0200
blocked-by: []
npt: []
eht: []
labels: [kanban, board-reporting, measurement]
---

# The heartbeat todo count and a direct grep disagree by exactly one card

## ⏵ STATE — READ THIS FIRST — 2026-09-05 04:17

**DIAGNOSED. The two instruments answer DIFFERENT questions, and the heartbeat is the correct
one: it counts EVERY SCOPE, the grep counts only the project scope.** The mechanism is a
one-line property of the library call, and the one disagreeing card is named below.

### The heartbeat's predicate, located

`dispatch.py::_board_summary_bit` (janitor 3.4.14, line 2654) counts, per column:

```python
for _scope, path in trdd_common.trdd_files("tasks", str(state.project_root())):
    uid = trdd_common.extract_uid(path.name)      # unparseable filename → skipped
    if not uid: continue
    _, column = trdd_common.parse_trdd_state(path)  # FRONTMATTER column, not any body line
    if column in _WORK_COLUMNS: ...
```

`trdd_common.trdd_files` (`lib/trdd_common.py:148`) says so in its own docstring — *"Every
`TRDD-*.md` in `folder` **across BOTH scopes**"* — iterating `design_roots(project_dir)`, i.e.
the PROJECT root **and** the LOCAL root `~/.claude/projects/<slug>/design/`. A project-directory
glob cannot see the local root at all.

### Measured 2026-09-05 04:15, running that exact predicate

| instrument | todo |
|---|---|
| the heartbeat's own predicate, re-run | **54** |
| `grep -l '^column: todo$' design/tasks/*.md \| wc -l` | **53** |

Scope breakdown of the 54: `{project: 53, local: 1}` (all task cards: `{project: 147, local: 1}`).

**The one card the two sets disagree about: `TRDD-BAXXIG0J`** — *statusline git-status orphans a
zero-byte index lock* — a LOCAL-scope card at
`~/.claude/projects/-Users-emanuelesabetta-ai-maestro/design/tasks/`. The set difference in the
other direction is **EMPTY**: no card the grep sees is dropped by the heartbeat. So at the current
board state the heartbeat's set is a strict SUPERSET of the grep's, differing by exactly the local
scope.

The heartbeat is therefore RIGHT and INTENDED — `universal-kanban.md` says tools scan every scope
root by default, and `trdd-design-tasks.md` calls the board "one kanban board, `scope` as a badge".
The naive grep is the instrument to stop using.

### ⚠ UNEXPLAINED RESIDUE — do not let the diagnosis above swallow this

The pair recorded earlier on this card had the heartbeat **LOWER** (51) than the grep (52). **That
direction is impossible under the mechanism just found** — a superset cannot be smaller than its
subset — and it is not reproducible now. Two separate facts, and welding them would be an
over-read:

1. VERIFIED — the mechanism above, measured directly at 04:15.
2. UNEXPLAINED — how the earlier reading came out one *below* the grep.

The mundane hypothesis, **untested**: the two figures were read from different moments (a heartbeat
nudge is emitted at fire time, so the "51" may have been a string printed before the board mutation
the grep was run after). A less mundane one: at 03:18 some project card's frontmatter column was
mid-edit. Neither was checked. If the pair is ever seen inverted again, that is a real finding and
deserves its own card — this one is closed on the mechanism, not on that residue.

### The correct manual command

```bash
# WRONG (project scope only — the naive form this card exists to retire):
grep -l '^column: todo$' design/tasks/*.md | wc -l

# RIGHT (every scope root, the heartbeat's own set):
grep -l '^column: todo$' \
  design/tasks/*.md \
  ~/.claude/projects/-Users-emanuelesabetta-ai-maestro/design/tasks/*.md 2>/dev/null | wc -l
```

Both forms are *correct answers to different questions* — use the first only when you explicitly
mean "project-scope cards", and say so when you quote it.

## Why this is worth a card rather than a note

Every heartbeat prints a todo count, and this session made board-state claims from it repeatedly.
If it is off by one, every such claim inherits the error; if the grep is off by one, so does every
manual audit. (An earlier draft of this line read *"one of the two is wrong and nobody knows
which"* — struck, because it presumes both instruments answer the same question. They do not, and
that presumption is exactly what delayed the diagnosis.)

It was cheap to settle: find the heartbeat's counting code, run its predicate against the same
files, and name the card the two sets disagree about. Settled at 04:15 — see the STATE block.

## Acceptance

- [x] The heartbeat's todo-counting code is located and its predicate stated here —
      `dispatch.py::_board_summary_bit:2654` over `trdd_common.trdd_files("tasks", …)`
      (`lib/trdd_common.py:148`), which iterates EVERY scope root
- [x] The exact card the two instruments disagree about is named, by id — `TRDD-BAXXIG0J`,
      LOCAL scope; the reverse set difference is empty
- [x] Whichever instrument is wrong is fixed, OR the difference is documented as intended
      (with the reason) — INTENDED: the heartbeat is multi-scope by design
      (`universal-kanban.md`, "tools scan every scope root by default"); the grep is
      project-scope-only. Neither is a bug; the naive grep is retired
- [x] If the heartbeat is correct and the grep naive, the correct manual command is recorded
      in this card so audits stop using the wrong one — recorded in the STATE block

## Approval log

- 2026-09-05T03:13:47+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: a read-only measurement discrepancy inside this project's own board tooling.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T04:17:12+0200 — COMPLETED by claude-opus-session. The heartbeat's predicate was
  located and re-run; the disagreement is the LOCAL scope, and the one card is TRDD-BAXXIG0J.
  Difference documented as INTENDED, correct multi-scope command recorded. Closed on the
  mechanism; the unexplained inverted 51/52 reading is recorded in the STATE block and is NOT
  claimed resolved.
