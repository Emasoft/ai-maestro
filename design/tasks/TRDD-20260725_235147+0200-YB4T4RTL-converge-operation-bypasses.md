---
trdd-id: YB4T4RTL
title: Converge the 37 non-AIO mutation sites onto their all-in-one functions
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-25T23:51:47+0200
updated: 2026-08-29T10:06:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-25T23:51:47+0200
relevant-rules: [R50]
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-25

USER first principle (2026-07-25): *"THERE MUST BE ONLY ONE FUNCTION FOR EACH OPERATION, AND THAT
FUNCTION MUST BE AN ALL-IN-ONE."* Codified as **R50** (GOVERNANCE-RULES v4.9.0).

An audit found **11 call sites performing agent operations outside their all-in-one**. Each skips
every gate the pipeline owns — cemetery archive, team-slot clearing, credential revocation, session
unpersist, the G10 post-condition. This is not theoretical: the `PersistedSession` row that outlived
every deleted agent and kept resurrecting its workdir (TRDD-KERM18NX) survived because one store had
no owner in the pipeline. A bypass reproduces that condition on purpose.

**The ratchet is already in place** — `tests/unit/all-in-one-single-path.test.ts` pins the set, so it
can only shrink and a NEW bypass fails the build. This TRDD is the convergence work itself.

## ⚠ SUPERSEDED COUNT — it is 37, not 11 (2026-07-26)

The original audit scanned ONE store. The ratchet's `PRIMITIVES`/`OWNERS` pair covered
`lib/agent-registry.ts` only, so **teams, groups, persisted sessions, tasks and governance tokens had
no guard at all** and **26 further sensitive-mutation sites were invisible**. Generalising the guard
to a per-store table (same scanner, same regex, `owners` kept minimal so no existing call site is
blessed) gives the real surface:

| store | sites | note |
|---|---|---|
| agent-registry | 11 | the original audit |
| team-registry | 9 | **3 are API ROUTES writing the store directly** |
| group-registry | 5 | no `ChangeGroup` pipeline exists |
| session-persistence | 5 | the store whose unwatched write caused KERM18NX |
| task-registry | 6 | `github-project.ts` mirror + `teams-service` writes |
| aid-token | 1 | a route MINTING a governance token outside any pipeline |

**The count is not one backlog — it is two, and they need different fixes:**

- **(a) SECOND PATH** (all 11 agent-registry sites): an all-in-one EXISTS and the call goes around
  it. Fix = route through the pipeline. Cheap, mechanical, removes a pin each time.
- **(b) UNGATED SOLE PATH** (the other 26): the only path, but the performer is not an all-in-one.
  R50 is violated differently — not "two paths" but "the one path is not a pipeline". Fix = BUILD
  the AIO (`ChangeGroup`, `ChangeTeam`, `ChangeTask`), then move the call inside it. This is design
  work, not a re-route, and it is why the number cannot simply be driven to zero by editing imports.

Category (b) reads as harmless — *of course the owning service writes its own store* — right up
until a second caller appears and turns it into (a) with no gate anywhere in between. That is
precisely how the agent-registry list reached eleven.

NEXT ACTION unchanged in kind, re-ranked by severity across the full set:
1. `app/api/v1/auth/token/route.ts::issueGovernanceToken` — the thing it hands out is AUTHORITY, and
   it is minted outside any pipeline. Highest value single row.
2. The 3 team API routes writing `saveTeams`/`updateTeam` directly — exactly the shape R50.2/R50.3
   forbid: the button's endpoint is supposed to BE the pipeline.
3. `services/sessions-service.ts::deleteAgentBySession` — the original next action; a DELETE outside
   the pipeline, same shape as the defect already diagnosed.

## The 11 bypasses (2026-07-25 audit)

**Deletes — highest severity.** A delete outside `DeleteAgent` leaves the registry row gone while
every other store still claims the agent, which is exactly the ghost-producing state.

| Call site | Should route through |
|---|---|
| `services/sessions-service.ts::deleteAgentBySession` (×2 call sites) | `DeleteAgent` |

**Creates.** A create outside `CreateAgent` skips G03 workdir policy, G05 `.claude/` seeding, G05b
DEP rules, G05c git-exclude, R17 core-plugin install, and the AMP keypair provision — so the agent
exists but is not governed.

