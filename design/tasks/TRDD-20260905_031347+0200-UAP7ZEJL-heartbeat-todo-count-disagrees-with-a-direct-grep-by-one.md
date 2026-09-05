---
trdd-id: UAP7ZEJL
title: The heartbeat todo count and a direct grep disagree by exactly one card
scope: project
project-id: ai-maestro
column: dev
created: 2026-09-05T03:13:47+0200
updated: 2026-09-05T04:22:01+0200
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

## ⏵ STATE — READ THIS FIRST — 2026-09-05 04:22

**DIAGNOSED — and the diagnosis is a BUG in the heartbeat, not a difference of question.
TWO mechanisms with OPPOSITE signs cancel to the recorded −1.** The heartbeat DROPS two real
open `todo` cards whose filenames its id-matcher cannot parse, and ADDS one local-scope card
the project grep cannot see. Net: heartbeat 51, grep 52 — **exactly the pair this card recorded
at 03:18, reproduced.**

> ### ⚠ THIS BLOCK REPLACES A WRONG DIAGNOSIS I COMMITTED AT 04:17 (`d301b00f`)
>
> That commit closed this card claiming the heartbeat was a strict SUPERSET of the grep (54 vs
> 53), that the only disagreeing card was the local `TRDD-BAXXIG0J`, that the reverse set
> difference was EMPTY, and that the recorded 51/52 direction was **"impossible"**. **Every one
> of those is false.** The cause: I reconstructed `_board_summary_bit`'s predicate in a throwaway
> script and **silently omitted its `if not uid: continue` line**, then reported my
> reconstruction's output as "the heartbeat's own predicate, re-run". A proxy read presented as
> the instrument — the exact failure shape this repo's lessons file names. An adversarial review
> fork flagged the omission as an untested gap; closing it changed 54 → **51** and inverted the
> finding. Kept visible rather than overwritten, because the card's own subject is two
> instruments disagreeing, and this is a third.

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

### Measured 2026-09-05 04:21, running that exact predicate — `uid` skip INCLUDED

| instrument | todo |
|---|---|
| the heartbeat's predicate, faithful (with the `uid` skip) | **51** |
| `grep -l '^column: todo$' design/tasks/*.md \| wc -l` | **52** |
| the same predicate with the `uid` skip WRONGLY omitted (my 04:17 error) | 53 |

(The grep read 53 at 04:15 and 52 at 04:21 because this card itself was moved out of `todo` in
between. It has since been moved back — see the Approval log.)

**The two sets differ in BOTH directions, so neither contains the other:**

| direction | cards |
|---|---|
| grep sees, heartbeat **DROPS** | `TRDD-8E8BE91A` *Upstream AMP Sync Before PR Submission* · `TRDD-80557822` *R6 Communication Graph Downstream Sync* |
| heartbeat sees, grep **misses** | `TRDD-BAXXIG0J` *statusline git-status orphans a zero-byte index lock* (LOCAL scope) |

−2 + 1 = **−1**. That is the whole gap, and it is why the difference survived a board mutation:
both mechanisms are structural.

### The bug: two open cards are invisible to every TRDD detector

The two dropped files are named `TRDD-<8hex>-<slug>.md` — the `v1-migrated` legacy shape, with
**no timestamp segment and only 8 hex chars**. `_TRDD_ID_RE` (`lib/trdd_common.py:196`) admits
only `TRDD-<YYYYMMDD_HHMMSS±HHMM>-<id8>-<slug>.md` or a **36-char** UUID, so these match neither
branch, `extract_uid` returns `None`, and `_board_summary_bit` skips them with `continue`.

**This is not confined to the board count.** That matcher's own comment says all three TRDD
detectors share it *"so all three TRDD detectors now share this single matcher via `extract_uid`"*
— so `trdd-drift` and `trdd-reminder` drop these two cards as well. One of them
(`TRDD-80557822`) is **`priority: 1`, `severity: MEDIUM`**, and it has been invisible to the
drain-by-default nudge that exists to stop exactly this.

Verified: exactly 2 of the project's task files fail `extract_uid`, and they are precisely these
two.

### Remedy — two options, different owners, NOT yet chosen

1. **In-project (this repo):** `git mv` the two files to the current spec shape
   `TRDD-<timestamp>-<id8>-<slug>.md`, deriving the timestamp from each card's own `created:`.
   Fixes visibility immediately for every detector; touches only this repo; ids unchanged.
