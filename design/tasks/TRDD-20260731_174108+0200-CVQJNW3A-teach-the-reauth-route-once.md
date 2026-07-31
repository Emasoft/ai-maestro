---
trdd-id: CVQJNW3A
title: Teach the REAUTH route once — close the slot-recapture hole that strands the rotator
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T17:41:08+0200
updated: 2026-07-31T19:12:24+0200
implementation-commits: [994be6d6, 041a87f8, fde71e17, 511de445, d45e050b, dfa2cf06]
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

**THE REPAIR LEG IS BUILT AND WIRED — 19:05 (`511de445` `d45e050b` `dfa2cf06`).** It is NOT armed
and must not be armed casually; see NEXT ACTION.

- `surveyAlternates()` (extracted from runTick, `511de445`) returns `{unreadable, refreshDead}` as
  EMAILS. The tick had counted them and thrown the identities away — right for its counts-only log
  line, and exactly what made the fault unrepairable. ONE definition now, so the beat that REPORTS
  a fault and the leg that FIXES it cannot disagree about what "dead" means.
- `lib/oauth-rotator/reauth-repair.ts` (`d45e050b`) — `repairOneDeadSlot()` composes
  survey → `startReauth` → `driveConsent` → `completeReauth`. **19 tests, 6 neuters.**
- Wired into `runOneTick` (`dfa2cf06`) — **7 tests, 4 neuters.**

**Three gates, each pinned by a test that fails when it is removed:** (1) its OWN flag file, absent
by default, checked BEFORE the survey so an unarmed server pays nothing — not even a keychain read;
(2) ONE repair per beat, so three dead slots do not open three windows; (3) a per-email cooldown
STAMPED BEFORE THE ATTEMPT — the only thing between "armed" and a browser window every 60 s, since
stamping after lets a reliably-throwing slot re-open one on every beat forever. Plus the beat's own
gates: tick-flag, live-client, and skip-when-the-lock-was-held (two processes repairing = two
windows).

`unreadable` slots are deliberately NOT repaired: that is a credential-ACCESS fault, and a re-login
would spend a human-visible window then file the result somewhere still unreadable.

**NEXT ACTION — box 1, and it needs the OWNER, not more code (re-specified 19:20; see the box for
the measurements).** Do NOT go run `unbrowse settings --auto-publish off`: **there is no `settings`
verb** in 11.1.9 — the CLI is three verbs and `eval` is read-only. And the hazard the box guards is
REAL and DEFAULT-ON: `auto_publish_checkpoints` defaults true (`cli.js:76008`) and fires **on
close/sync** (`cli.js:76106`, `:248301`), while the drive must call `act close`. Our half is pinned
(the drive emits neither `act sync` nor `build publish`, 2 tests + neuter, `66398d58`); the other
half is a change to the OWNER's unbrowse config — outside this project — or a redesign of the
drive's teardown. **That is the owner's call and it gates everything after it.**

Then, and only with the owner present: the LIVE end-to-end run. `driveConsent` has still **never**
been run against the real consent page — the one thing fixtures cannot establish. Still open after
that: surface `reauth-needed` to the owner as a push/banner.

**Do NOT create the repair flag file to "test it".** Arming it opens a visible browser window
unattended, and that is the human's act.

### WHERE the repair leg goes — read this BEFORE writing the wiring (measured 18:40)

"Wire it into the tick" is the obvious phrasing and it is **wrong as written**: two of the three
candidate homes carry docstrings that forbid exactly this, so jamming `driveConsent` into either
would violate a stated design decision rather than implement one.

| Candidate | Its own contract | Verdict |
|---|---|---|
| `tick.ts::runTick` | *"The Phase-F browser tiers (cookie capture, seeded-slot bootstrap, the REAUTH 'only human step') are **deliberately NOT invoked here** — this tick is the autonomous continuity core"* (`:527-529`) | **NO** — browser-free by design |
| `supervisor.ts` | *"It heals **NOTHING** — the tick actuates"* (`:5`) | **NO** — detect/report only |
| `server-tick.ts` | the R16 flag gate itself (`OAUTH_TICK_FLAG`, `oauthTickEnabled()`) | the **call site**, not the logic |

**So the leg needs its own module** (`reauth-repair.ts`), invoked from `server-tick.ts` AFTER
`runTick` returns, behind its **own** flag defaulting OFF — separate from `OAUTH_TICK_FLAG`,
because opening a headed browser unattended is a strictly bigger promise than rotating a
already-captured slot, and the two should not be armed by one switch.

