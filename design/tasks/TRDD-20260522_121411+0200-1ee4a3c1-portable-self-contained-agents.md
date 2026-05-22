---
trdd-id: 1ee4a3c1-c6c3-47f5-a8df-30b06a42c483
title: Self-contained portable agents — workdir .aimaestro mirror, sessions.json reconcile, orphan revival
status: not-started
created: 2026-05-22T12:14:11+0200
updated: 2026-05-22T12:28:41+0200
---

# TRDD-1ee4a3c1 — Self-contained portable agents

**Filename:** `design/tasks/TRDD-20260522_121411+0200-1ee4a3c1-portable-self-contained-agents.md`
**Tracked in:** this repo (`design/tasks/` is git-tracked)

> Builds on the shipped boot-restore feature (commit `680e6ef3`,
> `services/boot-restore-service.ts`). That feature re-wakes the registry's
> frozen `status:'active'` set after a reboot. This TRDD adds the surrounding
> robustness + portability the user requested before the first live restart.

## 1. Origin

After the 2026-05-19 blackout, the user asked (before restarting the server)
for: (a) `sessions.json` auto-create+reconcile from the registry with path
validation, (b) an orphan-tmux-session detector that persists a revivable
list and coordinates with boot-restore, (c) a per-agent `<workdir>/.aimaestro/`
folder holding plugin data + a mirror of that agent's registry/session data so
the workdir is **self-contained and portable** (zip on host A → import on host
B losslessly), and (d) eventually chat-history (`.jsonl`) portability so
`claude --resume` works after a cross-host transfer. Guiding principle (already
enforced by the runtime shell guard): **an agent is self-contained in its
working directory.**

## 2. Verified current state (✓ read 2026-05-22)

| Fact | Detail |
|---|---|
| `sessions.json` path | `~/.aimaestro/sessions.json` (`getStateDir()` = `~/.aimaestro`; `STATE_DIR_NAME='.aimaestro'`, `lib/ecosystem-constants.ts:21-25`). **NOT** under `state/`. |
| `sessions.json` state | EXISTS, **86 entries** — overcomplete/stale (persisted on wake, never `unpersistSession`d after unclean shutdown). Registry has only 8 `active`. |
| `PersistedSession` shape | `{ id, name, workingDirectory, createdAt, lastSavedAt, agentId? }` — `id`/`name` = tmux session name. `lib/session-persistence.ts:5-12`. |
| `persistSession` writers | `wakeAgent` (agents-core-service.ts:2014), `createSession` (sessions-service.ts:861). Never bootstrapped from registry. |
| Orphan/unregistered sessions | Computed per-request in `listAgents()` step 5 (agents-core-service.ts:555-609) as `unregisteredSessions`; **never persisted**; no orphan-list file. |
| `session-history.json` | `~/.aimaestro/session-history.json` (40K). Append-only, keyed by tmux session name; carries `workingDirectory/program/programArgs/agentName/agentId/governanceTitle/teamId/rolePlugin/createdAt/lastSeen`. **This is the revivable-orphan dataset.** `lib/session-history.ts`. |
| Path validation | **Absent** — no `existsSync(workingDirectory)` anywhere; boot-restore + wake have none. Shell guard fail-opens if `$AGENT_WORK_DIR` is missing. |
| Export | `GET /api/agents/[id]/export` → `exportAgentZip()` (`services/agents-transfer-service.ts:309`). ZIP v1.2.0 = `manifest.json + registry.json + agent.db + messages/ + skills/ + hooks/ + keys/ + registrations/`. **Global-path-based** (assembles from `~/.aimaestro/...`). Does **NOT** include the workdir, `<workdir>/.claude/` config, or chat `.jsonl`. |
| Import | `POST /api/agents/import` (sudo) → `importAgent()` (`agents-transfer-service.ts:591`). Reconstructs registry entry + copies db/keys/messages/skills/hooks. Does **NOT** recreate `~/agents/<name>/` workdir or `.claude/` config; `workingDirectory` keeps the host-A absolute path. |
| Per-agent `<workdir>/.aimaestro/` | **ABSENT.** All `.aimaestro` = global `~/.aimaestro/`. Per-agent state lives at `~/.aimaestro/agents/<uuid>/`, NOT in the workdir. |
| Workdir scaffold | `createPersona()` (role-plugin-service.ts:1175) makes `~/agents/<name>/` + `.claude/settings.local.json` (plugins). No manifest/registry copy in the workdir. |
| Runtime write-guard | `lib/agent-shell-guard.ts` → installed `~/.aimaestro/agent-shell-guard.sh`, sourced into each agent's tmux pane before launch; overrides `cd`/`pushd`; **allowlist = `$AGENT_WORK_DIR/**` + `/tmp` + `/private/tmp` + `/var/folders`**. A `<workdir>/.aimaestro/` is therefore already inside the writable root — no guard change needed. |

