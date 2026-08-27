---
trdd-id: NT7D8GJN
title: Install dev-browser at local scope for every agent through the pipeline instead of by hand
column: superseded
created: 2026-08-27T21:50:58+0200
updated: 2026-08-27T21:55:42+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: manager
approved: false
superseded-by: [C455WHV3]
priority: 2
severity: minor
effort: medium
labels: [plugins, r17, dev-browser, governance]
relevant-rules: [17]
---

# dev-browser should reach every agent through the pipeline, at local scope

## Problem

`dev-browser` reaches agents today **by hand and inconsistently**. Measured 2026-08-27:

- `~/.claude/settings.json` `enabledPlugins`: **no** dev-browser entry. Only its *marketplace*
  (`dev-browser-marketplace` → `sawyerhood/dev-browser`) is registered — a source, not an
  enablement. The belief that "the installer puts it at user scope" is false; no line in
  `scripts/`, `lib/`, or `services/` installs or enables it, and no code path writes
  `dev-browser@` anywhere.
- **2 of 12** agent workdirs enable `dev-browser@ai-maestro-plugins` in their
  `settings.local.json` (testbot, frank). The other 10 have it nowhere.
- What IS universal is the **CLI** on PATH (`/opt/homebrew/bin/dev-browser`), which the scenario
  helpers call directly — so the scenario runner works regardless of agent scope, and this gap has
  been invisible.

Two things make local scope the right home for it, independent of each other:

1. **The USER's stated direction (2026-08-27):** in the future, agents will be restricted to
   locally installed extensions only. That restriction is *not yet in force* — the USER's own
   example is the janitor, which cannot be local-installed (its arm skill refuses at local scope:
   *"arming it here would bind a machine-global guardian to one repo"*; it owns a machine-wide
   daemon, global OAuth state, and a singleton pid/flock). So this card is **scoped to dev-browser
   only** and is explicitly NOT the general migration.
2. **dev-browser has none of the janitor's disqualifiers.** Its daemon (`~/.dev-browser/daemon.pid`,
   `.sock`) is a per-user convenience process any caller may spawn — not a singleton guardian; it
   holds no OAuth and no fleet state. Two agents already run it at local scope with no conflict.
   R17.17's rationale for keeping `ai-maestro-plugin` local — user scope loads it into *every*
   Claude Code project on the host — applies to a headless-Chromium plugin at least as strongly.

## The finding that makes this a proposal, not a self-mandate

**The "core set" is not a set. It is one plugin.** `lib/ecosystem-constants.ts:254`:

```ts
export function isCorePlugin(pluginName, marketplaceName?) {
  return pluginName === MAIN_PLUGIN_NAME && (marketplaceName === undefined || marketplaceName === MARKETPLACE_NAME)
}
```

— a single equality, not a membership test. R17's self-heal (`ensureCorePluginInstalled`,
`services/agents-core-service.ts:2051`; `isCorePluginPresent` at `:2039`; the
`/api/agents/[id]/ensure-core` route) heals **only** `ai-maestro-plugin`. The janitor is present in
agents' `settings.local.json` too, but nothing in the pipeline put it there or keeps it there.

So there is no list to append dev-browser to. Doing this properly means turning a scalar into a
set across `isCorePlugin`, `ensureCorePluginInstalled`, `isCorePluginPresent`, and every R17 guard
that makes the core unremovable from the UI (`SCEN-020 core-plugins-unchangeable` pins that). That
is a **change to R17's semantics** — governance — and the D3 floor for a governance change is
`manager`. Hence a proposal. This card will not be self-approved.

## Proposed fix

Two shapes, and the approver picks — they differ in what "core" comes to mean:

**A. dev-browser becomes CORE (unremovable, self-healed).** Replace the `MAIN_PLUGIN_NAME` equality
with a `CORE_PLUGIN_NAMES` set `{ai-maestro-plugin, dev-browser}` in `ecosystem-constants.ts`
(and its shell mirror `scripts/ecosystem-config.sh` — the only two places these names may live);
make `ensureCorePluginInstalled` iterate it. Every agent gets dev-browser on next wake via the
existing R17 heal. **Cost:** every agent — including a MAINTAINER that never opens a browser —
carries a headless-Chromium plugin it cannot remove from the UI.

**B. dev-browser becomes a DEFAULT, not core (installed by the pipeline, removable).** Add it to
the agent-creation pipeline's default local install list alongside the role-plugin, without
touching `isCorePlugin`. Every *new* agent gets it; existing agents are back-filled once (a
one-shot sweep, or on next `ChangePlugin`); an agent may still drop it. **Cost:** no self-heal —
a removed dev-browser stays removed, which is the point.

**Recommendation: B.** The USER's direction is about *where* extensions live (local), not about
making more of them unremovable. A is the heavier semantic change for no stated need. B is
reversible and leaves R17's meaning ("the one plugin every agent must never lose") intact.

Either way, the install source is `dev-browser@ai-maestro-plugins`, which resolves: the live
marketplace manifest (read from GitHub, not the cache — the cache carries no manifest file, which
is why two earlier reads came back empty) lists `dev-browser` at `1.0.0`, source
`Emasoft/dev-browser` pinned to a sha.

## Verification

- A freshly created agent's `settings.local.json` enables `dev-browser@ai-maestro-plugins` with
  no manual step.
- After the back-fill, `for d in ~/agents/*/; jq '.enabledPlugins["dev-browser@ai-maestro-plugins"]'`
  is `true` for 12/12 (today: 2/12).
- `~/.claude/settings.json` `enabledPlugins` still carries NO dev-browser entry (local, never user).
- Under A only: removing it from the UI is refused (the SCEN-020 shape); under B it is allowed.
- The existing `tests/unit/` R17 suites stay green, and a new test pins whichever shape lands with
  a recorded neuter run.

## Estimated risk

LOW-MED. B touches only the creation pipeline and a back-fill; A touches R17's guard surface and
every test that pins "core is exactly ai-maestro-plugin".

## Approval log

- 2026-08-27T21:55:42+0200 — SUPERSEDED by TRDD-C455WHV3 (same author). The USER redirected the
  problem from "push dev-browser down to local" to "whitelist the user-scope set agents may use";
  this card attacked it from the wrong end. Archived with no judge: nobody declined it.

- (pending) — needs `manager`. Filed 2026-08-27 after the USER left the judgment to this session;
  the session judged that a change to what "core" means is not its to make alone.
