---
trdd-id: MN0Q1IA2
title: USER nine-point fleet-hardening directive — updates cadence, auto-update, rotator, unblock, ledger, agentlenspro
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-07T11:42:43+0200
updated: 2026-08-21T13:46:53+0200
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
eht: [XV9BLQC5, Y1ZWU998]
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
approved and is authored directly in `design/tasks/`. Each item below records what was MEASURED,
not what was assumed. (The line that used to sit here — *"Three items are DONE and VERIFIED; six
remain"* — was a hand-kept tally, and it was wrong by four the day it was read. Counts live in the
STATE block below, derived from the boxes.)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-21

**Why this block exists:** this card is 700+ lines and **EIGHT of its items have now been found
already-shipped while their own text still read "NOT STARTED"** (items 5, 8, 9, 10 among them).
The failure is structural, not careless — an append-only card surfaces its oldest measurement as
though it were current. **So: verify every "NOT STARTED" below against the tree before building
anything. Do not trust this card's prose about the code; trust the code.**

**Item status, derived from the `## Acceptance` boxes (7 of 9 ticked):**

| item | state |
|---|---|
| 1 marketplaces 4 h, one CLI command | ✅ `5438312f` |
| 2 plugins auto-update via the safe editor | ✅ `71b9f796` |
| **3 rotator working** | ⏳ **OPEN — USER-GATED.** `scopedOnly` (`17e129d6`) is live; what remains is the dead-refresh account, which needs the USER's `/login`. Corroborated live this session: the tick status reads `nextAction: reauth-needed`, `reason: refresh-dead`, `stuck: all-maxed` |
| **4 post-rotation unblock** | ⏳ **OPEN — the only agent-actionable item left.** The MODEL half is complete (`planModelFallback`); the **ESC/resume half** is open. First live model switch is tracked on `TRDD-DPPYVLVH`, not here |
| 5 auto-answer the AskUser menu | ✅ shipped dark `8e03e32f` (arming the flag is USER-gated) |
| — | *there is no item 6 — the USER's list skipped it* |
| 7 no headed chrome-for-testing windows | ✅ verified live |
| 8 ledger records every `~/.claude/settings.json` change | ✅ `bbd18e3b` `816a582c` `4b1811ff` |
| 9 ledger monitors every workdir + project settings file | ✅ same three commits, 28 watch dirs |
| 10 daemon sources accounts/subscriptions/usage/costs from agentlenspro | ✅ **`TRDD-SLSSUIQ8` (2026-08-08)**, re-measured by observed effect 2026-08-21; COSTS residue named and deliberately not built |

**NEXT ACTION (one step, runnable as written):** item 4's ESC/resume half — read §4
(*"Post-rotation unblock"*) **and re-verify its premises against the tree before writing a line**,
because §4's own text already records one refutation in place (*"…AND THEN THE WIRING PLAN ITSELF
WAS REFUTED"*) and this card's base rate for stale premises is 8.

**SUPERSEDED — do NOT carry forward:**
- *"Three items are DONE and VERIFIED; six remain"* — a hand tally, wrong by four.
- §10's *"NOT wired — the ROTATOR still takes its windows from its OWN `usageRequest` probe"*
  (measured 2026-08-07) — **false since 2026-08-08**; struck in place, not deleted.
- Any reading of item 10 as *"re-point the rotator at agentlenspro"* — that was always a
  regression, and what shipped is correctly a fail-soft SECOND source beside `usageRequest`.

