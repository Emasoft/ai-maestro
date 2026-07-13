---
trdd-id: QH6WD7XI
title: Docs alignment for folder adoption — managed gitignore block + allowExternalFolder semantics
column: completed
created: 2026-07-08T14:21:32+0200
updated: 2026-07-13T10:41:29+0000
current-owner: main-session
assignee: main-session
priority: 2
severity: LOW
effort: S
labels: [fleet-readiness, import-system, docs, derived-eht]
task-type: docs
parent-trdd: TRDD-57EBNB72
derived: true
derived-kind: eht
approval-tier: 0
release-via: none
test-requirements: []
relevant-rules: []
implementation-commits: []
---

# Docs alignment for folder adoption

Derived EHT of TRDD-57EBNB72: the WS1 changes introduced behavior that existing docs do not
describe. Without this pass, the next contributor (or the next Claude session) re-derives it
from code or, worse, "fixes" the managed block away.

## Scope

1. **CLAUDE.md** — Runtime Install Tree / agent-workdir sections: document
   `<workdir>/.gitignore` managed block (marker `ai-maestro:managed-gitignore`, created at
   CreateAgent G05c, self-healed on wake) and that `.claude/rules/aimaestro-*.md` +
   `.claude/settings.local.json` are covered by it in git-repo workdirs.
2. **CLAUDE.md / wizard docs** — `allowExternalFolder` semantics: accepted by POST /api/agents,
   clamped to $HOME (G03-CLAMP), G03-SAFETY blocklist unchanged; maintainer wizard order is now
   title → folder → github-repo (prefill from the folder's git origin).
3. **docs/API-CHANGES.md** — record the POST /api/agents schema addition + folders-route
   `githubRepo` enrichment field (plugins fetching raw markdown treat that file as the
   between-branches changelog).

## Result — 2026-07-08

Done in one pass (single commit; SHA recorded in implementation-commits):

1. **CLAUDE.md**: `~/agents/<agent-name>/` runtime-tree now documents
   `.git/info/exclude` (the managed block's REAL home — the scope's original
   `.gitignore` wording was superseded by the WS1b live catch: repos TRACK
   `.gitignore`, so the seeder writes info/exclude), and a new
   "Folder adoption — allowExternalFolder (TRDD-57EBNB72)" subsection in the
   Element Management Service section covers G03-CLAMP, G05c, the folders-route
   tombstone filter + `githubRepo` enrichment, the maintainer wizard step order,
   and the soft/hard delete folder semantics.
2. **docs/API-CHANGES.md**: new entry "POST /api/agents — allowExternalFolder +
   managed git-exclude seeding (TRDD-57EBNB72, 2026-07-08)" for raw-markdown
   plugin consumers.

## Approval log

- 2026-07-08T17:50:00+0200 — COMPLETED by main-session (tier 0). Docs describe the
  SHIPPED behavior (info/exclude), not the pre-catch design.
