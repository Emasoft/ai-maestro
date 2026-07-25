---
trdd-id: D5XDT49I
title: An agent's launch string must carry its client's resume flag so a restart resumes the conversation
column: complete
created: 2026-07-14T15:11:49+0200
updated: 2026-07-25T02:05:00+0200
current-owner: ai-maestro
created-by: claude-opus-session
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-25T02:05:00+0200
implementation-commits: [18aaf300, 9d71c3ef, c9bc48db]
priority: 1
severity: high
effort: small
release-via: none
relevant-rules: [17, 18]
labels: [agents, lifecycle, launch, wake, restart]
blocks: [SB5I53K1]
---

# An agent's launch string must carry its client's resume flag so a restart resumes the conversation

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-25

**DONE.** USER-mandated 2026-07-25 and implemented; the three blocking questions below are all
ANSWERED, two of them by measurement rather than reasoning. **NEXT ACTION: none.**

**Q1 — does `--continue` compose with `--agent`? YES, observed live.** The 01:24 boot-restore
launched `claude --dangerously-skip-permissions --chrome --add-dir /tmp --agent
ai-maestro-autonomous-agent-main-agent --continue` (pid 39895) and the client came up resumed. No
`--resume <session-id>` pinning is needed.

**Q2 — the `else if` bug was real and is fixed.** Asking to resume dropped
`--dangerously-skip-permissions`, silently changing the permission posture of every resumed agent
on the one path nobody watches. Both flags are now emitted; kiro's shared `chat` prefix is resolved
by dropping the duplicate TOKEN, never the flag.

**Q3 — the flag lives in the LAUNCH BUILDER, not `programArgs`.** No migration, and the
"first launch has nothing to resume" case is answered structurally: `CreateAgent` launches via
`createSession`, which has no resume concept at all, so a brand-new agent is cold BY CONSTRUCTION.
Every other launch resumes by default.

**What the proposal did NOT anticipate, found by reading each CLI's own `--help`:**

| client | resume-LAST (used) | PICKER — must never be used |
|---|---|---|
| claude | `-c, --continue` | `-r, --resume` (no value) |
| codex | `resume --last` | `resume` (bare — "picker by default") |
| gemini | `-r latest` | `-r <index>`, `--list-sessions` |
| kiro-cli | `chat --resume` | `chat --resume-picker`, `--resume-id` |
| opencode | `-c, --continue` | `-s/--session <id>` |

Kiro's `--resume` means resume-LAST while Claude's means PICKER — so the verb's name cannot be
reasoned from. A picker in an unattended pane wedges the agent at a menu forever while it looks
healthy, which is worse than not resuming; `isPickerVerb()` plus a guard test now fail the build if
one is ever configured. **opencode's verb was `''`** ("no resume flag documented") — never checked,
which had quietly made it the only client that always cold-started.

Placement also mattered: appending the verb yields `codex --profile x resume --last`, which does
not run. `composeLaunchWithResume()` puts it immediately after the binary — the one position
correct for both flag and subcommand forms.

## Problem

**No agent is launched with a resume flag, so every wake and every restart starts a FRESH
conversation and silently drops the agent's thread.**

Verified 2026-07-14 against the live registry (`~/.aimaestro/agents/registry.json`) — not one
of the four real agents carries `--continue`:

| agent | program | programArgs |
|---|---|---|
| `alexandre` | `claude` | `--agent ai-maestro-architect-agent-main-agent --name alexandre --chrome` |
| `jack-bot` | `claude-code` | `--agent ai-maestro-assistant-manager-agent-main-agent --name jack-bot` |
| `genny-bot` | `claude-code` | `--agent genny-bot-main-agent --name genny-bot` |
| `ecos-chief-of-staff-one` | `claude-code` | `--dangerously-skip-permissions --chrome --add-dir /tmp --agent ai-maestro-autonomous-agent-main-agent` |

This is not a latent risk — it fired today. The USER stopped the fleet to pick up a changed
`settings.json`; all four agents lost their conversations, recoverable only by hand.

## Root cause — built, and never called

`lib/client-capabilities.ts` already declares a per-client resume flag:

```ts
claude:   { resume: '--continue' }
codex:    { resume: 'resume --last' }
kiro-cli: { resume: 'chat --resume' }
gemini:   { resume: '' }              // no resume flag documented
```

and `buildLaunchCommand(program, { resume: true })` (`lib/client-capabilities.ts:331`) would
emit it. But:

```console
$ grep -rn 'buildLaunchCommand' --include=*.ts --include=*.tsx --include=*.mjs .
lib/client-capabilities.ts:331:export function buildLaunchCommand(
```

