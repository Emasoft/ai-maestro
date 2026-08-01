---
trdd-id: G2K02VDY
title: settings/marketplaces acts on the read-back verdict and its wiring splits by handler
column: completed
scope: project
project-id: ai-maestro
created: 2026-08-01T02:12:19+0200
updated: 2026-08-01T02:53:38+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-01T02:12:19+0200
relevant-rules: [R51]
npt: []
eht: [ZT3P02PO]
blocked-by: []
implementation-commits: [c8f7cb7d, d917e6ab, 00a15fa4]
---

## ⏵ STATE — READ THIS FIRST ON RESUME

The fourth and last caller of `ChangePlugin` that ignores `verified`. `TRDD-RO90UCKQ` wired the
other three and DEFERRED this one on measured evidence, because the answer here is **not the same
answer**.

## What RO90UCKQ already settled (do not re-derive)

`app/api/settings/marketplaces/route.ts` reaches `ChangePlugin` through
`dispatchUserPluginAction` (`:875`-`:905`), a candidate-key retry chain. Two facts were measured:

1. **A `mismatch` there does NOT mean "try the next key shape."** The loop advances only on
   `success === false` (`:889`); a verdict rides on `success: true`, so it returns at the first
   candidate and the next is never reached. A WRONG key shape either fails the CLI/gates (loop
   advances) or takes the write-back path and lands, reading back as `ok`. The hypothesis I filed
   was refuted by five lines of control flow.
2. **The wiring SPLITS by handler**, and that is the whole reason this is its own card:

| handler | on `verified === 'mismatch'` | why |
|---|---|---|
| `handleEnable` · `handleDisable` · `handleUpdate` | **409** | no recovery path exists; the truthful answer is that the change did not land |
| `handleInstall` | **route into the EXISTING stale-cleanup retry** | its `!r.ok` branch already wipes the dangling `enabledPlugins` entry + cache folder and retries once — and a mismatch (file read cleanly, plugin not in the expected state) IS that dangling-entry symptom. A bare 409 would report a fault the route knows how to FIX |
| `handleUninstall` | decide on its own evidence | it already runs an unconditional defensive cache wipe + all-key-format settings sweep AFTER the CLI, so its post-state may already be correct regardless of the verdict — MEASURE before wiring |

## Plan

1. `dispatchUserPluginAction` returns `verified` alongside `{ ok, pluginKey, lastError }`. It
   currently discards it, so no handler *can* act on it.
2. Enable/disable/update: 409 on `=== 'mismatch'`, never on `'unknown'`, AFTER the existing
   `!r.ok` branch (the precedence RO90UCKQ pinned at the other three sites).
3. Install: treat a mismatch as a local-state failure — the same door as `!isRemoteError` — so the
   stale cleanup + single retry runs. If the retry then verifies, it is a SUCCESS with
   `staleCleanup: true`, which is the outcome the user wants and today never happens.
4. Uninstall: measure first. Wire only if the post-state is genuinely wrong.

## Verification

- A test per handler: `mismatch` → 409 (or → cleanup+retry for install); `unknown` → NOT gated;
  a genuine failure still 500s (the ORDER claim `tsc` cannot see).
- **The install neuter is the load-bearing one**: make the mismatch NOT route into cleanup and the
  retry test must red — otherwise the test is pinning the 409 shape, not the recovery.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above 322 files / 4587
  passed / 2 skipped (re-measure, never quote).

## Estimated risk

**LOW-MED.** Enable/disable/update mirror a shape already pinned at three sites. The install change
alters a RECOVERY path, so it carries the real risk and gets the real neuter.

## The EHT this card owes

Routing a `mismatch` into `handleInstall`'s stale-cleanup block put a live path through a
`writeFile(SETTINGS_PATH, …)` that DESTROYS the user's global `~/.claude/settings.json` when that
file is corrupt (the read that feeds it is lenient, so unreadable is indistinguishable from
absent). The write pre-dates this card; making it more reachable is this card's effect, so closing
it is this card's debt: **TRDD-ZT3P02PO**. Per the derived-TRDD rule, G2K02VDY cannot reach
`complete` until it is terminal.

## Acceptance

- [x] `dispatchUserPluginAction` propagates `verified` instead of discarding it
- [x] enable/disable/update 409 on `mismatch`, never on `unknown`, after the `!r.ok` check
- [x] install routes a `mismatch` into the existing stale-cleanup retry, and a verified retry
      reports success with `staleCleanup: true`
- [x] uninstall MEASURED, and explicitly DECLINED: it already sweeps every key-format entry
      unconditionally AFTER the CLI (`:1082`-`:1088`), so a verdict observed before that sweep is
      stale by the time the handler returns — wiring it would gate on a stale reading
- [x] tests + neuters recorded by name; tsc 0 lines; suite at or above the day's baseline
- [x] EHT TRDD-ZT3P02PO terminal — `completed`, archived, landed in a7ee3f62 + 74cd76ef

## Outcome

**Test** — `tests/api/marketplaces-route-acts-on-verified.test.ts` (16). Four handlers × {mismatch,
`unknown` does not gate, a genuine failure keeps its own cause, positive control}.

**Neuter A — the load-bearing one.** Change `if (r.ok && r.verified !== 'mismatch')` to `if (r.ok)`
so a mismatch never reaches the repair: exactly the two install-RECOVERY tests red
(`RETRIES after cleanup …` and `409 only when the RETRY also mismatches …`), while both `unknown`
tests and every positive control stay green — which is what shows they discriminate the RECOVERY
rather than the 409 shape.

**Neuter B — reddened NOTHING, and that is the finding.** Reversing the mismatch / `!r.ok` branches
in `handleEnable` left 16/16 green, because `dispatchUserPluginAction` returns
`{ ok: false, pluginKey, lastError }` on failure and NEVER sets `verified`. `!r.ok` therefore implies
`verified === undefined`, the check is false on either side, and the ordering hazard
`mismatchResponse`'s docstring warns about is **unreachable through this route**. No test at this
altitude can discriminate it (the route calls the dispatcher internally; there is no path to
`ok: false` with a verdict set), so the three tests were renamed to what they actually pin and the
false ORDER claim was replaced by the measured explanation (`00a15fa4`). The ordering in the handlers
STAYS as defence in depth against a future dispatcher that returns a verdict on the failure path;
what was removed is the claim that a test guards it.

A test named ORDER, passing forever, telling every future reader the precedence is covered when
reversing it costs nothing, is worse than no test at all.

## Approval log

- 2026-08-01T02:12:19+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, split out of TRDD-RO90UCKQ because its answer differs per
  handler. Pre-approved: issuer authority >= required approver.
- 2026-08-01T02:53:38+0200 — COMPLETED by ai-maestro. 6/6 acceptance boxes; two neuters run (one
  load-bearing, one that reddened nothing and thereby corrected a false claim in my own test); EHT
  TRDD-ZT3P02PO terminal; tsc 0 lines. Landed in c8f7cb7d + d917e6ab + 00a15fa4.
