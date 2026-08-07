---
trdd-id: MN0Q1IA2
title: USER nine-point fleet-hardening directive — updates cadence, auto-update, rotator, unblock, ledger, agentlenspro
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-07T11:42:43+0200
updated: 2026-08-07T13:55:33+0200
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

## ⏳ 8. Ledger records EVERY change to `~/.claude/settings.json` — NOT STARTED

Including changes NOT made by the server or its agents ⇒ this must be FILE monitoring (watch +
hash), not call-site instrumentation. Existing ledger surfaces: `lib/signed-ledger.ts`,
`lib/ledger-emit.ts`, `lib/portfolio-ledger.ts`, `services/element-inventory-ledger.ts`.
Relevant: **#105** (adopt `safe_config_edit` for every settings.json mutation).
**Known live hazard this would have caught:** a test once rewrote the USER's real settings.json
(TRDD-PE54D95Q's top warning).

## ⏳ 9. Ledger monitors `settings.json` + `settings.local.json` in every workdir and every
`~/.claude/projects/` entry — NOT STARTED

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

*Honest caveat:* 53 of 98 dirs yielded no `cwd` in their first 5 JSONL lines, so the true set may
be larger — but even 3× is ~100 files, still trivial. And 7 decoded cwds no longer exist, so **the
set is DYNAMIC** (projects appear and are deleted): the watcher needs a periodic re-scan, not a
one-shot arm.

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

⚠ One consequence worth stating: the watcher records changes made by **anyone** — including the
server itself. Emitting on our OWN writes would double-record every settings edit the server
already ledgers through `editSettings`. Decide explicitly whether to de-duplicate (e.g. suppress a
watcher event whose content hash matches the one our own writer just produced) or to keep both and
let the actor field distinguish them. **The USER's directive — "record any change, even if not done
by the server" — argues for keeping BOTH**, since a suppression rule is exactly what an attacker or
a buggy writer would ride in on.

## ⏳ 10. Server daemon sources accounts/subscriptions/usage/costs from the agentlenspro CLI — NOT STARTED

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
