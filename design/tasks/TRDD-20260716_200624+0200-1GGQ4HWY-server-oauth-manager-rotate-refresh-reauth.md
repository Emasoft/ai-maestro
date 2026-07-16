---
trdd-id: 1GGQ4HWY
title: Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)
column: dev
created: 2026-07-16T20:06:24+0200
updated: 2026-07-17T00:02:00+0200
current-owner: ai-maestro
task-type: security
scope: project
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T19:21:48+0200
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, oauth, keychain, credentials, security, npt, token-touching, daemon-port]
external-refs: [Emasoft/ai-maestro-janitor#100, Emasoft/ai-maestro-janitor#82]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [ddec060f, 59ebd182]
---

# Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**▶ REFRAMED by the USER (2026-07-16): REPLACE the janitor daemon — don't coordinate with it.**
Verbatim: *"look at the janitor source code for the daemon and convert the code into typescript as
an ai-maestro server function … reproduced internally as part of the ai-maestro server api."* So
this NPT is a FAITHFUL Python→TS PORT of the janitor's OAuth-rotation subsystem
(`scripts/oauth_rotator/*.py` + `daemon.py`, ~7000 lines) into `lib/oauth-rotator/` + a
server-internal tick. The server BECOMES the rotation writer; it is NOT a detector that delegates
to the external daemon.

**This DISSOLVES the old "blocked on the janitor's flock-path" gate.** The lock path is IN the
source: `global_state.oauth_rotator_lock()` → `<DATA>/global-state/oauth-rotator.lock`
(DATA = `~/.claude/plugins/data/ai-maestro-janitor-ai-maestro-plugins/`). [[TRDD-H24DF6ZC]]-D3
("take the daemon's EXACT tested lock") is SATISFIED by reading that path from source — the
CROSS-REPO ASK on janitor#100 is no longer needed. The server takes the SAME machine-wide flock so
it and any residual janitor `#N` fallback-when-no-server stay mutually-exclusive writers by
construction. The other three H24DF6ZC invariants (D1 detached/model-free — the Node server is not
a Claude context; D2 keychain-only; D4 the 3-tier cascade) still hold — the port satisfies them.

**Architecture map (3-model ensemble, the porting spec):**
`reports/llm-externalizer/20260716_233614+0200-code_task-cascade.py-6a8fb7.md` — per-file roles,
the exact ROTATE/RENEW/REAUTH control flow, keychain custody (`security` argv rules), the ONE live
write, the lock, and the state.json schema.

**Phasing (safest-first; the live write is LAST + owner-aware):**
- **A ✅ DONE (`ddec060f`)** — `lib/oauth-rotator/cascade.ts`: pure ROTATE/RENEW/REAUTH classifier
  (faithful port of `cascade.py`), 19 unit tests, tsc + next-lint clean. Zero credential risk.
- **B ✅ DONE (`59ebd182`)** — `lib/oauth-rotator/safe-storage.ts` (full port of `safe_storage.py`)
  + `lib/oauth-rotator/global-state.ts` (the `global_state_dir()` ladder): macOS `security` /
  Linux libsecret / Win DPAPI + keychain-denied latch (half-open recovery), `runSecurity`
  choke-point, base64-wrap, three-valued OK/NO_BACKEND/FAILED, fail-closed. 17 tests, tsc+lint
  clean. PRESERVED: ACL only on CREATE, secret on argv (stdin truncates at 128B), never log a token.
- **C** — machine-wide flock at `<DATA>/global-state/`**`oauth-rotator-tick.lock`** (port
  `global_state.oauth_rotator_lock`/`acquire_oauth_rotator_lock`). ⚠ The file is
  **`oauth-rotator-tick.lock`**, NOT `oauth-rotator.lock` (the LLM map guessed wrong; the real name
  is in `global_state.py` `_MIGRATION_SKIP`) — a wrong name = two live-cred writers. Extend
  `global-state.ts` with the flock; mutual-exclusion with any janitor `#N` fallback.
- **D** — slot writes + `-backup`/`-livebak` mirrors (rotator-owned, reversible; LOW risk).
- **E** — THE LIVE WRITE: `write_live_blob` + `_switch_blob` (ROTATE) + `_keepalive_refresh`
  (RENEW). **R16 — checkpoint with the OWNER before it first runs live.** Safety net = the
  `-livebak` mirror (refreshed from the CURRENT live at tick start, so it holds the previous
  credential); validate the alternate (usage probe + local-expiry) BEFORE the switch.
- **F** — REAUTH + bootstrap browser tier (`reauth.py`/`slot_capture_browser.py`/`cookie_vault.py`
  via Node CDP/tmux) — the "only human step".
- **G** — the 60s `cmd_tick` as a server-internal task, **config-gated OFF by default**; feeds
  [[DXJZM3BW]]'s `next_action` (cascade states: ok | rotating | reauth-needed).

**NEXT ACTION:** Phase C — read `global_state.py::acquire_oauth_rotator_lock` (the flock impl),
then extend `lib/oauth-rotator/global-state.ts` with a mutual-exclusion flock on
`<globalStateDir>/oauth-rotator-tick.lock` (Node `fs`/`flock` via a lockfile or `proper-lockfile`
equiv). No live write yet.

## Problem / Goal

Keep agents running through OAuth token expiry with no manual step, while NEVER letting any
model/agent read or write the token. This NPT is the server-side infrastructure that DETECTS
token expiry and runs the continuity cascade. It is the highest-risk item in Family-A: a wrong
write corrupts the live credential.

## Build to the four SIGNED invariants of [[TRDD-H24DF6ZC]] (do not re-derive)

- **D1 — detached, model-free INFRA.** The cascade runs as a **standalone detached process
  spawned by the server** (Node/puppeteer/dev-browser), NOT inside any Claude/agent context, so
  the token never enters a transcript. It VALIDATES the new credential with a probe call and
  BACKS UP the last-known-good BEFORE overwriting. The only agent-reachable surface is
  [[DXJZM3BW]]'s 5-field `status` — this manager supplies `next_action`.
- **D2 — keychain-only, no plaintext.** Live credential = the OS-managed `Claude Code-credentials`
  keychain item; the rotator spare + mirror go through platform `safe_storage`. Any on-disk index
  holds **metadata only** (account, plan, window regime, last-rotated ts).
- **D3 — TWO DISTINCT locks.** (a) Take the **daemon's EXACT tested machine-wide write mutex**
  (`daemon.flock` equivalent) — do NOT invent a second lock; it is shared with the `#N` daemon and
  makes concurrent credential writes impossible by construction. (b) NEVER call
  `SecKeychainLock`/`Unlock` — the OS auto-locks; access keychain ITEMS only, never the lock STATE.
  Follow the daemon's proven keychain-ACCESS path (it already solved the long-running-process
  login-keychain inheritance trap).