## 3. Source-of-truth model (resolves the redundancy concern)

The user's `<workdir>/.aimaestro/` mirror is **purposeful** redundancy for
portability, not accidental duplication. Explicit contract:

- **Global registry (`~/.aimaestro/agents/registry.json`)** = the runtime
  source of truth **on the local host**.
- **`<workdir>/.aimaestro/` mirror** = a continuously-synced, export-ready
  **derived snapshot** of *this agent's* slice of registry + sessions +
  per-agent state. It is NOT a second runtime authority; it is written
  one-way (registry → mirror) on every change to that agent.
- **On import to host B**, the mirror is **promoted** to authoritative: host B
  reconstructs its registry entry *from* `<workdir>/.aimaestro/`. After import
  the global registry on host B becomes the runtime source of truth again.
- `sessions.json` stays a host-local operational cache (never the authority),
  reconciled from the registry.

This keeps a single runtime authority per host while making the workdir a
complete portable bundle.

## 4. Phased plan

**Governance invariant for all of Phase 1: NOTHING is hard-deleted.** Agents are
only ever soft-deleted (tombstone in registry + zip in `~/.aimaestro/cemetery/`,
restorable via `/api/agents/cemetery`). `sessions.json` entries are operational
cache, not agents — but even so, an entry whose agent has vanished is treated as
an **orphan to surface** (revivable), never as cruft to silently destroy.

