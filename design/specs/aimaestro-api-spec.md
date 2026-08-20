---
status: normative
generated-by: scripts/gen-specs.mjs
---

# AI Maestro API spec — internal surface (GENERATED, do not hand-edit)

INTERNAL: consumed by the dashboard and by the scripts layer only. Plugins MUST NOT
call these routes directly — they use the scripts spec
(aimaestro-scripts-spec.md). "strict" = requires a one-shot sudo token
(security-registry.json is the classification SSOT). Request/response shapes live as
zod schemas at the top of each source file — the file column is the pointer.

| Method | Path | Strict | Source | Doc |
|---|---|---|---|---|
| GET | `/api/agents/[id]/amp/addresses/[address]` |  | app/api/agents/[id]/amp/addresses/[address]/route.ts |  |
| PATCH | `/api/agents/[id]/amp/addresses/[address]` |  | app/api/agents/[id]/amp/addresses/[address]/route.ts |  |
| DELETE | `/api/agents/[id]/amp/addresses/[address]` |  | app/api/agents/[id]/amp/addresses/[address]/route.ts |  |
| GET | `/api/agents/[id]/amp/addresses` |  | app/api/agents/[id]/amp/addresses/route.ts |  |
| POST | `/api/agents/[id]/amp/addresses` |  | app/api/agents/[id]/amp/addresses/route.ts |  |
| POST | `/api/agents/[id]/amp-init` |  | app/api/agents/[id]/amp-init/route.ts | Re-run `amp-init.sh --force` for an existing agent to (re)provision its |
| GET | `/api/agents/[id]/block-state` | strict | app/api/agents/[id]/block-state/route.ts |  |
| GET | `/api/agents/[id]/chat` |  | app/api/agents/[id]/chat/route.ts | Agent Chat API |
| POST | `/api/agents/[id]/chat` |  | app/api/agents/[id]/chat/route.ts | Agent Chat API |
| POST | `/api/agents/[id]/config/deploy` |  | app/api/agents/[id]/config/deploy/route.ts | Agent Config Deploy API |
| POST | `/api/agents/[id]/continuity/compact` | strict | app/api/agents/[id]/continuity/compact/route.ts |  |
| POST | `/api/agents/[id]/continuity/ensure-resume` |  | app/api/agents/[id]/continuity/ensure-resume/route.ts |  |
| GET | `/api/agents/[id]/continuity/status` |  | app/api/agents/[id]/continuity/status/route.ts |  |
| POST | `/api/agents/[id]/element-inventory` |  | app/api/agents/[id]/element-inventory/route.ts | Append a snapshot of the agent's currently-loaded elements (memory |
| GET | `/api/agents/[id]/email/addresses/[address]` |  | app/api/agents/[id]/email/addresses/[address]/route.ts |  |
| PATCH | `/api/agents/[id]/email/addresses/[address]` |  | app/api/agents/[id]/email/addresses/[address]/route.ts |  |
| DELETE | `/api/agents/[id]/email/addresses/[address]` |  | app/api/agents/[id]/email/addresses/[address]/route.ts |  |
| GET | `/api/agents/[id]/email/addresses` |  | app/api/agents/[id]/email/addresses/route.ts |  |
| POST | `/api/agents/[id]/email/addresses` |  | app/api/agents/[id]/email/addresses/route.ts |  |
| GET | `/api/agents/[id]/ensure-core` |  | app/api/agents/[id]/ensure-core/route.ts |  |
| POST | `/api/agents/[id]/ensure-core` | strict | app/api/agents/[id]/ensure-core/route.ts |  |
| GET | `/api/agents/[id]/export` |  | app/api/agents/[id]/export/route.ts | Agent Export API |
| POST | `/api/agents/[id]/export` |  | app/api/agents/[id]/export/route.ts | Agent Export API |
| GET | `/api/agents/[id]/full` |  | app/api/agents/[id]/full/route.ts |  |
| POST | `/api/agents/[id]/hibernate` |  | app/api/agents/[id]/hibernate/route.ts |  |
| POST | `/api/agents/[id]/install-skills` |  | app/api/agents/[id]/install-skills/route.ts | Install all ai-maestro skills from Claude into a non-Claude agent's skill directory. |
| GET | `/api/agents/[id]/local-config` |  | app/api/agents/[id]/local-config/route.ts |  |
| POST | `/api/agents/[id]/local-plugins` |  | app/api/agents/[id]/local-plugins/route.ts | Local Plugin Operations API |
| GET | `/api/agents/[id]/messages/[messageId]` |  | app/api/agents/[id]/messages/[messageId]/route.ts |  |
| PATCH | `/api/agents/[id]/messages/[messageId]` |  | app/api/agents/[id]/messages/[messageId]/route.ts |  |
| DELETE | `/api/agents/[id]/messages/[messageId]` |  | app/api/agents/[id]/messages/[messageId]/route.ts |  |
| POST | `/api/agents/[id]/messages/[messageId]` |  | app/api/agents/[id]/messages/[messageId]/route.ts |  |
| GET | `/api/agents/[id]/messages` |  | app/api/agents/[id]/messages/route.ts |  |
| POST | `/api/agents/[id]/messages` |  | app/api/agents/[id]/messages/route.ts |  |
| GET | `/api/agents/[id]/metadata` |  | app/api/agents/[id]/metadata/route.ts |  |
| PATCH | `/api/agents/[id]/metadata` |  | app/api/agents/[id]/metadata/route.ts |  |
| DELETE | `/api/agents/[id]/metadata` |  | app/api/agents/[id]/metadata/route.ts |  |
| GET | `/api/agents/[id]/metrics` |  | app/api/agents/[id]/metrics/route.ts |  |
| PATCH | `/api/agents/[id]/metrics` |  | app/api/agents/[id]/metrics/route.ts |  |
| GET | `/api/agents/[id]/panel/feedback` |  | app/api/agents/[id]/panel/feedback/route.ts |  |
| POST | `/api/agents/[id]/panel` | strict | app/api/agents/[id]/panel/route.ts |  |
| GET | `/api/agents/[id]/panel` |  | app/api/agents/[id]/panel/route.ts |  |
| POST | `/api/agents/[id]/portfolio` |  | app/api/agents/[id]/portfolio/route.ts |  |
| GET | `/api/agents/[id]/portfolio` |  | app/api/agents/[id]/portfolio/route.ts |  |
| DELETE | `/api/agents/[id]/portfolio` |  | app/api/agents/[id]/portfolio/route.ts |  |
| GET | `/api/agents/[id]/portfolio/verify` |  | app/api/agents/[id]/portfolio/verify/route.ts |  |
| POST | `/api/agents/[id]/prompt/answer` | strict | app/api/agents/[id]/prompt/answer/route.ts |  |
| GET | `/api/agents/[id]/prompt` |  | app/api/agents/[id]/prompt/route.ts |  |
| DELETE | `/api/agents/[id]/queue/[entryId]` |  | app/api/agents/[id]/queue/[entryId]/route.ts |  |
| POST | `/api/agents/[id]/queue` | strict | app/api/agents/[id]/queue/route.ts |  |
| GET | `/api/agents/[id]/queue` |  | app/api/agents/[id]/queue/route.ts |  |
| POST | `/api/agents/[id]/remove-element` |  | app/api/agents/[id]/remove-element/route.ts |  |
| GET | `/api/agents/[id]/repos` |  | app/api/agents/[id]/repos/route.ts |  |
| GET | `/api/agents/[id]` |  | app/api/agents/[id]/route.ts |  |
| PATCH | `/api/agents/[id]` | strict | app/api/agents/[id]/route.ts |  |
| DELETE | `/api/agents/[id]` | strict | app/api/agents/[id]/route.ts |  |
| POST | `/api/agents/[id]/session` |  | app/api/agents/[id]/session/route.ts |  |
| PATCH | `/api/agents/[id]/session` | strict | app/api/agents/[id]/session/route.ts |  |
| GET | `/api/agents/[id]/session` |  | app/api/agents/[id]/session/route.ts |  |
| DELETE | `/api/agents/[id]/session` | strict | app/api/agents/[id]/session/route.ts |  |
| GET | `/api/agents/[id]/skills` |  | app/api/agents/[id]/skills/route.ts | Agent Skills API |
| PATCH | `/api/agents/[id]/skills` |  | app/api/agents/[id]/skills/route.ts | Agent Skills API |
| POST | `/api/agents/[id]/skills` |  | app/api/agents/[id]/skills/route.ts | Agent Skills API |
| DELETE | `/api/agents/[id]/skills` |  | app/api/agents/[id]/skills/route.ts | Agent Skills API |
| GET | `/api/agents/[id]/skills/settings` |  | app/api/agents/[id]/skills/settings/route.ts | Agent Skill Settings API |
| PUT | `/api/agents/[id]/skills/settings` |  | app/api/agents/[id]/skills/settings/route.ts | Agent Skill Settings API |
| GET | `/api/agents/[id]/subconscious` |  | app/api/agents/[id]/subconscious/route.ts | Agent Subconscious API |
| POST | `/api/agents/[id]/transfer` | strict | app/api/agents/[id]/transfer/route.ts | Agent Transfer API |
| POST | `/api/agents/[id]/wake` |  | app/api/agents/[id]/wake/route.ts |  |
| GET | `/api/agents/browse-dir` |  | app/api/agents/browse-dir/route.ts | Browse Directory API |
| GET | `/api/agents/by-name/[name]` |  | app/api/agents/by-name/[name]/route.ts |  |
| GET | `/api/agents/cemetery/download` |  | app/api/agents/cemetery/download/route.ts | Download a cemetery archive zip for transfer to another host. |
| GET | `/api/agents/cemetery` |  | app/api/agents/cemetery/route.ts | Agent Cemetery — List and manage soft-deleted agent archives |
| POST | `/api/agents/cemetery` | strict | app/api/agents/cemetery/route.ts | Agent Cemetery — List and manage soft-deleted agent archives |
| DELETE | `/api/agents/cemetery` | strict | app/api/agents/cemetery/route.ts | Agent Cemetery — List and manage soft-deleted agent archives |
| GET | `/api/agents/commands` |  | app/api/agents/commands/route.ts |  |
| POST | `/api/agents/create-from-toml` |  | app/api/agents/create-from-toml/route.ts | Create Agent from TOML (legacy endpoint) |
| POST | `/api/agents/create-persona` |  | app/api/agents/create-persona/route.ts | Create Persona — Unified Agent Creation API |
| POST | `/api/agents/creation-helper/chat` |  | app/api/agents/creation-helper/chat/route.ts | Creation Helper Chat API |
| POST | `/api/agents/creation-helper/cleanup` |  | app/api/agents/creation-helper/cleanup/route.ts |  |
| POST | `/api/agents/creation-helper/clear-banner` |  | app/api/agents/creation-helper/clear-banner/route.ts |  |
| POST | `/api/agents/creation-helper/element-descriptions` |  | app/api/agents/creation-helper/element-descriptions/route.ts |  |
| POST | `/api/agents/creation-helper/ensure-persona` |  | app/api/agents/creation-helper/ensure-persona/route.ts |  |
| POST | `/api/agents/creation-helper/file-picker` |  | app/api/agents/creation-helper/file-picker/route.ts |  |
| POST | `/api/agents/creation-helper/heartbeat` |  | app/api/agents/creation-helper/heartbeat/route.ts | Heartbeat endpoint for Haephestos session watchdog. |
| POST | `/api/agents/creation-helper/kill` |  | app/api/agents/creation-helper/kill/route.ts | Kill endpoint for Haephestos session — accepts POST from sendBeacon. |
| POST | `/api/agents/creation-helper/publish-plugin` |  | app/api/agents/creation-helper/publish-plugin/route.ts | Publish Plugin — Copies a validated plugin from Haephestos workspace to local marketplace |
| POST | `/api/agents/creation-helper/raw-materials` |  | app/api/agents/creation-helper/raw-materials/route.ts | Raw Materials State API |
| GET | `/api/agents/creation-helper/raw-materials` |  | app/api/agents/creation-helper/raw-materials/route.ts | Raw Materials State API |
| GET | `/api/agents/creation-helper/response` |  | app/api/agents/creation-helper/response/route.ts | Creation Helper Response API |
| POST | `/api/agents/creation-helper/session` |  | app/api/agents/creation-helper/session/route.ts | Creation Helper Session API |
| DELETE | `/api/agents/creation-helper/session` |  | app/api/agents/creation-helper/session/route.ts | Creation Helper Session API |
| GET | `/api/agents/creation-helper/session` |  | app/api/agents/creation-helper/session/route.ts | Creation Helper Session API |
| GET | `/api/agents/creation-helper/toml-preview` |  | app/api/agents/creation-helper/toml-preview/route.ts |  |
| GET | `/api/agents/directory/lookup/[name]` |  | app/api/agents/directory/lookup/[name]/route.ts | Agent Directory Lookup API |
| GET | `/api/agents/directory` |  | app/api/agents/directory/route.ts | Agent Directory API |
| POST | `/api/agents/directory/sync` |  | app/api/agents/directory/sync/route.ts | Agent Directory Sync API |
| POST | `/api/agents/docker/create` |  | app/api/agents/docker/create/route.ts | Docker Agent Create API |
| GET | `/api/agents/email-index` |  | app/api/agents/email-index/route.ts |  |
| GET | `/api/agents/folders` |  | app/api/agents/folders/route.ts |  |
| POST | `/api/agents/foreign-approvals/[id]/approve` | strict | app/api/agents/foreign-approvals/[id]/approve/route.ts | /api/agents/foreign-approvals/[id]/approve — approve a foreign agent's AID |
| POST | `/api/agents/foreign-approvals/[id]/reject` | strict | app/api/agents/foreign-approvals/[id]/reject/route.ts | /api/agents/foreign-approvals/[id]/reject — reject a pending foreign-AID |
| GET | `/api/agents/foreign-approvals` |  | app/api/agents/foreign-approvals/route.ts | /api/agents/foreign-approvals — list pending foreign-AID approvals (R35.2). |
| POST | `/api/agents/health` |  | app/api/agents/health/route.ts |  |
| GET | `/api/agents/hibernation` |  | app/api/agents/hibernation/route.ts |  |
| POST | `/api/agents/import` | strict | app/api/agents/import/route.ts | Agent Import API |
| GET | `/api/agents/me` |  | app/api/agents/me/route.ts | WHOAMI for agent callers: returns the CALLER's own agent identity, derived |
| GET | `/api/agents/normalize-hosts` |  | app/api/agents/normalize-hosts/route.ts | Agent Host ID Normalization API |
| POST | `/api/agents/normalize-hosts` |  | app/api/agents/normalize-hosts/route.ts | Agent Host ID Normalization API |
| POST | `/api/agents/register` |  | app/api/agents/register/route.ts |  |
| POST | `/api/agents/role-plugins/inject-skill` |  | app/api/agents/role-plugins/inject-skill/route.ts |  |
| POST | `/api/agents/role-plugins/install` | strict | app/api/agents/role-plugins/install/route.ts | Role Plugin Install API |
| DELETE | `/api/agents/role-plugins/install` | strict | app/api/agents/role-plugins/install/route.ts | Role Plugin Install API |
| GET | `/api/agents/role-plugins/required` |  | app/api/agents/role-plugins/required/route.ts |  |
| GET | `/api/agents/role-plugins` |  | app/api/agents/role-plugins/route.ts | Role Plugins API |
| POST | `/api/agents/role-plugins` |  | app/api/agents/role-plugins/route.ts | Role Plugins API |
| DELETE | `/api/agents/role-plugins` | strict | app/api/agents/role-plugins/route.ts | Role Plugins API |
| GET | `/api/agents/role-plugins/status` |  | app/api/agents/role-plugins/status/route.ts | Role Plugin Status API |
| POST | `/api/agents/role-plugins/sync-defaults` |  | app/api/agents/role-plugins/sync-defaults/route.ts | Sync Default Role Plugins API |
| GET | `/api/agents` |  | app/api/agents/route.ts |  |
| POST | `/api/agents` |  | app/api/agents/route.ts |  |
| POST | `/api/agents/startup` |  | app/api/agents/startup/route.ts |  |
| GET | `/api/agents/startup` |  | app/api/agents/startup/route.ts |  |
| GET | `/api/agents/unified` |  | app/api/agents/unified/route.ts |  |
| POST | `/api/auth/login` |  | app/api/auth/login/route.ts | User logs in with governance password → gets httpOnly session cookie. |
| POST | `/api/auth/logout` |  | app/api/auth/logout/route.ts | Invalidates the user session and clears the cookie. |
| GET | `/api/auth/session` |  | app/api/auth/session/route.ts | Check if the current session cookie is valid. |
| POST | `/api/auth/setup-init` |  | app/api/auth/setup-init/route.ts | First-run setup step 1 (SEC-PHASE-6). Triggers a 6-digit verification |
| POST | `/api/auth/setup-verify` |  | app/api/auth/setup-verify/route.ts | First-run setup step 2 (SEC-PHASE-6). Validates the 6-digit code from |
| POST | `/api/auth/sudo-password` |  | app/api/auth/sudo-password/route.ts | Issues a short-lived sudo-mode token after verifying the governance |
| GET | `/api/auth/webauthn/authenticate` |  | app/api/auth/webauthn/authenticate/route.ts | WebAuthn Authentication Endpoints |
| POST | `/api/auth/webauthn/authenticate` |  | app/api/auth/webauthn/authenticate/route.ts | WebAuthn Authentication Endpoints |
| GET | `/api/auth/webauthn/credentials` |  | app/api/auth/webauthn/credentials/route.ts | WebAuthn Credentials Management |
| DELETE | `/api/auth/webauthn/credentials` |  | app/api/auth/webauthn/credentials/route.ts | WebAuthn Credentials Management |
| GET | `/api/auth/webauthn/register` |  | app/api/auth/webauthn/register/route.ts | WebAuthn Registration Endpoints |
| POST | `/api/auth/webauthn/register` |  | app/api/auth/webauthn/register/route.ts | WebAuthn Registration Endpoints |
| GET | `/api/config` |  | app/api/config/route.ts |  |
| POST | `/api/conversations/parse` |  | app/api/conversations/parse/route.ts |  |
| GET | `/api/debug/pty` |  | app/api/debug/pty/route.ts |  |
| GET | `/api/docker/info` |  | app/api/docker/info/route.ts |  |
| GET | `/api/domains/[id]` |  | app/api/domains/[id]/route.ts |  |
| PATCH | `/api/domains/[id]` |  | app/api/domains/[id]/route.ts |  |
| DELETE | `/api/domains/[id]` |  | app/api/domains/[id]/route.ts |  |
| GET | `/api/domains` |  | app/api/domains/route.ts |  |
| POST | `/api/domains` |  | app/api/domains/route.ts |  |
| GET | `/api/export/jobs/[jobId]` |  | app/api/export/jobs/[jobId]/route.ts |  |
| DELETE | `/api/export/jobs/[jobId]` |  | app/api/export/jobs/[jobId]/route.ts |  |
| GET | `/api/github/auth` |  | app/api/github/auth/route.ts |  |
| POST | `/api/github/auth` |  | app/api/github/auth/route.ts |  |
| GET | `/api/github/orgs` |  | app/api/github/orgs/route.ts |  |
| GET | `/api/github/projects` |  | app/api/github/projects/route.ts |  |
| POST | `/api/github/projects` |  | app/api/github/projects/route.ts |  |
| GET | `/api/github/repos` |  | app/api/github/repos/route.ts |  |
| POST | `/api/github/repos` |  | app/api/github/repos/route.ts |  |
| POST | `/api/governance/email/autodetect` |  | app/api/governance/email/autodetect/route.ts |  |
| POST | `/api/governance/email/configure` | strict | app/api/governance/email/configure/route.ts |  |
| GET | `/api/governance/email` |  | app/api/governance/email/route.ts |  |
| DELETE | `/api/governance/email` | strict | app/api/governance/email/route.ts |  |
| POST | `/api/governance/email/verify` |  | app/api/governance/email/verify/route.ts |  |
| POST | `/api/governance/maestro-delegate` | strict | app/api/governance/maestro-delegate/route.ts | /api/governance/maestro-delegate — MAESTRO-DELEGATE handoff (R37.2 / R37.3). |
| DELETE | `/api/governance/maestro-delegate` | strict | app/api/governance/maestro-delegate/route.ts | /api/governance/maestro-delegate — MAESTRO-DELEGATE handoff (R37.2 / R37.3). |
| POST | `/api/governance/manager` |  | app/api/governance/manager/route.ts |  |
| POST | `/api/governance/password/invalidate` |  | app/api/governance/password/invalidate/route.ts | TRDD-P7XKV3N9. Supplying the CURRENT password is the proof of possession. On |
| POST | `/api/governance/password/reset` |  | app/api/governance/password/reset/route.ts | Requires NO old password: you cannot prove knowledge of a secret you have lost, so the |
| POST | `/api/governance/password` | strict | app/api/governance/password/route.ts | SF-031 (P8): Delegates all business logic to governance-service.setGovernancePassword |
| GET | `/api/governance/reachable` |  | app/api/governance/reachable/route.ts |  |
| POST | `/api/governance/recovery-optout` |  | app/api/governance/recovery-optout/route.ts |  |
| GET | `/api/governance` |  | app/api/governance/route.ts |  |
| POST | `/api/governance/transfers/[id]/resolve` |  | app/api/governance/transfers/[id]/resolve/route.ts | Resolve (approve/reject) a transfer request |
| GET | `/api/governance/transfers` |  | app/api/governance/transfers/route.ts | Transfer Requests API |
| POST | `/api/governance/transfers` |  | app/api/governance/transfers/route.ts | Transfer Requests API |
| DELETE | `/api/governance/trust/[hostId]` |  | app/api/governance/trust/[hostId]/route.ts | Manager Trust DELETE Endpoint (Full-mode Next.js route) |
| GET | `/api/governance/trust` |  | app/api/governance/trust/route.ts | Manager Trust CRUD Endpoints (Full-mode Next.js routes) |
| POST | `/api/governance/trust` |  | app/api/governance/trust/route.ts | Manager Trust CRUD Endpoints (Full-mode Next.js routes) |
| PATCH | `/api/governance/user` |  | app/api/governance/user/route.ts | Updates the local user's display name and/or avatar WITHOUT requiring a |
| GET | `/api/governance/users` |  | app/api/governance/users/route.ts | Returns the active (non-soft-deleted) user records so the UI can render the |
| POST | `/api/groups/[id]/notify` |  | app/api/groups/[id]/notify/route.ts |  |
| GET | `/api/groups/[id]` |  | app/api/groups/[id]/route.ts |  |
| PUT | `/api/groups/[id]` |  | app/api/groups/[id]/route.ts |  |
| DELETE | `/api/groups/[id]` |  | app/api/groups/[id]/route.ts |  |
| POST | `/api/groups/[id]/subscribe` |  | app/api/groups/[id]/subscribe/route.ts |  |
| POST | `/api/groups/[id]/unsubscribe` |  | app/api/groups/[id]/unsubscribe/route.ts |  |
| GET | `/api/groups` |  | app/api/groups/route.ts |  |
| POST | `/api/groups` |  | app/api/groups/route.ts |  |
| POST | `/api/help/agent` |  | app/api/help/agent/route.ts | Help Agent API |
| DELETE | `/api/help/agent` |  | app/api/help/agent/route.ts | Help Agent API |
| GET | `/api/help/agent` |  | app/api/help/agent/route.ts | Help Agent API |
| PUT | `/api/hosts/[id]` |  | app/api/hosts/[id]/route.ts |  |
| DELETE | `/api/hosts/[id]` |  | app/api/hosts/[id]/route.ts |  |
| POST | `/api/hosts/exchange-peers` |  | app/api/hosts/exchange-peers/route.ts |  |
| GET | `/api/hosts/health` |  | app/api/hosts/health/route.ts |  |
| GET | `/api/hosts/identity` |  | app/api/hosts/identity/route.ts |  |
| POST | `/api/hosts/register-peer` |  | app/api/hosts/register-peer/route.ts |  |
| GET | `/api/hosts` |  | app/api/hosts/route.ts |  |
| POST | `/api/hosts` |  | app/api/hosts/route.ts |  |
| POST | `/api/hosts/sync` |  | app/api/hosts/sync/route.ts |  |
| GET | `/api/hosts/sync` |  | app/api/hosts/sync/route.ts |  |
| GET | `/api/janitor/status-archive/[name]` |  | app/api/janitor/status-archive/[name]/route.ts |  |
| POST | `/api/janitor/status-archive/generate` |  | app/api/janitor/status-archive/generate/route.ts |  |
| GET | `/api/janitor/status-archive` |  | app/api/janitor/status-archive/route.ts |  |
| GET | `/api/marketplace/skills/[id]` |  | app/api/marketplace/skills/[id]/route.ts | Single Skill API |
| GET | `/api/marketplace/skills` |  | app/api/marketplace/skills/route.ts | Marketplace Skills API |
| GET | `/api/meetings/[id]` |  | app/api/meetings/[id]/route.ts |  |
| PATCH | `/api/meetings/[id]` |  | app/api/meetings/[id]/route.ts |  |
| DELETE | `/api/meetings/[id]` |  | app/api/meetings/[id]/route.ts |  |
| GET | `/api/meetings` |  | app/api/meetings/route.ts |  |
| POST | `/api/meetings` |  | app/api/meetings/route.ts |  |
| POST | `/api/messages/forward` |  | app/api/messages/forward/route.ts |  |
| GET | `/api/messages/meeting` |  | app/api/messages/meeting/route.ts |  |
| GET | `/api/messages` |  | app/api/messages/route.ts |  |
| POST | `/api/messages` |  | app/api/messages/route.ts |  |
| PATCH | `/api/messages` |  | app/api/messages/route.ts |  |
| DELETE | `/api/messages` |  | app/api/messages/route.ts |  |
| POST | `/api/oauth-rotator/reauth/complete` | strict | app/api/oauth-rotator/reauth/complete/route.ts | TRDD-OX5TT5OT. Anthropic's callback page DISPLAYS `<code>#<state>`; the owner copies it here. |
| POST | `/api/oauth-rotator/reauth/start` | strict | app/api/oauth-rotator/reauth/start/route.ts | TRDD-OX5TT5OT. A slot whose refresh token is dead can only be repaired by a human consenting |
| GET | `/api/oauth-rotator/status` |  | app/api/oauth-rotator/status/route.ts | TRDD-OX5TT5OT. The read half of the re-login flow: a "Re-login" button is useless without saying |
| GET | `/api/organization` |  | app/api/organization/route.ts |  |
| POST | `/api/organization` |  | app/api/organization/route.ts |  |
| POST | `/api/plugin-builder/build` |  | app/api/plugin-builder/build/route.ts | Plugin Builder - Build API |
| GET | `/api/plugin-builder/builds/[id]` |  | app/api/plugin-builder/builds/[id]/route.ts | Plugin Builder - Build Status API |
| POST | `/api/plugin-builder/push` |  | app/api/plugin-builder/push/route.ts | Plugin Builder - Push to GitHub API |
| POST | `/api/plugin-builder/scan-repo` |  | app/api/plugin-builder/scan-repo/route.ts | Plugin Builder - Repo Scanner API |
| GET | `/api/plugins/update-trail` |  | app/api/plugins/update-trail/route.ts | Read-only: the per-invocation `claude plugin update` trail the fleet-plugins-update |
| GET | `/api/sessions/[id]/activity-signals` |  | app/api/sessions/[id]/activity-signals/route.ts | Read-only derived activity signals for a NON-self pane — the fleet guardian / |
| POST | `/api/sessions/[id]/command` |  | app/api/sessions/[id]/command/route.ts |  |
| GET | `/api/sessions/[id]/command` |  | app/api/sessions/[id]/command/route.ts |  |
| POST | `/api/sessions/[id]/kill` | strict | app/api/sessions/[id]/kill/route.ts |  |
| GET | `/api/sessions/[id]/pane-status` |  | app/api/sessions/[id]/pane-status/route.ts | Cheap status probe used by the dashboard's TerminalView to decide |
| PATCH | `/api/sessions/[id]/rename` |  | app/api/sessions/[id]/rename/route.ts |  |
| POST | `/api/sessions/[id]/restart` | strict | app/api/sessions/[id]/restart/route.ts | Orchestrates a full graceful restart of a Claude Code (or other AI program) |
| DELETE | `/api/sessions/[id]` | strict | app/api/sessions/[id]/route.ts |  |
| POST | `/api/sessions/[id]/stop` | strict | app/api/sessions/[id]/stop/route.ts | Gracefully stop the AI program running inside a tmux session. |
| GET | `/api/sessions/activity` |  | app/api/sessions/activity/route.ts |  |
| POST | `/api/sessions/activity/update` |  | app/api/sessions/activity/update/route.ts |  |
| POST | `/api/sessions/create` |  | app/api/sessions/create/route.ts |  |
| POST | `/api/sessions/me/restart` |  | app/api/sessions/me/restart/route.ts | The SELF-ONLY-BY-CONSTRUCTION agent self-restart. An agent (the janitor `#J` |
| POST | `/api/sessions/me/user-input` |  | app/api/sessions/me/user-input/route.ts | Records the human user's last-input timestamp on the user record. |
| GET | `/api/sessions/restore` |  | app/api/sessions/restore/route.ts |  |
| POST | `/api/sessions/restore` |  | app/api/sessions/restore/route.ts |  |
| DELETE | `/api/sessions/restore` |  | app/api/sessions/restore/route.ts |  |
| GET | `/api/sessions` |  | app/api/sessions/route.ts |  |
| GET | `/api/sessions-browser/agents/[id]/sessions` |  | app/api/sessions-browser/agents/[id]/sessions/route.ts |  |
| GET | `/api/sessions-browser/agents/[id]/timeline` |  | app/api/sessions-browser/agents/[id]/timeline/route.ts |  |
| GET | `/api/sessions-browser/lifeline` |  | app/api/sessions-browser/lifeline/route.ts |  |
| GET | `/api/sessions-browser/sessions/[sid]/context-breakdown` |  | app/api/sessions-browser/sessions/[sid]/context-breakdown/route.ts |  |
| POST | `/api/sessions-browser/sessions/[sid]/range` |  | app/api/sessions-browser/sessions/[sid]/range/route.ts |  |
| POST | `/api/sessions-browser/sessions/[sid]/search` |  | app/api/sessions-browser/sessions/[sid]/search/route.ts |  |
| GET | `/api/sessions-browser/timelines/[tid]/context-at` |  | app/api/sessions-browser/timelines/[tid]/context-at/route.ts |  |
| GET | `/api/sessions-browser/timelines/[tid]/range` |  | app/api/sessions-browser/timelines/[tid]/range/route.ts |  |
| GET | `/api/sessions-browser/timelines/[tid]/search` |  | app/api/sessions-browser/timelines/[tid]/search/route.ts |  |
| GET | `/api/settings/auto-update` |  | app/api/settings/auto-update/route.ts | Auto-update settings API. |
| PATCH | `/api/settings/auto-update` | strict | app/api/settings/auto-update/route.ts | Auto-update settings API. |
| POST | `/api/settings/auto-update/run` | strict | app/api/settings/auto-update/run/route.ts | Manual "Run now" trigger for the auto-update scheduler. |
| GET | `/api/settings/edit` |  | app/api/settings/edit/route.ts | Universal gated settings editor API (TRDD-RYFP030K). |
| POST | `/api/settings/edit` |  | app/api/settings/edit/route.ts | Universal gated settings editor API (TRDD-RYFP030K). |
| GET | `/api/settings/element-content` |  | app/api/settings/element-content/route.ts | Element Content API |
| GET | `/api/settings/global-elements/client-skills` |  | app/api/settings/global-elements/client-skills/route.ts | List all elements installed for a specific AI client (user scope). |
| POST | `/api/settings/global-elements/convert-skill` |  | app/api/settings/global-elements/convert-skill/route.ts | Convert elements between AI coding clients. |
| GET | `/api/settings/global-elements/convert-skill` |  | app/api/settings/global-elements/convert-skill/route.ts | Convert elements between AI coding clients. |
| POST | `/api/settings/global-elements/install-skill` |  | app/api/settings/global-elements/install-skill/route.ts | Install a skill globally at user scope. |
| GET | `/api/settings/global-elements` |  | app/api/settings/global-elements/route.ts | Global Elements API |
| GET | `/api/settings/global-plugins` |  | app/api/settings/global-plugins/route.ts | Global Plugins API |
| POST | `/api/settings/global-plugins` |  | app/api/settings/global-plugins/route.ts | Global Plugins API |
| GET | `/api/settings/host-tools` |  | app/api/settings/host-tools/route.ts | Tools are scripts that configure this host for AI Maestro: |
| POST | `/api/settings/host-tools` |  | app/api/settings/host-tools/route.ts | Tools are scripts that configure this host for AI Maestro: |
| GET | `/api/settings/marketplaces` |  | app/api/settings/marketplaces/route.ts | Marketplaces API |
| POST | `/api/settings/marketplaces` |  | app/api/settings/marketplaces/route.ts | Marketplaces API |
| POST | `/api/settings/mcp-discover` |  | app/api/settings/mcp-discover/route.ts | MCP Server Discovery API |
| GET | `/api/settings/security` |  | app/api/settings/security/route.ts |  |
| PATCH | `/api/settings/security` | strict | app/api/settings/security/route.ts |  |
| GET | `/api/settings/security/status` |  | app/api/settings/security/status/route.ts |  |
| POST | `/api/settings/security/status` |  | app/api/settings/security/status/route.ts |  |
| GET | `/api/statusline/[sessionId]` |  | app/api/statusline/[sessionId]/route.ts | TRDD-D8OYFG35. The read half of the ingest pipeline. Deliberately NOT console-gated: the whole |
| POST | `/api/statusline/ingest` |  | app/api/statusline/ingest/route.ts | TRDD-D8OYFG35. Claude Code pipes its `statusLine` command a JSON payload that already contains |
| GET | `/api/statusline` |  | app/api/statusline/route.ts | TRDD-D8OYFG35. "How close is this host to its 5-hour limit?" is the question every agent actually |
| GET | `/api/subconscious` |  | app/api/subconscious/route.ts |  |
| POST | `/api/system/aid-recover` | strict | app/api/system/aid-recover/route.ts | /api/system/aid-recover — explicit R33 recovery (operations endpoint). |
| GET | `/api/system/client-availability` |  | app/api/system/client-availability/route.ts | Reports whether a given AI-client binary is installed on PATH. Used |
| GET | `/api/system/ledger-health` |  | app/api/system/ledger-health/route.ts | Phase 0.A-derived (#234, 2026-04-20). After TRDD-eac02238 shipped per-op |
| POST | `/api/teams/[id]/batch-create-agents` |  | app/api/teams/[id]/batch-create-agents/route.ts |  |
| POST | `/api/teams/[id]/chief-of-staff` |  | app/api/teams/[id]/chief-of-staff/route.ts |  |
| GET | `/api/teams/[id]/composition-check` |  | app/api/teams/[id]/composition-check/route.ts |  |
| GET | `/api/teams/[id]/documents/[docId]` |  | app/api/teams/[id]/documents/[docId]/route.ts |  |
| PUT | `/api/teams/[id]/documents/[docId]` |  | app/api/teams/[id]/documents/[docId]/route.ts |  |
| DELETE | `/api/teams/[id]/documents/[docId]` |  | app/api/teams/[id]/documents/[docId]/route.ts |  |
| GET | `/api/teams/[id]/documents` |  | app/api/teams/[id]/documents/route.ts |  |
| POST | `/api/teams/[id]/documents` |  | app/api/teams/[id]/documents/route.ts |  |
| PATCH | `/api/teams/[id]/kanban/items/[itemId]` |  | app/api/teams/[id]/kanban/items/[itemId]/route.ts |  |
| DELETE | `/api/teams/[id]/kanban/items/[itemId]` |  | app/api/teams/[id]/kanban/items/[itemId]/route.ts |  |
| GET | `/api/teams/[id]/kanban/items` |  | app/api/teams/[id]/kanban/items/route.ts |  |
| POST | `/api/teams/[id]/kanban/items` |  | app/api/teams/[id]/kanban/items/route.ts |  |
| GET | `/api/teams/[id]/kanban-config` |  | app/api/teams/[id]/kanban-config/route.ts |  |
| PUT | `/api/teams/[id]/kanban-config` |  | app/api/teams/[id]/kanban-config/route.ts |  |
| PUT | `/api/teams/[id]/orchestrator` | strict | app/api/teams/[id]/orchestrator/route.ts |  |
| DELETE | `/api/teams/[id]/orchestrator` | strict | app/api/teams/[id]/orchestrator/route.ts |  |
| GET | `/api/teams/[id]/repos` |  | app/api/teams/[id]/repos/route.ts |  |
| POST | `/api/teams/[id]/repos` |  | app/api/teams/[id]/repos/route.ts |  |
| GET | `/api/teams/[id]` |  | app/api/teams/[id]/route.ts |  |
| PUT | `/api/teams/[id]` | strict | app/api/teams/[id]/route.ts |  |
| DELETE | `/api/teams/[id]` | strict | app/api/teams/[id]/route.ts |  |
| GET | `/api/teams/[id]/tasks/[taskId]` |  | app/api/teams/[id]/tasks/[taskId]/route.ts |  |
| PUT | `/api/teams/[id]/tasks/[taskId]` |  | app/api/teams/[id]/tasks/[taskId]/route.ts |  |
| DELETE | `/api/teams/[id]/tasks/[taskId]` |  | app/api/teams/[id]/tasks/[taskId]/route.ts |  |
| GET | `/api/teams/[id]/tasks` |  | app/api/teams/[id]/tasks/route.ts |  |
| POST | `/api/teams/[id]/tasks` |  | app/api/teams/[id]/tasks/route.ts |  |
| POST | `/api/teams/create-with-project` | strict | app/api/teams/create-with-project/route.ts |  |
| GET | `/api/teams/names` |  | app/api/teams/names/route.ts |  |
| POST | `/api/teams/notify` |  | app/api/teams/notify/route.ts |  |
| GET | `/api/teams` |  | app/api/teams/route.ts |  |
| POST | `/api/teams` | strict | app/api/teams/route.ts |  |
| GET | `/api/teams/stats` |  | app/api/teams/stats/route.ts |  |
| POST | `/api/trdd/[id]/approve` | strict | app/api/trdd/[id]/approve/route.ts |  |
| POST | `/api/trdd/[id]/archive` | strict | app/api/trdd/[id]/archive/route.ts |  |
| POST | `/api/trdd/[id]/promote` | strict | app/api/trdd/[id]/promote/route.ts |  |
| POST | `/api/trdd/[id]/refuse` | strict | app/api/trdd/[id]/refuse/route.ts |  |
| GET | `/api/trdd/[id]` |  | app/api/trdd/[id]/route.ts |  |
| PATCH | `/api/trdd/[id]` | strict | app/api/trdd/[id]/route.ts |  |
| GET | `/api/trdd/[id]/verify` |  | app/api/trdd/[id]/verify/route.ts |  |
| GET | `/api/trdd/kanban` |  | app/api/trdd/kanban/route.ts |  |
| GET | `/api/trdd` |  | app/api/trdd/route.ts |  |
| GET | `/api/users/me/presence` |  | app/api/users/me/presence/route.ts | Returns the human user's last-input timestamp + the server's |
| GET | `/api/v1/agents/me` |  | app/api/v1/agents/me/route.ts | AMP v1 Agent Self-Management Endpoint |
| PATCH | `/api/v1/agents/me` |  | app/api/v1/agents/me/route.ts | AMP v1 Agent Self-Management Endpoint |
| DELETE | `/api/v1/agents/me` |  | app/api/v1/agents/me/route.ts | AMP v1 Agent Self-Management Endpoint |
| GET | `/api/v1/agents/resolve/[address]` |  | app/api/v1/agents/resolve/[address]/route.ts | AMP v1 Agent Address Resolution |
| GET | `/api/v1/agents` |  | app/api/v1/agents/route.ts | AMP v1 Agent List |
| POST | `/api/v1/auth/challenge` |  | app/api/v1/auth/challenge/route.ts | AID Proof-of-Possession Challenge Endpoint (TRDD-15ff13ae) |
| POST | `/api/v1/auth/ibct` |  | app/api/v1/auth/ibct/route.ts |  |
| DELETE | `/api/v1/auth/revoke-key` |  | app/api/v1/auth/revoke-key/route.ts | AMP v1 API Key Revocation |
| POST | `/api/v1/auth/rotate-key` |  | app/api/v1/auth/rotate-key/route.ts | AMP v1 API Key Rotation |
| POST | `/api/v1/auth/rotate-keys` |  | app/api/v1/auth/rotate-keys/route.ts | AMP v1 Keypair Rotation |
| POST | `/api/v1/auth/token` |  | app/api/v1/auth/token/route.ts | AID Token Exchange Endpoint |
| POST | `/api/v1/federation/deliver` |  | app/api/v1/federation/deliver/route.ts | AMP v1 Federation Delivery Endpoint |
| POST | `/api/v1/governance/requests/[id]/approve` |  | app/api/v1/governance/requests/[id]/approve/route.ts | Approve Cross-Host Governance Request |
| POST | `/api/v1/governance/requests/[id]/reject` |  | app/api/v1/governance/requests/[id]/reject/route.ts | Reject Cross-Host Governance Request |
| POST | `/api/v1/governance/requests` |  | app/api/v1/governance/requests/route.ts | Cross-Host Governance Requests Endpoint |
| GET | `/api/v1/governance/requests` |  | app/api/v1/governance/requests/route.ts | Cross-Host Governance Requests Endpoint |
| POST | `/api/v1/governance/sync` |  | app/api/v1/governance/sync/route.ts | Governance Sync Endpoint (Layer 1: Cross-Host State Replication) |
| GET | `/api/v1/governance/sync` |  | app/api/v1/governance/sync/route.ts | Governance Sync Endpoint (Layer 1: Cross-Host State Replication) |
| GET | `/api/v1/health` |  | app/api/v1/health/route.ts | AMP v1 Health Check Endpoint |
| GET | `/api/v1/info` |  | app/api/v1/info/route.ts | AMP v1 Provider Info Endpoint |
| GET | `/api/v1/mesh/chat/history` |  | app/api/v1/mesh/chat/history/route.ts | Query params: |
| GET | `/api/v1/mesh/chat` |  | app/api/v1/mesh/chat/route.ts | Both endpoints require authentication. The chat log is append-only. |
| POST | `/api/v1/mesh/chat` |  | app/api/v1/mesh/chat/route.ts | Both endpoints require authentication. The chat log is append-only. |
| GET | `/api/v1/mesh/humans` |  | app/api/v1/mesh/humans/route.ts | Both endpoints are behind Tailscale IP filter (isAllowedSource in server.mjs). |
| POST | `/api/v1/mesh/humans` |  | app/api/v1/mesh/humans/route.ts | Both endpoints are behind Tailscale IP filter (isAllowedSource in server.mjs). |
| POST | `/api/v1/messages/[id]/read` |  | app/api/v1/messages/[id]/read/route.ts | AMP v1 Read Receipt |
| GET | `/api/v1/messages/pending` |  | app/api/v1/messages/pending/route.ts | AMP v1 Pending Messages Endpoint |
| DELETE | `/api/v1/messages/pending` |  | app/api/v1/messages/pending/route.ts | AMP v1 Pending Messages Endpoint |
| POST | `/api/v1/messages/pending` |  | app/api/v1/messages/pending/route.ts | AMP v1 Pending Messages Endpoint |
| POST | `/api/v1/register` |  | app/api/v1/register/route.ts | AMP v1 Registration Endpoint |
| POST | `/api/v1/route` |  | app/api/v1/route/route.ts | AMP v1 Route Endpoint |
| GET | `/api/vpn-chat/block` |  | app/api/vpn-chat/block/route.ts | The blocklist is LOCAL only — never synced to mesh peers. |
| POST | `/api/vpn-chat/block` |  | app/api/vpn-chat/block/route.ts | The blocklist is LOCAL only — never synced to mesh peers. |
| DELETE | `/api/vpn-chat/block` |  | app/api/vpn-chat/block/route.ts | The blocklist is LOCAL only — never synced to mesh peers. |
| GET | `/api/webhooks/[id]` |  | app/api/webhooks/[id]/route.ts |  |
| DELETE | `/api/webhooks/[id]` |  | app/api/webhooks/[id]/route.ts |  |
| POST | `/api/webhooks/[id]/test` |  | app/api/webhooks/[id]/test/route.ts |  |
| GET | `/api/webhooks` |  | app/api/webhooks/route.ts |  |
| POST | `/api/webhooks` |  | app/api/webhooks/route.ts |  |
