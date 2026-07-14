---
trdd-id: D5XDT49I
title: An agent's launch string must carry its client's resume flag so a restart resumes the conversation
column: proposal
created: 2026-07-14T15:11:49+0200
updated: 2026-07-14T15:11:49+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: bugfix
min-approval-requirement: manager
approved: false
priority: 1
severity: high
effort: small
release-via: none
relevant-rules: [17, 18]
labels: [agents, lifecycle, launch, wake, restart]
blocks: [SB5I53K1]
---

# An agent's launch string must carry its client's resume flag so a restart resumes the conversation

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**The capability EXISTS and is UNREACHABLE.** Nothing here needs to be invented; something
here needs to be *wired*, and one composition question needs to be *answered empirically*
before it is.

- **NEXT ACTION:** answer the open question below (does `claude --continue` compose with
  `--agent <persona>-main-agent`?) by launching ONE agent by hand with both flags. Everything
  else follows from that answer.
- **Do NOT** blanket-append `--continue` to every agent's `programArgs` until that is known —
  see "Why this is not a one-line fix".

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