2. **Upstream (ai-maestro-janitor):** widen `_TRDD_ID_RE` to admit the bare-8-hex legacy shape.
   Fixes it for every project with `v1-migrated` cards, but it is **another project's source** —
   per `how-to-fix-issues-of-other-projects.md` that means an issue or a fork+PR, never a
   local edit.

These are not exclusive; 1 is the immediate unblock, 2 is the general fix.

### The correct manual command

Until the remedy lands, **no single grep matches the heartbeat**, because the heartbeat is
under-counting. The honest project-scope count is the plain one:

```bash
grep -l '^column: todo$' design/tasks/*.md | wc -l          # project scope — currently 52
```

and the heartbeat's own (currently under-counting) set is reproduced with:

```bash
python3 -c "$(cat <<'EOF'
import sys; sys.path.insert(0,"<janitor-cache>/scripts/lib")
import trdd_common as t
print(sum(1 for _s,p in t.trdd_files("tasks",".")
          if t.extract_uid(p.name) and t.parse_trdd_state(p)[1]=="todo"))
EOF
)"
```

**Do not quote either number as "the board" without saying which set it is.**

## Why this is worth a card rather than a note

Every heartbeat prints a todo count, and this session made board-state claims from it repeatedly.
If it is off by one, every such claim inherits the error; if the grep is off by one, so does every
manual audit. (An earlier draft of this line read *"one of the two is wrong and nobody knows
which"* — and it turns out to have been RIGHT after all: the heartbeat IS wrong, it drops two
open cards. The 04:17 draft struck the line on the theory that the instruments merely answered
different questions; that theory is dead. The line stands.)

It was cheap to settle: find the heartbeat's counting code, run its predicate — **faithfully** —
against the same files, and name the cards the two sets disagree about. Settled at 04:21; the
04:15 attempt was settled wrongly because the predicate was not reproduced faithfully.

## Acceptance

- [x] The heartbeat's todo-counting code is located and its predicate stated here —
      `dispatch.py::_board_summary_bit:2654` over `trdd_common.trdd_files("tasks", …)`
      (`lib/trdd_common.py:148`), which iterates every scope root AND skips any file whose
      name `extract_uid` cannot parse
- [x] The exact cards the two instruments disagree about are named, by id — heartbeat DROPS
      `TRDD-8E8BE91A` and `TRDD-80557822`; grep MISSES `TRDD-BAXXIG0J` (local scope). The
      difference runs in BOTH directions; neither set contains the other
- [ ] Whichever instrument is wrong is fixed, OR the difference is documented as intended
      (with the reason) — **NOT DONE.** The heartbeat is WRONG (it drops two real open cards,
      one of them `priority: 1`), so "documented as intended" does not apply. Two remedy
      options are written up in the STATE block; neither is chosen or applied
- [ ] If the heartbeat is correct and the grep naive, the correct manual command is recorded
      in this card so audits stop using the wrong one — **N/A as written, and superseded:**
      the heartbeat is not correct, so no single command matches it. The STATE block records
      what each command actually counts instead. Re-word or drop this box once the remedy lands

## Approval log

- 2026-09-05T03:13:47+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: a read-only measurement discrepancy inside this project's own board tooling.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T04:22:01+0200 — **REOPENED (`complete` → `dev`, un-archived) by
  claude-opus-session. The 04:17 completion below is REVOKED: it was closed on a false
  diagnosis.** An adversarial review fork flagged that my reproduction of
  `_board_summary_bit` had silently omitted its `if not uid: continue` line. Closing that gap
  changed the heartbeat count 54 → 51 and inverted the finding: the heartbeat is not a superset,
  it DROPS two real open `todo` cards. Acceptance is 2/4, not 4/4. The revoked entry is kept
  below rather than deleted — it is the audit trail for how a wrong close happened.
- ~~2026-09-05T04:17:12+0200 — COMPLETED~~ (REVOKED, see above) by claude-opus-session. The heartbeat's predicate was
  located and re-run; the disagreement is the LOCAL scope, and the one card is TRDD-BAXXIG0J.
  Difference documented as INTENDED, correct multi-scope command recorded. Closed on the
  mechanism; the unexplained inverted 51/52 reading is recorded in the STATE block and is NOT
  claimed resolved.
