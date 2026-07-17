---
trdd-id: CC9PY337
title: Delete every security-risk env read — dashboard-only settings, non-env test seams
column: dev
created: 2026-07-17T06:19:15+0200
updated: 2026-07-17T06:19:15+0200
current-owner: ai-maestro
task-type: security
parent-trdd: QZL828OD
relevant-rules: [16]
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: user
approval-datetime: 2026-07-17T06:19:15+0200
implementation-commits: [4e2e90b4]
scope: project
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**USER DIRECTIVE (2026-07-17), verbatim intent:** *"when in doubt, choose to remove the env
value completely, not read, not checked, not present in the template, nothing. only remain as
a dashboard setting, saved in the encrypted settings file. because if there is the minimal
doubt, you can be sure it can be exploited by malicious actors. security is paramount in
ai-maestro, value number 1."*

**THE RULE THIS RATIFIES (apply to every future env var):** an env var that can weaken a
security property is not gated, not validated, not documented — it is DELETED. Doubt resolves
toward removal, never toward a check. A setting that must be configurable lives in the
dashboard, in the encrypted settings file. This is a standing rule, not a one-off cleanup.

**PROGRESS:**
- `4e2e90b4` — `lib/release-env-guard.ts`: a release-mode gate that IGNORES dangerous vars when
  `NODE_ENV=production`. **SUPERSEDED IN PART by this TRDD** (see "Superseded" below). It is
  wired to nothing, so nothing regresses while it stands.

**NEXT ACTION:** Phase 1 — delete the six `AIM_SMTP_*` env reads from `lib/mailer.ts`
(`envOverride()` + its merge in `getMailerConfig()`), leaving the dashboard/keychain path as the
only source. Then drop the now-dead `AIM_SMTP_*` stubs from `tests/unit/mailer.test.ts` and the
7 per-field cases added in `3536afef`.

**SUPERSEDED — do NOT carry forward:**
- *"The guard is the answer."* It is not. A guard IGNORES the var in release but still READS it
  in development — and dev machines run agents too, so the vector survives where the guard
  claims to help. Deleting the read closes it in BOTH modes. The guard's only durable residue
  is a regression fence (Phase 4).
- *"`AIM_SMTP_*` is legitimate operator config for a self-hosted relay."* The USER ruled the
  dashboard is the only release path. The per-field override built in `3536afef` is therefore
  reverted, not extended.
- *"Env vars must be gated in release mode."* Weaker than the ratified rule. They are DELETED,
  not gated.

## Problem

A set of env vars silently weaken the thing they redirect. Each verified at its call site:

| Var | What one `export` line buys | Site |
|---|---|---|
| `AIM_JSONL_READER_PATH` | spawns an arbitrary binary as the server UID (RCE) | `lib/jsonl-reader.ts:58` |
| `CLAUDE_SAFE_STORAGE_BACKEND` | `none` = OAuth tokens in plaintext | `safe-storage.ts:283` |
| `AIM_SMTP_CRED_BACKEND` | `file` = SMTP password leaves the keychain | `smtp-credential.ts:52` |
| `CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE` ×3 | token substitution via service redirect | `slots.ts:40,42` · `live.ts:36` |
| `JANITOR_ROTATOR_KEYCHAIN` | rotator ops confined to an attacker's keychain | `safe-storage.ts:299` |
| `JANITOR_GLOBAL_STATE_DIR` | rotator/daemon state redirect | `global-state.ts:68` |
| `CLAUDE_MARKETPLACE_PLUGINS_DIR` | plugins loaded from an attacker's dir | `plugin-builder-service.ts:56` |
| `OPENCLAW_TMUX_SOCKET_DIR` | session discovery via an attacker's socket dir | `sessions-service.ts:519` |
| `AIM_SMTP_*` ×6 | reset codes via an attacker's relay → account takeover | `lib/mailer.ts` |

