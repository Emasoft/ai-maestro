---
trdd-id: BDRWMBDC
title: Fleet alignment campaign — janitor 3.x contract + open-issue triage, hub in charge
column: dev
created: 2026-08-15T00:27:31+0200
updated: 2026-08-15T00:27:31+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 1
severity: medium
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [fleet, coordination, janitor-3x, alignment]
npt: []
eht: []
blocked-by: []
---

# Fleet alignment campaign — janitor 3.x + open issues

## ⏵ STATE — 2026-08-15 00:35 (first wave complete)

Directives sent to all 15 live sessions 00:28-00:32. Janitor CONFIRMED the digest
(amendments folded into later sends: c2686c04 publish-globally symlinks are sanctioned;
external idle-clear is opt-in machine-wide for NEW sessions; janitor main-CI-red expected
this week). **8 report-backs in, all substantially aligned:**

| Session | Verdict | Notable |
|---|---|---|
| agentlens | 5/5 DONE | #108 re-verified + CLOSED by them (tools shipped; --all shape frozen; new defects = new issue on Emasoft/AgentlensPro) |
| ASSISTANT | ALIGNED | #131 fixed bc1435e (persona+README, corpus-scoped guard); #127 ready-to-close, USER-gated; branch-protect NO_TAG_PROTECT USER-gated (TRDD-3W9HE416) |
| CORE | ALL ALREADY | #131 extended 5e18b80; #107 iron (test-enforced); asks #97/#116 still await HUB answers |
| webdesign | ALIGNED | #5 was ALREADY closed (v0.1.13, 18 sites fixed); cpv-branch-rules ruleset absent (stale note) |
| ARCHITECT | ALIGNED | asked the blocked-on-human-decision card form (answered: in-card STATE note + todo is honest; never fabricate a blocker card) |
| amvcp | PARTIAL | 2 board defects found+owner-gated; panel PATH verified; BUILD start is their USER's call — #134 confirm deferred accordingly |
| CPV | ALIGNED | #141/#142 premise FALSE — fixed v5.4.0 (CPV#169); hub spot-verified live hook; both issues CLOSED with provenance |
| ORCHESTRATOR | ALIGNED | #131 fixed 3677f4c (local, awaits release); v1.13.4 postable-body fixes intact at v1.13.8 |
| COS | ALIGNED | #131 fixed v2.32.4/5; closed own hub#132 + janitor#268/#269; found G1.1-vs-R22.3 trailer drift (GOLDEN, USER-only) |
| AMPA (programmer) | ALIGNED | #131 fixed + RELEASED v2.0.6; board audit closed 1 stale card; fix text offered for copy (§Communication Permissions) |
| AUTONOMOUS | ALIGNED | #131 residual fixed a4e3210, shipped v1.6.15; closed 18 own janitor issues vs 3.3.0; c2686c04 correctly flagged unverifiable (janitor local-only commit, ships next release) |

Hub-owned dispositions: #141+#142 closed · #146 carded (TRDD-AYBAMFN2, priority 2 per
MANAGER) · #143 surfaced to USER in the campaign report · both hub proposals approved +
promoted (8648f508, 6a7d406f). Pending report-backs: COS, INTEGRATOR, AUTONOMOUS, AMPA,
align-232 (busy sessions — one re-ping before reporting stragglers).

USER directive (2026-08-15, verbatim): "using SendMessages and AgentList tools coordinate
all claude code instances/projects to get the plugin fleet ready and align with the janitor
recent changes and improvements. you are in charge. read also the issues open on github."

## The janitor delta the fleet must align to (hub-digested from CHANGELOG 2.7.1 → 3.3.0)

1. **Arm model (3.0.0, BREAKING, USER directives):** ONE arm per session, tier-driven
   renews DELETED (TRDD-BRHJHWW0); arm once, persistent machine claim, silent re-plumb at
   SessionStart (TRDD-TUIBWHT7). A session must not run cadence-tier renew loops.
2. **Heartbeat output contract:** a fire prints `janitor heartbeat` and NOTHING else
   unless something genuinely needs the human (adcd8af; owner directive).
3. **Janitor now ACTS cross-repo:** files findings as issues on the repo they belong to,
   restores executable bits, enforces + fixes the `reports/` gitignore invariant
   (TRDD-WP7TCRME rules 3-4). Fleet: expect janitor-authored issues; keep `reports/` and
   `reports_dev/` gitignored.
4. **Board honesty is machine-audited:** `blocked` naming no blocker is surfaced (check 6);
   a WORK column claiming activity nobody provides (check 7); blind-pair cards attacking
   one defect; the shipped-unreleased rung. Fleet: keep `column:`/`blocked-by:` true.
5. **Memory discipline:** chores CLAIM scope; publish-globally normalization is pre+post
   condition of every page write; per-page lint sees cross-page rules; write only through
   memgrep verbs.
6. **Security rules re-measured:** agent-context rule coverage benched (many rules
   rewritten to match BEHAVIOR); branch-protection guard ON by default; and the baseline
   nuance: "the ruleset must fit the project's governance, not impose a PR on a repo that
   reviews itself" (36f05aa).
7. **Session hygiene:** pending-agent ghosts sweep at 1h; a /clear consumes resume
   directives; stale keep-going directives age out.

## Fleet-wide open-issue triage (from the hub + janitor trackers, read 2026-08-15)

- **#131** — every role-plugin persona claims a forbidden send returns 403, but CC 2.1.224
  added a second transport where it does not: EVERY role-plugin needs the persona fix.
- **#145** — RP-CITATION-01: rule citations + rule versions break silently (role-plugin-wide).
- **#141/#142** — side branches structurally unpushable under the CPV publish canon (CPV owns).
- **#107** — iron rule: role-plugins must instruct the frozen CLI in their SKILLS.
- **#146** — §D4 approval-ladder watchdog is HUB work (ai-maestro owns TRDD enforcement).
- **#143** — R42.3 false since CC 2.1.224 — USER-tier clause correction, surface to USER.
- Stale bring-me-up-to-speed asks (#127, #120, #119, #101, #103, #130…): each session
  re-checks its OWN filed issues against current state and closes what is resolved.

## Method

Hub sends per-session directives (SendMessage; sends are cheap, no spawn cost), each =
shared checklist + repo-specific asks + report-back contract (DONE/BLOCKED + facts, no
transcripts). Janitor session gets the digest for amendment in parallel — the checklist
ships marked "hub-digested; janitor may amend". Responses tracked here.

## Acceptance

- [x] Alignment directive sent to every live fleet session (roster snapshot 2026-08-15
      00:26; 15 sends 00:28-00:32, msg ids in session log)
- [x] Janitor session confirmed/amended the 7-point digest (points 1-7 confirmed; 3
      amendments folded into subsequent sends)
- [ ] Each session reported DONE or BLOCKED-with-cause on its checklist
- [ ] Hub-owned items dispositioned: #146 carded, #143 surfaced to USER, #134 thread current
- [ ] Report-backs recorded on this card; stragglers re-pinged once before being reported
