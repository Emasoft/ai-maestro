---
trdd-id: OHCZHBQ2
title: An agent that is not 100 percent valid must stay hibernated — one validity gate, not N special cases
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T20:46:07+0200
updated: 2026-08-05T20:58:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
priority: 1
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
effort: large
relevant-rules: [9, 17, 20]
labels: [governance, validity, hibernation, user-mandate]
external-refs: [Emasoft/ai-maestro#122]
---

# An agent that is not 100 percent valid must stay hibernated — one validity gate, not N special cases

## The directive

USER, 2026-08-05, in two parts. First:

> an agent with no title cannot exist. it must be automatically kept hibernated until someone
> assign a title to it.

Then, generalising it:

> i remember to have added the rule that any agent with ANY invalid configuration must be
> automatically kept hibernated until it is configured with valid settings and plugins. only when
> it is valid at 100% it can be dehibernated. there are many things that can make an agent invalid.
> so for example an agent with AUTONOMOUS title but assigned to a TEAM. that is invalid. so it must
> stay hibernated. but there are hundreds.. missing role-plugin, missing name, missing core plugin,
> missing workdir or invalid workdir, missing rule files, missing ai client, wrong cli arguments,
> invalid AID, etc.

## ⚠ THE RECOLLECTION IS HALF-RIGHT, AND THE HALF THAT IS MISSING IS THE WHOLE CARD

Measured 2026-08-05 before designing anything. **The PATTERN exists and is shipped — three times,
as three unrelated rules, each with its own flag, its own gate and its own wording. The GENERAL
rule does not exist anywhere.**

| condition | rule | mechanism |
|---|---|---|
| missing **role-plugin** | **R9.13** (`GOVERNANCE-RULES.md:485`) | FAAF: persist `roleMissing: true`, hibernate, and `wakeAgent` refuses until a plugin is assigned. *"Quarantined-and-inert is a valid state; role-less-and-runnable is not."* |
| missing **core plugin** | **R20.3** (`:855`) | "Agents missing the core plugin MUST be forced to hibernate until they comply." |
| **team agent, no MANAGER** | **R9.4** (`governance-spec.md:440`) | teams blocked ⇒ member tmux sessions killed; cannot be woken until a MANAGER is assigned |

Searches that returned **zero**: `"invalid configuration"` in `GOVERNANCE-RULES.md`; any rule
heading matching hibernate/valid; any validity predicate or condition enumeration in the spec.

So there is no umbrella rule, no `isAgentValid()`, no shared flag, and no list of what "valid"
means. What exists is the same good idea implemented three times by three cards that did not know
about each other — which is exactly why a fourth condition (no title) went unhandled and produced
the incident in #122, and why the USER remembers a general rule that was never written.

**That reframes this card.** It is not "add a hibernate-if-untitled check". It is: **promote a
proven pattern to a first-class VALIDITY GATE with one predicate, one flag, one refusal, and one
clearing path — then move the three existing cases onto it.**

## The conditions the USER named (starting set, explicitly not exhaustive)

no governance title · AUTONOMOUS title **but assigned to a team** · missing role-plugin · missing
core plugin · missing name · missing or invalid workdir · missing rule files · missing AI client ·
wrong CLI arguments · invalid AID.

Two of these are already enforced (role-plugin, core plugin). One — **AUTONOMOUS-in-a-team** — is
the interesting one: `element-management-service.ts:9688` has `NON_TEAM_TITLES = {autonomous,
manager, maintainer, ''}` used for FOLDER placement, so the codebase already knows autonomous is a
non-team title, but nothing derives *invalidity* from an autonomous agent sitting in `agentIds[]`.

## What must be decided before building — do NOT guess these

1. **One predicate, one flag.** `roleMissing` is the shipped precedent and its lesson is recorded
   in R9.13: a flag only ever set true never clears and bricks the agent forever. The clearing
   write is not an optimisation. Whatever replaces/absorbs it needs the same discipline, plus a
   REASON (which condition failed) or the UI can only say "invalid".
2. **Refuse the WAKE; do not force-stop a live session.** Fail toward the recoverable, visible
   failure. Force-hibernating an agent the USER is mid-conversation with is a worse outcome than a
   delayed refusal.
3. **Gate the SERVICE, mirror at the route.** The headless router calls services directly, so a
   route-only gate is bypassable in headless — the SF4 finding, recorded on TRDD-47a35ba2. R9.13's
   own site is `wakeAgent`, which is the correct altitude; copy it.
4. **Grandfathering, and it is not optional.** The two untitled agents on this host
   (`claude-skills-factory`, `libs-svg-svgbbox` — from #122's fleet table) are the USER's own
   PRE-FORK agents under `~/Code/*`. A blanket sweep is either a no-op (they are already
   hibernated) or a fleet-wide stop, depending on state nobody has measured. Measure, then decide
   whether the gate is retroactive or applies from a boundary date.
5. **"Hundreds" is a spec problem, not a coding problem.** The value is in the ENUMERATION and its
   severity split — which conditions are hard-invalid (refuse the wake) versus advisory (warn).
   Wiring a predicate takes an afternoon; deciding the condition list is the actual work, and it
   is USER-tier because each entry can stop an agent from starting.
6. **Do not let it become a fourth special case.** If this ships without moving R9.13 / R20.3 /
   R9.4 onto the shared gate, the result is four implementations instead of three.

## Acceptance criteria

Added 2026-08-05T21:47 — the card shipped with NO checklist at all, which makes the terminal-column
gate **vacuous on it**: that gate is written only over boxes that are unchecked, so a card with zero
boxes satisfies it having proven nothing, and could be closed while none of the work below existed.
(Exactly the defect TRDD-9QV4ZCYY fixed in the gate's own wording; this is the same hole seen from
the card side.) The boxes are transcribed from this card's own Verification and decision sections —
none is invented, and none of them is guessed.

- [ ] **The condition list is enumerated and USER-signed-off**, with each entry marked HARD-INVALID
      (refuse the wake) or ADVISORY (warn only). This gates every box below it — per "Estimated
      risk", a predicate that is wrong or too eager hibernates a working fleet, so the enumeration
      is USER-tier and must not be guessed.
- [ ] One predicate, one flag, one REASON — the flag CLEARS when the condition is fixed (R9.13's
      recorded lesson: a flag only ever set true bricks the agent forever).
- [ ] The gate lives in the SERVICE (`wakeAgent`'s altitude), mirrored at the route — a route-only
      gate is bypassable in headless (the SF4 finding).
- [ ] It REFUSES THE WAKE and never force-stops a live session.
- [ ] Grandfathering measured, not assumed: the pre-fork `~/Code/*` agents are checked for actual
      state before deciding retroactive-vs-boundary-date.
- [ ] R9.13, R20.3 and R9.4 are MOVED onto the shared gate — shipping without this yields four
      implementations instead of three, which is the failure this card exists to end.
- [ ] Both directions pinned with a recorded neuter: a failing agent cannot reach a running session
      by ANY path, the refusal names WHICH condition failed, and fixing it makes the agent wakeable
      in the same session with no restart.

## Verification

An agent failing ANY enumerated condition cannot reach a running session by any path (route or
headless service); the refusal names WHICH condition failed; fixing that condition makes it
wakeable in the same session with no restart; and the three existing cases route through the new
gate rather than their own. Both directions pinned, neuter recorded.

## Estimated risk

HIGH — not technically, but in blast radius: this can stop every agent on a host. The failure to
design against is not under-blocking, it is a predicate that is wrong or too eager and hibernates a
working fleet. That is why the wake-refusal (recoverable) is preferred over force-stop, and why the
condition list needs the USER's sign-off before it gates anything.

## Approval log

- 2026-08-05T20:46:07+0200 — MANDATE issued by USER (untitled-agent form). Queued rather than
  executed inline; the in-flight work was the #121-125 implementation.
- 2026-08-05T20:58:00+0200 — GENERALISED by the USER's follow-up to any invalid configuration, and
  re-scoped after measuring that the general rule does not exist while three per-condition
  instances do. Still a USER mandate; the condition ENUMERATION is called out above as needing
  explicit USER sign-off before it gates anything, because each entry can stop an agent starting.
