---
trdd-id: GFX57106
title: Nothing keeps the installed script layer in sync, so the fleet cannot reach verify
column: planned
min-approval-requirement: none
priority: 1
severity: high
effort: small
task-type: infra
created: 2026-07-15T01:07:00+0200
updated: 2026-08-21T22:36:05+0200
scope: project
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
labels: [scenario-improvement, scen-029]
current-owner: scenario-runner
external-refs:
  - reports/scenarios-runner/SCEN-029_20260714T212851Z.report.md
---

# The installed CLI is stale, and no invariant notices

## Problem

`~/.local/bin/aimaestro-trdd.sh` on this host **has no `verify` verb**. The repo copy
has had it since commit `7d6a9e31` ("the verification surface — an approval you can
check, not just read", ai-maestro#47). `aimaestro-portfolio.sh` — the whole
mint/list/revoke surface — **is not installed at all**.

The diff is exactly the feature:

```
$ diff scripts/aimaestro-trdd.sh ~/.local/bin/aimaestro-trdd.sh
95,96c95      # the human-auth hint
126,129d124   # the `verify` help text
198,248d192   # cmd_verify — the entire function
378d321       # the dispatcher line
```

So the fleet cannot verify a mandate even if it wanted to: the verb is not on PATH.
`approve` is byte-identical (the mint happens server-side), which is why a token can
be *created* on a host that cannot *check* one.

## Root cause

`install-messaging.sh` copies `scripts/*.sh` → `~/.local/bin/` **only when the
installer is run**. Nothing re-runs it, and nothing checks. Meanwhile the app has an
`agent-invariants` registry (`lib/agent-invariants.ts`) that already guarantees
`.claude/`, the DEP rules, the git-exclude block, and the core plugin — on create, on
wake, and on a 5-minute watchdog. The script layer, which the plugin-abstraction
principle names as *the* boundary every plugin depends on, has no such guarantee.

A host can therefore run a server that ships a feature its agents cannot invoke, and
every symptom looks like an agent behaving badly.

## Proposed fix

Add a **`script-layer` row to `lib/agent-invariants.ts`** — the same shape as
`dep-rules`:

- **guarantee**: every `scripts/*.sh` the server ships is present in `~/.local/bin/`
  and byte-identical to the shipped copy;
- **repair**: copy + chmod (pure file I/O — no network, no package manager, so unlike
  `core-plugin` it is safe on the `periodic` trigger too);
- **triggers**: `create · wake · periodic`.

Emit a one-line ops record when it repairs, exactly as `[InvariantsWatchdog] …
dep-rules=repaired` does today, so drift is visible rather than inferred.

## Verification

- Delete `verify` from the installed `aimaestro-trdd.sh`; within one watchdog
  interval it is restored byte-identical.
- `command -v aimaestro-portfolio.sh` resolves on a host that has never re-run the
  installer.
- A unit test pins the row's `triggers`, mirroring the existing `core-plugin`
  wake-only test.

## Estimated risk

LOW. It is a file copy into a directory the installer already owns. The only care
needed is not clobbering a file the user has deliberately edited — compare against
the shipped copy and log, don't overwrite blindly, or gate the overwrite on the
managed-file marker the DEP rules already use.

## Approval log

- 2026-08-21T22:36:05+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: none). Re-measured: the SPECIFIC reported symptom is gone on this host — `~/.local/bin/aimaestro-trdd.sh` now has `verify` (someone re-ran the installer since filing) and `aimaestro-portfolio.sh` (mtime Jul 21) is installed too. But the ROOT CAUSE this proposal targets is still unaddressed: `lib/agent-invariants.ts` has no `script-layer` row alongside the existing `dep-rules`/`core-plugin`/`git-exclude` guarantees, so nothing prevents the same silent drift from recurring on this or any other host. Premise still holds at the root-cause level; approved.
