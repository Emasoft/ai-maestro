---
trdd-id: FXPV7L4D
title: The absorbed refresh claims every registered marketplace from one exit code while ten are months stale
column: testing
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-07T10:20:17+0200
updated: 2026-08-16T16:12:50+0200
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

## Acceptance

*(Authored 2026-08-16 with the fix — this card shipped with NO boxes, which makes the completion
gate vacuous: "every box checked" is trivially true of a card with none. Boxes live here and
nowhere else.)*

- [x] The row's detail is computed from the registry `lastUpdated` stamps either side of the call,
  never from `r.success` alone — `describeRefreshCoverage` in `services/auto-update-service.ts`,
  wired at the one `absorbed:marketplace-refresh` success site.
- [x] A partial refresh is **not** `updated` and **names** its laggards, capped at 10 with the
  hidden count always printed (a silent truncation is the same class of lie as the old wording).
- [x] The string "every registered marketplace" is gone from the success path, and a test asserts
  it cannot come back.
- [x] An unreadable/empty registry reports coverage **UNKNOWN** rather than "0 of 0" — the read
  fails open, so an empty map is ambiguous by construction and must not manufacture a failure.
- [x] Complementary tests, both required: all-advanced (kills an always-report-failure fix) and
  partial (kills an always-report-success fix). **Neuter run** (`stale` forced to `[]`): exactly
  **2 of 5** red — the partial and the cap tests, i.e. the two carrying the claim; the other three
  correctly stayed green, which is what makes them the complement rather than duplicates.
- [x] Deployed: `yarn build` + `pm2 restart` at 16:12 on 2026-08-16, proven from the ARTIFACT
  (`grep -rl "registered marketplaces (one invocation)" .next/server` → 1), not from `git log`.
- [ ] **Live, and it is a PREDICTION this card can be failed by:** the next absorbed fire on this
  host reports roughly `260 of 270` and names the ten laggards from the table above. Due ~4 h
  after the last stamp; read it with the PE54D95Q command. If it instead reports *all* refreshed,
  either the ten started moving (check their stamps before celebrating) or the diff is broken.

## Approval log

- 2026-08-07T10:20:17+0200 — Authored directly in `design/tasks` as a Tier-0 self-mandate: our own
  code, reporting-only, reversible, no baseline/governance/release surface. Filed rather than left
  in a commit message because the defect was found by accident while measuring something else, and
  a defect that only exists in prose is one nobody will act on.
