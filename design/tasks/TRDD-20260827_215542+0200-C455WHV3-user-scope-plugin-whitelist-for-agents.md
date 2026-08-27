---
trdd-id: C455WHV3
title: A harness-enforced whitelist of the user-scope plugins an agent may use
column: ai_review
created: 2026-08-27T21:55:42+0200
updated: 2026-08-27T22:08:28+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: manager
approved: true
approval-judge: user
approval-datetime: 2026-08-27T22:08:28+0200
implementation-commits: [a0ad67ab, efec2705]
priority: 1
severity: medium
effort: medium
labels: [plugins, r17, governance, security]
relevant-rules: [17]
supersedes: [NT7D8GJN]
---

# Agents see only a whitelist of user-scope plugins; everything else is switched off per agent

## The directive (USER, 2026-08-27, verbatim in substance)

> For now we can only aim to minimize the extensions installed at user scope and used by the
> agents. It would be better to explicitly define the user scope plugins that are allowed to be
> used by the agents — a whitelist enforced by the ai-maestro harness. It will include the
> janitor, the pss plugin, the cpv plugin, the llm-externalizer plugin, the visual communicator
> plugin.

This inverts, and replaces, `TRDD-NT7D8GJN`: that card pushed one plugin *down* to local scope;
this one defines the allowed *user-scope* set and lets the harness enforce it. Same goal, from
the correct end.

## The whitelist — exact ids, measured against `~/.claude/settings.json` on 2026-08-27

| plain name | plugin id (as `enabledPlugins` keys it) |
|---|---|
| janitor | `ai-maestro-janitor@ai-maestro-plugins` |
| pss | `perfect-skill-suggester@emasoft-plugins` |
| cpv | `claude-plugins-validation@emasoft-plugins` |
| llm-externalizer | `llm-externalizer@emasoft-plugins` |
| visual communicator | `ai-maestro-visual-communicator-plugin@ai-maestro-plugins` |

All five are enabled at user scope today. The host has **37** user-scope plugins enabled; the
other **32** (LSPs, `code-review`, `ponytail`, `fable-advisor`, `git`, …) are the HOST USER's
tooling for the host user's own sessions. The whitelist governs what **agents** may use — it must
never touch what the host user has installed. That distinction is the whole design.

## Why the harness may not simply disable the other 32 at user scope

Two standing rules forbid it, and both are correct:

- **The IRON no-user-scope-writes rule** (`feedback_ai_maestro_never_installs_user_scope`,
  TRDD-QZL828OD): the harness must not write `enabledPlugins` / `extraKnownMarketplaces` / the
  plugins cache at user scope. `lib/claude-settings-enforcer.ts` carries an explicit carve-out
  that *excludes* those keys. Its WHY is precise — don't leak AI-Maestro's plugins into the user's
  OTHER Claude Code projects — and disabling the user's own LSPs would be that harm inverted.
- **R17.18**: the server MUST NOT run a startup audit or periodic loop that mutates agent state;
  compliance is the sole responsibility of the AIO Change\* pipelines and their post-gates.

## The platform fact that makes the design one line

Checked against the Claude Code docs (settings + plugins-reference, 2026-08-27):

- Settings precedence is **managed > CLI `--settings` > project-local > shared-project > user**.
  A key set at a higher level overrides the same key lower down. So `"foo@bar": false` in an
  agent's `.claude/settings.local.json` overrides `true` in `~/.claude/settings.json` **for that
  agent's process only**.
- There is **no** per-plugin allowlist/denylist key at any scope (`strictKnownMarketplaces` and
  `blockedMarketplaces` gate marketplace *addition*, managed scope only, not plugin enablement).
- `--plugin-dir` loads *additional* plugins; it does **not** exclude user-scope ones. There is no
  `--disable-all-plugins`.

So the only lever the platform offers is exactly the one both rules permit: **write into the
agent's own local settings**. The pipeline already does this — `element-management-service.ts`
sets `enabledPlugins[key] = false` at local scope in four places today (`:1159`, `:1425`,
`:1623`, `:2357`). The whitelist is a new post-gate using an existing primitive.

## Proposed fix

1. **The whitelist is a constant**, in the only two places plugin/repo names may live:
   `lib/ecosystem-constants.ts` (`DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS`, the five ids above)
   and its shell mirror `scripts/ecosystem-config.sh`. One source of truth; a test asserts the
   two agree.
