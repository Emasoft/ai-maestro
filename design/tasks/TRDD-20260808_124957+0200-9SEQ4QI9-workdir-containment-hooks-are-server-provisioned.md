---
trdd-id: 9SEQ4QI9
title: Workdir-containment hooks are SERVER-provisioned — no role plugin may own containment
column: todo
created: 2026-08-08T12:49:57+0200
updated: 2026-08-22T02:00:24+0200
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

- [x] Inventory which containment hooks (if any) the server currently writes into
      `~/agents/<name>/.claude/settings.json` at provisioning time, and which the invariants
      watchdog re-asserts. Cite file:line.
      **ANSWER (measured 2026-08-22): the server provisions ZERO containment hooks. The "(if
      any)" resolves to none.** Not "none found" — none exist, and the search was controlled:
      - **`PreToolUse` appears 5 times in the whole server** (`lib/`, `services/`, `*.mjs`,
        excluding tests) and **every one is a non-write**, read individually rather than counted:
        `services/agent-local-config-service.ts:569` is a doc-comment EXAMPLE
        (*"Example: PreToolUse + matcher \"Bash\"…"*);
        `services/element-management-service.ts:6625` is an enum of valid event names used for
        VALIDATION; `lib/converter/types.ts:271, :417, :428` are type definitions and event-name
        lists for cross-client conversion. None writes a hook into an agent's settings.
      - **No `hooks:` key is written by any provisioning or watchdog path** — 0 hits across
        `lib/agent-rules-seed.ts`, `lib/agent-startup.ts`, `lib/agent-invariants.ts`,
        `lib/claude-settings-enforcer.ts`.
      - **What the invariants watchdog actually re-asserts is SIX invariants, none of them a
        hook** (`lib/agent-invariants.ts`): `amp-only-messaging`, `claude-dir`, `core-plugin`,
        `dep-rules`, `git-exclude`, `role-plugin`. The nearest thing to containment is
        `amp-only-messaging` (`:134-151`), which enforces a settings **KEY** —
        `crossSessionInbound: "refuse"` in the workdir's `settings.local.json` — and its own
        description records that a stray `SendMessage` **deny is REMOVED**, deliberately, so the
        tool stays available to subagents. A key, not a hook, and it loosens as well as tightens.
      **Consequence for box 2, which changes its shape:** since no server-provisioned containment
      hook exists, implementing the `TRDD-FAW31N6F` ASSISTANT hook is **greenfield**, not an
      edit — there is no existing hook path to extend, so it needs the provisioning write AND the
      watchdog re-assertion built together, exactly as box 2 already demands.
      **Related but NOT the same thing:** this repo's own subagent write-guard
      (`.claude/scripts/subagent-write-guard.sh`, wired via `.claude/agents/*.md`) IS a
      `PreToolUse` hook — but it is PROJECT-scoped in this repo, not provisioned into any agent
      workdir. Do not mistake it for server provisioning; the two are different mechanisms at
      different scopes.
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
