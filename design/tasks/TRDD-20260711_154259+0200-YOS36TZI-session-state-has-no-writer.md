---
trdd-id: YOS36TZI
title: The registry's session state has no writer at the point of mutation
column: complete
created: 2026-07-11T15:42:59+0200
updated: 2026-07-11T16:16:00+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 0
severity: CRITICAL
effort: M
labels: [boot-restore, registry, sessions, migration-readiness]
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, typecheck, e2e]
audit-requirements: []
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T16:10:00+0200
implementation-commits: [cbe131d4]
external-refs: ["design/tasks/TRDD-20260711_131006+0200-WLWHVMKT-external-workdir-adoption.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**DONE, AND PROVEN ON A LIVE SERVER. Boot-restore has now resurrected an agent
across a real restart — the first time that has ever been demonstrated end to end.**

E2E (`/tmp/e2e-bootrestore.sh`, real server, real tmux, real `pm2 stop`/`start`):

| Check | Result |
|---|---|
| agent created via `POST /api/agents` with `createSession: true` | `201` |
| registry reads `status=active, sessions=1` **with no `/api/sessions` call ever made** | **PASS** (was `offline, 0`) |
| tmux session live | PASS |
| server stopped, then the tmux session destroyed (crash simulation) | PASS |
| server restarted → **boot-restore recreated the session (28 s)**, pane cwd correct | **PASS** |

Gates: `tsc --noEmit` 0 errors · vitest 159/159 files · `yarn build` OK. The 5 new
unit tests were RED before the fix and GREEN after (the sixth is a negative guard
that passes vacuously by design).

**Still open — NOT this TRDD's scope, and both still block the migration:**

1. `CreateAgent` mints a permanently un-wakeable agent when `pluginName` is omitted
   (`409 role_plugin_required` on wake, contra R9.13). The E2E above sidesteps it by
   passing `pluginName`; boot-restore would otherwise refuse to wake such an agent.
   Needs its own TRDD.
2. Test artifacts on disk (do NOT delete without asking): agents
   `e2e-br-1783777802`, `e2e-adopt-1783769238`, `e2e-adopt2-1783769489`,
   `e2e-ctl-1783769585`; fixtures `~/Code/aim-e2e-adopt-*`.

---

**The compaction summary that spawned this TRDD was WRONG, and the wrong version is
the more alarming one — record the correction before anything else.** It said the
registry's `status`/`sessions[]` are *never* written. They are: `GET /api/sessions`
writes them (`reconcileRegistrySessions`, TRDD-13MZ7EFO). The E2E only ever called
`/api/agents`, so it never triggered the one writer that exists. Falsified live:
with two agents showing `status=offline, sessions=0` and their tmux panes alive, a
single authenticated `GET /api/sessions` flipped both to `status=active,
sessions=1`.

**So the defect is not "no writer". It is: the only writer is a READER.**

| path | mutates tmux | writes `sessions.json` | writes registry `status`/`sessions[]` |
|---|---|---|---|
| `sessions-service.createSession` (CreateAgent G09, `POST /api/sessions/create`) | **yes** | yes (`persistSession`) | **NO** ← the hole |
| `agents-core-service.wakeAgent` | yes | yes | yes (`updateAgentSessionInRegistry`) |
| `agents-core-service.hibernateAgent` | yes | yes | yes |
| `GET /api/sessions` (client poll, ~10 s) | no | no | **yes** — the accidental writer |

**NEXT ACTION.** Give `createSession` the registry write it never had, and collapse
the duplicate writer (`updateAgentSessionInRegistry`) onto the registry's own locked
primitives. Then re-run the boot-restore E2E (create → `pm2 stop` → `tmux
kill-session` → `pm2 start` → assert restored).

---

## Problem

`restoreActiveAgentsOnBoot` selects `agents.filter(a => a.status === 'active')`. That
field is a **cache of tmux truth**, and the operation that *creates* a session —
`sessions-service.createSession`, which is what `CreateAgent` G09 calls when
`createSession: true` — never writes it. The cache is repaired only when some client
happens to `GET /api/sessions`.

Three consequences, in increasing severity:

1. **Headless mode restores nothing, ever.** `MAESTRO_MODE=headless` is a supported
   mode with no UI; nothing polls `/api/sessions`; the registry therefore never
   learns any agent is running; `status` stays `offline`; a restart resurrects
   nothing. The dashboard's 10 s poll is load-bearing infrastructure that headless
   mode does not have.
2. **Full mode restores a lottery.** An agent created via the API and restarted
   before the next poll (or with no browser tab open) is equally invisible.
3. **The mirror image is worse than the miss.** Hibernate *does* write the registry —
   but if a hibernate ever lands without its write reaching disk, the stale `active`
   makes boot-restore **wake an agent the user deliberately put to sleep**. A cache
   that only a reader repairs is wrong in both directions.

This is the defect the owner asked to be eliminated before migrating development
into ai-maestro: *one restart and the fleet is down, with no automatic recovery.*

## Root cause

Two writers exist for one fact, and the authoritative one is not called at the
moment the fact changes.

- `lib/agent-registry.ts::linkSession` / `unlinkSession` — the real primitives.
  Locked (`withLock('agents')`, MF-003), cache-invalidating, index-aware.
- `services/agents-core-service.ts::updateAgentSessionInRegistry` — a private,
  **unlocked** re-implementation of exactly the same two transitions
  (`loadAgents()` → mutate → `saveAgents()` with no lock), used only by
  wake/hibernate. Concurrent with the poll's locked `linkSession`, its
  read-modify-write can lose an update.
- `sessions-service.createSession` — writes `sessions.json` and calls **neither**.

The lesson is the general one: *the only writer of a cache must not be a read
path.* A `GET` that silently repairs state hides the missing write until the day
nobody calls the `GET`.

## Proposed fix

One writer, at the point of mutation.

1. `lib/agent-registry.ts::linkSession(agentId, sessionName, workingDirectory, opts?)`
   — gains the single capability the duplicate had and it lacked:
   `opts.incrementLaunch`.
2. `services/agents-core-service.ts` — **delete** `updateAgentSessionInRegistry`;
   wake calls `linkSession` (with `incrementLaunch` on the fresh-session path),
   hibernate calls `unlinkSession(agentId, sessionIndex)`. Same semantics, now under
   the lock.
3. `services/sessions-service.ts::createSession` — after the tmux session exists and
   `persistSession` has run, call `linkSession(...)`. This is the write that never
   existed, and the one that makes boot-restore work at all.

Deliberately NOT done here: `launchCount` is not incremented by `createSession`,
because the R17-TRUST first-launch branch further down the same function keys on
`launchCount === 0` and the registry's mtime cache hands back the *same object* the
function is holding — incrementing would silently suppress the trust auto-accept for
every wizard-created agent. Preserving the existing counter semantics is the fix's
job; changing them is not.

## Verification

- Unit (TDD): `createSession` marks the agent online in the registry; wake links
  (and increments `launchCount` only on the fresh-session path); hibernate unlinks;
  the already-running wake path still links without double-counting a launch.
- E2E on a live server: create an agent with `createSession: true`, assert
  `status=active` **without** ever calling `/api/sessions`; then `pm2 stop` → `tmux
  kill-session` → `pm2 start` → assert boot-restore brought the session back.
- Gates: `npx tsc --noEmit` 0 errors; `bash scripts/with-node.sh yarn test`;
  `bash scripts/with-node.sh yarn build`.

## Estimated risk

LOW-MEDIUM. The change is small and removes code rather than adding a mechanism, but
it touches the wake/hibernate write path used by every agent. The two behaviours that
must not drift are `launchCount` (see above) and the offline-when-no-online-session
derivation, both of which `unlinkSession` already implements identically.

## Approval log

- 2026-07-11T15:42:59+0200 — MANDATE issued by self (min-approval-requirement: none).
  Pre-approved: a Tier-0 bugfix inside the agent's own assignment scope. No approval
  request was sent.

## Notes and lessons learned
