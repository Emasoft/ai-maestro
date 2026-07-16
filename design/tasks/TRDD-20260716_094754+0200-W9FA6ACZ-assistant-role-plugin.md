---
trdd-id: W9FA6ACZ
title: ASSISTANT role-plugin — ai-maestro-assistant-role-agent (MANAGER+MAINTAINER, ungoverned, user-bound) (R39)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-07-16T09:47:54+0200
current-owner: opus-governance-rules-session
task-type: feature
relevant-rules: [39, 46, 41, 26, 6, 11]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** Implementation TRDD for **R39.2/R39.5** (committed `bf70bf47`,
v4.4.0). Held under the transition-phase hold — do NOT implement.

**⚠ OPEN DECISION (R39.4) — gates the profile-panel field locks. Currently COMMITTED as KEEP.**
R39.4 as written: the user may edit the ASSISTANT's profile EXCEPT NAME/TITLE/ROLE-PLUGIN/TEAM,
which stay read-only to the user and change only by the MAESTRO (sudo, per R26). The USER's later
directive *"the ASSISTANT obeys ONLY its bound user, not even the MAESTRO"* (R39.5) governs
OPERATIONAL obedience; it is silent on whether the MAESTRO keeps **identity administration** of
those 4 locked fields. R39.4 was LEFT INTACT (= KEEP). **Recommendation: KEEP** — else a user could
re-title/re-role their own agent, breaking R26 + host security. Confirm KEEP vs STRIP with the USER
before building the panel locks. This is the only design fork in the cohort still open.

**NEXT ACTION when unheld:** scaffold the role-plugin `ai-maestro-assistant-role-agent` with full
quad-identity (folder = plugin.json `name` = `.agent.toml` `[agent].name` =
`agents/<name>-main-agent.md` frontmatter `name`), `compatible-titles: ["ASSISTANT"]`, and register
it. Add the ASSISTANT title to the governance enum + ecosystem-constants.

## Problem

R39.1 auto-assigns every non-MAESTRO user an ASSISTANT agent (users are human — no terminal/client
of their own, R39). R39.2 says the ASSISTANT runs `ai-maestro-assistant-role-agent` — a
MANAGER+MAINTAINER combination **without** agent/team-creation privileges and **without** governing
powers — **which does not exist yet**. Until it does, users have no working agent.

## Approach (design sketch)

1. **Create the role-plugin** `ai-maestro-assistant-role-agent` (predefined → its own
   `Emasoft/ai-maestro-assistant-role-agent` repo, mirroring the other 8; or Haephestos-authored
   local). Quad-identity enforced. `compatible-titles: ["ASSISTANT"]`, `compatible-clients` per
   target. Persona = union of MANAGER (planning/coordination) + MAINTAINER (project maintenance)
   capabilities, MINUS agent/team creation, MINUS governing powers (R46.3).
2. **Register the ASSISTANT title.** Add `ASSISTANT` to the governance-title enum, `TITLE_PLUGIN_MAP`
   and `PLUGIN_COMPATIBLE_TITLES` (`lib/ecosystem-constants.ts` + `scripts/ecosystem-config.sh`).
3. **Persona rules (R39.5/R39.7).** Obeys ONLY its bound user — no one else, not even the MAESTRO.
   Isolation. Outside the governance chain: never a mandate target (R41), needs no MANAGER/COS/
   MAESTRO approval to act. Messages ONLY its own user. Inherits the user's kanban tasks + granted
   permissions and works the user's TRDDs **as its user's** (R39.7). Invisible to other agents.
4. **Comm graph (R6).** Add an ASSISTANT node whose ONLY edge is ASSISTANT ↔ its bound user (both
   directions); no edge to any other agent. Update `lib/communication-graph.ts` and the adjacency
   matrix in CLAUDE.md + GOVERNANCE-RULES.
5. **Lifecycle (R39.6).** Auto-created when a user is created/registered (wire into
   `lib/user-registry.ts` + the CreateAgent pipeline). Cannot be deleted independently; only
   deleting the USER cascades a soft-delete to the ASSISTANT.
6. **R39.4 identity locks** — build the four read-only-to-user fields per the OPEN DECISION above.

## Verification
- Role-plugin passes CPV quad-identity + strict validation.
- Creating a normal user auto-creates exactly one ASSISTANT (R39.1/R39.6); deleting the user
  cascades the soft-delete.
- ASSISTANT → any other agent messaging is 403; ASSISTANT ↔ its user works.
- ASSISTANT is never delivered a mandate; acts without MANAGER/COS/MAESTRO approval.
- §0 mirror-sync: comm-graph matrix (CLAUDE.md + GOVERNANCE), personas, GOVERNANCE R39.

## Estimated risk
MED-HIGH. New title + new role-plugin + comm-graph node + user-lifecycle coupling. The R39.4 open
decision gates the profile-panel field locks — resolve it before that sub-task.

## Rollout cohort — multi-host governance (R43-R48), transition phase
Siblings: TRDD-OEG0V589 (migration R44) · TRDD-QR9FSL3Q (groups R45) · TRDD-HR8CES7H (usernames
R47) · TRDD-40CUZA1Z (sidebar R46) · TRDD-PLOVIPZE (console gates R48) · TRDD-OC9ELGSO (transport,
#40). §0 mirror-sync rides each TRDD's Verification.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: manager;
  user authority >= manager). Verbatim: *"author all those TRDDs, but wait to implement them."*
  Implementation HELD. R39.4 KEEP/STRIP flagged as an open decision inside this TRDD.

## Notes and lessons learned
