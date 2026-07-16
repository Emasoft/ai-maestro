---
trdd-id: W9FA6ACZ
title: ASSISTANT role-plugin — ai-maestro-assistant-role-agent (MANAGER+MAINTAINER, ungoverned, user-bound) (R39)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-07-16T10:39:44+0200
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

**⚠ CORRECTION (2026-07-16, verified) — THIS TRDD WAS WRONG: the plugin ALREADY EXISTS.**
Authored claiming the role-plugin "does not exist yet" and needed scaffolding from scratch into its
own GitHub repo. **Both claims are false**, and R39.2's own "(still to be created)" parenthetical is
stale. VERIFIED on disk:
`~/agents/role-plugins/roles-marketplace/ai-maestro-assistant-role-agent/` (created 2026-06-19) is
**quad-identity complete** — `.claude-plugin/plugin.json`, `ai-maestro-assistant-role-agent.agent.toml`
(`compatible-titles = ["ASSISTANT"]`, `compatible-clients = ["claude-code"]`), and
`agents/ai-maestro-assistant-role-agent-main-agent.md`. It is a **LOCAL source (decision D4)** —
intentionally NOT a published GitHub repo and correctly absent from `PREDEFINED_ROLE_PLUGIN_NAMES`
(`lib/ecosystem-constants.ts:280-288`), so `Emasoft/ai-maestro-assistant-role-agent` returning 404 is
BY DESIGN, not a gap. Much of R39 is also already BUILT: **R39.5/R39.6/R39.7 are ENFORCED** (guards in
`lib/communication-graph.ts` — incl. `AssistantSenderContext`, the ASSISTANT-may-message-only-its-user
block — and `services/element-management-service.ts`). Only **R39.1-R39.4 are UNENFORCED**.

**⚠ THE REAL BLOCKER — a 3-way composition drift the USER must rule on (escalated):**
| Source | Composition |
|---|---|
| **R39.2** (v4.4.0, today) | MANAGER + **MAINTAINER** |
| `lib/ecosystem-constants.ts:283` | MANAGER (planning) + **AUTONOMOUS** (programming) |
| **the built plugin** (2026-06-19) | persona references **autonomous** → built to the OLD spec |
R39.2 is USER-set IRON; no agent may resolve this. **Do NOT re-compose or rebuild the plugin until
the USER rules.** Reported to the MANAGER in `ai-maestro-assistant-manager-agent` issue #28 §3.

**NEXT ACTION when unheld:** do NOT scaffold. (1) Get the USER's ruling on the composition drift
above; (2) get the USER's R39.4 ruling below; (3) THEN reconcile the existing plugin's persona to the
ruled composition and build only the genuinely-missing R39.1-R39.4 surfaces.

## Problem

R39.1 auto-assigns every non-MAESTRO user an ASSISTANT agent (users are human — no terminal/client
of their own, R39). The role-plugin **exists** (above) but was built to the **superseded**
MANAGER+AUTONOMOUS composition, while R39.2 now mandates MANAGER+**MAINTAINER** — without
agent/team-creation privileges and without governing powers (R46.3). So the gap is NOT "create the
plugin"; it is **reconcile the drift** and build the still-unenforced R39.1-R39.4.

## Approach (design sketch — pending the USER rulings)

1. **Resolve the composition drift (USER ruling required).** Then align the ONE surviving answer
   across all three sources: R39.2's text, the `ecosystem-constants.ts:280-288` comment, and the
   built persona. Whichever wins, the other two are corrected in the same change — this drift exists
   precisely because they were allowed to disagree.
2. **Reconcile the existing plugin** (do not recreate): persona = the ruled composition, MINUS
   agent/team creation, MINUS governing powers (R46.3). Keep its LOCAL/D4 nature — do NOT publish it
   to GitHub or add it to `PREDEFINED_ROLE_PLUGIN_NAMES`.
3. **Persona rules (R39.5/R39.7) — already enforced server-side; make the persona MATCH.** Obeys ONLY
   its bound user — not even the MAESTRO. Isolation. Outside the governance chain: never a mandate
   target (R41), needs no MANAGER/COS/MAESTRO approval. Messages ONLY its own user. Inherits the
   user's tasks/permissions (R39.7). Invisible to other agents.
4. **Comm graph (R6) — VERIFY before touching.** `lib/communication-graph.ts` ALREADY carries the
   ASSISTANT sender/recipient logic (R39.5 ENFORCED). Do not re-add a node; audit the existing one
   against the final rule and sync the adjacency matrix in CLAUDE.md + GOVERNANCE-RULES if it drifts.
5. **Lifecycle (R39.6) — already ENFORCED** in `services/element-management-service.ts` (no
   independent delete; USER delete cascades). Verify, do not rebuild.
6. **Build the genuinely-missing R39.1-R39.4:** auto-create-on-user-creation (R39.1), the
   no-terminal/no-other-agent-access UI (R39.3), and the R39.4 identity locks per the OPEN DECISION.

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

- 2026-07-16 — DO NOT infer "X is not built" from a rule's prose, BECAUSE this TRDD was authored
  asserting the ASSISTANT role-plugin "does not exist yet" (echoing R39.2's stale "(still to be
  created)") and planned a from-scratch scaffold into a GitHub repo — while the plugin had existed
  as a complete LOCAL/D4 plugin since 2026-06-19 and R39.5/R39.6/R39.7 were already ENFORCED with
  real guards. A rule states INTENT; only the filesystem, the enforcement map, and the code state
  FACT. DO check the disk + `docs/GOVERNANCE-ENFORCEMENT-MAP.md` verdicts before writing "not built"
  into a plan. Caught only because the USER demanded verification before acting.
- 2026-07-16 — A rule, a code comment, and the artifact can all disagree at once (R39.2 says
  MANAGER+MAINTAINER; `ecosystem-constants.ts:283` says MANAGER+AUTONOMOUS; the built persona says
  autonomous). When they do, the drift itself is the finding — escalate it rather than picking the
  source that happens to be newest.
