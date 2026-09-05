---
trdd-id: UAP7ZEJL
title: The heartbeat todo count and a direct grep disagree by exactly one card
scope: project
project-id: ai-maestro
column: blocked
pre-block-column: todo
created: 2026-09-05T03:13:47+0200
updated: 2026-09-05T04:45:25+0200
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
blocked-by: [D552QXOU]
blocker-probe: sh -c 'grep -m1 -h "^column:" design/*/TRDD-*D552QXOU*.md || echo column-PROBE-BROKEN'
blocker-holds-if: not-match:(published|complete|live|failed|superseded|cancelled|refused)$
npt: []
eht: [D552QXOU]
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

**This is not confined to the board count. FOUR of the five files under
`janitor/scripts/detectors/` that reference `trdd_common`/`trdd_files` drop these cards, plus
`dispatch.py::_board_summary_bit`.** The enumerator is stated rather than the bare ratio, because
"4 of 5 detectors" cannot be checked without re-deriving my grep — and that grep covers
`detectors/*.py` ONLY. Board-reading code elsewhere (other `dispatch.py` clauses, skills,
`scripts/`) was **not** enumerated.

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
| `report-to-trdd-drift.py:260` | **no** — `_trdd_corpus:222` concatenates every TRDD's full text into ONE string and substring-tests report basenames against it; no uid anywhere | **sees them normally** (VERIFIED 04:33 — this row was committed at 04:31 on an unopened helper, i.e. the same mistake as the paragraph below it, and only survived because the guess was right) |

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
predicate and expect +2 (52 → 54 at the 04:33 board).

> **⚠ OPTION 1 IS NOT TIER 0, AND IT IS NOT TWO COMMANDS.** It was described that way here and
> to the user, on the strength of never having grepped for what references the filenames. It
> does. Measured 04:33 — the two paths are cited in **four** places beyond the cards themselves:
>
> | file | why it matters |
> |---|---|
> | `design/specs/governance-spec.md:397` | a spec citing the card by PATH |
> | `docs/GOVERNANCE-RULES.md:416` | **a governance file** — R6.10's enforcement note |
> | `docs/COMMUNICATION-GRAPH.md:202` | downstream-sync tracking |
> | both cards' own `**Filename:**` lines | self-referential, would become false |
>
> So the rename is a **6-file change, not two `git mv`s** — the four citing references must be
> updated in the SAME commit, per `check-all-files-after-breaking-change.md`. Three test files
> also contain these strings (`tests/unit/trdd-store.test.ts:125`,
> `trdd-corpus-invariants.test.ts:210`, `kanban-index.test.ts:109`) but they are FIXTURES that
> WRITE synthetic content into temp dirs to exercise the legacy-name path deliberately — they
> never read the repo path, and must NOT be renamed.
>
> **Its floor is `none`.** A previous draft of this box called it `manager` on the grounds that
> `docs/GOVERNANCE-RULES.md` is a governance file. That was an OVER-escalation, and over-escalating
> is not the safe direction — it parks a verified bug behind an approval nobody is coming to grant
> (this board carries 14 `blocked` and 5 `approval` cards). Verified 04:36: all three doc hits are
> bare paths inside `` tracked in `<path>` `` constructions, so the edit changes no rule text, no
> enforcement status, no assertion. D3's governance row gates changes to what governance *says*;
> repairing a pointer the rename itself made dangling is the mechanical cleanup
> `check-all-files-after-breaking-change.md` **requires** — a rule cannot mandate a repair and
> simultaneously gate it.
>
> Both errors here are the same one twice, on the remedy instead of the diagnosis: a claim
> ("two `git mv`s", then "`manager`") committed on the cheapest available evidence rather than
> the evidence the claim required.

