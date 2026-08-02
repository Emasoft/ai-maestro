---
name: governance-rules-layering
description: "where do the aimaestro governance rules live / IND base vs DEP overlay / why is my aimaestro-*.md rule file read-only / who owns the aimaestro-*.md name in an agent workdir / why did my edit to a shipped rule file get reverted / is the rule protection a sandbox"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: aspect
  topic: teams-and-governance
---

# governance-rules-layering

Governance rules — IND base + DEP overlay (TRDD-DE9757LJ). The 3-pillars governance rules
(TRDD, PRRD, universal kanban) are split in two layers.

## The two layers

- **IND (universal base)** — ai-maestro-independent; shipped globally to `~/.claude/rules/`
  by the **ai-maestro-janitor** plugin. Canonical home = the janitor repo (issue
  ai-maestro-janitor#73). The DE9757LJ handoff is complete — the former in-repo source
  `design/rules-refactor/independent/` was retired once the janitor became canonical
  (TRDD-TAFH4U0G); see `design/rules-refactor/README.md`. IND-base deltas now flow as
  janitor proposal issues (e.g. janitor#103), never as in-repo edits here.
- **DEP (ai-maestro overlay)** — `rules/aimaestro/aimaestro-*.md` in THIS repo
  (git-tracked, bundled with the app). `lib/agent-rules-seed.ts` (`ensureAgentRules`)
  copies them into each registered agent workdir's `.claude/rules/`. It is NOT called
  directly by the lifecycle any more — it is the `dep-rules` row of the
  **agent-invariant registry**, which is what actually schedules it. DEP files EXPAND the
  IND base and must never restate it.

## ai-maestro OWNS the `aimaestro-*.md` name inside an agent workdir (TRDD-JGCEA6CQ)

A shipped rule is written **read-only (0444)**, restored when its bytes differ, re-created
when deleted, and re-protected when its mode drifts — whether or not it still carries the
`ai-maestro:installed-dep-rule` marker. **The marker is provenance, not a permission
gate:** the earlier "preserve a same-named file lacking the marker" contract was a bypass
(strip the marker, rewrite the rule, keep the edit forever — the governed party editing its
own governance). A user who wants their own rule uses any other filename.

**Honest limit:** agents share the server's UID, so this is **tamper-evident and
self-healing, not tamper-proof** — a determined agent can chmod and rewrite, and the
watchdog puts it back within one interval. Real prevention needs per-agent UID isolation
(TRDD-a1019073). **Do not describe it as a sandbox.**

## Two kinds of DEP rule live in `rules/aimaestro/`

| File | Layer |
|---|---|
| `aimaestro-trdd-approval.md`, `aimaestro-manager-approval-defaults.md`, `aimaestro-prrd-governance.md`, `aimaestro-kanban-multiagent.md` | **governance** — approval tiers, transition authority, PRRD, multi-agent kanban |
| `aimaestro-agent-rules.md` | **operating** — how an agent (and its subagents) must BEHAVE inside the harness: boundaries, failure handling, truth, work discipline |

**The operating file is under a hard size budget** (2,200 bytes, enforced by
`tests/unit/agent-operating-rules.test.ts`). Everything in `.claude/rules/` is injected
into an agent's context on EVERY turn, so its cost is size × turns × agents. Each rule is
ONE line stating WHAT, never HOW — the implementation is the agent's to choose. Growing it
is a deliberate decision that must pay for itself on every turn of every agent, forever.

**Naming is load-bearing.** A DEP rule MUST be named `aimaestro-*.md`: that is exactly the
glob in `MANAGED_GITIGNORE_ENTRIES` (`lib/workdir-gitignore-seed.ts`) that keeps a seeded
rule out of `git status` in an adopted project repo. A file named `ai-maestro-rules.md`
would not match and would surface as untracked in every agent's repository.

This repo self-governs via symlinks `.claude/rules/aimaestro-*.md → rules/aimaestro/` —
for the **governance** rules only. The operating rules bind agents running INSIDE the
harness (use the CLI, never the API; obey the comm graph), which is the opposite of what a
developer OF the server does, so it is deliberately not symlinked here. To change a DEP
rule, edit `rules/aimaestro/` (agents pick the update up on next wake, or within one
watchdog interval); never hand-edit a seeded copy in a workdir — it will be restored.

## Applies to

## See also

## Notes and lessons learned
