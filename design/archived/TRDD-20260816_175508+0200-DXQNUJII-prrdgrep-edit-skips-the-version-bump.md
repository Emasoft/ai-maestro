---
trdd-id: DXQNUJII
title: prrdgrep edit changes a rule's TEXT without bumping its VERSION, which the PRRD format forbids
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T17:55:08+0200
updated: 2026-08-21T16:29:09+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-16T17:55:08+0200
derived: false
npt: []
eht: []
blocked-by: []
implementation-commits: [6c510fc7]
release-via: none
priority: 2
severity: medium
effort: small
labels: [pillar-tooling, prrd, governance, latent, colony-pillar-run]
external-refs: []
---

# `prrdgrep edit` skips the version bump the PRRD format requires

## Problem

`~/.claude/rules/prrd-design-rules.md` — the IND base loaded in every session — defines the rule
id as `<letter><number>.<version>` and states the invariant twice:

> **version** — edit counter, **bumped on every text change**, forward only

> Editing the text bumps only the version (`S70.3` → `S70.4`).

`prrdgrep edit` does not bump it. Reproduced first-hand 2026-08-16 against a throwaway fixture
(built under `mktemp -d`, `--design-dir` pointed at it, removed after; no live PRRD touched):

```
$ prrdgrep --design-dir $TMP/design edit G7.4 --expect "rule text." --replace "changed text."
edited PRRD.md
@@ line 5 @@
-- **G7.4** — rule text.
+- **G7.4** — changed text.
exit=0

$ grep 'G7' $TMP/design/requirements/PRRD.md
- **G7.4** — changed text.          ← still .4
```

The text changed, the version did not, and the tool exited 0. **A citation pinned as `PRRD G7.4`
now resolves to different text than it did before, with nothing in the id to say so** — which is
the exact failure the version field exists to prevent. That makes every pinned citation in every
TRDD silently unreliable rather than loudly stale.

## Why this is filed as LATENT, not urgent

**This repo carries no PRRD at all** — `find . -iname 'PRRD*.md'` returns nothing repo-wide, and
`lib/pillar/kinds.ts:181-182` says so in its own comment (*"this repo has none yet"*). So nothing
is corrupted today. It bites the first project that adopts one, and it will bite silently.

## The decision this needs — deliberately NOT taken here

Two defensible fixes, and this is a governance tool, so the choice is not a detail:

- **(a) AUTO-BUMP.** `edit` increments the version whenever the replaced text differs. Matches the
  rule's wording exactly ("bumped on every text change"), costs the caller nothing, and cannot be
  forgotten. Risk: it bumps on a whitespace or typo fix too, and a version is a public number other
  documents cite — an inflated counter is itself a small lie.
- **(b) REFUSE.** `edit` fails with a could-not-run when the replacement changes the rule text and
  the caller did not also supply the new version. Never writes anything wrong; costs one extra
  argument. Risk: friction on legitimate edits, and friction on a governance tool is how people
  route around it.

A third possibility worth naming so it is not rediscovered: **`edit` may be intended as a generic
text primitive** whose caller owns the version, in which case the defect is the missing ENFORCEMENT
elsewhere rather than in `edit` itself. Settling that requires reading who calls it and what the
PRRD write path is supposed to be — not assuming.

**Do not change PRRD edit semantics unilaterally.** The IND base rule is USER-owned; a tool that
silently starts renumbering rules is worse than one that silently does not.

## ⏹ 2026-08-21T16:22 — DECISION: (b) REFUSE, at the guard seam that already exists

The card's third possibility is the right shape and the card's premise about it is slightly wrong:
`edit` **is** a generic text primitive, and enforcement **does** already live elsewhere — the seam
is not missing, it has a HOLE. Measured:

