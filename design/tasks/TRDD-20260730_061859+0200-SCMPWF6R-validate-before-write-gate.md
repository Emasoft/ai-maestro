---
trdd-id: SCMPWF6R
title: The pillar write seam accepts any value — validate BEFORE write, so corruption is impossible not merely detectable
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-30T06:18:59+0200
updated: 2026-07-30T06:18:59+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T06:18:59+0200
relevant-rules: [R25]
parent-trdd: L55IYKL4
derived: true
derived-kind: eht
blocked-by: []
npt: []
eht: []
labels: [pillar, write-gate, corpus-integrity]
---

# The pillar write seam accepts any value

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

**Nothing is corrupted today.** The census is clean and that is the first thing to
re-verify before acting, because the USER's report that "agents wrote a `non-started`
column" is FALSE and the false premise is what makes this card look urgent when it is not.

**NEXT ACTION:** add the validate-before-write gate to `editTrdd` in `lib/trdd-store.ts:270`
— reject any field whose value violates the corpus grammar, BEFORE `fs.writeFileSync`.
Every write path in the system funnels through that one function, so one gate covers all
of them.

**The gate must refuse, not warn.** A warning on a write path is a detector, and we
already have two of those (`greptrdd validate`, `trdd:doctor`) — both after the fact,
neither in CI or a git hook.

## The USER's report, and the correction it needs

> *"apparently some agents updated or created TRDDs with a non existent 'non-started'
> column"*

**No TRDD anywhere on this machine has ever carried that value.** Measured 2026-07-30:

```
grep -rn "^column:" design/            -> 297 values, every one in the ratified vocabulary
   105 complete · 44 completed · 40 proposal · 37 dev · 22 planned · 19 refused
    16 todo · 11 testing · 8 design · 6 blocked · 5 backburner · 4 cancelled
     4 ai_review · 2 superseded · 2 human_review
grep -rn "^column: *\(not\|non\)[-_]started" \
  design/ ~/agents/*/design ~/.claude/projects/*/design ~/Code/*/design   -> 0 hits
```

The string comes from **`Emasoft/ai-maestro-janitor#135`** (filed by CORE 2026-07-29,
still OPEN), and it says almost the opposite:

> *"The detector appears to read `status:`, find nothing, and **default the absence to
> `'not-started'`**. A missing field is being reported as a concrete value."*

`status:` is the **retired v1 field**. Every TRDD here is v2 (`grep -l '^status:'` returns
0). So the janitor's `trdd-drift` detector synthesizes `'not-started'` out of the *absence*
of a field whose absence is *conformance*, then reports three frozen `complete` cards as
stalled. It is a **reader** bug in the janitor, on the janitor's side, and no agent wrote
anything wrong.

**Worth keeping as a lesson in its own right:** a detector that invents a value for a
missing field produces a finding that is indistinguishable, downstream, from real
corruption — and it propagated to the USER as exactly that.

## But the structural point is right, and it is confirmed at the seam

The USER's actual argument survives the correction intact: *nothing stops it*. Read
first-hand, 2026-07-30:

| claim | verified |
|---|---|
| `greptrdd` has edit verbs | **NO.** Its whole surface is read: board/next/why/unblocks/roots/show/search + lint/validate/index-verify. The only write it names is `yarn trdd:fix` (mechanical repair of derivable findings). |
| a rule/skill mandates a tool for TRDD writes | **NO.** Zero mentions of `greptrdd` in `rules/aimaestro/*.md` or the IND base. There IS an intended write path (`aimaestro-trdd.sh` + the `ama-trdd-server` skill), but no rule says *never hand-edit*, and per CLAUDE.md its write verbs 403 for an agent caller. |
| the write path validates before writing | **NO — this is the gap.** |
| `prrdgrep` / `specsgrep` exist | **NO.** Neither does `design/requirements/PRRD.md`. Phase 3 of the active plan, blocked on NPT N1. |

**The seam, exactly:**

- `app/api/trdd/[id]/route.ts:69-77` validates only that each value **is a string** — and
  says why: *"the line-based writer emits `field: value` verbatim, so a non-string would
  corrupt the grep-first format."* Type, not grammar.