- **D4 — the 3-tier PROGRESSIVE cascade.** ROTATE (auto, `refresh_token` → new access token) →
  on failure REFRESH (auto, headless browser + persisted claude.ai session COOKIE → new OAuth
  token) → on failure REAUTH (**the only human step** — a `/login` desktop nudge via
  `lib/setup-bootstrap.ts`; no account password stored — the human re-login IS the reauth).
  Steps 1-2 hold the D3 mutex for the write and validate-then-backup before overwriting (D2).

## Scope (net-new — server-side OAuth rotation does NOT exist today)

- The detached cascade runner (rotate/refresh/reauth) + probe-validate + validate-then-backup.
- Keychain read/write via the daemon's tested access path; the machine-wide write mutex acquire/
  release ordering shared with `#N`.
- The `next_action` computation feeding [[DXJZM3BW]]'s `status` (e.g. `ok | rotating | reauth-needed`).
- The `/login` REAUTH nudge (reuse `lib/setup-bootstrap.ts` presence channel).

## The janitor's EXACT tested posture to MATCH (janitor#100 Q5 — the concrete keychain/lock spec)

D3 says "take the daemon's EXACT tested lock; follow its proven keychain-ACCESS path." Here is
that path, from janitor#100 Q5 — the server (Node) must replicate this posture the janitor
daemon (Python) uses, so the two coordinate rather than fight:

