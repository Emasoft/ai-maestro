---
trdd-id: AQTGAY60
title: DeleteAgent leaves the agent's local plugin records behind in installed_plugins.json
column: todo
scope: project
created: 2026-07-29T21:30:09+0200
updated: 2026-07-29T21:30:09+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T21:30:09+0200
derived: false
npt: [FHBGF0WG]
eht: []
severity: major
priority: 1
release-via: none
relevant-rules: [R17, R20.30]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102, https://github.com/Emasoft/ai-maestro-janitor/issues/137]
---

# DeleteAgent leaves the agent's local plugin records behind in installed_plugins.json

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**The defect:** `DeleteAgent` removes the agent from every store it owns — cemetery archive,
team slots, tmux session, `sessions.json`, AMP keys, AID tokens, governance requests,
transfers, groups, the registry row, and (on a hard delete) the workdir — and does **not**
remove the agent's records from `~/.claude/plugins/installed_plugins.json`. Every agent the
server has ever deleted still has a local plugin record pointing at a workdir that no longer
exists.

**Measured first-hand 2026-07-29 21:30 (not inferred):**

| fact | value |
|---|---|
| local-scope records in `installed_plugins.json` | **101** |
| of those, `projectPath` absent from disk | **93 (92%)** |
| orphans that are `ai-maestro-plugin@ai-maestro-plugins` | **65** — installed by our own R17 core-plugin invariant |
| orphans that are `ai-maestro-janitor@ai-maestro-plugins` | **4** — NOT installed by us (see below) |
| `DeleteAgent` gate labels | `G01 … G09` — none mentions a plugin |
| the removal code that exists | `services/element-management-service.ts:1718` "Remove from installed_plugins.json" — in the **plugin-uninstall** path, which `DeleteAgent` never calls |

**NEXT ACTION:** add a `DeleteAgent` gate that removes every record whose `projectPath` is the
deleted agent's workdir. It is a MUTATING gate, so under R50/R51 it needs a compensation
registered before it runs — and it must land where the workdir path is still known (before
`G09` deletes the folder, and before the registry row is gone at `G08`).

**BLOCKED on NPT TRDD-FHBGF0WG.** The helper at `element-management-service.ts:1718` CANNOT be
reused as-is: `installed_plugins.json` maps a key to an ARRAY of per-install records, and that
code does `delete pluginsMap[pluginKey]` — the whole array, every agent, BOTH scopes. Reusing
it from `DeleteAgent` would turn "clean up one agent's records" into "wipe every agent's
records for that plugin, plus the user-scope row". FHBGF0WG makes the surgery record-scoped
first.

**Load-bearing facts / gotchas**

- **We do not install the janitor.** All 11 `ai-maestro-janitor` mentions in `lib/`,
  `services/`, `app/`, `scripts/`, `server.mjs` are comments or DATA-dir paths the
  oauth-rotator reads (`lib/oauth-rotator/{global-state,slots,safe-storage}.ts`). There is no
  install call site. The janitor is enabled at **USER** scope in
  `~/.claude/settings.json` (`enabledPlugins["ai-maestro-janitor@ai-maestro-plugins"] = true`),
  which is how it runs in every project. Whatever wrote those four local janitor records, it
  was not this codebase — that is an open question for ai-maestro#102, not an assumption to
  encode here.
- **Enablement and install-record are two different registries.** `settings.json`
  `enabledPlugins` says what is ON; `installed_plugins.json` says what is INSTALLED and where.
  Reading only the second one makes a user-scope-enabled plugin look absent. (Note
  `ai-maestro-plugin@ai-maestro-plugins = false` at user scope — that is R20.30 working: the
  core plugin is LOCAL per agent workdir, deliberately not user-scope-enabled.)
- **A soft delete keeps the workdir**, so its records are NOT orphans and must be preserved —
  the gate keys on the deletion being hard, or on the workdir actually going away, never on
  "DeleteAgent was called".
- The file is **Claude Code's own store**, outside the repo and not git-tracked. The server
  already writes it as a normal part of install/uninstall (`INSTALLED_FILE`,
  `element-management-service.ts:89`), so adding a delete-time cleanup is in scope. A one-time
  prune of the 93 EXISTING orphans on this machine is a deletion of untracked data outside the
  project and needs the USER's word first (RULE 0).

