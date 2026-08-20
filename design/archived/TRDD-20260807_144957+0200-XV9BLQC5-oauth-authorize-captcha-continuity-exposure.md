---
trdd-id: XV9BLQC5
title: A CAPTCHA appeared on the claude.ai OAuth authorize screen — measure and close the continuity exposure
column: completed
created: 2026-08-07T14:49:57+0200
updated: 2026-08-20T08:00:13+0200
current-owner: ai-maestro
project-id: ai-maestro
task-type: infra
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-07T14:49:57+0200
derived: true
derived-kind: eht
parent-trdd: MN0Q1IA2
priority: 1
severity: high
effort: medium
labels: [oauth-rotator, continuity, cross-repo, detection-gap]
external-refs: [https://github.com/Emasoft/ai-maestro-janitor/issues/228]
relevant-rules: []
release-via: none
---

# A CAPTCHA appeared on the claude.ai OAuth authorize screen

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-07

- **BOX 3 DONE (2026-08-20, 9793fca6 + 5a837221) — and the section below it is STALE PROSE.**
  `lib/oauth-rotator/cascade.ts` **does not exist**: deleted 13 days ago (b50cf390) resolving
  this card's own WIRE-or-DELETE decision in the DELETE direction, with
  `DEFAULT_MAX_REFRESH_FAILURES` rehomed to `supervisor.ts`. `tick.ts`'s alert text was
  corrected in that same pass. So `## The ai-maestro half` describes a removed module — do NOT
  act on it; its zero-caller table is a historical measurement, not a live gap.
- **The live defect was the SECOND copy of the same false claim** (corrected in one place, left
  standing in the other): `supervisor.ts`'s `cookie-leg-stuck` message asserted *"its refresh
  path is dead and only a human can renew it"* — self-contradictory in place (the alert CODE
  names the cookie rung its TEXT denies) and overclaiming on both axes from evidence that
  establishes neither. Fixed by CONSUMING the janitor's own SSOT: `slotFacts` already parses
  the object carrying `last_refresh_failure`, so the cause is a field read — no new I/O, no
  third taxonomy. Per-cause text now says DEAD only for `credential-dead`, RETRYABLE for
  transport/network/malformed, and UNKNOWN for absent or off-vocabulary values.
- **Neuters, after the fix was committed:** stale-cause guard → 1 red; vocabulary filter →
  1 red; transport-refused case → 1 red. The first reddened NOTHING at first (the guard's
  refresh-token half was unpinned) — a test was added rather than the gap being narrated.
  39/39, tsc 0, lint 0.
- **NEW CARD FILED — TRDD-Y1ZWU998 (found, deliberately not fixed here):** `tick.ts:829-836` ports the
  janitor#228 defect into OUR TypeScript — `refreshOauthToken` returns null for ANY failure
  (timeout/DNS/Cloudflare/malformed alike), so a transient blip writes `refresh_dead_fp` and
  arms the retry ban at `:825` that un-gates only on a human re-login. The false claim turned
  into real behavior: a benign, retryable failure made unrecoverable without a human.

- **RE-MEASURED 2026-08-20 01:45 (box 2) — the control NO LONGER HOLDS, and that is the finding:**
  `rotator.py list` now reads ALL THREE slots with a stale store expiry —
  fmuaddib captured=08-07 expiry≈−155 h · emanuele.sabetta captured=07-23 expiry≈−201 h ·
  ipazia (LIVE) captured=08-07 expiry≈−124 h — while the live account demonstrably works (this
  fleet is running on it) and the server tick beats fresh every 60 s, reporting
  `reauth-needed / refresh-dead` CONTINUOUSLY since 2026-08-07. Reading: the live credential is
  kept fresh by Claude Code itself, outside the store; the STORE-level browserless chain the
  original control proved (45 cycles, 15 days) has stopped for the two alternates because their
  REFRESH tokens are dead — precisely the state only the unwired cookie rung (RENEW_COOKIE)
  could repair browserlessly. janitor#228 is CLOSED verified-fixed at their HEAD (challenge
  detection + Cloudflare-vs-dead-token both landed; installed 3.3.16 may predate the release).
