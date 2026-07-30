---
trdd-id: H4Y9F25J
title: Pin every enforced governance rule with a drift-failing test
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T04:48:14+0200
updated: 2026-07-30T18:17:16+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-26T04:48:14+0200
relevant-rules: [R51]
blocked-by: []
eht: [L42SKUBW, W8NA7ROZ]
npt: []
implementation-commits: [7bec032e, 2298646a, 62b5e58d, 59893d08, 8e77d834, 8b63baa1, b07cfd78, c5173e59, 17471dd3, f379b2b7, 73856fe0, 32d890f2, b74b01bf, bd701701, 4ffaa2a1, c6e52296, 654e116b, 82055ec1, 7cd4de7d, d5ba8d23, d1f6f760, c895b72b, bfcf8761, d7a8f3dc, 50a52952, 05d3e83e, 8321338e, 5f9b2302, c31c1805, 5353f2c4, 1b2bb133, e556dbee, 14dacb6d, 5b2b55cf, 3568620c, 9adb02d9, 5da2500c, 831a26b8]
---

## ⏵ STATE — 2026-07-30 (newest; supersedes the 2026-07-27 block below)

### R10.6 SCOUTED — a comment claimed coverage that does not exist (ratchet unchanged at 8)

**MEASURED: `grep -rln "Cannot restart team agent" tests/` returns NOTHING.** No test in either
mode reaches any of R10.6's three gates. Only the WAKE twin is driven —
`tests/governance/r3-r9-team-governance.test.ts:1089` calls the real `wakeAgent` and asserts its
403 on `/Cannot wake team agent: no MANAGER exists/i`.

**The header of `tests/unit/headless-router-auth-mirror.test.ts` said otherwise**, and said it
about exactly this gate: *"the gate's condition is byte-identical to full mode's and is covered
there by the governance suite."* It is not. **Corrected in place** — a comment asserting a
coverage that does not exist is worse than silence, because it tells the next reader not to look.
The two tests under it are honest about their own reach (both stop at the auth layer *before* the
manager gate, and say so).

**Why R10.6 needs a harness and not a quick pin.** The wake gate lives in a SERVICE
(`wakeAgent`), so it is drivable in one call. The restart gates do not: they sit in a Next route
handler plus TWO headless handlers —

| site | shape |
|---|---|
| `app/api/sessions/[id]/restart/route.ts:73-91` | `authorize('restart-session')` then the manager gate |
| `services/headless-router.ts:1024-1036` | the mirrored gate, reached through the headless dispatcher |
| `services/headless-router.ts:952-962` | a second restart path with the same gate + a subagent gate |

