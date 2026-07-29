---
trdd-id: FHBGF0WG
title: installed_plugins.json surgery is key-scoped not record-scoped so one agent's uninstall wipes every agent's record
column: todo
scope: project
created: 2026-07-29T21:35:03+0200
updated: 2026-07-29T21:35:03+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T21:35:03+0200
derived: true
derived-kind: npt
parent-trdd: AQTGAY60
npt: []
eht: []
severity: critical
priority: 0
release-via: none
relevant-rules: [R20.20, R20.30]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102]
---

# installed_plugins.json surgery is key-scoped not record-scoped

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**The defect, one line:** `installed_plugins.json` maps a plugin key to an **ARRAY of
per-install records** (`{scope, projectPath, version, …}`), and
`uninstallPluginLocally` deletes **the whole key**.

```ts
// services/element-management-service.ts:1718-1727  — uninstallPluginLocally
// Remove from installed_plugins.json
if (existsSync(INSTALLED_FILE)) {
  await withSettingsLock(INSTALLED_FILE, async () => {
    const installed = await loadJsonSafe(INSTALLED_FILE) as Record<string, unknown>
    const pluginsMap = (installed.plugins || {}) as Record<string, unknown>
    delete pluginsMap[pluginKey]        // <-- the ENTIRE array: every agent, BOTH scopes
    installed.plugins = pluginsMap
    await saveJsonSafe(INSTALLED_FILE, installed)
  })
}
```

Verified schema (read from the live file, 2026-07-29 21:33):

```
plugins['ai-maestro-plugin@ai-maestro-plugins'] -> list, len 73
  record keys: gitCommitSha, installPath, installedAt, lastUpdated, projectPath, scope, version
  scopes present: ['local', 'user']
```

So a **LOCAL** uninstall for ONE agent destroys 73 records — every other agent's local row
**and the user-scope row**. That is a direct **R20.30** violation: *"An uninstall button NEVER
touches the opposite scope."* Worse, on the marketplace path the Claude CLI has already done
the correct scoped removal (`claude plugin uninstall … --scope local`, `:1677-1679`) and then
our code deletes everything anyway — we undo a correct operation with an over-broad one.

**Blast radius — this is on every title change, not a rare path:**

| call site | when it runs |
|---|---|
| `element-management-service.ts:1798` | `syncRolePlugin` — uninstalls the *other* role-plugins on a title change |
| `element-management-service.ts:1834` | role-plugin auto-assign cleanup |
| `element-management-service.ts:3523`, `:3580` | `ChangePlugin` (the `:3580` one inside a gate `run`) |
| `services/headless-router.ts:3405` | the headless local-uninstall route |

Every `ChangeTitle` that swaps a role-plugin takes this path.

**A second, narrower defect in the twin function.** `installPluginLocally:1630` does
`pluginsMap[pluginKey] = [{…}]` — an **assignment**, not an append — so installing a plugin
for agent B replaces agent A's record for that same plugin. It is narrower than it looks
because `:1592` returns early on the CLI path (the Claude CLI writes those records itself), so
this only bites **local-only marketplaces** (Haephestos customs / local roles). Still wrong:
two agents sharing one custom plugin, and the second install erases the first's row.

**NEXT ACTION:** make both operations record-scoped — filter/upsert on
`(scope === 'local' && projectPath === resolvedDir)`, and delete the key only when the array
becomes empty. Then the parent (TRDD-AQTGAY60) can safely reuse the remover from `DeleteAgent`.

**Load-bearing facts / gotchas**

- **The array is heterogeneous in scope.** Any filter that forgets `scope` will eat the
  user-scope row, which is the single most damaging record in the file — it is what makes a
  plugin global.
- **Legacy shape tolerance.** `installPluginLocally` writes an array, and the CLI writes an
  array, but a hand-edited or older file could hold a non-array. Treat a non-array value as
  "cannot safely narrow" and leave it alone rather than guessing — deleting on a shape you do
  not recognise is how this bug behaves today.
- **Do not "fix" it by dropping the write.** The safeguard exists because the CLI has been
  flaky about cleanup (`:1687-1688`). Keep the defence in depth; just aim it at one record.
- **Suspected downstream, stated as a hypothesis not a finding:** ai-maestro#102 reports that
  `ai-maestro-janitor@ai-maestro-plugins` has **no user-scope record** despite being
  user-scope *enabled* in `~/.claude/settings.json`. A past local uninstall of the janitor
  from any agent workdir would have deleted its whole array including the user-scope row, with
  later local installs rebuilding it local-only. Mechanically exact and consistent with the
  observed data — but I have not seen the event, so it stays a hypothesis.

## Problem

Two different write paths treat a keyed **array of installs** as if it were a single value.
The read side (`cache_prune` in the janitor, our own scans, anything asking "where is this
plugin installed") then sees a file that is missing records for installs that are still live.

## Root cause

The file's schema was treated as `plugins: Record<pluginKey, record>` when it is actually
`plugins: Record<pluginKey, record[]>`. Both the install and uninstall helpers were written
against the wrong mental model, and nothing tested the multi-agent case — with one agent in
the fixture, key-scoped and record-scoped behave identically.

## Proposed fix

1. **`uninstallPluginLocally`** — replace the `delete` with a filter that removes only records
   matching `scope === 'local' && projectPath === resolvedDir`; if the resulting array is
   empty, drop the key; if the value is not an array, leave it untouched and warn.
2. **`installPluginLocally`** — upsert: replace an existing record with the same
   `(scope, projectPath)`, otherwise append; never assign a fresh array.
3. Export the record-scoped remover so `DeleteAgent` (parent AQTGAY60) can call it.

## Verification

- A fixture `installed_plugins.json` with **three** records for one key — agent A local, agent
  B local, one user — then `uninstallPluginLocally` for agent B: A and the user record
  SURVIVE, B's is gone. This fails against HEAD (all three vanish) and is the whole point.
- Uninstalling the last local record leaves the user record and keeps the key.
- Uninstalling the only record drops the key entirely.
- A non-array value is left untouched and warns.
- `installPluginLocally` for agent B does not disturb agent A's record; re-installing for B
  updates B's record in place rather than appending a duplicate.
- Each with a recorded neuter run.

## Estimated risk

LOW to fix, and the fix strictly narrows what is deleted — the failure mode of a bug here is
"too little removed", which leaves a stale record (the parent TRDD's problem, already known
and bounded) rather than destroying live state. Doing nothing keeps the current failure mode,
which is "too much removed" across agents and scopes.

## Approval log

- 2026-07-29T21:35:03+0200 — SELF-MANDATE by ai-maestro (min-approval-requirement: none).
  Tier 0: a defect in this repo's own plugin-record surgery, inside the authoring agent's
  assignment scope, reversible and local. Registered as an NPT of TRDD-AQTGAY60 because the
  parent's gate cannot reuse a remover that deletes every agent's records.

## Acceptance

- [ ] `uninstallPluginLocally` removes only the caller's `(local, projectPath)` record
- [ ] The user-scope record provably survives a local uninstall (R20.30)
- [ ] The key is dropped only when its array becomes empty
- [ ] A non-array value is left untouched with a warning
- [ ] `installPluginLocally` upserts by `(scope, projectPath)` instead of assigning
- [ ] Tests cover all five, each with a recorded neuter run
- [ ] The record-scoped remover is exported for TRDD-AQTGAY60's DeleteAgent gate
