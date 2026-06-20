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

## 6. R33/R34/R35/R40 — signed-ledger AID authority + foreign-host approval

Implements the signed-ledger-as-ultimate-truth identity model. Shipped
behind a staged-rollout flag, `ledger.enforceAidAssociation` (in the
encrypted security config, **default OFF** per decision D5). With the
flag OFF the system behaves EXACTLY as before — a valid AID is trusted
without a ledger-history check (zero wire/behavior change). With it ON,
the four rules below activate.

### New ledger ops (`types/ledger.ts`, additive)

`aid_associate`, `aid_reissue`, `aid_approve_foreign`, `aid_revoke`,
`foreign_user_grant`, `foreign_user_revoke`. All append to the existing
`agents/registry.json` signed chain (`verify()` does not enum-check
`op`, so existing ledger files verify byte-for-byte — no migration).

### R34.1 — AID must be ledger-backed (flag-gated)

- **MINT** (`POST /api/v1/auth/token`): when the flag is ON, an AID
  whose fingerprint has no `aid_associate`/`aid_reissue` for the agent
  it claims is refused with `403 { error: "aid_no_ledger_history" }`.
  When the live token store was lost but the ledger still proves the
  binding, the title/team are reconstructed from the ledger (R33) and
  the ledger value is authoritative over the registry.
- **SPEND** (`lib/agent-auth.ts`, all three agent paths — `aim_tk_`,
  `mst_`, IBCT): same check before returning a verified agent identity;
  an unbacked agent is rejected `403 aid_no_ledger_history`. This is an
  AID-validity check (R28 check 1), **not** a sudo gate (R32) — agents
  are supposed to pass it.

### R33 — recovery (new ops route)

- `POST /api/system/aid-recover` (**strict**, system-owner + sudo) —
  rebuild an agent's auth state from the signed ledger for a given
  `agentId` or `fingerprint`; reports the recovered `{title, team,
  fingerprint}`. The automatic path runs inside the token-route mint
  fallback above.

### R34.2 / R35 — foreign-agent import is no longer auto-accepted (BREAKING)

- `POST /api/agents/import`: when the export's `manifest.exportedFrom.hostname`
  differs from this host, the import is **not** performed. It returns
  `202 { success:false, pendingApprovalId }`, stages the ZIP, and
  enqueues a pending entry — **no keys imported, no AID registered**.
  Native (same-host) imports keep the existing fast path and now record
  an `aid_associate` for the restored agent.
- New routes (**all strict, system-owner + sudo — MAESTRO via UI only**):
  - `GET  /api/agents/foreign-approvals` — list pending approvals.
  - `POST /api/agents/foreign-approvals/[id]/approve` — materialize the
    staged agent, **re-issue a fresh native AID** (discarding the
    foreign key), and record `aid_reissue` + `aid_associate` +
    `aid_approve_foreign`. The foreign fingerprint stays permanently
    unbacked (impersonation defense).
  - `POST /api/agents/foreign-approvals/[id]/reject` — discard the
    staged import.

### R40 — foreign-user per-command grant

- `CreateAgent` (and, by the exported `assertForeignUserMayCall`
  helper, `create_team`) refuse a foreign (non-native) user unless the
  MAESTRO granted that command (v1 restrictable set:
  `{create_agent, create_team}`). Inert for native users / the MAESTRO
  / agents, and inert entirely when the user-authority model is OFF (no
  `userId` is resolved then).

**Effect on plugins:** No wire change while the flag is OFF. The
foreign-import 202 contract is the only breaking change, and only for a
host that flips enforcement on AND imports a cross-host export — the
replacement is the approval queue above.

**Reference:** R33/R34/R35/R40 in `docs/GOVERNANCE-RULES.md`.

## 7. Sessions-browser routes: aim_session VALIDATION + path-traversal SSOT (2026-06-21)

Two security fixes to the `/api/sessions-browser/*` routes (Next-mode AND
headless-mode mirrors), landing TRDD-9e1e4b29 + TRDD-5df6f7da.

**Auth gate hardened (TRDD-9e1e4b29).** Every `/api/sessions-browser/*`
route previously gated on `hasSessionCookie`, which returned `true` for ANY
non-empty `aim_session` cookie value (presence-only). A client on the
allowed network (localhost / Tailscale) could read every agent's full
transcript + context breakdown by sending `Cookie: aim_session=anything`.
The routes now call `hasValidSession`, which VALIDATES the token against the
server session store (`validateSession` in `lib/session-auth.ts`). Forged /
absent / expired `aim_session` → **401 `unauthenticated`**, reader never
invoked. A real logged-in session (issued by `login` / `setup-verify` /
`webauthn/authenticate` via `createSession`) is unaffected — `validateSession`
is independent of the user-authority-model toggle, so no legit-user lockout.

**Path-traversal guard de-duplicated + headless hole closed (TRDD-5df6f7da).**
`confineToProjectsStore` (resolve → must end `.jsonl` → must sit under
`~/.claude/projects/`) was copy-pasted into 3 Next routes; it now lives once
in `services/sessions-browser-service.ts`. The **headless-router mirror had
NO confinement** — its range/search/context-breakdown handlers passed
`?path=` straight to the reader (a traversal hole). All 3 headless handlers
now use the shared guard: a `?path=` outside the transcript store → **400
`invalid_path`**.

**Effect on plugins:** wire-compatible for legitimate callers (a valid
session cookie behaves exactly as before). A request relying on a junk or
absent `aim_session` to read transcripts now correctly gets 401. No endpoint
shapes changed. `tsc --noEmit` clean; full unit suite 1851 passed / 0 failed.

**Still open (separate TRDD needed):** `server.mjs`'s full-mode
`hasCredential()` uses its own inline presence-only `aim_session` regex —
same weakness, broader surface; it is `.mjs` and cannot import the TS
validator without a build step.

## 8. ChangeFolder confines workingDirectory to ~/agents/ (2026-06-21)

`TRDD-35af6b13`. `PATCH /api/agents/[id]` with a `workingDirectory` change
(the `ChangeFolder` pipeline) now **rejects any target outside `~/agents/`**.
Previously `ChangeFolder` validated only no-`..`-traversal and that the path
existed + was a directory — any existing absolute dir was accepted (e.g.
`~/.claude`, `~/ai-maestro`). Since the agent-shell-guard permits writes
anywhere under an agent's `workingDirectory` and `DeleteAgent`'s folder-delete
safety is gated on `~/agents/`, relocating an agent outside `~/agents/` was a
write-boundary escape. A new gate **G01b** (mirroring `CreateAgent`
G03-ENFORCE and `DeleteAgent` G09, checked before the existence probe) returns
an error `Working directory must be under ~/agents/ …` and writes nothing.

**Plugin impact:** an agent-management call that set `workingDirectory` to a
path outside `~/agents/` used to succeed and now fails with that error. No
endpoint shape changed; legitimate `~/agents/<name>` relocations are
unaffected. `tsc --noEmit` clean; `tests/integration/change-folder-confinement.test.ts`
(4 cases) green.

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