**Artifacts to read first:** `~/.aimaestro/oauth-rotator-tick-status.json` (the live tick verdict,
no auth needed — the API itself is 401 until the USER's governance login), `lib/oauth-rotator/tick.ts:409-439`,
`lib/oauth-rotator/agentlens-usage.ts`, `lib/agentlens-status.ts`.

**EHTs:** `XV9BLQC5` complete + archived (`0b7bd799`); `Y1ZWU998` is the open descendant and gates
itself, not this card.

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

### ⚠ DERIVED TASK I MISSED — the 4 h change CREATES a permanent false alarm (found 2026-08-07 ~12:26)

The janitor's `claimed-chore-stale` detector judges `user-plugins-update` stale past **180 m**,
while my change makes our cadence **240 m**. So once the restart lands, a HEALTHY fire trips that
alert.

That is precisely the defect class this session spent the day removing (`tick-stalled`,
`all-maxed`, "Refreshed *every* registered marketplace"): a signal asserting a fault that is not
there. I would have shipped a new one while fixing three.

**Measured when found:** `lastAbsorbedRunAt` = `2026-08-07T09:17:33+0200`, age **189 m** — LATE
against 180 m, fine against 240 m. So the alert firing *right now* is CORRECT (the running server
is still on 3 h and is 9 min late, ordinary jitter, NOT a wedge); it becomes false after the
restart.

#### ✅ CORRECTED + FILED 2026-08-07 — the mechanism above was wrong, and it mattered

This section first claimed the janitor **hardcodes** 180 m. **It does not.** Verified first-hand
against cached `2.5.0` before filing anything: the bound is
`max(3 × cadence, cadence + 600)` where `cadence` comes from **their own** roster
(`GLOBAL_CHORES["user-plugins-update"]` = 3600 s), so 3 × 3600 = 10800 s = 180 m — numerically
exact, mechanistically fiction. **There is no duplicated constant**; they derive, which is what my
own lesson prescribed. Two consequences the wrong story would have gotten wrong:

- **Severity is worse than "late between 180 and 240".** Our 4 h cadence *exceeds* the 3 h
  threshold outright, so a healthy server reads as wedged for the **last hour of every cycle,
  permanently**. At the old 3 h it sat exactly on the boundary and fired only on jitter — my edit
  turned a latent defect into a deterministic one. We are not blameless here.
- **The ask is not "bump the number".** A chore CLAIMED by another executor has its threshold
  derived from the **non-executor's** cadence — recurring for every chore any server claims at its
  own rate. Their `_cadence_of` even carries a soundness proof (the roster is test-asserted against
  `daemon.py`, "so this can never describe a cadence the daemon does not use") that is **true and
  about the wrong party**: the detector runs only on chores the daemon is *not* executing. No test
  on either side can catch it — each repo's tests are individually correct.

**Filed as janitor#225** (cross-repo issue, never an edit to their tree), offering to publish our
cadence beside the completion stamp they already asked for in `Emasoft/ai-maestro#111`. Referenced
janitor#221 — a 3.7-day wedge of *this* detector — because a daily false alarm is exactly how the
next real wedge gets filtered out by the reader.

**Deliberately NOT taken:** `CLAUDE_PLUGIN_OPTION_DAEMON_USER_PLUGINS_UPDATE_INTERVAL=14400`
silences this today, but it is one knob with two meanings (it retunes their daemon too if the chore
is ever un-yielded), and quietly erasing a symptom on a shared setting hands the next reader a
mystery. Offered to them as a stopgap instead.

**Operational rule, unchanged by the correction:** a `claimed-chore-stale` on
`user-plugins-update` between 180 m and 240 m is **EXPECTED and is not a wedge.** Anything past
240 m is real.

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

### 📐 MEASURED 2026-08-07 ~12:5x — the gap is ONE unwired function, not a feature

"NOT STARTED" understated how much is already live. Measured, not read:

- **The opus-switch half is BUILT *and WIRED*** — `model-fallback` has **6 production callers**,
  running as a leg of `lib/fleet-liveness-watchdog.ts` (`runModelFallbackSweep`), off by default.
- **ESC injection exists** — `lib/continuity-registry.ts:27` exports `ESC_KEYSTROKE = '\x1b'`, and
  `fleet-recovery-actuator.ts` has the gate/inject surface (`checkInjectionGates`, `InjectResult`).
- **The MISSING link is the ROTATION→FALLBACK bridge**, and it is one already-written function:

  | symbol (both in `lib/oauth-rotator/model-fallback.ts`) | production callers | tests |
  |---|---|---|
  | `planModelFallback` (control) | **3** | 18 |
  | **`stuckSuggestsModelFallback(nextAction, stuck)`** | **0** | **6** |

  A positive control on a sibling symbol from the SAME file proves this zero is real and not a
  broken search. Six tests describe the behaviour of a function nothing calls — *tests prove
  behaviour, never reachability.* Corroborating: `grep "stuck"` in `fleet-liveness-watchdog.ts`
  and `model-fallback-sweep.ts` returns **nothing**, so the sweep is driven by the **liveness
  cadence and never by a rotation** — which is exactly what the USER's item 4 asks for
  ("checks automatically **if after the rotation** the client is still blocked").

**So the build LOOKED like: call `stuckSuggestsModelFallback` with the rotator's own
`nextAction`/`stuck` after a rotation, and trigger the sweep when true.** It ships dark for free —
the sweep already self-gates on `AIM_FLEET_MODEL_FALLBACK`. ⚠ Do NOT rebuild any of the four
modules; the only thing absent is the call.

### 🛑 BLOCKER found before wiring it — the predicate returns FALSE on the REAL incident

Read the function before wiring it, and it does not do what item 4 needs:

```ts
export function stuckSuggestsModelFallback(nextAction: NextAction, stuck?: string): boolean {
  return nextAction === 'stuck' && stuck === 'all-maxed'
}
```

**Verified against the LIVE `~/.aimaestro/oauth-rotator-tick-status.json` (12 s old), not the
card:**

```
nextAction = 'reauth-needed'    stuck = 'all-maxed'
windows    = 5h 34% · 7d 78% · scopedModel Fable · scopedPct 100
⇒ stuckSuggestsModelFallback('reauth-needed', 'all-maxed') === FALSE
```

The account has **66 % of its 5 h window free** and only **Fable is at 100 %** — the textbook
model-scoped exhaustion this whole lane exists for — and the predicate meant to detect it says no.
Cause: the rotator ALSO cannot reauth (2 of 3 credentials dead, `reason: refresh-dead`), so
`reauth-needed` displaces `'stuck'` in `nextAction`, while the exhaustion signature lives in the
`stuck` field. **This is the same 11:47 state recorded above, still live hours later.**

**Consequence: wiring the call as-is would have shipped a NO-OP** — six passing tests, a live call
site, and nothing ever firing in the exact incident the USER reported. Tests prove behaviour, never
that the behaviour matches reality.

**FIXED `1ffa6d5b` + `30e71141`** — an ALLOWLIST `{stuck, reauth-needed}`, not `nextAction !== 'ok'`
(which would also fire during `'rotating'`, racing a rotation in flight). Both original guards
survive. Complementary neuter pair, **disjoint** red sets: reverting to `=== 'stuck'` reds the
reauth case; substituting `!== 'ok'` reds the rotating case — the second **implements the rival**,
so it proves the tests discriminate the two designs rather than merely proving something is
load-bearing. tsc 0, 21/21.

### 🔄 …AND THEN THE WIRING PLAN ITSELF WAS REFUTED — item 4's model half is ALREADY COMPLETE

Read `fleet-liveness-watchdog.ts:224-277` and `planModelFallback` before adding the call, and the
premise of the whole "one unwired function" framing collapses:

- The leg's architecture is deliberate and documented in place: *"the rotator tick has the window
  numbers and no agents, this watchdog has the agents and no credential access, so the two meet at
  the persisted stamp."* The watchdog consumes **WINDOWS**, never the verdict.
- `planModelFallback` already makes the **entire** decision from those windows:
  `scopedPct >= 97` · worst account `< ACCOUNT_HEADROOM_PCT (90)` · agents on that model family.
- **On the live 2026-08-07 state that is already satisfied** — scoped `100 >= 97`, worst account
  `max(34, 78) = 78 < 90` — so **the sweep would act TODAY if armed.** The verdict adds no reach.

**So wiring `stuckSuggestsModelFallback` as a gate would have been a REGRESSION**, not a feature:
it NARROWS the trigger (additionally demanding the rotator report stuck/reauth-needed) and creates
a SECOND source of truth for "is this a scoped exhaustion". The only legitimate shape is an
off-cadence *trigger* (sweep now rather than at the next liveness tick) — a latency optimisation
the sweep's own 60 s pacing already bounds. **Recorded in the function's own docstring**, because
the next reader looks at the code, not at this card.

**ESC is wired too:** `lib/fleet-continuity.ts:193` injects `ESC_KEYSTROKE`, and the fallback
actions carry `escapeFirst: true`; the recovery ladder's gentle rungs are deliberately *"pure
idle-drain slashes, no ESC."*

**⇒ Item 4's model-fallback half needs NO further build. It needs ARMING** — which is the USER's,
and is exactly what TRDD-DPPYVLVH already says. The predicate fix above still earns its keep: it
was broken for the real incident, and it is exported and tested, so it would have been a live trap
for whoever wired it later.

## ⏳ 5. Auto-answer the AskUser menu with the default/first option — NOT STARTED

Same foundations as (4). Distinct capability: detect the AskUserQuestion menu in the pane and send
ENTER. Tracked in **#128**.
**Risk to design against:** pressing ENTER on a menu that is NOT AskUser, or on a destructive
default, is a fleet-wide keystroke injection. It needs the same structure-not-words discipline
`page-classify.ts` uses, and a positive control proving it declines a non-menu frame.

### 📐 MEASURED 2026-08-07 — detection AND injection already exist; the gap is the DRIVER

- **The state is modelled explicitly.** `lib/agent-block-state.ts` defines
  `BlockReason = 'ask_user' | 'permission' | 'rate_limited' | 'api_error' | 'idle' | 'active' |
  'unknown'`, and `'ask_user'` carries the comment *"a selection menu is open — **the case that
  blocks forever**"*. `resolveBlockState` also returns `choices[]` in screen order and an
  `excerpt[]` — *"what a supervisor reads to decide the answer."*
- **Detection is wired** through `services/block-state-service.ts` (`readPaneVerdict`), consumed by
  4 production files including an API route.
- **Injection exists and is already governed.** `agents-core-service.ts:~1621` implements an
  `unblock-prompt` action behind an **R42.8** gate: no pending hook prompt ⇒ read the pane ⇒ require
  `blocked && (ask_user || permission)` ⇒ otherwise **409**. It **fails CLOSED** on an unreadable
  pane, with the reason spelled out so *"could not check"* never reads as *"checked"*.
- **A post-condition already exists** for the sibling lane: `model-fallback-actuator.ts:139`
  re-reads the pane after its confirming ENTER and reports `confirmed: !stillAsking` — *"without
  this the subsystem reports success for having sent keystrokes, which is the weakest possible
  claim."* Reuse this shape; do not invent another.

**⇒ The missing piece is ONLY the automatic driver:** a paced, dark-by-default sweep that finds
`ask_user` agents and answers them.

### 🛑 SECURITY FINDING — `ask_user` and `permission` MUST NOT be conflated for AUTO-answer

**Every existing site tests them together** (`reason === 'ask_user' || reason === 'permission'`) —
in `agents-core-service`, in `model-fallback-actuator`. That is CORRECT for the question those
sites ask (*"is this agent blocked?"*) and **UNSAFE for the question item 5 asks** (*"may I press
ENTER for it?"*), because **`permission` is a TOOL-PERMISSION prompt**. Auto-answering those with
the default is **auto-approving tool execution across the whole fleet** — a different capability
from the one the USER asked for, arriving silently by copying a predicate that reads as
established practice.

**So the driver must gate on `reason === 'ask_user'` ALONE**, and a test must pin that a
`permission` verdict is DECLINED — the neuter being "widen it to include `permission`", which must
redden exactly that test. The USER's words were *"the AskUser menu"*; nothing authorises the other.

**NOT started deliberately** — this is a new keystroke-injecting actuator leg (the comparable
model-fallback lane was 5 modules / 54 tests / 19 neuters), and starting it at a context tail would
have it compacted mid-build. The finding above IS the deliverable: it specifies the build and
forecloses the dangerous version of it.

## ✅ 8. Ledger records EVERY change to `~/.claude/settings.json` — DONE `bbd18e3b` `816a582c` `4b1811ff`

**Verified live 2026-08-16 (see the acceptance box for the full evidence): armed 28 dirs at
10:10:12, 29 signed entries 08-07 → 08-15, chain boot-verified at 10:09:54, 0 audit gaps, 34/34
tests.** The heading below said NOT STARTED for nine days while three commits sat behind it — the
design notes that follow are the record of how it was built, not a plan.

Including changes NOT made by the server or its agents ⇒ this must be FILE monitoring (watch +
hash), not call-site instrumentation. Existing ledger surfaces: `lib/signed-ledger.ts`,
`lib/ledger-emit.ts`, `lib/portfolio-ledger.ts`, `services/element-inventory-ledger.ts`.
Relevant: **#105** (adopt `safe_config_edit` for every settings.json mutation).
**Known live hazard this would have caught:** a test once rewrote the USER's real settings.json
(TRDD-PE54D95Q's top warning).

## ✅ 9. Ledger monitors `settings.json` + `settings.local.json` in every workdir and every
`~/.claude/projects/` entry — DONE, same three commits

**Measured coverage 2026-08-16: 28 watch dirs = `~/.claude` (1) + 12 agent workdirs + 15 decoded
project cwds.** The rest carry no settings file at all; discovery emits a target only where one
exists, and a file created later is picked up by the 5-minute re-scan (`DEFAULT_RESCAN_MS`). Full
evidence, and the probe bug that first reported a false total miss, are on the acceptance box.

Superset of (8). ~~Note the corpus size before designing: `~/.claude/projects/` holds **172+**
project dirs, so a naive per-file watcher is a descriptor-exhaustion risk.~~
**↑ REFUTED 2026-08-07 by measurement — see below. The corpus is ~32 FILES, not 172 descriptors.**

### 📐 MEASURED 2026-08-07 — the feared problem is not the real one

**1. `~/.claude/projects/` contains ZERO settings files.** 98 dirs, `settings*.json` count = **0**.
Those dirs hold conversation TRANSCRIPTS; the settings live in the WORKDIRS the slugs encode. The
USER's *"(if present)"* anticipated this. So item 9's target set is the decoded workdirs, and the
reliable decode is the transcripts' own **`cwd` field** — never slug-un-mangling, which is
ambiguous (the slug maps every non-alphanumeric to `-`, so a path containing a real `-` cannot be
recovered).

**2. The real watch set is ~32 files**, so the descriptor-exhaustion premise is gone:

```
98 project dirs → 43 distinct cwds → 36 still on disk → 18 settings files
+ 12 under ~/agents + 2 global (~/.claude/settings{,.local}.json)   ⇒  ~32
```

~~*Honest caveat:* 53 of 98 dirs yielded no `cwd` in their first 5 JSONL lines, so the true set may
be larger — but even 3× is ~100 files, still trivial.~~
**↑ CAVEAT CLOSED 2026-08-07 by a deeper scan (400 lines/dir instead of 5). The set is NOT larger,
and the assumed remedy was the wrong one.** Of 97 dirs:

| | |
|---|---|
| `cwd` in the first 5 lines | **44** |
| `cwd` only DEEPER than 5 lines | **3** ← all that deeper scanning buys |
| **no `.jsonl` file at all** | **49** ← empty project dirs: nothing to decode, nothing to watch |
| has content but still no `cwd` | **1** (4 lines; its slug happens to be unambiguous) |

So the 53 unknowns were never 53 missing projects — they were **49 empty directories plus 3 that a
deeper read finds plus 1 edge case**. Scanning deeper is nearly worthless (+3) and scanning DEEP is
pointless; read to a small bound, and treat a dir with no JSONL as *absent*, not as *undecodable*.
Final: 46 distinct cwds → 38 still on disk → **18 settings files**, so the ~32 total stands and the
descriptor-exhaustion premise stays dead.

**Still true and still load-bearing:** 8 decoded cwds no longer exist on disk, so **the set is
DYNAMIC** (projects appear and are deleted) — the watcher needs a periodic re-scan, not a one-shot
arm.

**3. NO file-watching exists anywhere in production** — zero hits for `fs.watch` / `watchFile` /
`chokidar` / `FSWatcher` across `lib services app server.mjs`. This is a new capability class, not
an extension of one.

### ⚠ THE REAL TRAP — watch the DIRECTORY, never the FILE

A safe write is `write <path>.tmp.N` then **rename over** the target (our own `saveJsonSafe` does
exactly this, and `atomic write` is the house pattern). `fs.watch` on a FILE binds the **inode**,
so after the first atomic write the watcher is holding the ORPHANED old inode: it reports nothing,
forever, while the file keeps changing. **Silently watching a dead inode is indistinguishable from
"no changes occurred"** — the exact failure shape this session removed three of.

⇒ Watch the parent DIRECTORY and filter by basename, then hash to confirm a real content change
(rename storms and editors' scratch files both fire spuriously). A test must pin the atomic-rename
case specifically: write via a tmp+rename, assert the change IS recorded. Watching the file
directly passes a naive "edit it in place" test and fails on every real write.

**Design note:** items 8 and 9 are ONE watcher (8 is the 2-file subset of 9's ~32), so build 9 and
let 8 fall out. The `~/.claude` global pair is the highest-value half — that is where the known
hazard landed (a test rewrote the USER's real settings.json).

### 🔌 LEDGER INTEGRATION — measured, so the build is mechanical

- **The signed chain is PER FILE.** `lib/agent-registry.ts:31` is
  `export const registryLedger = new SignedLedger(REGISTRY_FILE)` — the constructor takes the file
  the chain lives in, and `append(op, target, diff, opts)`'s `target` is metadata *within* that
  chain. **So do NOT emit settings events into `registryLedger`**: it would interleave unrelated
  subjects into the registry's own hash chain. Mint a separate `new SignedLedger(<settings-audit
  path>)` instead.
- **A new op value is explicitly SUPPORTED**, not a workaround: `types/ledger.ts` states the
  taxonomy is *"intentionally additive"* and that **`verify()` does NOT enum-check `op`** — it
  validates the hash chain + signature only, precisely *"so a newer ledger file with an op the
  current binary doesn't know is still verifiable."* So e.g. `settings_changed_externally` is
  forward-compatible by design. Every existing op is agent/registry-scoped; this is a new category.
- **Emit shape to copy** (`lib/ledger-emit.ts`): fire-and-forget, NOT awaited, with the failure
  logged under the `AUDIT GAP` prefix — an append failure must never take down the watcher.
- **The diff should be a `JsonPatch`, not "something changed"** — and that falls out of the design
  for free: the watcher already has to read + hash the file to confirm a real change, so it holds
  both the previous and current content and can emit a scoped, REPLAYABLE patch. That is the same
  property that makes per-op registry entries more useful than save-level ones.

### ✅ USER RULING 2026-08-07 — *"deduplicate but never deduplicate the signed ledger"*

The watcher records changes made by **anyone**, including the server itself, so it would
double-record every settings edit `editSettings` already ledgers. The ruling splits the two layers:

| layer | behaviour |
|---|---|
| **the signed ledger** | **RECORDS EVERYTHING. No suppression, ever.** Both entries land — the server's own `editSettings` emit AND the watcher's independent observation of the same write. |
| **everything downstream** (alerts, drift lines, UI surfacing, notifications, reports) | **DEDUPLICATED**, so an operator is not shown the same change twice. |

**THE ENFORCEABLE FORM — this is the part an implementer must not soften:** deduplication is a
**READ-TIME function computed OVER the ledger**. It is **never** a write-time gate, and nothing in
the dedupe path may be able to prevent, delay, or condition an `append`. Concretely: the watcher
appends on every confirmed content change, full stop; a separate reader collapses adjacent entries
for display.

**WHY the asymmetry is not fussiness:**

- **A ledger whose contents depend on a predicate is not an audit trail.** You cannot prove what
  was *not* recorded. The chain would still verify perfectly — hash + signature are intact over
  whatever was written — so the omission is undetectable by the very mechanism meant to detect
  tampering. A verified chain over a filtered input set is *worse* than no chain, because it reads
  as proof.
- **The dedupe predicate would itself become the bypass.** "Suppress a watcher event whose hash
  matches what our writer just produced" means anything that can make its write look like ours
  becomes invisible — and a buggy writer that stamps the wrong hash disappears the same way.
- **The failure directions are opposite, and only one is acceptable.** A bug in READ-time dedupe
  produces a noisy display. A bug in WRITE-time dedupe produces a silent hole in the audit record.
  This session removed three signals that asserted the opposite of the truth; a suppressed audit
  entry is that same failure with no observer left to catch it.

**Test to pin it:** append two entries with identical content-hashes from different actors, assert
the LEDGER holds **2** and the surfaced view holds **1**. The neuter — moving the dedupe into the
append path — must redden the ledger-count assertion, not the view assertion.

### ❌ MY FIRST AUDIT OF THIS WAS WRONG — corrected same session, before anyone built on it

I wrote (and committed, in `82f8fe14`) that *"all 9 signed-ledger appends are UNCONDITIONAL
fire-and-forget, with no `if`, no dedupe, and no skip."* **That is false.** Measured properly, by
walking back from each call site to its nearest enclosing lower-indent conditional:

| | sites |
|---|---|
| **GUARDED by `if (diff.length > 0)`** | **7** — `governance:190` · `agent-registry:298` · `team-registry:290` · `group-registry:263` · `user-registry:102` · `human-directory:111` · `foreign-approval-registry:127` |
| genuinely unconditional | **2** — `ledger-emit:72`, `portfolio-ledger:61` (inside a `try`, which is not a skip) |

The first pass grepped for dedupe-ish WORDS (`dedup|skip|unchanged|already`) three lines above an
append and found none — which was true and answered the wrong question. `diff.length > 0` contains
none of those words while being exactly the thing I claimed was absent. **A needle keyed on
vocabulary cannot find a predicate expressed in arithmetic** — the same class as this session's
`grep -c FAIL` and `$?`-after-a-pipeline errors: an instrument whose failure mode is a plausible
answer.

### ✔ …and the corrected finding is BETTER, because it makes the ratchet precisely specifiable

**`if (diff.length > 0)` is NOT deduplication and the ruling does not forbid it.** Dedupe suppresses
a SECOND entry that duplicates a real first one; this suppresses an EMPTY diff — a non-event. A save
that changed nothing has nothing to record, and appending "nothing changed" on every save would
flood the chain with noise until the real entries were unfindable.

So the ratchet is an **ALLOWLIST OF ONE**, which is a far stronger and more testable rule than
"never conditional":

> **The ONLY predicate that may guard a signed-ledger `append` is an empty-change check
> (`diff.length > 0`). Any other condition — content-hash comparison, actor check, "we just wrote
> this", rate limit, sampling — is FORBIDDEN.**

⚠ **Residual risk this exposes, worth stating because it is now load-bearing:** audit completeness
depends on **diff-computation correctness**. A change whose diff is computed as empty is silently
unrecorded, and the chain still verifies perfectly — the same "verified chain that proves nothing"
hazard, arriving by a different route than dedupe. That is an argument for testing the diff
computation, NOT for removing the guard.

**Scope: every signed ledger in the tree, not items 8/9.** A property that is already true is the
one most easily lost — removing it looks like an optimisation and breaks no test that exists today.

## ✅ 10. Server daemon sources accounts/subscriptions/usage/costs from the agentlenspro CLI — DONE `TRDD-SLSSUIQ8`, costs residue named

Partial wiring already exists: `lib/agentlens-status.ts`, `lib/token-cost.ts`,
`lib/continuity-status.ts`. Skills on disk: `~/.claude/skills/agentlenspro-diagnostics/SKILL.md`,
`agentlenspro-visualize-context`. Issue **#108** (AgentlensPro 2.21.0 all-account headroom) and
**#94** are the standing cross-repo context.
**Why the USER asked:** `agentlenspro statusline-history windows` is the un-quantized 5 h/7 d
reading that diagnosed the rotation failure when the server's own numbers did not.

### 📐 MEASURED 2026-08-07 — the request SPLITS, and one half would be a REGRESSION

**The rotator's own design already adjudicates this** (`tick.ts:325-345`, TRDD-GY0LJV6S), and it
was written for exactly this question about the STATUSLINE:

> *"the one `usageRequest` below supplies **FOUR** things and the statusline can carry **two**. The
> model-scoped weekly windows (`worstScopedPercent` — Fable 5 has a weekly limit appearing in
> **NEITHER** top-level bucket, TRDD-JI7F1236) and `liveStatus` (the 429 debounce, the 401/403
> token-REJECTED branch, `networkUp`) are **ENDPOINT-ONLY**."*

**Agentlenspro is in the statusline's class, measured, not assumed.**
`AgentlensStatusMetadata` exposes exactly `window5hPct`, `window7dPct`, the subscription plan
string, and the prompt-cache TTL. **No scoped window. No `liveStatus`.**

So the two halves get OPPOSITE answers:

| half of the USER's ask | verdict |
|---|---|
| **usage/costs, accounts, SUBSCRIPTIONS** (reporting) | ✅ **agentlenspro is the right source** — it carries the PLAN string, which the endpoint does not expose at all. This is the half with real value, and it has no rotation blast radius. |
| **the rotator's ROTATION DECISION** | ❌ **would be a REGRESSION.** Losing `worstScopedPercent` breaks the model-fallback lane outright — that window IS today's incident (Fable 100 % while the account sits at 34 %). Losing `liveStatus` removes how `refresh-dead` is known, i.e. the 2-dead-credential verdict. |

**The safe shape already exists and must be copied, not invented:** `statuslineNear` is a **pure
disjunct** under the standing rule *"IT MAY ONLY EVER ADD A REASON, NEVER REMOVE ONE"* — `false`
means "no signal", never "the account is fine". Agentlenspro should enter the rotator the same way,
if at all, and MUST call `isNearLimit` rather than compare thresholds itself (*"One predicate, never
two. A second copy of the threshold logic is precisely how a limit gets raised in one place and not
the other."*).

⚠ **Security note for the reporting half:** `agentlens-status.ts` routes plan detection through a
`parseSubscriptionType` **choke-point that extracts only the plan string and DROPS THE TOKEN** —
the CLI's output carries a credential. Any new consumer goes through that choke-point; none may
read the raw payload.

**⇒ Item 10 is NOT "re-point the rotator". It is "add agentlenspro as the reporting source for
accounts/subscriptions/costs, and (optionally) as one more pure disjunct".** Recorded before
building because the naive reading of the directive would have broken the exact lane items 3 and 4
spent this session fixing.

**GAP MEASURED 2026-08-07 — this is half-built, and the missing half is the important one.**
- **BUILT and wired:** `lib/agentlens-status.ts` already parses `get_account_status --full` for
  exactly the canonical mapping janitor#100 specifies — `usageWindows.fiveHourPct` /
  `.sevenDayPct` and `cacheTtl.minutes`. Its one consumer is `lib/continuity-status.ts`.
- ~~**NOT wired — and it is the safety-critical path:** the ROTATOR (`lib/oauth-rotator/tick.ts`)
  still takes its windows from its OWN `usageRequest` probe, not from agentlenspro.~~
  **⚠ FALSE SINCE 2026-08-08 — struck, not deleted, because the sentence read as current for two
  weeks.** `TRDD-SLSSUIQ8` ("Feed the rotator's usage decisions from the agentlenspro CLI") is
  `column: complete`, archived, `updated: 2026-08-08T11:52` — i.e. it landed the DAY AFTER this
  paragraph was measured. This is the EIGHTH parked/stale premise on this card, and the most
  expensive one: a worker dispatched against it would have re-implemented a shipped feature
  *inside the credential-rotation data path* — the exact danger the paragraph below warns about.
  The 08-07 text stays as the dated guardrail; the re-measurement is below.
- **Live CLI surface confirmed:** `get_account_status` (plan, mode, `usageWindows`, `cacheTtl`,
  `account.{accountId,label,email}`), `get_burn_status`, `get_account_burners`, plus
  `statusline-history windows`. Verified answering on this host: `Max 20x · subscription (within
  plan) · 5h 99% / 7d 50% (cc-rate-limits) · cache TTL 60min`.

**DO NOT start this at the tail of a long session.** Re-pointing the rotator's window source is a
change to the data path that decides credential rotation for the whole fleet; a half-landed
version would rotate on numbers nobody has validated. It wants a fresh context, the existing
`usageRequest` kept as a documented fallback (agentlenspro can be down), and a differential test
proving the two sources agree on a known fixture before the switch is trusted.

### ✅ RE-MEASURED 2026-08-21 — two of three halves are DONE, and one was done before the ink dried

Measured first-hand this session, code path AND live effect. The `agentlenspro` binary is at
`/opt/homebrew/bin/agentlenspro` and answers (`statusline-history windows --json` → exit 0, 40
rows).

| half of the USER's ask | verdict | evidence |
|---|---|---|
| **accounts + subscriptions** (the PLAN string the endpoint does not expose) | ✅ **DONE** | `lib/agentlens-status.ts` (`get_account_status --full`, plan through the `parseSubscriptionType` token-dropping choke-point) → `lib/continuity-status.ts` → `app/api/agents/[id]/continuity/status/route.ts` + `lib/session-restart.ts` |
| **usage windows** | ✅ **DONE (TRDD-SLSSUIQ8)**, in exactly the pure-disjunct shape this section prescribed | `lib/oauth-rotator/agentlens-usage.ts` → `tick.ts:409-439`, fail-soft, commented *"may only ever ADD observations, never break the read"*; reachable from the daemon via `server.mjs:1987 → lib/oauth-rotator/server-tick.ts`; both its exports have exactly 1 production caller (tick.ts) plus `tests/unit/agentlens-usage.test.ts` |
| **costs** | ❌ **NOT sourced from agentlenspro** — stated, not hidden | `get_burn_status` / `get_account_burners`: **0** references in `lib services app components scripts server.mjs` (positive control: `get_account_status` returns real hits). `lib/token-cost.ts` is a LOCAL per-token approximation feeding two React components, and its own header says money here is approximate *by construction* because the plan is flat-rate |

**Ticked by OBSERVED EFFECT, not code shape** (the gate this card's Verification section sets).
The live tick status `~/.aimaestro/oauth-rotator-tick-status.json`, stamped `2026-08-21T11:44:32Z`
(≈1 min before the read), carries `sevenDayPct: 93` and `fiveHourResetsAtSec: 1787324400`; the CLI's
newest row read seconds later carries `pct_7d: 93` and **`resets_5h: 1787324400` — byte-identical**,
which is precisely the field `network.ts:639-641` uses to attribute a row to the live account
(*"an agentlens row whose `resets_5h` equals the live account's is the live account's row"*).
`fiveHourPct` differs by one point (9 vs 8), which is the expected signature of a quantized endpoint
beside an un-quantized CLI sampled seconds apart — agreement on the reset instant is the identity
proof, the percentage is not.

**Why the costs half is NOT being built here:** the USER's own stated WHY for item 10 is the
un-quantized 5 h/7 d reading that diagnosed the rotation failure — the usage half, which is done.
Wiring `get_burn_status` is a separate, small, unrequested change whose value is unclear against a
flat-rate plan, so it is a card of its own if it is wanted at all, never a blocker holding a
nine-point directive open. Item 10's box is ticked with that residue named.

## Acceptance

**Added 2026-08-16 — this card had NO checklist at all, which made its completion gate vacuous.**
The gate is stated over boxes that are *unchecked*, so a card with zero boxes passes having proven
nothing; measured across this repo the same week, 87 of 108 open cards were in that state. The nine
items already carried their status in their own headings — this section only mirrors them into the
form the gate can actually read, and adds nothing new. **Ticking is by OBSERVED behaviour, never by
code shape** (see Verification below).

- [x] **1.** Marketplaces update every 4 h via ONE CLI command — `5438312f`
- [x] **2.** All plugins auto-update in `settings.json`, through the safe editor — `71b9f796`
- [ ] **3.** The rotator is working — PARTLY VERIFIED. `scopedOnly` (`17e129d6`) is live and
      ticking; what remains is the dead-refresh account, which needs the USER's `/login`.
- [ ] **4.** Post-rotation unblock (ESC to resume, or switch to Opus) — the MODEL half is already
      complete (`planModelFallback` makes the whole decision from windows; the "one unwired
      function" framing was refuted in place at §"…AND THEN THE WIRING PLAN ITSELF WAS REFUTED").
      What is open is the ESC/resume half — and note the model half's own first live switch is
      tracked separately on `TRDD-DPPYVLVH`, not here.
- [x] **5.** Auto-answer the AskUser menu with the default/first option — **SHIPPED DARK** (this
      box said "NOT STARTED" while `8e03e32f feat(fleet): AskUser auto-answer leg — accept a
      dwelled menu's default, ships dark` had landed: `lib/fleet-askuser-autoanswer.ts`, wired as
      the watchdog's `runAskUserAutoAnswerTick` leg behind default-OFF `AIM_FLEET_ASKUSER_AUTOANSWER=1`).
      The security gate this box named is the module's stated non-tunable invariant — "answers
      `ask_user` menus ONLY — NEVER a `permission` prompt … hard-refuses the `permission` reason at
      every layer" — and it accepts the menu's DEFAULT (ENTER), never a digit of our choosing.
      Seventh parked/stale premise this month. What remains is USER-gated: arm the flag and watch
      one live answer (recorded 2026-08-19T20:51:18+0200).
- [x] **7.** No more headed chrome-for-testing windows — DONE, verified live
- [x] **8.** Ledger records EVERY change to `~/.claude/settings.json` —
      **DONE. The box said "NOT STARTED" and it had THREE commits behind it**
      (`bbd18e3b` the watcher half, `816a582c` the `recordChange(ledger, change)` seam,
      `4b1811ff` anchoring the entry path to the chain). Sixth of seven parked/stale premises this
      week — verify before building, or you re-implement what shipped.
      **VERIFIED BY EFFECT on the live server, not by code shape:**
      - armed at boot, unconditionally — `[Startup] Settings-file watcher armed: 28 dirs → signed
        ledger (fingerprints only)` at **10:10:12** (and again at 09:48:29, i.e. every boot);
      - it has actually RECORDED: `~/.aimaestro/settings/watched-settings.ledger.json` holds **29**
        `change_settings_file` entries spanning 2026-08-07 → 2026-08-15, each carrying
        `seq/prevHash/signature/signerKeyFingerprint/authActor`;
      - the chain is BOOT-VERIFIED like every other — `[SECURITY] All ledger chains verified` at
        **10:09:54** (94 occurrences in the log; `verifyOnStartup` defaults true and no
        `security-config.json` overrides it), so it is not the one chain nobody checks;
      - `0` `ledger append failed` audit-gap lines since boot;
      - `tests/unit/settings-watcher.test.ts` + `settings-watch-targets.test.ts` → **34/34**.
      The diff records `{sha256,size}` FINGERPRINTS only — a settings file legitimately holds env
      blocks and tokens, and a long-lived ledger of values would republish the secrets it exists to
      protect.
- [x] **9.** Ledger monitors `settings.json` + `settings.local.json` in every workdir and every
      `~/.claude/projects/` entry — **DONE, same three commits.** Measured coverage — re-derive it
      with a read-only probe calling `watchDirs(discoverSettingsTargets())` and bucketing by prefix
      (mine is gitignored at `scripts_dev/probe-settings-watch-coverage.ts`; run it with
      `bash scripts/with-node.sh npx tsx <path>`, and note it must be `.ts`, NOT `.mts` — the repo
      transpiles to CJS under tsx, so an `.mts` probe sees only a `default` export and its named
      imports fail): **28 watch dirs** = `~/.claude`
      (1) + **12** agent workdirs + **15** decoded project cwds. The watcher watches
      `<workdir>/.claude`, and discovery emits a target only where a settings file ALREADY EXISTS,
      so the 11 agent workdirs and 24 decoded cwds not in the set are the ones carrying no settings
      file at all — not a coverage hole.
      **The residual, stated rather than hidden:** a settings file CREATED in a previously-empty
      workdir is not seen at the instant of creation; it is picked up by the next re-scan
      (`DEFAULT_RESCAN_MS = 5 min`), so the create event is missed and every change from then on is
      recorded. That is deliberate and the module says so at the gate.
      **⚠ MY FIRST READING OF THIS WAS WRONG and would have filed a false gap** — the probe first
      compared `~/agents/<name>` against the watch set and reported **23 of 23 workdirs and 39 of
      39 decoded cwds "MISSING"**, because the watched dir is the `.claude` SUBDIRECTORY. A
      comparison whose two sides are different kinds of path can only ever report a total miss.
- [x] **10.** Server daemon sources accounts/subscriptions/usage/costs from the agentlenspro CLI —
      **DONE, and it was done on 2026-08-08 by `TRDD-SLSSUIQ8` while this box read "NOT STARTED"**
      (eighth parked/stale premise on this card; see §10's `RE-MEASURED 2026-08-21` block).
      Accounts + subscriptions: `agentlens-status.ts` → `continuity-status.ts` → the continuity
      route. Usage windows: `agentlens-usage.ts` → `tick.ts:409-439` as a fail-soft SECOND source
      (never a re-point — `usageRequest` stays, exactly as this card required, so the
      `worstScopedPercent` / `liveStatus` regression it warned about never happened).
      **Ticked by observed effect:** the live tick status and the CLI's newest row agree on
      `resets_5h = 1787324400` — the very field the code uses for account attribution — with
      `pct_7d` 93 on both, measured ~1 min apart.
      **Residue, named not hidden:** COSTS are still local — `get_burn_status` /
      `get_account_burners` have **0** production references. That is a separate small card if
      wanted; it is not what the USER's stated WHY for this item asked for.
- [x] EHT `TRDD-XV9BLQC5` (OAuth-authorize CAPTCHA continuity exposure) is terminal — **completed
      + archived 2026-08-20** (0b7bd799): its box 2 re-measure ran (adverse — the store chain has
      stopped for both alternates since 08-07, USER re-login owed on those slots) and box 3
      landed (9793fca6: the `cookie-leg-stuck` alert stopped asserting a cause it never measured).
      Its own EHT `TRDD-Y1ZWU998` is now the open descendant — a NEW card, so it gates itself,
      not this one

**There is no item 6.** The nine points are numbered 1-5 and 7-10; the USER's original list skipped
it. Recorded so the next reader does not go looking for a tenth item that was never dropped.

## Verification

Each item carries its own check above. Nothing here may be ticked from a code shape alone — the
three closed items were each verified by OBSERVED behaviour (a reddening test, a measured file
state, an absence of log lines over N ticks).

## Approval log

- 2026-08-07T11:42:43+0200 — MANDATE issued by USER. Born approved: authority(user) >=
  min-approval-requirement. No approval request was sent.
