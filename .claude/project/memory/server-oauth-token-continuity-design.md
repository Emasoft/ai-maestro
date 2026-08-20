---
name: server-oauth-token-continuity-design
description: "how does the ai-maestro server keep agents running across OAuth/API token expiry — rotate / refresh / reauth; does the model or an agent EVER see the token; where is the token stored (keychain); how does the 3-tier fallback cascade work; the R16 token-handling design that was USER-signed-off; why did the rotator NOT rotate an expiring token / DRAIN-GUARD or HOLDING in the log / rotator-stuck:drain-guard-hold / is the rotator stalled or is it refusing on purpose / it rotated off an account that still had headroom / the alert says 'rotation is effectively OFF' or 'the 60s rotator tick has not COMPLETED for N seconds' but the tick is running fine / tick-stalled false alarm / tick-completed.ts stamp frozen for days / an alert reading a stamp the server-side lane never writes"
ocd: 2026-07-16
lmd: 2026-08-20
metadata:
  node_type: memory
  type: project
  tier: component
  topic: reliability-patterns
publish-globally: false
---

The ai-maestro server absorbs the janitor's continuity daemon (Family A) — including OAuth
token rotation — so agents keep running through token expiry with no manual step. The R16
token-handling design was **USER-signed-off on 2026-07-16** (all four decisions D1–D4).

**Authoritative source (read it before implementing):** `TRDD-H24DF6ZC` (signed-off design,
commit `da9c8100`), NPT of parent `TRDD-KCRMSNL7` (Family-A server absorption). The
token-touching implementation is `KCRMSNL7 #2` (OAuth manager) + `#3` (account switcher) —
build to THIS signed design, do not re-derive it.

**The four load-bearing invariants (why they are what they are — the whole point of R16):**

- **D1 — token is infrastructure-only.** Models/agents NEVER read or write the token; the
  daemon (now a SERVER function) does. The 3 ops (rotate/refresh/reauth) run as a **DETACHED,
  MODEL-FREE headless-browser process** (dev-browser / puppeteer / playwright) so the token
  never enters any transcript. The ONLY agent-reachable surface is
  `aimaestro-continuity.sh status` → exactly 5 metadata fields (account_healthy,
  window_5h_pct, window_7d_pct, cache_ttl_minutes, next_action), CI-guarded so a 6th
  token-adjacent field can never be added.
- **D2 — encrypted at rest in the OS keychain ONLY.** Never a plaintext token file. Any
  on-disk index holds metadata only (account, plan, window regime, last-rotated ts).
- **D3 — TWO DISTINCT locks, do not conflate them.** (a) The write-coordination **mutex** =
  the daemon's EXACT tested machine-wide lock; the server takes the SAME lock, never invents a
  second one. (b) **NEVER programmatically lock/unlock the macOS keychain itself** — it
  auto-locks (OS-managed); access keychain ITEMS only, never the lock STATE. Follow the
  daemon's proven keychain-ACCESS path (it already solved the daemon-can't-read-login-keychain
  inheritance trap). See [[macos-keychain-locking]] and [[macos-keychain-access-inheritance]].
- **D4 — the cascade is a 3-tier PROGRESSIVE fallback.** ROTATE (auto, uses refresh_token) →
  on failure REFRESH (auto, headless browser + persisted claude.ai session COOKIE) → on
  failure REAUTH (**the ONLY human step** — a human login for a new cookie, surfaced as a
  `/login` desktop nudge via the OS presence channel `lib/setup-bootstrap.ts`). Session-only:
  **no account password is stored** — the human re-login IS the reauth.

**AgentlensPro is OUT of the trust boundary** (verified in `accountInfo.ts`): observe-only,
emits no token, has no rotation. The server reads account/window/cache METADATA from it to
compute `status`; custody + rotation are this server's infra alone.

**Concrete keychain/lock posture to MATCH (janitor#100 Q5 — the exact tested path the server
must replicate, so server + `#N` daemon coordinate not fight):**
- LIVE credential = macOS keychain `service="Claude Code-credentials"`, account=`<macOS user>`,
  owned/written by Claude Code itself; rotation writes a slot back into it (`write_live_blob` —
  the ONE irreversible op; a bug locks the owner out of Claude Code).
- Slots = keychain `service="Claude Code-rotator-slot"` + `"Claude Code-rotator-slot-mirror"`
  (corruption-recovery copy), via `safe_storage` (macOS `security`, Linux libsecret `secret-tool`,
  Windows DPAPI). `state.json` index = non-secret metadata only.
