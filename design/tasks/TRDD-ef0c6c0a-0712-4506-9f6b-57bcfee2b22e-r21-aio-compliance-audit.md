# TRDD-ef0c6c0a-0712-4506-9f6b-57bcfee2b22e — R21 AIO compliance audit (post-v3.9.1 verification)

**TRDD ID:** `ef0c6c0a-0712-4506-9f6b-57bcfee2b22e`
**Filename:** `design/tasks/TRDD-ef0c6c0a-0712-4506-9f6b-57bcfee2b22e-r21-aio-compliance-audit.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)

**Status:** In progress (audit complete; migrations partial)
**Author:** AI Maestro session 2026-05-06
**Branch:** `feature/phase6-jsonl-rebase-test`
**Governance baseline:** `docs/GOVERNANCE-RULES.md` v3.9.1

## Purpose

Codify the full inventory of pre-existing R21 violations discovered while
auditing the codebase against the freshly-codified all-in-one rules
(R21.0–R21.22). Document the recommended migration order so future
sessions can pick this up without re-discovering the surface.

This TRDD does NOT yet propose architectural changes to R21 itself —
the rule body is settled. It is an *implementation* TRDD: the rules are
correct, the codebase needs to catch up.

## Audit method

Three greps drive the inventory:

```
# R21.4 violations: direct claude CLI shell-outs outside element-management-service
grep -rn "execSync.*claude.*plugin\|execFileSync.*claude.*plugin" \
  --include="*.ts" --include="*.mjs" --include="*.tsx" \
  | grep -v test | grep -v "element-management-service.ts"

# R21.2 violations: direct settings file writes outside element-management-service
grep -rn "saveJsonSafe.*settings\|saveJsonSafe.*localSettings\|loadJsonSafe.*settings\|loadJsonSafe.*localSettings" \
  --include="*.ts" \
  | grep -v test | grep -v "element-management-service.ts"

# Direct registry mutations outside Change* AIOs
grep -rn "updateAgent(" services/ app/api/ --include="*.ts" \
  | grep -v test | grep -vE "(element-management-service|broadcastAgentUpdate)"
```

## Findings — R21.4 (composition / shell-outs) — 18 sites

| File | Line(s) | What it does | Replace with |
|------|---------|--------------|--------------|
| `server.mjs` | 1610 | `claude plugin marketplace add Emasoft/ai-maestro-plugins` | `CreateMarketplace` |
| `server.mjs` | 1614 | `claude plugin marketplace add "${rolesDir}"` | `CreateMarketplace` |
| `server.mjs` | 1615 | `claude plugin marketplace update ai-maestro-local-roles-marketplace` | `UpdateMarketplace` |
| `server.mjs` | 1619 | `claude plugin marketplace add "${customDir}"` | `CreateMarketplace` |
| `server.mjs` | 1620 | `claude plugin marketplace update ai-maestro-local-custom-marketplace` | `UpdateMarketplace` |
| `server.mjs` | 1630 | `claude plugin marketplace remove ai-maestro-local-core-marketplace` | `DeleteMarketplace` |
| `app/api/settings/marketplaces/route.ts` | 868 | `claude plugin enable …` (handleEnable) | `ChangePlugin(action='enable', scope='user')` |
| `app/api/settings/marketplaces/route.ts` | 881 | `claude plugin disable …` (handleDisable) | `ChangePlugin(action='disable', scope='user')` |
| `app/api/settings/marketplaces/route.ts` | 893 | `claude plugin update …` (handleUpdate) | `ChangePlugin(action='update', scope='user')` |
| `app/api/settings/marketplaces/route.ts` | 907 | `claude plugin install …` (handleInstall first attempt) | `ChangePlugin(action='install', scope='user')` |
| `app/api/settings/marketplaces/route.ts` | 944 | `claude plugin install …` (handleInstall retry-after-cleanup) | (cleanup logic moves into ChangePlugin PG02) |
| `app/api/settings/marketplaces/route.ts` | 971 | `claude plugin uninstall …` (handleUninstall) | `ChangePlugin(action='uninstall', scope='user')` |
| `app/api/settings/marketplaces/route.ts` | 1345 | `claude plugin disable --all --scope user` (handleNuke) | New `ChangePluginsBulk` AIO OR loop `ChangePlugin` |
| `app/api/settings/marketplaces/route.ts` | 1357 | `claude plugin list ${flags}` (read-only) | Read-only — keep, but document as "below the AIO line" |
| `app/api/settings/marketplaces/route.ts` | 1376 | `claude plugin validate "${path}"` (read-only) | Same — read-only |
| `app/api/settings/marketplaces/route.ts` | 1388 | `claude plugin marketplace update` (refresh-all) | Loop over `UpdateMarketplace` per registered marketplace |
| `app/api/settings/marketplaces/route.ts` | 1401 | `claude plugin marketplace list --json` (read-only) | Same — read-only |
| `app/api/agents/creation-helper/publish-plugin/route.ts` | 190 | `claude plugin marketplace update ${LOCAL_MARKETPLACE_NAME}` | `UpdateMarketplace` |
| `scripts/register-agent-from-session.mjs` | 318 | `claude plugin install ai-maestro-plugin@…` | `ChangePlugin(action='install', scope='local')` |
| `services/role-plugin-service.ts` | 1014 | `claude plugin marketplace remove 23blocks-OS/ai-maestro-plugins` | `DeleteMarketplace` |
| `services/role-plugin-service.ts` | 1019 | `claude plugin marketplace remove https://…` | `DeleteMarketplace` |

## Findings — R21.2 (helpers must be pure) — 6 sites

