---
trdd-id: OHCZHBQ2
title: An agent with no governance title cannot be active — auto-hibernate until one is assigned
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T20:46:07+0200
updated: 2026-08-05T20:46:07+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T20:46:07+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
severity: high
effort: medium
relevant-rules: []
labels: [governance, titles, hibernation, user-mandate]
external-refs: [Emasoft/ai-maestro#122]
---

# An agent with no governance title cannot be active — auto-hibernate until one is assigned

## The directive

USER, 2026-08-05T20:46, verbatim:

> an agent with no title cannot exist. it must be automatically kept hibernated until someone
> assign a title to it.

Queued rather than executed inline: it arrived mid-implementation of the five MANAGER-filed cards
(#121-125) and is a NEW governance invariant, not part of any of them. Filed immediately so the
handoff is a card and not a sentence in a transcript.

## Why it belongs beside TRDD-4Z62YRDG

That card (ai-maestro#122) removed the two places where an absent `governanceTitle` silently
resolved to the MESSAGING `role` — which defaults to `'autonomous'`. Before that fix, an untitled
agent *looked* titled: the profile panel rendered it AUTONOMOUS and the team composition check
carried `'autonomous'` as its title. After it, an untitled agent correctly reads as **untitled**.

This directive is the next question that exposes: if the fleet can now SEE untitled agents, what
should happen to one? The USER's answer is that it should not be running at all.

Measured on this host 2026-08-05 — untitled agents are not hypothetical:

| agent | governanceTitle | role |
|---|---|---|
| `claude-skills-factory` | **(none)** | `autonomous` |
| `libs-svg-svgbbox` | (none) | (none) |

(from ai-maestro#122's own fleet table). Note these are the USER's own pre-fork agents under
`~/Code/*`, which is exactly why the rollout question below is not optional.

## What must be decided before building — do NOT guess these

1. **Scope: which agents?** The pre-fork agents above predate governance entirely and are already
   hibernated. A blanket sweep that hibernates every untitled agent is either a no-op or a
   fleet-wide stop, depending on state nobody has measured yet. Measure first.
2. **The trigger set.** At minimum: creation without a title, and title REMOVAL on a live agent.
   Title removal is the sharp one — `ChangeTitle` demoting to no-title would have to hibernate the
   agent it just demoted, and that interacts with the R51 transaction work.
3. **The wake gate.** `app/api/agents/[id]/wake/route.ts:55` already reads
   `governanceTitle ?? null` into its context, so a refusal has a natural home there — and the
   `corePluginMissing` / `role_missing_core` 409 is the shipped PRECEDENT for exactly this shape
   (refuse the wake, name the reason, deep-link the fix). Copy it rather than inventing one.
4. **Both modes.** The headless router calls services directly, so a route-only gate is bypassable
   in headless — the SF4 finding. Gate the SERVICE, mirror at the route.
5. **A path back.** Whatever refuses must be clearable by assigning a title, and the clearing write
   must exist, or an agent is bricked with no route out. That is the `corePluginMissing` lesson:
   a flag only ever set true never clears.

## Verification

An untitled agent cannot reach a running session by ANY path (route or headless service), assigning
a title makes it wakeable in the same session with no restart, and the refusal names the reason.
Both directions pinned, with a neuter recorded.

## Estimated risk

MEDIUM. The failure mode to design against is not "we hibernated too little" — it is hibernating an
agent the USER is mid-conversation with, or bricking one with no path back. Fail toward refusing the
WAKE (recoverable, visible) rather than force-stopping a live session.

## Approval log

- 2026-08-05T20:46:07+0200 — MANDATE issued by USER, verbatim above. Pre-approved: issuer authority
  >= required approver. Queued (not executed inline) because the in-flight work is the #121-125
  implementation; recorded per the rule that a new directive is queued or forked, never left
  unqueued.
