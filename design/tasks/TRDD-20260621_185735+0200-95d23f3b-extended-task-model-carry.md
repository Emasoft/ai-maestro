---
trdd-id: 95d23f3b-54df-4890-b452-e16eeb16d070
title: Complete the Extended Task Model — carry evidence fields + attachments/dueDate/first-class-epic end-to-end
column: dev
created: 2026-06-21T18:57:35+0200
updated: 2026-06-21T19:03:10+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: MEDIUM
task-type: feature
release-via: none
test-requirements: [unit, typecheck]
relevant-rules: []
parent-trdd: TRDD-903b7a20
labels: [kanban, task-model, trdd-v2, fleet-readiness, full-headless-parity]
impacts: [public-api]
external-refs: ["github.com/Emasoft/ai-maestro/issues/35", "github.com/Emasoft/ai-maestro/issues/40"]
---

# TRDD-95d23f3b — Complete the Extended Task Model (carry evidence fields end-to-end)

## ⏵ STATE — READ THIS FIRST ON RESUME — 2026-06-21

**Why:** MANAGER (GitHub #35, 2026-06-21T15:42) gave a grounded sequencing decision —
**Extended Task Model FIRST** — because #40 (kanban renderer) and #11 (the 3-pillar
ama-* skills) both READ this metadata. Builds on the parent/child linkage already
landed (5512e9cb).

**Durable artifact (READ before acting):** the full gap matrix + per-file change plan
+ line ranges is at
`reports/task-model-extension/20260621_185142+0200-gap-matrix.md`.

**Grounded findings (✓ verified by the read-only mapper):**
- The `Task` interface (`types/task.ts`) already DEFINES the 6 evidence fields
  (`implementationCommits`, `lastTestResult`, `publishedVersion`, `liveSince`,
  `reviewResult`, `supersededBy`) + 8 classification/relationship fields. The APIs
  ACCEPT+validate them (Zod) but then **silently DROP** the 6 before the service call
  (a 200/201 with vanished evidence — the worst kind of gap).
- **TWO persistence paths; only ONE is live.** `lib/task-registry.ts` (local-file) is a
  complete-but-ORPHANED mirror (only `migrateStatus` is imported live). The LIVE path is
  `lib/github-project.ts` (GitHub Projects V2; TRDD-v2 metadata round-trips as prefixed
  issue LABELS via `trddMetadataLabels`/`mapProjectItemToTask`). **So "carry end-to-end"
  must be solved in `github-project.ts` + `teams-service.ts`** — new LABEL/BODY encodings,
  not just interface fields. Fixing only task-registry ships nothing.
- **FULL-vs-HEADLESS DRIFT (confirmed):** the Next.js PUT (`tasks/[taskId]/route.ts`)
  forwards 0 TRDD-v2 fields; the headless PUT (`headless-router.ts`) forwards 8 — so
  editing a task's severity via the dashboard silently drops it but headless keeps it.
  The fix must bring BOTH whitelists to the identical full set (+ a parity test).
- NEW fields to add: `attachments?: TaskAttachment[]` ({url, name?, kind?}) + `dueDate?`
  (ISO string). `epic` first-class = an exported `TASK_TYPES` const (+ `TaskType`) for the
  UI dropdown/validators; keep `taskType: string` for back-compat (GH stores bare labels
  like `bug`/`enhancement` outside the TRDD set).
- **GitHub label 50-char limit:** `impl-commit:<40-char-sha>` overflows → body-encode
  `implementationCommits` + `attachments` (multi-valued/long); label-encode the singletons
  (`last-test:`, `published-version:`, `live-since:`, `review:`, `due:`, `superseded-by:`).

**NEXT ACTION (dependency-ordered — tsc gates each step; see report §4):**
1. `types/task.ts` — add `TaskAttachment`, `attachments`, `dueDate`, `TASK_TYPES`/`TaskType`.
2. `services/teams-service.ts` — extend `CreateTaskParams`/`UpdateTaskParams` + the two
   `ghProject.*` call sites (unblocks the route comments).
3. `lib/github-project.ts` — label+body encode/decode for the 6 dropped + 2 new fields.
4. `app/api/teams/[id]/tasks/route.ts` + `[taskId]/route.ts` — extend Zod (`.strict()`!) +
   forward ALL fields; delete the obsolete "remaining work" drop-comments.
5. `services/headless-router.ts` — bring both whitelists to FULL parity with Next.js.
6. `lib/task-registry.ts` — finish the orphaned mirror (attachments/dueDate) for the test.
7. `hooks/useTasks.ts` — add the 2 new fields to both Pick unions.
8. UI: `TaskCreateForm` (type/severity/effort/dueDate inputs → makes epic selectable),
   `TaskDetailView`/`KanbanCard` (display new fields; severity badge + due pill for #40).
9. Tests (TDD): github-project label round-trip (NEW, highest value), route field-carry,
   FULL-vs-headless parity, epic first-class, registry carry extension.

**Verification after each phase:** `npx tsc --noEmit` + `yarn test`. Final: per CLAUDE.md
Pre-PR (`yarn test` → bump-version → `yarn build`). Commit per phase; push to fork
(USER-gated merge).

## Scope / non-goals
- Do NOT make `task-registry.ts` the live path (github-project is live) — that GitHub-vs-local
  source-of-truth consolidation is a separate, larger decision.
- Additive only — no existing field/interface removed; `taskType` stays `string`.