| fact | evidence |
|---|---|
| `edit` is kind-agnostic (`AT LINE N REPLACE X WITH Y`) | `lib/pillar/cli.ts:290-346` — one `runPillarEdit` for every pillar |
| a PRRD-scoped pre-write veto already runs INSIDE the lock | `cli.ts:339` → `pillarPreWriteCheck(kind, …)` |
| it already judges ids: parse, number globally unique, **number immutable**, **version forward-only** | `lib/pillar/edit-guard.ts:195-224`, all inside `if (kind.name === 'prrd')` |
| what it does NOT judge | version must ADVANCE when the text changes — it only forbids going BACKWARD |

So the fix is **one clause beside its own mirror** (`parts.version < prevParts.version`), not a new
mechanism: *same number + same version + `prev !== next` ⇒ refuse.*

Why (b) over (a) AUTO-BUMP: teaching a generic line primitive to rewrite an id the caller never
typed is a confident write, and the card already names the cost (a whitespace fix inflating a
public number). Refusing exits **2 BLOCKED**, the guard's documented contract for an illegal edit.

`specgrep` is unaffected **by construction** — the clause sits inside the existing `kind.name ===
'prrd'` branch — which is stronger than the card's asked-for cross-check test, and cheaper.

**The no-op half needs an explicit `prev !== next`, and this is the trap:** `changedLines` carries
the lines the caller TARGETED, not the lines that actually moved (`edit.ts:281` —
`ordered.map(e => e.line)`), so `--expect X --replace X` reaches the guard looking like a change.

```
sed -n '290,300p;336,343p' lib/pillar/cli.ts   # generic primitive + the veto hook
sed -n '212,226p' lib/pillar/edit-guard.ts     # the mirror clause this one joins
sed -n '276,283p' lib/pillar/edit.ts           # changedLines = targeted, not changed
```

## Verification

- Unit: a fixture PRRD with `- **G7.4** — <text>`; run `edit` changing the text; assert the id
  reads `G7.5` (option a) or that the call refuses non-zero and the file is UNCHANGED (option b).
- **Complementary half, mandatory:** an edit that changes NOTHING (same text) must not bump.
  Without it, an implementation that bumps unconditionally passes the first test.
- **Neuter:** disable the new behaviour → exactly the named test reddens and only it.
- Cross-check `specgrep`, which shares `lib/pillar/edit.ts` — the spec corpus has no version field,
  so confirm the change is PRRD-kind-scoped and does not alter spec edits.

## ⏹ 2026-08-21T16:29 — SHIPPED as `6c510fc7`. Two neuters, and FOUR tests pinned the defect

**The clause** (`lib/pillar/edit-guard.ts`, inside the existing `kind.name === 'prrd'` branch):
same number + same version + the rule TEXT differs ⇒ refuse (exit 2 BLOCKED).

**Two neuters, both PREDICTED before running, both exact** (via `scripts/dev/neuter`, restore
verified by blob hash):

```
s/parts\.version === prevParts\.version &&/parts.version === -1 &&/   → 1 red / 19 green
    refuses a TEXT change under an UNCHANGED version (G7.4 text edited, still .4)

s/ruleTextOf\(prev\) !== ruleTextOf\(next\)/true/                     → 2 red / 18 green
    ALLOWS a NO-OP edit on a rule line (expect === replace does not trip the bump gate)
    POSITIVE CONTROL — a tier flip … (S2.3 -> G2.3, the promote shape)
```

The second neuter is the one worth keeping: it proves BOTH traps are real, not defensive.
Comparing the whole LINE instead of the rule TEXT refuses a legal **tier promote**, and dropping
the comparison entirely refuses a **no-op** — reachable because `changedLines` carries the lines
the caller TARGETED, not the ones that moved.

**FOUR existing tests asserted the defect** — this is the finding, not a chore. Nothing anywhere
enforced the bump, so every positive control written for `edit` naturally used a text-edit with no
bump, and each one *looks* like coverage:

| test | was | now |
|---|---|---|
| `pillar-edit-guard` "POSITIVE CONTROL — a legal text edit (id unchanged) lands" | asserted the exact edit now refused | same edit, verdict inverted |
| `pillar-grep-cli` "POSITIVE CONTROL: the edit LANDS" | `S7.4` text → `REVISED`, id untouched | `S7.4 → S7.5` with the text |
| `pillar-grep-cli` "targets the record own declaration line…" | same shape | bump; **and see below** |
| `pillar-grep-cli` "lands a batch of two VALID edits together" | two unbumped text edits | both bumped |

