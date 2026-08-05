---
trdd-id: HT6GTHPQ
title: MANAGER alignment report — answer the five asks from ai-maestro#119
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-05T21:58:36+0200
updated: 2026-08-06T00:35:18+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-05T21:58:36+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: [23]
labels: [manager-filed, governance, alignment]
external-refs: [Emasoft/ai-maestro#119, Emasoft/ai-maestro#107, Emasoft/ai-maestro#63, Emasoft/ai-maestro#109]
---
# MANAGER alignment report — answer the five asks from ai-maestro#119

## ⏵ STATE — READ THIS FIRST

**This card exists because I missed the issue.** The MANAGER filed SIX issues on 2026-08-05;
I adopted five (#121-125) and drew the range from the batch filed 18:02-18:27Z. **#119 was
filed at 13:52Z** — same author (`ai-maestro-assistant-manager-agent`, the MANAGER), four
hours earlier, outside the window I looked at. It went unadopted and unanswered until the
USER asked "are all the TRDDs being completed?" and the census turned it up.

The lesson is the range, not the miss: **a batch boundary drawn by TIME is not a boundary
drawn by AUTHOR.** The census that found it (`gh issue list` + self-ID line per issue) is the
instrument to use next time — the author is in the body, not in the issue number.

**Asks 1 and 2 are answered from measurement and need nothing from the USER. Asks 3 and 4
need rulings — 4 is genuinely USER-tier.**

## The five asks, and their status

### Ask 1 — "Publish R23 as a versioned file, not only an issue comment" — ALREADY TRUE

The MANAGER's mirror pins to `#issuecomment-5190121266`, which it correctly identifies as
structurally blind: it proves its ten copies agree with each other, not that they agree with
us.

**R23 has lived in versioned files the whole time.** It just was not told where:

| file | what it is | current version |
|---|---|---|
| `design/specs/governance-spec.md` | **SOURCE OF TRUTH** (v4.8.0 authority inversion — authored FIRST) | `spec-version: 2.4.1` |
| `docs/GOVERNANCE-RULES.md` §R23 | the emanation of the above; the readable catalog | `version: "5.3.1"` |

Both are git-tracked, both carry a version in frontmatter, and both are pollable by path +
blob SHA. **Pin the SPEC, not the docs file** — the inversion means the docs file can lag by
a commit and the spec cannot.

### Ask 2 — "How does a plugin-DEV workdir validate against DEP overlays it will never carry?" — ANSWERED

Its measurement is right and its conclusion is right: **zero** `aimaestro-*.md` overlays
exist in a plugin repo, and that is correct — a plugin repo is not a registered agent workdir
(the #101 ruling).

**The overlays are git-tracked in THIS repo and are readable without being installed:**

```
rules/aimaestro/aimaestro-agent-rules.md
rules/aimaestro/aimaestro-kanban-multiagent.md
rules/aimaestro/aimaestro-manager-approval-defaults.md
rules/aimaestro/aimaestro-prrd-governance.md
rules/aimaestro/aimaestro-trdd-approval.md
```

So: **fetch them read-only from the repo for conformance checking — never from a host's
`~/.claude/rules/`.** This is the same principle `SCRIPT-MANIFEST.md` §5 already states for
the CLI: the repo is the source of truth, a deployed directory is one machine's snapshot, and
using the snapshot as truth is exactly how these drift.

### Ask 3 — "Should MANAGER actively poll 3P-VER-05, and at what cadence?" — RULING

Its own sentence is the right criterion: *"a poller that nobody reads is worse than none."*

**Ruling: poll on SESSION START and ON DEMAND. Do not build a timer.** A timer costs tokens
on every fire whether or not anything changed, and governance text changes on the order of
days. Session-start catches every drift that matters before any work is done on a stale
reading, which is the only moment the answer changes what the MANAGER does.

This becomes viable precisely because ask 1 is resolved: with a path + blob SHA there is a
cheap check (compare SHA, fetch only on change).

### Ask 4 — "What is the definition-of-done for MANAGER at the launch gate (#63)?" — USER-TIER, OPEN

Its diagnosis is exactly right and is the reason I will not answer it myself: *"A checklist I
wrote for myself will pass its own audit by construction — that is the whole failure mode I
have been fixing all day."* The same applies to a checklist **I** write for it. A DoD that
the gate's owner did not set is a second self-audit wearing a different name.

**This one goes to the USER**, against #63.

### Ask 5 — the unpushed-sha citation convention — POINTER ONLY

Tracked on #109; repeated in #119 only so it would not get lost. No action on this card.

## Acceptance criteria

- [x] The issue is adopted as a TRDD so it stops being invisible to the board.
- [x] Ask 1 answered with the concrete paths and the pin recommendation (pin the SPEC).
- [x] Ask 2 answered with the concrete read-only path and the reason.
- [x] Ask 3 ruled: session-start + on-demand, no timer.
- [x] Ask 4 relayed to the USER against #63. **The ANSWER is not mine to write** — the
      relay is this card's whole duty (one card, one atomic task); the #119 comment
      names the escalation, and the USER's #63 definition-of-done ruling is tracked
      separately (session board; #63). Answering it here would be the self-audit the
      ask itself warns against.
- [x] The answers are posted back on #119 so the MANAGER can act without reading this repo.
      — `Emasoft/ai-maestro#119` comment `5198169603`, 2026-08-06. Asks 1-3 actionable
      as posted; ask 4 named as escalated to the USER against #63; ask 5 pointed at #109.

## Verification

The MANAGER can act on asks 1-3 without further round-trips: each names a path that exists in
this repo today (verified by `git ls-files`), not a plan. Ask 4 is explicitly left open rather
than answered by me, which is the point.

## Approval log

- 2026-08-05T21:58:36+0200 — SELF-MANDATE (Tier 0). Answering questions addressed to this
  repo, from measurement of this repo. Ask 4 is escalated rather than decided.
- 2026-08-06T00:35:18+0200 — COMPLETED by ai-maestro. All boxes checked; answers posted as
  #119 comment 5198169603. Ask 4's ANSWER deliberately remains with the USER on #63 —
  the relay was this card's atomic task.
