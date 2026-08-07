---
trdd-id: FXPV7L4D
title: The absorbed refresh claims every registered marketplace from one exit code while ten are months stale
column: backburner
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-07T10:20:17+0200
updated: 2026-08-07T10:20:17+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-07T10:20:17+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: small
labels: [auto-update, absorbed-duty, observability, false-success, owner-ours]
external-refs: []
---

# The absorbed refresh claims "every registered marketplace" from one exit code

## Problem

`services/auto-update-service.ts:492` writes the absorbed lane's marketplace row as:

```ts
r.success ? 'Refreshed every registered marketplace (one invocation)' : (r.error || 'Unknown failure')
```

That is a claim about **270 marketplaces derived from ONE process exit code**. The argless
`claude plugin marketplace update` refreshes them in a single invocation (AC1 of TRDD-PE54D95Q,
and correctly so — it replaced 275 CLI processes per tick). But a per-marketplace failure inside
that one process does not change its exit status, so the row says *every* when it means *the
command returned 0*.

**Measured 2026-08-07 against `~/.claude/plugins/known_marketplaces.json` — ten are not
refreshing, and all ten carry `autoUpdate: true`:**

| days stale | marketplace |
|---|---|
| 155.5 | `cattoolkit`, `expanly-claude-code-agents` |
| 139.7 | `kreatsaas-marketplace`, `dreamwalker-marketplace`, `naw3-skills`, `milo-claudekit`, `taisun-agent` |
| 62.0 | `cognitive-mechanisms` |
| 18.0 | `ccx-arsenal` |
| 11.6 | `pnl-dev-marketplace` |

The other **260 refreshed 0.8 h ago**, so this is not a cadence problem — the refresh runs, and
these ten do not move. Most likely deleted / renamed / made private upstream. **That part is not
our bug.** Ours is that it is *unreportable*: the lane logs success, and nothing anywhere says
which marketplaces did not refresh.

## Why this matters beyond tidiness

It is the same shape as **TRDD-IGCSDTIU** (fixed the same night): a signal that reads healthy
because nothing watches the thing that is broken. Here it is worse in one respect — the message
does not merely omit the failure, it **asserts the opposite**, in the words *"every registered
marketplace"*.

It also silently narrowed a measurement this project relied on. TRDD-PE54D95Q's AC6 evidence was
recorded as *"zero failures across all 200 trail rows"*. True — and the trail's rows are per-PLUGIN
updates plus this one aggregate row. **A marketplace failing for five months is invisible to the
exact evidence AC6 is gated on.** "Zero failures" meant "zero failures of the thing we log".

## Proposed fix

Record and surface the per-marketplace outcome. Cheapest honest version, no new process spawns:

1. Snapshot `known_marketplaces.json`'s `lastUpdated` per entry **before** the refresh call and
   **after** it. Any entry whose stamp did not advance did not refresh.
2. Replace the unconditional wording. The row should carry counts —
   `Refreshed N of M registered marketplaces (one invocation)` — and, when `N < M`, downgrade the
   status from `updated` and name the laggards (capped, with the count of any not shown, so the
   cap cannot read as completeness).
3. A marketplace stale beyond a threshold (say 7 days) is a **finding for a human**: it almost
   always means the upstream repo is gone, which no retry will fix.

Do NOT solve it by reverting to per-marketplace invocations — that is the 275-process regression
AC1 removed.

## Verification

- Unit: seed a before/after stamp map where K entries do not advance; assert the row reports
  `M-K of M`, is not `updated`, and names the K. **Neuter:** make the diff always empty → that
  test reds and only it.
- Complementary half, mandatory: when every stamp advances the row must still read as a clean
  success. Without it, a fix that reports failure unconditionally passes the first test.
- Live: after the change, one fire should report **260 of 270** on this host and name the ten
  above — a prediction this card can be checked against.

## Estimated risk

**LOW.** Reporting-only; it changes no refresh behaviour and spawns no processes. The one trap is
unit confusion in the stamp comparison (`lastUpdated` is an ISO-8601 string, not epoch), and a
wrong comparison would silently report every marketplace as stale — loud, and caught by the
complementary test above.

## Approval log

- 2026-08-07T10:20:17+0200 — Authored directly in `design/tasks` as a Tier-0 self-mandate: our own
  code, reporting-only, reversible, no baseline/governance/release surface. Filed rather than left
  in a commit message because the defect was found by accident while measuring something else, and
  a defect that only exists in prose is one nobody will act on.
