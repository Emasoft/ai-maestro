---
trdd-id: MN0Q1IA2
title: USER nine-point fleet-hardening directive — updates cadence, auto-update, rotator, unblock, ledger, agentlenspro
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-07T11:42:43+0200
updated: 2026-08-07T11:42:43+0200
implementation-commits: [5438312f, 71b9f796]
current-owner: ai-maestro
created-by: user
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-07T11:42:43+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: large
labels: [user-mandate, auto-update, oauth-rotator, ledger, agentlenspro, fleet-recovery]
external-refs: [Emasoft/ai-maestro#128, Emasoft/ai-maestro#110, Emasoft/ai-maestro#90, Emasoft/ai-maestro#108, Emasoft/ai-maestro#105]
---

# USER nine-point fleet-hardening directive (2026-08-07)

Issued verbatim as nine "ensure that" items. A MANDATE: the USER is above the tier, so it is born
approved and is authored directly in `design/tasks/`. Three items are DONE and VERIFIED; six
remain. Each item below records what was MEASURED, not what was assumed.

## ✅ 1. Marketplaces update every 4 h, ONE CLI command — DONE `5438312f`

`ABSORBED_DUTY_INTERVAL_MS` 3 h → 4 h. The one-command half was already satisfied:
`RefreshAllMarketplaces` issues ONE argless `claude plugin marketplace update`, never one per agent
(AC1 of TRDD-PE54D95Q, down from 275 process spawns per tick). Confirmed against the CLI's own
help: `update [name]` — "updates all if no name specified".
**Two tests pinned 3 h and BOTH reddened**; both updated (the `setInterval` pin now asserts 4 h AND
not-3 h; the boot-catchup pair still straddles the interval boundary).

## ✅ 2. All plugins auto-update in settings.json, via the safe editor — DONE `71b9f796`

Already true for the 252 marketplaces settings.json DECLARES, already via `editSettings`. The real
gap: **20 marketplaces exist in `~/.claude/plugins/known_marketplaces.json` and are UNDECLARED in
settings.json** — exactly the 12 `autoUpdate:false` + 8 key-absent — carrying **52 installed
plugins**. `ensureMarketplaceAutoUpdate` now declares them with `autoUpdate: true`, source copied
verbatim from the registry.
**Why settings.json is the right lever, measured:** 250 names appear in BOTH files with **ZERO
`autoUpdate` disagreements**, so settings.json is the SOURCE and the registry is downstream. We
never write the harness-owned registry — the settings gate refuses that path and is right to.

## ⏳ 3. The rotator is working — PARTLY VERIFIED

- The `scopedOnly` fix (`17e129d6`) is LIVE and ticking every 60 s since the 23:54 restart.
- `live = ipa***` with `refresh_failures: 0`; `ema***` healthy spare, `refresh_failures: 0`.
- **`fmu***` is still dead: `refresh_failures: 3`, `expires_at` in the past.** The USER's `/login`
  restored the SESSION, not this rotator SLOT — they are different captures.
- **The `tick-stalled` false-alarm fix (`3e3199c0`, TRDD-IGCSDTIU) needs a `pm2 restart`.** Until
  then the supervisor keeps asserting `rotation is effectively OFF` while the tick beats normally.
- OPEN: `last_switch_reason` still records `live fmu*** 5h=7% 7d=71% Fable=100% -> rotate` — the
  rotate-AWAY half (`tick.ts:855` `isNearLimit(fh, sd, sc)`) still evicts the fleet over one spent
  MODEL with 93 % of the 5 h window unused. `AIM_FLEET_MODEL_FALLBACK=1` is the built, tested,
  UNARMED answer (TRDD-DPPYVLVH).

### ⚠ LIVE DIAGNOSIS 2026-08-07 11:47 — the rotator IS working; the `all-maxed` message is not

Caught the exact failure the USER reported, IN PROGRESS, and it is not what the message says.

`oauth-rotator-tick-status.json` at 11:46: `nextAction: reauth-needed`, `reason: refresh-dead`,
`stuck: all-maxed`, `windows: {fiveHourPct: 8, sevenDayPct: 72, scopedModel: "Fable",
scopedPct: 100}`. The log says *"live account is exhausted and no alternate is healthy — all paid
accounts maxed"* at 11:42:52 and 11:44:52.

**The live account is at 5 h 8 % — 92 % FREE.** Nothing is exhausted except **Fable, at 100 %**.
Slot health: `fmu***` (LIVE) blob EXPIRED 27.1 h, refresh_failures 3 · `ema***` valid +7.9 h,
refresh_failures 0 · `ipa***` EXPIRED 6.0 h, refresh_failures 3.

**Two independent defects, and neither is "rotation is broken":**
1. **The message is false in the way that matters.** "live account is exhausted" is emitted when
   `isNearLimit` trips, which it does on ANY window ≥ SWITCH(97) — here only the model-scoped one.
   An operator reading it goes looking for capacity that is already there. Same family as the
   `tick-stalled` false alarm (TRDD-IGCSDTIU): a message asserting the opposite of the state.
2. **Rotation is the WRONG REMEDY here and there is nothing to rotate to.** 2 of 3 credentials are
   dead, and the one live account has 92 % of its 5 h window unused. The correct action is the
   MODEL FALLBACK — move agents off Fable to Opus — which is item 4 of this directive and is built,
   tested and UNARMED behind `AIM_FLEET_MODEL_FALLBACK=1`.

**So the rotator is working and is correctly reporting an unrotatable state.** The USER's original
complaint ("the server failed to rotate the account once again") is explained: there was nothing
healthy to rotate TO, and the thing that would have helped — switching model — was never armed.

Confirming evidence that the rotator is live and converged: it re-stamped `live-identity.json` at
11:43 to the account the USER's `/login` selected, matching `agentlenspro get_account_status`
exactly (fp `9bcd944244b01df2`), and its own attempt stamp was 28 s old when checked.

## ✅ 7. No more headed chrome-for-testing windows — DONE, verified live

**Root cause found and stopped.** `server-tick.ts:225` → `repairOneDeadSlot` → `driveConsent` →
`unbrowse` (Homebrew v11.1.9), which spawns chrome-for-testing. `reauth-drive.ts:29` states
**HEADED IS MANDATORY** as a *measured* constraint — a headless run is served Cloudflare's
interstitial and stays there (same Ray ID on three consecutive reads) — so "make it headless" is
not available; it would make the leg always fail.
The USER's correlation was exactly right: server-only caller, fires on the reauth path near
rotation.
**It was pure cost: 6 `drive-failed`, 910 `cooling-down`, ZERO successes ever** — every attempt
died `not_logged_in (auto, chrome/Default, chrome/Profile 1-3)`, opened a window, cooled down 6 h.
**FIX:** the opt-in flag `~/.aimaestro/oauth-reauth-repair.enabled` was RENAMED (not deleted) to
`.DISABLED-20260807-headed-browser-windows`. Takes effect with no restart —
`reauthRepairEnabled()` re-resolves `statePath()` on every call by design.
**VERIFIED BEHAVIOURALLY:** last `reauth-repair` line 11:30:49; at 11:42 there were **zero in ~11
consecutive ticks**.
**COST:** automatic re-capture of a dead slot is off; a dead slot now needs a human `/login` —
which is what the USER did anyway, and what this leg never once achieved.

## ⏳ 4. Post-rotation unblock — ESC to resume, or switch to opus — NOT STARTED

Foundations exist and must be reused, not rebuilt: `lib/agent-block-state.ts`,
`lib/agent-frame-reader.ts`, `lib/fleet-recovery-actuator.ts`, and `lib/oauth-rotator/model-fallback.ts`
(the ESC → `/model opus` → ENTER sequence, already built + tested, dark behind
`AIM_FLEET_MODEL_FALLBACK=1`). Issue **#128** is the USER's own directive for this; **#110** and
**#90** are adjacent.
**The known hard part, recorded so it is not re-discovered:** no test can prove the confirming
ENTER dismissed Claude Code's dialog — only that the keystroke was sent. First arming must be
WATCHED on a real pane (TRDD-DPPYVLVH's arming procedure).

## ⏳ 5. Auto-answer the AskUser menu with the default/first option — NOT STARTED

Same foundations as (4). Distinct capability: detect the AskUserQuestion menu in the pane and send
ENTER. Tracked in **#128**.
**Risk to design against:** pressing ENTER on a menu that is NOT AskUser, or on a destructive
default, is a fleet-wide keystroke injection. It needs the same structure-not-words discipline
`page-classify.ts` uses, and a positive control proving it declines a non-menu frame.

## ⏳ 8. Ledger records EVERY change to `~/.claude/settings.json` — NOT STARTED

Including changes NOT made by the server or its agents ⇒ this must be FILE monitoring (watch +
hash), not call-site instrumentation. Existing ledger surfaces: `lib/signed-ledger.ts`,
`lib/ledger-emit.ts`, `lib/portfolio-ledger.ts`, `services/element-inventory-ledger.ts`.
Relevant: **#105** (adopt `safe_config_edit` for every settings.json mutation).
**Known live hazard this would have caught:** a test once rewrote the USER's real settings.json
(TRDD-PE54D95Q's top warning).

## ⏳ 9. Ledger monitors `settings.json` + `settings.local.json` in every workdir and every
`~/.claude/projects/` entry — NOT STARTED

Superset of (8). Note the corpus size before designing: `~/.claude/projects/` holds **172+**
project dirs, so a naive per-file watcher is a descriptor-exhaustion risk.

## ⏳ 10. Server daemon sources accounts/subscriptions/usage/costs from the agentlenspro CLI — NOT STARTED

Partial wiring already exists: `lib/agentlens-status.ts`, `lib/token-cost.ts`,
`lib/continuity-status.ts`. Skills on disk: `~/.claude/skills/agentlenspro-diagnostics/SKILL.md`,
`agentlenspro-visualize-context`. Issue **#108** (AgentlensPro 2.21.0 all-account headroom) and
**#94** are the standing cross-repo context.
**Why the USER asked:** `agentlenspro statusline-history windows` is the un-quantized 5 h/7 d
reading that diagnosed the rotation failure when the server's own numbers did not.

**GAP MEASURED 2026-08-07 — this is half-built, and the missing half is the important one.**
- **BUILT and wired:** `lib/agentlens-status.ts` already parses `get_account_status --full` for
  exactly the canonical mapping janitor#100 specifies — `usageWindows.fiveHourPct` /
  `.sevenDayPct` and `cacheTtl.minutes`. Its one consumer is `lib/continuity-status.ts`.
- **NOT wired — and it is the safety-critical path:** the ROTATOR (`lib/oauth-rotator/tick.ts`)
  still takes its windows from its OWN `usageRequest` probe, not from agentlenspro. That is
  precisely the source whose numbers disagreed with reality during the incident, and the reason
  the USER named agentlenspro as the source at all.
- **Live CLI surface confirmed:** `get_account_status` (plan, mode, `usageWindows`, `cacheTtl`,
  `account.{accountId,label,email}`), `get_burn_status`, `get_account_burners`, plus
  `statusline-history windows`. Verified answering on this host: `Max 20x · subscription (within
  plan) · 5h 99% / 7d 50% (cc-rate-limits) · cache TTL 60min`.

**DO NOT start this at the tail of a long session.** Re-pointing the rotator's window source is a
change to the data path that decides credential rotation for the whole fleet; a half-landed
version would rotate on numbers nobody has validated. It wants a fresh context, the existing
`usageRequest` kept as a documented fallback (agentlenspro can be down), and a differential test
proving the two sources agree on a known fixture before the switch is trusted.

## Verification

Each item carries its own check above. Nothing here may be ticked from a code shape alone — the
three closed items were each verified by OBSERVED behaviour (a reddening test, a measured file
state, an absence of log lines over N ticks).

## Approval log

- 2026-08-07T11:42:43+0200 — MANDATE issued by USER. Born approved: authority(user) >=
  min-approval-requirement. No approval request was sent.
