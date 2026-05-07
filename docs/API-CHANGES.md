# API Changes Since `governance-rules` Branch

**Audited at HEAD:** `5a9ff076` on `feature/phase6-jsonl-rebase-test`
**Compared against:** `fork/governance-rules` (`8fb040f8` 2026-05-06)
**Audit date:** 2026-05-07

The `governance-rules` branch is the canonical surface that
**downstream plugins, role-plugin repos, and other tooling fetch from
the fork** (via `https://raw.githubusercontent.com/Emasoft/ai-maestro/governance-rules/...`).
Every API or governance-relevant change committed since then is
listed below in chronological order, oldest first. After this doc
lands, `governance-rules` is fast-forwarded to HEAD so the fetched
content matches what the server actually serves.

`docs/GOVERNANCE-RULES.md` itself is **byte-identical** between the
two branches — confirmed by `git diff fork/governance-rules HEAD --
docs/GOVERNANCE-RULES.md` returning zero output. The deltas below
are about the SERVER-side API surface that those rules govern.

## 1. AIO migrations (R21 enforcement)

Per R21 (AIO Composition Rule, IRON), every mutation must go through
the corresponding All-In-One pipeline. The following call sites were
migrated since `governance-rules`:

| Commit | Surface | What changed |
|---|---|---|
| `45eb4a9e` | `PATCH /api/agents/[id]/metadata` | Now goes through the new `ChangeMetadata` AIO instead of writing the registry directly. Pre-gate validates ledger integrity; post-gate restarts the agent so the new metadata is observed. |
| `576f6a89` | `services/sessions-service.ts` | `claude-adapter` writes are wrapped by a runtime AIO guard. Out-of-band writes throw a `RuntimeError` instead of silently corrupting state. |
| `ba96094a` | `services/amp-service.ts` | Metadata writes for AMP signing keys / inbox state now go through `ChangeMetadata`. |
| `6d531c4c` | `deleteRolePlugin` helper | Replaced with calls to `UninstallPlugin` AIO (cross-agent). Boot helpers documented in the commit message. |
| `d0440482` | `app/api/settings/marketplaces/route.ts` | All four handlers (POST/GET/PATCH/DELETE) now drive `ChangePlugin` AIO calls per-affected-agent instead of touching the marketplace store directly. |
| `316a412a` | 3 R21.4 violations | Direct ledger writes in three legacy paths refactored to AIO calls. |
| `8fb040f8` | `server.mjs` startup | Marketplace registration on startup goes through AIO, fixing the "default marketplace not registered for fresh agents" race. |

**Effect on plugins:** No wire change. The endpoints accept the same
JSON. The internal lifecycle is now the documented one — pre-gate
validation, single-source-of-truth state mutation, post-gate
restart-on-config-change.

**Reference:** R21 in `docs/GOVERNANCE-RULES.md` (added at `ccf7afbb`,
folded into v3.9.0 single-source at `05c810a8`).

## 2. JSONL Session Browser API (Phase 5 + Phase 6)

The Session Browser exposes server-side JSONL inspection. The
following endpoints were added or extended since `governance-rules`:

### `GET /api/sessions-browser/sessions` — list

(Pre-existed.) Lists JSONL sessions discovered on disk; pagination
unchanged.

### `POST /api/sessions-browser/sessions/:sid/open` — open a session

(Pre-existed.) Opens a session by id and returns its line count.
Now serialized via per-path Promise lock to eliminate the
`session_not_found` 404 race.

### `GET /api/sessions-browser/sessions/:sid/range` — read a range of lines

(Pre-existed.) Range read with `?fromLine=...&toLine=...`. Now
includes a 3-attempt retry loop on `session_not_found` for
robustness against the same race window.

### `GET /api/sessions-browser/sessions/:sid/search` — search

(Pre-existed.) Same retry semantics as `range`.

### `GET /api/sessions-browser/sessions/:sid/context-breakdown` — context analysis

**Extended in Phase 6 + Phase B + Phase C:**

New query parameter:
- `?atIndex=N` — when provided (non-negative integer), returns the
  breakdown as it would have been at the JSONL line at that index.
  Drives the click-to-pin context panel.

Response shape additions (every field is optional for backwards
compat with pre-Phase-6 clients):

```ts
interface ContextBreakdownOkResponse {
  ok: true
  // ... existing fields ...

  // Phase 5 / Phase 6
  skills: number
  autocompactBuffer: number

  // Phase 6 captured-snapshot
  source?: 'recorded' | 'heuristic'        // ← deprecated, see recordedSnapshot
  capturedAtLineIndex?: number | null      // ← deprecated
  capturedAtTimestamp?: string | null      // ← deprecated
  recordedSnapshot?: ContextBreakdownRecordedSnapshot | null

  // Phase B drill-down enumeration
  elements?: ContextBreakdownElements
}
```