- **USER ACTION REQUIRED (surfaced in the session summary):** the two alternate slots
  (fmuaddib, emanuele.sabetta) have dead refresh tokens and need a human re-login
  (`rotator.py capture` per slot) — no programmatic path exists while no live claude.ai cookie
  is available; shared-credential work is USER-only by the D3 floor.

**Measured, not inferred. The captcha does NOT break unattended continuity. The detection gap it
exposes is the real defect, and it is in the janitor's tree — cross-repo, issue only.**

- **DONE:** janitor issue filed — <https://github.com/Emasoft/ai-maestro-janitor/issues/228>
  (both asks: seed-path challenge DETECTION, and a Cloudflare-vs-dead-token distinction in
  `_keepalive_refresh`). Absence of the guard was proven across **all 13 cached versions**
  (0.60.1 → 2.5.1) before filing, per this session's own cross-repo lesson.
- **NEXT ACTION — ai-maestro's own half, and the diagnosis was WRONG until measured.** The false
  "a human must re-login" alert is NOT because we cannot see the cookie layer. **We can, we
  implemented it correctly, and we never wired it.** See `## The ai-maestro half` below. The fix is
  to route the live decision through `cascade.ts` (or delete it), NOT to add a cookie check.
- The rotator itself is the janitor's; we do not edit its tree. `cascade.ts` and `tick.ts` are OURS.

## The ai-maestro half — a correct fix that was never called (measured 2026-08-07)

`lib/oauth-rotator/cascade.ts` implements the full 3-rung cascade including **`RENEW_COOKIE`**, and
its own comment records that TRDD-J9TM3WQK added it specifically to stop the jump straight to
REAUTH: *"live claude.ai cookie mints a fresh refresh with NO human (RENEW_COOKIE); only with NO
cookie is the human nudged … fixed the earlier jump straight to REAUTH that skipped the cookie
rung"* (`cascade.ts:110-112`).

**That module has ZERO production callers.** Measured, with a positive control so a broken search
cannot produce the same zero:

| symbol | production callers |
|---|---|
| `cascadePlan` | **0** |
| `cascadeSummaryLine` | **0** |
| `classifyCascade` | **0** |
| `oauthOf` (CONTROL) | **19** |

The LIVE path re-derives the taxonomy inline and never consults a cookie:

```
tick.ts:1187   else if (deadRefresh > 0) { nextAction = 'reauth-needed'; reason = 'refresh-dead' }
tick.ts:192    `reauth-needed: … alternate slot(s) have a dead refresh and are expiring —
                a human must re-login`
```

`grep cookie lib/oauth-rotator/tick.ts` returns nothing in the decision path. So the live claim
that a human is required is made **blind to the cookie layer**, by a code path that sits beside a
correct, tested implementation of exactly that check.

**This is today's false alert, exactly.** Of the two slots it declared human-blocked, ONE held a
healthy cookie and minted itself with **no human involvement**; only the other had genuinely
lapsed. The alert was right about one of two accounts and stated both with equal confidence.
(Accounts deliberately unnamed — this repo is PUBLIC and the slots are the owner's personal mail
addresses. See `## PII note` at the end.)

**Why this went unnoticed:** a fix landing in an uncalled module is indistinguishable from a fix
landing in a live one — the tests pass either way, because the tests call the module directly.
TRDD-J9TM3WQK's fix is real, correct, and inert. Recorded previously that the two copies' constants
had **already drifted 3× apart**, which is the other cost of the duplication.

**Do NOT "fix" this by adding a cookie check to `tick.ts`.** That would make a THIRD copy of the
taxonomy. Either route the live decision through `cascade.ts`, or delete `cascade.ts` and own the
inline copy deliberately — but not both.

## Problem

The USER reported, 2026-08-07: *"they added a captcha.. strange, there was never a captcha in the
authorize screen.. i solved it but this means a continuity problem"*.

The worry is exactly right in shape: if the screen that mints OAuth tokens now needs a human, the
maximum unattended fleet runtime collapses from the cookie lifetime (~28 days) to the access-token
lifetime (~8 hours).

## Root cause — and why the feared collapse does NOT happen