## Problem

Agent deletion is an all-in-one pipeline precisely so that no store is left disagreeing with
the others. This one store was missed, so the disagreement is total and monotonic: 92% of the
local plugin records on this host describe agents that do not exist. Nothing reports it,
because a stale record is indistinguishable from a live one to anything that only reads the
file.

## Root cause

`DeleteAgent` (`services/element-management-service.ts`) has no plugin-record gate. The
capability exists — the plugin-uninstall path removes records at `:1718` — but deletion and
uninstallation were built as separate flows and deletion never calls the other one. The agent's
plugin records were simply never on the list of things an agent owns.

## Downstream impact (why this is major and not cosmetic)

1. **It corrupts a peer's measurements.** The janitor reads `installed_plugins.json` to learn
   the fleet's plugin topology. On ai-maestro#102 it read the four orphaned janitor records —
   all four workdirs gone, none of the four agents in the registry even as tombstones — and
   concluded the fleet is "local-scope-per-agent, with no user-scope record", which would make
   its `--scope user` update path structurally unable to keep the fleet current. That
   conclusion was drawn from four ghosts.
2. **It under-protects `cache_prune`** (janitor#137). Pruning decides which cached version
   directories are still in use from these records. 93 ghosts make deleted agents look like
   live holders of old versions — the opposite of the "prune a version out from under a
   running agent" risk that issue is about, and just as wrong.
3. **It grows without bound.** Every scenario run creates agents and deletes them in its
   cleanup phase; every one leaves records. 65 `ai-maestro-plugin` orphans is the accumulated
   total of every agent this server has ever deleted.

## Proposed fix

1. **A `DeleteAgent` gate** that removes every `installed_plugins.json` record whose
   `projectPath` equals the agent's workdir. Placed where the workdir is still resolvable, with
   a compensation that restores the removed records if a later gate fails (R51).
2. **Soft-delete safety:** a soft delete preserves the workdir, so it must preserve the
   records; only the path that actually removes the workdir removes them.
3. **A reconcile for the existing 93** — proposed, NOT run unilaterally. Two shapes worth
   weighing: a one-time sweep, or a boot-time reconcile that drops records whose `projectPath`
   is absent. The second is self-healing but silently deletes on every boot, so it needs the
   same care as any self-heal: log the event, never repair what an observer merely measures.

## Verification

- A unit test hard-deletes an agent with a local plugin record and asserts the record is gone
  from the fixture `installed_plugins.json` — failing against HEAD.
- A test soft-deletes and asserts the record SURVIVES (the split is the point; a gate that
  removes on both paths would break re-adoption over a tombstone).
- A test forces a later gate to fail and asserts the records are restored (R51 compensation).
- Live: create a throwaway agent, confirm a record appears, hard-delete it, confirm the record
  is gone and the count drops by exactly one.

## Estimated risk

LOW for the new gate — it removes records for a workdir that is being destroyed anyway, and the
compensation covers the partial-failure case. MEDIUM for the reconcile of the existing 93,
because it deletes data outside the repo on the user's machine; that half stays a proposal
until the user rules on it.

## Approval log

- 2026-07-29T21:30:09+0200 — SELF-MANDATE by ai-maestro (min-approval-requirement: none).
  Tier 0: a defect in this repo's own deletion pipeline, inside the authoring agent's
  assignment scope, reversible and local. The reconcile of pre-existing orphans is explicitly
  carved out as USER-gated and is not covered by this mandate.

## Acceptance

- [ ] A `DeleteAgent` gate removes the deleted agent's `installed_plugins.json` records
- [ ] The gate registers a compensation and restores on a later-gate failure
- [ ] A soft delete provably does NOT remove them
- [ ] Unit tests cover all three, each with a recorded neuter run
- [ ] Live: a create/hard-delete cycle leaves the local-record count unchanged
- [ ] The pre-existing 93 orphans are reported to the USER with a proposed reconcile
- [ ] ai-maestro#102 answered with the measured topology and this defect
