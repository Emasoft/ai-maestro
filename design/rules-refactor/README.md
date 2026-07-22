# design/rules-refactor/ — RETIRED handoff area (TRDD-DE9757LJ complete)

This directory was the working area for the 3-pillars governance-rule split
(TRDD-DE9757LJ): the universal **IND base** was extracted here as a handoff
source, then adopted by the **ai-maestro-janitor** plugin, which now owns and
ships it.

**The former `independent/` copies were retired (TRDD-TAFH4U0G).** They had
drifted 951/466/13 lines from the janitor's canonical shipped versions and were
a second, wrong source of truth. Git history preserves them.

## Where the rules live now (the three tiers)

| Tier | Files | Canonical home | Installed to |
|---|---|---|---|
| **IND universal base** | `trdd-design-tasks.md`, `prrd-design-rules.md`, `universal-kanban.md` | **`Emasoft/ai-maestro-janitor`** (janitor#73) | `~/.claude/rules/` (janitor plugin, SessionStart) |
| **DEP harness overlay** | `aimaestro-*.md` | **this repo** — `rules/aimaestro/` | each agent workdir's `.claude/rules/` (`lib/agent-rules-seed.ts`) |

## Changing an IND base rule

ai-maestro does **not** edit the IND base directly — the janitor owns it. IND-base
deltas flow as **proposal issues** on the janitor repo (live example: janitor#103,
the `scope:user`/`project-id` kanban delta). See `docs/GOVERNANCE-RULES.md` and the
"Governance rules — IND base + DEP overlay" section of the root `CLAUDE.md`.

The DEP overlay filenames are a cross-repo contract (the IND notes cite them by
name); they are frozen by `tests/unit/aimaestro-overlay-filename-contract.test.ts`
and coordinated on ai-maestro#83.