1. **`sessions.json` bootstrap-if-missing + non-destructive validation**
   (small `services/session-reconcile-service.ts`, atomic `.tmp`+rename, `withLock`):
   - **If missing** (the user's literal ask) → synthesize from the registry's
     non-deleted agents (one `PersistedSession` per `agent.sessions[].index`,
     `computeSessionName(agent.name, index)`), **validating** that each
     `workingDirectory` exists on disk (skip + record ones whose dir is gone).
   - **If present** (the current 86-entry case: 75 agent-less, 7 active, 4
     offline, 62 dead-workdir) → **do NOT prune**. Validate each entry; entries
     whose agent no longer resolves are **handed to the existing orphan path**
     (item 3) so the user can revive them — they are not deleted. At most, flag.
   - Path validation: `fs.existsSync(workingDirectory)` per entry, recorded.
2. **Boot-restore path validation** (`services/boot-restore-service.ts`):
   - Before `wakeAgent`, verify the agent's `workingDirectory` exists. If gone,
     **skip + record** (don't spawn a guard-disabled session in a dead dir).
   - Boot-restore source stays the registry `status:'active'` set (decision D3).
3. **Orphan handling — REUSE the existing API, expand only if needed** (user
   directive). Detection already exists: `unregisteredSessions` computed in
   `listAgents()` (agents-core-service.ts:555), surfaced as the "Dead Sessions"
   list (`AgentList.tsx:1469`); revival/adoption already exists via
   `POST /api/agents/register`; identity recovery via `lookupSessionAgents`
   (`session-history.json`). The **only** genuine gap is that the detected
   orphan set is recomputed per-request and never persisted. Minimal expansion:
   persist the last orphan scan (so the revivable list is durable) **iff** a
   durable list proves necessary — otherwise rely on the per-request detection
   that already drives the UI. **No parallel orphan service, no new file unless
   required.**
4. **Boot-restore ↔ orphan coordination**: boot-restore wakes registry-active
   agents; the existing unregistered-session detection then surfaces any live
   tmux session with no registry agent. The two sets are disjoint by
   construction (registry-backed vs not). Boot-restore never auto-revives orphans.

### Phase 2 — Per-agent `<workdir>/.aimaestro/` mirror (portability foundation)

5. Introduce `<workdir>/.aimaestro/` written by `createPersona()` at scaffold
   time and kept in sync. Proposed contents:
   ```
   <workdir>/.aimaestro/
     agent.json         # this agent's registry entry (the mirror)
     sessions.json      # this agent's PersistedSession slice
     manifest.json      # bundle version + checksums + source host
     keys/              # Ed25519 keypair (mirror of ~/.aimaestro/agents/<id>/keys)
     plugins.json       # installed role-plugin + normal plugins (for re-emit on import)
     # janitor + other ai-maestro plugins write their per-agent data here too
   ```
6. **Dual-write sync**: every registry/sessions mutation for an agent (through
   the element-management pipelines) also updates that agent's
   `<workdir>/.aimaestro/agent.json` + `sessions.json`. One-way registry→mirror.
7. The mirror lives inside the writable root, so the shell guard already permits
   plugin writes there (self-contained principle upheld).

### Phase 3 — Workdir-based export/import redesign (lossless transfer)

8. Extend `exportAgentZip()` to zip the **entire workdir** (including
   `<workdir>/.aimaestro/`), so "zip the folder" = a complete bundle. Keep the
   global-path assembly as a fallback for agents without a mirror yet.
9. Extend `importAgent()` to, when the bundle is a workdir zip, **recreate
   `~/agents/<name>/`**, read `<workdir>/.aimaestro/` to reconstruct the
   registry entry (promote mirror → authoritative), remap `workingDirectory` to
   host B's path, re-emit/install plugins from `plugins.json`, and restore keys.
   Closes portability gaps #1, #3, #9 from the investigation.

### Phase 4 — Chat-history portability (the "study it" part)

10. Study including `~/.claude/projects/<slug>/*.jsonl` (Claude's own transcript
    store, slug-derived from the absolute workdir) in the bundle, and remapping
    the slug on import so `claude --resume` finds the history on host B.
    Hard problems: slug is a function of the absolute path (changes on host B);
    subagent sidecars; size. Document options, do not commit to one yet.

## 5. Design decisions (status after the 2026-05-22 review)

- **D1 — sessions.json reconcile → RESOLVED: NON-DESTRUCTIVE.** Never prune /
  hard-delete. Governance invariant: agents are only ever soft-deleted (tombstone
  + cemetery zip, restorable); a session-cache entry whose agent has vanished is
  **surfaced to the existing orphan path**, never destroyed. Bootstrap only
  *synthesizes* entries when the file is MISSING. (This supersedes the earlier
  "prune invalid, back up to .trashcan" idea, which wrongly applied delete
  semantics to a system that never hard-deletes.)
- **D2 — Orphan handling → RESOLVED: REUSE EXISTING API.** Detection
  (`unregisteredSessions` / "Dead Sessions" in `AgentList.tsx`), adoption
  (`POST /api/agents/register`), and identity recovery (`session-history.json`)
  already exist. Add a persisted snapshot ONLY if a durable cross-restart list
  proves necessary — otherwise no new file and no new service.
- **D3 — Boot-restore source → RESOLVED: registry `status:'active'` set**
  (user-confirmed). Reconcile makes `sessions.json` agree with it; the shipped
  boot-restore logic is unchanged.
- **D4 — Sequence → PENDING your go-ahead.** Plan: build Phase 1 (items 1–4),
  then `pm2 restart` to bring the 8 agents back via the hardened path; Phases
  2–4 stay planned. (You chose "adjust the plan first" — this §4/§5 revision is
  that adjustment.)

## 6. Non-goals / guardrails

- Do not weaken the shell-guard allowlist; `<workdir>/.aimaestro/` is already
  inside it.
- Do not make `<workdir>/.aimaestro/` a second runtime authority (§3).
- Phase 3/4 are explicitly future; Phase 1 is the only pre-restart work.

## 7. References

- Shipped boot-restore: `services/boot-restore-service.ts`, commit `680e6ef3`.
- Investigation findings inlined in §2 (source reports were read-only Explore
  agents, not persisted).
- Related: `services/agents-transfer-service.ts` (export/import),
  `lib/session-history.ts`, `lib/session-persistence.ts`,
  `lib/agent-shell-guard.ts`.
