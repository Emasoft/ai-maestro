---
trdd-id: 1GGQ4HWY
title: Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)
column: blocked
pre-block-column: backburner
created: 2026-07-16T20:06:24+0200
updated: 2026-08-25T17:28:11+0200
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
blocked-by: [TRDD-H24DF6ZC]
release-via: none
implementation-commits: [ddec060f, 59ebd182, 69ce68cb, 699e5f06, 67650e06, e963487f, 45725da7, 1e65a9b3, 2b325a11]
---

# Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)

## ⏱ EXTERNAL REF CHECKED 2026-08-02 — `janitor#82` CLOSED, and it hands this card a CONSTRAINT

Surfaced by the external-ref sweep on [[5YRLA53W]] (15 of 47 refs turned out closed). `janitor#82`
— *"keychain reads of `Claude Code-credentials` re-prompt after every app token refresh (partition
list reset)"* — is **CLOSED 2026-07-28**, but read the closing comment before treating it as solved:

- **The flap is NOT fixed.** It remains real and is tracked as the janitor's own `TRDD-V5RXQ4NB`.
  What closed the issue is that two mitigations landed and changed its SEVERITY: the WRITE-side ACL
  prompt is fixed and live (ACL touched only at CREATE, data-only updates thereafter), and the
  denied-latch became a **self-healing half-open breaker** (600 s cooldown, one probe, auto-clear on
  silent success) — so a partition-list flap now darkens rotation for **≤ one cooldown** instead of
  forever.
- **The constraint this port inherits, and it is load-bearing:** *no unattended ACL-touching
  `security` op on the login keychain; prompting cures are interactive-only.* Their candidate design
  is beacon/mirror-first reads so the tick rarely touches the app-owned item, plus a once-per-flap
  advisory naming the interactive cure.

**So this is not a blocker that cleared — it is a design input.** A faithful Python→TS port that
reproduces the janitor's read path also reproduces the flap, and the mitigations above are part of
what must be ported, not incidental. Do not port the pre-mitigation shape.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-04

