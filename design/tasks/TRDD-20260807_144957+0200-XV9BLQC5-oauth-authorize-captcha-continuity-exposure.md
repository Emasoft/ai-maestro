---
trdd-id: XV9BLQC5
title: A CAPTCHA appeared on the claude.ai OAuth authorize screen — measure and close the continuity exposure
column: todo
created: 2026-08-07T14:49:57+0200
updated: 2026-08-07T14:49:57+0200
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

**This is today's false alert, exactly.** `fmuaddib@gmail.com` held a healthy cookie and minted
itself with **no human involvement** — and the live path would have declared it human-blocked.
Only `ipazia` had genuinely lapsed. The alert was right about one of two accounts and stated both
with equal confidence.

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

**POSITIVE CONTROL (the decisive measurement).** Slot `emanuele.sabetta@gmail.com` reads
`captured=2026-07-23T18:04:32+0200` with `token-expiry=~6.9h`. That slot has been carried **15
days across ~45 browserless refresh cycles** without ever loading the authorize screen. The
refresh chain demonstrably works and never meets the captcha.

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

## Approval log

- 2026-08-07T14:49:57+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier-0 derived EHT of TRDD-MN0Q1IA2, within the authoring agent's own scope. No
  approval request was sent.

## Acceptance

- [x] The janitor issue is filed with both asks (a) and (b), citing the measured evidence above —
      janitor#228, after proving the guard absent in all 13 cached versions (0.60.1 → 2.5.1).
- [ ] The positive control is re-measured after the janitor responds (a weeks-old `captured` date
      with a live `token-expiry` still proves the browserless chain).
- [ ] The Cloudflare-vs-dead-token distinction is reflected in ai-maestro's own alert text, or an
      explicit note records that it is blocked on the janitor side.