2. **A post-gate in every Change\* pipeline that leaves an agent runnable** (`CreateAgent`,
   `wakeAgent` / `createSession`, `InstallElement`, `ChangePlugin`, `ChangeClient`,
   `ensure-core`): read the host's user-scope `enabledPlugins` (read-only — the enumeration in
   `lib/plugin-enumeration.ts:46` already does), and for every key that is `true` there and NOT
   in the whitelist and NOT already `false` locally, write `"<key>": false` into the agent's
   `.claude/settings.local.json`. Merge, never replace; idempotent; atomic — the same contract the
   env-key enforcer documents. Keys already in the whitelist are left untouched (the agent may
   still disable one of them itself).
3. **Never writes user scope. Never runs on a timer.** It runs inside the pipelines R17.18 names,
   ends with a PG post-gate like its siblings, and touches only the agent's own file.
4. **Local-scope plugins are out of scope.** The agent's own local installs (`ai-maestro-plugin`,
   its role-plugin, `dev-browser@ai-maestro-plugins` where present) are not user-scope and are not
   governed here.
5. **Drift is the pipeline's, not a loop's** (R17.18): if an agent is found with a
   non-whitelisted user-scope plugin active, the defect is in the last pipeline that mutated it.
6. **The rule**: a new `R17.20` in `docs/GOVERNANCE-RULES.md` stating the whitelist, its home,
   and the enforcement point — so the constant has a governing text and the ratchet can pin it.
   Adding a name to the whitelist is a change to R17 → `manager`.

## What this does NOT do, stated so nobody "fixes" it

- It does not uninstall or disable anything at user scope. The host user keeps all 37.
- It does not touch a non-agent project. Only `~/agents/<name>/.claude/settings.local.json`.
- It does not relocate the janitor or any whitelisted plugin to local scope. The USER's own
  example: the janitor *cannot* be local-installed today (its arm skill refuses local scope by
  design — machine-global daemon, OAuth, singleton). The whitelist is precisely the mechanism
  that lets such plugins stay at user scope *and* be allowed.
- It does not decide `dev-browser`. That plugin is not on the whitelist and is not at user scope,
  so it is unaffected; whether agents get it locally is `NT7D8GJN`'s question, now superseded
  into: "add it to the agent-creation defaults or not" — a separate, smaller card if wanted.

## Verification

- Create a fresh agent → its `settings.local.json` `enabledPlugins` carries `false` for each of
  the 32 non-whitelisted user-scope keys and NO entry for the 5 whitelisted ones.
- `claude --debug` (or `/plugins`) inside that agent's workdir lists only the 5 + its local
  plugins; `ponytail`, `code-review`, the LSPs are absent.
- `~/.claude/settings.json` is byte-identical before and after (sha256) — the user-scope
  invariant, asserted, not assumed.
- Wake an existing agent whose local file lacks the `false` entries → they appear (the post-gate
  ran); wake it again → no write (idempotent; the settings watcher ledger records nothing).
- A test seeds a fake `$HOME` with 37 user-scope plugins, runs the post-gate, and asserts the
  exact set of `false` keys; a neuter run (whitelist emptied → 37 falses; gate removed → 0)
  recorded in its docstring.
- `yarn test` green; `pillars:lint` 0; `trddgrep validate` unchanged.

## Estimated risk

MED. One new gate across ~6 pipelines, but built on a primitive four sites already use, writing
a file those pipelines already own. The risk is not the write; it is the READ of user-scope
settings being lenient — a corrupt or missing `~/.claude/settings.json` must fail the gate
CLOSED (skip with a logged WARN), never be read as "no user-scope plugins" and silently write
nothing. The env-key enforcer's fail-closed contract is the model.

## Implemented — 2026-08-27, on the USER's "just implement the whitelist"

- `lib/ecosystem-constants.ts` — `DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS` (the five ids) and its
  shell mirror in `scripts/ecosystem-config.sh`; a test asserts the two are identical AND that both
  equal the hard-coded requirement, so they cannot satisfy each other by drifting together.
- `lib/user-scope-plugin-whitelist.ts` — reads user-scope `enabledPlugins` directly (fail-CLOSED:
  ENOENT is a pristine host, anything else refuses; the existing `listUserScopePluginInstalls`
  returns `[]` on any error and would have made a corrupt file read as "nothing to do"); writes
  `false` for every non-whitelisted `true` into the agent's `.claude/settings.local.json` via
  `updateJson`, whose serialize-and-compare short-circuit is what makes it idempotent — `wrote`
  reports the primitive's `changed`, not a flag of our own.