- Fail-closed: locked/declined keychain REFUSES the write, no plaintext fallback except
  `NO_BACKEND`; a keychain-denied latch (circuit breaker) survives one transient lock.
- One writer = the janitor's machine-wide `daemon.flock` — the server takes the SAME lock, and
  the exact lock-FILE PATH is in the janitor repo (`oauth_rotator/`/`daemon.py`): a CROSS-REPO
  item to obtain, never guessed. See [[family-a-continuity-absorption-plan]] (NPT 1GGQ4HWY).

^ATOM-S7SH-7ZQO [desc:"the rotator can DELIBERATELY refuse a rotation and log DRAIN-GUARD / HOLDING — that is not a stall, do not fix it", keywords: rotator_refuses_to_rotate DRAIN-GUARD_in_the_log HOLDING_not_rotating rotator_stuck_drain-guard-hold is_the_rotator_stalled why_did_it_not_rotate_an_expiring_token rotated_off_an_account_that_still_had_headroom, ocd: 2026-08-02, lmd: 2026-08-02]

The rotator can DELIBERATELY decline a rotation it has already computed as needed, logging
`DRAIN-GUARD` (tick) / `HOLDING` (beat). That is not a stall — do not "fix" it.

`drainsLastEscapeHatch` (`lib/oauth-rotator/tick.ts`) refuses exactly one trade: the ONLY reason to
rotate is the live token's LOCAL EXPIRY, the account is still low-usage (below SAFE on every window
including the model-scoped one), and rotating would leave ZERO usage-confirmed spares. On 2026-08-01
the rotator rotated off an account at 9%/38% for expiry alone; when the target maxed out the
abandoned account's stored credential had rotted (10.9 days expired, 69 failed refreshes). The
account had headroom the whole time — the rotator's COPY OF THE KEY was dead.

It is safe because it is only reachable after `/usage` returned 200 USING THE LIVE TOKEN, so the
expiry is a PREDICTION, not an observation. A token that has really died answers 401 — a branch the
guard never applies to — so rotation happens within one 60 s tick.

It counts USAGE-CONFIRMED candidates ONLY, never the `degraded` bucket: "not provably dead" is not
"healthy", and a paper spare that was dead in fact is the incident.

The hold is REPORTED, not silent (`StuckReason: drain-guard-hold` → `rotator-stuck:drain-guard-hold`),
because `surveyAlternates` skips the LIVE account and the beat would otherwise render a fleet one
credential from lockout as `nextAction: ok`.


^ATOM-UEW8-1AVJ [desc:"A tick-stalled alert can be a FALSE alarm: it reads a stamp the janitor daemon writes, and the server-side lane never writes it.", keywords: rotation_is_effectively_OFF tick-stalled the_60s_rotator_tick_has_not_COMPLETED rotator_alert_says_stalled_but_it_is_ticking alert_reads_a_stamp_the_server_never_writes false_stall_alarm tick-completed.ts_frozen, ocd: 2026-08-07, lmd: 2026-08-07]

The `tick-stalled` alert reads the janitor's `tick-completed.ts` stamp in the shared plugin
DATA dir. The SERVER-side rotator lane never writes that file, and the janitor daemon EXITS
while a server owns the host — so on any server-owned host the stamp freezes at the moment
the daemon last ran, and the alert fires forever claiming `rotation is effectively OFF`.

MEASURED 2026-08-07: the alert claimed `has not COMPLETED for 368930s` while the server tick
was completing every 60s — 214 consecutive minute-spaced log lines over 3.6h. The stamp read
2026-08-02 20:55:55; its age at the 03:24:45 alert was 368930s, matching the alert TO THE
SECOND. That exact match is what proves the attribution rather than merely suggesting it.

WHY IT MATTERS BEYOND THE NOISE: this alert asserts the exact OPPOSITE of the truth on the
channel that matters most, ~every 10 min forever. It sat alongside a REAL alert in the same
minute (`reauth-needed`: a dead refresh only a human login can fix), so the false one trains
the reader to discount the channel that was right.

DO NOT diagnose a rotator stall from this alert alone. Count the lane's own 60s tick lines,
or read `lastAbsorbedRunAt`/the tick log. A stamp written by a DIFFERENT process than the one
you are judging is not evidence about that process.

