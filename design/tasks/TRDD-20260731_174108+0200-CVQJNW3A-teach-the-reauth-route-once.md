---
trdd-id: CVQJNW3A
title: Teach the REAUTH route once — close the slot-recapture hole that strands the rotator
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T17:41:08+0200
updated: 2026-07-31T17:41:08+0200
created-by: ai-maestro
current-owner: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-31T17:41:08+0200
priority: 0
severity: high
effort: medium
release-via: none
relevant-rules: [R16]
eht: []
npt: []
blocked-by: []
labels: [oauth-rotator, continuity, credential-handling]
external-refs: []
---

# Teach the REAUTH route once — close the slot-recapture hole that strands the rotator

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-31

**The incident:** 2026-07-31 ~17:20 the owner was rate-limited and had to log in by hand. The
rotator was NOT asleep — it detected the exhaustion every 60 s and had nowhere to go.

**NEXT ACTION:** implement Leg 3 below (server-side slot re-capture on `reauth-needed`), gated
behind the guard rail in box 1. Do box 1 FIRST — it is the only irreversible-by-omission step.

**SUPERSEDED — do NOT carry forward:**
- *"the re-login is irreducibly manual / the human must click 4 buttons"* — **WRONG**, and I said
  it to the owner before measuring. The consent click is ALREADY automated; see the Jul 11 log
  quoted below. What is manual is only re-seeding a stale per-account Chrome profile.
- *"the keychain prompt makes capture human-only"* — **STALE**, resolved 2026-07-15 (see the
  opt-in.flag content below). It was true in July and is the reason the capture was excluded
  from the server port; that reason no longer holds.
- *"unbrowse can replace ROTATE, REFRESH and REAUTH"* — measured: it replaces **REAUTH only**.
  See the three-leg table.

## Problem

Measured on 2026-07-31 from `logs/pm2-out.log`, the rotator state, and the bootstrap logs.

The tick ran correctly, once a minute, and could not act:

```
17:21:40  auto: live ipazia.emasoft exhausted (5h=100% 7d=46%) but no alternate is healthy
          + below safe threshold and none is structurally renewable — all paid accounts
          maxed; waiting for a window to reset
17:21:40  reauth-needed: 1 alternate slot(s) have a dead refresh and are expiring —
          a human must re-login
17:28:39  auto: reconciled live account — state said "ipazia.emasoft" but the real live
          credential is "fmuaddib"; state.json corrected        ← the owner's manual login
17:28:40  auto: live fmuaddib 5h=0% 7d=0% — within limits
```

Slot health at that moment:

| account | stored token | quota | legal rotation target |
|---|---|---|---|
| fmuaddib | **DEAD** — 69 failed refreshes, expired 228 h, captured Jun 30 | 7d=0% (FULL) | **no** |
| ipazia.emasoft | healthy, +7.9 h | 5h=100% | no (until its window resets) |
| emanuele.sabetta | healthy, +7.8 h | 7d=94% → above the 90 % SAFE floor | **no** |

The account with a **full quota** was the one whose **token** was dead. One re-capture was the
entire fix, and it is the one thing the system could not do.

### The causal chain (each link verified, not inferred)

1. **2026-07-09** — a keychain incident paused the rotator opt-in
   (`opt-in.flag.PAUSED-keychain-incident-20260709` still on disk).
2. **2026-07-11 03:27** — the automated capture ran and got *almost* all the way:
   ```
   [capture] clicked approval button (button:has-text("Authorize")).
   [capture] NOTE: profile is logged in as ipazia.emasoft@gmail.com, not fmuaddib@gmail.com
             — filing under the ACTUAL account ipazia.emasoft@gmail.com (authoritative).
   rotator.SlotKeychainWriteError: keychain write failed — refusing to drop a plaintext token
   ```
   Two facts in one log: **the consent is automated**, and **the capture cannot target a
   specific account** — it files whoever the Chrome profile happens to be.
3. **2026-07-15 10:41** — the keychain was fixed and the opt-in re-armed. `opt-in.flag`:
   *"re-armed … after stale keychain-incident pause (2026-07-09); keychain verified healthy,
   all slots readable"*. Verified today: `login.keychain-db` is `no-timeout` (unlocked) and the
   `Claude Code-rotator-slot` items are present.
4. **~2026-07-22** — fmuaddib's stored token passed `expires_at`; refresh began failing and the
   counter climbed to **69** (vs `MAX_REFRESH_FAILURES = 3`).
5. **2026-07-25 23:32** — the janitor daemon's last heartbeat. It has been dead 5.7 days; the
   only live `daemon.py` is a **leaked test-session daemon** running against a fake `$HOME` in
   `/var/folders/.../janitor-test-session-2mag6ttp/_home/`, which can never touch real state.
