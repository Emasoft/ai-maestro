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

## 9. Kanban: Next.js POST tasks route now forwards TRDD-v2 fields (2026-06-21)

`TRDD-67f8b9bd`. `POST /api/teams/[id]/tasks` in **FULL (Next.js) mode** now
**forwards the 8 end-to-end-supported TRDD-v2 task fields** — `severity`,
`effort`, `parentTask`, `npt`, `eht`, `supersedes`, `relevantRules`,
`releaseVia` — into the created task. Previously the route VALIDATED these via
its Zod schema (so the request returned 200) but never spread them into the
params passed to `createTeamTask`, so they were silently dropped on create. The
**headless mode** mirror already forwarded them correctly, so this was a
FULL-vs-headless drift, now resolved (both modes behave identically).

**Plugin impact:** a kanban task created via the FULL-mode API with TRDD-v2
metadata now persists that metadata (encoded as `severity:…` / `npt:…` / …
GitHub issue labels by the github-project layer) instead of losing it. No
endpoint shape or validation changed. Six further schema-accepted fields
(`reviewResult`, `supersededBy`, `implementationCommits`, `lastTestResult`,
`publishedVersion`, `liveSince`) are still accepted-but-not-yet-carried in
*both* modes — a separate follow-up, not a behavior change here. `tsc --noEmit`
clean; `tests/unit/api-team-tasks-trddv2-fields.test.ts` (2 cases, RED-verified
first) green.

## 10. ChangeTitle Gate 17 now enforces R9.13 when an install leaves an agent role-less (2026-06-21)

