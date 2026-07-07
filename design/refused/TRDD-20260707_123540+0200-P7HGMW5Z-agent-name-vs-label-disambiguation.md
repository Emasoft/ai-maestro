---
trdd-id: P7HGMW5Z
title: Show agent name alongside persona label in agent listings
column: refused
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: NIT
effort: S
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-P7HGMW5Z — Show agent name alongside persona label in agent listings

## Problem
Agents have two distinct identifiers: the deterministic, kebab-case agent NAME
(`agent.name`, used by the API/registry and required verbatim in destructive
confirmations like "type the agent name to confirm") and the persona LABEL
(`agent.label`, human-friendly, random for auto-created COS agents, e.g. "Kairo").
The sidebar (`components/AgentList.tsx`) currently renders only the label/display
name — verified on 2026-07-07: no tooltip or secondary text surfaces `agent.name`
near the sidebar card (only one incidental reference to `agent.name` exists in the
file, at a `sessionName` assignment unrelated to display). When an auto-COS is
created with name `cos-scen024-team` and label `Kairo`, the sidebar shows only
"Kairo", so a user asked to type `cos-scen024-team` into the Delete Agent
confirmation field has no way to discover that string without opening the full
profile panel first.

## Root cause
The sidebar card was designed around the common case (a user-named agent where
label and name are similar or identical) and never accounted for auto-generated
agents (auto-COS) where label and name diverge significantly.

## Proposed fix
In `components/AgentList.tsx`, render the agent NAME as secondary text under/beside
the persona LABEL wherever a card is rendered:
- Primary: persona LABEL (existing, unchanged size/style).
- Secondary: agent NAME in small, muted, monospace text (or a `title=` tooltip on
  the card if vertical space is constrained in compact view mode).

Apply consistently to both normal and compact view modes (`viewMode` state already
present in the component). Do not change `agent.name` usage anywhere else — this is
purely a display-layer addition.

## Verification
Create a test agent where persona label differs from agent name (e.g. via team
auto-COS creation), then confirm the sidebar shows both the label and the
name (secondary text or tooltip) without opening the profile panel.

## Estimated risk
LOW — presentation-only change in one component; no API or data changes.
Dependencies: none.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Cosmetic disambiguation polish.