Sibling: ATOM-S7SH-7ZQO covers the opposite error — a DELIBERATE DRAIN-GUARD/HOLDING refusal
mistaken for a stall. Both failures are "the rotator looks stuck and is not".

^ATOM-3XXL-4KCV [desc:"A captcha on claude.ai/oauth/authorize does NOT shorten unattended runtime: the ~8h renew is a browserless refresh_token POST to a different host; only the rare SEED touches that screen.", keywords: captcha_on_the_authorize_screen oauth_authorize_captcha does_a_captcha_break_continuity can_the_fleet_still_run_unattended refresh_token_grant_is_browserless seed_versus_renew_leg platform.claude.com_token_endpoint, ocd: 2026-08-07, lmd: 2026-08-07]

**A captcha on the claude.ai authorize screen does NOT break unattended continuity** — measured
2026-08-07, when one appeared for the first time and looked like it would cut runtime from the
~28-day cookie lifetime to the ~8-hour token lifetime.

Two legs, two grants, two HOSTS:

- **RENEW** (every ~8h, unattended, what actually keeps the fleet alive) — `grant_type=refresh_token`,
  a plain `urllib` POST in the janitor's `rotator.py::_keepalive_refresh`, to
  `platform.claude.com/v1/oauth/token`. **No browser is involved at any point**, so it can never
  meet a captcha.
- **SEED / re-seed** (rare) — `grant_type=authorization_code`, Playwright/Chrome drives
  `claude.ai/oauth/authorize` in `slot_capture_browser.py`. **The captcha is here**, and this path
  already required a human (`CLAUDE_ROTATOR_AUTO_BOOTSTRAP` defaults OFF, and the login challenge is
  an OS-level passkey/2FA prompt no automation can satisfy).

**The positive control is what settles it:** a slot whose `captured` date is WEEKS old while its
`token-expiry` is a live ~7h has been carried entirely by the browserless chain. On the measured
day that was 15 days / ~45 refresh cycles with zero authorize-screen visits. Check it with
`rotator.py list` — an old `captured` beside a fresh `token-expiry` IS the proof.

**The real exposure is one layer down, and it is quieter:** `_keepalive_refresh` returns `None` on
ANY error, Cloudflare included — and that token endpoint is itself behind Cloudflare (the code
carries a hand-picked `User-Agent: claude-account-rotator` precisely because urllib's default is
1010-banned). A tightening there would kill the only unattended path SILENTLY. Filed as
janitor#228; see [[oauth-rotation-renew-reauth]].

^ATOM-2HN8-H8OR [desc:"A dead OAuth refresh is evidence about rung 1 and NOTHING else — a live cookie mints a new one with no human. The correct cookie-aware code exists in ai-maestro and has ZERO production callers.", keywords: a_human_must_re-login_but_the_account_is_fine false_reauth_alert dead_refresh_does_not_mean_a_human_is_needed why_does_it_keep_saying_re-login cascade.ts_is_never_called cookie-vault_has_no_callers the_fix_exists_but_nothing_calls_it, ocd: 2026-08-07, lmd: 2026-08-07]

**`refresh-dead` does not mean a human is required** — it means rung 1 of the ROTATE → RENEW →
REAUTHENTICATE cascade is exhausted, and nothing more. Rung 2 mints a fresh refresh from a live
claude.ai session COOKIE with no human at all, and that cookie layer lives in the janitor's
keychain where the ai-maestro process cannot see it. So a dead refresh is evidence about the OAuth
rung and about NOTHING ELSE. See [^1] (`ATOM-R16D-CASC`) for the cascade itself.

**Measured 2026-08-07:** of two slots the tick reported as needing a human, one held a healthy
cookie and minted itself unattended; only the other had genuinely lapsed. Right about one of two,
stated with equal confidence. The same phrase had already been logged **4 506 times over 4 days**
(`alert-delivery.ts:10`) — a false alarm at that frequency stops being read at all, which is the
actual damage.

**THE TRAP, and the reason this took hours to see:** ai-maestro DOES implement the cookie rung,
correctly, with tests. `lib/oauth-rotator/cascade.ts` has the full 3-rung cascade including
`RENEW_COOKIE`, added by TRDD-J9TM3WQK *specifically* to stop the jump straight to REAUTH. And it
has **zero production callers** — as does `lib/oauth-rotator/cookie-vault.ts`, all 11 exports.
Measured against a 19-caller control so a broken search could not produce the same zero. The LIVE
path re-derives the taxonomy inline in `tick.ts` and never consults a cookie.

