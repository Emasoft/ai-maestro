---
name: governance-password-invalidation
description: "how does the user rotate / revoke / reset the governance password / forgot password / password leaked, must change it / next login asks to create a new password / why is a route denied only from my phone but works on the Mac (console_required 403) / how does a route know the real client IP / x-forwarded-for spoof / server crashed at boot 'does not provide an export named' after adding a lib import to server.mjs — the invalidate-by-possession + console-presence design (TRDD-P7XKV3N9)"
ocd: 2026-07-13
lmd: 2026-09-24
metadata:
  node_type: memory
  type: project
  tier: component
  topic: security-and-auth
  functionality: security
  globs: ["app/api/governance/password/invalidate/route.ts", "lib/peer-address.mjs", "lib/governance.ts", "lib/setup-bootstrap.ts", "server.mjs"]
publish-globally: false
---

# Revoke the password with the password; prove presence with a desktop code (TRDD-P7XKV3N9)

^Q8E23MPI [desc:"POST /api/governance/password/invalidate rotates the governance password in-product, fixing leaked credentials without hand-editing governance.json", keywords:"rotate_governance_password revoke_leaked_password password_rotation_in_product invalidate_governance_password_endpoint forgot_password_reset_flow POST_api_governance_password_invalidate governance.json_hand_edit_no_longer_needed credential_leaked_must_change_it in-product_password_rotation_path leaked_credential_fix", ocd:2026-07-13, lmd:2026-08-02]
`POST /api/governance/password/invalidate` lets the human ROTATE the governance
password in-product. It is the fix for a leaked credential, and it is what makes
rotation cheap enough to actually happen (before it, rotation had no in-product
path — you edited `governance.json` by hand).

^T9Y6WNNW [desc: "the invalidate route is two POSTs on the same endpoint: first verifies possession and sends a desktop code, second verifies the code and destroys the password", keywords: two_POST_invalidate_flow password_then_code_request one-shot_code_sent_to_desktop codeRequired_channel_hint_response code_not_returned_in_response second_POST_password_code_invalidatePassword next_login_asks_to_create_new_password no_known_replacement_value_issued leaked_password_valid_until_second_POST old_password_still_works_between_the_two_POSTs verifyPassword_may_rehash_same_password, ocd: 2026-07-13, lmd: 2026-09-24]
**The flow — two POSTs to the same route:**
1. `{ password }` → the server verifies possession, dispatches a one-shot CODE to
   this machine's desktop, replies `{ codeRequired, channel, hint }` — **the code
   is NOT in the response.**
2. `{ password, code }` → verified ⇒ `invalidatePassword()` runs ⇒ `{ invalidated }`.

Next login then asks the user to CREATE a new password. **Between the two POSTs
the OLD password stays fully valid for login** — step 1 only VERIFIES it via
`verifyPassword()` (lib/governance.ts, symbol `verifyPassword`), which does not invalidate or revoke
anything. Note: `verifyPassword()` CAN write `passwordHash` on a successful check —
it opportunistically rehashes the SAME plaintext to a fresher hash when
`needsRehash()` says so (inside `verifyPassword`, lib/governance.ts; `needsRehash` itself is defined in lib/argon2.ts) — but that write does not
change WHICH password is valid; it re-encodes the same one.[^4] What the flow
actually guarantees is narrower: `invalidatePassword()` DESTROYS the hash instead
of replacing it with a new known value, so no replacement credential is ever
issued that could itself leak.

^4GCNGDYE [desc: "two factors gate the rotation: knowing the password and a one-shot code delivered to a local host file (the write is unconditional; chmod 0600 on it is best-effort, plus a best-effort desktop notification on top), never over HTTP for this route", keywords: two_factor_password_rotation password_proves_knowledge desktop_code_proves_presence_at_machine code_delivered_via_local_file_not_notification notification_is_best-effort_only attacker_with_password_but_not_at_console_blocked why_is_a_route_denied_only_from_my_phone console_presence_factor_security_property code_over_HTTP_would_be_theater possession_alone_must_not_rotate_credential invalidate_route_does_not_pass_email_opt, ocd: 2026-07-13, lmd: 2026-09-24]
**Two factors, because possession alone must not rotate the master credential:**
- the **password** proves you KNOW the secret;
- a **code on the desktop** proves you are AT the machine. `dispatchCode()`
  writes it unconditionally to a local file (`~/.aimaestro/setup-code.txt`)
  first — the reliable channel — then best-effort `chmod`s it to 0600 (wrapped
  in try/catch, so a pre-existing file with looser permissions KEEPS them if
  the chmod fails) — and only attempts a desktop notification as a
  best-effort convenience on top (a daemonized pm2/launchd/systemd process has no
  GUI session, so `osascript`/`notify-send` report success while no banner ever
  appears).[^6] `dispatchCode()` also supports an EMAIL channel for callers that
  pass one, but the invalidate route calls `startSetupFlow()` with no options, so
  it never opts in — for THIS route the code never leaves the host. An attacker
  holding the password but not sitting at the console cannot read it. **That is the
  whole security property** — the moment the code travels over HTTP, the feature is
  theater.