**One reference — its own definition. Zero callers, not even a test.** The wake path
(`services/agents-core-service.ts:2219`) ignores the capability table entirely and builds the
command by concatenation:

```ts
let fullCommand = resolveStartCommand(program)
if (agent.programArgs) {
  const args = sanitizeArgs(agent.programArgs)
  if (args) fullCommand = `${startCommand} ${args}`
}
```

So the resume flag reaches a launch only if a human typed it into `programArgs` — and none did.
This is the sixth instance of the pattern in `[[agent-claims-the-api-was-never-delivered]]`:
the code is complete and 0% reachable.

## Why this is NOT a one-line fix

Three things must be settled before any wiring lands. Each is a real question, not a formality.

1. **THE OPEN QUESTION — does `--continue` compose with `--agent`?** Every agent launches with
   `--agent <persona>-main-agent`. `claude --continue` resumes the most recent conversation in
   the cwd. What happens when the resumed transcript was started under a *different* persona —
   or when `--agent` and `--continue` are passed together at all — is **not documented and not
   tested here.** If they conflict, the fix is not `--continue` but `--resume <session-id>`
   pinned to the agent's own last transcript. **Answer this empirically first.**

2. **`buildLaunchCommand`'s resume branch is itself buggy.** It is an `else if`:

   ```ts
   if (options?.resume && cli.resume)      parts.push(cli.resume)
   else if (cli.skipPermissions)           parts.push(cli.skipPermissions)
   ```

   so asking for resume **silently drops `--dangerously-skip-permissions`**. Adopting the
   function as-is would change the permission posture of every agent that carries that flag
   (e.g. `ecos-chief-of-staff-one`). Fix the branch before calling it, or do not call it.

3. **Where does the flag live — `programArgs` or the launch builder?** Two different
   contracts, and they are not equivalent:
   - **In `programArgs`** (per agent, persisted): user-visible and per-agent overridable, but
     it must then be backfilled into every existing agent's registry row, and a first-ever
     launch has no transcript to continue — `--continue` on a virgin workdir must degrade
     cleanly, not error.
   - **In the launch builder** (computed at wake time): one place, no migration, and the
     "first launch has no transcript" case can be detected. Requires the wake path to finally
     call `buildLaunchCommand`.

   The builder is almost certainly right — but it is a design call, not a mechanical one.

## Proposed change

1. Determine the `--continue` × `--agent` composition empirically (question 1).
2. Fix `buildLaunchCommand`'s `else if` so resume and skip-permissions coexist (question 2).
3. Have the wake path in `services/agents-core-service.ts` call `buildLaunchCommand(program,
   { agentName, resume: <transcript exists for this workdir>, extraArgs: agent.programArgs })`
   instead of string-concatenating.
4. Detect "no prior transcript" (an empty `~/.claude/projects/<slug>/`) and omit the resume
   flag on a first launch.
5. Non-Claude clients get their own flag from the capability table for free; `gemini`
   (`resume: ''`) correctly gets nothing.

## Verification

- Unit: `buildLaunchCommand` emits `--continue` AND keeps `--dangerously-skip-permissions`.
- Unit: a workdir with no transcript yields a command with no resume flag.
- **Live (the one that matters):** wake an agent, send it a message, restart it, and confirm
  it can answer a question about what was said *before* the restart. Anything short of that
  does not prove the conversation survived.
- A UI scenario covering stop → restart → thread-survives is deferred (USER, 2026-07-14). It
  belongs to the fleet-lifecycle TRDD this one BLOCKS — `TRDD-SB5I53K1`.

## Estimated risk

**MEDIUM.** The change touches the launch path of every agent on every wake — the highest
blast-radius code path in the product. Risk is dominated by question 1: if `--continue` and
`--agent` conflict, a naive fix makes every agent launch *wrong* rather than merely
forgetful. The `else if` bug (question 2) would silently strip a permission flag fleet-wide.
Both are cheap to check and expensive to miss.

## Approval log

- 2026-07-25T02:05:00+0200 — MANDATE issued by USER (min-approval-requirement: user). The USER
  directed the cross-client resume work verbatim ("the launch string should always include the
  command to resume/continue the last conversation, except ... creating a new agent from scratch"),
  which is the approval this proposal was waiting for. Born approved; implemented the same session.
- 2026-07-25T02:05:00+0200 — COMPLETED. Q1/Q2/Q3 answered (Q1 by live observation), all five
  clients' verbs verified against their own `--help`, picker guard added.
  Commits: 18aaf300, 9d71c3ef, c9bc48db.