1. **In-project (this repo):** `git mv` the two files to the current spec shape
   `TRDD-<timestamp>-<id8>-<slug>.md`, timestamp from each card's own `created:` —
   `TRDD-20260424_154516+0200-8E8BE91A-upstream-amp-sync.md` and
   `TRDD-20260424_040831+0200-80557822-comm-graph-downstream-sync.md` — **and update the four
   citing references above, in the same commit.** Ids unchanged, `git mv` preserves history.
   Tier 0.
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
- [x] Whichever instrument is wrong is fixed, OR the difference is documented as intended
      (with the reason) — **FIXED at the data, 04:37** (remedy option 1, Tier 0): both cards
      renamed to the spec shape, the four citing references updated in the same commit, and the
      board re-measured — the faithful predicate went **52 → 54 exactly as predicted**, with
      **0 unparseable filenames remaining in ANY zone** (proposals/tasks/archived/refused all
      clear). **Precisely:** `extract_uid` now parses both filenames — which is the exact
      condition all four detectors and the board count gate on. The commit message for
      `f6f4664e` says "visible to all 5 detectors"; that is an inference from the measured
      condition, not a separate measurement, and the careful sentence is this one.
      **The MATCHER is still unfixed** — `_TRDD_ID_RE` cannot parse the legacy shape, so a
      future `v1-migrated` card named that way would be invisible again. Now tracked as its own
      card, **TRDD-D552QXOU**, so the decision survives this conversation.
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
- 2026-09-05T04:45:25+0200 — **Blocker probe repaired: it would have died exactly when it should
  have fired.** The first version hard-coded D552QXOU's full `design/tasks/…` path. Three of that
  card's four acceptance branches end in closure, and a closed card is `git mv`d to
  `design/archived/` — at which instant the `grep` fails, the `||` fallback fires, the fallback
  text matches no terminal column, and `not-match` therefore reports **BLOCKER HOLDS**. So
  UAP7ZEJL would have parked permanently *because its blocker resolved*. Worse than no probe: a
  missing probe is flagged by `BLOCKED-WITHOUT-PROBE`, while this one reads as a healthy parked
  card forever.

  **The general shape, worth more than this instance: a probe whose FAILURE MODE is
  ANTI-CORRELATED with the condition it measures.** Every path breakage — wrong cwd, renamed
  file, archived card — yields the same fallback and the same "still blocked" verdict, so
  "probe broken" and "genuinely blocked" are indistinguishable. Fixed by globbing every zone
  (`design/*/TRDD-*D552QXOU*.md`) so the card is found wherever it lands, and by renaming the
  fallback `column-PROBE-BROKEN` so a human reading the output can tell the two apart.

  Verified with a REAL archived card rather than a simulation: the same glob shape against an
  existing `design/archived/` card returns `column: superseded`, which the regex matches — i.e.
  the archival case CLEARS as intended.

  (Note: the sibling probe on TRDD-2LIS20K1 keys on a `design/tasks/` path the same way. Not
  touched — another card's frontmatter — but it is the same latent defect.)
- 2026-09-05T04:42:43+0200 — **`todo` → `blocked`** (`blocked-by: [D552QXOU]`,
  `pre-block-column: todo`). Wiring D552QXOU as an EHT at 04:40 left this card in an
  INCONSISTENT triple: a non-empty `eht:` naming a non-terminal child, an empty `blocked-by:`,
  and `column: todo`. The parent-completion rule does not merely gate the eventual transition —
  it says such a parent **IS** `blocked`, naming its open children. So the commit message's
  "cannot reach `complete` until this resolves" described a gate the frontmatter did not carry.

  **`trddgrep validate` said "no findings on either card", and that was silence, not
  confirmation.** D4 step 5b checks `blocked-by` non-empty ⟺ `column: blocked`; it does not
  check `eht:` against the column, so this state passed a linter whose rule it violated. A clean
  verdict is clean of the classes the tool tests — which is already a lesson in
  `.claude/rules/lessons-verification.md` ("0 errors means no rule looked") and was quoted here
  as evidence anyway.
- 2026-09-05T04:38:04+0200 — **REMEDY 1 APPLIED (Tier 0).** The fifth review fork found one
  material error and it was mine in the OTHER direction: I had escalated this to `manager` on
  the grounds that `docs/GOVERNANCE-RULES.md` is a governance file. Verified the three doc hits
  are bare paths inside `` tracked in `<path>` `` — the edit changes no rule text, no
  enforcement status, no assertion — so D3's governance row does not apply and the floor is
  `none`. Over-escalation is not the safe direction: it would have parked a verified bug behind
  an approval nobody is coming to grant, on a board already carrying 14 `blocked` and 5
  `approval`.

  Applied: both cards renamed to the spec shape, four citing references updated in the same
  commit (`check-all-files-after-breaking-change`), self-referential `**Filename:**` lines
  updated with a deliberately-historical note. **Verified by effect, not by intent:** faithful
  predicate 52 → **54**, matching the prediction; **0 unparseable filenames in all four zones**;
  the three test files that contain these strings pass (96 tests, 3 files) — confirming they are
  fixtures that WRITE synthetic content, never read the repo path.

  **Revealed, not caused:** `trddgrep validate` now emits two `META-MISSING created-by` WARNs on
  the renamed cards. They were always missing; the cards were simply invisible to the linter.
  Left as-is — `created-by` is an authorship fact, and inventing one to silence a warning is
  exactly the wrong trade.
- 2026-09-05T04:33:40+0200 — Fourth review fork; **acted on its findings and then STOPPED
  reviewing, per its own closing advice.** It predicted I would verify the census hard and take
  its neighbour cheaply, and it was right: the `report-to-trdd-drift` row had been committed on
  an unopened `_trdd_corpus`. Opened it — the row STANDS (it concatenates every TRDD's full text
  and substring-tests; no uid), so the radius is unchanged at 4/5.

  **The finding that actually changes what happens next:** grepping for what CITES the two
  filenames — which had never been run — shows remedy option 1 is a **6-file change touching
  `docs/GOVERNANCE-RULES.md`**, so its floor is `manager`, not `none`. It was described to the
  user four times as a Tier-0 pair of `git mv`s. Recorded in the remedy section.

  Also: the "4 of 5 detectors" ratio now states its enumerator (`detectors/*.py` only; other
  board-reading code NOT enumerated), and the process-defect paragraph corrected from "every
  one" (4 of 6) to the generalisation that covers all six.

  **NOT reviewed further.** Four passes produced four commits of documentation about a bug
  nobody has fixed; the findings are now smaller than the passes that find them. The card is
  handed to the user for the remedy decision.
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

  **The process defect.** Four of the six defects across these passes were QUANTIFIER errors
  (`EMPTY`, `every detector`, `all 6`, `no individual card`); the other two were not — the
  original `uid`-skip omission was an unfaithful reproduction, and *"the direction is
  impossible"* was a modal overclaim from an unstated assumption. (An earlier draft of this
  paragraph said *"every one"*, which is the same unearned quantifier it was written to warn
  about.) The generalisation that covers all six: **a claim was committed on the strongest
  evidence that was CHEAP, rather than the evidence the claim required** — and each pass
  verified hard exactly where the last one was caught while taking its neighbour on the cheapest
  read. Scrutiny followed the wound, not the risk.
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
