---
trdd-id: 35VKIGTC
title: Refuse to wake an agent whose auto-loaded context is poisoned
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T11:35:49+0200
updated: 2026-08-02T11:35:49+0200
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
   the API. There is no `flag` verb on `aimaestro-agent.sh` today (verbs are list/show/config/
   resolve/create/delete/update/rename/session/hibernate/wake/restart/skill/plugin/export/import/
   presence), so one is needed. **Decide the authorization before the verb:** a flag that bricks an
   agent is a denial-of-service primitive if any agent can set it on any other.
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
- [ ] a CLI write path with a decided authorization rule, not an inherited one
- [ ] refusal at BOTH the route and the service, pinned by two tests that fall to different neuters
- [ ] the flag is clearable, pinned by a test
- [ ] `AgentBadge` surfaces it
- [ ] tests + at least 2 neuters recorded BY NAME; `tsc` 0; full suite green

## Approval log

- 2026-08-02T11:35:49+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Tier 0 self-mandate: wholly inside this agent's own assignment scope, no baseline deviation, no
  cross-team reach. No approval request was sent.