**Semantic change in Phase A:** the breakdown numbers ALWAYS come
from the heuristic (JSONL parse + on-disk tokenization). Captured
`/context` snapshot numbers, when present, are surfaced separately
under `recordedSnapshot` so the UI can render them as a comparison
overlay. Older clients that read `source === 'recorded'` continue to
work — `source` is always `'heuristic'` now.

**Phase B addition — `elements`:**

Per-bucket enumeration of every element loaded into context:

```ts
interface ContextBreakdownElements {
  systemPrompt: ConstantBucket             // tokens + note
  systemTools: ConstantBucket
  mcpTools: ConstantBucket
  customAgents: ContextBreakdownBucketElement[]
  memory: ContextBreakdownBucketElement[]
  skills: ContextBreakdownBucketElement[]
  messages: { tokens, userCount, assistantCount }
  autocompactBuffer: ConstantBucket
}
interface ContextBreakdownBucketElement {
  name: string                              // pluginName:elementName when applicable
  tokens: number
  scope: 'user' | 'project' | 'plugin' | 'builtin'
  detail?: string
  status?: 'normal' | 'approx' | 'missing'  // Phase C
}
```

**Phase C addition — `status` field:** Provenance tag set on each
element when `?atIndex=N` is used:
- `normal`  — historical token count from the inventory ledger
- `approx`  — current on-disk count (no ledger snapshot in scope)
- `missing` — element existed at session time but not on disk now
Absent for live-view (no `atIndex` parameter).

### `POST /api/agents/[id]/element-inventory` — NEW (Phase C1)

Append a snapshot of the agent's currently-loaded elements to the
per-agent ledger at `~/.aimaestro/element-inventory/<agentId>.jsonl`.
Called by the `ai-maestro-plugin` SessionStart hook (Phase C2 —
deferred) and the `/reload-plugins` string-detect hook.

Auth: `enforceAuth` (AID proof-of-possession, same as every other
agent-scoped mutation).

Body:
```json
{
  "ts": "2026-05-07T16:00:00Z",  // optional; defaults to now
  "trigger": "session_start" | "reload_plugins" | "manual",
  "elements": [
    {
      "name": "ai-maestro-plugin:agent-messaging",
      "tokens": 12345,
      "scope": "plugin",
      "bucket": "skills",
      "detail": "/path/to/SKILL.md"
    }
  ]
}
```

Response: `{ "ok": true, "ts": "...", "count": N }`

Validation:
- agent id format `/^[a-zA-Z0-9_.@-]+$/`, ≤128 chars
- `trigger` in `{session_start, reload_plugins, manual}`
- elements array ≤5_000 entries
- per-element: `name` ≤256, `tokens` non-negative number, `scope` and
  `bucket` from the documented enums, `detail` ≤1024

## 3. Server-side restart triggers

Commit `fdea4141` (`feat(restart): every plugin/element mutation
now triggers stop+restart`) made the AIO post-gates explicitly issue
a graceful agent restart whenever they touch any element that lands
in the agent's launch arguments or per-agent settings. Pre-existing
endpoints (`PATCH /api/agents/:id`, `POST /api/agents/:id/install-skills`,
etc.) now reliably restart instead of silently leaving the running
process at a stale config. Wire-level: same; behavior-level: more
predictable.

## 4. Address-format canonicalization

Commit `ff4ef8b5` (`docs+ui(addressing): canonical agent-id format
(R6.11-R6.14)`) added rules R6.11-R6.14 to `docs/GOVERNANCE-RULES.md`.
Plugins that compose agent addresses (`<id>` vs `<id>@<host>` vs
`<persona>@<tenant>.local`) should honor the canonical format described
there. The endpoints accept the same shapes as before — this is
documentation tightening, not a wire change.

## 5. Compatibility with Claude Code 2.1.113 - 2.1.132

See `docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md` for the per-changelog-
entry verdict. Net effect on this repo's API: ZERO required changes.

## How plugins should consume this doc

1. The role-plugins use `https://raw.githubusercontent.com/Emasoft/ai-maestro/governance-rules/docs/GOVERNANCE-RULES.md` (and similar for other docs) to learn about API surface.
2. After Phase F lands, `governance-rules` is fast-forwarded to the
   commit that contains this doc, so plugins that fetch any of:
   - `docs/GOVERNANCE-RULES.md`
   - `docs/PLUGIN-ABSTRACTION-PRINCIPLE.md`
   - `docs/COMMUNICATION-GRAPH.md`
   - `docs/AGENT-MESSAGING-GUIDE.md`
   - `docs/API-CHANGES.md` (this file)
   - `docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md`
   ...will see the current state, not the 20-commits-old snapshot.
3. The `feature/phase6-jsonl-rebase-test` branch is the integration
   branch; merges to `main` happen separately when the JSONL browser
   ships in a versioned release.
