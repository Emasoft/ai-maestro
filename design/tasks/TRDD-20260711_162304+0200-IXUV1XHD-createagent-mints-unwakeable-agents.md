---
trdd-id: IXUV1XHD
title: CreateAgent returned 201 for agents that can never be woken
column: complete
created: 2026-07-11T16:23:04+0200
updated: 2026-07-11T16:23:04+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 0
severity: CRITICAL
effort: M
labels: [r9.13, role-plugins, create-agent, migration-readiness, observability]
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, typecheck, e2e]
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T16:20:00+0200
implementation-commits: [ce635c14]
external-refs: ["design/tasks/TRDD-20260711_154259+0200-YOS36TZI-session-state-has-no-writer.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**Three code defects fixed and verified live. One MACHINE problem remains, and it is
the USER's call — see "The environment problem" below.**

`POST /api/agents` returned **201** for an agent whose role-plugin failed to install.
The agent was flagged `roleMissing`, hibernated, and then answered **409
role_plugin_required** on every wake, forever. R9.13 says the pipeline must HARD
REJECT a zero-role-plugin state; it did neither that nor an auto-install.

Verified after the fix, under the very condition that triggers it: `POST /api/agents`
now answers **400** and names the cause verbatim —

> role-plugin is mandatory (R9.13) — the agent's role-plugin could not be installed,
> so no agent was created. Cause: G16: WARN — Failed to install
> "ai-maestro-autonomous-agent": … Failed to clone repository: … **Could not resolve
> host: github.com**

— and the half-created agent is rolled back (tombstoned, per the never-hard-delete
governance). Gates: `tsc` 0 · vitest **159/159** · `yarn build` OK.

## The three code defects

**1. A degraded gate was invisible.** Every AIO pipeline records per-gate outcomes in
an `ops` array and returns it; the route handlers print none of it. So a WARN — "the
role-plugin failed to install" — produced a 201 and *total server-side silence*. The
only symptom was an agent that mysteriously refused to wake days later. `logDegradedOps`
now prints any WARN/FAIL/DENIED/VIOLATION/MISMATCH op from ChangeTitle and CreateAgent.
**This is what made the other two findable at all** — the root cause had been sitting in
an unread array for months.

**2. R9.13 was detected but not enforced (G07c, new).** ChangeTitle's G17 *does* catch
the violation: it sets `roleMissing=true` and hibernates. But it returns **success**, so
CreateAgent happily continued and returned 201. CreateAgent now re-reads the agent after
title assignment and, if `roleMissing` is set, rolls back and fails with the real reason.
A transient network failure must not mint a permanently broken agent.

**3. G08's Claude branch could only ever throw (and would install to the wrong dir).**
It called `createPersona({ personaName: desired.label || name })`:
- `label` is a DISPLAY name, auto-assigned **capitalized** ("Nadia", "Aurelia").
  `createPersona` validates against `/^[a-z0-9-]+$/` and **throws** on anything else —
  so for the default label this branch *always* threw, and the throw was swallowed into
  the WARN op nobody printed.
- `createPersona` installs into `~/agents/<personaName>/` — a directory derived from the
  LABEL, **not the agent's working directory**. For an adopted external workdir (a
  MAINTAINER on `~/Code/<project>`, the whole point of TRDD-WLWHVMKT) it would have
  created a bogus `~/agents/<label>/` and installed the role-plugin *there*, leaving the
  real workdir empty.
It now installs into `workDir` via `installPluginLocally` — the same primitive
ChangeTitle G16 uses.

**The test pinned the bug.** `createagent-g08-cross-client.test.ts` asserted
`createPersona({ personaName: 'Claude Persona' })` — a string with capitals AND a space,
which the real function rejects outright. The mock accepted what production refuses, so a
test asserting the exact broken call passed for as long as it existed. Its `fs/promises`
mock also lacked `rename`, so the atomic settings write silently degraded to a WARN —
a second mock gap hiding a second install failure.

## The environment problem (NOT a code bug — the USER decides)

The install fails because **the pm2-managed server process cannot resolve DNS**:

```
fatal: unable to access 'https://github.com/Emasoft/ai-maestro-autonomous-agent.git/':
       Could not resolve host: github.com
```

`git`/`gh` work fine from a normal shell — only children of the **pm2 daemon** are
affected. The daemon carries `CLAUDE_CODE_CHILD_SESSION=1`: it was started from inside a
network-sandboxed Claude Code session and every process it forks inherits that
environment. `pm2 restart --update-env` does **not** fix it (the env is re-read from the
*current* shell, which is itself a Claude session).

**Consequence for the migration: while this holds, no agent can be created at all** (the
new gate correctly refuses rather than minting broken agents), and nothing else needing
the network — plugin install/update, marketplace refresh — works either.

**The repair** (recycles the daemon; `ai-maestro` is the only pm2 app, so nothing else is
affected) must be run from a **normal terminal**, not from an agent session:

```bash
pm2 kill && cd ~/ai-maestro && pm2 start ecosystem.config.js && pm2 save
```

Left to the USER deliberately: killing the daemon stops the running fleet, and doing it
from inside a sandboxed session would just re-poison the environment.

## Verification

- Unit: the corrected G08 test asserts the plugin lands in the agent's **workdir** and
  that the label is never used as a path or persona slug. 159/159 files pass.
- E2E (live, DNS still broken): `POST /api/agents` → **400** + the verbatim cause; the
  registry entry is a tombstone, not a live half-agent.
- Still to verify once DNS is repaired: the same call returns **201** with the
  role-plugin present in `.claude/settings.local.json`.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] The root cause was legible in an `ops` array the
  whole time, and nothing printed it. A pipeline that reports per-gate outcomes only in
  its return value — to callers that discard it — has no error reporting at all; it has
  the *appearance* of it. Fix the observability first and the bug hunt collapses from
  hours of deduction to one log line. Corollary: a WARN that does not change the
  operation's outcome is not a warning, it is a silent failure with extra steps.
