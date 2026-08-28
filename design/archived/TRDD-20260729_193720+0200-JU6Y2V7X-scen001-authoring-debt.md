---
trdd-id: JU6Y2V7X
title: SCEN-001 carries deprecated chrome-devtools frontmatter and two steps that cannot be run through the UI
column: complete
blocked-by: []
eht: [AGHPMRVI, 39PSYD62]
created: 2026-07-29T19:37:20+0200
updated: 2026-08-28T06:33:20+0200
created-by: scenario-runner
assignee: ai-maestro-hub-session
implementation-commits: [78ee9ef6]
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
current-owner: scenario-runner
task-type: docs
min-approval-requirement: chief-of-staff
blocker-probe: sh -c 'echo PROBE-RAN; find design/tasks -iname "*AGHPMRVI*" -o -iname "*39PSYD62*" | grep -q . || echo FLOCK-TERMINAL'
blocker-holds-if: not-match:FLOCK-TERMINAL
blocker-probe-canary: match:PROBE-RAN
priority: 2
severity: minor
effort: small
labels: [scenario-improvement, scen-001, test-infrastructure]
external-refs: [reports/scenarios-runner/SCEN-001_20260729T170344Z.report.md]
---

# SCEN-001 authoring debt: stale tool frontmatter, un-runnable RBAC steps, two slow UI paths

## Problem

Four separate frictions surfaced in the 2026-07-29 run. None broke a passing step; all cost
time or forced a DEFERRED.

1. **Stale frontmatter.** SCEN-001 still declares `required_tools:` with five
   `mcp__chrome-devtools__*` entries, deprecated since 2026-04-15 (Rule 8). It has no
   `browser_stack: dev-browser`.
2. **S014 and S032 cannot be executed.** Both instruct the runner to send
   `PATCH /api/agents/<id>` with an identity header and no Bearer. That is an out-of-UI
   mutation attempt — forbidden by Rule 6 and blocked by the subagent write-guard — so both
   are permanently DEFERRED. Their assertion (401 before RBAC runs) is already pinned in
   `tests/authorization.test.ts`.
3. **Create Team sits on "Saving…" for 30-60s** while the auto-COS is created and its
   role-plugin installed. The team and COS are in `teams.json` long before the dialog
   closes; with no progress detail the state is indistinguishable from a hang, and a runner
   that gives up mid-wait leaves a half-built team.
4. **The Settings "Cemetery" nav item is overlapped by the "Update Available" banner** —
   `document.elementFromPoint()` at the item's centre resolves to the banner, so a click at
   that point activates the banner instead of the nav item.

## Root cause

(1) and (2) predate the current rules; (3) is a synchronous create path doing network work
with a binary spinner; (4) is a z-order/layout overlap in the Settings sidebar.

> **CORRECTION 2026-08-28 — item (4)'s root cause above is WRONG, measured live in `TRDD-39PSYD62`.**
> There is no z-order or layout overlap, and none is possible: the footer holding the banner is
> `position: static`, `z-index: auto`, and occupies 763-800 — it *begins* exactly where the nav's
> visible box (129-763) ends. The real mechanism is that the nav is CLIPPED (`scrollHeight` 1164
> vs `clientHeight` 634): a below-the-fold item's *computed* centre lands in the footer's band, and
> `elementFromPoint` returns whatever is painted at that coordinate. Reproduced live on
> `Plugin Updates` (centre 128,775 → `v0.37.2`); Cemetery itself now clears the fold by 30 px and
> resolves correctly. Consequently item (4)'s proposed fix — "render the banner above the nav flow"
> — would have changed nothing, and no app change was made.

## Proposed fix

- Replace `required_tools:` with `browser_stack: dev-browser` in the scenario frontmatter.
- Rewrite S014/S032 as *read-only* verification steps that cite the covering unit test, or
  delete them and note the coverage in the phase preamble. Do not leave steps whose only
  execution is a rule violation.