The rotator has **two** token-acquisition legs, using **different grants on different hosts**:

| leg | grant | mechanism | host | captcha exposure |
|---|---|---|---|---|
| **RENEW** — every ~8h, unattended, keeps the fleet alive | `refresh_token` | plain `urllib` POST, `rotator.py::_keepalive_refresh` ~:1288-1325 | `platform.claude.com/v1/oauth/token` | **NONE** — no browser is involved at any point |
| **SEED / re-seed** — rare | `authorization_code` | Playwright/Chrome drives `/oauth/authorize`, `slot_capture_browser.py:341` | `claude.ai` | **YES — this is where the captcha is** |

**POSITIVE CONTROL (the decisive measurement).** One slot reads `captured=2026-07-23T18:04:32+0200`
with `token-expiry=~6.9h` — carried **15 days across ~45 browserless refresh cycles** without ever
loading the authorize screen. The refresh chain demonstrably works and never meets the captcha.
Reproduce with `rotator.py list`: an old `captured` beside a live `token-expiry` IS the proof.

Seeding was **already** human-only: `CLAUDE_ROTATOR_AUTO_BOOTSTRAP` defaults **OFF**
(`rotator.py:2361`), so the unattended daemon never reaches the browser path at all.

**Conclusion: the captcha raises the cost of a path that already required a human. It does not
shorten unattended runtime.**

A plausible and testable alternative explanation for the captcha's sudden appearance: today's own
traffic. The broken Chrome-for-Testing reauth leg produced 910 cooling-down cycles and repeated
bootstrap windows — exactly the risk-score pattern that gets a challenge served. If so it is
self-inflicted and transient, and the mitigation (real Chrome; stop the hammering) has already
landed. **This is a hypothesis, not a finding — it is not verified.**

## The real exposure (three items — the captcha itself is not the cliff)

1. **ZERO challenge detection exists anywhere in the rotator.** Verified by grep across all of
   `scripts/oauth_rotator/`, after filtering the PKCE false-positive family (`code_challenge`,
   `code_challenge_method` — "challenge" there is the S256 hash and has nothing to do with humans).
   A captcha on the seed path therefore surfaces as a generic capture failure or timeout, and the
   operator is told the wrong cause. This is the same defect family as the false
   *"only a human can renew it"* alert (4th such message in one session).

2. **The refresh chain is now the ONLY unattended path, and it is rotating + single-use.**
   `_keepalive_refresh` correctly keeps the old token when the response omits a new one, but a
   succeeded-server-side / failed-locally write breaks the chain — and recovery now costs a
   human-solved captcha rather than a click.