`TRDD-51ed3b0b`. ChangeTitle persists the new title at **Gate 14** BEFORE
installing the role-plugin at **Gate 16**. Gate 16 only WARNs on a failed
install, so a failure left the agent **titled but role-less** — and the old
**Gate 17** consistency check reported `Plugin state consistent (0
role-plugin(s))` (a false positive), masking the R9.13 violation. Gate 17 now,
when a role-plugin was REQUIRED (`targetPluginName` resolved) but 0 are active
after Gate 16, **retries the install once**; if the agent is still role-less it
sets `roleMissing=true` on the registry and **hibernates** the agent (mirroring
ChangePlugin's PG04 recovery), so `/wake` refuses with `role_plugin_required`
(409) until the Config tab assigns a plugin. The recovery calls
`installPluginLocally` directly (never `ChangeTitle`), so a
PG04→ChangeTitle→Gate-17 chain cannot recurse.

**Plugin impact:** a title change whose role-plugin install fails no longer
silently produces a titled-but-role-less agent — the agent is flagged
`roleMissing` and hibernated, surfaced via the `hibernate_role_missing` ledger op
and the Gate 17 ops log. The title change itself still reports `success: true`
(the title DID persist — only the role install failed). No endpoint shape
changed. `tsc --noEmit` clean; full unit suite **1858 passed / 0 failed**; the
G17 case in `tests/services/element-management-assistant-title.test.ts` was
RED-verified against the unfixed gate first, then green.

**Completeness fix (same day, MAJOR — found by adversarial verification):** the
first cut wired the recovery into only 2 of Gate 17's 4 zero-active exits; the
`>1 active` and `==1 MISMATCH` branches (which uninstall-then-reinstall with a
swallowed error) could still leave a titled agent role-less on a transient
reinstall failure. The recovery is now a **single unconditional post-block
re-scan** after the whole branch chain, so EVERY Gate 17 exit converges on the one
R9.13 recovery point. Plugin impact is unchanged (Gate 17 enforces R9.13); the
enforcement is now exit-complete. Full unit suite **1867 passed / 0 failed** after
the completeness fix (+1 test for the existsSync=true exit).

## 11. server.mjs full-mode auth gate now deep-validates the session cookie (2026-06-21)

`TRDD-ba9d6df2`. `server.mjs`'s two full-mode credential gates — the inline
`GET /api/internal/pty-sessions` handler and the pre-handshake `wsHasCredential`
for `/term` · `/status` · `/v1/ws` · `/companion-ws` WebSocket upgrades — used a
**presence-only** cookie check (`/aim_session=…/.test(cookie)`), so any non-empty
`aim_session` value (a **forged** cookie from a Tailscale peer or local process)
passed. They now call a new `.mjs` validator (`lib/session-validate-server.mjs`)
that validates the token against the same in-memory session store
(`globalThis.__aiMaestroSessionsMap`, shared because server.mjs runs in the same
Node process as the Next routes) — sha256 key + `expires_at` check, mirroring the
TS `validateSession`. This is the full-mode counterpart of the `a11d1bfb`
sessions-browser fix.

**Plugin/agent impact:** a forged or stale `aim_session` cookie can no longer open
a terminal/status/AMP/companion WebSocket or read pty-session metadata. A **valid**
session cookie is unaffected; a stale cookie after `pm2 restart` now 401s → the UI
re-logs-in (the designed "sessions cleared on restart" posture). The **Bearer**
path (`aim_tk_` AID tokens, `amp_live_sk_` AMP keys, `mst_`, `eyJ` JWTs) is
unchanged — it stays a non-consuming presence check at this gate **by design**:
deep-validating a bearer here would consume one-shot AID tokens before their real
downstream consumer runs, so deep bearer validation remains a downstream
responsibility (documented follow-up). No endpoint shape changed. `node --check`
clean; `tsc --noEmit` clean; full unit suite **1864 passed / 0 failed**;
`tests/unit/session-validate-server.test.ts` (6 cases) RED-verified first, then
green.

**NIT fix (same day — adversarial verification):** the `.mjs` cookie extractor's
regex anchor `(?:^|;\s*)` rejected a leading-whitespace-before-first-pair cookie
that the canonical `lib/session-auth.ts` extractor accepts (a false-negative-only
divergence, unreachable per RFC 6265). Aligned to `(?:^|;)\s*` for byte-for-byte
parity (the `.mjs` mirrors the canonical extractor) + 2 parity test cases; still
fails closed. No contract change.

## 12. registerAgent now flags roleMissing on the role-less agent it creates (R9.13) (2026-06-21)

`TRDD-47effd69`. `registerAgent` (behind `POST /api/v1/register`,
`POST /api/agents/register`, headless) has a system-owner-only "register from
session name" path that, when no existing agent matches, creates one via the raw
`createAgent` registry primitive — which sets no role-plugin (it bypasses the
CreateAgent AIO that installs one). The agent's workdir doesn't exist yet (it's
created on first wake), so a plugin can't be installed at register time. The agent
was therefore left **role-less with `roleMissing` unset**, so the wake route's R9.13
gate (`role_plugin_required`, 409) never fired and it could wake with no role —
violating R9.13. registerAgent now sets `roleMissing: true` on that created agent
(mirroring ChangeTitle G17 / ChangePlugin PG04 / the wake-path `corePluginMissing`
pattern), so the existing wake gate blocks it until a role is assigned via the
Config tab.

**Plugin/agent impact:** an agent registered-from-session by a raw `createAgent`
path now correctly shows `roleMissing` and is blocked from waking until a role-plugin
is assigned (the same remediation surface as any other role-less agent). This only
affects the new-agent branch — registering against an **existing** agent (link) and
the **cloud** full-config branch are unchanged. No endpoint shape changed.
`tsc --noEmit` clean; full unit suite **1866 passed / 0 failed**; two new cases in
`tests/services/agents-core-service.test.ts` (new-agent flags; link does not),
RED-verified first.

## 13. Governance security audit — authz/IDOR/sudo-binding fixes (2026-06-21)

A delegated multi-agent audit (coverage → find-and-fix → adversarial
verify) hardened the governance API surface. 24 fixes landed in commit
`e54e2de4`; every CRITICAL/HIGH fix passed an independent adversarial
verifier, `tsc --noEmit` is clean, and the full suite (1867 tests) is
green. **No wire change** — every endpoint accepts the same JSON; the
fixes ADD the authentication the `/api` middleware defers (it is a
structural credential-shape check that defers crypto verification to the
handler) or TIGHTEN a fail path. No gate was weakened.

| Commit | Surface | Severity | What changed |
|---|---|---|---|
| `e54e2de4` | `PUT /api/teams/[id]` | CRITICAL | The strict `manage-team` gate ran only when the body carried `agentIds`, so `name`/`description`/`githubProject` edits fell through to member-only `checkTeamAccess`. A non-MANAGER member/orchestrator agent could rename the team and relink `team.githubProject` (the gh-CLI issue target). Gate now fires for every agent caller and for the user path on privileged fields. |
| `e54e2de4` | `POST /api/v1/governance/requests/[id]/approve` | HIGH (IDOR) | Dropped the `auth.agentId \|\| body.approverAgentId` fallback. `approveCrossHostRequest` checks only the global password then derives the vote + MANAGER/COS authority from `approverAgentId`, so the fallback let any password-knower approve AS any MANAGER/COS agent. Now auth-derived only (401 on absence), matching the reject route. |
| `e54e2de4` | `POST /api/teams` | HIGH | System-owner password-skip used legacy `!auth.agentId`, treating a model-ON non-maestro user as system-owner. Now model-aware via `buildAuthContext(auth).isSystemOwner`. |
| `e54e2de4` | `GET/POST /api/auth/webauthn/register`, `GET/DELETE /api/auth/webauthn/credentials` | HIGH ×4 | Raw `validateSession` admits any logged-in user under the R36/R37 user-authority model → a normal user could register/list/delete the host owner's passkeys. Now `enforceSystemOwner`. Sudo consume was unbound (ignored subject/operation → replay); added `consumeOwnerSudoToken` (SUDO-01 op-binding + SUDO-02 subject-binding, fail-secure, after SUDO-04 authenticate-first). Model-off behavior byte-identical. |
| `e54e2de4` | `GET /api/agents/role-plugins`, `GET /api/agents/role-plugins/status` | HIGH/MEDIUM | No `authenticateFromRequest`/`enforceAuth`, leaking every agent's name/title/absolute `workingDirectory` to a forged-but-well-formed cookie. Added, matching the sibling routes. |
| `e54e2de4` | `GET /api/governance/reachable` | MEDIUM | Added `enforceAuth` (was structural-middleware only). |
| `e54e2de4` | `GET/PUT /api/teams/[id]/kanban-config` | MEDIUM | Forwarded `buildAuthContext(auth)` to match the headless mirror, fixing a FULL-vs-headless drift that 403'd a verified system-owner. |
| `e54e2de4` | `lib/manager-trust.ts`, `lib/governance-peers.ts` | MEDIUM | A malformed-but-valid-JSON trust file / a network-origin peer-cache entry with a non-array `teams` crashed every consumer (incl. the cross-host auto-approve gate). Both normalize fail-closed (bad input can only reduce trust/membership). |

**Frozen-CLI (R22/R23) — verb interfaces unchanged; failure paths only.**
The same audit hardened the wrapper scripts without touching any verb's
name/args/output: `aimaestro-governance.sh`/`aimaestro-teams.sh` `_api`
now fail-close on a missing/non-numeric HTTP status (was treated as 2xx);
`aimaestro-teams.sh add-agent` no longer clobbers all members on an
unparseable team body; `requests` help lists the route's real 6 statuses
+ 8 types; `resolve`/`restart` added to `agent` help/header (help must
list exactly the dispatched verbs); `cmd_create` dir validation no longer
silently no-ops `realpath -m` on BSD/macOS; 10 inline AID-auth idioms
consolidated onto `_build_auth_args`. **Coverage was found 100% clean** —
all 17 script verbs hit a real endpoint with the correct method.

**Effect on plugins:** none. No endpoint shape changed and no frozen-CLI
verb interface changed. Callers that relied on an *unauthenticated* read
of `role-plugins`/`reachable`, or on approving cross-host requests with a
body-asserted `approverAgentId`, must now authenticate as the acting
agent — those were the vulnerabilities being closed.

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
