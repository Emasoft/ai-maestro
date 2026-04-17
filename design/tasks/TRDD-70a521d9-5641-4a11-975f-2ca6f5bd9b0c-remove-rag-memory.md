# TRDD-70a521d9-5641-4a11-975f-2ca6f5bd9b0c — Remove RAG-based memory system (keep subconscious)

**TRDD ID:** `70a521d9-5641-4a11-975f-2ca6f5bd9b0c`
**Filename:** `design/tasks/TRDD-70a521d9-5641-4a11-975f-2ca6f5bd9b0c-remove-rag-memory.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started — design ready, audit complete, awaiting implementation kickoff.
**Created:** 2026-04-17
**Owner:** TBD
**Priority:** P1 — eliminates ~276 MB of node_modules, removes a whole subsystem and its native build deps, simplifies agent lifecycle.
**Supersedes:** the agent-local RAG memory, embedding pipeline, long-term memory consolidation, and per-agent CozoDB storage.

> **Companion audit:** the full reference inventory, risk analysis, and phased removal plan live in
> `docs_dev/2026-04-17-rag-memory-removal-audit-v2.md` (617 lines, Sonnet-authored,
> every claim cited with `file:line`). This TRDD is the tracked summary; the audit is the authoritative
> working document.

---

## 1. Problem statement

AI Maestro currently runs a local RAG-based agent memory system:

- Conversation JSONL files are auto-indexed into a per-agent CozoDB at `~/.aimaestro/agents/<uuid>/agent.db`.
- Embeddings come from `@huggingface/transformers` (`Xenova/bge-small-en-v1.5`) executed locally via `onnxruntime-node`.
- An `AgentSubconscious` timer loop in `lib/agent.ts` schedules periodic `maintainMemory()` runs and nightly `triggerConsolidation()` via a CronJob.
- Long-term memories (LLM-extracted summaries) are stored in a warm tier, surfaced in `MemoryViewer.tsx`, and searched via a hybrid BM25 + vector (Reciprocal Rank Fusion) pipeline.

Claude Code recently shipped first-class built-in memory features, which **supersede** this custom stack. Keeping the custom RAG adds weight for no benefit:

- 276 MB of native-binary node_modules (`@huggingface/transformers` + `onnxruntime-node`) plus `cozo-node`.
- Multi-GB per-agent `agent.db` files that we also scanned during the disk cleanup work.
- `lib/rag/` (~11 files) + `lib/memory/` (~6 files) + 5 CozoDB schema files + a memory service + 6 API routes + UI components (`MemoryViewer`, memory stats on `SubconsciousStatus`, `AgentSubconsciousIndicator`, a "Rebuild Memory" button in `WorkTree.tsx`).
- Ongoing maintenance cost: two memory providers (Claude + Ollama), schema evolution, hybrid search tuning.

## 2. Scope — REMOVE vs PRESERVE

### REMOVE

- **`lib/rag/`** entirely (embeddings, ingest, hybrid search, code/db/doc indexers, parsers, schema).
- **`lib/memory/`** entirely (consolidate, search, providers, types, barrel).
- **All CozoDB schema files** (`cozo-db.ts`, `cozo-schema-rag.ts`, `cozo-schema-memory.ts`, `cozo-schema-simple.ts`, `cozo-schema.ts`, `cozo-schema-phase5.ts`, `cozo-utils.ts`).
- **`services/agents-memory-service.ts`** (after extracting `getMetrics`/`updateMetrics` to a new metrics service).
- **Memory API routes** — `memory/route.ts`, `memory/consolidate/route.ts`, `memory/long-term/route.ts`, `search/route.ts`, `tracking/route.ts`, `index-delta/route.ts`.
- **Memory UI** — `components/MemoryViewer.tsx`, memory fields in `components/SubconsciousStatus.tsx` + `components/AgentSubconsciousIndicator.tsx`, "Rebuild Memory" action in `components/WorkTree.tsx`.
- **Memory-specific timer callbacks** inside `AgentSubconscious` — `maintainMemory()`, `scheduleConsolidation()`, `runConsolidation()`, `triggerConsolidation()`, plus their `memoryTimer` / `consolidationTimer` fields.
- **`scripts/memory-search.sh`**, **`scripts/memory-helper.sh`**, graph/docs install scripts if the graph feature is also dropped (Phase 4 decision gate).
- **NPM packages:** `@huggingface/transformers`, `onnxruntime-node`, `cozo-node`.
- **On-disk:** all `~/.aimaestro/agents/<uuid>/agent.db` files.
- **System settings:** `conversationIndexerEnabled` kill-switch (becomes dead code).

### PRESERVE — detach from memory but keep

- **`AgentSubconscious` timer/scheduler infrastructure** — the `start()`, `stop()`, `setActivityState()`, `writeStatusFile()`, `getStatus()` methods, the `messageTimer`, and the process-lifecycle hooks all stay. They serve non-memory duties (activity tracking, status file for dashboard, deprecated message polling).
- **`services/agents-subconscious-service.ts`** — strip memory fields, keep status/control surface.
- **`types/subconscious.ts`** — remove `MemoryRunResult`, `MemoryStats`, and memory fields from `SubconsciousProcessStatus`; keep the rest.
- **`~/.aimaestro/agents/<uuid>/status.json`** — continues to exist, memory fields stripped from schema.
- **Cerebellum** (`docs/CEREBELLUM.md`) — voice pipeline + TTS subsystem, unrelated to RAG memory, untouched.
- **Claude Code's new built-in memory features** — they become the replacement, not a migration target we own.

## 3. Key integration landmines (from audit §11)

Ordered by severity so Phase 0 addresses them first.

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | ~~`lib/agent-startup.ts::discoverAgentDatabases()` scans FS for `agent.db` files — after removal returns empty, **silent regression** (no subconscious processes start).~~ **RE-ANALYSIS 2026-04-17:** the FS scan reads agent *directories*, not `agent.db` files. Phase 9's `find -name 'agent.db' -delete` removes only the DB file — directories persist (they also hold `keys/` = the agent's AID identity, and `status.json`). The existing FS+registry-intersect is the **AID integrity invariant** and must NOT be rewritten to registry-only: doing so would hand missing-dir agent IDs to `agentRegistry.getAgent()` → `getDatabase()` → fresh empty dir → silent AID identity loss. | ~~HIGH~~ **NOT A RISK** | Leave `discoverAgentDatabases()` alone. The actual Phase 9 coupling is inside `agentRegistry.getAgent()`; Phase 1 must ensure subconscious startup no longer calls `getDatabase()`. |
| 2 | `getMetrics()` / `updateMetrics()` in `services/agents-memory-service.ts` are **not** memory-coupled but live there — `app/api/agents/[id]/metrics/route.ts` imports them. | **HIGH** | Extract to `services/agents-metrics-service.ts` BEFORE deletion (Phase 0). |
| 3 | `lib/transcript-export.ts` queries CozoDB `messages` table — transcript export breaks post-removal. | **MEDIUM** | Rewrite `fetchMessages()` to read JSONL directly (Phase 5). |
| 4 | `lib/agent-db-sync.mjs` called from `server.mjs` at startup — will fail to import `cozo-node`. | **MEDIUM** | Remove the sync call from `server.mjs` (Phase 5). |
| 5 | `cozo-utils.ts` imported in `services/config-service.ts` but unused — TypeScript will break on removal. | **LOW** | Strip the import (Phase 2). |
| 6 | `MemoryCategory` imported in `app/api/agents/[id]/memory/long-term/route.ts`. | **LOW** | Auto-resolved when route is deleted (Phase 2). |
| 7 | `services/agents-graph-service.ts` + `services/agents-docs-service.ts` are fully RAG-backed. `AgentGraph.tsx` and `GraphVisualization.tsx` depend on them. | **MEDIUM** | Phase 4 decision gate: drop the feature vs replace the backing store. |
| 8 | `services/headless-router.ts` registers the index-delta route and imports `runDeltaIndex`. | **LOW** | Remove the registration (Phase 2). |
| 9 | `components/WorkTree.tsx::rebuildMemory()` calls removed routes — silent UI failure. | **LOW** | Remove the button (Phase 3). |
| 10 | Existing `status.json` files on disk contain old memory fields — reader must tolerate both shapes. | **LOW** | Current code already defaults with `|| 0` / `|| null`; verify (Phase 7). |

## 4. User-facing features retired (audit §12)

1. Conversation memory indexing (auto JSONL → CozoDB)
2. Semantic search over conversations (BM25 + vector RRF via `/api/agents/[id]/search`)
3. Long-term memory consolidation (nightly 2AM LLM-extracted memories)
4. `MemoryViewer.tsx` (cards with edit/delete)
5. "Rebuild Memory" button in WorkTree
6. Subconscious memory stats in status indicators
7. Code graph indexing / `AgentGraph.tsx` *(if Phase 4 drops the graph feature)*
8. DB schema graph visualization *(same)*
9. Documentation indexing *(same)*
10. Transcript export via CozoDB (will be rewritten to read JSONL directly — same user-facing outcome)

## 5. Phased removal plan (authoritative — full detail in audit §13)

Each phase must build (`yarn build`) and pass (`yarn test`) before proceeding. Every phase is a separate commit.

| Phase | Goal | Touches |
|-------|------|---------|
| **0** | Preparation — extract metrics service, rewrite `discoverAgentDatabases()` to read from `registry.json`. Unblocks everything else. | 3 files modified |
| **1** | Remove memory timer callbacks from `AgentSubconscious` — keep the class, snip the memory methods and timer fields. | `lib/agent.ts` |
| **2** | Delete `services/agents-memory-service.ts` + 6 API routes. Strip memory fields from `agents-subconscious-service.ts`, `config-service.ts`, and `system-settings.ts`. Deregister routes in `headless-router.ts`. | 10+ files |
| **3** | Remove memory UI — delete `MemoryViewer.tsx`, strip memory fields from subconscious indicators, drop the "Rebuild Memory" button. | 5+ files |
| **4** | **Decision gate — drop graph/docs features?** If yes: delete `agents-graph-service.ts`, `agents-docs-service.ts`, their routes, and `AgentGraph.tsx`/`GraphVisualization.tsx`. If no: design a non-CozoDB backing store FIRST (blocks Phase 5). | 6+ files |
| **5** | Remove `lib/cozo-db.ts` + all 5 schema files + `cozo-utils.ts` + `lib/agent-db-sync.mjs`/`.ts`. Rewrite `transcript-export.ts` to read JSONL directly. Scrub `server.mjs` references. | 8+ files deleted |
| **6** | Delete `lib/rag/` (11 files + parsers/) and `lib/memory/` (6 files) and `lib/index-delta.ts` and `lib/search-utility.ts`. | 20+ files deleted |
| **7** | Scripts + docs cleanup — delete `memory-*.sh`, update `CLAUDE.md` subconscious section, update `types/subconscious.ts` (strip `MemoryRunResult`, `MemoryStats`, memory fields from `SubconsciousProcessStatus`). | 5+ files |
| **8** | `yarn remove @huggingface/transformers onnxruntime-node cozo-node`. Verify `package.json`. | `package.json`, `yarn.lock` |
| **9** | Data cleanup — after deploy, `find ~/.aimaestro/agents -name 'agent.db' -delete` (optionally cold-backup first). Verify `discoverAgentDatabases()` still finds all agents via registry. | On-disk only |

**Sequencing invariants:**
- Phase 0 MUST precede Phase 1 (prevents silent regression #1 + breakage #2).
- Phases 5/6 MUST follow Phases 2/3/4 (no remaining importers of CozoDB / rag / memory libs).
- Phase 8 MUST follow Phase 6 (or `yarn remove` triggers build break).
- Phase 9 is deploy-time only, not a code change.

## 6. Verification checklist (after each phase)

- `npx tsc --noEmit` clean
- `yarn build` clean
- `yarn test` clean (no tests exercise memory today, so green = confirm nothing adjacent broke)
- Manual smoke (end of Phase 3): dashboard loads, agent profile opens, terminal WebSocket works, status indicator shows activity without memory fields
- Manual smoke (end of Phase 9): brand-new agent creation → subconscious writes `status.json` → dashboard shows correct status without memory fields

## 7. Open decisions

1. **Phase 4 graph/docs gate** — drop the feature or replace the backing store? Needs product decision before Phase 5.
2. **Memory-search skill** — the external AMP plugin ships a `memory-search` skill; confirm whether ai-maestro should also strip references to it from CLAUDE.md and installer scripts.
3. **Cold backup of `agent.db` files** — worth keeping a local backup dir somewhere under `builds_dev/` before Phase 9, in case debugging a historical issue needs the old indexed data.

## 8. Companion documents

- **Full reference audit:** `docs_dev/2026-04-17-rag-memory-removal-audit-v2.md`
- **Earlier first-pass audit (Haiku, superseded — do not use):** `docs_dev/2026-04-17-rag-memory-removal-audit.md` — kept for comparison until the cleanup task lands; can be deleted afterwards.