**A fix that lands in an uncalled module is indistinguishable from one that lands in a live
module**, because the tests call the module directly and pass either way. J9TM3WQK's fix is real,
correct, and inert — and the two copies had already drifted 3× apart on constants.

**Do NOT repair this by teaching `tick.ts` to read cookies** — that is a THIRD copy of a taxonomy
the janitor already owns and runs correctly. The fix applied instead (commit `5c5f7cee`) was to
stop the message asserting what the process cannot know: it now names the observed fact (the OAuth
rung is dead) and points at the rung it cannot see. Whether to delete the two dead modules is still
open — TRDD-XV9BLQC5.

^ATOM-QCOD-IPRR [desc:"agentlenspro window rows carry NO account identity — attribute ONLY by exact 5h-reset cohort match; no cohort means emit nothing", keywords: agentlens_rows_wrong_account statusline-history_windows_two_accounts_side_by_side usage_misattribution_rotator agentlenspro_cohort_match resets_5h_attribution_key, ocd: 2026-08-08, lmd: 2026-08-08]

`agentlenspro statusline-history windows --json` rows carry NO account identity, and a live
measurement (2026-08-08) showed two accounts' rows side by side. The rotator's second usage
source (`lib/oauth-rotator/agentlens-usage.ts`, TRDD-SLSSUIQ8) therefore attributes a row to the
live account ONLY on an exact `row.resets_5h === WindowSnapshot.fiveHourResetsAtSec` cohort
match (the persisted 5h reset instant from the last endpoint probe), plus `row.ts >=
last_switch_at * 1000` (seconds→ms — the admitSnapshot unit trap). No known cohort ⇒ EMPTY
output, never a guess: timestamp-only attribution hands the rotator another account's numbers —
the account-burning loop `statusline-admissible.ts` exists to prevent.

^ATOM-U9NL-KBA1 [desc:"gate the agentlens CLI read on the cohort BEFORE spawning — no cohort means the output is discarded by construction", keywords: unit_test_suddenly_slow_timeout statuslineNear_spawns_real_CLI subprocess_spawn_per_call_in_tests cohort_gate_before_read, ocd: 2026-08-08, lmd: 2026-08-08]

The agentlens read in `statuslineNear` is gated on the cohort BEFORE the CLI spawn (77fbe88e):
with no persisted cohort the mapper drops every row by construction, so an unconditional read
spawns a subprocess whose output is definitionally discarded — and any test driving
`statuslineNear` without injecting `readAgentlensRows` spawns the REAL `agentlenspro` per call
(measured: the disjunct suite went 24.5s with a 5s per-test timeout; 0.36s after the gate).
Suites about the store source stub `readAgentlensRows: async () => []` explicitly.

## See also

- [[model-scoped-window-fallback]] — the other half of "the fleet cannot make requests". This page
  is about the TOKEN (rotate / refresh / reauth); that one is about a MODEL's window being spent
  while the token is perfectly good, where rotating the credential is the expensive wrong answer.
  Read it before changing `isSafeAlternate`: that predicate is what turns a model-scoped max into
  a fleet-wide eviction.

## Notes and lessons learned
[^1]: [id:ATOM-R16D-CASC, status:valid, keywords:"rotate_refresh_reauth cascade progressive_fallback the_only_human_step reauth_needs_new_cookie", ocd:2026-07-16, lmd:2026-07-16]
  DO NOT treat rotate/refresh/reauth as three interchangeable "renew" ops, BECAUSE they are an
  ORDERED progressive fallback keyed on WHY the cheaper step failed: ROTATE fails→needs a new
  OAuth token→REFRESH; REFRESH fails→needs a new cookie→REAUTH. DO make REAUTH the ONLY human
  step and keep ROTATE+REFRESH fully automated.
[^2]: [id:ATOM-R16D-KCLK, status:valid, keywords:"keychain_lock write_mutex never_lock_keychain SecKeychainUnlock daemon_lock", ocd:2026-07-16, lmd:2026-07-16]
  DO NOT lock/unlock the macOS keychain to coordinate credential writes, BECAUSE the D3 lock is
  a machine-wide WRITE MUTEX (copy the daemon's tested one), NOT the OS keychain lock — the
  keychain auto-locks and `SecKeychainUnlock` on an already-unlocked keychain false-succeeds. DO
  access keychain ITEMS only and leave the keychain lock STATE to the OS.
