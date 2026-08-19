---
trdd-id: 78J4I4QS
title: reliability — detect a keychain-blind tmux server before it silently takes the whole fleet down
column: complete
created: 2026-07-12T12:27:10+0200
updated: 2026-08-18T23:34:36+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 1
severity: HIGH
effort: S
labels: [reliability, keychain, watchdog, fleet-health]
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-12T12:27:10+0200
created-by: ai-maestro-dev-session
derived: true
derived-kind: eht
parent-trdd: CNF1X3J7
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-commit
target-branch: governance-rules
test-requirements: [unit, typecheck]
audit-requirements: []
review-requirements: []
impacts: [agent-lifecycle]
attempts: 0
implementation-commits: [6eef63fe]
external-refs: ["memory:tmux-pane-cannot-read-login-keychain", "memory:fleet-auth-outage-2026-07-12-tmux-server-keychain-blind"]
---

# TRDD-78J4I4QS — Fleet-health watchdog: detect a keychain-blind tmux server (EHT of TRDD-CNF1X3J7)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-12

**▶ UPDATE 2026-07-13 05:47 (DEPLOYED + LIVE-VERIFIED):**

- Live on the production server (pm2 restart after `fcd0fa5b`). The pm2 env runs the
  watchdog at `AIM_INVARIANTS_WATCHDOG_INTERVAL_MS=15000` (15s — a leftover dev
  setting worth revisiting; code default is 5 min). Observed 3+ sweeps: SILENT (no
  alarm), zero leftover `aim-kc-watchdog` sessions.
- **Live incident caught + fixed on first deploy:** the very first sweep raised a
  FALSE fleet-blind alarm — a leftover fixed-name session (debris from a
  non-hermetic test run) made `createSession` fail "duplicate session" and the
  fail-safe reported `blind`. Fix `fcd0fa5b`: pre-kill our OWN fixed name before
  creating (the module comment promised this; the code hadn't implemented it),
  pinned by test. Lesson recorded in the project memory page
  `agent-launch-preconditions`.
- implementation-commits: 6eef63fe (module+wiring+tests), fcd0fa5b (pre-kill fix).

**▶ UPDATE 2026-07-13 (IMPLEMENTED — superseded by the deploy update above):**

- **Built + tested.** `lib/tmux-server-keychain-watchdog.ts`:
  `checkTmuxServerKeychainOnce` (throwaway session `aim-kc-watchdog`, REUSES
  `preflightPaneKeychain`, fail-safe: pane-standup errors report `blind`, `finally`
  always kills the throwaway) + `sweepTmuxServerKeychain` (darwin-gated, re-entrancy
  guard — overlapping sweeps on the FIXED session name would false-alarm `blind` —
  alarm state with preserved `since`, ONE `console.error` with the remediation text,
  silence on ok) + the `dotenclave` secrets-CLI canary via `tmux list-panes -a`.
  Wired into `startAgentInvariantsWatchdog`'s interval (once per sweep, before the
  per-agent loop, own try/catch). `getTmuxServerKeychainAlarm()` exported for a
  future dashboard banner (banner UI NOT yet wired — detector + log + queryable
  state only). Tests: 13 (incl. the 3 pinned) + hermetic mock added to
  `agent-invariants.test.ts` so unit runs never touch the real host tmux server.
- **NEXT:** deploy (build + pm2 restart) and observe one 5-min sweep on the live
  server; then wire the dashboard banner off `getTmuxServerKeychainAlarm()` (small
  follow-up, not gating).

- **State (2026-07-12, superseded above):** PLANNED. Depends on nothing; can be built before or after its parent, but it
  only becomes *useful* once the parent refuses launches.
- **NEXT ACTION (done):** add a `tmux-server-keychain` check to the periodic invariants
  watchdog started by `server.mjs` (`startAgentInvariantsWatchdog`, 5 min default).
- **Why this is an EHT, not a nice-to-have:** the parent (TRDD-CNF1X3J7) makes the launch
  path REFUSE when a pane cannot read the keychain. That is correct — but on its own it
  converts a silent outage into *"all my agents refuse to start and I don't know why"*.
  This TRDD supplies the fleet-level explanation and the remediation. **Shipping the
  parent without this closes one wound and opens another.**

## Problem

The blindness is a property of the **tmux server**, not of any one agent — so it is a
**fleet-wide single point of failure that nothing currently monitors.** Today the first
symptom is an agent that looks online and does nothing; with the parent shipped, the
first symptom becomes N refused launches with a per-agent message and no fleet-level
signal. Neither tells the operator the one thing that matters: *the server your whole
fleet is forked from cannot read the login keychain.*

## Proposed fix