That asymmetry IS the rule ("the restart endpoint follows the same governance rules as the wake
endpoint") and is exactly why one site proves nothing. **The harness must drive all three with an
AUTHORIZED caller** — the existing `call('POST', path, headers)` fixture in
`headless-router-auth-mirror.test.ts` only ever sends a forged or absent credential, so it cannot
reach a gate that runs after `authorize()`. Getting past it needs `@/lib/agent-auth` +
`authorize` stubbed to ALLOW, then the seeded no-MANAGER + team-agent fixture from
`r3-r9-team-governance.test.ts` (`seedTeams` / `seedAgents` / `mockGovernance.getManagerId`),
whose `vi.mock('@/lib/governance')` already intercepts the route's DYNAMIC import.

**Neuter set it will need:** three, one per site, each reddening exactly one — the same shape
R40.1 used, and for the same reason.

### RATCHET 9 → 8 — R17.18a DONE (`tests/governance/r17-no-auto-register.test.ts`)

**The remaining 8:** R1.2, R2.2, R4.8, R7.1, R7.3, R7.8, R10.6, R20.28 — **all eight are now in the
"deliberately not pinnable off one site" set** (see the table further down). The next batch is a
DIFFERENT kind of work: the MECHANISM+COVERAGE shape for the ALL-quantified pair, a subprocess
harness for the shell guard, and a reachable seam for the two half-unreachable clauses.

**This rule is ENFORCED BY AN ABSENCE**, which is what made it awkward and worth doing. The
discovery loop collects strangers into `unregisteredSessions` and simply never calls the registry
writer — there is no `if` to delete, so the neuter has to **ADD** the forbidden behaviour rather
than remove a guard.

**An absence assertion is the vacuous-pass shape**, so the first test proves the poll RAN and
DISCRIMINATED — `unregisteredSessions === [stranger]` and the known agent matched — in the same call
the absences are measured from. Without it, "the registry gained no row" would pass against a
discovery that returned nothing at all.

**Neuter:** write the stranger into `registry.json` inside the collection loop → the two
registry-absence tests red while the SURFACING test stays **green**. That discrimination is the
point: the rule is not "hide strangers", it is "show them WITHOUT adopting them", and a neuter that
reddened both could not tell those apart. The workdir/AMP-absence test also stays green under that
mutation — correctly, since it guards a SECOND claim in the rule's text ("no plugin is installed, no
AMP identity is provisioned") and would need its own mutation. Recorded rather than overclaimed.

**The registry is REAL** (seeded on disk in the temp state dir). It has to be — "the registry gained
no row" IS the rule, and a mocked registry would assert nothing. What is mocked is `getRuntime`
(the tmux data source: "what sessions exist?") and `child_process` (so `getPaneCommand` cannot reach
the developer's real tmux).

**Sweep note:** `listAgents` appears in `tests/agent-registry.test.ts`, but that is
`lib/agent-registry`'s `listAgents` — a DIFFERENT function with the same name in a different module.
`unregisteredSessions` appears in zero tests. Same-name-different-module is a way a sweep can return
a false POSITIVE, the mirror of R1.1's all-mocks false positive.

### RATCHET 10 → 9 — R40.1 DONE (`tests/governance/r40-foreign-user-creation.test.ts`)

**The remaining 9:** R1.2, R2.2, R4.8, R7.1, R7.3, R7.8, R10.6, R17.18a, R20.28.

**This rule was ALREADY half-enforced once, and that history is why it is not pinnable off one
site.** R40.1 quantifies over creation surfaces ("the MAESTRO's approval for **every** agent or
team creation"). `create_team` sat in `R40_RESTRICTABLE_COMMANDS` while the guard was wired into
`CreateAgent` ONLY — closed by the M3 fix of the 2026-06-19 R26-R40 audit, per the comment still
standing at `teams-service.ts:257-271`. A single-surface test cannot see that failure, so this file
is MECHANISM + COVERAGE, and **the row now cites the `CreateAgent` G00f block too** — an
enforcement site nothing cites is exactly how the first half went missing.

| half | what it drives |
|---|---|
| MECHANISM (9 tests) | `assertForeignUserMayCall` — native passes, no-userId passes, no-AID refuses, ungranted refuses, a grant for a DIFFERENT command refuses (and the granted one still passes), an approved grant passes, a non-`approved` status refuses, a non-restrictable command passes, and the **fail-closed** branch |
| COVERAGE (3 tests) | `CreateAgent` and `createNewTeam` — each through its REAL public entry point, each asserting the refusal AND a post-condition that it landed before any side effect, plus a shared positive control |

**FAIL-CLOSED is the one worth naming.** "R40 is a security ADD; a glitch must not silently grant a
foreign user create rights" is a claim about a `catch` block — the kind that rots with nothing going
red. Reaching it takes care: making `getUser` throw does NOT reach it, because `isForeignUser`
catches and returns `false`, so the caller is treated as native and allowed. The store that must
throw is `loadForeignApprovals`.

**Three neuters, because the surfaces have to be provably independent:**

| neuter | reds |
|---|---|
| `assertForeignUserMayCall` returns null on entry | the 5 refusal tests + BOTH coverage tests; the 5 allow/positive-control tests stay green |
| delete the `G00f` block in `CreateAgent` | **only** the CreateAgent test — the M3 regression reproduced exactly |
| delete the `create_team` gate in `createNewTeam` | **only** the createNewTeam test |

Either single neuter alone would leave one surface free to lose its gate silently, which is the
entire content of the word EVERY. Both guard files restored byte-identical.

**`user-registry` and `foreign-approval-registry` are mocked** — the guard's two DATA SOURCES, both
reached by DYNAMIC import inside it (vitest intercepts those), so `isForeignUser` and
`assertForeignUserMayCall` run for real. The R1.1 distinction applies unchanged: mocking a guard's
data sources is necessary; mocking the guard is the pattern that makes a sweep lie.

### RATCHET 11 → 10 — R1.1 DONE (`tests/governance/r1-team-acl.test.ts`)

**The remaining 10:** R1.2, R2.2, R4.8, R7.1, R7.3, R7.8, R10.6, R17.18a, R20.28, R40.1.

The sweep (below) had just proven R1.1 UNPINNED, which is what made it the next row: its guard is a
pure decision ladder with no `~` containment, no jsdom, and a documented security history.

**Which clause this row's guard carries.** R1.1 is definitional — "teams have isolated messaging,
ACL, governance titles, and a COS" — and three of those four clauses own their own rows (COS =
R1.3/R1.4, messaging = R6, titles = R9). The ACL is what `lib/team-acl.ts` enforces, and it is the
only clause the row cites.

**The load-bearing word is ISOLATED**, so every membership assertion is a PAIR — allowed on the
agent's own team, DENIED on another. A guard that returned `allowed` unconditionally satisfies "a
member can reach their team" while violating the rule completely; only the second half of the pair
can see that. The two DELIBERATE crossings are asserted for the same reason: a MANAGER reaches every
team, an ORCHESTRATOR reaches its own team only ("not any team", per the guard's decision-order
comment). Without them "isolated" would be approximate.

**Re-cited** from the bare `lib/team-acl.ts:102` to `:54-103` — the whole ladder, which is what the
test drives (system-owner short-circuit, anonymous deny, manager, orchestrator, COS, member, deny).

**Neuter pair, and the second one earned its documentation:**

| neuter | reds | proves |
|---|---|---|
| step 6 → `return { allowed: true }` | the outsider test + all three isolation pairs, nothing else | the isolation pairs are what carry the rule; the anonymous tests exercise a different branch |
| delete the `if (!input.requestingAgentId)` deny | ONLY the two anonymous tests — **on the REASON** | see below |

Under the second neuter the request falls through to step 6 and is still denied, so `allowed` is
`false` either way. The failure output is the lesson verbatim:
`expected 'Access denied: you are not a member o…' to match /anonymous request/`. **A test asserting
only `allowed === false` stays GREEN through it** — which is why every assertion in the file pins
the reason string. That branch is the LIB2-CRIT-02 fix (2026-05-06), where omitting a header once
bought MANAGER-equivalent team access from any local or Tailscale peer; it had no test at all.

`lib/team-acl.ts` restored byte-identical after both runs (`git diff` empty).

**`getTeam` / `isManager` / `isOrchestrator` are mocked, and that is not the excluded pattern** —
they are the guard's DATA SOURCES; the decision ladder runs for real. Mocking `checkTeamAccess`
itself is what the five pre-existing references do, and is why none of them pinned this rule.

### THE ALREADY-TESTED SWEEP RAN — all three candidates NEGATIVE, and that is the finding

R33.1 (below) cost zero new code because its test already existed, so the next action was to sweep
the remaining rows the same way before writing anything. **All three candidates came back
negative** — the sweep's value was not the row it saved but the two traps it caught:

- **R1.1** (`lib/team-acl.ts:102` → `checkTeamAccess`) — five test files reference the symbol and
  **every one of them MOCKS it**: `vi.mock('@/lib/team-acl', () => ({ checkTeamAccess: vi.fn(() =>
  ({ allowed: true })) }))` in `tests/document-api.test.ts`, `tests/team-api.test.ts`,
  `tests/services/teams-service.test.ts`; `tests/unit/headless-router-auth-mirror.test.ts:462`
  mentions it only in a COMMENT. Mocking the guard to prove the guard is the excluded pattern —
  every one of those survives the guard's deletion. **A grep hit only proves the module is
  IMPORTED**, which is exactly why the sweep says OPEN each hit.
- **R18.8** — the one `WarningCollector` hit
  (`tests/unit/converter-model-mapping.test.ts:143-163`) drives a model REWRITE: a Claude id that
  MAPS to a Codex id, with a note. R18.8 governs the id that **cannot** map. Reading the rule TEXT
  against the guard is what separates them; the row would otherwise have been cited off a test
  about a different case.
- **R1.2** — its Guard is a bare `lib/group-registry.ts` with no line at all. Left as-is; a
  definitional row ("Groups are lightweight … no governance, no COS, no kanban") whose enforcement
  is the ABSENCE of machinery, which no single site carries.

### RATCHET 12 → 11 — R18.8 DONE (`tests/governance/r18-conversion-loss-report.test.ts`)

**The remaining 11:** R1.1, R1.2, R2.2, R4.8, R7.1, R7.3, R7.8, R10.6, R17.18a, R20.28, R40.1.

**A fourth rotted citation.** R18.8's row cited
`services/element-management-service.ts:5705-5715` — which is `ChangeMetadata`, agent metadata
mutation, nothing to do with plugin conversion. Nothing caught it because the ratchet only
bounds-checks. Re-cited to the real warn-and-continue path: `lib/converter/emitters/codex.ts:47-52`
(`warnLossySkill` — the four fields Codex cannot represent) and `:245-253` (the block that attaches
the collected warnings to `files[0]` and **returns the files anyway**).

**Two clauses that fail in OPPOSITE directions**, so both are driven:

| clause | failure it forbids | assertion |
|---|---|---|
| (a) emits a loss report | the feature is silently dropped — the caller ships a plugin missing it and nothing says so | the report NAMES `allowed-tools`, `metadata`, `paths` and the owning skill; the mappable skill is NOT reported |
| (b) the operation MUST still proceed | the conversion ABORTS — "a plugin with reduced features is acceptable, an agent with no plugins is not" | the lossy skill's file still comes back, and it does not take the mappable skill with it |

**Clause (b) is quantified over target clients**, so pinning codex alone would launder an instance
into a rule. The coverage leg walks `getRegisteredEmitters()` (7 clients) and asserts each returns
files for the same lossy project — a new client cannot ship an abort-on-loss path invisibly. It
carries `expect(ids.length).toBeGreaterThan(1)` so an empty registry cannot pass it vacuously.

**Neuter pair (complementary, one per clause):** deleting the `warnLossySkill(skill, warnings)` call
reds ONLY clause (a) — the two proceed tests stay green, proving they do not lean on the report.
`if (skill.allowedTools) throw` reds the two proceed tests **including coverage**, which is also
what proves that loop reaches a real emitter rather than iterating over nothing. Guard restored
byte-identical (`git diff` empty).

**Noted, not fixed (out of scope, not a rule violation):** `codex.ts:245-251`'s comment says
"attach to the first file **or create a warnings file**", and the `else` branch does not exist — so
for a project that emits ZERO files the loss report is dropped. Only reachable when there is
nothing to report about, but the comment promises a branch the code lacks.

### RATCHET 13 → 12 — R33.1 needed NO new test, and that is its own finding

**The remaining 12:** R1.1, R1.2, R2.2, R4.8, R7.1, R7.3, R7.8, R10.6, R17.18a, R18.8, R20.28,
R40.1.

`tests/unit/portfolio-ledger.test.ts:115` already carried
`describe('reconstructPortfoliosFromLedger (R33)')` — it wipes the disk mirror so reconstruct is
the ONLY writer, then asserts all four replayed statuses (active / consumed / revoked / expired),
`uses_remaining`, and the per-token `ledger_seq` re-anchoring. Neuter-proven: disabling the
`consume_portfolio_token` branch reddens exactly that test. The row's Test column was simply empty.

**This is the OPPOSITE failure to a rotted Guard, and it is easy to miss because nothing goes red.**
A rotted Guard makes a row look enforced where it is not; an empty Test column on a row that IS
tested understates coverage, inflates the ratchet, and makes the campaign look further from done
than it is — so work gets spent re-writing a test that exists.

**NEXT ACTION — sweep for more of these BEFORE writing another test.** For each remaining row, grep
the test tree for the guard's exported symbol (`grep -rln "<symbol>" tests/`). Cheapest candidates
to check first: R1.1 (`lib/team-acl.ts` → `checkTeamAccess`), R1.2 (`lib/group-registry.ts`),
R18.8 (`lib/converter/utils/warnings.ts`), R40.1. Only after the sweep is exhausted is writing a
new test the right move.

### SCOUTED, NOT YET WRITTEN — R10.6, whose BOTH cited sites were wrong

**Verified by reading, 2026-07-30.** R10.6 ("the restart endpoint follows the same governance
rules as the wake endpoint") cited `restart/route.ts:97-107` — which is the **subagent** gate
(TRDD-O8NCNRWO), a different rule — and `headless-router.ts:919`, which is inside the **/stop**
handler, a different ENDPOINT. Neither named the guard.

Its real guard is the **manager gate** ("Cannot restart team agent: no MANAGER exists on this
host"), and it has **THREE** sites, all of which must stay in parity:

| site | what |
|---|---|
| `app/api/sessions/[id]/restart/route.ts:73-82` | full mode, dynamic `import('@/lib/governance')` |
| `services/headless-router.ts:1028-1036` | headless `[id]/restart` |
| `services/headless-router.ts:956-959` | headless `me/restart` (TRDD-4P1M8I18 self-restart) |

Row re-cited to all three. **Still untested, and pinning it off ONE mode would launder the rule**:
"the same governance rules as wake" is a PARITY claim, so a test that drives only the app route
proves the app route and says nothing about the drift the rule exists to prevent — and headless
drift is not hypothetical here (the comments at both headless sites record that each was
authenticate-only until a governance audit added the gate). The honest instrument drives all three
with the same inputs and asserts the same 403 + same message.

### RATCHET 14 → 13 — R11.6 DONE, and a NEUTER THAT REDDENED NOTHING

**The remaining 13:** R1.1, R1.2, R2.2, R4.8, R7.1, R7.3, R7.8, R10.6, R17.18a, R18.8, R20.28,
R33.1, R40.1.

`tests/governance/r11-role-plugin-n-to-1.test.tsx` pins **R11.6**. "Show a dropdown when 2+ plugins
are compatible" is only meaningful against its complement — a UI that ALWAYS showed the dropdown
satisfies the rule's literal text while offering a choice of one — so the single-plugin lock is
asserted too.

**The instructive part: my first neuter changed NOTHING.** I mutated
`hasMultipleOptions = length > 1` → `> 0`, expecting the single-plugin test to redden. All three
stayed green, because the render is `isSingleLocked ? … : hasMultipleOptions ? … : …` and with one
plugin the FIRST arm already matches — `hasMultipleOptions` is never consulted. The single-plugin
case is guarded by `isSingleLocked`, *not* by the `> 1` the rule's text points at. **A neuter that
reddens nothing is a finding about the TEST**, and here it said the expression I had named as the
guard was shadowed by an earlier one in the same ternary. The real pair: `isSingleLocked = false`
→ only the locked test; `hasMultipleOptions = false` → the dropdown test + the positive control.
Both expressions sit inside the cited range `:63-74`, so the citation was right and my reasoning
about which line does the work was not.

**Not asserted, deliberately:** the third arm is MEMBER's free choice (`isFreeChoice` — "MEMBER
always gets Change, whatever the count"). That is a SUPERSET behaviour and is not in R11.6's text;
asserting it under this row would claim the rule says something it does not.

### RATCHET 15 → 14 — R17.16 DONE (`tests/governance/r17-core-plugin-no-uninstall.test.tsx`)

R17.16 has TWO clauses on ONE ternary — *MUST NOT show the uninstall X* **and** *MUST show a
"core" label* — so both are asserted: the label alone passes against a UI that shows the label
AND keeps the X, which is precisely the state the rule forbids. The ordinary-plugin case is a
third leg the neuter pair justifies: dropping the core branch reddens the two core tests;
making it unconditional reddens ONLY the ordinary one (a read-only Plugins section — a louder
bug than the one R17.16 prevents, and invisible to the first neuter).

Rendering it needed `next/navigation` and `@/contexts/SudoContext` stubbed — `useRouter()` throws
"invariant expected app router to be mounted" outside a Next app tree. Neither is in the branch
under test (the ternary reads only `p.name`), and the uninstall HANDLER is never invoked: the rule
is about whether the CONTROL is offered.

**R4.8 was the other candidate and was NOT taken.** Its text names FOUR operations ("add to team,
remove from team, transfer, team creation agent selection") — the same ALL-quantified shape as
R7.1, with ONE cited site. Pinning `TeamOverviewSection.tsx:33-34` alone would launder an instance
into a rule. It needs the MECHANISM+COVERAGE treatment R8.1 got, or its remaining sites cited
first.

### RATCHET 16 → 15 — R7.7 DONE, and THREE rotted citations found and fixed

`tests/governance/r7-team-blocked-badge.test.tsx` pins **R7.7** — the second presentation rule
pinned by rendering, and the cheapest shape available: a tiny default-export component, an exact
citation, and a complementary pair built into the `&&` (badge present when blocked, ABSENT when
healthy AND when the flag is absent entirely — a guard written `!== false` passes the first and
fails the third). Its two clauses live in two files, so the row cites both: the BADGE in
`TeamCard.tsx:71`, the CONDITION in `lib/team-registry.ts:427` (R1.5's already-pinned
`blockAllTeams`).

**THREE rotted citations, found while scoping — the more valuable half of this unit.** A rotted
citation is worse than a missing one: it names real working code, so nothing reddens and the row
reads as enforced at a place it is not.

| rule | cited | actually | fixed to |
|---|---|---|---|
| R7.1 | `TeamListView.tsx:94` | a `useState` for the cascade-delete flag — the submitting guard MOVED into `PasswordDialog` (the comment two lines above says so) | `TeamListView.tsx:661, components/governance/PasswordDialog.tsx:334` |
| R7.3 | `TeamListView.tsx:192` | the middle of a comment block about `githubProject` | `TeamListView.tsx:636` |
| R7.8 | `TeamOverviewSection.tsx` (file only) | ONE of its TWO display sites; the other was invisible to every instrument | `TeamOverviewSection.tsx:37-42, TitleAssignmentDialog.impl.tsx:274` |

All three stay **untested, deliberately**: R7.1 is ALL-quantified ("ALL mutating buttons"), so
pinning one button would launder an instance into a rule — it needs the MECHANISM+COVERAGE shape
R8.1 got. R7.8's second site is `resolveAgentName`, an inline `useCallback` with no seam short of
rendering the whole dialog. R7.3's guard is inside the non-exported `TeamFormModal`, so driving it
means rendering `TeamListView` with its governance hook and fetches.

Next cheapest, both the same shape as R7.7 (render, assert, two branches): **R4.8**
(`components/teams/TeamOverviewSection.tsx:33-34` — the membership split that decides which agents
the add-picker offers) and **R17.16** (`components/agent-profile/PluginsTab.tsx:244-245` — the core
plugin must show a "core" label and NOT an uninstall X). **R20.28**'s guard is
`install-messaging.sh` — a shell script, so it needs a subprocess test; treat it separately.

### RATCHET 18 → 16 — R1.3 + R1.4 DONE (`tests/governance/r1-teams-service.test.ts`)

**Instrument note.** A first attempt at the 0-run was driven with `sed -i ''` in the same compound
command and reported **24** — a stale read, contradicted by the suite passing at 16 moments earlier.
Re-measured with the Edit tool: **16**. Two runs of the same measurement disagreeing is a finding
about the harness, not the corpus; the arithmetic (18 − 2 rows that gained a Test path) agreed with
the clean run. Do not drive a measurement through `sed` — it is also the repo's own edit rule.

The scouting notes below were correct in every particular and are kept as the record of what the
guards are:

- **R1.4 is a hard refusal** — `:279-283`, `if (!getManagerId())` → **400**. Ordinary refusal test.
  The SECOND clause immediately below at `:285-291` (only MANAGER or the web UI may create a team →
  **403**) is a DIFFERENT rule's guard; the test passes no `requestingAgentId` so it never fires.
- **R1.3 is a `SHOULD`, NOT a MUST**, so the test asserts the AUTO-CREATION post-condition and not a
  refusal — writing the refusal test would have asserted a behaviour the rule never claims, and
  "fixing" the code to match would break the sidebar's one-field create dialog.
- **The 0-IMPACT trap was real and the containment held.** `tests/helpers/fake-ecosystem-home.ts`
  (layer 2) plus `vi.mock('os')` (layer 1 — needed because `lib/workdir-path-policy.ts` does
  `const HOME = homedir()` at module level and the REAL `createAgent` refuses any workdir outside
  `$HOME`). The containment test asserts the auto-COS dir landed under the FAKE home.
- **Three neuters, not one** — deleting the manager check reddens only the R1.4 test; never
  auto-creating reddens the R1.3 test (+ containment, which checks that same mkdir); auto-creating
  UNCONDITIONALLY reddens only the "keeps an explicitly supplied COS" test. One neuter alone would
  have certified half the file.

<details><summary>Original scouting notes (2026-07-30, before the test was written)</summary>

Read the guards; ran out of context before writing the test. Do NOT re-derive:

- **R1.4 is a hard refusal** — `:279-282`, `if (!getManagerId())` → **400** with "Teams require an
  existing MANAGER first". Ordinary refusal test. Note a SECOND clause immediately below at
  `:285-291` (only MANAGER or the web UI may create a team → **403**), so the same
  let-the-other-gate-pass discipline applies: a test that supplies no manager AND an agent caller
  cannot tell the 400 from the 403.
- **R1.3 is a `SHOULD`, NOT a MUST** — "every team SHOULD have a COS". **A refusal test would
  misread the rule.** Its enforcement is AUTO-CREATION: `:344-404` mints a `cos-<teamslug>` agent
  with a random robot avatar and assigns it when no `cosId` was supplied. So the honest assertion
  is *create a team without a COS → one is assigned*, plus the SVC2-MIN-08 rollback (if
  `createCosAgent` throws after `mkdir`, the empty `~/agents/cos-*` dir is removed — and ONLY when
  this call created it, never a pre-existing dir).
- **0-IMPACT TRAP, mandatory:** that path resolves the workdir through a **runtime**
  `await import('os')` + `os.homedir()` and really does `mkdir ~/agents/cos-<slug>`. `vi.mock('os')`
  intercepts STATIC imports only, so it does NOT contain this — the exact failure
  `tests/helpers/fake-ecosystem-home.ts` was written for. Use that helper (layer 2) or the test
  will create directories in the developer's real `~/agents/`. Governance batch 1 already did this
  once.

</details>

### RATCHET 23 → 18 — 5 pinned this session

`d7a8f3dc` **R34.2 + R35.2** · `50a52952` **R7.2 + R7.9** · `8321338e` **R8.1**.

**R2.2 is deliberately NOT counted, and that is the interesting part.** It shares a guard FILE
with R8.1 (`lib/team-registry.ts`) and its server clause IS pinned in the same test — but the
rule has TWO clauses ("server-side 409 **and** client-side inline error before POST") and the
client half lives at `components/teams/TeamCreationWizard.tsx:201`, which the map did not cite
at all. Citation now names BOTH sites; the row stays untested until the client half is pinned
(render the wizard, type a duplicate, assert the inline error AND that no POST fired — "before
POST" is the load-bearing half). Counting it would have laundered a half-covered rule into a
"tested" row, which is the exact defect this campaign exists to remove.

**The map's columns are MACHINE-PARSED — keep prose out of them.** Guard is split on commas
and every piece must resolve as a file path; Test must be `—` or a real path. A prose citation
("lib/team-registry.ts — withLock in all 5 mutators (createTeam, …)") reddened two ratchet
tests at once. Explanations belong in the test file or here.

### RATCHET 23 → 19 — 4 pinned this session, in 2 shared-guard pairs

`d7a8f3dc` **R34.2 + R35.2** (`r34-r35-foreign-approval.test.ts`) · `50a52952` **R7.2 + R7.9**
(`r7-governance-loading-state.test.ts`). Both pairs share ONE guard, so one file pins two rules.

**Prefer a shared-guard pair as the next unit of work** — it is the cheapest ratchet movement
available and it forces the complementary-neuter discipline, because two gates on one path can
each mask the other. Remaining pairs: `services/teams-service.ts` → R1.3 + R1.4 ·
`lib/team-registry.ts` → R2.2 + R8.1 · `components/teams/TeamOverviewSection.tsx` → R4.8 + R7.8 ·
`components/sidebar/TeamListView.tsx` → R7.1 + R7.3.

**Two traps this session, both worth carrying forward:**
- **A one-expression guard's first test was VACUOUS and only the neuter knew.** `useState(true)`
  asserted via `result.current.loading` passed with the value INVERTED — `result.current` is read
  AFTER effects flush and the hook's own effect sets `loading=true`, so the assertion observed the
  effect, not the initial state. Sample DURING render (push from the render callback) when the
  guard is an initial value.
- **A stale comment kept 2 rules unpinned for months.** `tests/use-governance-hook.test.ts` said
  three times that RTL was unavailable here; it has been installed for some time. Corrected in
  place, pointing at the new test. When a file explains why something cannot be tested, re-measure
  the claim before believing it.

### SETTLED — the 9 client-side-guarded rules ARE pinnable; do NOT downgrade them

The blocking question ("a guard in a `.tsx` is not a server-side refusal — do those
9 warrant a BEHAVIOURAL verdict instead of a test?") is **answered NO, on facts.
NEXT ACTION: write the tests; the decision needs no further deliberation.**

The 23 (read from the ratchet's OWN failure message — a hand grep misses the
lettered `R17.18a`, and the map has a SECOND 3-column table at line 471 that
poisons a naive `awk -F'|'` with 118 phantom `—` guards):

`R1.1 R1.2 R1.3 R1.4 R2.2 R4.8 R7.1 R7.2 R7.3 R7.7 R7.8 R7.9 R8.1 R10.6 R11.6
R17.16 R17.18a R18.8 R20.28 R33.1 R34.2 R35.2 R40.1`

**I nearly downgraded 9 correct rows by applying a security principle to UX rules.**
CLAUDE.md says a check in a client "is not a weak check, it is **no check** — enforce
in the route", which reads as decisive until you read what the rules SAY. All 9 are
**presentation** rules — "the UI must always show team memberships" (R4.8), a
`submitting` guard against double-click (R7.1), spinners (R7.2), error messages
(R7.3), a blocked badge (R7.7), resolve a COS UUID to a name (R7.8), a loading state
instead of a stale role (R7.9), a dropdown at 2+ compatible plugins (R11.6), a "core"
label instead of an uninstall button (R17.16). The curl principle governs
AUTHORIZATION; nobody attacks themselves by double-clicking. For a rule about what
the UI DISPLAYS, the component is the only possible enforcement point, so `.tsx` is
correct and complete. **Read the rule TEXT against the guard before re-verdicting it**
— the same lesson that saved R9.13.

**They are pinnable TODAY — no infrastructure work.** `jsdom ^25` +
`@testing-library/react ^14` are installed, and `tests/unit/password-dialog.test.tsx`
is the working precedent: a per-file `// @vitest-environment jsdom` (vitest.config's
default stays `node`). The adversarial form for a presentation rule is: render in the
state the rule governs, assert the required element present/absent, and neuter-prove
by deleting the guard.

**Batch by GUARD FILE (the directive's rule), not by rule id.** Clusters, incl. two
pairs that share one guard line so one file pins both:
`foreign-approvals/[id]/approve/route.ts:46-49` → R34.2 + R35.2 ·
`hooks/useGovernance.ts:48` → R7.2 + R7.9 · `services/teams-service.ts` → R1.3 + R1.4 ·
`lib/team-registry.ts` → R2.2 + R8.1 · `components/teams/TeamOverviewSection.tsx` →
R4.8 + R7.8 · `components/sidebar/TeamListView.tsx` → R7.1 + R7.3.
Singletons: R1.1 · R1.2 · R7.7 · R10.6 · R11.6 · R17.16 · R17.18a · R18.8 · R33.1 · R40.1.
`R20.28`'s guard is `install-messaging.sh` — a SHELL script, so it needs a
subprocess-shaped test, not a vitest import; treat it as its own thing.

**Ratchet 30 → 28.** R19.1 + R19.3 pinned by 13 tests in
`tests/governance/r19-maintainer-title.test.ts`, driving the REAL `ChangeTitle`.
Every negative asserts WHICH gate refused, not merely that something did —
`success === false` passes on any earlier refusal, so it distinguishes nothing.

**Two map defects, both found by reading the cited range against the rule's
current text rather than trusting the verdict:**

- **R19.2 was recorded `UNENFORCED` over a LIVE guard.** Gate 9a requires
  `githubRepo` and validates its format. This is the MIRROR IMAGE of the
  R39.5/R39.7 defect (there the row claimed MORE than the code did; here it
  claimed LESS) and it is the one the ratchet is structurally blindest to: **a
  row claiming nothing is never audited**, so the guard could be deleted and
  nothing would redden. Now `ENFORCED` + tested, so it contributes 0 to the
  drop — the −2 is exactly the two rules pinned.
- **R19.1's guard is the STANDALONE reverse check**, whose own comments label it
  R3 — and no R3 row cites it either. One block served two rules and was cited
  by neither.

**A LIVE BUG, found and FIXED en route (`4ffaa2a1`).** Re-pointing an EXISTING
maintainer at a different repository validated nothing, stored nothing, and
answered 200 OK. Two independent gates, both closed: `ChangeTitle` Gate 6
returned success the moment the TITLE was unchanged (and Gate 9a is
`githubRepo`'s only writer), while `agents-core-service` called ChangeTitle only
`if (oldTitle !== newTitle)` and had deliberately stripped `githubRepo` from its
own `updateAgent` body — so the field's single source of truth was unreachable in
exactly the case where it was the only thing changing. The SCEN-020 fix closed
the unvalidated leak-write and opened this. It survived because **a missing write
produces a SUCCESS, not an error** — the same shape as an unenforced rule, one
layer down. Format + uniqueness are now ONE predicate (`checkMaintainerRepo`)
called by both sites, because two copies of a validator drift.

**Verification:** tsc 0 · full suite **285/285, exit 0** · red-then-green proved
by stashing the fix (the 3 regression tests fail against pre-fix code) · **4
neuter runs**, each reddening exactly its named test. Built and DEPLOYED —
`services/*.ts` is bundled, so a restart alone would have replayed the old build;
verified from the artifact (`G06b` present in `.next/server/chunks/1.js`).

**The neuter that PASSED is the useful one.** Deleting `checkMaintainerRepo`'s
`a.id !== agentId` left the suite green. Reading Gate 5 explains it: it sets
`oldTitle` from `agent.governanceTitle` and only overrides when that is empty, so
a registry maintainer ALWAYS lands in Gate 6 — Gate 9a is reached only when the
subject is not a maintainer and therefore cannot match itself. The clause is
defence-in-depth, **deliberately left unpinned**, and both the code and the test
file say so; a fixture contorted enough to reach it would be manufacturing
coverage for an unreachable branch.

**Ratchet 28 → 26 (`654e116b`, `82055ec1`). Both traps this block named are
closed, and neither turned out to be a free pin.**

- **R19.10** was cited at `lib/ecosystem-constants.ts:331` — ONE line of the
  `TITLE_PLUGIN_MAP` table. That is worth LESS than no citation: a test written
  against a table stays green after every guard that READS the table is deleted,
  so the row advertises a pin it never had. Re-cited onto ChangeTitle G15
  (resolves title → plugin) + G16 (installs it) and pinned behaviourally — the
  only tests in that file that do NOT pass `skipPluginSync`, asserting the argv
  that actually reaches `claude plugin install`. Its SECOND clause (per R17 the
  core plugin is also required) is enforced OUTSIDE ChangeTitle — the
  `enforceAgentInvariants` core-plugin row and CreateAgent G11, which R17's own
  rows cite — so it is not re-cited here.
- **R20.5 then looked free — same two gates, now driven. "Free" is exactly what
  invites pinning only the easy CLAUSE.** R20.5 has two: the default auto-installs
  on grant, UNLESS the caller explicitly picked a different COMPATIBLE plugin.
  ChangeTitle has no option for that pick; the way an earlier pick SURVIVES a
  grant is G15's keep-branch — cited by nothing and driven by nothing. Pinned too.
  Its row's ranges were also ~74 lines adrift, which the gate-qualifier check
  structurally cannot see: it verifies the LABEL exists in the pipeline, never
  that the range still contains it.

**The FIXTURE was the bug, not the assertion.** The `child_process` double
modelled `claude plugin install` as a pure no-op, so G16 "succeeded" leaving no
trace, G17's post-install re-scan found 0 active role-plugins, and its R9.13
recovery reinstalled — every run made TWO install calls. Relaxing to `>= 1` would
have passed while the test described the RECOVERY path and claimed to pin the
happy one. The double now writes the one side effect the pipeline reads back.

**Two ordering traps, each of which would have shipped a vacuous test:**

- G15's else-branch picks `compatibles[0]`, so listing the standing pick FIRST
  makes the keep-branch test pass with the keep-branch DELETED. The default goes
  first, which is what makes the branch load-bearing.
- **One neuter certifies only half a cited row.** Disabling G16 reddens ONE test;
  mis-resolving G15 reddens BOTH. That asymmetry is the reason both gates are
  cited rather than whichever one was convenient.

**Then R12.3 — 26 → 25 (`7cd4de7d`), and its row was INTERNALLY INCONSISTENT.** It
cited `:3149-3152 (ChangeTitle::G15)`, and 3149-3152 is squarely inside **G14d**:
the range named one gate, the qualifier named another, and the qualifier check
passed regardless because it only proves the LABEL exists in the pipeline. **Two
guesses from reading were wrong; the ops trace settled it in one run.** On a title
CHANGE the enforcer is G14d — it uninstalls EVERY enabled role-plugin incompatible
with the new title, so G15 finds nothing to swap and logs "Cleaned stale
role-plugins". G15's swap branch is still load-bearing on the path G14d declines by
its own condition (an agent with NO old title carrying a stale plugin). Both cited,
each with its own test and neuter. **Recorded rather than hidden: the two gates are
partly REDUNDANT** — neutering either leaves the end state correct and only the
path-specific assertion reddens, so a lone end-state assertion would have survived
losing one defender.

**A mock leak the batch exposed, fixed at the `beforeEach`:** `getPluginsForTitle`,
set inside the R20.5 test, persisted into R12.3 and routed it through the
keep-branch — no uninstall, no install, `success === true` throughout.
`clearAllMocks()` clears CALLS, not IMPLEMENTATIONS.

**THREE consecutive rows had drifted line ranges (R20.5 ~74 lines, R12.3 into the
wrong gate, R4.4 ~74 lines).** This is not bad luck — it is what a citation format
whose only machine-checked half is the LABEL produces over time. Assume the range
is wrong and re-measure it on every row you touch.

**MEASURED 2026-07-30, and it reframes the whole campaign: 46 of the map's qualified
citations point at the WRONG LINES — 21 distinct rules.** I stopped chasing R4.4's
range (its THIRD wrong citation: `:4956` landed inside `ChangeHook`, then
`:5128-5137`, then `:5304-5320`, each corrected by hand and each rotting again) and
asked instead why the same defect keeps recurring. Answer: **only ONE half of a
citation is machine-checked.** The qualifier check proves the LABEL exists in the
pipeline; nothing has ever checked that the cited RANGE contains it.

### RESOLVED 2026-07-30 — the range is GONE from every gate-qualified citation (`d5ba8d23`)

**The "46 violations" figure was my own broken instrument, and correcting it four
times is worth more than the number.** 46 could not be right: there are only **31**
gate-qualified citations in the whole map, and a violation count larger than its
population is a parse bug, not a finding. Four errors, each inflating:

1. **strip-then-split cross-produced** every qualifier in a row against every
   citation in it (→ the phantom 46);
2. the needle matched **JSDoc gate manifests** (`* G10: Idempotency check`) rather
   than `ops.push` emissions — 764 textual hits vs 492 real ones;
3. it searched the **whole file**, though gate numbers are per-pipeline local and
   reused (`G10` is one gate in `InstallElement`, another in `DeleteAgent`);
4. it knew only **one of two gate forms** — a gate is `ops.push(\`G07: …\`)` when
   hand-rolled and `{ id: 'G07', … }` under `runGateSequence` — so it declared four
   live `ChangeClient` gates missing.

**The honest measurement: 22 of 31 (71%) had drifted.** Every drift POSITIVE, +63 to
+623 — not random rot but the mechanical consequence of code inserted above. Positive
control: `R12.3`'s `G14d` resolved to 3108/3125/3140, inside its cited 3029-3161, the
row hand-verified earlier that session.

**DECIDED (delegated authority) — drop the range, keep the qualifier.** A coordinate
nothing checks is not documentation; it is a lie with a timestamp. 28 rows re-cited to
`file (Pipeline::Gnn)`; a range stays legal only where no gate label exists (route
handlers, `lib/` helpers), because nothing better exists for those. All 28 qualifiers
verified to RESOLVE afterwards — pipeline function found, gate found inside it, both
forms — so the change loses no information.

A new ratchet test, `a gate-qualified citation carries NO line range`, makes the
combination impossible, and **caught 3 rows my corrected script still missed on its
first run** (`InstallElement::EXE`, `InstallElement::PG01`, `ChangeTitle::EXE` — my
regex matched only `G\d+`; the real grammar also admits `PG\d+` and `EXE`).

**Complementary neuter pair, each reddening a DIFFERENT test** — required because
deleting one half of a redundant pair obliges proving the survivor bites:
re-adding a range → `carries NO line range` fails; `G07`→`G99` →
`every gate qualifier names a real gate inside that pipeline` fails.

**Correction owed to the ACTIVE PLAN** (`~/.claude/plans/iterative-foraging-wadler.md`,
finding **J**): it states `lib/gate-transaction.ts` has **ZERO production callers** and
drives Phase 5 off that. **False.** `runGateSequence` is dynamically imported at
`services/element-management-service.ts` lines 3830, 4640, 4816, 6166, and `ChangeClient`
runs its G07/G08/G09 through it. The ratchet test already encodes this (TRDD-B6NUEGMP
names ChangeClient "the runner's first production caller"); only the plan is stale.
Re-scope #68 against the real caller set before starting it.

### DONE 2026-07-30 — R8.3 (`c895b72b`) and R4.4 (`bfcf8761`). Ratchet **25 → 23**.

Both went in off `r3-r9-team-governance.test.ts`, which already drove `DeleteTeam` — no new fixture.

- **R8.3** (`DeleteTeam::G05`). The risk was never "does the loop run" but "does it reject ONLY
  what it should" — a guard that rejected every pending request satisfies the rule's own case
  perfectly. So the fixture carries one record per branch: a pending transfer for THIS team, a
  pending non-transfer for THIS team, a pending transfer for ANOTHER team, and an already-approved
  one. The last two ARE the test. Nothing is mocked: `governance-request-registry` resolves through
  `getStateDir()`, already redirected, so the real registry writes a real file in the fake home and
  the effect is read back off disk. Neuters: dropping `involvesTeam`, and dropping the
  `status !== 'pending'` filter — each reddens it.
- **R4.4** (`ChangeTeam::G07`). One expression, `(desired.role || 'member')`, so the danger was a
  VACUOUS test: asserting MEMBER after a role-less join passes just as well against a guard that
  ignores `desired.role` and hardcodes it. The explicit-role case is therefore the vacuity control,
  and the neuter shows they are independent — defaulting to `'autonomous'` reddens the default case
  and leaves the control green. R4.4's plugin clause is NOT re-asserted here: it is ChangeTitle's
  G15/G16, already pinned in `r19-maintainer-title.test.ts`, and re-proving it would mean growing a
  plugin-resolution fixture to make a weaker copy of an existing pin. The test title was corrected
  to match what it actually asserts.

**Fixture fact that cost a cycle and will recur:** ChangeTeam's manager gate is **G01b** and calls
**`getManagerId()` directly** — seeding `loadGovernance`'s return value does nothing and the gate
still refuses. Diagnosed from the ops trace, which named it in one line, after a first run failed
with a bare `success === false` naming no gate. The success assertions now carry `result.error` +
the ops trace in their message so that cannot recur.

**NEXT ACTION — 23 remain. Batch by the FILE the guard lives in:**

- **R4.4** ("joining a team auto-assigns MEMBER + the programmer plugin"). Its row now
  cites `services/element-management-service.ts (ChangeTeam::G07)` — **do not look for
  a line number, there deliberately is none**; `grep -n "G07:"` inside `ChangeTeam` is
  the lookup, and it stays correct as the file moves. (Its three successive wrong
  ranges — `:4956` inside `ChangeHook`, `:5128-5137`, `:5304-5320` which is the REMOVE
  branch G04a/G04b — are what motivated dropping the range at all.) Uncited by a test,
  so pinning it still lowers the ratchet. The guard is one line: `ChangeTitle(agentId, desired.role ||
  'member', { authContext })` — the `|| 'member'` IS R4.4's first half, and its
  second half (the programmer plugin) is the G15/G16 chain this session just pinned,
  so the test is "ChangeTeam with NO role ⇒ title member ⇒ `claude plugin install
  ai-maestro-programmer-agent`". **The cost is the FIXTURE, not the test**: ChangeTeam
  needs a MANAGER on the host (team ops are manager-gated, R9/R10) plus a team with a
  COS. `tests/governance/r4-team-composition.test.ts` and `r3-r9-team-governance.test.ts`
  both already drive ChangeTeam — start from whichever one already seeds a MANAGER
  rather than porting the r19 fixture.
- **R8.3** (`DeleteTeam::G05`, "team deletion cancels pending transfers") wants the
  same team fixture — do it in the same batch, not separately.

- Batch them **by the FILE the guard lives in**. Note 9 of the 26 are `.tsx`
  components (R4.8, R7.1/7.2/7.3/7.7/7.8/7.9, R11.6, R17.16); a "guard" in a
  React component is not a server-side refusal, so those may want a
  `BEHAVIOURAL` verdict rather than an adversarial refusal test.

**Three facts measured 2026-07-30 that make the G15/G16 batch CHEAP — they remove
the obstacle this card previously assumed.** I had expected G15 to be unreachable
without seeding a marketplace on disk. It is not:

1. **`getCompatiblePluginsForTitle` never returns empty for a valid title**
   (`:1927-1951`). When `getPluginsForTitle` yields nothing it falls back to
   `TITLE_PLUGIN_MAP[title?.toLowerCase()]` and returns the hardcoded default. So
   a bare fixture with `getPluginsForTitle → []` still reaches G15's selection
   branch and G16's install — **no marketplace seeding, no `seedSourcePlugin`.**
2. **That `.toLowerCase()` is CORRECT, not the old footgun.** `TITLE_PLUGIN_MAP`
   here is the module-local **lowercase-keyed shadow** built at `:290-292` from
   the ecosystem export, which is imported aliased as `ECOSYSTEM_TITLE_PLUGIN_MAP`
   (`:41`). Re-verified this turn; it is the same shadow the 2026-07-26 false
   positive turned on, so do not "fix" it again.
3. **G16's `installPluginLocally` is LOCAL to this file** (`:1678`, exported), not
   the role-plugin-service one — it shells out to `claude plugin install`. So the
   assertion is the REAL CLI op captured by the `child_process` mock, which is a
   stronger pin than a mocked service call. The r19 fixture needs one addition to
   use it: it kept `mockExecFileImpl` but not a calls ARRAY (the r3-r9 and r20
   files both carry `mockExecFileCalls` — copy that shape).

**All three held when the batch ran**, and the predicted cost was right: the calls
array plus the settings side effect was the whole of it. The last sentence of the
earlier plan — "R20.5's half belongs topically in `r20-marketplace-governance.test.ts`,
and porting the registry-file sync is the only real cost left" — was WRONG and the
port was never needed. R20.5's guard is the SAME `ChangeTitle` G15/G16 the r19 file
already drives, so the pin costs one test in a file that is already wired, not a
fixture migration. Topical tidiness is not worth re-deriving a working fixture; a
cross-file pointer in each row's Test column says the same thing for free.

**Take the count from the ratchet's own failure message, never a hand grep.**
Mine said 27 because `R[0-9]+\.[0-9]+` does not match the lettered sub-rule
`R17.18a` — a count from the wrong pattern reads as a clean win, and I was one
commit from locking in a number my own awk had invented.

## ⏵ STATE — 2026-07-27 (superseded by the block above)

USER mandate (2026-07-26): *"the api implement the full all-in-one design and the governance rules
enforced and tested"*, scoped to **Claude only** — codex/gemini/opencode/kiro stay parked.

**The number that motivates this:** `docs/GOVERNANCE-ENFORCEMENT-MAP.md` records **134 sub-rules
with a real code guard and NO test**. Only **5** have both (R25.2, R28.1, R41.1, R41.4, R41.5). The
ratchet `tests/governance/enforcement-coverage.test.ts` carries this as
`MAX_ENFORCED_WITHOUT_TEST = 134` — a counter that is allowed to go DOWN and never up.

**Why this must precede the TRDD-DQ6XN2VP retrofit, and is not merely nice to have.** That retrofit
rewrites the control flow of all 26 mutating pipelines. Its own acceptance says the SUCCESS path
must not move. With 5 rules pinned, "the success path did not move" is a hope; with the guards
pinned it is a measurement. Refactoring 26 pipelines whose governance behaviour nothing observes is
how a rule silently stops being enforced while every test stays green — and an unenforced rule is,
by R51.9, documentation.

**BATCH 1 LANDED (`7bec032e`) — debt 134 → 117.** 17 of its 22 pinned in
`tests/governance/r17-r11-core-plugin-binding.test.ts`. Two findings worth more than the tests:

- **The map's own citations rot.** R17.17 was cited at `server.mjs:1709-1742` (the guard is at
  `1766-1799`) and R17.20 at `1777-1793` — which is *R17.17's* code, not R17.20's (`1801-1869`).
  Both corrected. A map citing the wrong lines is worse than one citing none: it reads as coverage
  and sends the next reader to code that does something else. **Every batch now verifies the cited
  range before writing against it, and reports corrections rather than editing the map.**
- **R17.17 + R17.20 are deliberately NOT pinned and stay counted as debt.** Their guards are real
  but sit inline in `server.mjs::startServer`, which binds sockets on import — there is no seam to
  call. Counting them is the honest record; extracting a seam (precedent:
  `lib/session-validate-server.mjs`) is the work that clears them, and it is production code, so it
  belongs to a separate TRDD, not to a test batch — **TRDD-L42SKUBW**, registered as this TRDD's
  EHT so "every enforced rule pinned" cannot be declared complete while two remain unobservable.

**The 0-IMPACT trap every remaining batch must carry.** Batch 1 wrote real directories under
`~/agents/` before self-catching it: `lib/ecosystem-constants.ts` resolves `homedir()` via a runtime
`require('os')` INSIDE each function body, and `vi.mock('os', …)` intercepts only STATIC imports. The
fix is a PARTIAL mock of `@/lib/ecosystem-constants` overriding the path FUNCTIONS
(`importOriginal`, spread `...actual`) — never the `os` module.

**BATCH 2 LANDED (`2298646a`) — debt 117 → 101.** 16 of 17 pinned. Three things it settled:

- **Wrong map citations are a PROPERTY of the map, not an accident.** Batch 1 found 2; batch 2 found
  **6 pointing at an entirely different guard** plus 4 off-by-a-few, and recorded 4 second
  enforcement sites the map never listed. Two batches, same finding ⇒ assume every unverified
  citation is suspect until executed.
- **R9.9 is the THIRD rule blocked on one missing `server.mjs` seam** (with R17.17/R17.20). That
  makes TRDD-L42SKUBW structural rather than a tidy-up.
- **An absence-invariant is still pinnable** — run the proof backwards. R9.12 forbids a filter, so
  there is nothing to delete; it is pinned by ADDING the forbidden filter and watching it fail.

**Verification found a real production bug (TRDD-F4UUM8RZ, `62b5e58d`).** The full suite failed
once on an unrelated file; `stopAgentInvariantsWatchdog()` stopped the schedule but not the sweep,
so a stop could be followed by a writer re-creating files — the re-appearing-workdir class. My first
pinning test for it **passed with the fix neutered**, i.e. pinned nothing; caught only by the
neuter check. Worth carrying forward: the neuter check is not a formality for the sub-agents, it is
the whole method, and it catches the orchestrator too.

**BATCH 3 LANDED (`59893d08`) — debt 101 → 88.** All 13 of R6 pinned, 96 tests. Two caveats
recorded rather than glossed, and both became TRDDs: **R6.8 is pinned at LAYER 1 only** (its other
two layers are prompt-level, in the role-plugin repos, with no server surface), and **R6.10 is
pinned at the WEAK contract the code actually has** — any truthy `inReplyToMessageId` unlocks a
reply-only edge, repeatedly, unverified. Writing the stronger test and then editing production to
pass it would have been a governance change smuggled in by a test batch, so it is
**TRDD-VLBVO0ZP** instead. **TRDD-2XV78BND** carries two text-vs-code disagreements where the CODE
is right and the TEXT is stale — the dangerous direction.

**RUNNING TALLY OF MAP DEFECTS (3 batches): 8 citations naming the WRONG guard, 8 imprecise ranges,
6 enforcement sites never recorded at all.** That is the map's steady state, not a run of bad luck —
so a citation is evidence only once someone has executed it.

**PHASES 1 + 2b LANDED 2026-07-26 (debt unchanged at 66 — these were instrument work, not pins).**
Commits `b07cfd78`, `c5173e59`, `17471dd3`, `08bd2800`, `f379b2b7`.

- **The ratchet's own guard check had two silent holes** (`b07cfd78`): it validated only the FIRST
  citation of a multi-guard row (so R6.9's second guard was never checked) and captured a range's
  END without using it (so `foo.ts:10-999999` passed). Both fixed, both mutation-proved.
- **Guards may now cite a gate NAME** — `…:6442-6465 (DeleteAgent::G02)` (`c5173e59`). A label
  travels with the code; a line number does not. 17 rows qualified — only those whose cited range
  contains EXACTLY ONE gate. Gate ids are per-pipeline local and reused (G01 means four different
  things), so the citation MUST be `<Pipeline>::<Gnn>`; a bare `Gnn` is ambiguous four ways.
- **The new gate test had a false-green and shipped one commit later** (`17471dd3`): commenting out
  DeleteAgent's five G02 pushes left it GREEN, because a regex over raw text cannot tell code from a
  comment. Fixed; now proved four ways (bad gate, bad pipeline, gate commented, gate deleted).
  **Deletion alone would have passed — try the mutation a developer actually makes.**
- **Part II is now checked against the code on every test run** (`b07cfd78`):
  `python3 scripts/aio-gate-coverage.py --check`. Until then the script never opened the file it
  feeds, so the table was a hand-copied snapshot of an analysis that could not see it.
- **A rotted prose count was removed, not re-checked**: the header claimed "only 5 rules have both a
  guard and a test" while the true figure was 75. The machine-checked constant beside it
  (`MAX_ENFORCED_WITHOUT_TEST`) never drifted. The doc now states no standalone number.
- **TRDD-W8NA7ROZ** (EHT) records the 15 rows that could NOT be gate-qualified — 5 with no label in
  range, 10 whose citation names no single guard (R18.8/R18.9 cite a 391-line range spanning
  ChangeCLIArgs into ChangeClient with 8 gates in it). Not converted: laundering a too-coarse
  citation into an authoritative-looking one is worse than leaving it visibly coarse.
- **Phase 2b — `tests/helpers/fake-ecosystem-home.ts`** (`f379b2b7`): the 0-IMPACT containment idiom
  was hand-rolled in 8 files; now one definition, adopted by r20 (23 lines → 4). It adds a guarantee
  no copy had — it REFUSES a root that is not under a temp dir — and its own test watches it refuse.
  Remaining 7 sites can adopt it incrementally; it is additive.

**BATCH 6 LANDED 2026-07-27 (`bd701701`) — debt 52 → 48.** R4.1/R4.2/R4.6/R4.7 pinned in
`tests/governance/r4-team-composition.test.ts` (9 tests, 3 mutation runs, all killed with
positive controls surviving). The first batch needing NO fixture at all: the guards live in
`validateTeamMutation`, a pure function, so nothing is mocked and nothing can be mocked wrong.

- **Defect #9 — R4.4's citation named a DIFFERENT PIPELINE.** The map cited
  `element-management-service.ts:4956`, which is inside `ChangeHook`; the real guard is
  `ChangeTeam::G07` (:5128-5137). Corrected. R4.4 stays untested and counted — correcting a
  citation is not pinning a rule, and conflating the two is how the map got its reputation.
- **Two more unrecorded second sites** (tally now 8): R4.7 also at `ChangeTeam::G04a` (:5056),
  R4.1 also at `ChangeTeam::G05` (:5110).
- **I overclaimed once and caught it**: a `describe` titled "R4.5 — no duplicate membership".
  R4.5 is genuinely UNENFORCED — `validateTeamMutation` has NO duplicate check (verified: no
  `Set(`, no indexOf dedupe, no refusal), so `agentIds: ['a','a']` is accepted. Retitled to what
  it pins; the map row stays UNENFORCED. **Manufacturing coverage for an unenforced rule is the
  exact failure this campaign exists to remove — including when I am the one doing it.**
- **A test expectation of mine was wrong, not the code**: `sanitized` carries a field ONLY when
  validation CHANGED it (`createTeam` reads `sanitized.agentIds ?? data.agentIds`,
  team-registry.ts:320). Pinned the real contract instead.
- **Method note:** my first mutation run printed no counts at all — the grep missed vitest's
  ANSI codes. A mutation run whose output you cannot read is not a mutation run.

**NEXT BATCH — R7 (6 rules), and it is a NEW MODALITY.** All six guards are React components /
hooks (`TeamListView.tsx`, `TeamCard.tsx`, `TeamOverviewSection.tsx`, `useGovernance.ts`), and
their rules are genuine UX requirements (submitting guards, spinners, error messages, blocked
badge, UUID resolution, loading state) — so client-side enforcement is CORRECT here, not the
"a check in the client is no check" hole. Verified the repo can test `.tsx`:
`tests/unit/password-dialog.test.tsx` opts in per-file with `// @vitest-environment jsdom`
(the config default stays `node`). R4.8 belongs with that batch for the same reason.
After R7, the remaining families are R1 (5), R10 (4), R17 (4), R2/R8/R19/R37/R39 (3 each).

**BATCH 5 LANDED 2026-07-27 (`73856fe0`) — debt 66 → 59.** All 7 of R5 (transfers) pinned in
`tests/governance/r5-transfer-governance.test.ts`, 19 tests. First batch whose guards are ROUTE
HANDLERS, and that changes the method in three ways worth carrying to every route-shaped batch:

- **No `ops` trace exists**, so the honest substitute is to drive the real exported `POST` with a
  real `NextRequest` and fake only the stores/authority beneath the guard. The guard logic is never
  mocked, which is what keeps the mutation-kill property.
- **Status-only assertions are false-greens here.** The create route returns 400 from FIVE
  different guards and 404 from two, so `expect(status).toBe(400)` passes while a completely
  different guard refuses. Every case pins a fragment of its own guard's message.
- **Fixture ordering is load-bearing.** The route checks authority → self-transfer → source exists →
  agent-in-source → destination exists → COS-immobility → source-is-closed → duplicate. A fixture
  tripping an EARLIER guard gives a passing test for the wrong reason.

**All 7 citations were CORRECT** — the first batch where the map's guard column survived
verification intact, against a running tally of 8 wrong ones. Worth noting so the tally stays a
measurement and not a slogan. Reading the code did add one site the map lacked: **R5.5 has TWO
enforcement points** (create-time, and a re-check on the approval path, because a team can be
deleted between request and approval); both are now cited.

**8 mutation runs, one per guard, each committed-before-mutated and restored by `git checkout`:**

| mutation | named test | positive controls |
|---|---|---|
| R5.2 authority removed | FAILED (403) | 3 still passed |
| R5.3 resolver-authority removed | FAILED (both 403 cases) | 2 still passed |
| R5.4 COS-immobility removed | FAILED (400) | passed |
| R5.5 create-time check removed | FAILED (404) | approval-time test **still passed** |
| R5.5 approval-time check removed | FAILED (404) | create-time test **still passed** |
| R5.6 self-transfer removed | FAILED (400) | — |
| R5.7 single-closed-team removed | FAILED (409) | 3 still passed |
| R5.8 duplicate removed | FAILED (409) | different-destination control passed |

The two R5.5 rows are the interesting pair: each mutation failed exactly ONE of the two tests, which
is the proof that the sites are independent rather than one test riding on the other's guard.

**BATCH 6 — HALF DONE (`32d890f2`). Citations verified and corrected; TESTS NOT YET WRITTEN, so the
debt is still 59.** Verifying R18 first (as this TRDD requires) turned into an audit of all 22
gate-qualified rows and found that **the Phase-1a qualifier pass was unsound**: it derived gate
names FROM line ranges that were already ~⅓ wrong, producing precise-looking wrong claims. 3 rows
corrected, 7 stripped, 6 kept. The full record and the rule adopted ("a qualifier may only be added
by READING the gate and the rule together — never derived from a range, never in bulk") are in
**TRDD-W8NA7ROZ**, which also now carries the 7 stripped rows as proven-wrong ranges.

All 8 R18 rows are re-cited from a complete read of `ChangeClient` (5517-5908) and every original
was wrong or too coarse — including R18.5, which Phase 1a had qualified `ChangeClient::G03` (the
no-op check) when its guard is the G05b core-plugin safety net. R18.9/R18.10 are absence-invariants
(neither `syncRolePlugin` nor `governanceTitle` appears anywhere in ChangeClient), so R18.9 cites
the whole function body — for an absence invariant that is the PRECISE citation, not a coarse one.

**BATCH 6 COMPLETE (`b74b01bf`) — debt 59 → 52.** 7 of R18's 8 pinned, 15 tests, 7 mutation runs.

**The harness question answered by MEASURING instead of assuming.** I first deferred this batch on
the grounds that it meant duplicating a 24-mock, 200-line harness a fifth time. That premise was
false and I had not checked it: the r17-r11 harness is 24 mocks because it drives CreateAgent +
InstallElement + ChangeTeam. **`ChangeClient` needs SEVEN** — `gate0Auth` short-circuits on
`isSystemOwner`, so the entire authorization module drops out, leaving the registry, the config
scanner, the plugin store and two adapter lookups. Before deferring work on a cost, measure the cost.
(The shared-harness extraction is still worth doing for the OTHER four files; it is no longer a
blocker for anything.)

**R18.8 is the one non-pin and stays counted.** Its "emits a loss report" half lives in the
converter's warning collector; its "operation MUST still proceed" half is the ABSENCE of an abort.
A test for it would assert that nothing happened — which also passes on a pipeline that does
nothing at all. A test that cannot fail is worse than an honest count.

**R18.9 is pinned at its CONSEQUENCE, and the test says so.** `syncRolePlugin` is module-internal so
no spy can watch it; what is pinnable is that the role-plugin travels the ordinary plan path and is
installed for the new client via the adapter. Proved by mutation: drop the role-plugin from the
snapshot and the test fails.

**THE MUTATION FINDING, worth more than the tests: a single-line mutation that leaves the test GREEN
does not always mean the test is bad — it can mean the property has DEPTH.** R18.1 survived two
separate single-abort mutations because ChangeClient defends "never uninstall before a replacement
is ready" with **two independent aborts** (the catch-branch at :5717 and the fall-through at :5723).
My fixture takes the catch path, so removing the fall-through changed nothing, and vice versa. Only
removing BOTH killed the test. **For a redundantly-guarded property the honest mutation removes the
whole defence, not one line** — and telling that case apart from a genuinely-vacuous test requires
reading which path the fixture actually takes, not staring at the green tick.

**A vitest filter footgun that cost a wrong first reading:** `-t "R18.1"` also matches **R18.10**.
The first neuter run reported "15 tests | 11 skipped" — 4 ran, from two different describes — and I
briefly read it as R18.1 alone surviving. Read the test NAMES, not just the count.

| mutation | named test | controls |
|---|---|---|
| R18.1 — BOTH aborts removed | FAILED | positive control passed |
| R18.2 — scan-failure abort removed | FAILED | ordering + disabled-plugin tests passed |
| R18.3 — native-first preference removed | FAILED | both fallback tests passed |
| R18.5 — core-plugin safety net removed | FAILED | no-duplicate test passed |
| R18.7 — `restartNeeded` removed | FAILED | abort-case test passed |
| R18.9 — role-plugin dropped from the plan | FAILED | — |
| R18.10 — title folded into the registry write | FAILED | abort-case test passed |

NEXT ACTION: **batch 7 — R7 (6 rules).** Its guards are React components + a hook
(`components/sidebar/TeamListView.tsx`, `components/sidebar/TeamCard.tsx`,
`components/teams/TeamOverviewSection.tsx`, `hooks/useGovernance.ts`), which is a THIRD guard shape
after pipelines and routes — no `ops` trace and no HTTP surface, so decide the observation method
before writing (render-level assertions, or demote rows whose "guard" is only a conditional render).
**Verify the citations first**, as always. Then R4 (6), R1 (5), R17 (4), R10 (4), then the ~1-3 tail
grouped BY GUARD FILE.

After R18: R7 (6), R4 (6), R1 (5), R17 (4), R10 (4), then the ~1-3 tail grouped BY GUARD FILE.

Deferred from Phase 2 as tooling, not pins: `scripts/verify-zero-impact.sh` (2a) and the
`setupFiles` timeout unification (2b tail).

One sub-agent at a time (USER spawn rule), tests only.

## The batch plan

Each batch is one sub-agent, one new file under `tests/governance/`, disjoint rule sets.

| Batch | Rules | Untested sub-rules | Status |
|---|---|---|---|
| 1 | R17 core-plugin + R11 title-plugin binding | 22 | **landed — 17 pinned, 2 no-seam, `7bec032e`** |
| 2 | R9 manager requirement + R3 role hierarchy | 17 | **landed — 16 pinned, 1 no-seam, `2298646a`** |
| 3 | R6 communication graph | 13 | **landed — 13/13 pinned, `59893d08`** |
| 4 | R20 marketplace governance | 23 | **landed — 22 pinned, 1 shell-only, `8e77d834`** |
| 5 | R5 transfers | 7 | **landed — 7/7 pinned, `73856fe0`** |
| 6 | R18 client-change continuity | 8 | **landed — 7/8 pinned, 1 honest non-pin, `b74b01bf`** |
| 7 | R7 team UI surface | 6 | pending — a THIRD guard shape (components/hook) |
| 8 | the remainder (R1, R4, R8, R10, R39, …) | ~38 | pending — group BY GUARD FILE |

## The constraints every batch carries, and why each exists

1. **TESTS ONLY — never touch production code.** A guard that looks wrong is REPORTED, not fixed.
   Two reasons: DQ6XN2VP is about to rewrite these same files, and a test author who "fixes" the
   guard to match their reading of the rule has silently changed governance.
2. **Never edit `docs/GOVERNANCE-ENFORCEMENT-MAP.md`.** Batches run against a shared file; the
   orchestrator folds the Test column in once per batch. (Three agents editing one map is a merge
   conflict, not parallelism.)
3. **Never mock the thing under test.** The test calls the REAL exported guard; only genuinely
   external I/O (network, tmux exec) may be faked. A test that mocks the guard proves the mock.
4. **Assert the REFUSAL, not the happy path.** The property is "this guard says no". A test that
   only proves the allowed case still passes after the guard is deleted, which is the exact failure
   mode that produced 134 untested guards in the first place.
5. **0-IMPACT.** No writes to `~/.aimaestro`, `~/agents`, `~/.claude`; no agent created or deleted.

## What "pinned" means here

A sub-rule is pinned when deleting or weakening its guard makes a named test FAIL. Anything less —
a test that exercises the guard without asserting its refusal, or that asserts on a mock — is
recorded as NOT pinned, because it would carry the ratchet number down while leaving the rule as
unobserved as before.

## The three non-test outcomes a batch may report

Each is worth more than a test, and none is fixed by the batch that finds it:

- **no-guard-found** — the map cites a guard that is not there. The map is wrong, or the guard was
  removed. Either way the rule is UNENFORCED and the map is overstating coverage.
- **guard-mismatch** — a guard exists but enforces something other than what the rule says. This is
  the `INVENTED`/`CONTRADICTED` case arriving from the other direction.
- **rule-ambiguous** — the rule cannot be tested as written. That is a defect in the RULE, and it is
  a PRRD/governance proposal, not a test.

## Verification

- Per batch: `bash scripts/with-node.sh npx tsc --noEmit` and the batch's own vitest file, both
  clean. (The Node-22 wrapper is mandatory — a bare `yarn`/`npx` aborts on `engines`.)
- Per batch landing: the orchestrator updates the map's Test column for the pinned rows and lowers
  `MAX_ENFORCED_WITHOUT_TEST` by exactly the number pinned. The ratchet then holds the gain.
- Program end: full suite green; `MAX_ENFORCED_WITHOUT_TEST` at its floor; every remaining row
  explained (BEHAVIOURAL, or an open defect TRDD).

## Acceptance

- [x] Batch 1 — R17 + R11 (22 → 17 pinned; R17.17/R17.20 blocked on a `server.mjs` seam)
- [x] Batch 2 — R9 + R3 (17 → 16 pinned; R9.9 blocked on the same `server.mjs` seam)
- [x] Batch 3 — R6 (13/13 pinned; 2 caveats filed as TRDD-VLBVO0ZP + TRDD-2XV78BND)
- [ ] Batch 4 — R20 (23)
- [ ] Batch 5 — R18 + R5 (15)
- [ ] Batch 6 — the remainder (~44)
- [ ] Map Test column updated for every pinned row
- [ ] `MAX_ENFORCED_WITHOUT_TEST` lowered to match, and the ratchet green
- [ ] Every guard defect found is filed as its own TRDD rather than fixed in passing
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-26T04:48:14+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