**A name/body mismatch found while editing the third:** it is named *"when `--at-line` is
omitted"* and passed `--at-line 8`, so it never drove the default and would have stayed green with
the defaulting deleted. Both forms are now driven, because the claim is that they AGREE.

**Not mine, pre-existing, measured at HEAD with the guard reverted** — `pillar-grep-cli` fails 3
tests before and after this change (same names, same count): the `STALE ` first-token pair (PRRD
and SPEC) and `trddgrep validate --rule STALE-COLUMN` expecting 2 findings and getting 1. Filed
separately rather than folded in here.

`tsc` 0. Pillar cluster 117 pass / 120, the 3 reds being exactly those.

## Acceptance

- [x] The design decision (a / b / "enforcement belongs elsewhere") is taken and recorded here with
      its reason, before any code changes. — **(b) REFUSE at the existing guard seam**, 2026-08-21;
      see the DECISION section above for the four measurements it rests on.
- [x] `prrdgrep edit` on a text-changing edit either bumps the version or refuses — whichever (a)/(b)
      the decision selected — and never silently writes changed text under an unchanged version.
      **REFUSES**, exit 2 BLOCKED, file byte-identical (`expectRefusedByteIdentical` asserts both).
- [x] A no-op edit (identical text) does NOT bump, pinned by its own test.
      `ALLOWS a NO-OP edit on a rule line …` — and neuter #2 reddens it, so it is not decorative.
- [x] `specgrep edit` behaviour is unchanged, pinned by a test (shared `lib/pillar/edit.ts`).
      `SPEC guard > POSITIVE CONTROL — a legal text edit after the clause id lands` (a text edit
      with no version anywhere) stays green. Stated honestly: that test passing is evidence the
      change did not break spec edits; what makes it *impossible* for it to is structural — the
      clause is inside `if (kind.name === 'prrd')`, which is stronger than the test.
- [x] Neuter run recorded: which test reddens, and that it is the only one. **TWO runs**, 1 red and
      2 red, every red predicted before running — see the section above.
- [x] The fixture used is a temp dir, never a live corpus — a governance-tool test that writes to a
      real PRRD is a worse defect than the one being fixed.
      `mkdtempSync(join(tmpdir(), 'pillar-guard-'))`, `rmSync` in `afterEach`.

## Approval log

- 2026-08-16T17:55:08+0200 — Authored in `design/tasks` as a Tier-0 self-mandate: our own tool, our
  own repo, reversible, no baseline/governance-rule/release surface (the RULE is not being edited —
  only the tool's conformance to it). Found by the colony pillar-run audit (worker-5) and
  **reproduced first-hand by the hub before filing**, per the standing rule that a worker report is
  a hypothesis until re-run.

- 2026-08-21T16:29:09+0200 — COMPLETED by ai-maestro-hub-session. Decision (b) REFUSE taken on
  four measurements, shipped as `6c510fc7`, two neuters recorded, all six acceptance boxes met.
- 2026-08-21T16:34:13+0200 — CORRECTION (append-only, the one edit a terminal card admits). This
  card's shipped section says the pillar cluster reads "117 pass / 120, the 3 reds being
  pre-existing". Measured on the project's PINNED Node (`bash scripts/with-node.sh`) the true
  numbers are **119 / 120 and ONE red** — my shell was on Node v26.5.0 against an `engines` cap of
  `<26`, and two of those three "pre-existing failures" were manufactured by it. The verdict on
  THIS card is unchanged and is now better supported: the fix is green on the sanctioned harness,
  and the reverted-at-HEAD comparison that separated mine from pre-existing stays valid because
  both arms ran in the same environment. Full refutation, and why a wrong harness reads as rigour:
  TRDD-W636KQBN.
