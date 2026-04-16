# WakeAgent Env-Race Fix (WT-014 / WT-022 follow-up)

**Date:** 2026-04-16T23:14Z
**Branch:** worktree-agent-a7553123
**Files edited:** 2 source + 1 test
**Upstream context:** commit [`dcd8c870`](https://github.com/Emasoft/ai-maestro/commit/dcd8c870da43d697c7740f4259be5a7dffffce5c) — `fix(sessions): pass AGENT_WORK_DIR + AID_AUTH atomically to tmux new-session (WT-014#1 + WT-022#1)`

## Task

Close the same env-injection race in `services/agents-core-service.ts::wakeAgent`
that `dcd8c870` fixed in `services/sessions-service.ts::createSession`. The
upstream commit explicitly flagged wakeAgent as out of scope:

> The wake path in agents-core-service has the same bug but uses a different
> (shell-export) anti-pattern and is out of scope for this PR per the task prompt.

This commit is that follow-up.

## Race condition closed

### Before

```
[wake-path timeline]
t=0   runtime.createSession(name, cwd)                ← empty env
      └─ tmux new-session -d -s <name> -c <cwd>
      └─ first pane's login shell starts
      └─ nothing is set
t=50  persistSession(...)
t=60  setupAMPForSession(...)                         ← too late
      └─ runtime.setEnvironment(name, 'AMP_DIR', ...)
      └─ runtime.setEnvironment(name, 'AIM_AGENT_NAME', ...)
      └─ runtime.setEnvironment(name, 'AIM_AGENT_ID', ...)
      └─ these only reach FUTURE panes, not the running one
t=100 sendKeys "export AMP_DIR='...'; unset CLAUDECODE; claude"
      └─ racy: shell may not be ready; if the user attaches
        mid-boot the export line is lost; AGENT_WORK_DIR is
        never set so the directory-guard hook fails open
```

**Two distinct anti-patterns were present, both racy:**

1. `tmux set-environment` AFTER `new-session` only updates the session-level
   environment bag that tmux hands to FUTURE panes. The initial pane's process
   tree is already running and inherits nothing from it. (This is the SAME race
   `dcd8c870` fixed in sessions-service.)
2. `sendKeys "export FOO=bar; ..."` depends on the shell being ready when
   send-keys is delivered; on slow startup or user-attach-mid-boot the line
   can be clobbered or executed before the shell's login hooks finish
   initializing the PATH. (This is the DIFFERENT anti-pattern the upstream
   commit pointed out.)

### After

```
[wake-path timeline]
t=0   build initialEnv { AGENT_WORK_DIR, AIM_AGENT_NAME, AIM_AGENT_ID, AMP_DIR }
t=5   runtime.createSession(name, cwd, initialEnv)    ← atomic
      └─ tmux new-session -d -s <name> -c <cwd> -e 'KEY=VAL' -e ...
      └─ first pane's login shell starts WITH env already set
      └─ `claude` inherits all vars the moment it forks
t=50  persistSession(...)
t=60  setupAMPForSession(...)                         ← belt-and-braces
      └─ runtime.setEnvironment(...) for FUTURE panes only
t=100 sendKeys "unset CLAUDECODE; claude"             ← no export line
```

The env bag is baked into `tmux new-session -e KEY=VAL`, so it is present in
the first pane's process tree BEFORE the login shell runs. `claude` inherits
it when it forks. The post-create `setEnvironment` calls are kept as
belt-and-braces for any future pane opened via a tmux keybinding.

## Files touched

### `lib/agent-runtime.ts`

- Extended the `AgentRuntime` interface: `createSession(name, cwd, env?)` —
  the third arg is an optional `Record<string, string>` bag.
- Extended `TmuxRuntime.createSession` to append `-e 'KEY=VAL'` pairs to
  the tmux command line.
- Key validation: rejects any key not matching `/^[A-Z_][A-Z0-9_]*$/` so a
  caller-controlled string cannot smuggle CR/LF/`=` or shell metacharacters
  into the KEY=VAL parser.
- Value quoting: single quotes in values are escaped shell-safely
  (`'` → `'\''`) before being embedded.
- Matches the dcd8c870 sanitization (same regex, same injection defense).

### `services/agents-core-service.ts::wakeAgent`

- Pre-create step: compute `initialEnv` = `{ AGENT_WORK_DIR, AIM_AGENT_NAME,
  AIM_AGENT_ID }`, then best-effort `initAgentAMPHome` + `getAgentAMPDir` to
  add `AMP_DIR`.
- Call `runtime.createSession(sessionName, workingDirectory, initialEnv)` —
  all env vars baked in atomically.
- Keep `setupAMPForSession(...)` post-create as belt-and-braces for future panes
  (it calls `runtime.setEnvironment` for AMP_DIR / AIM_AGENT_NAME / AIM_AGENT_ID
  and unsets CLAUDECODE).
- Add a new best-effort `setEnvironment` call for `AGENT_WORK_DIR` that
  `setupAMPForSession` doesn't cover.
- Simplify the `sendKeys` launch: strip the `export AMP_DIR=... AIM_AGENT_NAME=...
  AIM_AGENT_ID=...; ` prefix — those vars are already in the pane's environment
  from `new-session -e`. The command is now just `"unset CLAUDECODE; <cmd>"`.
- Same simplification applied to the `program === 'terminal'` branch.

### `tests/services/agents-core-service.test.ts`

- Updated the existing "wakes a hibernated agent" test to expect a 3-arg
  `createSession` call (name + cwd + env object).
- Added a new test: **"passes AGENT_WORK_DIR atomically to tmux new-session
  (WT-014 wake-path fix)"** — asserts the third arg is defined and contains
  `AGENT_WORK_DIR`, `AIM_AGENT_NAME`, `AIM_AGENT_ID` keyed to the expected
  values.

## Verification

### `npx tsc --noEmit`

- Pre-fix: 1 TS error in hooks/useTerminal.ts (missing optional
  `@xterm/addon-unicode11` module — pre-existing, unrelated).
- Post-fix: same 1 error. **Zero new errors in the two edited source files.**

### `npx vitest run tests/services/agents-core-service.test.ts`

- 76 tests passed (including all 9 `wakeAgent` tests — the existing 8 plus
  the new WT-014 assertion).

### `npx vitest run tests/services/sessions-service.test.ts`

- 60 tests passed. The sessions-service createSession signature was already
  3-arg in dcd8c870 and continues to work.

### `npx vitest run` (full suite)

- 14 test files passed, 546 tests total. No regressions.

## Diff summary

```
 lib/agent-runtime.ts                       | 38 ++++++++++++--
 services/agents-core-service.ts            | 81 +++++++++++++++++++++++++++--
 tests/services/agents-core-service.test.ts | 39 +++++++++++++-
 3 files changed, 143 insertions(+), 15 deletions(-)
```

## Out-of-scope notes

- The worktree is on branch `worktree-agent-a7553123` (based on v0.27.0-era
  code) and does NOT yet have the AID session-secret layer from the feature/
  team-governance branch. The dcd8c870 commit introduces `AID_AUTH` for HTTP
  API authentication; this worktree has no `lib/session-secret.ts` and no
  `metadata.sessionSecretHash` in the agent registry. Adding AID_AUTH would
  require pulling ~5 additional files (session-secret.ts, agent-registry
  metadata support, the auth-bridge, etc.) which is far beyond "max 2 files"
  per the task spec. The fix applied here is STRUCTURAL: the env-atomic
  pattern is in place, so once AID_AUTH lands on this branch a one-line
  addition to `initialEnv.AID_AUTH = secret` will close that gap without
  further refactoring.
- Two stashes preserve intermediate work:
  - `stash@{0}` — kraken-full-featurebranch-agents-core (fork/feature-branch
    copy of agents-core-service.ts with fully-integrated AID_AUTH fix)
  - `stash@{1}` — kraken-scaffold-files (fork/feature-branch copies of
    lib/agent-registry.ts, lib/agent-runtime.ts, services/sessions-service.ts)
  - Also `/tmp/kraken-preserved/` holds lib-session-secret.ts and
    element-management-service.ts from feature branch.
  These exist if/when AID_AUTH lands on this branch and the full upstream
  fix can be transplanted in a follow-up commit.

## Link to upstream context

- dcd8c870 (fork/feature/team-governance): the sessions-service::createSession
  fix for the SAME race. This commit closes the wakeAgent gap that upstream
  commit explicitly deferred ("the wake path has the same bug but uses a
  different (shell-export) anti-pattern and is out of scope for this PR").