Add a **fleet-level** check to the existing periodic invariants watchdog
(`startAgentInvariantsWatchdog()` in `server.mjs`; interval
`AIM_INVARIANTS_WATCHDOG_INTERVAL_MS`, default 5 min, `0` disables):

- Once per interval, run the free probe in a **throwaway pane on the fleet's tmux
  server** (from a script file — never nested quoting):
  `security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; echo $?`
- `rc != 0` ⇒ raise a **loud, fleet-level alarm**: log at error level and surface a
  persistent dashboard banner naming the actual remedy — *"the tmux server is
  keychain-blind; every agent forked from it will fail to authenticate. Recreate the
  server from a shell verified with the same probe; restarting individual agents will
  NOT help."*
- It is a **detector, not a repairer.** Recreating the tmux server kills every pane on
  it, which is far too big a thing for a background loop to do unasked. Detect, explain,
  and let the operator (or a future, explicitly-triggered repair skill) act.
- Zero cost: one `security` call per interval; no API call, no tokens.
- macOS-only; elsewhere the check is skipped, never failed.

**Also surface the canary.** A secrets CLI whose auto-unlock stashes its passphrase in
the login keychain (e.g. `dotenclave`) **cannot** sit at a passphrase prompt unless that
pane is keychain-blind. A pane stuck at such a prompt is therefore the same alarm,
arriving earlier — during the 2026-07-12 outage three panes sat at exactly that prompt
for hours and were dismissed as junk. If a pane's foreground command is a known
secrets-CLI at a prompt, raise the same fleet-level alarm.

## Verification (TDD)

1. `tests/unit/tmux-server-keychain-watchdog.test.ts` — probe non-zero ⇒ alarm raised
   once (not once per agent), with the remediation text.
2. same — probe `rc=0` ⇒ **silent** (a watchdog that cries wolf gets muted, and a muted
   watchdog is worse than none).
3. same — the watchdog **never** attempts to recreate the tmux server (pins
   detect-not-repair; a future edit that adds a background server-recreate must break
   this test).
4. same — non-macOS ⇒ skipped.
5. `bash scripts/with-node.sh yarn test` + `yarn build` green.

## Estimated risk

**LOW.** Read-only detection on an existing loop, off by the same env var that already
disables the watchdog. The one real risk is alarm fatigue, which test 2 pins: it must be
completely silent when healthy.

## Acceptance

Transcribed from this card's own numbered `## Verification (TDD)` list and the two follow-ups its
STATE block names — not criteria invented at closing time. Re-verified live 2026-08-02.

- [x] 1 — probe non-zero ⇒ alarm raised ONCE (not once per agent), carrying the remediation text
- [x] 2 — probe `rc=0` ⇒ **silent** (the alarm-fatigue pin; a muted watchdog is worse than none)
- [x] 3 — the watchdog NEVER attempts to recreate the tmux server (pins detect-not-repair)
- [x] 4 — non-macOS ⇒ skipped, never failed
- [x] 5 — suite + build green. Re-run 2026-08-02: `tests/unit/tmux-server-keychain-watchdog.test.ts`
      **14 passed** (the card recorded 13; it has since grown by one)
- [x] deployed and live-verified — 3+ silent sweeps, zero leftover `aim-kc-watchdog` sessions,
      after `6eef63fe` (module+wiring+tests) and `fcd0fa5b` (pre-kill the own fixed name, the fix
      for the false `blind` alarm the first live sweep raised)
- [x] the dashboard banner off `getTmuxServerKeychainAlarm()` — **SPLIT OUT 2026-08-18 to
      TRDD-GIA2LC83 at the hub's ai_review.** The delivered half (state exported and queryable) is
      done; the UI wiring was deliberately descoped and now owns its own card, so this checklist
      truthfully reflects THIS card's scope. A box whose open half belongs to other work is the
      fused-box defect — split, not left dangling.
