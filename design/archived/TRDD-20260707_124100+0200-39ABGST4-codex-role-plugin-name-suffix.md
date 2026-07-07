---
trdd-id: 39ABGST4
title: Decide and fix codex-emitted role-plugin name suffix vs CLAUDE.md no-suffix rule
column: design
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T21:56:19+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: HIGH
effort: M
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-39ABGST4 — Decide and fix codex-emitted role-plugin name suffix vs CLAUDE.md no-suffix rule

## Problem

Verified at HEAD (2026-07-07): `ls
~/agents/role-plugins/codex-roles-marketplace/` returns
`ai-maestro-autonomous-agent-codex`, `ai-maestro-programmer-agent-codex`,
`marketplace.json` — every Codex-emitted role-plugin folder carries a
`-codex` suffix (and, per the quad-identity invariant, so do
`plugin.json:name`, `.agent.toml:[agent].name`, and
`agents/<name>-main-agent.md`'s frontmatter `name:`).

`CLAUDE.md` (this repo, lines 1167-1174, "Role-plugin conversion
rules") states:

> - When converting a role-plugin from one client to another, the
>   converter:
>   - PRESERVES the original plugin name (no suffix)
>   - CHANGES `compatible-clients` in `.agent.toml` to the target client
>   - Enforces fourfold identity with the same name
>   - Stores in `~/agents/role-plugins/` (same location)
>   - NEVER overwrites an existing folder — conversion fails if folder
>     exists

The live behavior contradicts this in two ways: (1) it suffixes the
name for non-Claude targets, and (2) it overwrites an existing folder
instead of failing.

This blocks any scenario (SCEN-026 S007, S008, S011, S012, S016) that
follows the CLAUDE.md-documented behavior and greps for the bare plugin
name `ai-maestro-programmer-agent` under
`codex-roles-marketplace/` — the grep finds nothing because the actual
folder is `ai-maestro-programmer-agent-codex`.

## Root cause

`services/plugin-storage-service.ts:184-212` (function that emits a
role-plugin for each target client) contains, at line 189:

```ts
const rolePluginName = targetClient === 'claude' ? sourceName : `${sourceName}-${targetClient}`
```

This unconditionally suffixes the emitted name for every non-Claude
target client — there is no code path that preserves the bare name for
role-plugins. The surrounding comments (lines 186-188) cite governance
rules `R20.3` / `R20.4` ("each client gets its own marketplace dir...
multi-client plugins are duplicated — one copy per marketplace") as the
justification for this layout.

Separately, at lines 193-196, the same function explicitly OVERWRITES
an existing target folder ("R20.26: same-named plugin in target
marketplace → overwrite (update in place)") — this contradicts
CLAUDE.md's "NEVER overwrites an existing folder — conversion fails if
folder exists" for role-plugins as well. Note: the `R20.x` numbers cited
in these code comments do NOT match the current numbering in
`docs/GOVERNANCE-RULES.md` (there, `R20.3` and `R20.4` are about
core-plugin-presence enforcement and default role-plugin assignment,
not plugin storage layout) — so either the code comments are stale
citations to a renumbered rule set, or `docs/GOVERNANCE-RULES.md`
itself needs a dedicated rule for this storage-layout policy. Whoever
picks up this TRDD should locate the authoritative source (git blame
on `plugin-storage-service.ts` around these lines, and any
`GOVERNANCE-RULES.md` history around R20.3/R20.4/R20.23/R20.26) before
deciding which side to change.

This is exactly the (a) vs (b) fork the source report identified:

- **(a)** The code is right, CLAUDE.md is stale — remove the suffix
  (and the overwrite-in-place behavior) for role-plugins, matching the
  documented intent that `compatible-clients` in `.agent.toml` is the
  sole per-client disambiguator.
- **(b)** The suffix is intentional (storage-layout disambiguation
  when multiple client variants of the same role-plugin coexist
  side-by-side under different `<client>-roles-marketplace/`
  directories) — update CLAUDE.md and every scenario/tool that greps
  for the bare name.

## Proposed fix

1. Read `docs/GOVERNANCE-RULES.md`'s git history for the R20 rules
   governing role-plugin storage layout (search around R20.3, R20.4,
   R20.23, R20.26) to determine whether a per-client suffix was ever
   ratified as policy, or whether the code comments are citing stale
   rule numbers from a prior draft.
2. Make the deliberate choice (option a or b above) and implement it:
   - **If (a):** in `services/plugin-storage-service.ts:189`, change
     the ternary so role-plugins NEVER get a client suffix (only
     ordinary/custom plugins do, per the sibling branch at line
     231-234 which already does `targetClient === 'claude' ? sourceName
     : \`${sourceName}-${targetClient}\`` for the non-role case — keep
     that branch as-is). Also fix lines 193-196 to FAIL (return an
     error / skip) instead of overwriting when the target folder
     already exists for a role-plugin, matching CLAUDE.md's "conversion
     fails if folder exists". Then re-emit the existing Codex
     role-plugins under their bare names
     (`~/agents/role-plugins/codex-roles-marketplace/ai-maestro-programmer-agent/`,
     etc.) and remove the old `-codex`-suffixed folders.
   - **If (b):** update CLAUDE.md's "Role-plugin conversion rules"
     section (lines 1167-1174) to state the suffix and overwrite-in-
     place behavior explicitly, and update every scenario (SCEN-026,
     and audit SCEN-016/SCEN-021 which touch the same storage tree) to
     grep for the `-<client>`-suffixed name when the target client is
     not Claude.
3. Whichever option is chosen, update `lib/ecosystem-constants.ts` and
   any UI that displays role-plugin names for non-Claude clients so the
   displayed name matches the on-disk convention.

## Verification

- Option (a): `ls ~/agents/role-plugins/codex-roles-marketplace/`
  returns folder names WITHOUT a `-codex` suffix (e.g.
  `ai-maestro-programmer-agent/`), and each folder's quad-identity
  fields (folder name, `plugin.json:name`, `.agent.toml:[agent].name`,
  `agents/<name>-main-agent.md` frontmatter `name:`) all match the bare
  name. Re-running the emit against an existing folder returns an
  error instead of silently overwriting.
- Option (b): CLAUDE.md's "Role-plugin conversion rules" section states
  the suffix + overwrite-in-place behavior, and SCEN-026 (plus any
  other scenario touching this tree) is rewritten to grep for the
  suffixed name.

## Estimated risk

HIGH. Touches the on-disk plugin storage layout that other scenarios
(SCEN-016, SCEN-021) and live user installations implicitly depend on.
Renaming existing folders (option a) risks breaking an agent that
already has a `-codex`-suffixed plugin installed and referenced in its
`settings.local.json`. This must NOT be an in-place Rule-4 fix — it
needs a deliberate migration plan regardless of which option is chosen.

**Dependencies:** Coupled with TRDD-YFCNYVYB (unify the local Codex
marketplace name) — both touch the same storage tree and should be
decided together so the plugin-key story
(`<name>@<marketplace-name>`) is internally consistent.

## Design decision (2026-07-07, code-review follow-up) — RESOLVED: option (b)

The policy fork is resolved in favor of **(b): the `-codex` suffix +
overwrite-in-place are intentional; align CLAUDE.md and the scenarios to
reality.** Evidence gathered at HEAD:

- Role-plugins register under the **shared, bare `LOCAL_MARKETPLACE_NAME`**
  for *every* client — verified in `services/plugin-storage-service.ts` lines
  975-976 ("SHARED bare LOCAL_MARKETPLACE_NAME constant for every client —
  never a `-<client>`-suffixed string"), 1036, 1065. Custom-plugins, by
  contrast, use a per-client `${CUSTOM_MARKETPLACE_NAME}-${targetClient}`
  name (lines 904, 918, 963).
- Therefore the plugin KEY of a role-plugin is
  `<name>@ai-maestro-local-roles-marketplace` with the marketplace segment
  IDENTICAL across clients. If two client variants of the same role
  (`ai-maestro-programmer-agent` for Claude and for Codex) both used the bare
  name, their keys would **collide**. The `-<client>` name suffix at line 189
  is the sole disambiguator — it is **load-bearing under the current
  shared-marketplace-name architecture**, not a bug.
- Overwrite-in-place (R20.26, lines 193-196) is the correct behavior for a
  re-emit/refresh flow: failing when the folder already exists would break
  every plugin update. CLAUDE.md's "conversion fails if folder exists" is the
  stale line, not the code.

**Why not option (a):** removing the suffix would require ALSO migrating the
role marketplace to per-client names (mirroring custom-plugins) AND rewriting
every installed agent's `settings.local.json` plugin key — a strictly larger,
higher-risk change than (b) with no functional benefit today. Option (a)
remains a possible *future* consolidation (unify role + custom marketplace
naming to per-client, then drop all name suffixes), but that is a separate,
larger effort and is explicitly out of scope here.

**Remaining execution (scoped, still deferred — not an in-place fix):**
1. Update CLAUDE.md "Role-plugin conversion rules" (≈lines 1167-1174) to state
   the `-<client>` suffix and overwrite-in-place behavior for non-Claude
   targets explicitly (drop the "no suffix" and "never overwrites" lines for
   the non-Claude case; Claude-target keeps the bare name).
2. Reconcile the stale `R20.x` citations in `plugin-storage-service.ts:186-196`
   with `docs/GOVERNANCE-RULES.md` (add a dedicated storage-layout rule there
   if none exists, and repoint the code comments at it).
3. Update SCEN-026 (and SCEN-016/SCEN-021, which touch the same tree) to grep
   for the `-<client>`-suffixed folder name when the target client is not
   Claude.

Risk is now LOW-MED (docs + scenario greps, no on-disk folder migration and no
`settings.local.json` rewrite — those were the HIGH-risk parts that option (a)
would have needed and (b) avoids).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Design-first — HIGH-risk on-disk migration + unresolved policy fork; EXCLUDED from the batch auto-implementation wave.
- 2026-07-07T21:56:19+0200 — DESIGN RESOLVED (code-review follow-up, USER-delegated "decide yourself"): policy fork settled as option (b) with evidence (role marketplace uses a shared bare name → the `-<client>` suffix is load-bearing for key uniqueness). column todo → design. Execution (CLAUDE.md + rule-citation + scenario-grep alignment, LOW-MED risk) left as a scoped follow-up; the HIGH-risk folder/settings migration that option (a) would have required is now avoided.
