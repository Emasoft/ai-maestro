---
trdd-id: UAP7ZEJL
title: The heartbeat todo count and a direct grep disagree by exactly one card
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T03:13:47+0200
updated: 2026-09-05T04:26:12+0200
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
the project grep cannot see. Net offset **−1**, structurally — which is what explains the gap
surviving a board mutation.

**The finding is the OFFSET, not the digits.** At 04:21 the pair read 51 / 52, the same digits
the card recorded at 03:18 — but that identity is a coincidence of the todo population happening
to be the same size at both instants, not a re-measurement of the same sets (this card itself
moved in and out of `todo` in between). Had one unrelated card entered `todo`, the same mechanism
would have shown 52 / 53. Do not cite the digit match as proof; cite the −1 offset.

**The live heartbeat was then observed directly at 04:24: `open board: 51 in todo`.** That is the
instrument itself, not a reconstruction of it. What it settles is the doubt that actually
mattered — **the reconstruction is behaviourally equivalent to the running instrument on this
input.** It does NOT identify the version: any version sharing this predicate prints 51. The
version reading stays what it is, two agreeing proxies (`integrity/last-good.json` says `3.4.14`,
which is also the highest cached directory) — a certification record and a directory listing,
neither of them the executing artifact.

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

**This is not confined to the board count. FOUR of the five TRDD detectors drop these cards,
plus the board count — the population is enumerated, not sampled.**

Getting here took three tries, each fixing the previous one's quantifier:

1. asserted from `trdd_common`'s own comment (*"all three TRDD detectors now share this
   matcher"*) — a document, not the thing;
2. checked the **two** detectors that comment implied, and reported that as the radius — the
   comment's *census* survived unexamined after its *behaviour* claim was replaced;
3. enumerated **every** detector that reads TRDD files (`grep -l 'trdd_common\|trdd_files'` →
   5 files), and checked each.

| detector | keys on the FILENAME id? | these two cards |
|---|---|---|
| `trdd-drift.py` | yes — 5 sites (`:290` `return`; `:451` `:500` `:552` guarded, **no `else`** at any; `:647` `continue`) | **dropped** |
| `trdd-reminder.py:190` | yes — `continue` | **dropped** |
| `trdd-cross-card-blindspot.py:245` | yes — `_parse_card` returns `None` | **dropped** |
| `trdd-state-reconciliation.py:481` | yes, **INDIRECTLY** — `trdd_common.parse_trdd_record:764` calls `extract_uid(path.name)` | **excluded from every uid-keyed map** (`column_by_uid`, `scope_by_uid`, `idle_by_uid`); any finding naming them shows `uid = r["uid"] or "?"` |
| `report-to-trdd-drift.py:260` | **no** — matches report basenames against card CONTENT | **sees them normally** |

**The indirect site is the one that matters methodologically.** A `grep` for
`extract_uid|trdd-id|frontmatter` over the *detector files* finds nothing in
`trdd-state-reconciliation.py`, which reads as "this one doesn't key on the filename". It does —
through a helper in another module. A name-based search cannot answer a behavioural question,
and that near-miss is why the population is now enumerated by what each file *reads* rather than
by what it is *named after*.

Note what makes this a real bug rather than a naming preference: **both cards DO carry a valid
`trdd-id:` in frontmatter.** Every dropping site had the id available and keyed on the filename
anyway.

**What that does and does NOT mean for `TRDD-80557822` (`priority: 1`, `severity: MEDIUM`).**
It is dropped from the board count and from four of the five detectors — verified. It is NOT true
that the nudge would otherwise have named it: `_board_summary_bit` prints `sorted(ids)[:3]` plus
`+N more`, so a card is named only when its column holds ≤3 (or it sorts into the first three) —
`1 in dev (TRDD-UAP7ZEJL)` in the 04:24 nudge is exactly that case. With ~51 cards in `todo`, no
individual todo card is named, so being dropped costs it one increment of a number. Nor is "it
has been invisible *since April*" established — that is a duration claim, and neither the card's
continuous residence in `todo` nor the matcher's history was checked.

Verified: exactly 2 of the project's task files fail `extract_uid`, and they are precisely these
two.

### Remedy — two options, different owners, NOT yet chosen

**Unmeasured, and it gates option 1:** nobody has confirmed that renaming the two files actually
makes the detectors see them. It follows from the mechanism, and "it follows" is what three
corrections in a row have punished. Before or immediately after the rename, re-run the faithful
predicate and expect 53, not 51.

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
- [x] What each counting command actually counts is recorded in this card, so audits stop
      quoting one number as "the board" — recorded in the STATE block.
      (Re-worded 04:26: the original box read *"If the heartbeat is correct and the grep naive,
      the correct manual command is recorded…"*, whose premise the diagnosis falsified — it
      could never be truthfully checked, and a permanently-uncheckable box is a landmine for
      whoever closes this card, since the completion gate requires every box checked.)

## Approval log

- 2026-09-05T03:13:47+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: a read-only measurement discrepancy inside this project's own board tooling.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T04:29:55+0200 — Third review fork. Enumerated the FULL detector population (5, not
  2): `trdd-cross-card-blindspot` also drops these cards, and `trdd-state-reconciliation` drops
  them **indirectly** via `trdd_common.parse_trdd_record:764` — a call a name-based grep of the
  detector files cannot see, which is precisely the gap the fork predicted. Radius is 4/5 plus
  the board count, LARGER than the previous pass stated. Also: the three guarded `trdd-drift`
  sites confirmed to have no `else` (a ±3-line window shows a guard's opening, not its
  complement); "no individual card is named" corrected to the true rule (`sorted(ids)[:3]`, so
  columns of ≤3 DO name every card — the 04:24 nudge named this very card in `dev`); and the
  live-heartbeat observation re-scoped to what it proves (reconstruction ≡ instrument on this
  input) rather than to the version, which two proxies still only point at.

  **The process defect, named because it is now three-for-three:** every one of these was a
  QUANTIFIER error — `EMPTY`, `every detector`, `all 6`, `no individual card` — and each pass
  verified hard exactly where the last one was caught while accepting its neighbour on the
  cheapest read. The check is to ask, before committing any claim carrying a quantifier: *what
  is the population, and did I enumerate it or sample it?*
- 2026-09-05T04:26:12+0200 — Second review fork on the revocation. Acted on all of it:
  `column: dev` → `todo` (`dev` asserts a worker is on it; `assignee: unassigned` and the card
  waits on a human remedy choice, so `dev` was the one affirmatively false statement in the
  artifact); the detector blast-radius claim upgraded from a code comment to six verified call
  sites; the `priority: 1` "invisible to the nudge" overreach cut back to what was measured;
  "exactly reproduces the 03:18 pair" replaced by the −1 OFFSET, which is the real finding;
  acceptance box 4 re-worded off a falsified premise so it can ever be checked. Also noted, and
  NOT retracted by the revocation: **the heartbeat's multi-scope behaviour is still correct** —
  the 04:17 commit message's "every one of those is FALSE" enumerates four claims and should not
  be read as retracting that fifth one.
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