- **LIVE credential** = macOS keychain item `service="Claude Code-credentials"`, account=`<macOS
  user>` — **owned and written by Claude Code itself**. The manager CAPTURES it after a
  `/login` and, on rotation, WRITES the chosen slot back into that SAME item (the daemon's
  `write_live_blob`). This is the ONE irreversible write — a bug here corrupts the owner's live
  Claude login and locks them out. It cannot be end-to-end tested without risking the live
  credential, so it needs validate-then-backup (below) and the owner's awareness before it
  first runs live.
- **Slots** (N-subscription backups) = keychain items `service="Claude Code-rotator-slot"`
  **plus** `service="Claude Code-rotator-slot-mirror"` (a redundant copy for corruption
  recovery), encrypted at rest by `safe_storage`: macOS `security add/find-generic-password`,
  Linux libsecret (`secret-tool`), Windows DPAPI. A `state.json` index holds ONLY non-secret
  metadata (emails, expiry, refresh-failure counts) — never token material.
- **Fail-closed:** a present-but-locked/declined keychain REFUSES the write; the caller fails
  closed with NO plaintext fallback. Plaintext is legitimate ONLY on a machine with no secret
  store at all (`NO_BACKEND`), and even then must never silently drop a secret. A
  **keychain-denied latch (circuit breaker)** keeps one transient lock from killing rotation
  permanently.
- **One writer, machine-wide:** the server takes the SAME machine-wide lock the `#N` daemon
  uses (the `daemon.flock` equivalent) — NOT a second lock. The exact lock-FILE PATH lives in
  the janitor's codebase (`oauth_rotator/` / `daemon.py`); it is a **cross-repo coordination
  item** — get it from the janitor (do NOT guess a path, or the two owners could both write the
  live credential and corrupt it). Never touch the OS keychain LOCK state (D3b).
- **Cascade wording match:** the daemon's is ROTATE (swap to a safe alternate slot) → RENEW
  (refresh the slot's OAuth token) → REAUTH (human `/login`). This TRDD's H24DF6ZC cascade
  (ROTATE→REFRESH→REAUTH) is the same; REFRESH == the daemon's RENEW.

## Open issue this NPT must honor (likely spawns an EHT)

- **janitor#82** — the oauth_rotator's keychain reads of `Claude Code-credentials` RE-PROMPT
  after every access (a login-keychain inheritance defect). This manager must NOT inherit that
  behavior; if fixing it cleanly needs a separate change, register it as an EHT of this NPT
  (sibling under [[KCRMSNL7]], depth-1 — NOT a child of this file).

## Verification

- The cascade never surfaces token material in any log/transcript (grep the detached process
  output + the `status` verb for token-shaped strings — must be clean).
- Concurrent-write test: the server and a simulated `#N` holder cannot both write (mutex proven
  mutually exclusive, not merely unlikely).
- ROTATE→REFRESH escalation fires only on the specific failure reason; REAUTH surfaces the nudge
  and stops (never automates re-auth with stored material).
- validate-then-backup: a failed probe never overwrites the last-known-good.

## Approval log

- 2026-07-16T19:21:48+0200 — **MANDATE (mandated-by: user).** The USER mandated the Family-A
  absorption "including the oauth key rotations" and signed off [[TRDD-H24DF6ZC]] D1-D4, which
  explicitly UNBLOCKED this NPT (#2 OAuth manager). Authored directly as `planned`; no approval
  round-trip — the issuer's authority (user) meets the floor (`min-approval-requirement: user`).
- 2026-07-16T23:48:00+0200 — **REFRAME (mandated-by: user).** The USER corrected the approach:
  REPLACE the janitor daemon by PORTING its source Python→TS as an internal server function, not
  coordinate/authenticate with it. Same tier/mandate (user); this narrows the implementation to a
  faithful port and dissolves the janitor#100 lock-path dependency (path read from source). Moved
  `planned → dev`; Phase A (cascade port) landed as `ddec060f`.