| Call site | Notes |
|---|---|
| `services/agents-core-service.ts::createAgent` | session-discovery auto-registration |
| `services/sessions-service.ts::createAgent` | same, from the sessions path |
| `services/agents-docker-service.ts::createAgent` | container agents |
| `services/amp-service.ts::createAgent` | AMP auto-registration of an unknown sender |
| `services/help-service.ts::createAgent` | help/assistant agent |
| `services/creation-helper-service.ts::createAgent` | Haephestos |

**Direct registry writes.** `saveAgents()` is the store's own write path; a service calling it
mutates agent state with no gate and no post-condition.

| Call site | Notes |
|---|---|
| `services/agents-docker-service.ts::saveAgents` | |
| `services/agents-repos-service.ts::saveAgents` | |
| `services/agents-transfer-service.ts::saveAgents` | import/export |

**Also `services/sessions-service.ts::renameAgentSession`** — a rename outside `ChangeName`.

## Proposed fix

Per call site, in severity order (deletes → creates → direct writes):

1. Identify which all-in-one owns the operation (`DeleteAgent`, `CreateAgent`, `ChangeName`, or a
   narrower `Change*`).
2. Replace the primitive call with a call to it, passing an appropriate auth context.
3. If the all-in-one cannot express the caller's need, that is a **gap in the all-in-one** — extend
   it (a new option or gate) rather than keeping the bypass. Adding an option to one function is the
   whole point; a second function is what R50 forbids.
4. Delete the entry from `KNOWN_BYPASSES` in the ratchet test. The test fails if a converged entry is
   left in the list, so the pin cannot silently loosen.

Auto-registration (`agents-core-service`, `sessions-service`, `amp-service`) is the subtle group: it
creates an agent for a session that ALREADY exists, so `CreateAgent`'s session-creating gates must be
skippable — likely a `discoveredSession: true` mode rather than a separate function.

## Verification

- `tests/unit/all-in-one-single-path.test.ts` — count drops with each conversion, never rises.
- Existing per-service tests stay green (the behaviour must not change, only its route).
- `bash scripts/with-node.sh npx tsc --noEmit` clean; `… yarn test` green.

## Estimated risk

MED — these are live paths (session discovery, AMP registration, import/export). Each conversion is
independently landable and independently revertible; do them one at a time with the suite green in
between, never as one sweep.

## Acceptance

**(a) SECOND PATH — an all-in-one exists; re-route the call (11)**