^D3ZBD6TJ [desc: "the invalidate route's route handler is new code that reuses lib/setup-bootstrap.ts's verification-code mechanism from first-run setup, plus lib/rate-limit.ts throttling", keywords: reuse_setup-bootstrap_startSetupFlow_verifySetupCode SEC-PHASE-6_code_mechanism first-run_setup_same_code_as_invalidate hashed_record_timing-safe_compare_one-shot_consume attempt_cap_on_code_verification lib_rate-limit_checkAndRecordAttempt_throttling do_not_rewrite_notification_or_throttle_code shared_setup_bootstrap_code_path code_reuse_invalidate_password route_handler_itself_is_new_code, ocd: 2026-07-13, lmd: 2026-09-24]
**Reuse, not reinvention:** the code mechanism is `lib/setup-bootstrap.ts`
(`startSetupFlow` / `verifySetupCode`, SEC-PHASE-6) — the SAME verification-code
flow that first-run setup uses (hashed record, timing-safe compare, one-shot
consume, attempt cap; see ^4GCNGDYE for what channel it actually uses).
Throttling is `lib/rate-limit.ts` (`checkAndRecordAttempt`).
Do not rewrite the notification-code or throttle mechanisms — reuse them as-is.[^5]
The route handler itself (app/api/governance/password/invalidate/route.ts — gate
ordering, input validation, wiring these pieces together) is new code.

