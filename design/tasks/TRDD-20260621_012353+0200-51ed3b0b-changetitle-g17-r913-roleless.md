---
trdd-id: 51ed3b0b-99ad-410e-a68c-1d52ee15a5e7
title: ChangeTitle Gate 17 must enforce R9.13 when a role-plugin install leaves an agent role-less
column: complete
created: 2026-06-21T01:23:53+0200
updated: 2026-06-21T01:23:53+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: bugfix
severity: HIGH
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
test-requirements: [unit, typecheck]
labels: [governance, r9.13, change-title, security]
---

# TRDD-51ed3b0b — ChangeTitle G17 R9.13 enforcement (titled-but-role-less)

**Source:** overnight fleet-readiness verification (TRDD-903b7a20), fix-queue #5
(governance-compliance). The #1 mandate condition ("all functions obey the
governance rules"). R9.13 = every persisted agent MUST carry a role-plugin.

## Problem (the gap)
`ChangeTitle` (services/element-management-service.ts, ~23 gates) persists the
new `governanceTitle` at **Gate 14** (verified on disk) BEFORE installing the
role-plugin at **Gate 16**. Gate 16 only **WARNs** on a failed install
(`G16: WARN — Failed to install …`) — it does not abort. The post-install
**Gate 17** consistency check handled `>1 active` (clean) and `==1` (mismatch
fix) but its `else` branch reported `G17: Plugin state consistent (0
role-plugin(s))` and the no-settings branch reported `plugin state clean` — so
when a role-plugin was REQUIRED but the install left **0 active**, G17 declared
consistency (a FALSE POSITIVE). Result: an agent left **titled but role-less**,
violating R9.13, with the pipeline reporting success and "consistent".

ChangePlugin's **PG04** post-gate already recovers this for the plugin-change
path (set `roleMissing` + hibernate), but a DIRECT ChangeTitle call (the UI
title-change) has no PG04 after it — so the gap was real for direct title
changes.

## Fix
Added an R9.13 recovery to **Gate 17** (a local `enforceRoleOrHibernate`
closure), invoked from BOTH the settings-exists `activeRolePlugins.length === 0`
branch AND the no-settings-with-`targetPluginName` branch:
1. Retry `installPluginLocally(targetPluginName, …)` once.
2. Re-scan; if a role-plugin is now active → log recovered, done.
3. If still 0 → `updateAgent(agentId, { roleMissing: true })` + `hibernateAgent`
   (system-owner ctx) + emit the `hibernate_role_missing` ledger op — mirroring
   PG04 exactly. All wrapped in try/catch (WARN, never throw).

**No recursion:** the recovery calls `installPluginLocally` DIRECTLY, never
`ChangeTitle`, so a PG04→ChangeTitle→G17 chain cannot loop.

**Deliberately NOT done here (scoped follow-up):** consolidating G17's recovery
and PG04's identical ~20-line recovery into one shared helper. PG04 is working
code with only ledger-level test coverage; refactoring it inside this bug fix
would risk a silent regression on the highest-blast-radius pipeline. The
duplication is documented in-code; consolidation should come with PG04
characterization tests first.

## TDD (RED → GREEN)
`tests/services/element-management-assistant-title.test.ts` — new case "G17: 0
active role-plugins after a non-skip install → set roleMissing". Drives
ChangeTitle to 'assistant' WITHOUT `skipPluginSync` (the existing deep tests all
use `skipPluginSync:true`, which skips G16/G17 — that is WHY this gap was never
caught). RED-verified: against the unfixed gate, `updateAgent` was called once
(G14 title) and never with `{roleMissing:true}`. GREEN after the fix.

Test-infra fix (required to reach G17): the shared `getClientCapabilities` mock
returned `{plugins:true,…}` but ChangeTitle checks `caps.rolePlugins` — so
`clientSupportsRolePlugins` was false and the plugin gates were skipped. Added
the accurate `rolePlugins:true` to the mock (a Claude client DOES support
role-plugins); this also makes the file's non-skip plugin path reachable for the
first time. Existing tests unaffected (they use `skipPluginSync:true`).

## Verification
- `tsc --noEmit` clean.
- Affected set (assistant-title + element-management-service + change-title-auth
  + governance-title-auth + ChangeClient): **133 passed / 0 failed**.
- **Full unit suite: 106 files, 1858 passed / 0 failed** (+1 = the new G17 test),
  2 pre-existing skips. Zero regressions.

## Implementation (2026-06-21)
`services/element-management-service.ts` (G17 recovery closure + two branches) +
`tests/services/element-management-assistant-title.test.ts` (new case + mock
fix) + `docs/API-CHANGES.md` §10. Landed in the overnight campaign
(TRDD-903b7a20). Not pushed.
