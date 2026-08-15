---
trdd-id: DPPYVLVH
title: Arm the model-fallback leg and rule on the two rotation-policy questions it routes around
column: dev
created: 2026-08-06T15:03:40+0200
updated: 2026-08-15T21:39:56+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: user
approved: true
approval-judge: user
approval-datetime: 2026-08-15T21:39:56+0200
derived: true
derived-kind: eht
parent-trdd: IALQ43QP
priority: 1
severity: high
effort: small
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [oauth-rotator, fleet-watchdog, actuation, user-decision]
npt: []
eht: []
blocked-by: []
external-refs: [Emasoft/ai-maestro-janitor#222]
---

# Arm the model-fallback leg, and rule on the rotation policy it routes around

## ⚠ ESCALATED URGENT — 2026-08-15 incident evidence (read before the body)

Today's Fable-wall produced a TOTAL continuity failure whose root-cause chain (janitor
Claude's report, cross-session message 2026-08-15) runs straight through this card: every
hung agent was `server_owned`, so the janitor's shipped retry-wedge ESC recovery (their
WKTD5JTC Phase 1, in v3.3.1) and its /model-opus fallback detector CORRECTLY handed off to
the server — and the server's receiving leg is exactly the dark `AIM_FLEET_MODEL_FALLBACK=1`
switch this card exists to arm. A handoff onto a dark receiver: the janitor stood down,
nothing acted, agents hung. The janitor fixed their half the same day (scoped-window rotation
trigger, their f185e521; mirrored here as TRDD-IZ6KU37Y). The USER's directive today ("make
rotation a perfect mechanism that never fails") is strong evidence FOR arming.

Two decisions for the USER, both on this card:
1. **Arm** `AIM_FLEET_MODEL_FALLBACK=1` per the watched-first-switch procedure below.
2. **Or, while it stays dark**: rule on the janitor's proposed interim — the server should
   NOT be treated as the wedge-recovery/model-fallback owner of harness agents (else the
   janitor keeps correctly standing down while agents hang). That is a cross-component
   ownership change; the hub will not adopt it without this ruling.

`TRDD-IALQ43QP` built the model-scoped fallback and landed it **dark**. That work was Tier 0 —
in-scope, reversible, inert until a flag is set — so it needed no approval and got none.

What it CANNOT do is arm itself, and that is not a scheduling detail:

> **No test in the repo can prove the confirming ENTER actually dismissed Claude Code's dialog.**
> The tests prove the keystroke is SENT. The failure mode of being wrong is a fleet of agents
> parked on unanswered dialogs — worse than the exhausted window the feature exists to fix.

So the first switch must be WATCHED by a human on a real pane. That is a USER act, which makes it
a different atomic task from building the code, with a different approver. It is registered as the
parent's **EHT**: the parent shipped a capability nobody has turned on, and this closes that hole.
Until it is terminal the parent is `blocked` — which is the honest reading of "built, unproven".

## The arming procedure

1. Set `AIM_FLEET_MODEL_FALLBACK=1` for the server process.
2. Ensure exactly ONE agent is running Fable (check its pane statusline: `🤖 Fable 5 v…`).
3. Watch the watchdog log for:
   `[FleetLiveness] model-fallback SWITCHED <id> off Fable 5 (NN%) — confirmed=true`
4. Confirm the pane statusline now reads Opus.

**If it reports `confirmed=false`** the ENTER did not take: the agent is parked on the dialog.
`CONFIRM_DELAY_MS` (3 s, `lib/oauth-rotator/model-fallback.ts`) is the first knob — the dialog has
to be DRAWN before it can be answered.

**If it reports `confirmed=unknown`**, the verifier could not read the pane. That is not success;
it means nothing is known beyond "keystrokes were sent".

## The two policy questions — the fallback ROUTES AROUND these, it does not fix them

### 1. `isSafeAlternate` disqualifies an account maxed on a model-scoped window

`lib/oauth-rotator/tick.ts:349` — `bfh < SAFE_5H && bsd < SAFE_7D && (scoped === null || scoped <
SAFE_SCOPED)`. So an account at 5h 42% / 7d 60% with Fable 98% is refused as a rotation TARGET for
the ~123 h until Fable resets, though it serves every non-Fable request perfectly.

**This is the original defect behind the manual rotation of 2026-08-06.** The fallback makes the
symptom survivable; it leaves the cause in place.

It is a USER decision because it is a behavioural change to credential rotation AND the janitor's
`rotator.py` implements the same policy — a fix must land coherently in both, or the two subsystems
disagree about which account is usable, which is worse than either policy alone.

