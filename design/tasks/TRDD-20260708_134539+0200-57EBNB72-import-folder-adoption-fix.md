---
trdd-id: 57EBNB72
title: Fix folder-adoption import — allowExternalFolder schema + workdir gitignore seeding (G05c)
column: testing
created: 2026-07-08T13:45:39+0200
updated: 2026-07-08T14:35:00+0200
current-owner: main-session
assignee: main-session
priority: 0
severity: HIGH
effort: M
labels: [fleet-readiness, import-system, agent-workdir]
task-type: bugfix
parent-trdd: TRDD-903b7a20
approval-tier: 0
release-via: none
test-requirements: [unit, integration, typecheck, lint]
review-requirements: []
impacts: [public-api]
relevant-rules: []
implementation-commits: [e5f0481d, f214be8c, 90ebeda2, bc01cb4d]
last-test-result: pass
last-test-at: 2026-07-08T14:30:00+0200
---

# Fix folder-adoption import — allowExternalFolder schema + workdir gitignore seeding (G05c)

Tier-0 NPT of the fleet-readiness campaign (TRDD-903b7a20, blocker B1). Full approved plan:
`~/.claude/plans/humming-sleeping-gizmo.md` (WS1). Exploration evidence: the two 2026-07-08
background traces recorded in the campaign STATE.

## Problem

1. The wizard's "Browse existing project folder" adoption path is broken at the API boundary:
   `app/api/agents/route.ts` zod schema is `.strict()` without `allowExternalFolder`, so every
   request carrying the flag (wizard + AgentList revive) 400s. `CreateAgent` already supports the
   option and G03-ENFORCE already honors it — only the schema line is missing.
2. Adopting a git-repo workdir pollutes it: `.claude/rules/aimaestro-*.md`,
   `.claude/settings.local.json`, per-op writes, and runtime tool artifacts have NO gitignore
   protection (no gitignore writer exists in the codebase).
3. `app/api/agents/folders/route.ts` marks folders of soft-deleted agents as taken forever
   (missing `deletedAt` filter).
4. Wizard maintainer path never offers the folder picker; AgentList revive uses a `_`-prefixed
   name that always fails G01.

## Change set (WS1)

1. Schema: add `allowExternalFolder: z.boolean().optional()` to POST /api/agents.
2. G03-CLAMP before G03-ENFORCE: flag ignored when the resolved workdir is outside $HOME.
3. NEW `lib/workdir-gitignore-seed.ts` — marker-delimited managed `.gitignore` block for git-repo
   workdirs (idempotent, dedupe, user content preserved); called as G05c in CreateAgent + wake
   self-heal in ensureCorePluginInstalled.
4. Folders route: tombstone filter + `githubRepo` enrichment (pure-fs `.git/config` read).
5. Wizard: maintainer step order `title → folder → github-repo → summary` + githubRepo prefill;
   AgentList revive name fix.
6. Tests: unit (gitignore seeder), integration (G05c + clamp), unit (route schema).

## Verification

`npx tsc --noEmit` · `npx vitest run` (3 new suites + guard createagent-g11/g06/g08) · eslint on
touched files · `node --check server.mjs`. Then the WS1b dummy live-import protocol (clone →
adopt → clean-tree assert → idle-burn → delete → re-import) before ANY real fleet import.

## Approval log