^PGG5E7QM [desc:"invalidatePassword() sets passwordHash null and passwordInvalidatedAt instead of a revoked flag; setPassword() clears passwordInvalidatedAt or the host bricks in reset mode", keywords:"invalidatePassword_destroys_hash passwordHash_set_to_null passwordInvalidatedAt_field no_revoked_flag_beside_valid_hash bypassable_credential_risk_of_flag setPassword_clears_passwordInvalidatedAt host_bricked_in_reset_mode_forever api_auth_session_returns_passwordInvalidatedAt UI_explains_why_asking_for_new_password forced_revocation_vs_fresh_install_distinction", ocd:2026-07-13, lmd:2026-08-02]
**`invalidatePassword()` DESTROYS the hash** (sets `passwordHash: null` +
`passwordInvalidatedAt`), it does not set a "revoked" flag beside a still-valid
hash. Every caller reads `passwordHash` without also checking a flag, so a flag
would leave a bypassable credential on disk. `setPassword()` CLEARS
`passwordInvalidatedAt` — else the host is bricked in reset mode (create a
password, log in, be told to create a password, forever). `/api/auth/session`
returns `passwordInvalidatedAt` so the UI can say WHY it is asking (a forced
revocation and a fresh install both present as "no password", and "welcome, pick a
password" is the wrong thing to say to someone whose credential was just revoked).

^7W5OZMHP [desc:"the console gate's authoritative caller list lives in lib/peer-address.mjs's docstring, never restated here; it is a presence factor, not general authorization, and only the code decides, not the IP", keywords:"console_gate_scope_isConsolePeer_callers authoritative_census_lives_in_peer-address_docstring do_not_restate_console_gate_caller_count console_gate_is_a_presence_factor not_a_general_authorization_signal other_routes_usable_from_any_device_on_Tailscale_VPN remote_work_from_a_phone_is_a_feature do_not_copy_loopback_check_to_new_route security_work_done_by_the_code_PIN_not_the_IP IP_only_decides_whether_code_is_issued", ocd:2026-07-13, lmd:2026-08-02]
**Scope of the console gate — read the census at its source, never here.** The
authoritative, categorised list of `isConsolePeer()` callers lives in
`lib/peer-address.mjs`'s own docstring, beside the function. **Do not restate it on this
page** — that is precisely what drifted.[^3]

What is stable and belongs here: the gate is a *presence* factor, **not** a general
authorization signal. Every other route stays usable from any device on the Tailscale VPN,
because remote work from a phone is a feature — do not copy the loopback check to a new route
without the same deliberate ruling. And the security work is done by the **code (the PIN), not
the IP**: the IP only decides whether a code is issued at all.

^UYSYB61D [desc:"the Revoke button and the invalidate-password CLI verb carry zero policy of their own — both only POST and render what the endpoint says, because every route is curl-able", keywords:"RevokePasswordDialog_settings_page_revoke_button aimaestro-governance.sh_invalidate-password_CLI TTY_prompt_never_argv_password two_surfaces_zero_policy every_gate_lives_in_the_endpoint every_route_is_curl-able client_side_check_is_skippable_with_curl not_a_weak_check_it_is_no_check CLI_and_UI_both_just_POST no_policy_duplicated_in_the_client", ocd:2026-07-13, lmd:2026-08-02]
**Two surfaces, zero policy in them** — the settings-page **Revoke** button
(`components/governance/RevokePasswordDialog.tsx`) and the CLI verb
(`aimaestro-governance.sh invalidate-password`, TTY prompt, never argv). Both only
POST and render what the endpoint says. Every gate lives in the endpoint, because
**every route is curl-able**: a check placed in a client is skippable with one
curl, so it is not a weak check, it is no check.

^20GBJU5N [desc:"this page governs the security-model tie-in to network-security-tailscale-bind, peer-address and tailscale-detect plumbing, and the still-open TRDD-9MZQ4T7E general sudo-token successor; MAESTRO login is NOT console-gated", keywords:"governs_security_model_network_perimeter network-security-tailscale-bind_relation tailscale-detect_isAllowedSource peer-address_perimeter_trusted-peer_plumbing TRDD-9MZQ4T7E_open_successor_sudo-token_path general_TTY_to_sudo-token_path_other_strict_routes this_endpoint_self-authenticating_sidesteps_successor MAESTRO_login_is_NOT_console-gated app_api_auth_login_route_no_isConsolePeer_call password-change_half_only_built_of_two_op_rule", ocd:2026-07-13, lmd:2026-08-02]
**Governs / see also:** the project's security model and network perimeter —
[[network-security-tailscale-bind]], plus `lib/tailscale-detect.mjs` (`isAllowedSource`) and
`lib/peer-address.mjs`, which are the perimeter + trusted-peer plumbing this page's
console gate rides on — and the still-open successor **TRDD-9MZQ4T7E** (the general
TTY→sudo-token path for OTHER strict routes — this endpoint sidestepped it by
self-authenticating). **MAESTRO login is NOT console-gated** (`app/api/auth/login/route.ts`
contains no `isConsolePeer` call): §2b scoped the rule to two operations and only the
password-change half was ever built.

## See also

- [[network-security-tailscale-bind]] — the surrounding network model: why the perimeter is the
  network but the gate is identity, and why this op's console check is a deliberate, narrow
  exception rather than the general rule.
- [[env-var-security-delete-not-gate]] — cites this page's `x-forwarded-for` can't-trust-client-
  headers lesson as a sibling case of "the client controls what it sends, so the server can't
  trust it without independent verification".

## Notes and lessons learned

[^1]: [id:ATOM-XFF-SPOOFABLE-PEER-IP, status:valid, keywords:"x-forwarded-for_spoofable client_sets_headers_not_trustworthy loopback_check_defeated_by_vpn re-stamp_from_socket_remoteAddress dual_stack_ffff_127_0_0_1_console_peer", ocd:2026-07-13, lmd:2026-07-13] **A route CANNOT trust `x-forwarded-for` /
  `x-real-ip` for a security decision — the client sets them.** A route handler
  gets a `Request`, never a socket, and every existing route in this repo reads the
  client IP from those headers. A phone on the VPN sends `X-Forwarded-For:
  127.0.0.1` and defeats any naive loopback check. FIX: `server.mjs` — the one
  place that can see the real TCP peer — **DELETES any inbound `x-aim-peer` and
  re-stamps it from `req.socket.remoteAddress`** at the top of the request handler;
  `lib/peer-address.mjs` is the ONLY sanctioned reader. We are behind no proxy
  (localhost + Tailscale direct), so the socket address IS the client address. A
  test asserts the *delete itself*, because without it the spoof test still passes
  while the system is wide open. VERIFY the spoof from a genuinely REMOTE peer (this
  host's own Tailscale IP) — curling from loopback proves nothing (the peer really
  is 127.0.0.1, so it 401s either way); only a remote source turns the forged
  `X-Forwarded-For: 127.0.0.1` into a real test (it must still 403). Also:
  `isConsolePeer` must accept `::ffff:127.0.0.1` — the Tailscale `::` bind is
  dual-stack and Node reports an IPv4 client in that v4-mapped form; miss it and the
  owner is denied at their own keyboard.

[^2]: [id:ATOM-SERVER-MJS-CANNOT-IMPORT-TS, status:valid, keywords:"server.mjs_crashes_importing_ts pm2_crash_loop_errored tsx_only_transpiles_entry_file lib_shared_modules_must_be_mjs SyntaxError_does_not_provide_export", ocd:2026-07-13, lmd:2026-07-13] **`server.mjs` CANNOT import a `.ts` module —
  it crashes at boot** with `SyntaxError: The requested module './lib/foo' does not
  provide an export named 'X'`, and pm2 crash-loops (`errored`, dozens of restarts).
  `package.json` runs `tsx server.mjs`, which tempts you to think `.ts` imports
  resolve — they do not, for `server.mjs`'s own top-level imports. The convention was
  already visible: EVERY server-shared module in `lib/` is `.mjs`
  (`hosts-config-server.mjs`, `ecosystem-state-paths.mjs`), and TS files import THOSE
  happily (`lib/messageQueue.ts`). Lesson: a shared module that `server.mjs` must
  import is `.mjs` with JSDoc types, consumed by both worlds. The convention was the
  evidence; "but tsx runs it" was a guess that took the server down. ALWAYS restart
  pm2 and curl a route after touching `server.mjs`'s imports — a green `tsc` does not
  prove the server boots.

[^3]: [id:ATOM-CONSOLE-CENSUS, status:valid, keywords:"console gate gates exactly two operations isConsolePeer callers miscounted maestro login console-gated", ocd:2026-08-02, lmd:2026-08-02]
  DO NOT state how many operations the console gate binds anywhere but beside
  `isConsolePeer()` itself, BECAUSE this page asserted **"TWO operations, nothing else …
  gates MAESTRO login and MAESTRO password-change ONLY"** and both halves were false:
  `grep -rn isConsolePeer app lib` finds **five** call sites (`settings/edit`,
  `statusline/ingest`, `password/reset`, `password/invalidate`,
  `oauth-rotator/reauth-guard`) and **`app/api/auth/login/route.ts` contains none** — the
  one operation the sentence named first is the one that never had the gate. The page even
  contradicted itself, saying "MAESTRO login is not yet console-gated" fifteen lines lower.
  ROOT CAUSE: a count copied out of the spec (§2b) and then never re-derived while the code
  grew, in a second location that nothing checks. `lib/peer-address.mjs`'s docstring had
  ALREADY been corrected for exactly this and says so in its own words — *"previously read
  'it gates exactly two operations … and nothing else', which had been false since the third
  caller landed. A comment that miscounts its own callers is worse than none"* — so the
  correction existed and this copy never received it. DO link to the source and re-derive
  with a grep. Corrected 2026-08-02.
[^4]: [id: ATOM-GY0P-77IF, status: valid, supersedes: T9Y6WNNW, keywords: "leaked_password_still_valid_before_invalidation window_before_invalidatePassword_runs old_password_works_until_second_POST verifyPassword_does_not_revoke_credential invalidate_route_race_window no_known_replacement_value_issued credential_destroyed_not_swapped two_POST_flow_timing_gap password_still_active_between_calls step_one_never_changes_which_password_is_valid", ocd: 2026-09-24, lmd: 2026-09-24] DO NOT state the invalidate flow leaves 'no window in which a leaked password is still live', BECAUSE the OLD password remains fully valid for login between the first POST (verifyPassword succeeds, a code is dispatched) and the second POST that actually calls invalidatePassword() — step 1 never changes WHICH password is valid (the POST handler in app/api/governance/password/invalidate/route.ts calls verifyPassword, not invalidatePassword, in lib/governance.ts). DO state the narrower, true guarantee instead: invalidatePassword() DESTROYS the hash rather than replacing it with a new known value, so no replacement credential is ever issued that could itself leak; the leaked password stays valid until invalidation actually runs at step two. SUPERSEDED BODY: **The flow — two POSTs to the same route:** 1. `{ password }` → the server verifies possession, dispatches a one-shot CODE to this machine's desktop, replies `{ codeRequired, channel, hint }` — **the code is NOT in the response.** 2. `{ password, code }` → verified ⇒ `invalidatePassword()` runs ⇒ `{ invalidated }`. Next login then asks the user to CREATE a new password. The credential is never replaced with a known value, so there is no window in which a leaked password is still live.
[^5]: [id: ATOM-X7G7-6N3J, status: valid, supersedes: D3ZBD6TJ, keywords: "route_handler_is_new_code only_mechanisms_reused_not_whole_feature do_not_overclaim_zero_new_code notification_code_reused_not_new throttle_reused_not_new invalidate_route_is_new_wiring gate_ordering_written_for_this_endpoint reuse_means_the_mechanism_not_the_route setup-bootstrap_reused_route_is_not rate-limit_reused_route_is_not", ocd: 2026-09-24, lmd: 2026-09-24] DO NOT say the invalidate flow required 'no new code written', BECAUSE the route handler itself (app/api/governance/password/invalidate/route.ts) IS new code — gate ordering, input validation, throttle key construction, and wiring the reused pieces together were all written for this endpoint. Only two MECHANISMS are reused, not rewritten: the OS-notification code (lib/setup-bootstrap.ts startSetupFlow/verifySetupCode) and the rate limiter (lib/rate-limit.ts checkAndRecordAttempt). DO say those two mechanisms are reused, and stop short of claiming the feature itself needed no new code. SUPERSEDED BODY: **Reuse, not reinvention:** the code mechanism is `lib/setup-bootstrap.ts` (`startSetupFlow` / `verifySetupCode`, SEC-PHASE-6) — the SAME OS-notification code that first-run setup uses (hashed record, timing-safe compare, one-shot consume, attempt cap). Throttling is `lib/rate-limit.ts` (`checkAndRecordAttempt`). Do not write new notification or throttle code — these already exist.
[^6]: [id: ATOM-4LJ7-4YCA, status: valid, supersedes: 4GCNGDYE, keywords: "code_delivered_via_local_file_not_notification setup-code.txt_0600_file_is_the_reliable_channel notification_is_best-effort_only daemonized_server_has_no_GUI_session dispatchCode_also_has_an_email_channel invalidate_route_does_not_pass_email_opt startSetupFlow_no_opts_in_invalidate_route osascript_notify-send_silently_stranded_headless channel_claim_was_imprecise file_channel_not_notification_channel", ocd: 2026-09-24, lmd: 2026-09-24] DO NOT say the code 'rides the host OS's own notification channel, never HTTP' as the mechanism, BECAUSE lib/setup-bootstrap.ts's dispatchCode() writes the code unconditionally to a local file (~/.aimaestro/setup-code.txt) FIRST — that is the reliable channel — then best-effort chmods it to 0600 (try/catch-wrapped; a pre-existing file with looser permissions keeps them if it fails) — and only attempts a desktop notification as a best-effort convenience on top (a daemonized pm2/launchd/systemd process has no GUI session, so osascript/notify-send report success while the banner never appears). dispatchCode() also supports an EMAIL channel to a registered remote address for OTHER callers that pass an email option — the invalidate route (its POST handler in app/api/governance/password/invalidate/route.ts, calling startSetupFlow()) does NOT pass one, so for THIS route specifically no code ever leaves the host. DO describe the channel as 'a local file on the host (write unconditional; chmod 0600 best-effort), plus a best-effort desktop notification — never HTTP for this route (it does not opt into the email channel)'. SUPERSEDED BODY: **Two factors, because possession alone must not rotate the master credential:** - the **password** proves you KNOW the secret; - a **code on the desktop** proves you are AT the machine. It rides the host OS's own notification channel (macOS/Linux/Windows), never HTTP. An attacker holding the password but not sitting at the console cannot read it. **That is the whole security property** — the moment the code travels over HTTP, the feature is theater.