- [ ] `deleteAgentBySession` call sites route through `DeleteAgent`
      **⚠ 2026-08-29 — MEASURED BEFORE STARTING, AND THIS BOX MAY BE WORK ON CODE THAT SHOULD
      ALREADY BE DELETED. It needs an owner ruling, not a refactor.**
      Both call sites (`services/sessions-service.ts:1238` and `:1251`) are inside ONE function,
      `deleteSession`, and that function has exactly two callers — the Next.js route
      `app/api/sessions/[id]/route.ts:39` and its headless twin `services/headless-router.ts:874`,
      i.e. **the same HTTP endpoint in both server modes**. That endpoint's own header reads:
      `@deprecated Use /api/agents/[id]/session?kill=true&deleteAgent=true instead.` ·
      `Removal target: v0.28.0`.
      **`package.json` is at `0.29.0`, so the removal target is already PAST** — the deprecation is
      overdue by a full minor version, and the named replacement route **exists**
      (`app/api/agents/[id]/session/route.ts`).
      So converging it has a cheaper alternative that also closes the box: **delete the endpoint**,
      and `deleteSession` with it. Note it is not currently unguarded — the Next route runs
      `enforceAuth` + `requireSudoToken`, and the headless twin runs `authenticateAgent` — so this
      is a redundancy/lifecycle question, not a live hole.
      **Why this is not mine to decide:** removing a shipped HTTP endpoint is a breaking
      public-API change, which the objective floor (§D3) puts at `min-approval-requirement: user`.
      Converging it instead is Tier 0, but it would thread `authContext` into `deleteSession` and
      through both callers to satisfy `DeleteAgent`'s mandatory Gate 0 — real work, on a path
      already slated to disappear.
      **OWNER CALL: delete the deprecated endpoint (and this box closes by removal), or keep it and
      converge it?** Nothing here is blocked on anything else.
      **Both scoped searches above re-run UNSCOPED, because a search whose SCOPE produces its answer
      is how "exactly two callers" gets to be wrong.** The caller list was taken from a grep over
      `app services lib` limited to `*.ts`; re-run across the whole tree with no directory or
      extension filter it holds — the only production callers are still those two. But it also
      surfaces what the filtered version hid: **5 test call sites** in
      `tests/services/sessions-service.test.ts` (`:139, :482, :493, :504, :517`, with its own
      `describe('deleteSession')` at `:477`). They change the REMOVAL option's cost — deleting the
      function reddens that file — and my `-v '^./tests/'` filter had removed exactly the evidence
      that bears on the choice being offered.
      The replacement route was also confirmed by READING it rather than by `ls`: it parses
      `searchParams.get('deleteAgent') === 'true'` (`:188`, behind an explicit auth gate at `:190`)
      and carries a session-only `kill=true` branch (`:231`) — so the documented successor really
      does support the flags the deprecation notice points at.
      **FRAMING CORRECTION — calling this a binary "owner call" overstated the block.**
      **Convergence is Tier 0 and available right now**; only REMOVAL is Tier 3. The honest shape is
      *"converge it today and lose that work if the owner later deletes the endpoint, or ask first"*
      — not *"nothing can proceed"*. I chose to ask because the work is discardable by design, but a
      reader should not infer this box is blocked.
      **AND IT IS NOT ONE ROUTE — IT IS A FAMILY, WHICH ALSO CATCHES BOX 4 BELOW.** Grepping the
      tree for `Removal target` finds **three** routes carrying `v0.28.0`, all overdue at `0.29.0`:
      `app/api/sessions/[id]/route.ts:12`, `…/rename/route.ts:11`, `…/command/route.ts:10`.
      That matters here because **box 4 (`renameAgentSession` routes through `ChangeName`) is the
      same shape**: its only two call sites, `services/sessions-service.ts:1286` and `:1303`, are
      both inside `renameSession`, which serves `/api/sessions/[id]/rename` — the second overdue
      route. So the owner's single ruling on this route family decides **two** boxes of this card,
      not one, and deleting the family would close both by removal.
