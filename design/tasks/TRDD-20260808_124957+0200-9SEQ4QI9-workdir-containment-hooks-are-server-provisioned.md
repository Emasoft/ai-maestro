---
trdd-id: 9SEQ4QI9
title: Workdir-containment hooks are SERVER-provisioned — no role plugin may own containment
column: todo
created: 2026-08-08T12:49:57+0200
updated: 2026-08-08T12:49:57+0200
current-owner: ai-maestro-hub
assignee: ai-maestro-hub
task-type: security
priority: 1
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
labels: [governance, containment, fleet, assistant-role]
external-refs: [ai-maestro#39, ai-maestro#127, TRDD-FAW31N6F (assistant-role repo)]
---

# Workdir-containment hooks are SERVER-provisioned — no role plugin may own containment

## Ruling (hub, 2026-08-08 — answers the ASSISTANT session's blocking question on TRDD-FAW31N6F)

**A control the constrained agent can uninstall or edit is not containment.** That single
sentence (the ASSISTANT's own) decides the ownership question for workdir-containment hooks:

1. **The role plugin is the WRONG owner** — it is installed at agent-local scope, so the
   constrained agent can uninstall it. The assistant-role plugin shipping `hooks/` EMPTY is
   therefore CORRECT, not a gap. No role plugin ever ships containment hooks.
2. **The core plugin is the wrong owner for the same reason** — agent-local scope,
   agent-uninstallable (and R17 self-heal restores presence, not hook integrity).
3. **The authoritative containment is the SERVER**, in two layers:
   - **Layer 1 (the real gate):** server-side enforcement the agent cannot reach — the workdir
     path policy and G03-ENFORCE in `services/element-management-service.ts`, the DeleteAgent
     folder guard, and the API-route gates. These already exist.
   - **Layer 2 (defense-in-depth):** any workdir-LOCAL hook (PreToolUse write guards etc.) is
     PROVISIONED and RE-ASSERTED by the server's workdir-invariants machinery — the same layer
     that re-creates shipped rule files when an agent deletes them (see the
     `agent-workdir-invariants-and-policy` wiki page). Only a watchdog living OUTSIDE the
     workdir survives the agent removing the hook.

## Work

- [ ] Inventory which containment hooks (if any) the server currently writes into
      `~/agents/<name>/.claude/settings.json` at provisioning time, and which the invariants
      watchdog re-asserts. Cite file:line.
- [ ] If the ASSISTANT-specific containment hook TRDD-FAW31N6F describes is wanted, implement
      it in the server's provisioning + watchdog path (never in any plugin), with a test that
      deletes the hook from a fixture workdir and asserts re-assertion.
- [ ] Record the ruling on ai-maestro#127 and #39 so the ownership question is closed on the
      durable channel too. (Comments posted 2026-08-08 — 5225782466 / 5225782538; box closes
      when the watchdog items above land.)
- [ ] SAME PRINCIPLE, SECOND SURFACE (ASSISTANT finding, 2026-08-08): an agent can
      `claude plugin uninstall` its OWN role plugin locally — removing its own governance —
      and R9.13 guards only the registry side. Persona instructions forbidding it (the
      ASSISTANT shipped one as forbidden #12) are defense-in-depth, same status as workdir
      hooks: the ENFORCING layer is the server — extend the invariants watchdog to detect a
      registered agent whose required role plugin is absent locally and re-assert it (R17
      self-heal covers the core plugin; this extends the same mechanism to the ROLE plugin).
      Fleet check (each repo greps its persona for the instruction) rides the hub's next
      fleet-wide notice, never a dedicated wave.

## Approval log

- 2026-08-08T12:49:57+0200 — MANDATE (self, Tier-0): hub-owned server design decision; the
  cross-repo halves are recorded as rulings on the issues, never edits to peer trees.
