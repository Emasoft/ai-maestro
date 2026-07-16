---
name: server-oauth-token-continuity-design
description: "how does the ai-maestro server keep agents running across OAuth/API token expiry — rotate / refresh / reauth; does the model or an agent EVER see the token; where is the token stored (keychain); how does the 3-tier fallback cascade work; the R16 token-handling design that was USER-signed-off"
ocd: 2026-07-16
lmd: 2026-07-16
metadata:
  node_type: memory
  type: project
  tier: component
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
