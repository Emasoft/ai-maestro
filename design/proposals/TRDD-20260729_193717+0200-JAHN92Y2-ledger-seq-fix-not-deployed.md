---
trdd-id: JAHN92Y2
title: The signed-ledger seq fix is committed but the running server still numbers from entries.length
column: cancelled
created: 2026-07-29T19:37:17+0200
updated: 2026-08-21T22:02:08+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
approval-tier: 2
priority: 0
severity: critical
effort: small
labels: [scenario-improvement, scen-001, ledger, read-only-mode]
external-refs: [reports/scenarios-runner/SCEN-001_20260729T170344Z.report.md, 49e007f3]
---

# Ledger seq fix is committed but not deployed — the read-only outage will recur

## Problem

SCEN-001 (2026-07-29) made 44 registry mutations through the dashboard UI. Before the run
`~/.aimaestro/agents/registry.ledger.json` held 703 entries, seq 5000..5702, contiguous.
After the run it holds 747 entries: 5000..5702 **followed by 703..746**. The new entries are
numbered from the entry COUNT, which is the exact `entries.length` formula that commit
`49e007f3` (2026-07-29 18:47, "fix(ledger): derive seq from the last entry, not from
entries.length") replaced.

`verify()` anchors on `entries[0]` and then requires strict +1, so the next server boot will
report `Sequence gap: entry at index 703 has seq 703, expected 5703` and the host returns to
READ-ONLY mode — the same 24-hour outage that was just repaired.

## Root cause

`lib/signed-ledger.ts:315-318` is correct in the working tree and committed. What ran was
not that code. `.next/BUILD_ID` was dated 13:59, ~5 hours before the fix, so the server was
serving compiled route code that predates it. The server process itself started at 19:01:07,
*after* the commit, which means either Next reused a stale compiled chunk or a second write
path exists — that half is inferred, not proven, and settling it needs one restart.

The generalizable defect: a ledger-integrity fix has no deployment gate. Nothing checks at
startup that the running build postdates the last change to `lib/signed-ledger.ts`, and
nothing checks that the live file's `last.seq + 1` equals what `nextSeq()` would return.

## Proposed fix

1. **Deploy** — restart the server (the build is already current as of 19:34), then
   `node scripts/ledger-repair-seq-split.mjs --registry agents --apply`, then restart again.
   Order matters: after the split the live file holds 44 entries whose last seq is 746, so
   under the old code the next append would be numbered 44 and create a worse, duplicate-seq
   discontinuity. Never apply the split while the old code may still be running.
2. **Make the regression self-detecting** — in `lib/ledger-startup.ts`, alongside the
   existing `verify()` sweep, emit a one-line assertion that the ledger's `last.seq + 1`
   matches the value `nextSeq()` would produce for a fresh append, and log it at every boot
   so a silent divergence is visible before the next append rather than after it.
3. **Pin it in tests** — add a case in the signed-ledger unit tests that rotates a ledger
   down to a tail whose `length !== last.seq + 1` and asserts the next append is numbered
   `last.seq + 1`. Neuter-check it: with `nextSeq()` reverted to `entries.length`, that test
   MUST fail.

## Verification

- After step 1, boot log reads `[SECURITY] All ledger chains verified` (no `[TAMPER]`).
- One title change through the UI produces a ledger entry with `seq: 747`.
- `python3 -c "import json;s=[e['seq'] for e in json.load(open(...))['entries']];print(s==list(range(s[0],s[0]+len(s))))"` prints `True`.
- The new unit test fails when `nextSeq()` is reverted.

## Estimated risk

MED. The repair tool is dry-run-by-default, refuses damage outside this exact signature,
backs the file up byte-identically first and is fully reversible. The risk is entirely in
ordering: applying it before the fixed code is live makes the ledger worse.

## Approval log

- 2026-08-21T22:02:08+0200 — CANCELLED (OBSOLETE) by ai-maestro-hub-session (min-approval-requirement:
  manager). Re-measured against the live artifact, not the commit: the running registry ledger
  (`~/.aimaestro/agents/registry.ledger.json`) holds 9723 entries, seq 5704..15426, fully contiguous
  (`s == list(range(s[0], s[0]+len(s)))` is True) — thousands of appends past the incident with zero
  gaps. `lib/signed-ledger.ts:315` `nextSeq()` derives from `entries[entries.length-1].seq + 1`, not
  `entries.length`. `tests/signed-ledger.test.ts:226` ("keeps seq strictly increasing ACROSS a
  rotation") pins the exact rotation regression this card describes. All three verification criteria
  hold. Nobody declined this proposal; it was repaired between filing and now.
