---
trdd-id: EE5YX5LF
title: A failed ChangeTitle demotion can leave the host with no MANAGER and every team blocked
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-07-27T11:28:44+0200
updated: 2026-07-27T12:05:00+0200
created-by: claude-ai-maestro
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
task-type: bugfix
severity: high
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
approved: true
approval-judge: claude-ai-maestro
approval-datetime: 2026-07-27T11:28:44+0200
parent-trdd: DQ6XN2VP
npt: []
eht: []
blocked-by: []
relevant-rules: [9, 10, 11, 50, 51]
labels: [aio, governance, blast-radius]
---

# A failed ChangeTitle demotion can leave the host with no MANAGER and every team blocked

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-27

**DONE — reorder + dedicated test, both neuter-verified.**

The test (`TRDD-EE5YX5LF: a demotion whose title write FAILS must not have touched governance`) makes
G14 fail the way it most often fails in production — the registry write does not land — and asserts
`removeManager` was never called, `blockAllTeams` was never called, and no team is blocked. Neutering
the ordering guarantee (letting G14 fall through instead of refusing) fails it with
`expected "vi.fn()" to not be called at all, but actually been called 1 times`.

Done: G14 now runs immediately before G10 (`~:2472`). Pre-flight confirmed as the TRDD required —
G10-G13b branch only on the in-scope `oldTitle`/`newTitle` locals and read governance.json via
`getManagerId()`; none reads the agent's title back from the registry, and `effectiveTitle` is
computed at Gate 1. tsc 0, 251/251.

**What the reorder EXPOSED (this is the bigger finding).** Making G14 run first broke 7 tests in
`r3-r9-team-governance.test.ts`, and every one of them was green for the wrong reason:
- 4 R9 tests asserted the G10/G13 blocking cascade **while the pipeline they drove was returning an
  ERROR** — G14 was failing at its disk read-back (the fixture never seeded `registry.json`), and
  they only saw the cascade because G10/G13 ran BEFORE G14. The bug under repair was propping up
  its own tests.
- 2 "positive control" tests asserted `expect(result.error).not.toMatch(/specific message/)`, which
  is satisfied by **every other error** — including the G14 failure. Now assert `success === true`.
- 1 DeleteAgent hard-delete test passed its `G08b` registry verification **by reading the
  developer's REAL registry.json**, which naturally never contains a synthetic test agent. The
  `statePath` seam (TRDD-N7X4KDQ2) made that gate read the fixture's file, where it correctly
  reported the agent was still present until `deleteAgent` was modelled.
`seedAgents()` now seeds `registry.json` on disk plus write-through `updateAgent`/`deleteAgent`, so
this class is fixed for every future test in the file.

**REMAINING (the acceptance gap, stated plainly):** the reorder itself has **no dedicated test**.
The 7 repaired tests pass in BOTH orderings, so they do not pin it. Write the test named in the
checklist — force G14 to fail on a MANAGER demotion, assert `getManagerId()` unchanged and no team
blocked — and neuter-verify it by reverting the gate order.

---

**ORIGINAL NEXT ACTION (superseded):** decide between REORDER and COMPENSATE for `ChangeTitle` gates G10-G14
(`services/element-management-service.ts` ~`:2472-2625`), then implement with a test. Read the
"Two candidate fixes" section — the recommendation is REORDER, and the reason is that it PREVENTS
the bad state rather than repairing it.

**The bug, exactly.** `ChangeTitle` mutates host-wide governance BEFORE it writes the title, and
the title write can return early on failure with nothing undone:

| gate | line | mutation | condition |
|---|---|---|---|
| G10 | ~`:2475` | `removeManager()` — clears governance.json | `oldTitle === 'manager'` |
| G10b | — | blocks ALL teams + hibernates their agents | follows G10 |
| G11 | ~`:2498` | `updateTeam(chiefOfStaffId: null)` | agent was a team's COS |
| G12 | ~`:2536` | `updateTeam(orchestratorId: null)` | agent was a team's ORCH |
| G13 | ~`:2553` | `setManager(agentId)` | `newTitle === 'manager'` |
| **G14** | ~`:2618` | `updateAgent({governanceTitle})` — **`return result` on failure** | always |