- Give the Create Team dialog a staged status ("creating team… creating chief-of-staff…
  installing role-plugin…") sourced from the same pipeline the ops log already emits.
- Fix the Settings sidebar overlap so the banner cannot cover a nav target (or render the
  banner above the nav flow rather than over it).

## Verification

- `yq '.required_tools' tests/scenarios/SCEN-001_*.scen.md` → null; `.browser_stack` → `dev-browser`.
- A full SCEN-001 run reports zero DEFERRED steps.
- Create Team's dialog text changes at least twice before it closes.
- `document.elementFromPoint()` at the Cemetery item's centre resolves inside that item.

## Estimated risk

LOW for the scenario edits and the overlap fix; LOW-MED for the staged status, which needs a
progress channel from the create pipeline to the dialog.

## Implemented — 2026-08-27, items (1) and (2); items (3) and (4) split out

Items (1) and (2) are scenario authoring and shipped in one edit of
`tests/scenarios/SCEN-001_title-change-lifecycle.scen.md`. Items (3) and (4) are not: (3) needs a
progress channel from the create pipeline to the dialog (a feature, LOW-MED risk by this card's own
rating) and (4) is verified only by a live `elementFromPoint` probe in the browser. Each is its own
EHT — `TRDD-AGHPMRVI` (staged status) and `TRDD-39PSYD62` (banner overlap) — and this card sits at
`blocked` on them, because a parent whose flock is open is not complete.

**On (2), the covering test was verified, not trusted.** `tests/authorization.test.ts:199-204`
pins `no Bearer token but X-Agent-Id present … -> 401`, and the file's own header names S014/S032
as its reason for existing (TRDD-0IPK36MS). The rewritten steps run those cases read-only and
assert on the reported COUNT — because a `-t` filter that matches nothing prints `46 skipped` and
still **exits 0** (measured), so an exit code cannot tell "the guard holds" from "the case was
renamed and nothing ran". The commands as written in the steps produce `1 passed | 45 skipped`
and `7 passed | 39 skipped`; the first draft of the Verify lines said `1 passed (1)` and was
corrected to the real summary shape after running them.

**A sibling finding, filed as `TRDD-IPTGKX36`:** SCEN-001 was only the file this card named. 20 of
40 scenario files still carry the deprecated `required_tools:` block, 18 with the stale CDP
prerequisite, 0 with `browser_stack:`. Surfaced by the USER asking why chrome-devtools was being
installed when dev-browser is the dependency — it is not; the stale declarations make it look so.

## Acceptance

- [x] (1) `yq '.required_tools'` on SCEN-001's frontmatter → `null`; `.browser_stack` →
      `dev-browser`; 0 `chrome-devtools` mentions remain; the CDP prerequisite is gone.
- [x] (2) S014 and S032 contain no out-of-UI mutation. The only remaining `PATCH /api/agents`
      mentions are four UI steps naming the strict route the sudo modal guards (legitimate) and two
      historical notes in the rewritten steps themselves.
- [x] (2) The steps' commands were run as written and produce the counts the Verify lines state.
- [x] The frontmatter still parses through the real setup path (`assert-clean-governance.sh 001`
      reads it and proceeds to its own verdict; `rewipe-list` still yields 4 entries).
- [x] (3) staged Create Team status — `TRDD-AGHPMRVI` terminal (`complete`, archived 2026-08-28;
      box (a) verified live: three distinct pipeline-sourced labels).
- [x] (4) banner/Cemetery overlap — `TRDD-39PSYD62` terminal (`complete`, archived 2026-08-28;
      measured live — see the correction to item (4) above).

## Approval log

- 2026-08-27T21:37:13+0200 — items (1)+(2) landed; (3)+(4) split to EHTs AGHPMRVI / 39PSYD62;
  column set to `blocked` on them (pre-block-column: ai_review).
- 2026-08-21T22:02:08+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager;
  card declares chief-of-staff tier, within delegated manager authority). Re-measured all four: (1)
  `tests/scenarios/SCEN-001_title-change-lifecycle.scen.md` still declares `required_tools:`, no
  `browser_stack:`. (2) S014/S032 still present unchanged. (3) `components/teams/TeamCreationWizard.tsx`
  still shows only a single "Creating..." label, no staged status. (4) no `z-index`/`z-[` styling
  found in `VersionChecker.tsx`/`SettingsSidebar.tsx` — no evidence of an overlap fix. All four
  frictions stand unaddressed.
- 2026-08-28T06:33:20+0200 — column → complete by ai-maestro-hub-session. Both remaining boxes are
  mechanical ("the child TRDD is terminal") and both are now objectively true and greppable:
  AGHPMRVI and 39PSYD62 are `complete` in `design/archived/`. The flock is closed, so the parent
  is no longer blocked on itself. Item (4)'s stated root cause is corrected in the body rather
  than left standing: it was refuted by the live measurement, and a terminal card must not keep
  asserting a cause its own EHT disproved.
