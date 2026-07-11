---
trdd-id: L1OYEVSN
title: AID_AUTH is injected only on create — every server restart strips the fleet's API credential
column: dev
created: 2026-07-11T19:31:58+0200
updated: 2026-07-11T19:31:58+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 0
severity: CRITICAL
effort: M
labels: [security, auth, aid, session-env, one-writer, migration-readiness, fleet-blocker]
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
test-requirements: [unit, integration, typecheck]
review-requirements: []
runtime-targets: [macos]
impacts: [public-api]
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T19:45:00+0200
implementation-commits: []
external-refs: ["https://github.com/Emasoft/ai-maestro/issues/57", "https://github.com/Emasoft/ai-maestro/issues/46", "https://github.com/Emasoft/ai-maestro/issues/55", "design/tasks/TRDD-20260711_181251+0200-QMD7X3FB-forbid-root-and-home-workdirs.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**The fleet cannot authenticate to its own server, and a restart is what breaks it.**

`AID_AUTH` — the per-session secret an agent presents to the ai-maestro HTTP API — is
minted and injected by exactly ONE of the two session-creation paths. The other path,
which is the one a restart uses, omits it. So the credential survives creation and is
destroyed by the first server restart, permanently.

MEASURED on this host, 2026-07-11, before any fix: **8 of 8 live tmux sessions carry no
`AID_AUTH`.** 5 of those 8 carry `AGENT_WORK_DIR`, which is set in the SAME env bag by the
SAME call — so the bag is delivered and the variable is simply not in it. That rules out
"tmux dropped the env" and pins the defect on the bag's contents.

**FIXED AND PROVEN ON THE LIVE SERVER.** `lib/session-env.ts::buildAgentSessionEnv()` is now
the ONE builder; both `sessions-service::createSession` and `agents-core-service::wakeAgent`
call it. Gates: tsc 0 · vitest **164/164 files, 2565 passed** · `yarn build` OK.

Live E2E (kill a session → `pm2 restart` → boot-restore rebuilds it through the WAKE path):

```
e2e-ctl-1783769585   AID_AUTH=1  AGENT_WORK_DIR=1     <- restored post-fix
<7 other sessions>   AID_AUTH=0                        <- pre-fix survivors, never re-woken
curl (no credential)                       -> HTTP 401
curl (the AID_AUTH the wake path issued)   -> HTTP 200
```

**OPERATIONAL CONSEQUENCE — the fix is not retroactive.** A session that is ALREADY running
keeps the env it was born with; tmux cannot inject a variable into a running pane's process
tree. So every agent alive today remains unauthenticated until it is **re-woken** (hibernate
→ wake, or kill the tmux session and restart the server). Plan the fleet migration with one
deliberate re-wake pass; do not assume deploying this code re-credentials anyone.

NEXT ACTION: none for the fix. Remaining: answer ai-maestro#57 / #46 with this as the root
cause, and decide whether the belt-and-braces `setEnvironment` refresh should also run on the
wake path (create does it; wake does not — harmless today because `-e` already covers the
initial pane, but it is another asymmetry between the two paths).

## The defect

| Path | Entry point | Builds env bag at | `AID_AUTH`? |
|---|---|---|---|
| **create** | `CreateAgent` → `sessions-service::createSession` | `sessions-service.ts:980` | **YES** (`:1027`) |
| **wake** | `POST /api/agents/[id]/wake` → `agents-core-service::wakeAgent` | `agents-core-service.ts:2158` | **NO** |
| **boot-restore** | `server.mjs:2060` → `boot-restore-service` → **`wakeAgent`** | (same as wake) | **NO** |

The create path's own comment states the stakes exactly (`sessions-service.ts:939-941`):

> `AID_AUTH` is the session secret the agent uses to authenticate with the AI Maestro HTTP
> API. If it is not present the moment `claude` starts, every API call from the agent
> returns 401.

`wakeAgent` builds `{ AGENT_WORK_DIR, AIM_AGENT_NAME, AIM_AGENT_ID, AMP_DIR? }` and its
comment at `:2243` enumerates those four as though the set were complete. It is not. And
because `tmux set-environment` only reaches FUTURE panes — a fact both files document at
length — there is no later opportunity to repair it: if the var is not in the
`new-session -e` bag, the running `claude` never sees it.

**Boot-restore is what makes this fleet-wide rather than occasional.** Restoring an agent
is not a special case of waking it; it IS waking it. So every restart re-creates every
session through the credential-less path.

## Blast radius

Fail-**closed**, not fail-open — verified in `lib/agent-auth.ts:104` (no bearer, no cookie
→ 401). There is no privilege escalation here. The damage is total loss of function:

- Every `amp-*.sh` / `aimaestro-*.sh` call from an agent 401s, because `get_auth_args`
  emits only the AID bearer (ai-maestro#55).
- The **script layer is the decoupling boundary** — the ONE surface plugins are permitted
  to use instead of the API (CLAUDE.md, "Plugin Abstraction Principle"). Killing the
  credential kills the entire sanctioned interface for every agent that has survived a
  restart. Right now that is all of them.
- It is the true root cause under ai-maestro#46 (AMP identity) and the maintainer's
  ai-maestro#57 item 2. The maintainer PREDICTED the symptom — *"post-restart … becomes a
  401"* — and attributed it to registry ambiguity. The registry ambiguity is real, but the
  401 arrives first and arrives for everyone.
- It also means **the AID auth path has never been exercised in production**. Nothing has
  presented a valid `AID_AUTH` since the first restart, so its enforcement code is
  effectively untested by the running system.

## The fix — ONE builder, both callers

Do NOT copy the AID_AUTH block into `wakeAgent`. That is what produced this class of bug
three times already in this codebase, and a third copy is a third thing to forget.

- **`lib/session-env.ts` (new)** — `buildAgentSessionEnv(agent, cwd)` returns the complete
  bag and is the ONLY place that knows what a session env contains: `AGENT_WORK_DIR`,
  `AIM_AGENT_NAME`, `AIM_AGENT_ID`, `AMP_DIR` (best-effort), `AID_AUTH` (minted + hash
  persisted via `ChangeMetadata`).
- Both `createSession` and `wakeAgent` call it and pass the result straight to
  `runtime.createSession(name, cwd, env)`. Adding a future variable becomes a one-line
  change in one file that both paths inherit — which is the actual point.
- The mint is **fail-closed for the credential, fail-open for the session**: preserve
  today's create-path behaviour (log and continue if minting fails) rather than silently
  changing wake semantics under a security fix. But the failure must be LOUD, because a
  silent fail-open here is precisely what hid this for months.

## Verification

- **Unit** — `buildAgentSessionEnv` yields `AID_AUTH` for a registered agent; omits it (and
  warns) when the agent is unregistered.
- **Regression (the test that fails today)** — the WAKE path's env bag contains `AID_AUTH`.
- **Live E2E** — wake an agent, `tmux show-environment -t <s>` shows `AID_AUTH`, and an API
  call issued from inside the pane returns 200 rather than 401.
- Gates: `bash scripts/with-node.sh yarn test` · `npx tsc --noEmit` · `yarn build`.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] **Third time this exact shape.** TRDD-QMD7X3FB: the
  workdir policy enforced at 1 of 3 writers. TRDD-YOS36TZI: session state written at 1 of N
  mutation points. Now: the session credential injected at 1 of 2 session-creation paths.
  The pattern is always "two code paths do the same job, and the newer/rarer one is a
  partial copy of the older one." The lesson is not "be careful" — it is structural: when a
  second path appears that must produce the same artifact, the artifact's construction MUST
  be extracted into one function THEN, not later. A duplicated constructor is a bug with a
  delay fuse, and the fuse length is however long it takes someone to add a field.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] **A comment that enumerates a set is a claim, and
  claims rot.** `agents-core-service.ts:2243` says *"Env vars (AMP_DIR, AIM_AGENT_NAME,
  AIM_AGENT_ID, AGENT_WORK_DIR) are already in the initial pane's env"* — true, complete,
  and wrong, because the set it enumerates is not the set the system requires. It read as
  reassurance while being the very evidence of the omission. When a comment lists members
  of a set that lives in another file, it will eventually disagree with that file; prefer
  pointing at the single source (`see buildAgentSessionEnv`) over restating its contents.

[^3]: [ocd:2026-07-11 lmd:2026-07-11] **I nearly proved this with a truncated log.** I
  grepped 2000 lines of pm2 output for `Set AID_AUTH`, found zero, and briefly concluded the
  code never ran. The log held 345 lines starting at a restart AFTER the sessions were
  created — it could not have contained the line either way. An empty grep over a window
  that does not cover the event is not evidence of absence. The fact that actually settled
  it was `tmux show-environment` (present-tense state, not a historical log), plus a control
  experiment proving `show-environment` really does reflect `new-session -e`. Measure the
  state, not the story about the state; and when you must use a log, check its window first.
