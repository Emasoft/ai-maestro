---
trdd-id: 6AMXSG3S
title: A session restart must preserve the agent's conversation — today it silently destroys the in-flight mandate
column: complete
created: 2026-07-23T16:37:05+0200
updated: 2026-08-01T22:50:24+0200
current-owner: ai-maestro-dev-session
task-type: bugfix
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
severity: critical
effort: small
release-via: none
relevant-rules: []
labels: [continuity, scen-031, harness-readiness]
implementation-commits: [98f04d99]
---

# Restart must preserve the conversation

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-23

- **Verified defect.** Both restart routes (`/api/sessions/[id]/restart` and
  `/api/sessions/me/restart`) build their relaunch command with
  `buildRelaunchCommand()` (`lib/session-restart.ts:103`), which guarantees only
  `--name "<persona>"`. Neither passes `--continue` nor `--resume`. A restart is
  therefore a **cold start**: the agent's conversation — and the mandate it was
  executing — is gone.
- **NEXT ACTION:** implement the fix below (helper → builder param → both call
  sites → test), then re-run SCEN-031 phase 2.
- **Do NOT** add `--continue` unconditionally: it is a Claude flag, and it fails
  when no prior conversation exists.

## Problem

Observed live during SCEN-031 phase 2 (2026-07-23). The scenario runner applied a
legitimate Rule-4 fix (`bb60bcf2`, serializing `claude plugin install`) and restarted
`scen031-manager` to pick it up. The MANAGER came back on a **fresh session showing the
splash screen at an empty prompt**, with no memory of the mandate it had been executing.
With the MANAGER no longer driving, the whole fleet went idle:

```
scen031-manager   → splash screen, empty ❯          (recreated 16:30:57)
zipsearcher-dev   → Q: "Read" — target unclear.  ✻ idle
zipsearcher-maint → splash screen, empty ❯
```

The fleet had been working correctly up to that point (phase 1 PASS; PRRD + v1.0.0
mandates landed on `Emasoft/zipsearcher` `main`). The restart, not the fleet, ended the run.

## Root cause

`buildRelaunchCommand(bin, programArgs, personaName)` injects `--name` and nothing else.
`claude --agent <persona>` with no `--continue` starts a new conversation.
`app/api/sessions/[id]/restart/route.ts` documents the relaunch as
`claude --agent my-plugin-main-agent` — cold by construction.

The mechanism is already understood elsewhere in the codebase: the DeleteAgent
history-purge comment (`services/element-management-service.ts:6666`) notes that
"`claude --continue` / `--resume` look up by workdir slug" — the lookup key exists and
is derivable; the restart path simply never uses it.

## Blast radius — wider than the scenario

Restarts are not a rare manual action. They are fired automatically:

- `hooks/useRestartQueue.ts` — queues a restart after **any plugin/skill/element change**
- `services/element-management-service.ts` — element pipelines mark restart-needed
- `components/AgentProfile.tsx` — the manual Restart button
- `app/api/sessions/me/restart` — an agent restarting itself

So **every plugin install on a working agent silently destroys its in-flight work**. The
UI presents restart as "pick up the new config", and the user has no signal that the task
was discarded.

## Proposed fix

1. **`lib/claude-conversation.ts` (new, small)** — one source of truth for the lookup key:
   - `conversationSlug(absDir: string): string`
   - `hasPriorConversation(absDir: string): Promise<boolean>` — the slug dir exists and
     holds ≥1 `.jsonl`.
   Two ad-hoc slug derivations already exist (`element-management-service.ts:6688`,
   `agents-chat-service.ts:56`); they agree today. Do not add a third — this helper is
   the place they should converge on.
2. **`buildRelaunchCommand(..., opts?: { continueConversation?: boolean })`** — append
   `--continue` when asked, guarded exactly like the existing `--name` guard (skip when
   `--continue` or `-c` is already present).
3. **Both restart routes** — compute the flag from the agent's resolved workdir and pass it.
4. **Claude-only.** `resolveRestartBin` also returns `codex`/`gemini`; `--continue` is a
   Claude flag. Gate on `bin === 'claude'`.

## Verification

- Unit test: builder appends `--continue` when asked, is idempotent against an existing
  `--continue`/`-c`, and never emits it for a non-claude bin.
- Unit test: `hasPriorConversation` false for a missing dir / empty dir, true with a `.jsonl`.
- Live: restart an agent mid-task; it comes back **on its prior conversation**, not a splash.
- Then: re-run SCEN-031 phase 2 and confirm a Rule-4 restart no longer ends the run.

## Estimated risk

LOW–MEDIUM. Additive and behind an existence check, so an agent with no prior conversation
relaunches exactly as today. The real risk is the opposite of the bug: resuming a very long
conversation costs tokens on relaunch. Accepted — losing the mandate costs the whole run.

## Acceptance
- [x] `lib/claude-conversation.ts` exists on disk (11907 bytes) as the single lookup-key source.
- [x] `buildRelaunchCommand` accepts `opts.continueConversation` and appends `--continue` guarded — re-verified live at `lib/session-restart.ts:145,158,164`.
- [x] Both restart routes are wired: `app/api/sessions/me/restart/route.ts:155,157` directly; `app/api/sessions/[id]/restart/route.ts` via the shared `lib/session-relaunch.ts:102,106` composition.
- [x] `tests/unit/restart-preserves-conversation.test.ts` exists on disk covering this card's own described behavior.

## Approval log

- 2026-07-23T16:37:05+0200 — MANDATE issued by self (min-approval-requirement: none).
  In-scope bugfix on this project's own source, reversible and local. No approval request sent.
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. `implementation-commits:` was left
  empty (bookkeeping gap) but commit 98f04d99 ("preserve the agent's conversation
  across a restart (TRDD-6AMXSG3S)") resolves and is verified live wired into both
  restart routes; STATE text still read "NEXT ACTION: implement the fix" — stale prose,
  code already shipped.