- [ ] The 6 `createAgent` call sites route through `CreateAgent` (with a discovered-session mode)
- [ ] The 3 `saveAgents` call sites route through the owning `Change*` pipeline
      **⚠ 2026-08-29 — MEASURED: this box's own (a) CLASSIFICATION IS WRONG FOR 2 OF ITS 3 FILES,
      AND THE THIRD IS NOT A FIELD WRITE AT ALL.** The count (3) is right — it is file-granular,
      matching the ratchet's `file::primitive` keys, and the 4th `saveAgents` pin
      (`foreign-approval-service`) is category (c), permanent by design. What is wrong is the
      category, which is what sets the estimate.
      **(1) There is no pipeline to route to, for two of them.** Enumerated from the AIO module,
      23 pipelines exist: `ChangeAgentDef ChangeAvatar ChangeCLIArgs ChangeClient ChangeCommand
      ChangeFolder ChangeHook ChangeLSP ChangeMarketplace ChangeMCP ChangeMetadata ChangeName
      ChangeOutputStyle ChangePlugin ChangeRule ChangeSkill ChangeTeam ChangeTitle CreateAgent
      CreateMarketplace DeleteAgent DeleteMarketplace DeleteTeam`. **No `ChangeRepo`. No
      `ChangeDeployment`.** But `agents-repos-service.ts:180,201,234` writes
      `agents[i].tools.repositories`, and `agents-docker-service.ts:251` writes
      `agents[i].deployment`. Both are therefore category **(b) — build the AIO first**, not (a)
      "re-route the call". Filed under (a) they read as three one-line redirects; they are two new
      pipelines.
      **(2) `agents-transfer-service.ts::saveAgents` is unpipelined CREATE and DELETE of whole
      agents — not a field write.** Its 7 sites: `:802` pushes a new agent into the registry
      (bypasses `CreateAgent`); `:793` replaces an existing agent on `options.overwrite`;
      `:901/:957/:1001/:1028` write `workingDirectory`/`preferences`/`hooks`/`ampIdentity` during
      import; and **`:1243` DELETES an agent by `agents.filter(a => a.id !== agent.id)`.**
      **CORRECTED SAME DAY — my first write-up of `:1243` was wrong about WHEN it runs, and the
      error was the persuading sentence.** I read a 10-line window plus the name `deleteError` and
      called it a rollback that "fires precisely when the system is already in a bad state". It is
      not. The enclosing function is `transferAgent` (`:1134`) and the site is its
      **`if (mode === 'move')` branch (`:1222`) — the deliberate local removal after a SUCCESSFUL
      transfer-out.** The `catch` wraps that teardown; it does not trigger it. Struck: the
      failure-path framing, and "the highest-severity entry in category (a)".
      **What survives is the bypass, and it is reached by an ordinary user action rather than by a
      failure.** This is a hand-rolled agent deletion on the NORMAL path of a user-facing operation:
      it `fs.rmSync`s the agent dir, wipes the three AMP message dirs, and filters the registry.
      **`DeleteAgent` appears nowhere in this file, and neither caller supplies it** — the Next
      route `app/api/agents/[id]/transfer/route.ts` is a thin wrapper (`enforceAuth` +
      `requireSudoToken` + call + return) and the headless twin
      (`services/headless-router.ts:1649`) is thinner still; the gate does not run one frame up.
      **THE GATE LIST BELOW IS MEASURED, NOT RECALLED (2026-08-29, second correction).** My first
      write-up named five gates from memory. Read off `DeleteAgent`'s own `ops.push`/`id:` labels,
      the sequence it actually owns is **G01** (exists / not already soft-deleted) · **G01b**
      (R39.6 ASSISTANT independent-delete refusal) · **G01c** (cemetery archive) · **G02** (MANAGER
      auto-demote to AUTONOMOUS before deletion) · **G04** (COS / Orchestrator / membership slots
      cleared in every team) · **G05** (tmux session kill) · **G05b** (`PersistedSession`
      unpersist) · **G06** (AMP API keys *and* AID governance tokens revoked) · **G07** (pending
      governance requests + transfers) · **G07c** (group unsubscribe) · **G08** (registry delete) ·
      **G08b** (on-disk verification of that delete) · **G08c** (local plugin-record uninstall) ·
      **G09/EXE** (folder, with the `~/agents/` refusal) · **G10** (post-condition verification).
      My recalled five were all real but were a SUBSET: it also loses the R39.6 refusal, the MANAGER
      demotion, pending governance requests and transfers, group membership, the AMP key half of
      G06, and both verification gates. The bypass is wider than I first wrote, and the correction
      runs in the direction I would not have guessed.
      TRDD-KERM18NX is the concrete consequence to point at (a `PersistedSession` outliving its
      agent and resurrecting the workdir — G05b), not the whole of it. And on partial failure the
      catch returns **`success: true`** with a `warning` string; the Next route forwards
      `result.data` whenever `result.error` is unset, so a half-deleted agent reports success to the
      HTTP caller with a 200.
      It was invisible while one ratchet key stood for seven sites.
      Sequencing consequence: transfer's delete converges onto the EXISTING `DeleteAgent` and can
      be done today; repos/docker cannot start until their AIO exists.
- [ ] `renameAgentSession` routes through `ChangeName`

**(b) UNGATED SOLE PATH — build the missing all-in-one first (26)**

- [ ] `issueGovernanceToken` minted inside a pipeline, not directly in the auth route (severity #1 —
      it hands out authority)
- [ ] The 3 team API routes stop writing `saveTeams`/`updateTeam` directly (R50.2/R50.3: the
      endpoint IS the pipeline)
- [ ] A `ChangeTeam`-family pipeline owns every `team-registry` mutation (9 sites)
- [ ] A `ChangeGroup` pipeline exists and owns every `group-registry` mutation (5 sites)
- [ ] Every `session-persistence` write is gated (5 sites) — DeleteAgent G05b is the only one today
- [ ] A `ChangeTask` pipeline owns every `task-registry` mutation (6 sites)

**Both**

- [ ] The ratchet's guard table covers every store holding governance-relevant state (re-audit: a
      store with no `StoreGuard` entry is invisible, which is how 26 sites hid)
- [ ] `KNOWN_BYPASSES` is empty and the ratchet asserts zero
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-25T23:51:47+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
