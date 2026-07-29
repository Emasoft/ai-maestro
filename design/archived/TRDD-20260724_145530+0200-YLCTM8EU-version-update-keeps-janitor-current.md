---
trdd-id: YLCTM8EU
title: version-update routing a - server keeps the janitor plugin current
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-30T00:03:29+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
implementation-commits: [25dca1bc]
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: add `ai-maestro-janitor@ai-maestro-plugins` to the server's auto-update candidate set so a
running server installs new janitor releases (routing (a); (b) is a no-op while a server is live).
**FINDING 2026-07-24 (grounded + verified):** ALREADY SATISFIED behaviorally. The
`aiMaestroMarketplace` category (default ON when the master toggle is on) enumerates candidates
DYNAMICALLY via `auto-update-service::listInstalledPluginsInMarketplace(MARKETPLACE_NAME)`
(= `listUserScopePlugins` + `listAgentLocalScopePlugins`, filtered by marketplace). The janitor IS
installed user-scope (verified in `~/.claude/settings.json`), so it is ALREADY a candidate — no
hardcoded role-plugin filter excludes it. The category comment falsely implied "8 role-plugins +
core mirror" only; FIXED (auto-update-settings.ts) to document the dynamic behavior + cite this TRDD.
The remaining lever is the master toggle (`enabled`, default OFF) — a deliberate human opt-in, same
class as the R16 rotation flag.

**▶ 2026-07-30 — BOX 2 CLOSED (`25dca1bc`). This card is COMPLETE.** The blocker was real: the three
corpus readers were module-private, so the decision could only be exercised by running the real
updates against the real host. `runTick()` fused DECIDE with MUTATE (Step 1 refreshes manifests,
Step 3 runs `ChangePlugin`); Step 2 is now **`collectUpdateCandidates(s, marketplacesTouched,
readers)`** with the readers injected and defaulting to the real ones. Behaviour is unchanged — the
branches, the de-dup key and the field propagation moved verbatim. 7 tests; `tsc` 0; full suite
**273 files / 4052 passed, 2 skipped**.

Injection rather than `vi.mock` of the module under test: fakes touch **no** filesystem, so the test
is **0-IMPACT by construction** — there is no path by which it could read or write the real
`~/.claude/settings.json` or agent registry even if it were wrong. Nothing to contain.

**FINDING — the coupling this card's own box 1 understated, and it is NOT fixed here.** Box 1 says
the master toggle is "the remaining lever". It is not the only one. The janitor is **USER-scope**,
and `userScopePlugins` ships **OFF** (`DEFAULT_SETTINGS.categories`), so its currency rests on the
single default-on **`aiMaestroMarketplace`** toggle. Turn that one off in the UI and the absorbed
version-update chore silently stops keeping the janitor current — no error, no report. That is
exactly the concern of **ai-maestro#102 / [[TRDD-5X3P79Q6]]** ("absorbed update chores must not hang
off the user-facing auto-update toggle"); the new test's honest-negative case is its **evidence**,
deliberately not its fix — fixing it is a design decision about whether an absorbed daemon duty may
be user-toggleable at all, which belongs to that card.

**LESSON — the third neuter earned its keep by NOT failing.** Stripping `agentId` from the
`agentLocalScopePlugins` branch left the suite GREEN, because the test left `localMarketplaces` at
its default (`true`) — so the same plugin was ALSO added by the marketplace branch, which passes
`agentId`, and `addCandidate` is first-write-wins. The test was asserting through a branch it does
not name. Isolating the route (every competing category off) makes it fail, and only it. Neuters A
(kill the marketplace branch → 3 named tests redden) and B (perturb the de-dup key → exactly the
de-dup test reddens) behaved first time; all three restored with no residue.

## Spec

- Add `ai-maestro-janitor@ai-maestro-plugins` to the server's auto-update candidate set
  (`lib/auto-update-settings.ts` / auto-update-service) so a running server installs new janitor
  releases (janitor confirmed (a) is the only real fix; (b) is a no-op while a server is live).

## Acceptance

- [x] With a newer janitor release available, a running server updates the cached plugin — VERIFIED: janitor installed user-scope is dynamically in the `aiMaestroMarketplace` candidate set (no filter excludes it); the auto-update master toggle is the human opt-in.
- [x] Unit/integration test covers the candidate-set inclusion — DONE (`25dca1bc`): `collectUpdateCandidates` extracted as the dep seam; `tests/services/auto-update-candidates.test.ts` (7) pins the janitor as a candidate under the SHIPPED defaults, pins the PATH (the marketplace reader must actually be consulted, so a refactor cannot stay green via another branch), the de-dup to one entry, the local-scope `agentId`/`sessionName` propagation, and the honest negative that documents the `aiMaestroMarketplace` coupling. 3 neuter runs recorded, one of which exposed a vacuous assertion in the test itself.

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-30T00:03:29+0200 — COMPLETED by ai-maestro. Both acceptance boxes checked; no NPT/EHT children to gate on. Archived per the sibling convention (`column: complete` in `design/archived/`, matching 7DRSIKVZ, SX593MDG, A77JBHC9, S5RUHJRP, CPETQBAW).
