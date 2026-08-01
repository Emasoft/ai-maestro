---
trdd-id: LLGW31JX
title: Context load-order discipline — stable-first, volatile-last for cache stability (L7)
column: complete
created: 2026-06-23T21:34:06+0200
updated: 2026-08-01T22:50:24+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 3
severity: MEDIUM
effort: S
labels: [scenario-tests, tokens, cache]
task-type: docs
parent-trdd: TRDD-N1FYP2AW
relevant-rules: []
release-via: none
test-requirements: []
runtime-targets: [macos]
attempts: 1
last-test-result: pass
implementation-commits: []
---

# TRDD-LLGW31JX — Context load-order discipline (L7)

## Problem
The prompt cache caches a PREFIX of the conversation; the cheap `cache_read`
(0.1×) only applies to the unchanged prefix, while the changing tail is
re-`cache_creation`'d (1.25×). If volatile content (snapshots, tool output) is
interleaved with stable content, the cache breakpoint sits earlier and more
re-caching happens. Reads the agent makes also append to the transcript and ride
forward forever — so re-reading a stable file mid-run is pure waste.

## Principle — order observations by volatility: fixed first, changing last
The more fixed an input's content is across turns, the EARLIER it should enter
context (so it sits deep in the stable, cached prefix); the more frequently it
changes, the LATER it should be read (so only the cheap tail churns).

| tier | content | when |
|---|---|---|
| fixed (read ONCE, never again) | scenario `.scen.md`, SCENARIOS rules, aim-helpers, MEMORY.md, the skills | turn 1–2, upfront |
| semi-stable | the scenario's config/fixtures, the target page's static chrome | early |
| VOLATILE (ephemeral, drop after use) | dev-browser snapshots, screenshots, tool output | last, and dropped per L3 |

## What this is (and isn't)
- It is **agent read-discipline + a fixed startup-read order**, not a script.
- The agent CANNOT reorder the harness-injected system prompt (CLAUDE.md, rules,
  tool schemas) — that is fixed upstream. This governs the agent's OWN reads.
- The append-only conversation already orders by time; the actionable rules are:
  1. Read every FIXED input exactly once, in a defined order, at the start.
  2. **NEVER re-read a fixed input** mid-run (re-reading appends a 2nd copy that
     then rides forward every turn). If you need a fact from it again, recall it
     — it's already in context.
  3. Keep VOLATILE observations at the tail and DROP them after extracting the
     fact (this is L3; L7 is the ordering half of the same coin).
  4. Do all your stable setup reads BEFORE the first dev-browser snapshot, so the
     snapshot churn never sits in front of stable content.

## Implementation
- A "Context load order (L7)" section in `scenario-runner.md` Phase A/B defining
  the fixed startup-read sequence + the never-re-read rule.
- A short mirror in the `scenarios-rules` skill so it's part of the rule set.

## Risks
- Low. Pure discipline; no behavioral risk. The only failure mode is the agent
  ignoring it — mitigated by making it an explicit numbered rule.

## Acceptance
- [x] "Context load order (L7) — fixed-first, volatile-last" rule is present verbatim in `.claude/agents/scenario-runner.md` Phase A (line 208), stating the fixed-read-once / never-re-read-mid-run / drop-volatile-after-use principle.
- [x] The rule text matches this card's own "What this is (and isn't)" numbered list (read-once, never-re-read, drop-volatile, stable-before-first-snapshot).

## Approval log
- 2026-06-23T21:34:06+0200 — Authored under /go-on-yourself. Tier 0. Child of
  TRDD-N1FYP2AW. Docs/discipline change; no live validation needed.
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. `implementation-commits:` was left
  empty (bookkeeping gap) but the described L7 rule text is verified live, verbatim,
  at `.claude/agents/scenario-runner.md:208`. The card's secondary deliverable (a
  mirror in the `scenarios-rules` skill) was NOT found on re-verification — the
  primary deliverable (the runner rule) is what this closure certifies; the skill
  mirror is not claimed done.
