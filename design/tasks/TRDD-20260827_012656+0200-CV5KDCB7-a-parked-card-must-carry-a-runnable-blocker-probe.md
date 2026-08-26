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
| `not-match:<regex>` | the probe's output does **not** match `<regex>` |

**`not-match:` is not symmetry, it is the fail-closed form, and omitting it biased the whole
convention toward fail-open.** With only `match:`, a probe author must enumerate **failure**
vocabulary — open-ended, unbounded, and unverifiable, because you cannot prove you listed every
way a thing can break. Asserting the **success sentinel** and holding the blocker when it is
ABSENT is closed: one string, verifiable against the emitter's source. Prefer `not-match:` on a
success sentinel; use `match:` only where the emitter has a single aggregate FAILURE sentinel
that all failure branches provably feed.

### `blocker-probe-canary:` — because `match:` is TWO-VALUED and the spec needs THREE

Found by the janitor against my grammar, and it is the defect that would have made the whole
convention an auto-unparker. With only `blocker-holds-if: match:<regex>`, a **timeout**, a
**non-zero exit**, a **missing script** and an **empty file** all produce no-match — which the
spec reads as *"the blocker no longer holds"*. Fail-open, silently, forever. I wrote condition 3
into this card and then shipped a grammar that cannot express it.

```yaml
blocker-probe:        <argv>
blocker-probe-canary: match:cookie/session   # a string HEALTHY output always contains
blocker-holds-if:     match:ACTION DUE
```

**Canary absent ⇒ the probe did not really run ⇒ verdict 2, never "cleared."**

**It is NOT redundant with a runner-side trichotomy, and that is the argument for taking both.**
A runner sees exit code, timeout and empty output directly, so it can raise verdict 2 for those
by itself. What a runner **cannot** see is a probe that ran, exited 0, and produced plausible
output the needle no longer fits — **emitter drift**. That is the blind-needle failure moved
from authoring time to run time, and the canary is the only thing in the design that catches
it. So: the **runner** owns verdict 2 for exit/timeout/empty; the **canary** owns it for drift.

Convergence worth recording: the janitor and this session independently read
`lifetime-status.sh` at source and both arrived at `ACTION DUE`, after both having invented
regexes from a healthy run that could never match anything the tool emits. Two sessions, same
defect, same fix, arrived at separately.

### The blind-needle rule, learned by shipping one in this convention's own first instance

**Take the needle from the EMITTER's source, never from vocabulary you saw somewhere else.**
X4RK1NUW's first probe used `match:(reauth-needed|refresh-dead|expired|no session)`. Measured
against `lifetime-status.sh`: **3 of the 4 tokens do not occur in it at all**, and `expired`
occurs only inside the cookie-column value `none/expired`. That needle caught `LOGIN NEEDED` and
was blind to `REFRESH SOON` and `RE-CAPTURE` — fail-open on two of three blocker states. The
vocabulary was real, and came from `rotator.log`'s **alert names**: tokens lifted from emitter X
and pointed at emitter Y.

It was replaced with `match:ACTION DUE`, which is closed *by construction* rather than by
enumeration: all three blocker branches `action.append(email)`, and `ACTION DUE` prints iff
`action` is non-empty (`lifetime-status.sh:131,133,135,145,146`).

**Every probe therefore needs a SOURCE positive control, and it is a different check from a
behavioural one:**

```bash
grep -nE '<the needle>' <the emitter>     # 0 hits  => blind needle, reject the probe
```

Testing the regex against a string you typed yourself (`echo "reauth-needed" | grep -qE ...`)
proves only that the regex is syntactically valid and matches its own literal. That is a
**degenerate** control; it passed for the blind needle above. Also: match case-insensitively, or
declare the case explicitly — a needle for `expired` misses `EXPIRED`.

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

## The janitor's five conditions — ACCEPTED (2026-08-27, their reply)

They accept in principle and set a bar before their detector executes anything. All five are
adopted here as binding on the design:

1. **No shell.** Fixed argv split, no expansion, no metacharacters. *This kills my own first
   draft's "a single shell command" — a probe is an argv vector.*
2. **Hard timeout, output to a file, never to context.** Non-zero exit and timeout are both
   verdict 2.
3. **Three verdicts; could-not-run is NEVER "cleared".**
4. **The probe's root must not be agent-writable, VERIFIED at run time, not assumed.**
5. **A red test** that writes a probe into a writable root and asserts it is refused, not run.

**Condition 4 is strengthened here, because this repo shipped its exact inverse an hour ago.**
The writability check must be on the **realpath'd** containing directory, not the configured
one. TRDD-NB70FKKT was precisely this shape: containment checked on a realpath'd path, then the
**lexical** path used — so a symlinked directory inside a trusted base passes the check while
the derived root points into agent-writable space. A lexical condition-4 check would pass while
the probe came from a writable tree: their defence with our bug inside it.

**Condition 3 needs the neuter that makes it non-vacuous:** point a probe at a nonexistent
binary, assert verdict 2, then mutate could-not-run to fall through to "cleared" and confirm
exactly one named test reddens. Without the recorded neuter, the third verdict is two verdicts
wearing a third's name.

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
- [x] Part 2 proposed to the janitor and their verdict recorded here — **ACCEPTED in principle
      with five conditions**, all adopted above; they ship DISABLED-by-default until their
      roots satisfy condition 4
- [ ] `not-match:` supported by the lint and the detector, with a probe using it
- [ ] Every probe in the corpus carries a recorded SOURCE positive control
      (`grep -nE '<needle>' <emitter>` returning non-zero)

## Approval log

- 2026-08-27T01:26:56+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