- `services/agents-core-service.ts` `wakeAgent` (`:2307-2318`) — runs the gate beside the R17 core
  heal on every wake, Claude clients only; an unreadable user scope refuses the wake (500). Every
  existing agent is covered on its next start, no back-fill loop (R17.18).
- `docs/GOVERNANCE-RULES.md` — **R17.24** (R17.20 already existed; the first draft would have
  collided). `docs/GOVERNANCE-ENFORCEMENT-MAP.md` — the row the coverage ratchet demands.

**Confirmed against the platform, not assumed:** the key is `enabledPlugins` with a boolean value —
there is no separate `disabled` key — and project-local sits above user scope in the precedence
ladder, so a local `false` beats a user-scope `true` for that process alone. The plugin body is
never copied; only enablement is per-scope, which is why one `false` line suffices.

**One deliberate difference from the USER's sketch:** whitelisted keys are NOT written `true`;
they are left absent so user scope's `true` stands. Same visible result, and it leaves the
operator free to disable one of the five for a specific agent by hand without the harness
flipping it back.

**Verified live, not only on fixtures:** against this host's REAL `~/.claude/settings.json` (37
enabled) and a COPY of a real agent's local file, the gate switched off exactly 32, left the
agent's own local plugins (core, role, dev-browser, janitor) untouched, and the real user file
was byte-identical before and after (sha256).

## Made configurable — 2026-08-27, on the USER's "stop treating the whitelist as immutable"

The first cut hard-coded the list (and even its length). Corrected: the five are DEFAULTS in
`DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS`; the effective list is `agentPluginWhitelist` in
`~/.aimaestro/system-settings.json`, read by `lib/agent-plugin-whitelist-store.ts` on every gate
call, and edited from the dashboard — an "AGENTS" control on each enabled plugin row in Settings
→ Extensions → Plugins, calling the strict `PATCH /api/settings/agent-plugin-whitelist`
(sudo-gated, owner-only in `SYSTEM_OWNER_ONLY_STRICT`). Three store semantics are pinned: absent
key → defaults; present key → verbatim EVEN IF EMPTY (an operator who cleared it decided
something — reading `[]` as "unconfigured" would silently overrule them); corrupt → the gate
refuses the wake rather than masking the store as the defaults. The API replaces the list
wholesale so two operators toggling at once cannot interleave. Adding a strict route also
required its `SYSTEM_OWNER_ONLY_STRICT` declaration and a regenerated
`design/specs/aimaestro-api-spec.md` — two ratchets that reddened and named their own fix.

## Acceptance

- [x] The whitelist is a SETTING: store + API + dashboard control; nothing hard-codes its
      length; the gate reads the store, never the constant (7 store/gate cases, incl. empty-list
      and corrupt-store).
- [x] The five USER-named plugins are the DEFAULTS, under their exact `name@marketplace` ids.
- [x] Every other user-scope `true` becomes `false` in the agent's own local file — 32 of 37 on
      this host, measured live on a copy.
- [x] `~/.claude/settings.json` is never written (asserted by bytes in the test AND in the live
      run).
- [x] Whitelisted keys are not written; the agent's pre-existing local plugins survive a merge.
- [x] Idempotent: a second pass writes nothing (bytes and mtime unchanged).
- [x] Fail-closed: a corrupt user-scope file refuses; a MISSING one is a pristine host and passes.
- [x] Wired into `wakeAgent`, pinned by a wiring test AND a fail-closed wake test — the gate's
      default mock returns a clean pass, so an unwired wake would look identical without them.
- [x] Neuters observed (4): whitelist emptied → 4 reds; lenient read → 1; constant `wrote` → 1;
      one member dropped from TS only → 3 incl. the mirror. Two earlier "8/8 green" emptied-runs
      were instrument bugs (a fixture derived from the constant; a neuter matching the `]` in the
      type annotation) and are recorded in the test docstring as such.
- [x] Gates: tsc 0 · lint 0 · pillars:lint 0 · `trddgrep validate` 266 · enforcement ratchet green
      after the R17.24 map row · full suite green (the r20 file's 10 s hook timeout in one run was
      load from a concurrent background suite — 13/13 alone).

## Approval log

- 2026-08-27T22:08:28+0200 — APPROVED by the USER ("just implement the whitelist and make sure
  ai-maestro enforces it in every agent"), which outranks the `manager` floor. Implemented the
  same session.
- Filed 2026-08-27 on the USER's directive; the USER named the five members. Supersedes
  `TRDD-NT7D8GJN`.
