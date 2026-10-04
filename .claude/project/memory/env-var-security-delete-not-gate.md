---
name: env-var-security-delete-not-gate
description: "adding a new process.env read / env var — is it safe? does a security-weakening env var get deleted or gated? how does ai-maestro treat env overrides for keychain/backend/paths? the test-only allowlist + regression fence"
ocd: 2026-07-17
lmd: 2026-10-01
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: security-and-auth
publish-globally: false
---
^BAPDBVO3 [desc: "USER-ratified rule (TRDD-CC9PY337, 2026-07-17): an env var that can weaken a security property is DELETED in every mode, not gated or documented, because a dev box is not a safe host (same UID)", keywords: security_weakening_env_var_delete_not_gate env_var_can_weaken_security what_to_do_with_dangerous_env_var dev_box_not_safe_host prompt_injected_agent_export_zshrc AIM_SMTP_deleted same_uid_as_server doubt_resolves_toward_removal, ocd: 2026-07-17, lmd: 2026-10-01, trdd: CC9PY337]
**RULE (USER-ratified, TRDD-CC9PY337, 2026-07-17): an env var that can weaken a security
property is DELETED — not read, not validated, not documented, not in `.example.env`.** Doubt
resolves toward removal, never toward a check. A setting that must be configurable lives in the
dashboard's encrypted settings store, not in the environment. **A dev box is NOT a safe host** —
agents run under the SAME UID as the server, so a prompt-injected agent appends one `export` to
`~/.zshrc` and the next restart picks it up. "Delete" therefore means delete in every mode
(dev/prod alike), never merely a release gate.

^HTPRUUWQ [desc: "The attack vector is the INHERITED environment, not a remote attacker: a stray export silently downgrades a credential store with no UI warning, and a release-mode gate leaves the hatch live on dev", keywords: inherited_environment_attack_vector stray_hostile_export_downgrades_credential_store why_delete_not_gate release_mode_gate_leaves_hatch_live_on_dev NODE_ENV_production_gate_insufficient silent_downgrade_no_ui_warning, ocd: 2026-07-17, lmd: 2026-10-01]
**Why:** the vector is the INHERITED environment, not a remote attacker. A stray/hostile `export`
silently downgrades a credential store with nothing in the UI saying so. A release-mode gate
(`NODE_ENV !== 'production'`) leaves the hatch live on every dev box — which is exactly the
exploitable surface.

^7KJNE5I1 [desc: "Env var procedure: 1 no security weakening = leave alone; 2 weakens + dashboard equivalent = DELETE; 3 weakens + test-only seam = testOnlyEnv() allowlist, only in NODE_ENV=test; 4 else DELETE", keywords: env_var_decision_procedure four_steps_env_var how_to_decide_delete_or_gate testOnlyEnv test_only_env_ts allowlist_on_test_runner_not_blocklist_on_production does_vitest_set_node_env_test ordinary_config_leave_alone PORT_MAESTRO_MODE, ocd: 2026-07-17, lmd: 2026-10-01]
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

^O0APLWGI [desc: "Two registries in lib/test-only-env.ts asserted DISJOINT by a test: TEST_ONLY_ENV (gated seams) and FORBIDDEN_ENV (deleted names read by nothing, kept for the fence and boot tamper-evidence)", keywords: TEST_ONLY_ENV_registry FORBIDDEN_ENV_registry registries_disjoint_by_test reportIgnoredTestEnv_boot_warning CLAUDE_SAFE_STORAGE_BACKEND JANITOR_ROTATOR_KEYCHAIN what_goes_in_the_allowlist, ocd: 2026-07-17, lmd: 2026-10-01]
**The two registries (`lib/test-only-env.ts`), asserted DISJOINT by a test:**
- `TEST_ONLY_ENV` — gated seams a test genuinely sets: `CLAUDE_SAFE_STORAGE_BACKEND`,
  `AIM_SMTP_CRED_BACKEND`, `JANITOR_ROTATOR_KEYCHAIN`, `JANITOR_GLOBAL_STATE_DIR`.
- `FORBIDDEN_ENV` — DELETED names read by nothing, kept only for the fence + boot tamper-evidence
  (`reportIgnoredTestEnv()` warns at boot if one is present; silent on a clean host).

^3F3KYRZZ [desc: "The regression fence (tests/unit/test-only-env.test.ts) is a Node-fs source walk over lib/services/app that fails with file:line if a gated/forbidden env name reappears as a bare process.env read", keywords: regression_fence_env_var source_walk_not_grep test_only_env_test_ts non_vacuous_scan_files_over_50 fence_stops_contributor_reopening_hatch how_is_env_rule_enforced, ocd: 2026-07-17, lmd: 2026-10-01]
**The durable guard — the regression fence** (`tests/unit/test-only-env.test.ts`): a Node-fs
source walk over `lib/`+`services/`+`app/` (NOT grep — a security fence must not depend on grep
dialect or git-tracking state) that FAILS with file:line if any gated OR forbidden name reappears
as a bare `process.env.<NAME>`. This is what stops the next contributor re-opening a hatch. It
also asserts a non-vacuous scan (`files.length > 50`).

^PM6A74K3 [desc: "0-IMPACT is proven by DELTA, never by a passing suite: snapshot the real resource (keychain item counts), run the suite, re-snapshot, require delta 0", keywords: prove_zero_impact_by_delta keychain_item_count_snapshot green_suite_does_not_prove_no_real_resource_touched test_isolation_delta_check snapshot_run_resnapshot, ocd: 2026-07-17, lmd: 2026-10-01]
**0-IMPACT is proven by DELTA, never by a passing suite:** snapshot the real resource (keychain
item counts) → run the suite → re-snapshot → require delta 0. A green suite alone does not prove
the tests avoided the developer's real keychain.

See also [[governance-password-invalidation]] (the `x-forwarded-for` can't-trust-client-headers
security lesson), and TRDD-CC9PY337 for the full phase-by-phase record.


## See also

- [[env-vars-and-the-governance-password]]

## Notes and lessons learned
[^1]: [id:ATOM-CC9P-Y337, status:valid, keywords:"gated_a_var_on_a_stale_comment env_override trusted_code_comment no_test_actually_sets_it", ocd:2026-07-17, lmd:2026-07-17]
  DO NOT gate an env read because a code comment says "env-overridable ONLY so tests can target a
  throwaway service", BECAUSE the 3 `CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE` vars carried exactly that
  comment and NO test set any of them (tests force `CLAUDE_SAFE_STORAGE_BACKEND=none` instead) — so
  the gate branch didn't apply and step 4 (DELETE) did. DO grep `tests/` for a real setter of the
  var before deciding gate-vs-delete; a stale comment is not evidence a test needs the seam.
