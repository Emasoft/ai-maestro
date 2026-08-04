---
trdd-id: YR4G2CZH
title: The subagent write-guard fails open when CLAUDE_PROJECT_DIR is unset
column: todo
created: 2026-08-04T16:15:14+0200
updated: 2026-08-04T16:15:14+0200
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: security
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: governance-rules
approval-datetime: 2026-08-04T16:15:14+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 2
severity: medium
effort: small
release-via: none
labels: [subagent-isolation, write-guard, hooks]
---

# The subagent write-guard fails open when CLAUDE_PROJECT_DIR is unset

## Problem

`.claude/scripts/subagent-write-guard.sh` lines 68-72:

```bash
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
    # No project root → cannot enforce the rule → fail open but log.
    echo "[write-guard] WARN: CLAUDE_PROJECT_DIR not set, allowing tool call" >&2
    exit 0
fi
```

With the variable unset the guard allows **every** write, anywhere on the filesystem. The rule it
enforces (`.claude/rules/prevent-subagents-to-write-outside.md`, severity IRON) exists because a
subagent once walked out of its worktree and committed on the parent tree, so the failure mode this
branch permits is precisely the one the guard was written to stop.

Measured behaviourally 2026-08-04 (CC 2.1.221), driving the script directly:

| input | `CLAUDE_PROJECT_DIR` | result |
|---|---|---|
| path outside the project | set | **exit 2, BLOCKED** ✓ |
| path inside the project | set | exit 0 ✓ (positive control — the block discriminates, it is not blanket) |
| path outside the project | **unset** | **exit 0** + `WARN: CLAUDE_PROJECT_DIR not set, allowing tool call` |

## Root cause

Not a bug — a deliberate trade-off whose downside was never written down anywhere a reader of the
rule would see it. Failing CLOSED in a context where Claude Code legitimately does not export the
variable would block every write for that agent, not only the unsafe ones, which turns an
unrecognised launch context into a total outage for the agent. Failing OPEN turns the same context
into silent non-enforcement. Neither is free; the current choice was made without the alternative
being stated, so nothing forces a re-decision when the launch surface changes.

The unaddressed part is that **the warning goes to stderr and nothing reads it.** A guard that
announces its own non-enforcement into a stream no one consumes is, operationally, a guard that
says nothing.

## Proposed fix

Decide it deliberately rather than by default. Options, in the order they should be considered:

1. **Fail closed, with a resolvable fallback.** Derive the root from the hook payload's own
   `cwd` — or from `git rev-parse --show-toplevel` — and only refuse when BOTH are unavailable.
   This is the strongest form and probably has no real cost: the case where neither exists is
   likely empty, and if it is empty then failing closed costs nothing at all. **Measure whether
   it is empty before choosing this.**
2. **Fail open, but make the non-enforcement LOUD** — emit to a durable location (the janitor
   findings stream, or an append-only file the heartbeat surfaces), so a run that silently lost
   its guard is discoverable afterwards rather than invisible.
3. **Keep as-is, documented.** Already done (the rule now carries a "Known weakness" section).
   Acceptable only if 1 is measured to be impossible.

Whichever is chosen, the *reason* goes in the script beside the branch. The current comment says
what the code does ("cannot enforce the rule → fail open but log"); it does not say why fail-open
was preferred to fail-closed, which is the only thing a future reader needs.

## Verification

- Drive the script with `CLAUDE_PROJECT_DIR` unset and assert the CHOSEN behaviour (exit 2 for
  option 1; a durable record written for option 2).
- Positive control in the same test: with the variable SET, an inside path still exits 0. Without
  it, "the guard refused" is equally satisfied by a guard that refuses everything.
- Neuter: remove the fallback resolution and confirm exactly the unset-variable test reddens.

## Estimated risk

**LOW to change, MEDIUM to leave.** Leaving it means the IRON rule's true statement is "enforced
whenever the project root happens to be resolvable", and nobody finds out on the run where it was
not.

## Related — a separate, still-open gap

It is **unproven that Claude Code invokes this hook at all** under 2.1.218's workspace-trust
requirement. That is a different question from this card (does the guard behave correctly when it
runs, vs does it run) and it needs a real agent spawn to answer. It is TRDD-9X2STNL2's open
acceptance box, not this card's. Note for whoever runs it: spawn by the **BARE** agent name — a
plugin-namespaced name resolves to the plugin's copy, whose frontmatter `hooks:` Claude Code
ignores, so the probe would prove nothing.

## Approval log

- 2026-08-04T16:15:14+0200 — MANDATE (self). Tier 0: a fix confined to this repo's own hook
  script, no baseline deviation, no cross-team or release surface. No approval request was sent.

## Acceptance

- [ ] the fail-open-vs-fail-closed choice is made deliberately, with the empty/non-empty question
      of option 1 MEASURED rather than assumed
- [ ] the chosen behaviour is pinned by a test with a positive control, and a recorded neuter
- [ ] the script comment states WHY the chosen branch was preferred, not only what it does
- [ ] `.claude/rules/prevent-subagents-to-write-outside.md` "Known weakness" section is updated to
      match whatever was decided (or removed if the weakness is closed)