**A concrete prerequisite the card missed:** the tick **counts** dead-refresh alternates
(`deadRefresh++`, `tick.ts:567`) and never records WHICH. A repair needs the email. Note the
neighbouring constraint before "fixing" that by logging it: the decision line is deliberately
*"counts only; never an email, never a token"* (`:575`) — so the identities may travel in the
RESULT, never in the log.

**And it fires on ONE of the two reasons only.** `slot-unreadable` is a credential-ACCESS fault
(the process cannot reach the keychain) — driving a consent cannot fix it, and attempting one
would open a browser to repair something a browser has no bearing on. Only `refresh-dead` is
repairable here. When the drive is armed, `tick.ts:581`'s message *"a human must re-login"* also
becomes stale for that branch and must change with it.

### The drive is UNIVERSAL now (owner directive, 2026-07-31): structure, not words

The first cut matched Italian and English copy and hardcoded `--browser chrome`. Both are gone.
What the drive reads, and what it measured before trusting any of it:

| Question | Decided by | Language-independent? |
|---|---|---|
| is this a bot wall? | no activatable control + a tiny tree (Cloudflare's brand tokens only corroborate) | yes |
| are we logged out? | an INPUT role in the AX tree, or `cookies_injected == 0` | yes |
| which control approves? | role-filtered candidate SET; localized names only ORDER it, never filter it | set: yes · order: hints |
| did it work? | our own OAuth `state` came back | yes — protocol |

**Two measurements killed the obvious design; do not re-derive them:**
- **`act go`'s `url` field ECHOES THE REQUEST.** Sent `http://wikipedia.org`, got the identical
  string back while the browser was on `https://www.wikipedia.org/`. So the natural dead-session
  signal — "did the app redirect us to /login?" — **does not exist**.
- **No unbrowse verb reports the current URL.** `eval inspect` rejects a session id, `eval status`
  returns only `{id,createdAt,chromePid,targetAlive}`, `eval resolve` needs an intent. Checked.
- `act go` **does** return `page.text`, so the old separate `eval text` before the click was a
  wasted round trip on every drive.
- **The browser needs no naming.** `act go` with NO `--browser` sweeps every installed browser
  itself — observed harvesting Chrome, Chromium AND Firefox in one call, and `github.com/login`
  then rendered the logged-IN dashboard. The old `--browser chrome` was NARROWING a wider sweep.
  Profile targeting is now an ESCALATION, entered only when the default lands on a sign-in page.

**The honest limit, stated rather than hidden:** a buttons-only consent screen and a buttons-only
"continue with Google" screen have the SAME structure. Nothing in the AX tree separates them
without reading words. So the click is a HYPOTHESIS and the OUTCOME decides; and when several
controls cannot be ranked at all the drive REFUSES (`consent_ambiguous`) rather than gambling —
on a consent screen the wrong click is "deny", and a silent deny reads exactly like a broken
selector afterwards.

**Two bugs the tests caught before any production run** (both now fixed + neutered):
1. **`\b` does not work on non-Latin scripts.** JS word boundaries are defined against
   `[A-Za-z0-9_]`, so `\b承認\b` and `\bразрешить\b` can NEVER match — the hint list silently
   disabled every CJK/Cyrillic/Arabic/Devanagari locale while looking like it covered them.
2. **I out-tightened the downstream contract.** `extractCode` required the OAuth state
   unconditionally, and I wrote "strictly better" in the comment. It is not: the CSRF check is
   already enforced against the server-side verifier, we generate the navigation ourselves, and
   `reauth-flow` records that the callback rendering HAS varied. It now mirrors `completeReauth` —
   a state that is PRESENT must MATCH; a bare code is accepted.

**SUPERSEDED — do NOT carry forward:**
- *"the account is selected by CHROME PROFILE, so pass `--browser chrome --browser-profile X`"* —
  **narrowed too early.** The profile is the escalation, not the entry point; naming a browser
  disables unbrowse's own multi-browser sweep, which is wider than anything we would hardcode.
- *"match the authorize control by name (`/authorize|autorizza/`)"* — **replaced by role-shape.**
  Names now only ORDER an already-complete candidate set.
- *"read the final URL from the browser's DevTools port"* — **rejected by the owner**, and rightly:
  it reaches past unbrowse and couples us to how unbrowse manages Chrome today. Measured working
  (`/json/list` did report the true post-redirect URL) and deliberately NOT used.
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

## MEASURED 2026-07-31 — headed real-Chrome clears Cloudflare; headless does not

Run against the live site before writing step (c), because the whole design rests on whether the
browser leg is reachable at all. `unbrowse` v11.1.9 drives the **owner's real installed Chrome**
(`--browser chrome|arc|brave|edge|vivaldi|opera|dia|chromium` + `--browser-profile`), not
Playwright's bundled Chromium — so the Chrome-for-Testing detection that blocks the janitor's
script does not apply. **No Firefox in this build's flag set**, contrary to the recommendation the
owner had heard; that is a different generation of the tool.

| run | result |
|---|---|
| headless, real Chrome, `--share-accounts` | `[auth] extracted 24 cookies for claude.ai … injected 24 cookie(s), re-navigated authenticated` — then the page is Cloudflare's *"Esecuzione della verifica di sicurezza"*, **`Ray ID: a23dc4655d41ee61` identical across three consecutive reads** — a stuck interstitial, not a check in progress |
| **`--headed`**, same profile clone | **PASSES** — the real page renders |

Two consequences, both load-bearing:

1. **Step (c) MUST run headed.** This is a real constraint, not a preference: an unattended
   re-capture will put a visible Chrome window on the owner's desktop. Acceptable on his own
   machine; record it rather than discover it.
2. **Cookie injection alone did NOT yield a logged-in claude.ai** — the headed page rendered the
   logged-OUT landing (*"Continua con Google / Continua con email / Continua con SSO"*). So the
   taught route is not decoration: an actual login in a headed window is what seeds the session,
   which is exactly what `unbrowse act auth` is for and exactly the owner's "learn it once".

This half-vindicates the janitor's script: its `audit §3-D` claim was correct, and its choice of a
real persistent profile was correct. What it lacked was a way to RE-SEED that profile once the
session decayed — which is the hole this card closes.

`--share-accounts` was used throughout: unbrowse clones the profile
(`isolated_clone: true`) so the owner's live Chrome session is never driven or locked.

### Multi-account: the lever is `--browser-profile`, NOT unbrowse's own profile store

The obvious reading — "unbrowse keeps profiles, so it keeps one per account" — is **wrong**, and
the design would have failed on it. Its own store is keyed by **DOMAIN**
(`~/.unbrowse/profiles/krea.ai`), i.e. one session per site. Three simultaneous claude.ai
identities are impossible that way.

What *does* work is addressing the owner's **real Chrome profiles**, which are keyed by account:

| Chrome profile | account | rotator slot? | claude.ai session (measured headed) |
|---|---|---|---|
| `Default` | fmuaddib@gmail.com | **yes — the dead slot**, currently live | **logged OUT** |
| `Profile 1` | emasoftfloss@gmail.com | no | not tested |
| `Profile 2` | emanuele.sabetta@gmail.com | yes | **LOGGED IN** — full app UI rendered |
| `Profile 3` | gaetano.sabetta@gmail.com | no | not tested |

`--browser chrome --browser-profile "Profile 2"` returned the authenticated app (Home / Code /
Chats and tasks / Projects / Recents) where `Default` returned the logged-out landing page. Same
domain, same command, different identity — so the per-account capture the janitor's script wanted
(`chrome-profile-<email>`) is available here using profiles that are already logged in and are
the owner's real, undetectable Chrome.

**Two gaps this exposes, both concrete:**

1. **`ipazia.emasoft@gmail.com` has NO Chrome profile at all.** One must be created and logged in
   before its slot can ever be re-captured.
2. **`Default` (fmuaddib) is not logged into claude.ai** even though fmuaddib is the *live Claude
   Code* account — the OAuth token and the browser session are separate things. So repairing the
   dead fmuaddib slot needs a browser login first; it is not merely a matter of pointing at the
   right profile.

Note also that the cookie-extraction log line is profile-agnostic (`extracted 24 cookies … from
Chrome user data`, same count for both profiles) while the *profile clone* is per-profile — so
trust the rendered identity, not the extraction count, when checking which account a session is.

## Verification

- A slot whose refresh is dead is repaired without a human, and `reauth-needed` clears.
- `bash scripts/with-node.sh npx tsc --noEmit` → 0 · `… yarn test` → full suite green.
- Every new guard carries a recorded **neuter run** (break it → the named test fails; read the
  test COUNT, never the exit code).

## Acceptance checklist

- [ ] Box 1 — **RE-SPECIFIED 19:20, the command it named DOES NOT EXIST and the hazard is REAL
      and DEFAULT-ON.** Measured in unbrowse 11.1.9 (`/opt/homebrew/lib/node_modules/unbrowse`):
      - **There is no `settings` verb.** The CLI is exactly three verbs (build/act/eval);
        `unbrowse settings --help` falls through to the root help. `eval settings`/`eval config`
        exist but `eval` is READ-ONLY by the CLI's own stated contract, and `~/.unbrowse/config.json`
        holds 8 keys, none publish-related. So "run auto-publish off then read it back" is not a
        thing that can be done, and an earlier note here calling publish "explicit per-skill" was
        HALF RIGHT — that is true of `build publish`, and misses the checkpoint path entirely.
      - **`auto_publish_checkpoints` defaults TRUE** — `cli.js:76008`
        `capturePipeline.auto_publish_checkpoints !== false` (absent ⇒ ON). `cli.js:76106`
        `decideCheckpointPublish(domain)` gates it, and its disabled-branch reason reads
        *"Auto-publish after sync/close is disabled in local settings"*; `cli.js:248301` says
        *"…will not auto-publish on close/sync"*. The root help calls `act sync` *"queues background
        index + publish"*. **`act close` is also a checkpoint, and the drive must call it.**
      - **Empirically NOT triggered so far**: after today's live consent-page drives,
        `~/.unbrowse/profiles/` holds only `krea.ai` (+ a `.bak`) — no claude.ai/anthropic route;
        `skill-cache` has one unrelated entry; no trace mentions `oauth/authorize`. That is an
        observation about outcomes, NOT a guarantee, and must not be read as one.
      - **PINNED, the half that is ours** (`tests/unit/oauth-rotator-reauth-drive.test.ts`): the
        drive emits neither `act sync` nor `build publish` on the happy path OR the escalation path
        (which checkpoints more than once). Neuter — insert an `act sync` before the close — reds
        exactly those 2.
      - **STILL OPEN, and it is the OWNER's call, not mine:** `act close` remains a checkpoint with
        auto-publish default-ON. The only real mitigations are (a) turning
        `auto_publish_checkpoints` off in the owner's unbrowse config — OUTSIDE this project, and
        a change to their tooling I must not make unilaterally — or (b) a design change to the
        drive's teardown. **Do not arm the repair flag until this is decided.**
- [x] ~~One login route taught per rotator account; replay re-seeds `chrome-profile-<email>`~~ —
      **superseded by measurement.** Nothing needs teaching per account: `act go` with no
      `--browser` already harvests cookies from every installed browser, and the profile is an
      escalation the drive enumerates itself. The box assumed a per-account capture step that the
      tool makes unnecessary.
- [x] The consent drive is language-independent and browser-agnostic — decided by AX role shape,
      not by copy; no `--browser` on the autodetect path. 44 tests, 7 neuters incl. the one that
      re-creates the `\b` non-Latin bug and reds the Japanese case (`fde71e17`).
- [x] Server tick re-captures a dead slot on `reauth-needed`, targeting the named account —
      `511de445` (the survey now names the emails) + `d45e050b` (`repairOneDeadSlot`, 3 gates,
      19 tests / 6 neuters) + `dfa2cf06` (wired into `runOneTick`, 7 tests / 4 neuters). Built and
      called; NOT armed — the flag file is absent by default and creating it is the human's act.
- [ ] `driveConsent` proven against the LIVE consent page, with the owner present (never run
      end-to-end; the one thing the fixtures cannot establish)
- [x] ~~Wrong-account refusal pinned by a test + a recorded neuter~~ — **already true**, by
      construction and tested (`reauth-flow.ts:101`; test `:211`, `:270`). Struck rather than
      deleted: the box was aimed at the janitor's Python failure mode, and knowing our path never
      shared it is the reason step (c) is the only new work.
- [ ] `reauth-needed` reaches the owner as a push/banner when it still cannot self-repair
- [x] `tsc` clean + full suite green, both DATED in this card — **2026-07-31 19:05**: `tsc
      --noEmit` exit 0 / 0 lines; `yarn test` 313 files, 4524 passed, 2 skipped. ONE failure,
      `pillar-graph-cli` → `board is byte-identical`, a 5 s subprocess timeout under parallel load:
      no import path exists from `lib/oauth-rotator` to that CLI (grepped) and it is 20/20 twice in
      isolation, so it is the known flake and not this work.

## Approval log

- 2026-07-31T17:41:08+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent. The owner
  directed the design in-session ("unbrowse records a login route and can playback it … it just
  needs to learn the route once") after being told the blast-radius consequence.