| File | Line(s) | Mutation | Replace with |
|------|---------|----------|--------------|
| `lib/client-plugin-adapters/claude-adapter.ts` | 123, 127 | direct settings.local.json write (per-agent) | Adapter is the primitive ChangePlugin uses for Claude — keep the file but document that it is ONLY callable from inside ChangePlugin. Add a runtime guard (a stack-frame check or an "internal" sentinel) to fail fast if anyone calls the adapter from outside the AIO. |
| `lib/client-plugin-adapters/claude-adapter.ts` | 144, 148 | same | same |
| `services/role-plugin-service.ts` | 702 | direct user-scope settings.json write | `ChangePlugin(action='install'/'enable', scope='user')` |
| `services/role-plugin-service.ts` | 897 | same | same |
| `services/role-plugin-service.ts` | 1037 | same | same |
| `services/role-plugin-service.ts` | 1086 | per-agent settings.local.json write | `ChangePlugin(action='install', scope='local')` |
| `services/plugin-storage-service.ts` | 896 | direct user-scope write | Keep IF this is below the AIO line (storage primitive); otherwise route through ChangePlugin. |

## Findings — direct `updateAgent()` calls — 7 sites

| File | Line | Field(s) mutated | Replace with |
|------|------|------------------|--------------|
| `services/agents-core-service.ts` | 803 | (multiple — AIO dispatcher) | OK — this IS the dispatcher. Below the AIO line. |
| `services/amp-service.ts` | 1569 | `aid` / AMP fields | New `ChangeAMPIdentity` AIO OR fold into `ChangeAID` if it exists |
| `services/amp-service.ts` | 1742 | same | same |
| `services/sessions-service.ts` | 799 | session-related fields | `ChangeName` if name; otherwise new AIO |
| `app/api/agents/[id]/amp-init/route.ts` | 87 | `ampIdentityMissing: false` flag flip | Defensible — single boolean flag flip in a route handler that's already a thin endpoint. Document as "below the AIO line" if no other callers need it. |
| `app/api/agents/[id]/metadata/route.ts` | 84, 135 | `metadata` field | New `ChangeMetadata` AIO |

## Recommended migration order

Each row is one commit. Land them one at a time so each is reviewable.

1. **`app/api/settings/marketplaces/route.ts` handlers → ChangePlugin AIO** (largest blast radius, biggest user-scope-plugin path). Migrate `handleEnable` / `handleDisable` / `handleUpdate` / `handleInstall` / `handleUninstall` to dispatch through `ChangePlugin(scope='user')`. Move the multiple-key-format resolution into a pre-G03 helper inside ChangePlugin. Move the install retry-on-stale logic into a PG02. Tests. (Most complex of the migration set — do not bundle with anything else.)
2. **`server.mjs` startup marketplace registration** — replace 6 `execSyncMkt(...)` calls with `CreateMarketplace` / `UpdateMarketplace` / `DeleteMarketplace` AIO calls. Boot-time path so failures are visible. Tests via integration.
3. **`services/role-plugin-service.ts` direct settings writes** — 5 sites. Migrate to `ChangePlugin`. The function is named `syncRolePlugin` and has wide callers; refactor cautiously, with tests.
4. **`scripts/register-agent-from-session.mjs`** — 1 site. Single migration to `ChangePlugin(action='install', scope='local')`.
5. **`app/api/agents/creation-helper/publish-plugin/route.ts:190`** — 1 site. Single migration to `UpdateMarketplace`.
6. **`services/role-plugin-service.ts:1014, 1019` legacy marketplace removal** — Migrate to `DeleteMarketplace`.
7. **`services/amp-service.ts:1569, 1742`** — Need a new `ChangeAMPIdentity` AIO (or `ChangeAID`). Lift the gates out of the existing AMP code.
8. **`services/sessions-service.ts:799`** — Determine which Change* AIO covers the field set; route through it.
9. **`app/api/agents/[id]/metadata/route.ts:84, 135`** — Need a new `ChangeMetadata` AIO with R21 gates.
10. **`lib/client-plugin-adapters/claude-adapter.ts` runtime guard** — Add the "callable only from ChangePlugin" sentinel.

## Already fixed in v3.9.0–v3.9.1

- ✅ `ChangePlugin` G11b — programArgs rewrite now goes through `ChangeCLIArgs` AIO instead of direct `updateAgent` (commit `1a2800e7`)
- ✅ `DeleteMarketplace` cascade through `UninstallPlugin` per plugin (commit `58e7e465`)
- ✅ Four new plugin-scoped AIOs created: `UninstallPlugin`, `InstallPlugin`, `UpdatePlugin`, `CheckPluginUpdates` (commit `58e7e465`)
- ✅ `lib/plugin-enumeration.ts` extracted as the single read-only enumeration helper (commit `58e7e465`)

## Known limitations carried forward

- `app/api/settings/marketplaces/route.ts` has special "try multiple key formats" logic for handling marketplace name aliases between settings.json and the CLI. Migrating to `ChangePlugin` requires either (a) inheriting that logic inside ChangePlugin's user-scope path, or (b) the CLI accepting only one canonical key format and the route layer canonicalising before dispatch. Pick before migration item 1.
- `services/role-plugin-service.ts` shares state with the role-plugin install path that ChangePlugin already uses. Refactoring may simplify the role-plugin pipeline AND the role-plugin guard test suite. Audit dependencies before touching.

## Out of scope for this TRDD

- Persona prompt migrations in the 8 `Emasoft/ai-maestro-*` plugin repos (R6.14). Tracked separately — each plugin repo needs its own commit + `scripts/publish.py` cycle.
- Doc migrations in `docs/CONCEPTS.md`, `docs/OPERATIONS-GUIDE.md`, `docs/EXTERNAL-SESSION-SETUP.md` — descriptive, not normative; doc-only follow-up commit.
