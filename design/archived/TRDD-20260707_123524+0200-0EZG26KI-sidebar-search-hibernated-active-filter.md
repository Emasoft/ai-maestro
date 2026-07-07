---
trdd-id: 0EZG26KI
title: Sidebar search returns 0 results for hibernated agents while ACTIVE filter is selected
column: complete
created: 2026-07-07T12:35:24+0200
updated: 2026-07-07T14:58:53+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-003, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_003_2026-06-23T10-35-11Z.md"]
implementation-commits: [ec4e307d]
---

# TRDD-0EZG26KI — Sidebar search excludes hibernated agents under the ACTIVE filter

## Problem

After an agent is hibernated (e.g. by a team-disband revert-to-AUTONOMOUS action), the
sidebar search box ("Search by name, label, host…") returns "0 results" while the ACTIVE
bucket filter is selected — even though the agent definitely exists. The agent only
becomes findable after the user manually switches to the ALL filter and searches again.

**Evidence (SCEN-003 S040, 2026-06-23 run):** searching `cos-scen-test-wizard-team`
(agent name) → 0 results while ACTIVE was selected; searching `Nikolai` (the agent's
label) → still 0 results; only after clicking the ALL filter tab did `Nikolai` return 1
result. This forced the scenario to delete the orphaned auto-COS agent
`cos-scen-test-wizard-team` in a separate manual step (S040b) instead of finding it
directly from search.

## Root cause

Verified 2026-07-07 in `components/AgentList.tsx`, the `filteredAgents` `useMemo` (around
line 345) applies filters in this order: (1) host filter, (2) status/bucket filter
(`statusFilter === 'active'` → `result.filter(a => a.sessions?.[0]?.status === 'online')`,
line ~352-354), THEN (3) the search-query filter (line ~364-372, matching
`a.name`/`a.label`/`a.hostId`/`a.hostName`). Because the bucket filter runs BEFORE the
search filter and the two are ANDed together, a hibernated agent is excluded from the
candidate set before the search predicate ever sees it. The search box is scoped to
whatever bucket is currently selected instead of spanning the full agent list.

## Proposed fix

In `components/AgentList.tsx`'s `filteredAgents` `useMemo`, when `searchQuery.trim()` is
non-empty, search across the FULL agent set (post host-filter, pre bucket-filter) rather
than the bucket-filtered subset — i.e. reorder so the search predicate is applied to
`result` before the ACTIVE/HIBER bucket narrowing, or run the bucket filter and search
filter as two independent predicates over the same base list and OR-bypass the bucket
narrowing whenever a query is present. Concretely: when a search query is active, skip
the `statusFilter === 'active' | 'hiber'` branch entirely (behave as if ALL were
selected) so "search finds anything that exists" regardless of the selected tab. Keep
host-filter scoping intact — that's an explicit user narrowing, not a stale-bucket trap.

## Verification

With a hibernated test agent present and the ACTIVE tab selected, type its name or label
into the sidebar search box — it must appear in the results (no manual switch to ALL
required). Repeat with the HIBER tab selected and an online agent's name — it must also
appear. Add a UI/unit test asserting `filteredAgents` returns a hibernated agent by
name/label match even when `statusFilter === 'active'`.

## Estimated risk

LOW — pure filter-ordering change scoped to one `useMemo` in `components/AgentList.tsx`;
no server/API surface touched. Dependency: none, but pairs well with the DeleteTeam
cascade fix already shipped (`components/sidebar/TeamListView.tsx`'s "Delete member
agents too" checkbox) since that fix reduces how often agents land in HIBER in the first
place — this fix makes the ones that do land there actually findable.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T14:17:52+0200 — IMPLEMENTED (wave W3): `components/AgentList.tsx`'s `filteredAgents` `useMemo` now skips the ACTIVE/HIBER bucket filter entirely whenever `searchQuery` is non-empty (host-filter scoping is preserved), so search spans the full agent list regardless of which tab is selected.
- 2026-07-07T14:58:53+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.