3. **`_keepalive_refresh` fails SOFT — it returns `None` on ANY error, Cloudflare included.** The
   token endpoint is itself behind Cloudflare: the code carries a hand-picked
   `User-Agent: claude-account-rotator` *precisely because* urllib's default is 1010-banned
   (verified 2026-06-09, recorded in the function's own comment). If Cloudflare tightens on
   `platform.claude.com` the way it just did on `claude.ai`, **refresh dies silently**. That is the
   actual continuity cliff, and nothing would report it.

## Proposed fix

Cross-repo — the rotator belongs to `Emasoft/ai-maestro-janitor`. File an issue asking for:

- **(a) Challenge detection on the seed path.** `slot_capture_browser.py` should recognise a
  captcha / Turnstile / "Performing security verification" interstitial and report it as its own
  distinct outcome, so a seed failure is diagnosable instead of a generic timeout.
- **(b) A Cloudflare-vs-dead-token distinction in `_keepalive_refresh`.** Returning `None` for a
  403/1010 (a *transport* refusal, retryable, alarming) is not the same event as returning `None`
  for a genuinely revoked refresh token (terminal, human-actionable). Fail-soft should stay; the
  two causes must be distinguishable in the surfaced alert.

Neither is an ai-maestro code change. What ai-maestro owns is the CONSUMER side of (b): the
server's alert text must not claim a human is required when it cannot see which layer failed.
That is the already-owed false-alert TRDD, and it is the same root cause.

## Verification

- `env -u CLAUDE_PLUGIN_DATA python3 "$ROT/rotator.py" list` — slots + expiry; a slot whose
  `captured` date is weeks old with a live `token-expiry` proves the browserless chain is running.
- `env -u CLAUDE_PLUGIN_DATA bash "$ROT/lifetime-status.sh"` — cookie-vs-OAuth staggering.
- `ROT=~/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-janitor/2.5.0/scripts/oauth_rotator`

**Do NOT call the refresh grant by hand to "test" it** — the tokens are rotating and single-use, so
a manual call races the daemon and can break the very chain this card is about.

## Estimated risk

LOW for this repo (no code change here). The dependency is the janitor's response to the issue.
Residual risk is item 3 above, which is unmitigated until (b) ships: a Cloudflare tightening on the
token endpoint would take the fleet down with no diagnostic.

## PII note — the owner's personal email addresses are in this PUBLIC repo (found 2026-08-07)

Surfaced while writing this card, and it is a USER DECISION, not an agent one.

**Measured:** `Emasoft/ai-maestro` and upstream `23blocks-OS/ai-maestro` are both **PUBLIC**
(`gh repo view --json visibility`). The rotator work necessarily discusses per-account slots, and
those slots are the owner's personal mail accounts, so account names have been written into TRDDs
and source comments as ordinary technical detail.

- **Already PUBLIC** on `fork/governance-rules`: **2 tracked files**, carrying **5 distinct**
  `@gmail.com` addresses. One of them is a *different surname* from the owner's own — i.e.
  plausibly a **third party**, which is a stronger obligation than the owner's own address.
- **NOT yet public: 222 local commits**, including today's, which is why redacting forward is
  worth anything at all.

**Done here:** every account identity this card and today's `tick.ts` edit introduced is removed.
The identity carried none of the meaning — "one of two slots" says the same thing.

**NOT done, deliberately — this needs the USER:**
1. The already-pushed occurrences cannot be removed by editing forward. Removal means a history
   purge plus a force-push, which is RULE 0.6 territory (**forbidden** without the owner's exact
   written command) — and GitHub retains orphaned commits regardless, so even that is not a
   complete erasure.
2. The remaining unpushed commits should be swept BEFORE the next push, which is the one moment
   this is cheap. Worth doing as its own pass rather than a drive-by.
3. The third-party address deserves its own decision.

**Going forward:** name a slot by its ROLE (`the live account`, `slot A`) and never by its address.
An account identity has never once been load-bearing in this corpus.

## Approval log

- 2026-08-07T14:49:57+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier-0 derived EHT of TRDD-MN0Q1IA2, within the authoring agent's own scope. No
  approval request was sent.

## Acceptance

- [x] The janitor issue is filed with both asks (a) and (b), citing the measured evidence above —
      janitor#228, after proving the guard absent in all 13 cached versions (0.60.1 → 2.5.1).
- [x] The positive control is re-measured after the janitor responds — 2026-08-20 01:45, ADVERSE:
      all three slots stale in the store (see STATE); the re-measure ran and its result is recorded,
      which is what this box asks. The adverse half feeds the box below.
- [x] The Cloudflare-vs-dead-token distinction is reflected in ai-maestro's own alert text —
      2026-08-20 (9793fca6): per-cause text consuming the janitor's `last_refresh_failure`,
      DEAD only for `credential-dead`, RETRYABLE for transport/network/malformed, UNKNOWN
      otherwise. Not blocked on the janitor: #228 shipped their classification.
- 2026-08-20T08:00:13+0200 — CORRECTION (append-only, the one exempt section). This card's 01:45 re-measure
  surfaced "the two alternate slots have dead refresh tokens and need a human re-login". MEASURED
  at 08:00 from the janitor's own state.json, that is WRONG in the direction that costs the USER
  work: all three slots carry `last_refresh_failure: network` — the owner's classifier never
  judged any credential dead — while our `refresh_dead_fp` is SET on all three. The re-login
  claim was read off `reason: refresh-dead`, the verdict TRDD-Y1ZWU998 shows we manufacture from
  transport failures. No re-login is established as necessary. Tracked on Y1ZWU998 (priority 0).