6. **2026-07-31** — nothing had re-run the capture for 20 days. The owner was stranded.

### The two holes

- **H1 — nothing re-runs the capture when a refresh dies.** The janitor daemon would have; it is
  dead. Our server port deliberately excluded the capture *because of the July keychain prompt*
  — a reason that expired on Jul 15 and was never revisited.
- **H2 — `reauth-needed` has no channel.** The mechanism computed the right answer and wrote
  `a human must re-login` to `pm2-out.log` and a Settings sub-panel. R16 makes the human the only
  actuator for a re-login, and the design never **told** the human. This is the same defect class
  filed on janitor#153 the same day: a mechanism that works, reports correctly, and reports into
  a void.

## Root cause

`slot_capture_browser.py` needs a **persistent, logged-in Chrome profile per account** at
`profiles/chrome-profile-<email>/`. Its own docstring:

- *"WHY a per-account profile instead of `open <url>`: the authorize endpoint only [works with]
  the account's own profile (cookies)"*
- *"pure headless is Cloudflare-blocked regardless of flags (audit §3-D)"*
- *"no Chrome profile for {email} → FAILED: expected a logged-in profile created during initial
  slot capture"*

**That profile is what decays.** When its session goes stale the capture reads as logged-OUT and
dies — and re-seeding it is the manual login the owner keeps performing. The capture is not
missing; its *input* is.

## Proposed fix — three legs, and only one of them is a browser

Measured against the code, so the scope is honest:

| leg | what it actually is | needs a browser? |
|---|---|---|
| **ROTATE** | `lib/oauth-rotator/rotate.ts:31 switchLiveTo` → `writeLiveBlob(merged)` — a local keychain write | **no** — no website exists in this path |
| **REFRESH** | `lib/oauth-rotator/network.ts:216 refreshOauthToken` → `POST grant_type=refresh_token` | **no** — works today (17:29 keepalive succeeded) |
| **REAUTH** | `slot_capture_browser.py` + a live per-account profile | **YES — and this is the whole failure** |

**ROTATE's independence is conditional, and today it did not hold** (owner's correction,
2026-07-31). A rotate is a local write *provided the target slot's auth is still good*; when the
target is expired, ROTATE cannot proceed without a REAUTH first — so it inherits the browser
dependency exactly in the case that matters:

```
ROTATE ──target auth valid──▶ local keychain write, no browser        ← the common case
   └────target auth EXPIRED──▶ REAUTH (browser + per-account profile) ← TODAY's failure
```

That is not a corner case: it is the only state in which a rotation is *needed and blocked at the
same time*. A healthy fleet rotates for free; a fleet that has been unattended long enough to
need rotating is the fleet whose alternates have expired. **So the browser leg is not an
occasional extra — it is on the critical path of every rotation that actually matters.**

So: **teach the login route ONCE per account, replay it forever.** `unbrowse act auth <url>`
records a replayable login and persists the cookies; replaying it re-seeds
`chrome-profile-<email>` so the existing capture targets the *right* account instead of whoever
is logged in.

1. **Guard rail (do FIRST).** `unbrowse` contributes captured routes to a **shared route graph**.
   A login route for the owner's Google/Anthropic accounts must never enter it. Measured on the
   installed **v11.1.9** rather than assumed, because the shipped skill doc describes a different
   (flat-command) generation:
   - The skill doc's `settings --auto-publish off` / `--publish-blacklist` **do not exist here**:
     `unbrowse settings` on this build is a *pointer-secrets* surface (`--set <key>=<pointer>`),
     and `act --help` mentions no publish/share/graph verb.
   - Publishing appears to be **explicit and per-skill**: `unbrowse build publish` refuses with
     `{"error":"--skill is required"}`.
   - The sharing pathway is nonetheless **real and already carries auth domains** — of the 221
     skills visible locally, all are `source: marketplace` and the set includes `google.com`,
     `www.google.com`, `googleusercontent.com` and a third-party `…-auth.…` domain, contributed
     by other agents.
   - **Nothing of the owner's has been shared: 0 non-marketplace skills.** So this is genuinely a
     before-you-capture-anything step, not a cleanup.

   So the enforceable rule for this build is **never run `build publish` on a skill captured from
   an auth domain**, and confirm the auto-publish semantics with upstream (the skill ships a
   `gh issue create` reporting path) before the first login route is taught. Do NOT record this
   box as done on the strength of having run a command — read the setting back, or state plainly
   that the knob could not be found.
