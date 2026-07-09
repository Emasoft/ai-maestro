---
trdd-id: B6XN2VKD
title: Block agents from executing the claude CLI, via settings.local.json deny permissions
column: backburner
created: 2026-07-09T17:51:47+0200
updated: 2026-07-09T17:51:47+0200
current-owner: ai-maestro-session
assignee: null
priority: 3
severity: MEDIUM
effort: M
approval-tier: 2
task-type: security
release-via: none
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [security, agent-confinement, settings-local, permissions]
test-requirements: [unit, e2e]
audit-requirements: []
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [config-schema]
attempts: 0
implementation-commits: []
external-refs: []
---

# TRDD-B6XN2VKD — an agent must not be able to run `claude`

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-09

**Parked deliberately.** USER directed this be recorded for future pickup, not
built now: *"we can already do this by adding to the settings.local.json the
negative permissions disallowing the execution of claude. but we need to test
that, and so we will just create a TRDD for that to pick in the future."*

**NEXT ACTION:** nothing until picked up. First step when picked up is the
EXPERIMENT in "Open questions" below — a deny rule that does not actually deny
is worse than no rule, because it is believed.

## Problem

TRDD-D3RP7KQZ established the invariant: an agent may drive its own surface but
may never reconfigure itself. That invariant is enforced in `authorize()`, and
it governs the **AI Maestro API**.

It does not govern the shell. An agent with a Bash tool can simply run:

```bash
claude plugin install <role-plugin>@<marketplace> --scope local
claude plugin uninstall <its own role plugin>
claude mcp add …
```

and reconfigure itself completely, out of band, with no pipeline, no gate, and
no audit trail. Every governance guarantee above it is then decoration.

Worse, `claude plugin install` **defaults to `--scope user`** (confirmed:
`claude plugin install --help` → `-s, --scope <scope>  Installation scope: user,
project, or local (default: "user")`). So an agent that omits the flag does not
merely misconfigure itself — it writes the MACHINE-WIDE user settings, affecting
every other agent and the human.

## Evidence this is not hypothetical

Forensics on 2026-07-09, across every transcript under `~/.claude/projects/`,
found exactly two real Bash invocations that installed a role-plugin, both from
sessions in the **ai-maestro** project, and **neither passed a scope flag**:

```
claude plugin install ai-maestro-maintainer-agent@ai-maestro-plugins 2>&1
claude plugin install ai-maestro-autonomous-agent@ai-maestro-plugins 2>&1 | tail -15 …
```

Scope-less ⇒ user scope. Both landed in `~/.claude/settings.json`. One of the
two ran inside a SUBAGENT transcript (`agent-a1b04fc371b24da46.jsonl`).

A third invocation, `cd ~/ai-maestro && claude plugin install
ai-maestro-janitor@ai-maestro-plugins --scope project`, wrote PROJECT scope into
the ai-maestro source repo — which that repo's own rule forbids outright.

Separately, three role-plugins (autonomous, chief-of-staff, maintainer) turned up
enabled in the **ai-maestro-janitor** repo's project settings — an impossible
combination (R9.13: exactly one role-plugin per agent; they are mutually
exclusive) in a repo that is not an agent workdir at all. The janitor is a
USER-scope FUNCTIONAL plugin with no main agent; a role-plugin there is
meaningless. No recorded Bash command explains it, so it came from the
interactive `/plugin` UI or a hand edit. Removed by the USER.

While investigating this, the investigating session (me) accidentally executed
`claude plugin install` three times through unquoted backticks in an `echo`. It
failed with `missing required argument 'plugin'` and changed nothing. An agent
does not need malice to do this.

## Proposed fix

Add a **deny** permission rule for the `claude` binary to the
`settings.local.json` that `ensureAgentRules` / `ensureCorePluginInstalled`
already seed into every registered agent workdir, alongside the DEP rules and
the managed `.git/info/exclude` block.

Sketch (the exact matcher syntax is the first open question):

```jsonc
{
  "permissions": {
    "deny": ["Bash(claude:*)", "Bash(claude plugin:*)", "Bash(claude mcp:*)"]
  }
}
```

Team agents are to be DISCOURAGED first (persona text / DEP rule), then blocked.
AUTONOMOUS and MAINTAINER agents may need a carve-out: a MAINTAINER that takes
over a plugin repo legitimately runs `claude plugin` against a container.

## Open questions — resolve by EXPERIMENT before writing any code

1. **Does the deny rule actually fire?** Claude Code's permission matchers are
   prefix/glob based over the command string. `claude` reached via an absolute
   path (`/opt/homebrew/bin/claude`), a shell alias, `env claude`, `sh -c
   'claude …'`, or a script that calls it, may all evade a naive `Bash(claude:*)`
   matcher. Test every one of those shapes. A rule that is believed and does not
   hold is worse than no rule.
2. **Does a subagent inherit the deny?** One of the two real invocations came
   from a subagent. If subagent Bash calls bypass the workdir's
   `settings.local.json`, this fix does not cover the case that actually happened.
3. **Scope of the file.** `settings.local.json` is per-workdir. An agent that
   `cd`s outside its workdir — which the runtime `agent-shell-guard.sh` already
   constrains to `$AGENT_WORK_DIR` + tmp — must still be denied.
4. **Interaction with `agent-shell-guard.sh`.** That guard overrides `cd`/`pushd`
   against an allowlist. Is a command-level deny the right layer, or should the
   guard shadow `claude` with a refusing function? A shell function is trivially
   bypassed by an absolute path; a permission deny is enforced by the harness.
   Probably both, belt and braces.
5. **The MAINTAINER carve-out.** Per USER: a maintainer taking over a plugin will
   `git clone` it from GitHub into a Docker container and publish from there — it
   will NOT use the local `~/Code` checkout. So the carve-out belongs to the
   container, not the host workdir. That may mean NO host carve-out is needed.

## Verification

- Unit: the seeder writes the deny block; it is marker-guarded and never
  overwrites a user's own `permissions` stanza.
- E2E, and this is the real test: a live agent with the rule seeded attempts each
  evasion shape from open question 1 and is refused every time. Assert on the
  refusal, not on the absence of a change — an install that silently no-ops for
  an unrelated reason would otherwise read as success.
- Regression: an agent can still do its job — the DEP rules, the core plugin, and
  the AMP/AID CLI wrappers are all unaffected.

## Estimated risk

MEDIUM. Tightening. The failure mode of getting it wrong is a false sense of
confinement (see open question 1), not a broken agent. The failure mode of
getting the carve-out wrong is a MAINTAINER unable to do its job — recoverable.

## Notes and lessons learned

The API-level invariant and the shell-level invariant are different invariants.
`authorize()` can be perfect and an agent still reconfigures itself, because the
shell is a second, wider door into the same room. Any claim of the form "an agent
cannot X" must name WHICH doors were checked.
