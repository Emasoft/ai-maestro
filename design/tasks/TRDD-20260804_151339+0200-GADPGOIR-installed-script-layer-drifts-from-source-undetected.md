---
trdd-id: GADPGOIR
title: The installed script layer drifts from source with nothing detecting it, and a partial refresh is destructive
column: complete
created: 2026-08-04T15:13:39+0200
updated: 2026-08-15T23:02:54+0200
implementation-commits: [pending]
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: infra
min-approval-requirement: manager
approved: true
approval-judge: manager (emasoft-assistant-manager)
approval-datetime: 2026-08-15T01:30:26+0200
mandate: false
derived: false
priority: 1
severity: high
effort: medium
release-via: none
relevant-rules: [46]
labels: [install, script-layer, amp, drift, deployment]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/77, https://github.com/Emasoft/ai-maestro/issues/46]
---

# The installed script layer drifts from source with nothing detecting it, and a partial refresh is destructive

## Problem

Agents execute `amp-*` / `aimaestro-*` from **`~/.local/bin/`**. The repo's `scripts/` is only the
SOURCE. Nothing syncs them automatically, and **nothing detects when they disagree.**

Measured 2026-08-04 on this host:

| | `_expected_name` | `createdAt` | mtime |
|---|---|---|---|
| `scripts/amp-helper.sh` | 14 | 4 | 2026-07-23 15:00 |
| `~/.local/bin/amp-helper.sh` | **11** | **1** | **2026-07-21 20:41** |

Commits `6c6b75b4` and `1af95d49` (both 2026-07-23, the AMP identity self-heal + the refusal-message
rewrite) touched only `scripts/amp-helper.sh`. **They have never been installed.** Every live agent
on this host — 32 of them with colliding AMP addresses — runs the 07-21 copy.

**This is not general staleness, which is what makes it hard to notice:** 29 of 31 installed
`amp-*.sh` are byte-identical to source. Exactly 2 differ, and the only functional one is
`amp-helper.sh`. A spot-check of almost any other script reports "in sync".

## Why it matters beyond one stale file

I told the ORCHESTRATOR on `#77` (2026-07-23) that *"each agent repairs its own config on its next
`load_config` — nothing to run, nothing to migrate."* That was false the moment I wrote it and stayed
false for 12 days, because I verified `git log` and not the installed artifact. A second instruction
in the same comment — repoint skills off the `"Multiple AMP agents"` string — was **actively
harmful**: the old string is still what the installed copy emits (2 occurrences installed vs 1 in
source), so acting on it would have broken their skills against live code.

A coordination answer built on `git log` is a claim about *running code* that `git log` cannot
falsify.

## ⚠ The partial-refresh hazard — load-bearing, do not lose this

The installed copy lacks **both** fixes, which makes it **inert**. That is luck, not a safety property.

`6c6b75b4` is the `.agent.name` fallback that makes the address self-heal actually FIRE.
`1af95d49`'s sibling change carries `id` / `createdAt` through the repair. Applying the **first
without the second** activates a heal that calls `save_config`, which rebuilds the whole agent
object and silently drops `id` — the uuid that IS the agent's identity in `.index.json` and every
envelope — across all 32 affected agents.

**Refresh both or neither. Never cherry-pick into the installed layer.**

## Root cause

A commit is not an install, and no gate says so. `dc849049` (2026-07-09) fixed an earlier, different
bug where the remote-UPDATE path silently skipped the `~/.local/bin` refresh — its comment at
`scripts/remote-install.sh:1208-1215` describes that failure precisely. **That fix is not the cause
here:** it predates the 07-21 install, which is why 29/31 are current. The present cause is simply
that no install has run since 07-21 while source moved on 07-23.

So the earlier bug was repaired without adding the thing that would have surfaced its residue — a
drift check.

## Proposed fix

1. **A drift detector** — compare every `scripts/{amp,aimaestro}-*.sh` against its `~/.local/bin`
   counterpart; report the differing set. Cheap, exact, and it is the piece that is missing.
2. **Surface it where it will be seen** — a janitor heartbeat finding, or a `yarn` target run as part
   of the normal verify loop. A detector nobody runs is not a detector.
3. **Make the hazard un-cherry-pickable** — the refresh installs the AMP script set atomically, or
   the detector refuses a partial state loudly.
4. **Do NOT auto-install.** Refreshing identity-resolution behaviour underneath live agents is a
   USER call (see below).

## Scope boundary — verified vs not

