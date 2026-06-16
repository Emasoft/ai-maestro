---
trdd-id: a6d93b9c-4f4d-459a-8ba4-055a815a93b3
title: Route CLI plugin skill and local-message mutations through the server API and forbid agent user-scope
status: proposal
column: proposal
approval-tier: 2
created: 2026-06-16T23:38:54+0200
updated: 2026-06-16T23:38:54+0200
current-owner: null
task-type: security
priority: 2
severity: HIGH
relevant-rules: []
external-refs: ["reports/script-audit/AUDIT-REPORT-20260616_233416+0200.md"]
---

# TRDD-a6d93b9c — Route CLI plugin/skill/local-message mutations through the server (and forbid agent user-scope)

**Source:** script↔API security audit, findings L1-H1, L1-H2, L1-H3 (plus L2 belt). Units: `agent-plugin` AP-01/02/03, `agent-skill` AS-01/02/03, `amp-core` AMPCORE-01/02/03, `governance-bypass` GBP-001/005, `coverage` COV-06.
**Tier 2 (MANAGER):** governance enforcement + IRON-rule ("AI Maestro never installs user-scope").

## Problem (WHY)

Three whole capability surfaces in the CLI never reach `app/api/**` — they do local-FS writes / local-`claude`-CLI calls the server cannot see, so governance gates (gate0Auth, R17 core-plugin, R20 marketplace, the IRON "never install user-scope" rule, the comm-graph + closed-team isolation) are NEVER consulted. These are the L1 class — closeable today only by the future scan-before-execute / code-signing layer — but the *durable* fix is to route them through the server so the existing controls apply.

1. **`agent-plugin.sh` entire plugin/marketplace surface (L1-H1).** install/uninstall/update/enable/disable/reinstall + marketplace add all shell out to local `claude plugin …` and `rm -rf ~/.claude/plugins/cache/` + hand-edit global JSON. Zero API calls. `--scope user` (accepted) installs host-wide, violating the IRON rule; `marketplace add <source>` takes an unvalidated source with no R20 governance. The matching server controls EXIST (`services/element-management-service.ts:361-369,508-513`) and are solid — just on an endpoint the script never calls. (`scripts/agent-plugin.sh:183,314,366,385,1136`)
2. **`agent-skill.sh install`/`uninstall` (L1-H2).** Zero API calls; DEFAULT scope `user` → writes the human user's `~/.claude/skills/` (IRON violation); `--name`/`skill_name` traversal escapes the skills dir (the uninstall substring guard is defeated by `../`); the only pre-install scan greps one `SKILL.md` and ignores the bundled payload. A server route EXISTS and is auth-gated (`app/api/agents/[id]/install-skills/route.ts:22`) but is unused. (`scripts/agent-skill.sh:205-483`)
3. **`amp-send.sh` same-host `.local` delivery (L1-H3).** Writes straight to the recipient inbox, bypassing `validateMessageRoute` (comm-graph) + `checkMessageAllowed` (closed-team) at `services/amp-service.ts:1212-1246`; `--id` selects ANY local agent's identity+signing key from the shared `~/.agent-messaging/agents/` store, forging a fully-valid signed message from any agent. (`scripts/amp-send.sh:485-509,666-690`)

## Proposed change

```
1. agent-plugin.sh install/uninstall/update/enable/disable/reinstall: route through
   PATCH /api/agents/{id} (ChangePlugin / InstallElement) so gate0Auth + R17/R20 apply.
   marketplace add/remove/update: route through ChangeMarketplace; validate `source`.
2. agent-skill.sh install/uninstall: route through a server endpoint (extend
   /install-skills or add a generic skill route) so gate0Auth + authorize('manage-skills')
   + the never-user-scope rule run server-side. Run the authoritative payload scan server-side.
3. amp-send.sh: make the canonical local-delivery path POST to /api/v1/route (the server
   already supports local delivery) so the comm-graph + closed-team filter run for same-host pairs.
4. L2 belt: at the server install endpoint, FORBID --scope user for agent callers (an agent
   token, not a system-owner cookie) per the IRON rule — so even the fixed path can't install
   user-scope.
5. Defence-in-depth client hardening (until routed): validate skill_name/--name against
   ^[a-zA-Z0-9_-]+$ + realpath-prefix check; allowlist marketplace `source`; sanitize the
   amp recipient name.
```

## Acceptance criteria

- An agent CLI `plugin install … --scope user` (or skill install at user scope) is REFUSED server-side (IRON rule) — only the human via the Settings → Plugins page installs user-scope.
- `agent-skill.sh install --name "../../x"` cannot write outside the resolved skills dir; `uninstall` cannot `rm -rf` a traversed path.
- A MEMBER's same-host `amp-send` to a comm-graph-forbidden recipient is rejected by the server comm-graph (no longer a direct inbox write).
- Plugin/skill/marketplace mutations appear in the server's element-management audit trail.
- Tests for each routed path + the user-scope refusal + the traversal rejection.

## Risk / blast radius

High — these are behavior changes to widely-used CLI verbs and the hook/agent flows that depend on them. Sequence carefully: ship the server endpoints + user-scope refusal first, then flip each CLI verb, then deprecate the local-CLI/local-FS code paths. The amp-send local→API change must preserve same-host delivery latency.

## Approval log
