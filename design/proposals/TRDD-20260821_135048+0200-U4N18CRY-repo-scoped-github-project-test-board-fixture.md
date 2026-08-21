---
trdd-id: U4N18CRY
title: USER fixture — a team linked to a REPO-scoped GitHub Project, so the kanban round-trip can run
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T13:50:48+0200
updated: 2026-08-21T13:50:48+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: user
task-type: infra
min-approval-requirement: user
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: small
labels: [fixture, kanban, user-gated, outward-facing]
external-refs: [Emasoft/ai-maestro#46]
---

# USER fixture — a team linked to a REPO-scoped GitHub Project

## Problem

`TRDD-17K0SHDQ`'s last open box (W-D's PROBE half — the live kanban round-trip) has been unable to
run since **2026-08-19**, and the reason is not a defect: **no team on this host is linked to a
repo-scoped GitHub Project.**

Measured first-hand 2026-08-21 from `~/.aimaestro/teams/teams.json` — 3 teams:

| team | id | linked project |
|---|---|---|
| Test Kanban Team | `e12e0788` | `{owner: IpaziaSoftware, number: 1}` — **ORG-level, no repo** |
| scen003-test-wizard-team | `8a6b6b54` | none |
| scen8-noplugin-team | `8fc20aac` | none |

An ORG-level project is browse-only for the write path, which is why the probe's P1 got the
`requireRepo` refusal (correctly typed `409` by `a9296f19` — a team STATE, not an outage). P2-P4 of
the probe plan (the ASSERT-DISTINCT column walk, the write-through with `transition_authority`, the
teardown) all need `github.com/<owner>/<repo>/projects/<n>`.

## Why this is USER-gated and not agent-actionable

Creating a GitHub Project **on a repo** is outward-facing on the owner's single shared GitHub
identity. No agent may do it unilaterally — and the peer agents that hit this blocker on 2026-08-08
were right to refuse (AMAA declined to write shared state on a peer's say-so, and declined the
`AMP_HOST=1` circumvention; recorded on `TRDD-17K0SHDQ`).

## Proposed fix (the USER's, ~2 minutes)

1. Create a **repo-scoped** GitHub Project on a repo you are willing to have a test board on —
   `github.com/Emasoft/<repo>/projects/<n>`. A scratch repo is fine and preferable.
2. Link it to a team (a new one, or re-link `Test Kanban Team`) through the dashboard's team UI.
3. Say so here, or just move this card to `planned`.

The probe then runs unattended: it is fully specified on `TRDD-17K0SHDQ` (AMOA-authored P1-P4 plan,
adopted), including its own teardown through the full `DeleteAgent` pipeline + cemetery purge.

## Verification

`~/.aimaestro/teams/teams.json` shows a team whose project object carries a `repo` (not just
`owner`/`number`), and `TRDD-17K0SHDQ`'s P2 read-back returns six DISTINCT column strings.

## Estimated risk

LOW — a test board on a scratch repo, deleted when the probe is done. The only irreversible-ish
part is that a GitHub Project is public-ish on a public repo, which is why it is the USER's call
and not an agent's.

## Notes

Filed so `TRDD-17K0SHDQ` can honestly say `column: blocked` with a `blocked-by:` that names an OPEN
card. It sat at `column: dev` for two days asserting that someone was working it while it was in
fact waiting on this fixture — the failure the kanban rule names, where an untrue column hides the
stall from the only view anyone checks.

## Approval log
