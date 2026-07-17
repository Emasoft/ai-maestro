---
name: env-var-security-delete-not-gate
description: "adding a new process.env read / env var — is it safe? does a security-weakening env var get deleted or gated? how does ai-maestro treat env overrides for keychain/backend/paths? the test-only allowlist + regression fence"
ocd: 2026-07-17
lmd: 2026-07-17
metadata:
  node_type: memory
  type: project
  tier: aspect
---
**RULE (USER-ratified, TRDD-CC9PY337, 2026-07-17): an env var that can weaken a security
property is DELETED — not read, not validated, not documented, not in `.example.env`.** Doubt
resolves toward removal, never toward a check. A setting that must be configurable lives in the
dashboard's encrypted settings store, not in the environment. **A dev box is NOT a safe host** —
agents run under the SAME UID as the server, so a prompt-injected agent appends one `export` to
`~/.zshrc` and the next restart picks it up. "Delete" therefore means delete in every mode
(dev/prod alike), never merely a release gate.

**Why:** the vector is the INHERITED environment, not a remote attacker. A stray/hostile `export`
silently downgrades a credential store with nothing in the UI saying so. A release-mode gate
(`NODE_ENV !== 'production'`) leaves the hatch live on every dev box — which is exactly the
exploitable surface.

**How to apply — the decision procedure for ANY env var, present or future:**
1. Honoring it weakens a security property? **No** → ordinary config, leave alone (`PORT`,
   `MAESTRO_MODE`, `NOTIFICATION_*`). Gating these breaks deployments and buys nothing.
2. **Yes**, and it has a dashboard equivalent? → **DELETE the read.** The dashboard owns it
   (what happened to `AIM_SMTP_*`).
3. **Yes**, no dashboard equivalent, but a TEST genuinely sets it for 0-IMPACT isolation (it is a
   test SEAM, not a setting)? → route through `testOnlyEnv(name)` in `lib/test-only-env.ts`,
   honored ONLY when `NODE_ENV === 'test'` (an ALLOWLIST on the test runner, not a blocklist on
   production — that is what covers dev too). Vitest sets `NODE_ENV=test` itself (empirically
   verified; `vitest.config.ts` does NOT — a test pins the property).
4. Anything else / any doubt → **DELETE.**

**The two registries (`lib/test-only-env.ts`), asserted DISJOINT by a test:**
- `TEST_ONLY_ENV` — gated seams a test genuinely sets: `CLAUDE_SAFE_STORAGE_BACKEND`,
  `AIM_SMTP_CRED_BACKEND`, `JANITOR_ROTATOR_KEYCHAIN`, `JANITOR_GLOBAL_STATE_DIR`.
- `FORBIDDEN_ENV` — DELETED names read by nothing, kept only for the fence + boot tamper-evidence
  (`reportIgnoredTestEnv()` warns at boot if one is present; silent on a clean host).

**The durable guard — the regression fence** (`tests/unit/test-only-env.test.ts`): a Node-fs
source walk over `lib/`+`services/`+`app/` (NOT grep — a security fence must not depend on grep
dialect or git-tracking state) that FAILS with file:line if any gated OR forbidden name reappears
as a bare `process.env.<NAME>`. This is what stops the next contributor re-opening a hatch. It
also asserts a non-vacuous scan (`files.length > 50`).

**0-IMPACT is proven by DELTA, never by a passing suite:** snapshot the real resource (keychain
item counts) → run the suite → re-snapshot → require delta 0. A green suite alone does not prove
the tests avoided the developer's real keychain.

See also [[governance-password-invalidation]] (the `x-forwarded-for` can't-trust-client-headers
security lesson), and TRDD-CC9PY337 for the full phase-by-phase record.

## Notes and lessons learned
[^1]: [id:ATOM-CC9P-Y337, status:valid, keywords:"gated_a_var_on_a_stale_comment env_override trusted_code_comment no_test_actually_sets_it", ocd:2026-07-17, lmd:2026-07-17]
  DO NOT gate an env read because a code comment says "env-overridable ONLY so tests can target a
  throwaway service", BECAUSE the 3 `CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE` vars carried exactly that
  comment and NO test set any of them (tests force `CLAUDE_SAFE_STORAGE_BACKEND=none` instead) — so
  the gate branch didn't apply and step 4 (DELETE) did. DO grep `tests/` for a real setter of the
  var before deciding gate-vs-delete; a stale comment is not evidence a test needs the seam.
