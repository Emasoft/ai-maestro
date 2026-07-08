---
trdd-id: QH6WD7XI
title: Docs alignment for folder adoption — managed gitignore block + allowExternalFolder semantics
column: planned
created: 2026-07-08T14:21:32+0200
updated: 2026-07-08T14:21:32+0200
current-owner: main-session
assignee: main-session
priority: 2
severity: LOW
effort: S
labels: [fleet-readiness, import-system, docs, derived-eht]
task-type: docs
parent-trdd: TRDD-57EBNB72
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

## Approval log
