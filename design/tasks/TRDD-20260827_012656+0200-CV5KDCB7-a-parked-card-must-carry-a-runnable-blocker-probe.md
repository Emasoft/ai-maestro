---
trdd-id: CV5KDCB7
title: A parked card must carry a runnable blocker probe so staleness is detected by a machine not by a reader
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-27T01:26:56+0200
updated: 2026-08-27T01:26:56+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-27T01:26:56+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: major
effort: M
labels: [governance, trdd-schema, janitor-coordination]
external-refs: [TRDD-X4RK1NUW]
---

# A parked card must carry a runnable blocker probe

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-27

USER mandate, 2026-08-27T01:25, verbatim intent: *"coordinate with the janitor claude to keep
some kind of register to keep track of that, so you won't be made such errors in the future.
everything should honestly completely automated, requiring zero intelligence and agent
intervention."*

**NEXT ACTION:** land the lint rule (Part 1) in this repo. The janitor half (Part 2) is
proposed to them and is theirs to accept or refuse; do not implement it here.

## Problem

A parked card records its blocker as a **fact with a silent timestamp**. Nothing re-derives it,
so it rots while continuing to read as current — and the parking is exactly what stops anyone
re-reading it. The staler it gets, the less likely anyone looks.

Measured cost, this session: TRDD-X4RK1NUW asserted *"3.1 days left, all three OAuth refresh
tokens dead, cookies expire 2026-08-30, owner-only"*. The owner had renewed all three accounts
the previous day. This session read that block and **relayed it to the owner twice** without
re-deriving one number, then held ~30 heartbeat fires doing nothing on the strength of it. Three
commands (seconds, no browser, no human) refuted every number.

This is not a one-off. `~/.claude/rules/lessons-verification.md` records the same pattern at a
**measured 4-in-5 rate** across five parked cards swept in one sitting: a restart that had
already happened, a branch recorded as unpushed that was pushed, a var that would "self-correct
on the next restart" that did not, and a CRITICAL fleet blocker closed upstream 8 days earlier.
One of five was genuinely still blocked.

## Root cause

**The card stores the ANSWER instead of the QUESTION.** "The refresh tokens are dead" is a
measurement with no timestamp attached and no way to re-take it. "Run `X`; the blocker holds iff
`Y`" is re-answerable by anything, forever, at zero cost.

The generalization, which is the part worth keeping: **a blocker recorded as a VALUE decays;
a blocker recorded as a PREDICATE cannot.**

## Proposed fix — two halves, two owners

### Part 1 — this repo. Make the predicate mandatory, mechanically.

Two new frontmatter fields, one line each (grep-first, per the TRDD rules):

```yaml
blocker-probe: env -u CLAUDE_PLUGIN_DATA python3 "$ROT/rotator.py" oauth-health
blocker-holds-if: match:invalid_grant
```

`blocker-holds-if` grammar, deliberately tiny — three forms, no expression language:

| form | the blocker STILL holds when |
|---|---|
| `exit-0` | the probe exits 0 |
| `exit-nonzero` | the probe exits non-zero |
| `match:<regex>` | the probe's stdout+stderr matches `<regex>` |

**The lint rule (`BLOCKED-WITHOUT-PROBE`), in `trddgrep validate`:** a card that claims to be
parked MUST carry both fields. "Claims to be parked" = any of `column: blocked`, a non-empty
`blocked-by:`, a `review-after:` in the future, or a `hub-blocked`/`fleet-ask` label. This is the
ratchet: it costs one line at park time and it is the ONLY step that needs a human, so it is the
only step worth enforcing.

**Two failure directions the rule must get right**, because this repo has shipped both:
- It must NOT fire on an unparked card (the vacuous-gate mirror: a rule that reddens correct
  work gets routed around).
- It must NOT accept an EMPTY probe as satisfying it — "a condition written only over the bad
  items is vacuous on an empty set" is the exact defect that made the terminal-completion gate
  inert on 87 of 108 open cards.

### Part 2 — the janitor. Run the probes; that half is genuinely zero-intelligence.

A detector (`stale-blocker`) on the heartbeat cadence:

1. Scan every scope root for cards carrying `blocker-probe:`.
2. Run each probe with a hard timeout, no network assumptions, output captured to a file.
3. Evaluate `blocker-holds-if`.
4. **Blocker no longer holds → emit a finding naming the card**, and un-park it (`review-after:`
   cleared, or `blocked` → `pre-block-column:`).
5. **Probe could not run → a THIRD verdict, never "resolved".** grep's trichotomy: 0 clean /
   1 findings / 2 could-not-run. A probe that errors must never read as "the blocker cleared" —
   failing that direction converts a safety net into an auto-unparker.

This is filed to them as a proposal, not a mandate. It is their tree; per
`how-to-fix-issues-of-other-projects.md` we do not edit it.

## Why this is worth the one line it costs

The check is free and re-runnable forever; the value decays to zero the moment a probe is
absent. It also fixes the *reporting* failure, not just the detection one: a card whose blocker
is a command can be re-derived by the person being told about it, so a relay is falsifiable in
seconds instead of being taken on trust.

## Verification

- Seed a card with `blocker-probe: false` + `blocker-holds-if: exit-nonzero` → detector says
  the blocker HOLDS (no finding).
- Flip to `blocker-holds-if: exit-0` → detector says it CLEARED (finding + un-park).
- Point the probe at a nonexistent command → verdict `could-not-run`, NOT "cleared".
- Neuter: delete the `BLOCKED-WITHOUT-PROBE` rule → a seeded parked card with no probe must
  stop being flagged. If nothing reddens, the rule is unreachable and the gate is decorative.

## Estimated risk

LOW for Part 1 (a lint rule + two optional fields; no existing card changes meaning).
MEDIUM for Part 2 and it is the janitor's to weigh: a detector that RUNS COMMANDS out of a
markdown file is an execution surface. The probe must be treated as trusted-author content, run
with a timeout, and never with a shell that expands attacker-controlled input. Worth stating
plainly rather than discovering later — it is the same class as TRDD-NB70FKKT.

## Acceptance

- [ ] `blocker-probe:` / `blocker-holds-if:` documented in this repo's TRDD conventions
- [ ] `BLOCKED-WITHOUT-PROBE` lands in `trddgrep validate`, with the two false-fire directions
      covered by tests and a recorded neuter run naming which test each mutation reddens
- [ ] TRDD-X4RK1NUW retrofitted with its probe (it already carries the three commands in prose)
- [ ] Part 2 proposed to the janitor and their verdict recorded here (accept / refuse / counter)

## Approval log

- 2026-08-27T01:26:56+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