- `lib/trdd-store.ts:270-286` — `editTrdd` — loops `setFrontmatterField(content, k, v)` over
  an arbitrary `Record<string,string>` and calls `fs.writeFileSync`. **No enum check, no
  lint, no id resolution.**

So `aimaestro-trdd.sh edit <id> --set column=not-started` **succeeds**, and the value is
caught only later, by a detector nothing runs automatically. The USER's memgrep analogy is
the right one: memgrep's editorial ops are transaction-gated, so an invalid write cannot
land in the first place.

## What to build

**One gate, at the one seam.** `editTrdd` is the single funnel — the API route, the CLI,
and every lifecycle verb (`promote`/`refuse`/`archive`) go through it or its siblings in the
same file. Validating there means no caller can bypass it, which is the whole reason not to
put the check in the route.

1. **Field grammar, refusing on violation** (reuse the doctor's existing rule set — do not
   author a second vocabulary, that is how two sources of truth start):
   - `column` ∈ the ratified 17 + the folder-lifecycle overlay values
   - `blocked-by` non-empty ⟺ `column: blocked`
   - a referenced `TRDD-<id8>` must RESOLVE (`blocked-by`, `npt`, `eht`, `parent-trdd`,
     `supersedes`, `superseded-by`) — the USER's *"and reference existing TRDDs"*
   - `min-approval-requirement` ∈ the authority ladder; `mandate: true` ⇒
     `authority(mandated-by) >= authority(min-approval-requirement)`
   - dates parse as ISO 8601 with an offset, and `updated` is never in the FUTURE
   - terminal columns are frozen (§12) — refuse a body edit on `complete`/`published`/`live`
2. **Return the finding, not a boolean.** The refusal must name the field, the value, and
   the legal set, so an agent's next attempt is correct rather than a guess.
3. **Same gate for the two missing pillars** when Phase 3 lands — `prrdgrep`/`specsgrep`
   inherit it from `lib/pillar/store.ts`, they do not re-implement it.
4. **THEN mandate the tool in the rules.** A rule that says *"never hand-edit, use the
   tool"* is worth writing only once the tool can actually refuse a bad write. Ordered this
   way deliberately: mandating a tool whose validation is a no-op buys nothing and costs
   every agent a round-trip.

## Explicitly NOT in scope

- **The janitor's `trdd-drift` reader bug.** That is janitor#135, on their side, already
  filed. Our gate would not have prevented it — the value was never in a file.
- **Making `aimaestro-trdd.sh`'s write verbs reachable by an agent** (they 403 today). A
  separate authorization question; do not smuggle it in here.
- **Wiring `greptrdd validate` into CI or a git hook.** Complementary, cheap, and a
  different card — a post-hoc gate and a pre-write gate solve different halves.

## Acceptance

- [ ] `editTrdd` refuses an out-of-vocabulary `column` with a message naming the legal set,
      and the file on disk is **byte-identical** afterwards (a refusal that half-writes is
      worse than no gate)
- [ ] a dangling `blocked-by: [TRDD-XXXXXXXX]` is refused; a resolvable one is accepted
- [ ] the grammar is READ from the doctor's existing rules, not re-authored — proven by
      deleting a rule from the doctor and watching the gate stop refusing that shape
- [ ] every guard carries a recorded **neuter run** (break it, watch the NAMED test fail;
      read the test COUNT, never the exit code)
- [ ] the full suite is green and the 297-value census is unchanged
- [ ] the rule mandating the tool is written LAST, after the gate demonstrably refuses

## Notes and lessons learned

- A detector that synthesizes a value for a missing field manufactures corruption reports
  indistinguishable from real corruption — and this one reached the USER as a claim that
  agents had written a bad column. Report *"no state field"*, never a default.
- A grep for `^column:` matches the BODY too. Chasing this, I flagged
  `~/Code/ANIME2SVG/…-3ZAF2O2I-…md:53` as a prose-valued column; the frontmatter closes at
  line 15 and the real value is `planned`. My own lessons file already carries this trap,
  and I walked into it anyway — one command (`awk` for the closing `---`) settles it.

## Approval log

- 2026-07-30T06:18:59+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Tier 0: this project's own source, in-scope, reversible, no cross-team or release surface.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