**🔴 THE ROTATOR IS LIVE. SUPERSEDED — do NOT carry forward: every "INERT", "NOT ACTIVATED",
"NOT RUN LIVE", and "no code path is wired to a tick/route" claim below.** Those were true when
written and describe a pre-activation world. **The USER gave the R16 go-ahead on 2026-07-29
09:33** by creating `~/.aimaestro/oauth-rotator-tick.enabled` (their call alone, exactly as this
card requires). Measured 2026-08-04: the flag exists and the beat is running — `server-tick.ts`
stamped `{"nextAction":"ok","at":"2026-08-04T21:57:58.156Z"}`. Treat `lib/oauth-rotator/` as a
**LIVE writer against the real `Claude Code-credentials`**, not as gated infra: an edit there can
now rotate a real token on the next beat. The phase lines below remain accurate about WHAT was
built and by which sha; they are stale only about whether it runs.

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
- **C ✅ DONE (`69ce68cb`)** — `lib/oauth-rotator/tick-lock.ts`: **server-internal** rotation-tick
  lock (USER decision 2026-07-17). Node has no `fcntl.flock`; sharing the janitor's kernel flock
  needs a native addon (rejected under the Node-22 ABI constraint), and an O_EXCL lockfile can't
  interoperate with a POSIX flock anyway. Pure-JS O_EXCL lockfile (pid+ts) serialising the
  SERVER's own ticks, non-blocking, stale-reclaim. DISTINCT filename
  `oauth-rotator-server-tick.lock` (NEVER the janitor's `oauth-rotator-tick.lock`) so it never
  implies cross-mechanism coordination. Server-vs-`#N` safety = presence/delegation, not this
  lock. Supersedes H24DF6ZC-D3's "shared kernel flock" (consistent with the reframe). 10 tests.
- **D ✅ DONE (`699e5f06`)** — the rotator-owned, REVERSIBLE slot store + state index:
  `lib/oauth-rotator/integrity.ts` (port of `janitor_integrity.py` — `.bak`+`.sha256` sidecar,
  mirror-first ordering, corruption-recovering `readOrRestore`), `keychain.ts` (the ACL-aware
  macOS `security` custody — the TRDD-EQJPPZ2L create-vs-update `-A`/`-T` rule; gated on
  `detectBackend()==='macos'`), `slots.ts` (ROOT resolver + `state.json` schema/load/save +
  `fingerprint`/`oauthOf`/`expiresInH` + `writeSlot`/`readSlot` primary+`-slot-backup` mirror +
  plaintext fallback + fail-closed on a present-but-refusing keychain + `fileSlot` locked
  capture), and `tick-lock.ts` gained `tryAcquireTickLockWait` (a capture WAITS for the lock,
  never skips). BYTE-COMPAT with the janitor `#N`: slots stored as RAW compact JSON (no base64),
  `state.json` sidecars match. 28 tests, 0-IMPACT (temp HOME + forced-off backend + hard guard);
  tsc + `yarn build` clean. The LIVE credential is NOT touched — that is Phase E.
- **E ✅ CODE DONE — NOT RUN LIVE (`67650e06` E.1, `e963487f` E.2)** — the LIVE custody + the
  ROTATE/RENEW actuators, ported as INFRA and gated: **no code path is wired to a tick/route, so
  nothing runs against the real `Claude Code-credentials` yet.** USER greenlit "write Phase E code
  + 0-impact tests now" (2026-07-17); the first LIVE activation still needs a separate R16 go-ahead.
  - **E.1 `live.ts`** — `readLivePrimary` (macOS keychain, account=$USER, skipped when headless) →
    credentials-file → keyring; `liveBackupRead/Write` (`-livebak` mirror via the exported slot
    helpers); `readLiveBlobWithSource` (F1: mirror = untrusted identity for decisions);
    `primaryLiveItemAbsent` (proven-absent only); `writeLiveBlob` (THE irreversible write — `-T`
    live ACL on create only, FULL blob incl mcpOAuth, credentials-file only when `security` absent
    so the macOS live-re-read is preserved, fail-closed `LiveKeychainWriteError`, then `-livebak`).
  - **E.2 `network.ts`** — `accountEmail`/`usageRequest` (status-preserving: 429 = rotate-away)/
    `refreshOauthToken` (RENEW exchange, required UA, keeps old refresh if omitted)/`util`;
    injectable `fetch`. **`rotate.ts`** — `switchLiveTo` (`_switch_blob`): merge slot claudeAiOauth
    into live PRESERVING mcpOAuth → `writeLiveBlob` → state (`live_email`/`live_fp`/`last_switch_*`/
    `live_429_streak=0`) → identity beacon.
  - 27 tests (live 7 + network 11 + rotate 2 + the slots/keychain deltas); every one 0-IMPACT
    (forced-off backend + HOME→temp + a hard guard, or a stub fetch) — no test touches the real
    credential or the network. tsc + `yarn build` clean.
- **F** — REAUTH + bootstrap browser tier (`reauth.py`/`slot_capture_browser.py`/`cookie_vault.py`
  via Node CDP/tmux) — the "only human step".
- **G ✅ CODE DONE — NOT ACTIVATED (`1e65a9b3`)** — `lib/oauth-rotator/server-tick.ts` wires
  `runTick` into `server.mjs` as a 60s `setInterval().unref()` task. Gate ORDER inside each beat:
  flag-file `oauthTickEnabled()` → `claudeRunning()` (fail-closed `pgrep -x claude`, self-match-free)
  → `withTickLock(runTick)`; the whole beat is try/caught so it NEVER throws to the server. The
  opt-in is a FLAG FILE `~/.aimaestro/oauth-rotator-tick.enabled` (NOT an env var — TRDD-CC9PY337);
  ABSENT = the R16-safe default (every beat no-ops: nothing written, no network). The timer STARTS
  unconditionally at boot (the gate lives INSIDE the beat), so the default stays OFF with no
  startup runTick call. 6 new 0-IMPACT tests (temp HOME + forced-off backend + stubbed runTickImpl);
  tsc 0, vitest 18/18, build 0. Feeds [[DXJZM3BW]]'s `next_action` (ok | rotating | reauth-needed).

- **ORCHESTRATION TICK ✅ CODE DONE — NOT WIRED LIVE (`45725da7`)** — `lib/oauth-rotator/tick.ts`:
  the faithful port of `cmd_auto` (ROTATE), `_keepalive_refresh` (RENEW), `_refresh_and_heal_slot`,
  `_reconcile_live_email`, `_resolve_untrusted_live` (F1 mirror stay-put), and the `cmd_tick`
  compose. Preserves 1:1: the 429 debounce, anti-thrash dwell, DRAIN-FIRST selection, degraded
  fallback, RENEW-before-rotate + refresh-on-err nets, ground-truth reconcile. `runTick()` returns
  [[DXJZM3BW]]'s `next_action` (ok | rotating | reauth-needed). Thresholds are FIXED constants
  (rotator.py env defaults) — no env knob (TRDD-CC9PY337). 12 new 0-IMPACT tests (stub fetch +
  forced-off backend + temp HOME + hard escape guard); full oauth-rotator suite 106/106; tsc 0;
  `yarn build` 0. **NO code path CALLS runTick yet — nothing runs against the real credential.**

**NEXT ACTION:** Phase G is COMPLETE (`1e65a9b3`) AND the `next_action` surfacing is DONE
(`2b325a11`) — `lib/continuity-status.ts` reads the persisted OAuth-cascade stamp via
`lib/oauth-rotator/tick-status.ts` (PERSIST-THEN-READ: `server-tick.ts` stamps the beat's cascade
conclusion; a status GET only READS it, never runs the tick — R16-safe). The Python→TS port is a
WORKING but INERT server mechanism; the FIRST LIVE ACTIVATION (the human creating
`~/.aimaestro/oauth-rotator-tick.enabled`) is the single R16 go-ahead, the USER's alone.
**Flock re-assessed 2026-07-17 — the four testing NPTs are code-complete:** [[Y916N7WL]]
(`fbf28fb0`), [[DXJZM3BW]] (`03c40474`+`2b325a11`), [[JAU1ES1C]] (`166bd8a4`), [[P7RPOR5O]]
(`f47d2ff4`). **restart-self ([[TRDD-4P1M8I18]], #59) is now ✅ COMPLETE** (`2af0aabf`, `1981abf8`,
`1fdc3603`, `6714a2ea`) — `POST /api/sessions/me/restart` (self-only by construction) in both serving
modes + the `aimaestro-continuity.sh restart-self` frozen verb; the janitor `#J` continuity path can now
recover a stuck self (agents still can't via the shared `restart-session`, which is intended). Remaining
Family-A work, in priority order:
1. **[[9ZIF82HI]] account switcher** (passive rotation on 429 / dead-refresh / net-drop) — the big
   unbuilt infra piece; builds on this NPT's rotator machinery ([[TRDD-H24DF6ZC]] signed, so
   buildable as gated INFRA like Phases E/G, live-activation still R16).
2. **Phase F** — the REAUTH browser tier (`reauth.py`/`slot_capture_browser.py`/`cookie_vault.py`
   via Node CDP/tmux), the lower-priority "only human step".
Do NOT flip the flag on (R16 — USER's call). Do NOT push (this is the app, not a plugin).

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

## Acceptance

- [ ] Phase F (REAUTH browser tier — `reauth.py`/`slot_capture_browser.py`/`cookie_vault.py` ported via Node CDP/tmux) is implemented and its `/login` nudge is verified against `lib/setup-bootstrap.ts`'s presence channel.
- [ ] The cascade never surfaces token material in any log/transcript — grepped clean per the Verification section (the detached process output + the `status` verb).
- [ ] Concurrent-write test proves the server and a simulated `#N` janitor-daemon holder cannot both write the live credential (mutex proven mutually exclusive, not merely unlikely).
- [ ] validate-then-backup holds: a failed probe never overwrites the last-known-good slot — pinned by a test that forces the probe to fail and asserts the prior slot survives.
- [ ] The open janitor#82 keychain-reprompt issue is confirmed handled — either resolved in this port or spun out as its own EHT sibling under `[[KCRMSNL7]]` per the "Open issue this NPT must honor" note, and NOT silently dropped.
- [ ] A human confirms live (with awareness this touches the real credential): a forced ROTATE on the running server correctly swaps to a spare slot without corrupting `Claude Code-credentials`, and REAUTH correctly surfaces the human `/login` nudge instead of auto-authenticating.

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
- 2026-08-04T23:57:41+0200 — **COLUMN CORRECTED `todo → backburner`. Only the column moved — no
  work, no gate, no flag.** The card was asserting `todo` — *not started* — while carrying NINE
  `implementation-commits` and six phases marked DONE (A, B, C, D, E, G), i.e. a working but
  deliberately INERT server mechanism. That is the worst direction for a column to be wrong in:
  `todo` invites a future session to *begin* work that is already built, and the duplicate would
  be written against live-credential machinery. Found by cross-checking this card against
  [[DXJZM3BW]]'s acceptance box, which states the cascade states "landed and wired" — one card
  claiming landed code the other claimed unstarted.
  `backburner` is the honest resting state, and each alternative is a different lie: `dev` asserts
  someone is working it right now (nobody is), and `blocked` requires a non-empty `blocked-by:`
  naming an open CARD — what remains is Phase F (the REAUTH browser tier, which this card's own
  NEXT ACTION deprioritizes *behind* [[9ZIF82HI]]) plus the FIRST LIVE ACTIVATION, and neither is
  a card. Per the pipeline rule `backburner` is an explicitly-deferred resting state and carries
  no drain obligation, and the id stays in [[KCRMSNL7]]`.npt`, so the parent's completion gate
  still tracks it and it cannot be silently lost.
  **The R16 go-ahead is untouched and remains the USER's alone** — nothing in this edit touches
  `~/.aimaestro/oauth-rotator-tick.enabled`.
- 2026-08-04T23:59+0200 — **CORRECTION to the line above, and to this card's STATE: the rotator is
  NOT inert. It has been LIVE since 2026-07-29 09:33.** I wrote "the mechanism is as inert after
  this edit as before it" on the strength of a check I ran in the same breath as the commit — so
  the commit landed before I read the result, and the result said the opposite. The flag file
  EXISTS (created Jul 29, six days ago, size 0) and the beat is running: the tick stamped
  `{"nextAction":"ok","at":"2026-08-04T21:57:58.156Z"}` seconds after I claimed inertness.
  The USER gave the R16 go-ahead on 2026-07-29 — exactly as this card requires, and their call
  alone. Nothing improper happened; what was wrong was my description of the system. **Every
  "INERT" / "NOT ACTIVATED" / "no code path is wired" claim in the Phase E and Phase G lines and in
  the NEXT ACTION is therefore STALE as of 2026-07-29 and must not be carried forward** — they were
  true when written and describe a pre-activation world. A future reader must assume the rotator
  is a LIVE writer against the real `Claude Code-credentials`. This does not change the column:
  Phase F remains deferred behind [[9ZIF82HI]], so `backburner` still holds.