2. **Teach one login route per account** (owner-run, once). Then the profile is re-seedable
   without a human.
3. **Server tick acts on `reauth-needed`** instead of logging it. Concrete pipeline — note that
   **only step (c) is new**; every other step is code we already run today:

   ```
   a. tick detects reauth-needed for account X          ← lib/oauth-rotator/tick.ts (exists)
   b. mint the PKCE challenge + authorize URL for X     ← reauth-flow.ts::startReauth (exists)
   c. unbrowse replays X's taught login route, drives   ← THE ONLY NEW PIECE
      the consent, returns the callback code
   d. exchange the code, file the slot                  ← network.ts + the slot writer (exists)
   ```

   Keep every existing refusal — never write a plaintext token, never file under the wrong
   account (the Jul 11 log is the regression test).

   **Why route (c) through unbrowse rather than the janitor's `slot_capture_browser.py`:** the
   script is present and current (0.66.1 ships it, as does every cached version back to 0.41.0),
   so this is a choice, not a necessity. It fights the hard part with heuristics — a per-account
   Playwright profile plus its own note that *"pure headless is Cloudflare-blocked regardless of
   flags"* — and its failure mode is silent mis-attribution (Jul 11: asked for fmuaddib, filed
   ipazia). unbrowse already maintains persistent per-profile sessions (`~/.unbrowse/profiles/`)
   and a *taught* route is addressed by account rather than by whoever the ambient profile
   happens to be, which removes that failure mode by construction instead of by check. Invoking
   the janitor's script would also couple our server to a versioned plugin-cache path.
4. **Surface it either way** (closes H2): when the tick cannot repair, `reauth-needed` reaches
   the owner as a push + dashboard banner, not a log line.

## Estimated risk

**MED-HIGH.** A replayable login means anything that can run `unbrowse` on this host can assume
that identity — a real blast-radius increase over a token that expires. The owner was told this
explicitly on 2026-07-31 and mandated the work anyway; it is his machine and his accounts. It is
recorded here rather than re-litigated, and box 1 is the mitigation that must not be skipped.

R16 is **not** weakened: an agent still never *decides* to rotate a credential and never handles
the governance password. What changes is that re-seeding a decayed session stops requiring a
human at 3 a.m.

## Already satisfied — do NOT build these (measured 2026-07-31, after the card was written)

The Jul 11 mis-attribution is a defect of the **janitor's Python** capture. Our TypeScript path
never had it, solves it **by construction rather than by check**, and is already pinned —
`reauth-flow.ts:101`: *"`emailHint` is display-only. Which account gets filed is decided at the
END of the flow by /roles, because the human might log in as somebody else and the token is
authoritative about whose it is."* `tests/unit/oauth-rotator-reauth-flow.test.ts` pins:

- `:211` — *files under the account /roles resolves, NOT the hint, and reports the runway*
- `:228` — *lifts the DEAD-token retry ban: the replaced index entry carries no
  `refresh_failures` / `refresh_dead_fp`* — so fmuaddib's **69** failures and its dead flag clear
  on the next beat with no separate un-gating step
- `:270` — *refuses to file anything when /roles cannot say whose token it is*

This is why the wrong-account box below is struck: building a check for it would have duplicated
a stronger guarantee. **The remaining new work is step (c) and nothing else.**

## Verification

- A slot whose refresh is dead is repaired without a human, and `reauth-needed` clears.
- `bash scripts/with-node.sh npx tsc --noEmit` → 0 · `… yarn test` → full suite green.
- Every new guard carries a recorded **neuter run** (break it → the named test fails; read the
  test COUNT, never the exit code).

## Acceptance checklist

- [ ] Box 1 — unbrowse `auto-publish off` + auth domains blacklisted, verified by reading the
      setting back (not by having run the command)
- [ ] One login route taught per rotator account; replay re-seeds `chrome-profile-<email>`
- [ ] Server tick re-captures a dead slot on `reauth-needed`, targeting the named account
- [x] ~~Wrong-account refusal pinned by a test + a recorded neuter~~ — **already true**, by
      construction and tested (`reauth-flow.ts:101`; test `:211`, `:270`). Struck rather than
      deleted: the box was aimed at the janitor's Python failure mode, and knowing our path never
      shared it is the reason step (c) is the only new work.
- [ ] `reauth-needed` reaches the owner as a push/banner when it still cannot self-repair
- [ ] `tsc` clean + full suite green, both DATED in this card

## Approval log

- 2026-07-31T17:41:08+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent. The owner
  directed the design in-session ("unbrowse records a login route and can playback it … it just
  needs to learn the route once") after being told the blast-radius consequence.