- ✓ **VERIFIED** — `amp-*` staleness on this host, the exact 2-file delta, and that the ladder keys
  (`AMP_HOST`/`AIM_AGENT_ID`/`AGENT_WORK_DIR`) ARE present in the installed copy, so identity
  resolution from an agent's own workdir works today.
- ✗ **NOT AUDITED** — the `aimaestro-*.sh` family and every other `~/.local/bin` artifact. The same
  drift is possible there and was not measured. **An EHT should widen the check to the whole
  installed surface before this is called closed.**

## Verification

- The detector flags `amp-helper.sh` as drifted on this host **today**, before any refresh.
- After `./install-messaging.sh -y`, the detector reports zero drift and
  `grep -c _expected_name ~/.local/bin/amp-helper.sh` returns 14.
- A seeded partial state (source fix present, installed copy carrying only one of the two commits)
  is reported as drift — not silently accepted.
- **Non-vacuity:** the detector must flag a file it is given that IS drifted. A run that reports
  "clean" over a set it failed to build is the failure mode here, and it is exactly what happened to
  the human check for 12 days.

## Estimated risk

**LOW to build, HIGH not to.** The detector is a loop and a `diff`. The risk is entirely in the
refresh action it will prompt: changing identity resolution under 32 running agents is a USER
decision, and a partial refresh is data loss (above). Ship the detector; leave the remediation
manual and gated.

## Provenance

Found 2026-08-04 while re-verifying my own 2026-07-23 answer on `Emasoft/ai-maestro#77`. The
ORCHESTRATOR had reported 32 agents sharing one AMP address; I diagnosed it, fixed it, and told them
it would self-heal. Re-verification showed the fix was never installed. Correction posted on `#77`.

## ⏵ OUTCOME — detector shipped 2026-08-15, and the card's own premise had gone stale

**RE-MEASURED BEFORE BUILDING, and the 08-04 census no longer holds.** Today: **45 compared, 44
identical, 0 drifted, 1 missing.** `amp-helper.sh` now reads `_expected_name` **14 times in BOTH**
source and installed — an install ran between 08-04 and now, so the 12-day drift is closed and
this card's verification line *"the detector flags `amp-helper.sh` as drifted on this host TODAY"*
is **no longer satisfiable**. It is recorded here rather than ticked, because ticking it would
have meant asserting a measurement I did not take. The card's post-refresh criterion
(`grep -c _expected_name` = 14) IS met.

**A THIRD STATE the card did not name: MISSING.** `aimaestro-check-decoupling.sh` exists in
`scripts/` and has NEVER been installed. That is a different fault from drift — a drifted script
runs the wrong code, a missing one is `command not found` for any agent that calls it — so the
detector reports the two separately rather than folding them together.

### What shipped

- `lib/installed-script-drift.ts` — pure comparison. **Bytes, not mtime and not a version
  string**: mtime records when a file was WRITTEN (an install rewrites it even unchanged) and a
  version string is only as honest as whoever bumped it.
- `scripts/check-script-drift.mjs` + **`yarn scripts:drift`** — the surfaced entry point, on the
  grep trichotomy (0 clean · 1 findings · **2 could-not-run**). Live run: exit 1, naming the one
  missing script.
- `tests/unit/installed-script-drift.test.ts` — 6 tests, FIXTURE-driven on purpose. A test
  asserting "this host has zero drift" would pass or fail with whenever someone last ran the
  installer, which is the machine-dependent shape that made three fleet-liveness tests look like
  load flakes for weeks. The live scan is the yarn target's job; the logic is pinned here.

**Neuter:** deleting the `scanned === 0 → exit 2` line reds exactly *"AN EMPTY SCAN IS EXIT 2,
NEVER A CLEAN 0"*, 5 green. That is the card's own failure mode — "clean" and "I looked at
nothing" print identically, which is how a human check reported in-sync for 12 days.

**NOT DONE, deliberately:** no auto-install, per the card. Remediation stays manual, all-or-nothing
(`./install-messaging.sh -y`), because a partial refresh activates a self-heal whose sibling commit
is absent and silently drops every affected agent's `id`. The report NAMES the remedy and a test
pins that it says *never cherry-pick*.

**Still open (the card's own ✗ NOT AUDITED):** this covers `amp-*` and `aimaestro-*` only. The rest
of `~/.local/bin` remains unmeasured.

## Approval log

- 2026-08-15T01:30:26+0200 — APPROVED by ASSISTANT-MANAGER (min-approval-requirement:
  manager), §D4 APPROVAL-UNAPPROVED-IN-WORK-ZONE drain. Column stays as-is per the ruling.
