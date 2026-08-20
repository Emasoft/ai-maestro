---
trdd-id: 40DYBI4T
title: aimaestro-trdd.sh create — server-side TRDD minting for plugin agents
column: todo
created: 2026-08-20T08:16:28+0200
updated: 2026-08-20T08:16:28+0200
current-owner: ai-maestro-hub
task-type: feature
scope: project
project-id: ai-maestro
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-20T08:16:28+0200
relevant-rules: []
---

# aimaestro-trdd.sh create — server-side TRDD minting

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20

- Requested by the ARCHITECT plugin (2026-08-20): TRDD minting is its highest-frequency
  mutation (design intake + NPT/EHT derivation), currently hand-rolled per agent.
- MEASURED GAP: `aimaestro-trdd.sh` verbs today are search/read/verify/edit/approve/refuse/
  promote/archive — no `create`. API has GET /api/trdd + per-id verbs — no POST /api/trdd.
  No create service exists (`createTrdd|mintTrdd|newTrdd` = 0 hits in lib/services; control
  `mintTrddDecisionToken` matched, so the grep is live).
- **NEXT ACTION:** spec first — add `create` to the trdd.sh usage header + POST /api/trdd to
  the API spec (hand-edit; `specs:check` goes red until implementation catches up), then
  implement: service does id8 mint with cross-scope collision check, timestamps, minimal v2
  frontmatter, zone folder placement (proposals/ vs tasks/ by min-approval-requirement vs
  caller authority — the mandate rule), and the CLI verb wraps it.

## Problem

Every plugin agent that authors a TRDD hand-rolls the id mint, the collision check, the
timestamps and the frontmatter. The highest-frequency board mutation has no server verb, so
each agent's copy drifts (wrong id alphabet, `ls`-glob collision checks, typed timestamps —
all failure modes this repo's own lessons file records).

## Proposed fix

1. Spec: `aimaestro-trdd.sh create --title <t> --type <task-type> [--column backburner]
   [--scope project|local] [--min-approval <title>] [--parent <id8>] [--npt ...] [--eht ...]`
   → prints the minted `TRDD-<id8>` + file path; POST `/api/trdd` (strict? NO — authoring is
   Tier-0 EXEMPT intake; the gate verbs stay strict).
2. Server: one service function owning id mint (8-char uppercase base36, collision-checked
   across every scope root), ISO timestamps, minimal frontmatter, zone routing per the
   mandate rule (author authority >= min-approval → tasks/ as planned; else proposals/).
3. CLI verb `create` in `aimaestro-trdd.sh`, thin over the route.
4. `yarn specs:gen` + green `specs:check`.

## Verification

- create with default column lands in the right zone folder with parseable v2 frontmatter
  (`trddgrep validate` clean on the minted file).
- a forced id collision re-rolls rather than failing or overwriting.
- min-approval above the caller's authority lands in proposals/ as `column: proposal` —
  never tasks/ (the D4 watchdog invariant, enforced at mint instead of detected after).

## Acceptance

- [ ] spec sections (scripts + api) written first; specs:check red until implementation
- [ ] service + route + CLI verb landed; specs:check green
- [ ] minted file passes trddgrep validate; collision re-roll test; zone-routing test
- [ ] ARCHITECT notified with the exact invocation to adopt

## Approval log

- 2026-08-20T08:16:28+0200 — MANDATE issued by the hub under the USER's standing Phase-2
  delegation (min-approval-requirement: none — in-scope server work). No approval request sent.