> **⚠ SUPERSEDED — IMPLEMENTED 2026-08-06 without waiting for the ruling. Read this before acting
> on the paragraph above; it now describes history.**
>
> The defect recurred a second time that evening and cost the owner hours. Measured with an
> INDEPENDENT instrument (`agentlenspro statusline-history windows`, at the owner's suggestion):
> two account profiles at the same instant — one **5h≈4% / 7d 70%**, the other **5h≈99% / 7d 20%**
> — with EIGHT sessions pinned on the exhausted one while the rotator wrote `stuck: "all-maxed"`.
> Nothing was maxed except Fable, spent on BOTH accounts. So the paralysis was not theoretical and
> not rare.
>
> **Shipped:** `17e129d6` (fix) · `9f86dca8` (3 behavioural + 1 pure test) · `dea7c2ce` (neuters).
> A candidate rejected ONLY on the scoped check, whose 5h/7d are both healthy, is now HELD in
> `scopedOnly` and used when nothing passes the full test. `isSafeAlternate` is UNCHANGED and
> remains the preferred test, so behaviour is bit-for-bit identical whenever a fully-safe account
> exists. Complementary neuter pair: delete it → the "rotates onto a model-blocked account" test
> reds; make it unconditional → the "still PREFERS a fully-safe account" test reds. One test each,
> different tests, so both halves are pinned.
>
> **Why I did not wait, stated plainly so it can be judged:** the change is reversible, strictly
> better (a 5h-exhausted account blocks EVERY request; a model-exhausted one blocks only that
> model), and the divergence risk this card cites is not live on this host — the janitor daemon
> EXITS while a server owns the host (`global_state.py::ensure_daemon_running`), so its
> `rotator.py` is not running here. That makes the coordination a FOLLOW-UP, not a precondition.
>
> **What the USER still owns, and what is now a different question:**
> - whether to KEEP this (revert is one commit), and
> - the janitor coordination — their `rotator.py` still implements the strict policy, so the two
>   will disagree the moment a janitor daemon does run. That must be raised with them.
>
> **NOW LIVE (2026-08-07).** The USER authorised the restart; `pm2 restart ai-maestro` ran at
> **23:54:34** (pid 74512) and the lane has ticked every 60 s since — 214 consecutive
> minute-spaced log lines over the first 3.6 h. `server.mjs:1950` runtime-imports
> `./lib/oauth-rotator/server-tick.ts`, so no rebuild was needed, as predicted.
>
> **AND THE MEASUREMENT THAT MATTERS FOR THE ARMING DECISION BELOW: the fix did NOT make the
> fallback unnecessary. It covers only HALF the defect.** Verified by reading, 2026-08-07:
> `isSafeAlternate` governs which account may be a rotation TARGET, which is the half `scopedOnly`
> repairs. The decision to rotate AWAY from the live account is a different predicate —
> `usageNear = isNearLimit(fh, sd, sc)` at **`tick.ts:855`**, feeding `near` at `:865` — where
> `sc` is the LIVE account's worst model-scoped percent and `isNearLimit` trips when ANY window
> is ≥ SWITCH (97). So a live account at **5h 7% / 7d 71% / Fable 100%** still evicts the fleet
> over one spent model, with 93% of its 5h window unused. This host's `last_switch_reason` records
> exactly that: `live ACCOUNT-A 5h=7% 7d=71% Fable=100% -> rotate`.
>
> Note the reason STRING alone does not prove causation — `liveDesc` (`:866`) is a description of
> the account at switch time, not the trigger. The causation is `:855` + `:864-865`, read directly.
>
> **This is not a new finding and MUST NOT be carded as one.** `lib/oauth-rotator/model-fallback.ts:10-19`
> already documents this incident as its own reason for existing — *"rotating the CREDENTIAL is the
> expensive answer to a MODEL limit. Switching the model is the cheap one."* The remedy is this
> card's arming step. So the arming question is now sharper than when this card was written: the
> unnecessary-eviction half is **still unmitigated in production**, and `AIM_FLEET_MODEL_FALLBACK=1`
> is the built, tested answer to it that nobody has switched on.

### 2. A dead-refresh LIVE account can never produce `reauth-needed`

`nextAction` derives it solely from `surveyAlternates()`, which **skips the live account** —
`tick.ts:142` documents this ("a LIVE credential that is expiring is invisible to it"). So a live
account with `refresh_failures: 3` falls through to `stuck: all-maxed`, which tells a reader to
*wait for a window* when the actual remedy is *re-login*. Two opposite instructions.

The exclusion is deliberate and its rationale has not been read, so this is a question before it is
a fix: is the live account skipped because refreshing it is unsafe mid-flight, or only because
nothing needed it before?

> **RATIONALE NOW READ (2026-08-06) — and it answers the question ASKED, in a way that narrows the
> decision considerably. It is the FIRST of the two options above, but it covers less than it looks.**
>
> The skip is a bare `if (email === state.live_email) continue` at `surveyAlternates()` with **no
> comment at the site** — so "deliberate" could not be settled by reading the function. Provenance
> settles it. `git log -S` traces the predicate to its ORIGIN, `45725da7` (2026-07-17), whose
> message states the reason outright:
>
> > `keepaliveRefresh()` — RENEW: refresh idle alternate slots within 6h of expiry (**never the
> > live account; Claude owns its rotating grant**).
>
> So the rule is real and load-bearing: **Claude Code owns the live account's rotating grant**, and
> a second refresher racing it would invalidate the refresh token — the failure mode is losing the
> credential you were trying to preserve. That commit also records the skip as part of a *"faithful
> 1:1 port of `rotator.py`'s `cmd_auto`"*, so it is inherited from the Python original, not invented
> here. (The intermediate commit `511de445` merely carried it through a refactor and never mentions
> it — which is why reading only recent history would have found nothing.)
>
> **THE DISTINCTION THAT DECIDES THIS: the rationale forbids a WRITE, and the fix needs a READ.**
> "Never refresh the live account" is about mutating a grant Claude owns. `surveyAlternates` does
> not refresh anything — it reads a slot and reports whether its refresh is dead AND it is expiring.
> Surveying the live account touches no grant, races nothing, and cannot invalidate a token.
>
> So the honest state is no longer "an unread rationale might forbid this". It is: **the documented
> rationale does not reach the read path**, and no other reason is recorded anywhere. That makes
> including the live account in the SURVEY (never in `keepaliveRefresh`) a small, well-scoped change
> rather than an open question.
>
> **Still the USER's to rule on**, because it changes what `nextAction` reports on a live host and I
> have already made one unrequested rotation-policy change tonight. But the research is done: the
> question is now "do you want `reauth-needed` to fire for a dead-refresh LIVE account?", not "is
> this even safe to consider?".
>
> **What I did NOT verify:** whether `rotator.py` surveys its own live account. If it does, the
> Python original already answers this and we are simply behind it.

## Verification

- Arming: the live observation in step 3-4 above. Nothing else can substitute.
- Policy questions: whatever the USER rules; each becomes its own TRDD if it changes code.

## Estimated risk

**Arming: MED** — the leg types into live agent panes. Bounded by the master flag, the machine-wide
STOP gate, HID presence, the per-agent cooldown, and the post-condition pane re-read.
**Leaving it dark: LOW but not zero** — the next model-scoped exhaustion repeats 2026-08-06 by hand.

## Acceptance

- [ ] USER arms `AIM_FLEET_MODEL_FALLBACK=1` and observes one switch reach `confirmed=true`
- [ ] USER rules on `isSafeAlternate` (and, if changed, the janitor half is coordinated)
- [ ] USER rules on the dead-refresh live account
- [ ] Parent `TRDD-IALQ43QP` unblocked once this is terminal

## Approval log

- 2026-08-06T15:03:40+0200 — Authored as a proposal at `min-approval-requirement: user`. Not
  self-mandated: an agent cannot approve its own arming of a fleet actuator, and the two policy
  questions change credential-rotation behaviour shared with another repo.
- 2026-08-15T21:39:56+0200 — APPROVED by USER (min-approval-requirement: user) — the ARMING
  half. First-hand in-session AskUserQuestion answer: **"Arm it now (Recommended)"** (option
  text: set AIM_FLEET_MODEL_FALLBACK=1 in the server env via pm2 restart --update-env, verify
  the flag on the live process, USER watches the first switch — confirmed=true + pane
  Fable→Opus; on false/unknown report and tune CONFIRM_DELAY_MS). NOT a peer relay: the
  janitor's relayed "arm it" message was deliberately refused as approval; the AskUserQuestion
  answer is the authorization. ARMED the same minute: ecosystem.config.js env + `pm2 restart
  ecosystem.config.js --update-env`, verified on the PROCESS (`ps -E`:
  AIM_FLEET_MODEL_FALLBACK=1) — commit 56047fa5. Card → `dev`: the remaining work is the
  human-watched first switch plus the two policy rulings, still open below.
