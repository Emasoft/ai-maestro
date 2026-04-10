# TRDD-a58a02c4-721d-453b-99c9-95964a33f72f — MAINTAINER governance title + GitHub webhook pipeline

**TRDD ID:** `a58a02c4-721d-453b-99c9-95964a33f72f`
**Filename:** `design/tasks/TRDD-a58a02c4-721d-453b-99c9-95964a33f72f-maintainer-title.md`
**Tracked in:** this repo (design/tasks/ is git-tracked, NOT in .gitignore)

**Status:** Not started. Spec-only. Added to the backlog on 2026-04-10 during the
P002/P004/P005 session.

**Priority:** P1 (new feature, not blocking current work)

**Scope:** Add a new governance title (`MAINTAINER`) plus the full webhook-driven
issue triage and fix pipeline. The user gave the design verbally — this file is
the canonical spec so a future session can pick it up without context loss.

---

## User's original directive (verbatim)

> We need to update the governance rules. add a new agent title: **MAINTAINER**. The
> MAINTAINER is a no-team agent like the AUTONOMOUS titled agents. But it has a
> special attribute: the github repo he is responsible of. His job is to create a
> webhook [sample Flask webhook code below] on the repo it is responsible for. And
> every time a new issue is opened, it should verify/triage the issue, and if it is
> verified, it should clone locally, do the changes/fixes, then bump the version and
> publish it back on the origin.

The user supplied a reference Flask webhook snippet with HMAC-SHA256 verification
using `X-Hub-Signature-256` — that's the security baseline.

> Note on spelling: the user wrote **MANTAINER** but the correct English is
> **MAINTAINER**. This spec uses MAINTAINER throughout. If the user wants the typo
> preserved as the canonical identifier, swap all occurrences before implementation.

---

## Design

### 1. New governance title

Add `'maintainer'` to `AgentRole` in `types/agent.ts`:

```typescript
export type AgentRole =
  | 'manager'
  | 'chief-of-staff'
  | 'architect'
  | 'orchestrator'
  | 'integrator'
  | 'member'
  | 'autonomous'
  | 'maintainer'   // NEW
```

Update:
- `VALID_GOVERNANCE_TITLES` array
- The role explainer comment block (R3.1 already says "Seven titles" — becomes
  "Eight")
- `Agent` interface: add `githubRepo?: string` and `webhookPort?: number`
- `UpdateAgentRequest`: mirror the new fields
- `CreateAgentRequest`: mirror the new fields so the wizard can pass them

### 2. MAINTAINER properties

| Field         | Type   | Required              | Notes |
|---------------|--------|-----------------------|-------|
| `githubRepo`  | string | Yes (when title=maintainer) | Format: `owner/repo`. **Immutable** once set — to point at a different repo, create a new MAINTAINER. |
| `webhookPort` | number | Yes (when title=maintainer) | Local port (bind `127.0.0.1`). External reachability is user-provided (Tailscale funnel / Cloudflare tunnel / reverse proxy). |
| webhook secret | N/A   | Yes                    | Stored server-side in `~/.aimaestro/maintainer-secrets.json` (`0o600`). NEVER on the Agent object. |

### 3. Webhook secret storage

New file: `lib/maintainer-secrets.ts`

```typescript
// Schema: Record<agentId, { secret: string; createdAt: string }>
// File: ~/.aimaestro/maintainer-secrets.json (0o600, parent dir 0o700)
// Same pattern as lib/amp-auth.ts API keys.
export function mintMaintainerSecret(agentId: string): string
export function getMaintainerSecret(agentId: string): string | null
export function rotateMaintainerSecret(agentId: string): string
export function deleteMaintainerSecret(agentId: string): void
```

The secret is generated on title assignment (server-side via `crypto.randomBytes(32).toString('hex')`) and shown to the user ONCE in the dashboard with a "copy to clipboard" button + setup instructions. After that the UI never displays it again — rotate if lost.

### 4. HMAC verification endpoint (zero-trust design)

New endpoint: `POST /api/maintainer/verify-signature`

```
Request:
  { agentId: string, signature: string, rawBody: string }
Response:
  { valid: boolean }
```

