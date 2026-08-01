---
trdd-id: RYFP030K
title: one gated universal editor for settings.json and settings.local.json across the whole fleet
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-01T03:59:33+0200
updated: 2026-08-01T03:59:33+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-01T03:59:33+0200
relevant-rules: [R51]
npt: []
eht: []
blocked-by: []
external-refs: [https://github.com/Emasoft/ai-maestro/issues/105]
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME

USER-mandated (2026-08-01): a **universal editor for BOTH `~/.claude/settings.json` and
`settings.local.json`**, exposed as an ai-maestro API, with **every writer across ai-maestro, its
scripts and its plugins GATED** by it. Source material: AgentlensPro's `safe_config_edit.py`
(issue #105), downloaded to gitignored `downloads_dev/agentlenspro-safe-config/` and studied.

## MEASURED — what ai-maestro has today (this is the "is it an improvement?" answer)

The guarantees already exist and are **SPLIT ACROSS TWO MODULES**, so whether a writer is protected
depends on which file it happens to live in. That is the core defect, independent of AgentlensPro:

| guarantee | today | where |
|---|---|---|
| refuse-unparseable · refuse non-object · atomic tmp+rename | ✓ | `lib/json-io.ts` |
| in-process per-file queue · cross-process `mkdir` lock · stale-break | ✓ | `withSettingsLock`, **private to** `services/element-management-service.ts:442` |
| fsync · kept backup · concurrent-modification check · staged re-read · post-commit audit · bounded retries | ✗ | — |

**Proof of the split:** the marketplaces route hardened last night (TRDD-ZT3P02PO) got
`saveJsonSafe` and **zero** `withSettingsLock`. 33 `saveJsonSafe` call sites across 6 files.

So: ours is **better** than AgentlensPro on locking (theirs has no in-process queue — a Node server
needs one), and **worse** on fsync/backup/audit/concurrent-mod.

## VERDICT (fable-advisor, consulted per advisor-rules — >3 files, architectural)

**(c)-plus: port into `lib/json-io.ts` and add ONE new primitive `updateJson(path, mutator)`.
Reject shelling out to Python outright. Verify-diff is NOT mandatory.**

Four findings that changed the plan, each of which I had wrong or missing:

1. **Shelling out to their Python is worse than I framed it.** Their ops grammar (`apply_ops`,
   py:201-300) has **no root-path `set`**, so it cannot express whole-object replace — option (a)
   inherits the entire 33-site ops refactor ANYWAY, *plus* `python3`-per-write on a fleet-wide hot
   path, *plus* a second write path, which is the exact disease
   `one-json-io-implementation.test.ts` exists to forbid.
2. **The current API structurally cannot do the concurrent-modification check.** Their gate 4
   (py:414) compares against the snapshot taken at READ time — and `loadJsonSafe` → `saveJsonSafe`
   are two separate calls, so the baseline never travels. Plain (c) would silently drop the one
   gate that prevents **lost updates**, and our 33 async read-modify-write sites can already
   interleave IN-PROCESS today. Hence `updateJson(path, mutator)`: read-under-lock → caller mutates
   → snapshot-compare → fsync-tmp → rename → bounded retry.
3. **Their gate-5 auto-rollback is a HAZARD in our context, not a safety.** The `claude` CLI writes
   `settings.json` WITHOUT our lock, so `os.replace(backup, target)` (py:438) after an audit
   mismatch would **destroy a non-participant's legitimate write**. Port the audit as
   detect-and-log-loudly; **never** auto-rollback.
4. **The installer runs with the server DOWN**, so the CLI wrapper must invoke the core through a
   shipped node entrypoint, **not** HTTP. The shared sidecar lock is what makes both paths safe.

## ⚠ "100% safety" is NOT achievable — state the real ceiling

The USER asked for 100%. It cannot be honestly claimed by us or by AgentlensPro, for two reasons:
the **`claude` CLI is a non-participating writer** (it takes no lock of ours), and an irreducible
**TOCTOU window** remains between the byte-compare and the `rename`.

**The honest ceiling, which IS achievable and is what this card delivers:** no torn writes; no
rebuild-from-corrupt; no lost updates *among participating writers*; every mutation recoverable from
a kept backup. Any doc or API description must say exactly this and must not say "100%".

## Plan

1. Extend `lib/json-io.ts`: fsync the tmp before rename · timestamped backup with a pruning cap ·
   O_EXCL sidecar lock + **reentrant** in-process per-path mutex · bounded retries · `updateJson`.
2. Migrate the 33 RMW sites to `updateJson`. **Keep `saveJsonSafe` for R51 compensations only** — an
   undo writing `c.prior` must NOT get a staleness baseline, because the file legitimately changed.
3. Layering: the core in `lib/` is the authority; the server calls it **in-process** (never its own
   API); the API route and `aimaestro-settings.sh` are transports (Plugin Abstraction Principle —
   plugins never call the API directly).
4. Extend the governance ratchet to forbid ANY other writer of `settings*.json` (tonight's
   `user-settings-has-two-writers.test.ts` is the seed; widen it to `settings.local.json`).

## Verification

- **The deadlock risk is the first test to write**, per the advisor: two concurrent `updateJson` on
  one path. Today's code LOSES one write — so that test must red before the fix and pass after,
  which also proves the reentrancy of nested pipelines that RMW the same file twice.
- Neuters, each named: drop the snapshot-compare → the lost-update test reds; drop the fsync/rename
  → torn-write test reds; make the audit auto-rollback → the non-participant-write test reds.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above 325 files / 4614 passed.

## Estimated risk

**MED-HIGH.** 33 call sites in the server's most safety-critical write path, plus a new lock
primitive. The deadlock risk is real and is why its test comes first.

## Acceptance

- [ ] `updateJson(path, mutator)` with reentrant lock, snapshot-compare, fsync, backup, retries
- [ ] the 33 RMW sites migrated; `saveJsonSafe` retained ONLY for R51 compensations, with the reason
- [ ] audit is detect-and-log; auto-rollback explicitly NOT implemented, with the reason recorded
- [ ] API route + `aimaestro-settings.sh` (node entrypoint, not HTTP — installer runs server-down)
- [ ] governance ratchet forbids any other writer of `settings*.json` incl. `settings.local.json`
- [ ] the ceiling is documented as the honest one, never "100%"
- [ ] tests + neuters recorded by name; tsc 0 lines; suite at or above baseline
- [ ] report the adopted/declined set back on issue #105

## Approval log

- 2026-08-01T03:59:33+0200 — USER MANDATE. The USER directed the universal gated editor explicitly
  ("we need to make settings editing across all ai-maestro and its scripts / plugins gated by a safe
  tool like this one"). Authority: USER >= any required approver.