So demoting a MANAGER whose G14 write fails leaves: **governance.json with no manager**, **every
team blocked**, **team agents hibernated**, and **the agent still reading `manager` in
registry.json**. Per `CLAUDE.md`, a host with no MANAGER blocks every team AND refuses to wake
team agents ("assign MANAGER first") — so a single failed registry write is a **host-wide,
self-inflicted denial of service**, recoverable only by hand-editing governance.json.

**Why G14 failing is not hypothetical.** It is the gate that fails MOST readily by design: it
verifies the write actually landed (a null return, then a disk read-back mismatch). It fires on a
read-only registry, a concurrent writer, a disk-full, or any partial write — exactly the
conditions under which you least want the fleet's governance half-dismantled.

## Two candidate fixes

**(a) REORDER — recommended.** Move the G14 title write BEFORE G10-G13. If the title cannot be
persisted, nothing else has happened yet and the operation is a clean no-op. This is the same
shape as `DeleteAgent::G01c` (`9ec873a1`), where moving the cemetery archive ahead of the
demotion fixed a whole class of corruption without any rollback machinery. Prevention beats
repair, and the residual failure mode is strictly milder: if the title lands and a later
governance write fails, you get a stale manager POINTER (annoying, visible, non-blocking) instead
of NO manager (blocking, invisible until a team operation is attempted).

**(b) COMPENSATE.** Wrap G10-G13 in `runGateSequence` with undos (`setManager` back, restore the
COS/ORCH pointers, unblock teams). Strictly more machinery, and the undo can itself fail — which
for THIS state means the host stays blocked. Prefer (a); use (b) only for whatever (a) cannot
cover.

**Check before reordering:** confirm nothing in G10-G13 reads the *new* title from the registry
(they branch on the in-scope `oldTitle`/`newTitle` locals, which are computed earlier — so a
reorder should be safe, but verify rather than assume). Also confirm the G13 mesh broadcast has
no ordering contract with the registry write.

## Verification

- A test that makes G14 fail (the fixture can now do this — TRDD-N7X4KDQ2 made the registry
  verification injectable via `statePath`) on a MANAGER demotion, asserting `getManagerId()` is
  UNCHANGED and no team is blocked.
- **Neuter-verified**: revert the ordering and that test must fail.
- `bash scripts/with-node.sh npx tsc --noEmit` clean; full suite green.

## Estimated risk

MED — reordering gates in a 1200-line pipeline that four other pipelines call. Do it as a pure
move with no behavioural edits alongside, and run the whole governance suite.

## Notes and lessons learned

[^1]: [id:ATOM-EE5Y-X5LF, status:valid, keywords:"failed_title_change_blocked_every_team no_manager_on_host governance_mutated_before_persistence_verified", ocd:2026-07-27, lmd:2026-07-27]
  DO NOT mutate host-wide governance before the operation's own persistence gate has passed,
  BECAUSE the gate most likely to fail is the one that verifies the write, and by then the manager
  is already gone and every team is blocked. DO perform the verified write FIRST, so a failure is
  a clean no-op.

## Approval log

- 2026-07-27T11:28:44+0200 — MANDATE issued by claude-ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier-0 derived work under TRDD-DQ6XN2VP. No approval request was sent.

## Acceptance checklist

- [x] G10-G13 confirmed not to read the new title from the registry
- [x] title write reordered ahead of the governance mutations (or compensated, if a reorder is
      shown unsafe)
- [x] test: a failed G14 on a MANAGER demotion leaves `getManagerId()` unchanged and no team blocked
- [x] that test neuter-verified (removeManager called 1x when the ordering guarantee is removed)
- [x] tsc clean, full suite green (251/251)
