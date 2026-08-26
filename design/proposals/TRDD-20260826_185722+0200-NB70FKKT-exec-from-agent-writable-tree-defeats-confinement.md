---
trdd-id: NB70FKKT
title: An unconfined process executing a script from the agent-writable tree defeats the sandbox entirely
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:57:22+0200
updated: 2026-08-26T18:57:22+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
labels: [security, impersonation, sandbox, cross-project]
external-refs: [TRDD-O0RHX7K6, TRDD-K4BEKT3L, TRDD-EVO7T245]
---

## Problem

Found by the ai-maestro-janitor session, applying this card set's own writable-guarantor
predicate to their tree. Verified first-hand here before filing.

A process running OUTSIDE the agent sandbox executes a script that lives INSIDE the
agent-writable tree. A confined agent writes the script; the unconfined process runs it. That
is a general-purpose escape from the confinement layer, available through a supported feature.

## Evidence (measured 2026-08-26, both sides)

Their exec site, read rather than grepped:

```
scripts/plugin_manage.py:55   agent_cli() -> ~/ai-maestro/scripts/aimaestro-agent.sh
scripts/plugin_manage.py:175  cli = agent_cli() if backend == BACKEND_AIMAESTRO
scripts/plugin_manage.py:194  subprocess.run(cmd)
```

Our side of it:

```
-rwxr-xr-x 1 <agent-uid> staff  scripts/aimaestro-agent.sh
writable by agent uid: True
```

Second exec path they flagged: `terminal_trigger._resolve_aimaestro_cli` resolves the CLI via
`$AIMAESTRO_CLI`, then `$HOME/.local/bin`, then PATH — an ENV VAR deciding what gets executed.

## Why this is a PREREQUISITE on TRDD-O0RHX7K6, not a follow-up

**Today it grants nothing.** Under single-uid, an agent that can write that script can already
do anything that uid can do, directly. No privilege boundary is crossed and this is NOT a live
vulnerability — the janitor was explicit about not overstating it, and that restraint is right.

**It becomes live the moment confinement exists.** The whole value of TRDD-O0RHX7K6 is that a
confined agent cannot reach another agent. This call site hands it a way: write the script,
wait for an unconfined process to execute it. Building the profile first and discovering this
after would mean shipping a boundary with a documented hole in it.

This is the general form and it is worth stating as a class rather than an instance:
**confinement is defeated by anything unconfined that consumes attacker-writable input** —
a script, a config that names a command, an env var that selects a binary.

## Task

1. INVESTIGATE — enumerate every site, in this repo AND in the fleet plugins, where an
   unconfined process executes or sources something from an agent-writable path, or resolves
   what to execute from agent-writable config or an env var.
2. ASSESS — for each, whether the executing process is inside any agent's sandbox.
3. SAFEGUARD — the exec'd artifact must live somewhere the agent uid cannot write (this is
   TRDD-K4BEKT3L's safeguard, which is why the two are linked), or the caller must verify it
   against a known digest before executing.

## Acceptance

- [ ] Exec-from-writable-tree sites enumerated across this repo and the fleet plugins, each
      with the executing process and whether it is sandboxed.
- [ ] Env-var-selected exec paths (`$AIMAESTRO_CLI` and any sibling) included in that list.
- [ ] A stated remedy per site: relocate the artifact, or verify before exec.
- [ ] TRDD-O0RHX7K6 does not ship its profile as a claimed boundary until this list is empty
      or every remaining entry is documented as an accepted hole.