**Threat model — the inherited environment, not a remote attacker.** Agents run as the SAME UID
as the server. A prompt-injected agent appends one `export` to `~/.zshrc` — a low-suspicion write
— and the next restart picks it up. A stale export from a debugging session does it by accident.
Both are silent: nothing in the UI says the keychain was bypassed.

**Why these exist at all:** 11 test files depend on them for 0-IMPACT isolation (a test must never
touch the developer's real keychain). That is a real constraint, and it is why "just delete them"
needs a replacement seam rather than a `rm`.

## Design — two kinds, two treatments

**Kind 1 — a dashboard setting that ALSO reads env (`AIM_SMTP_*` ×6).** The dashboard owns it;
the env read is redundancy plus an attack vector. **DELETE the read.** Tests get simpler: they
already drive `setRecoveryEmail()` + `storeSmtpPassword()`, and today's suite only stubs these
vars to neutralize them.

**Kind 2 — a test-isolation hatch (the rest).** No dashboard equivalent, no operator use; it
exists only so a test avoids the real keychain. **DELETE the env read; inject instead** — an
explicit function param where the call is shallow (the pattern already proven by
`enforceClaudeSettings(target?)` in `4c8b7cb8`), or a test-only exported setter where threading
a param through every caller would be worse.

**Why injection beats a guard.** A param cannot be set from a dotfile. That is the entire vector,
closed in dev AND release, rather than gated in release only. An attacker who can call an exported
setter already has code execution and does not need it.

**Kind 3 — bootstrap config that MUST stay env** (`PORT`, `HOSTNAME`, `MAESTRO_MODE`, `NODE_ENV`).
A dashboard cannot configure the port of the server that has not bound it yet. `HOSTNAME` already
has its own failsafe (non-localhost without Tailscale is refused). These are operational, not
security-weakening, and gating them would break deployments while buying nothing.

## Phases (each ≤5 files, verified before the next)

1. **`AIM_SMTP_*` deletion** — `lib/mailer.ts` + `tests/unit/mailer.test.ts` (reverts most of
   `3536afef`). Drops 6 vars.
2. **SMTP credential seam** — `lib/smtp-credential.ts` (`AIM_SMTP_CRED_BACKEND` → param/setter) +
   its tests + `mailer-user-relay`/`email-configure-route` fallout. Drops 1.
3. **Rotator seams** — `safe-storage.ts`, `slots.ts`, `live.ts`, `global-state.ts` (5 vars) + the
   6 rotator test files. The largest phase; may split.
4. **Remaining reads + the regression fence** — `jsonl-reader.ts`, `plugin-builder-service.ts`,
   `sessions-service.ts` (3 vars). Convert `lib/release-env-guard.ts` from a runtime gate into a
   test asserting NO deleted name reappears in a `process.env` read anywhere in the source. That
   test is the durable value: it stops the next contributor re-introducing a hatch.
5. **Docs** — purge every deleted name from `.example.env` and `CLAUDE.md`; state the standing
   rule.

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` → 0 errors.
- `bash scripts/with-node.sh yarn test` → green, and STILL 0-IMPACT: no test may touch the real
  keychain. Verify by running the rotator/SMTP suites with the login keychain observed unchanged.
- `bash scripts/with-node.sh yarn build` → the real ESLint gate.
- The Phase-4 fence fails if any deleted name is re-added.

## Estimated risk

**MED.** The refactor itself is mechanical, but Phase 3 touches OAuth token custody — the code
whose failure mode is "the user's live credentials". Each phase lands and verifies alone. The
0-IMPACT property is the thing that must not regress: a test that starts writing to the real
keychain is a worse outcome than the vector this TRDD closes.

## Approval log

- 2026-07-17T06:19:15+0200 — **MANDATE issued by USER** (min-approval-requirement: none —
  Tier 0, in-scope security work on this project's own source). Pre-approved: the USER's directive
  IS the authorization. No approval request was sent.
