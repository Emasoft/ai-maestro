---
trdd-id: 35VKIGTC
title: Refuse to wake an agent whose auto-loaded context is poisoned
column: design
scope: project
project-id: ai-maestro
created: 2026-08-02T11:35:49+0200
updated: 2026-08-25T17:28:11+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T11:35:49+0200
derived: false
severity: high
effort: small
relevant-rules: [R17]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [security, prompt-injection, wake-gate, cross-repo]
external-refs: [Emasoft/ai-maestro-janitor#167]
---

# Refuse to wake an agent whose auto-loaded context is poisoned

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-05

**THE PRECONDITION THIS CARD SET FOR ITSELF HAS BEEN MEASURED, AND IT FAILS. DO NOT BUILD THE
GATE.** The body's "⚠ The architectural finding that decides whether this is worth building" says
to confirm the janitor's scan is **fleet-scoped** before building, and that if it can only scan its
own session's workdir the card "buys one wake of delay and should be re-scoped rather than
shipped". Measured 2026-08-05, first-hand:

| question | answer | evidence |
|---|---|---|
| what roots does the detector walk? | **exactly one — the current session's project** | `scripts/detectors/ai-context-poisoning.py:307` → `project_root = state.project_root()`; `state.py:135` resolves a single dir, and `janitor_root()` is `project_root()/.janitor` (per-project state) |
| does it enumerate the agent registry? | **no** | grep over `scripts/detectors/` for `registry.json` returns exactly ONE file, `gh-reply-watch.py` — which is also the positive control proving the search works |
| does the live behaviour agree? | **yes** | this session's own heartbeat reported 17 patterns in 7 files, every path under `/Users/emanuelesabetta/ai-maestro` — its own project, no other workdir |

So a flag would be written by a janitor running INSIDE the agent's own session, which — in the
body's own words — "blocks the NEXT wake, not this one", by which time the poisoned instructions
are already in the context window. Shipping it "while the janitor believes it got the launch gate
would be the worst outcome available here."

**Moved `todo → backburner`,** which is an honest resting state rather than a lie: the work is not
ready and nothing local blocks it, so `blocked` would be wrong too (that requires a non-empty
`blocked-by:` naming an open card, and the missing capability is not a card in this repo).

> **⏹ 2026-08-21T17:0x — THE ROUTE NAMED BELOW NO LONGER EXISTS. The parking still does.**
> `Emasoft/ai-maestro-janitor#167` is **CLOSED**, so *"continuing the existing thread at
> janitor#167"* is not available — a new issue would be needed. **Both reasons to wait are
> untouched by that**, and neither depends on the issue's state: the fleet-scoped scan is still a
> capability that repo does not have, and the detector's precision is still inadequate. That second
> reason was re-measured independently since: the advisory settled at **18 findings / 8 files** with
> all five named hits verified FALSE — each one a rule *forbidding* the pattern it is accused of
> performing. So `backburner` remains the honest column; only the ROUTE changed.
>
> **A stale external ref is invisible in exactly the way this card's parent card
> (`TRDD-5YRLA53W`) complains about:** an external blocker is checked once and never again, because
> nothing on the board can express it. `external-refs:` still points at #167 and nothing reddens.

**WHAT WOULD UNBLOCK IT:** the janitor gaining a fleet-scoped context scan — walking every
*registered* workdir, including hibernated agents — so a poisoned agent is flagged while it is not
running and the gate refuses its next launch. That capability lives in
**`Emasoft/ai-maestro-janitor`**, a repo I may not edit; per the cross-project rule the route is an
issue (or a fork+PR) on their tracker, continuing the existing thread at janitor#167. **That ask
has NOT been filed — it needs the USER's word, because it is a cross-repo write.**

**A SECOND, INDEPENDENT REASON TO WAIT — the detector's precision is not yet good enough to gate a
launch on.** All 5 findings it raised against this repo on 2026-08-05 are FALSE POSITIVES, and they
share one nameable defect: it does not distinguish *prohibitive* from *directive* framing. Every
cited line is a rule RESTRAINING an agent, matched by a detector hunting rules DIRECTING one —
`scenario-runner.md:54` / `SCENARIOS_TESTS_RULES.md:47` ("you have BECOME the system", the rule
FORBIDDING the runner from puppeting the fleet), `:101`/`:112` (rows of a diagnostics TABLE), and
`:145` (a safety BLACKLIST). Provenance on all of them is our own commits. A gate that bricks an
agent's launch on this signal would refuse to start agents over their own safety documentation.
That precision problem belongs upstream with the detector, and it must be fixed BEFORE, not after,
any enforcement is wired to it.

## Why this exists

`ai-maestro-janitor#167` measured that of the three ways an agent's context gets poisoned, two are
covered automatically and the third — **a context file that arrives already poisoned** via
`git clone`, `git pull`, a merged PR, or a PROJECT-scope memory page — is covered only if a human
remembers to run a skill. `CLAUDE.md` is auto-loaded into every session, so that vector needs no
execution, no postinstall, and no MCP server.

The janitor asked two questions and I ruled on both
([comment](https://github.com/Emasoft/ai-maestro-janitor/issues/167#issuecomment-5156888881)):

- **Detection stays with the janitor.** It already owns the rule engine (`agent_config_patterns.scan_text`),
  the fixture-skipping discipline, and the drift-line sanitizer. A second scanner is a second thing
  to drift.
- **Enforcement is ours**, because only the server sees a wake and can refuse one.

## The precedent this copies — verified, 2026-08-02

`corePluginMissing` (R17) is the same shape, already shipping. Every site measured:

| role | site |
|---|---|
| field on the agent record | `types/agent.ts:262` |
| field on the update request | `types/agent.ts:567` — **both are required**; without the second the flag cannot be written |
| SET (and CLEARED) | `services/element-management-service.ts:1384` — PG02, `corePluginMissing = shouldBeMissing` |
| stale-flag clear | `services/agents-core-service.ts:2005` — cleared when the plugin is found present |
| refusal — route | `app/api/agents/[id]/wake/route.ts:65` → 409 `role_missing_core` + `profileDeepLink` |
| refusal — service | inside `wakeAgent` (`services/agents-core-service.ts`, see the comment at `:2089`) |
| user-visible surface | `components/AgentBadge.tsx:281` |

Three details of that precedent are load-bearing and were each learned from a defect:

1. **PG02 runs on BOTH verdicts.** A flag that is only ever set `true` never clears, and the agent
   is bricked forever with no path back. The clearing write is not an optimisation.
2. **The gate exists twice — route AND service.** The headless router calls the service directly
   (`services/headless-router.ts`), so a route-only gate is bypassable in headless mode. This is
   exactly the SF4 finding recorded on TRDD-47a35ba2: the audit assumed both R9.13 and R17 lived in
   the service and only the R17 half was true.
3. **A refusal with no UI surface is a bricked agent with no explanation.** The badge is part of
   the feature, not polish.

## ⚠ The architectural finding that decides whether this is worth building

**A flag set by a janitor running INSIDE the agent's own session blocks the NEXT wake, not this
one** — by the time that heartbeat fires, the poisoned instructions are already in the context
window. That is the weaker "detection-after-load" outcome janitor#167 explicitly set out to beat,
and shipping it while the janitor believes it got the launch gate would be the worst outcome
available here.

It is only the stronger thing if the scan is **fleet-scoped from a live session** — the janitor's
`#J` thin mode scanning every *registered workdir*, including agents that are hibernated — so a
poisoned agent is flagged while it is not running and the gate refuses its next launch. Confirm
that is the mode before building the gate; if the janitor can only scan its own session's workdir,
this card buys one wake of delay and should be re-scoped rather than shipped.

## Scope

1. `contextPoisoned?: boolean` (+ a `contextPoisonedReason?: string` carrying a **sanitized**
   summary — never raw attacker text, which would re-inject at the moment the UI or an agent reads
   it) on **both** types in `types/agent.ts`.
2. A write path that honours the decoupling invariant: the janitor is a plugin and MUST NOT call
   the API. **RESOLVED — see "DESIGN CHANGED" at the foot of this card: a FILE
   (`~/.aimaestro/context-integrity.json`), not a CLI verb.** The original text here proposed adding
   a `flag` verb to `aimaestro-agent.sh` and is kept struck rather than deleted, because the reason
   it failed is the useful part: the verb had no way to express its own authorization rule.
3. The refusal at **both** gates (route + service), returning 409 with a distinct `error` code and
   a `profileDeepLink`, mirroring `role_missing_core`.
4. A clear path — the flag must be clearable, or a false positive is unrecoverable without hand-editing
   the registry.
5. The badge surface.

## Verification

- Unit: a wake of an agent with `contextPoisoned: true` returns 409 with the distinct code.
  **Neuter: delete the route gate → this test reds.**
- Unit: the same wake through the **headless** path is also refused. **Neuter: delete the service
  gate → this test reds and the route test does NOT** (that is what proves the two gates are
  independent rather than one gate tested twice).
- Unit: clearing the flag restores wakeability. Without this the feature has no exit.
- Unit: a `contextPoisonedReason` containing a marker-shaped string (`[janitor-self-disarm]`)
  arrives defanged at the API surface — the reason field is read by a model.

## Acceptance

- [ ] the fleet-scoped-scan question above is answered before any code lands (a session-scoped scan
      makes this card the weaker design, not the stronger one)
- [ ] `contextPoisoned` + sanitized reason on both types in `types/agent.ts`
- [x] ~~a CLI write path with a decided authorization rule~~ — **SUPERSEDED, and the reasoning is the deliverable.** A flag that refuses a wake is a DoS primitive, so the verb needed an answer to "who may set this on whom", and all three were bad: self-only is useless (a poisoned agent flagging itself is already too late), any-agent-on-any is a fleet-wide brick button, and "only the janitor's detector" needs a caller identity **the scripts do not carry** — the janitor is a plugin in a session, with no AID. The verb could not express the one rule that would make it safe. Replaced by a FILE the janitor writes and the server reads (`~/.aimaestro/context-integrity.json`), which is `server-liveness.json` inverted — a proven boundary between exactly these two components. No caller ⇒ no authorization question; absent/stale file ⇒ no findings ⇒ no gate ⇒ fail-safe.
- [ ] refusal at BOTH the route and the service, pinned by two tests that fall to different neuters
- [ ] the flag is clearable, pinned by a test
- [ ] `AgentBadge` surfaces it
- [ ] tests + at least 2 neuters recorded BY NAME; `tsc` 0; full suite green

## Approval log

- 2026-08-02T11:35:49+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Tier 0 self-mandate: wholly inside this agent's own assignment scope, no baseline deviation, no
  cross-team reach. No approval request was sent.

## DESIGN CHANGED 2026-08-02T13:06:10+0200 — the write path is a FILE, not a CLI verb

Posted to janitor#167 (comment 5157392467) so both repos build the same thing.

`~/.aimaestro/context-integrity.json` — janitor WRITES, server READS:
`{ ts, findings: [{ workdir, rule, severity, detail }] }`. Freshness handled like liveness: a
stale file is IGNORED, so a dead janitor cannot brick the fleet by leaving a finding behind.
`detail` is sanitized at the JANITOR's emit site, where the rule already lives — the server never
handles raw attacker text.

This also settles the iron-rule tension that produced janitor#168: their "reported direct API calls"
were a **refusal** to bypass this very gap, not a violation. The fix is not to hand them a bypass.

**STILL BLOCKING, asked three times on #167:** does `#J` scan every registered workdir FLEET-WIDE
(hibernated included), or only its own session's workdir? Fleet-wide ⇒ the gate refuses the poisoned
LAUNCH. Session-scoped ⇒ it blocks the NEXT wake only, which is the detection-after-load outcome the
issue exists to beat — still worth having, but neither side may then call it the launch gate.