The MAINTAINER agent does NOT hold the secret. When a webhook fires on its listener port, it:
1. Reads the payload and the `X-Hub-Signature-256` header
2. Calls the local API `POST /api/maintainer/verify-signature` with `{ agentId, signature, rawBody }`
3. The server loads the secret, computes `hmac.new(secret, rawBody, sha256).hexdigest()`, compares (timing-safe), returns `{ valid: true }` or `{ valid: false }`

This way the secret lives on the server (trust anchor) and the MAINTAINER agent only ever handles the `valid: true/false` verdict. Even if the agent's working directory is compromised, the secret stays safe.

### 5. Webhook listener (lives inside the role-plugin)

New role-plugin: **`ai-maestro-maintainer-agent`** (TBD — to be created via Haephestos, similar to the six existing role-plugins).

The plugin ships:
- `scripts/maintainer-webhook.py` — Flask-based HTTP listener (extend the user's snippet):
  - Reads `PORT`, `AGENT_ID`, `AIMAESTRO_URL` from env
  - Calls `/api/maintainer/verify-signature` on each request
  - On valid `issues.opened` events, emits an AMP notification to itself (or writes to a local queue in the agent's workingDirectory) so the Claude Code session reacts
  - On invalid signature: returns 403, logs, no side effects
  - On non-issue events: returns 200 with body ignored (flexibility for future hooks)
- `skills/maintainer-triage/SKILL.md` — triage logic: classify issue as valid / duplicate / spam / unreproducible. Uses docs-search + graph-query + memory-search to detect dupes.
- `skills/maintainer-fix/SKILL.md` — fix logic: clone to `~/agents/<name>/workspace/`, create branch, edit, run tests, commit. Must respect the repo's pre-push hooks and test suite.
- `skills/maintainer-publish/SKILL.md` — publish logic: bump version via `scripts/publish.py` or equivalent, push to origin, optionally trigger a GitHub release.
- `commands/maintainer-status.md`, `commands/maintainer-relisten.md`, `commands/maintainer-triage-now.md` — user-facing commands
- `hooks/hooks.json` — SessionStart hook that boots the webhook listener in a background subprocess

### 6. Communication graph update

In `lib/communication-graph.ts`:

```typescript
const COMMUNICATION_GRAPH: Record<AgentRole, ReadonlySet<AgentRole>> = {
  'manager':        new Set([...existing, 'maintainer']),
  'chief-of-staff': new Set([...existing, 'maintainer']),
  'orchestrator':   existing,  // no change
  'architect':      existing,
  'integrator':     existing,
  'member':         existing,
  'autonomous':     new Set([...existing, 'maintainer']),  // autonomous CAN contact maintainers
  'maintainer':     new Set(['manager', 'chief-of-staff', 'autonomous', 'maintainer']),  // NEW
}
```

Rationale: MAINTAINERs can talk to each other for cross-repo coordination (e.g., "I'm bumping the shared library version — please update your repo's dependency"). They can escalate to MANAGER, report to COS, and coordinate with AUTONOMOUS agents. Team workers (architect/integrator/member/orchestrator) do NOT talk to MAINTAINERs directly — route through COS or MANAGER.

Add routing suggestions for the forbidden edges.

### 7. Ecosystem constants

In `lib/ecosystem-constants.ts`:

```typescript
export const ROLE_PLUGIN_MAINTAINER = 'ai-maestro-maintainer-agent'

export const PREDEFINED_ROLE_PLUGIN_NAMES = [
  ...existing,
  ROLE_PLUGIN_MAINTAINER,
]

export const TITLE_PLUGIN_MAP: Record<string, string> = {
  ...existing,
  'MAINTAINER': ROLE_PLUGIN_MAINTAINER,
}

export const PLUGIN_COMPATIBLE_TITLES: Record<string, string[]> = {
  ...existing,
  [ROLE_PLUGIN_MAINTAINER]: ['MAINTAINER'],
}
```

### 8. ChangeTitle pipeline (`services/element-management-service.ts`)

The ChangeTitle AIO pipeline needs a new gate before the existing title→plugin
resolution:

- **G-maintainer-validate**: if `newTitle === 'maintainer'`, assert that `desired.githubRepo` is present and matches `^[\w.-]+/[\w.-]+$`. Assert that no other active MAINTAINER owns the same `githubRepo` globally (uniqueness check). Assert that `desired.webhookPort` is present, is a valid port number (1024-65535), and is not already in use by another agent.
- **G-maintainer-secret-mint**: on success, call `mintMaintainerSecret(agentId)` and store the secret in the per-agent file. Return the raw secret ONCE in the ChangeTitle response payload so the UI can display it with setup instructions.
- **G-maintainer-reverse**: if `oldTitle === 'maintainer'` and `newTitle !== 'maintainer'`, call `deleteMaintainerSecret(agentId)` and warn the user that they must manually disable the GitHub webhook in the repo settings.

### 9. Agent wizard (UI — P3)

Step 2 (client) and Step 3 (title) need updates:
- When the user picks MAINTAINER in Step 3, Step 4 (working directory) becomes read-only (`~/agents/<name>/` is forced — the MAINTAINER's workspace will be underneath at `~/agents/<name>/workspace/`).
- A new wizard step appears: **Step 4a (MAINTAINER config)** asking for:
  - `githubRepo` (text field, format hint "owner/repo")
  - `webhookPort` (number field, default: auto-assigned from a pool starting at 7000)
  - A read-only warning: "The webhook secret will be generated on the next step. Copy it — you will only see it once."
- Step 7 (confirm) displays the secret prominently with a copy button, plus a setup guide link (GitHub → Settings → Webhooks → Add webhook, with the Payload URL, Content type `application/json`, Secret field pre-filled from clipboard).

### 10. Governance rules addition

Insert a new section **R19. MAINTAINER Title** in `docs/GOVERNANCE-RULES.md`. Full rule text to include:

| ID | Rule |
|----|------|
| R19.1 | MAINTAINER is a no-team governance title assigned to agents responsible for maintaining an external software project (typically a GitHub repository). Like AUTONOMOUS, a MAINTAINER is NOT a member of any team — it operates independently at the host level. |
| R19.2 | Every MAINTAINER agent MUST have a non-empty `githubRepo` attribute in the form `owner/repo`. The attribute is **immutable** once set — to change the repo, assign the MAINTAINER title to a different agent. |
| R19.3 | One MAINTAINER per repository on a given host. Assigning MAINTAINER to an agent when another active (non-deleted) MAINTAINER already owns the same `githubRepo` MUST be rejected with a uniqueness error. |
| R19.4 | A MAINTAINER's core workflow is: (a) subscribe to GitHub `issues.opened` events via a webhook, (b) verify/triage each issue, (c) if valid, clone the repo to `~/agents/<name>/workspace/`, create a branch, edit files, run tests, commit, (d) bump the version and push to origin. |
| R19.5 | Webhook payloads MUST be HMAC-SHA256 verified using the `X-Hub-Signature-256` header and the per-agent secret. Unsigned or incorrectly signed requests MUST be rejected with HTTP 403 before any side effect. |
| R19.6 | The webhook secret is SENSITIVE. It MUST be stored server-side only in `~/.aimaestro/maintainer-secrets.json` with mode `0o600` and parent dir `0o700`. The secret MUST NEVER be sent to the MAINTAINER agent in plaintext — the agent verifies signatures by calling `POST /api/maintainer/verify-signature` which performs the HMAC check server-side and returns only a boolean verdict. |
| R19.7 | Each MAINTAINER agent listens on a dedicated `webhookPort` assigned at title creation time. The listener binds to `127.0.0.1` by default. External reachability is the user's responsibility (Tailscale funnel, Cloudflare tunnel, reverse proxy). Setup instructions MUST be shown in the wizard. |
| R19.8 | A MAINTAINER must NOT run destructive git operations on the repository beyond what the publish pipeline authorizes: force-push, history rewrite, tag deletion, branch deletion. All destructive operations require explicit MANAGER approval via an `approval-request` AMP message (see the future approval-token design in ai-maestro-plugin#1). |
| R19.9 | Before publishing any fix, a MAINTAINER MUST: (1) confirm the test suite passes, (2) confirm a version bump is actually required (not a doc-only change), (3) confirm R18 plugin continuity is satisfied for any bundled plugins in the target repo, (4) honor the repo's `pre-push` git hook if one exists. |
| R19.10 | MAINTAINERs can message: MANAGER, COS, AUTONOMOUS, other MAINTAINERs. They can be messaged by: MANAGER, COS, AUTONOMOUS, other MAINTAINERs, and the user. Team workers (architect/integrator/member/orchestrator) cannot contact MAINTAINERs directly — route through COS or MANAGER. |
| R19.11 | The MAINTAINER title is bound to the `ai-maestro-maintainer-agent` role-plugin (R11 binding). Per R17, the `ai-maestro-plugin` core plugin is also required. |
| R19.12 | A MAINTAINER agent can be hibernated safely — its webhook listener goes down, and GitHub's delivery retry will re-deliver missed issues when the MAINTAINER is woken. The webhook secret is unchanged by hibernation. If the MAINTAINER is permanently deleted, the user MUST manually delete or disable the corresponding webhook in the GitHub repo settings, otherwise dead deliveries will accumulate. The UI MUST surface this warning at title removal and at agent deletion. |
| R19.13 | A MAINTAINER agent's webhook listener is a subprocess of the Claude Code session. It MUST be terminated on `SessionEnd` / `SessionStop` / hibernation to prevent zombie listeners. The role-plugin's hook handles this. |

Also:
- Update **R3.1** from "Seven governance titles" → "Eight governance titles" and add MAINTAINER to the list
- Update **R4.3** to add MAINTAINER alongside MANAGER as not-in-any-team
- Update **R6 communication graph** to include MAINTAINER
- Update the **Role-Based Permission Matrix** at the bottom with a MAINTAINER column
- Add a new invariant **#18. MAINTAINER-repo-uniqueness invariant**: at any time, at most one active (non-deleted) agent has a given `githubRepo`

### 11. AMP message types interaction (from ai-maestro-plugin#1)

When approval-request / approval-answer types are added (filed in Emasoft/ai-maestro-plugin#1), the MAINTAINER is the primary use case for approval-requests:
- MAINTAINER wants to force-push → sends `approval-request` to MANAGER
- MANAGER reviews via dashboard → mints an approval-token
- MAINTAINER receives `approval-answer` + token → verifies server-side → proceeds

So the R19 + approval-token work should be coordinated. R19.8 should cross-reference the approval-request type once it exists.

---

## Files to touch (ordered by dependency)

1. `types/agent.ts` — add `'maintainer'` to `AgentRole`, `VALID_GOVERNANCE_TITLES`, `githubRepo`/`webhookPort` to `Agent` and `UpdateAgentRequest` and `CreateAgentRequest`
2. `lib/maintainer-secrets.ts` — new file: mint/get/rotate/delete with `0o600` perms
3. `lib/ecosystem-constants.ts` — add `ROLE_PLUGIN_MAINTAINER`, update maps
4. `lib/communication-graph.ts` — add `maintainer` row/column + routing suggestions
5. `services/element-management-service.ts` — add MAINTAINER gates to ChangeTitle
6. `app/api/maintainer/verify-signature/route.ts` — new HMAC verify endpoint (server-side secret, returns only boolean)
7. `docs/GOVERNANCE-RULES.md` — new R19 section + R3.1/R4.3/R6 updates + invariant #18 + permission matrix
8. `components/AgentCreationWizard.tsx` — new Step 4a for MAINTAINER config + secret display on Step 7
9. `Emasoft/ai-maestro-maintainer-agent` (new GitHub repo) — built via Haephestos: plugin.json, `.agent.toml`, main-agent.md, skills, commands, webhook script, hooks.json
10. `tests/scenarios/SCEN-018_maintainer-webhook-lifecycle.scen.md` — new e2e scenario: create maintainer → generate secret → fake github webhook → verify triage → verify fix → verify publish → verify cleanup

## Scenarios to add

**SCEN-018 (MAINTAINER webhook lifecycle):**
- Create a MAINTAINER for a dedicated test repo (`Emasoft/scen018-test-repo` — create once, reuse)
- Copy the shown secret, configure the GitHub webhook manually via gh CLI
- Open a test issue via gh CLI
- Verify the MAINTAINER's webhook listener receives it
- Verify triage skill classifies it (plant a simple "fix this typo" issue)
- Verify the agent clones, edits, tests, commits, pushes a version bump
- Verify the commit lands on origin
- Cleanup: close the issue, delete the MAINTAINER, delete the GitHub webhook, reset the test repo

**SCEN-019 (MAINTAINER security — reject unsigned webhook):**
- Create a MAINTAINER
- Send a POST to its webhook listener WITHOUT the `X-Hub-Signature-256` header
- Verify 403 and zero side effects
- Send with a bogus signature
- Verify 403 again
- Cleanup

## Dependencies

- **ai-maestro-plugin#1** (approval-request/approval-answer types) — needed for R19.8 enforcement. Until then, R19.8 is enforced by a soft check ("MAINTAINER must not force-push unless env var `ALLOW_FORCE_PUSH=1` is set by a logged-in user").
- **Haephestos creation helper** — must be able to generate a MAINTAINER role-plugin. Check that the current Haephestos skills support per-title plugin creation with `compatible-titles = ["MAINTAINER"]`.
- **Tailscale funnel** or equivalent — the user needs external reachability for the webhook. Document the setup in the role-plugin's README.

## Non-goals (out of scope)

- Auto-configuring the GitHub webhook via the GitHub API — the user does this manually through the repo's Settings page using the displayed secret. (Could be added later as a convenience if the user provides a personal access token.)
- Cross-repo MAINTAINERs — one MAINTAINER per repo by design. If the user wants one agent to monitor multiple repos, they create multiple MAINTAINERs.
- Inbound email triage — only GitHub webhooks, not Gitea/GitLab/email/Jira. Can be added later with separate MAINTAINER subtypes (JIRA-MAINTAINER, EMAIL-MAINTAINER, etc.) but that's a much larger design.
- Per-issue LLM cost budgeting — the MAINTAINER runs until completion; throttling is user's responsibility (wake/hibernate schedule).

## Security considerations

- **Webhook secret must never leave the server.** The plugin-side listener only knows "valid / invalid"; it never sees the secret. Even if a malicious plugin is installed in the agent's `.claude/settings.local.json`, it cannot exfiltrate the secret because it lives at `~/.aimaestro/maintainer-secrets.json` owned by the ai-maestro server process.
- **Listener port must be 127.0.0.1-bound.** Binding to `0.0.0.0` would expose the listener to the LAN. The external relay (Tailscale funnel, etc.) is the single controlled entry point.
- **Payload size limits.** GitHub webhook payloads can be up to 25 MB. The listener must enforce a hard cap (configurable, default 5 MB) and reject oversized payloads with 413.
- **Rate limiting.** A malicious actor with the webhook URL (but not the secret) can still flood the listener. Add a simple rate limit: max 60 requests per minute per source IP, return 429 over the threshold.
- **Replay protection.** GitHub signs each payload with a fresh HMAC, but the same payload can be re-sent. Track recent `delivery_id` headers and reject duplicates within a 5-minute window.
- **Clone safety.** The workspace clone runs as the ai-maestro user. The user's shell config may have dangerous aliases. Use `git --no-pager` and explicit `core.hooksPath` to prevent local git hooks from running during automated operations.

---

## When picking this up

1. Read this file top-to-bottom.
2. Read `docs/GOVERNANCE-RULES.md` R3, R4, R6, R11, R17, R18 to understand the existing rule patterns and invariants this must slot into.
3. Read `services/element-management-service.ts` `ChangeTitle()` to see how existing title gates work.
4. Read `lib/communication-graph.ts` and the README for the existing 7-role matrix.
5. Read the existing role-plugin repos (e.g., `Emasoft/ai-maestro-programmer-agent`) to copy the plugin scaffolding layout.
6. Start with the type + communication graph + governance rule updates (steps 1-4 + 7 in the file list above). These are small, self-contained, and can be committed as a single `feat: R19 MAINTAINER title definition (spec-only)` commit.
7. Follow with `lib/maintainer-secrets.ts` + the verify-signature endpoint (steps 2 + 6). Ship as `feat: R19 maintainer webhook secret storage + HMAC verification endpoint`.
8. THEN build the role-plugin repo (step 9) via Haephestos.
9. Wire up the wizard last (step 8).
10. Write SCEN-018 and SCEN-019 (step 10) and run them to prove the system works.

Every step should end with `npx tsc --noEmit` clean and a separate commit.