- [x] the leftover `AIM_INVARIANTS_WATCHDOG_INTERVAL_MS=15000` — **CLEARED 2026-08-16 (`4982a3f1`),
      and the remedy this box named DOES NOT WORK.** Verified on the live process (pid 78342,
      started 10:08:20): `ps eww -p <pid>` → **0** occurrences, with `NODE_ENV`/`PATH` present in
      the same snapshot as the positive control proving the snapshot really carries this process's
      environment. `AIM_FLEET_RECOVERY_FIRE=1` is still live, as recorded.
      **⚠ THE CORRECTION, which is the part worth keeping.** This box said it *"self-corrects on
      the next `pm2 restart ecosystem.config.js --update-env`"*. It does not, and that was measured
      this morning: **`--update-env` MERGES the config's env over the cached one — it cannot DELETE
      a key the config never defines.** There are THREE copies of the env (the live process,
      `ecosystem.config.js`, and `~/.pm2/dump.pm2`), and the phantom survived in the dump. Only
      `pm2 delete` → `pm2 start ecosystem.config.js` → `pm2 save` clears it. The variable had
      therefore been making the invariants sweep run every 15 s against a 300 s design — **20× for
      20+ days** — through every restart anyone performed believing this box's remedy.

      **⚠ IT DID NOT SELF-CORRECT, AND NOW WE KNOW WHY — measured 2026-08-16T01:23.** The server
      restarted at **2026-08-15 21:36:10** and the var is STILL on the live process: `ps eww -p
      50184` reads `AIM_INVARIANTS_WATCHDOG_INTERVAL_MS=15000`. So that restart was a plain
      `pm2 restart ai-maestro`, which **replays the env pm2 cached at FIRST start** and can never
      clear a phantom var — only `pm2 restart ecosystem.config.js --update-env` re-reads the file.
      The box's "self-corrects on the next restart" is therefore too weak: *most* restarts are the
      plain kind, so the expected self-correction will keep not happening.

      **What it costs, which the original note did not say.** `lib/agent-invariants.ts:290-293`
      is `Number(process.env.AIM_INVARIANTS_WATCHDOG_INTERVAL_MS) || 300_000`, and `server.mjs:1921`
      RUNTIME-IMPORTS that module — so the live process reads the phantom at load and the single
      enforcement loop sweeps every **15 s against a designed 300 s: 20× the intended rate**,
      continuously, for 20+ days. That is not merely wasted work: this watchdog RESTORES read-only
      rule files, and to do so it must `chmod` them writable first — so it passes through a weaker
      state than the one it enforces, and running it 20× more often multiplies how often that
      window is open.

      **The fix is one command and it is CHEAPER NOW THAN IT HAS EVER BEEN:** `pm2 restart
      ecosystem.config.js --update-env`. It bounces the fleet — which is why it stayed the owner's
      call — but the fleet is currently HIBERNATED (3 tmux sessions, none an agent), so tonight it
      bounces nothing. Still not taken unasked: it is the owner's server and the restart also
      interrupts the rotator tick.

      **✅ CLEARED 2026-08-16T09:49, USER-authorized — and `--update-env` was NOT enough, which is
      the finding.** Ran it first as prescribed: the var SURVIVED (`ps eww -p 4737` still read
      `=15000`). **The real source is a THIRD copy nobody had named: `~/.pm2/dump.pm2`**, the saved
      process list, which carried `"AIM_INVARIANTS_WATCHDOG_INTERVAL_MS":"15000"`.
      `--update-env` MERGES the config's env over the running one; it cannot DELETE a key the
      config does not mention, so a phantom var is exactly the case it cannot fix.
      **What actually cleared it:** `pm2 delete ai-maestro` → `pm2 start ecosystem.config.js` →
      `pm2 save` (dump backed up to `/tmp/` first). Verified on the new process (pid 9409):
      `AIM_INVARIANTS_WATCHDOG_INTERVAL_MS` **ABSENT**, `~/.pm2/dump.pm2` grep count **0**, and the
      two INTENDED vars survived (`AIM_FLEET_MODEL_FALLBACK=1`, `AIM_FLEET_RECOVERY_FIRE=1`) — so
      the sweep now runs at the code default 300 s instead of 15 s. Server healthy: full `[Startup]`
      sequence at 09:48:31, `/api/sessions` answering 401 (the auth middleware, i.e. serving —
      a dead server gives connection-refused).
      **`ecosystem.config.js` was never the culprit:** its only match is the COMMENT at line 26
      that cites this very variable as evidence pm2's cache was stale. It was right.

## Approval log

- 2026-07-12T12:27:10+0200 — **MANDATE** issued by USER ("create the TRDD"), authored as
  the EHT of TRDD-CNF1X3J7. `min-approval-requirement: none` (Tier 0 — in-scope dev).
  Pre-approved: issuer authority ≥ required approver.
- 2026-08-18T23:34:36+0200 — **ai_review by the hub: PASS → complete** (under the USER delegation
  recorded in TRDD-BRRJK57P). All delivered boxes verified as recorded (live-verification and the
  pm2 phantom-env clearing both carry their own measurement trails). The one open box — the
  dashboard banner — was deliberately descoped UI work fused into this card's checklist; split out
  to TRDD-GIA2LC83 per the fused-box rule so this checklist truthfully reflects this card's scope.
  Not archived yet: `release-via: none` makes `complete` the terminal column and it archives AS
  ITSELF (3P-ZON-05 @ 2.0.0) on the next archival pass.
