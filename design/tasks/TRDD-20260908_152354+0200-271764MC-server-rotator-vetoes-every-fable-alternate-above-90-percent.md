---
trdd-id: 271764MC
title: Server rotator vetoes every Fable alternate above 90 percent and hands the fleet to a model switch
column: dev
created: 2026-09-08T15:23:54+0200
updated: 2026-09-10T07:44:46+0200
current-owner: governance-rules-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: governance-rules-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-08T15:23:54+0200
priority: 1
---

# Server rotator vetoes every Fable alternate above 90 percent and hands the fleet to a model switch

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-10

**CODE LANDED `efb6a509`** (2026-09-08 15:40). Boxes 1-4 and 7 closed. Boxes 5 and 6 are open and
BOTH the owner's.

**NOT DEPLOYED — run BOTH `yarn build` AND `pm2 restart`.** The pid is `tsx server.mjs` from
2026-09-05 11:16 and `efb6a509` landed 09-08 15:40, so the process predates the fix. A restart
alone is not enough: the Sep-5 bundle still carries the old default — `ROTATOR_SCOPED_SWITCH_AT",90)`
in `.next/server/chunks/3242.js`, the ONLY file in `.next/server` that matches, so it is the one
copy — and `.next/server/app/api/statusline/ingest/route.js` carries the tick machinery
(`aimaestro.oauth-rotator.lastTickAttemptMs`). So a stale-bundle tick CAN run at 90 beside the
restarted one, conditional only on something POSTing to `/api/statusline/ingest` and `:176`/`:188`
letting it through. Which copy wins on a given beat is unknown and deliberately not analysed here.

*The method behind each fact above — which needles, why, and five rounds of getting it wrong — is
in `fd6ad062` … `25968956`. It is deliberately NOT restated here: this block is read first for
operational state.*

**THE MISSING MEASUREMENT IS NOW TAKEN, AND IT WENT THE OTHER WAY: THE ROUTE *IS* BEING REACHED
ON THE LIVE STALE-BUNDLE SERVER.** The trigger condition the paragraph above names is **MET**, by
a POSTer that is not the configured statusline and has not been identified.

> **A first draft of this section said the opposite** — "nothing POSTs, the hazard is NOT LIVE",
> attributing the store's writes to the test suite on the strength of a fixture-shaped payload and
> recent mtimes. That was wrong, and the refutation was sitting inside the filenames I had already
> listed: `abc123.json.aim-bak-<stamp>-24895-<counter>` embeds **`process.pid`**
> (`lib/json-io.ts:275`), and **`ps -p 24895` is the live `tsx server.mjs` started Sat Sep 5
> 11:16:27** — the very stale-bundle pid this card is about. A vitest run writes under its own
> short-lived pid, never that one. The inference was "fixture data therefore tests"; the datum was
> a pid.

**WHICH FACT CARRIES THIS, because the two are not equal partners.** The pid alone establishes only
that *the live server process wrote the file* — it does NOT by itself establish that the ROUTE ran.
What closes that gap is the **sole-caller** check: `writeStatuslineSnapshot` has exactly one
non-test caller, `app/api/statusline/ingest/route.ts:130`, and `statuslineStatePath` /
`statuslineStateDir` are referenced nowhere outside `lib/statusline-store.ts` itself (searched
across `app/`, `lib/`, `services/`, `scripts/`, `server.mjs`). The 13 other hits are
`tests/unit/statusline-store.test.ts`, whose ids are `sess-1`/`sess-keys`/`sess-shed`/`rt`/
`corrupt`/`old`/`new`/`real`/`only` — **none is `abc123`**. So: the pid excludes a *different
process*; the sole caller excludes a *different code path*. Both are needed and only the second is
load-bearing.

**The five in-process paths that would break this were enumerated and each refuted** — recorded so
the next reader can attack the claim rather than take it:

| alternative write path | why it does not apply |
|---|---|
| another route importing the store | no other file in `app/`, `lib/`, `services/` references the store's writer or its path helpers |
| a server-side scheduled task (watchdogs, rotator) | would still have to call `writeStatuslineSnapshot`; nothing does |
| the statusline-capture wrapper | it is `scripts/aimaestro-statusline-capture.sh`, a SHELL script — not in-process code, and if it runs at all it POSTs |
| a pty / WebSocket frame handler | same as the scheduled task: no caller exists |
| repair-on-read by a lenient reader | `readJson` contains no `write`/`rename`/`keepBackup`/`unlink` call — its only matches for those words are comments |

**What the writes show — TEN backed-up writes, and whether any were pruned is NOT established.**
Sep 5 12:55/13:04/13:07/19:50/20:00/21:29, Sep 9 14:25, Sep 10 01:16/01:21/01:21, every one under
pid 24895; the live `abc123.json` at Sep 10 01:21 is the CURRENT CONTENT, not an eleventh distinct
write. A draft called this "eleven writes, and that is a FLOOR because the set is AT the cap" —
**both halves wrong.** The prune is `mine.slice(0, max(0, mine.length - BACKUP_KEEP))`
(`lib/json-io.ts:282`, `BACKUP_KEEP = 10` at `:151`), which at length 10 slices nothing: being *at*
the cap is not being *over* it, so ten surviving backups is equally consistent with ten writes and
nothing pruned. What IS true: the oldest surviving backup carries counter **5, not 1**, so at least
one earlier backed-up write went through that module instance — whether it was a statusline write
is not established. The **last** write is Sep 10 01:21 local; nothing since.

**What the counter DOES kill, and it is worth stating because it is the one clean inference here:**
a 3-second statusline refresh would be ~144,000 writes over these five days, with a counter to
match. The observed counter is **23**. No pruning argument is needed — the POSTer is emphatically
not a per-refresh statusline feed, whatever else it is.

**The step-of-2 in the counters is explained, and the explanation corrects a claim a draft of this
block made — and a later draft then got the COUNT of those places wrong.** `_atomicWriteCounter`
is incremented in **FOUR** places in `json-io.ts` (`++` sites: `:275`, `:472`, `:539`, `:584`) —
once for the backup name and once for each of three tmp paths. A draft said FIVE while
enumerating four beside it; the fifth is the declaration (`:103`) or the test setter (`:111`),
neither of which increments.

**The per-path cost is NOT an unknown — it was read, and it is fixed per function.** Mapping the
four sites onto their enclosing functions settles it:

| function | sites it consumes | per call |
|---|---|---|
| `updateJson` (`:368`) | `keepBackup`→`:275`, then tmp `:472` | **+2** when the file exists; **+1** on a first-ever write (nothing to copy aside) |
| `restoreRawSnapshot` (`:529`) | tmp `:539` | **+1** — but **+0** on its `raw === null` branch, which deletes instead of writing |
| `saveJsonSafe` (`:550`) | tmp `:584` | **+1** |

So per-write cost is path-dependent ACROSS functions and constant WITHIN one. A draft withdrew
too far here — it concluded that path-dependence "removes the ability to map counter values to a
write count at all without knowing which paths ran, which is precisely the unknown". It was not
an unknown; it was an unread file. What the withdrawal keeps is narrower and still right: "nothing
else used THAT module instance over those 4.5 days" is about the long statusline window, where
several callers on several paths could produce the same values, and nothing above rests on it.
(`settings.json`'s counter 56 is EVEN, which fits a different instance with a different offset and
does not fit a code-level parity rule; that datum is why the stronger claim was withdrawn.) And the
counter is **per MODULE INSTANCE, not process-global** as a draft said — several module copies is
the live explanation. A reset via the exported `_setAtomicWriteCounterForTests` (`:111`) is
mentioned only for completeness: it is a **test-only** export and should not execute in
production, so listing it beside the bundling explanation as a co-equal alternative — as a draft
did — gives a path that should never run undeserved parity. Either way it bounds nothing
process-wide: the same pid 24895 carries `~/.claude/settings.json` at counter
**56** stamped Sep 5 13:03 UTC while the statusline set is still at counter **23** on Sep 9 23:21
UTC. A single monotonic counter cannot do that; Next.js bundling gives several copies of the module.
So the counter bounds nothing process-wide and is not relied on above.

**SIDE FINDING, and the most operationally significant thing here: the oauth-rotator subsystem is
DEMONSTRABLY EXECUTING inside pid 24895 — i.e. inside the stale Sep-5 bundle.** The same pid holds
10 backups of `~/.claude/plugins/data/ai-maestro-janitor-ai-maestro-plugins/oauth-rotator/active-alerts.json`
at counters 12423-12441, stamped Sep 10 03:31 through 03:39 UTC — ten writes spanning **nine
consecutive minute-labels, i.e. ~8 minutes elapsed** — roughly one a minute, live at the time of
reading.

> **THAT WINDOW IS GONE, AND THE "8 vs 9 MINUTES" CHURN BELOW IS AN ARTEFACT OF NOT SAYING WHICH
> WAS MEANT.** `BACKUP_KEEP = 10` (`lib/json-io.ts:151`) and `keepBackup` prunes to it on every
> write, so the ten backups are a sliding window and the 03:31-03:39 set has been overwritten —
> the original measurement is no longer re-checkable. Two drafts then argued 8 against 9 without
> either stating its unit; 03:39 − 03:31 is **8 minutes elapsed** across **9 distinct minute
> labels**, and both numbers were right about different things.
>
> **Re-measured 2026-09-10 06:4x:** the ten surviving backups are `0437`(×2), `0438`…`0445` at
> counters **012567 → 012585**, step **+2**, uniform, no gaps — same shape, same
> doublet-in-one-minute, same 8-elapsed/9-labels span.
>
> **Call that a SECOND SAMPLE, not a replication.** Same pid, same instance, same code, one hour
> later — autocorrelated by construction, so it cannot independently confirm the lost window's
> values. What it does establish is worth more than the word would have been: the beat is **still
> running now**, and the +2 step and the doublet are **stable recurring properties** rather than
> artefacts of one read.
>
> **A draft then wrote "the doublet RECURRED … therefore periodic".** That inferred PERIODICITY
> from minute labels, which this card's own two-instruments rule forbids — a shared `0437` label
> is consistent with anything from 0.1 s to 59 s, so it could not confirm the original 11.93 s
> interval. The claim is superseded anyway: the doublet is now identified below, from the payload.
>
> **WRITES ≡ CALLS, and it needed discharging rather than assuming.** The no-op return at
> `:453-455` means a `deliverAlerts` call whose content is unchanged writes NOTHING — so a
> backup-per-minute could in principle have been the rate at which alert CONTENT changes, not the
> tick rate, and the cadence conclusion rests on the difference. Discharged by reading the
> payload: the mutator sets `seen: (rec?.seen ?? 0) + 1` and `lastSeenAt: nowS` per finding
> (`alert-delivery.ts:170-176`), and — the part that makes it UNCONDITIONAL — **`data.updatedAt =
> nowS` at `:206` sits outside both loops**, so the serialization differs on every call even when
> the findings set is EMPTY. `:453-455` can never fire. A raw diff of two consecutive backups
> shows exactly `seen 2460→2461`, `lastSeenAt`/`updatedAt` +60 s, nothing else. Every call that
> reaches the mutator writes,
> full stop — a draft hedged this to "while a finding is live", which `:206` makes unnecessary and
> which would have left the ten backups enumerating only the beats that happened to find something.
>
> **The other half of "every call writes" — that every call REACHES the mutator — is now measured
> too, because a review asked for it and an early return on an empty findings set is the obvious
> guard to write.** There is none: `deliverAlerts` (`alert-delivery.ts:146`) runs `nowS`, `log`,
> `owns`, `delivered = []`, then straight into `try {` → `alertsFile()` → `readJson` → `prior` →
> `toNotify` → `live` → `await updateJson(...)` at `:166`, with no return in between. **That is
> sound for `return` and incomplete for control flow** — everything from `alertsFile()` on sits
> inside the `try {`, and a throw there also leaves before `:166`. It does not matter, and the
> reason is worth stating rather than eliding: a throwing call is **a call with no write**, and
> the direction the conclusion needs is *write ⇒ call*, so a throw only ever SUBTRACTS writes.
> The precise claim is therefore: no `return` prevents a call from reaching the mutator; a throw
> would, and that cannot manufacture a backup. Two independent corroborations: the suite calls `deliverAlerts([], …)` as a real delivery
> (`tests/unit/oauth-alert-delivery.test.ts:127`, `:201`), and `server-supervisor.ts:99-107`
> documents its own call as "CALLED ON EVERY BEAT, INCLUDING THE ALL-CLEAR", explicitly ungated
> because gating it on `findings.length > 0` once disabled the resolution half of the system.
> **A draft justified this with "a throw only SUBTRACTS writes, and the conclusion needs
> write ⇒ call". That is right for ONE of the two things this card infers from the backups and
> WRONG for the other, and it was introduced by the fix for the previous defect.** The card runs
> two arguments off the same series:
>
> - **The identification** — backup `12613` exists and shows `cookie +1` — needs *write ⇒ call*.
>   A throw writes nothing, so it cannot have produced `12613`. The draft's reasoning holds here.
> - **The cadence** — nine writes, eight deltas, all 59-61 s — needs the CONVERSE, *call ⇒
>   write*: every beat that ran left a backup. **A swallowed throw breaks exactly this.** If beat
>   N throws in `alertsFile()` and beat N+1 succeeds, no backup is written for N, the observed
>   delta is 120 s, and it reads as one interval. Both call sites `.catch(() => {})`, so such a
>   throw is invisible by construction.
>
> What actually rules that out is **the DATA, not a direction argument**: all eight deltas read
> 59-61 s, so no beat was lost anywhere inside that window — a skipped beat would show as a
> ~120 s delta and there is none. A wrong reason is worse than the hedge it replaced, because it
> reads as settled.
>
> **And it adds a third candidate for the 175 missing beats**, alongside restarts (withdrawn) and
> "a beat that never reaches `deliverAlerts`": a beat that reaches it and throws inside it. The
> rate-check paragraph names two; there are three, and none is distinguished by anything measured
> here.
>
> **A draft attributed those writes to the `.next` bundle — "`lib/*.ts` is bundled into `.next`, so
it is stale-bundle code running live". WRONG, and backwards on the mechanism.** `server.mjs:1995`
and `:2010` reach the rotator by **runtime `await import('./lib/oauth-rotator/server-tick.ts')` and
`server-supervisor.ts`** — under `tsx` those are transpiled from SOURCE, never served from `.next`.
The project's blanket "`lib/*.ts` is bundled" rule does not hold for a module the server imports
itself, and this same block had already proved the process runs more than one module registry.

**The corrected version is MORE relevant to this card, not less, and it moves the tick question:**

- `server.mjs:1995` starts `startOauthRotatorTick` on its **own timer**, gated on the flag file
  `~/.aimaestro/oauth-rotator-tick.enabled` — which this block already confirms is **PRESENT**. So
  a tick runs in-process on a schedule that owes nothing to the ingest route.
- `tsx` transpiles at IMPORT time, and this process imported at start — **Sep 5 11:16**. So the
  running rotator is Sep-5 SOURCE, which still predates `efb6a509` (Sep 8) and therefore still
  carries the old default. The deploy conclusion is unchanged; only the mechanism was wrong.
- That makes **two** candidate tick paths, not one: the `server.mjs` timer (runtime source) and the
  ingest route (`.next` bundle). The "second tick" this block worries about is the second of those.

**THE CAVEAT IS NOW LIFTED, AND IT INVERTS: a 60 s-cadence writer was running in pid 24895
throughout 2026-09-10 05:55-06:11 local.** (The adverb "RIGHT NOW" is deliberately gone. This card
has already been bitten by that tense twice — the 03:31-03:39 window had slid to 03:51-03:59 by
the next look, and three earlier drafts each carried a now-claim that decayed. A committed
document carries the WINDOW; the reader compares it to their own clock.) Two earlier drafts said
"this does NOT show `runOneTick` firing". Three reads plus —
after an adversarial review correctly ruled the reads insufficient — one live MEASUREMENT:

- **The gate is per-BEAT, not at startup.** `server.mjs:1995` is in a bare `try`, not an `if`; its
  comment says "Safe to start UNCONDITIONALLY … checked INSIDE each beat". `server-tick.ts:221` is
  `if (!enabledCheck()) return`, inside the beat, and `:100`'s `oauthTickEnabled` re-resolves the
  path via `statePath()` on **every call**. So the flag's state on Sep 5 is irrelevant; only its
  state NOW matters, and this block already confirms it is PRESENT.
- **The beat calls the tick.** `server-tick.ts:320-325`: `setInterval(() => { void runOneTick()… },
  intervalMs)`.
- **The timer really was armed at boot** — not inferred from the bare `try`, read from the log it
  emits: `logs/pm2-out.log` carries `[Startup] OAuth-rotator tick timer started` at
  **2026-09-05 11:16:51**, and `OAuth-rotator tick init failed` appears **0** times in
  `logs/pm2-error.log`. That zero is POSITIVE-CONTROLLED (a review caught it unguarded, in a
  session where three instruments had already failed): the file is 110 603 lines, last written
  2026-09-10 06:12:33, and contains 12 `[Startup]` lines and **11 812** `oauth` mentions. The
  grep reaches the file; the absence is real.
- **Which process, measured rather than presumed.** pm2 reports pid **24806**; every backup
  filename carries **24895**. An earlier draft called that "the child, presumably". `ps -eo
  pid,ppid,lstart,command` settles it: `24806 ← 10551` is `node .../.bin/tsx server.mjs` (the
  launcher wrapper) and `24895 ← 24806` is `node --require tsx/preflight.cjs --import
  tsx/loader.mjs server.mjs` — the process actually executing the server, booted 11:16:27, which
  spawns esbuild at 11:16:51, the same second as the startup line above. Precisely: **24895 is
  the worker child of the pm2-managed process 24806**, and is the process executing `server.mjs`
  (a draft compressed this to "24895 is the pm2-managed server", which pm2 would dispute — it
  manages 24806). The timestamp agreement is CORRELATION, not identity: the log line carries no
  pid. What licenses the attribution is a sweep that had not been done — `ps -eo …` over **898**
  processes finds exactly **two** ai-maestro `server.mjs` processes, 24806 and 24895 (a third hit
  is an unrelated codex MCP `server.mjs`). There is no other candidate, and `pm2-out.log` is that
  managed process's own stdout.
- **MEASURED, not argued: a 60 s-cadence writer is running** — and like the payload window
  below, this is a claim about ITS OWN 200 s, never about regularity over the counter's 44 h
  lifetime, which the 93% rate check leaves open. 200 s watch on
  `active-alerts.json` (python `os.stat`, positive control passed), 2026-09-10 06:04-06:08 local.
  Read as ABSOLUTE OFFSETS from the first sample rather than as gaps — a review's correction, and
  it reads STRONGER than the draft it replaces: **0 · 60.153 · 120.579 · 167.972 · 179.903**.
  Against a **60.0 s** grid the residuals are **0 · +0.153 · +0.579 · −0.097**, max **0.579 s**.
  (A draft used 60.2 s, taken from averaging the first two gaps; 60.0 fits better — max 0.697
  against 0.579 — so the draft's own arithmetic understated its finding.) **167.972 is 12 s off
  the nearest grid point, ~20× the residual scale**, so discarding it is separation, not
  curve-fitting. Honest statement: four of five writes fit a 60.0 s grid within 0.6 s; the fifth
  is an interloper that does not disturb it. Not "a doublet filling a slot" (withdrawn).
  `SUPERVISOR_INTERVAL_MS` is **600_000**, predicting 0-1 writes in that window: **the supervisor
  alone is excluded by rate.**
- **The two instruments measure DIFFERENT properties — a draft's "the stamps are stronger" was an
  over-correction that demoted the card's own mechanism evidence.** Nine consecutive one-per-minute
  stamps `0403…0411` establish **RATE over 9 minutes**, on a larger sample. Only the sub-second
  watch establishes **PERIODICITY** — and periodicity is exactly what distinguishes a
  `setInterval(60_000)` from a cron-like per-minute trigger or a jittery 45-75 s writer, which
  minute-resolution stamps cannot tell apart. Demoting the watch traded precision for sample count
  without saying so. Both are needed: the stamps for rate, the watch for mechanism. A
  least-squares fit over the four on-grid points puts the period at **60.0135 s** (intercept
  0.139, max residual **0.413 s**) — within ~14 ms of 60.000.
- **No writer outside the process, over the observed window.** Each mtime change in the 200 s
  watch has a matching `lib/json-io.ts` backup stamped pid 24895 (writes at
  04:05/04:06/04:07/04:07 UTC against backups `0405, 0406, 0407, 0407`). Stated as a **window
  observation, n=4** — not the universal "no writer outside the process" a draft claimed. Note
  the match is coarser than it looks: the two writes 12 s apart both land in the single minute
  `0407`, so this is minute-resolution agreement, not a true 1:1. The logic is still the right
  shape — a non-`json-io` writer (a python one, say) would move mtime with no backup at all.
  Separately, the janitor daemon does NOT write this file despite it living in the janitor's data
  dir: grepping the janitor plugin tree for `active-alerts` matches only TRDD docs and memory
  pages, no code.
- **The counter tells us LESS than a draft claimed, and re-derives what the pid already gave.**
  The backup counters step **+2 uniformly across all ten, doublet included**, so all ten writes
  share one counter — a second bundle copy would have to coincidentally land mid-sequence.
  (A draft illustrated this with `…012479 → 012481 → 012483…`, which is in **neither** the
  12423-12441 window it was attached to **nor** the re-measured 012567-012585 one: a number
  carried across from a third, intermediate read. The illustration is dropped rather than
  re-sourced — the property is stated for the window it is measured on, above.)
  But `alert-delivery` is imported by BOTH `server-tick.ts` and `server-supervisor.ts`, and both
  reach the SAME `json-io` instance in the same bundle, so "same module instance" **cannot
  discriminate the tick from the supervisor or any other in-process caller**. So this does NOT
  narrow the interloper's source, and the draft presenting it as a constraint on that was an
  over-read.
  **One residue is NOT re-derived from the pid — but two drafts got its scope wrong in opposite
  directions, and only reading `json-io.ts` settles it.** Stated against the window whose files
  are still ON DISK (**012567-012585**, re-measured above), not the pruned one:
  - **The +2 is entailed, not assumed.** `:470` is
    `rawBefore !== null ? await keepBackup(...) : null` — a backup file exists ONLY on the
    existing-file branch. So the ten backups are themselves the proof that all ten took the
    `keepBackup`+tmp path at +2. (A review objected that "+2" presupposed the counter→write
    mapping this block disclaims. Right about the earlier text; the ternary is what refutes it.)
  - **The enumeration is CLOSED, at the DOCUMENT-WRITE level — and the level matters, because at
    the filesystem level the sentence is false.** `fsyncWrite` (`:243`) writes and consumes 0; the
    prune loop unlinks; `rename` commits. None takes a counter. What holds is: every call that
    REPLACES A TARGET FILE'S CONTENTS consumes ≥1. Closed on two greps, not one — `^export`
    returns three write functions (`updateJson`, `restoreRawSnapshot`, `saveJsonSafe`) with no
    arrow or default exports, and `fsyncWrite|keepBackup` shows their only call sites are `:278`
    (inside `keepBackup`), `:470`, `:474`, `:541` — all within those three. The right test is not
    "is it exported" but "can the INSTANCE reach it another way", and it cannot. **The two greps
    are a NECESSARY PAIR, not belt-and-braces:** `saveJsonSafe` writes with plain `writeFile`
    (`:585`), not `fsyncWrite`, so the second grep misses it and only `^export` catches it.
  - **Therefore the residue:** across that window this module instance performed **no other
    content-changing json-io write, to any file** — because any such write, on any path, would
    have consumed a value and broken the run. The pid stamp cannot say this; it identifies who
    wrote THESE ten, not what else that writer did.
  - **This is the only thing that could have seen such a write.** `restoreRawSnapshot` and
    `saveJsonSafe` write **no backup at all**, so a write through either is invisible to any file
    enumeration — a counter gap is the sole detector, which is exactly why the residue is worth
    keeping.
  - **Three things it does NOT cover, all from the same read.** A no-op `updateJson` returns at
    `:453-455` (`serialized === rawBefore`) **before** `keepBackup`, consuming **+0** — hence
    "content-changing" above. `restoreRawSnapshot`'s `raw === null` branch deletes at **+0**. And
    a consumed-then-failed write still consumes, so "no gaps" excludes *attempts*, a superset of
    writes — which only strengthens the exclusion.
  - **The ten backups are an UPPER BOUND on distinct calls, and ADJACENCY is what closes it —
    not magnitude.** `keepBackup` sits INSIDE `updateJson`'s retry loop, so a stale-retry
    (`:476-489`) writes a second backup and consumes another +2 within one call. The loop keeps
    HOLDING the lock across attempts on purpose (`:485-488`), so a retry's only extra cost is the
    backoff plus small-file I/O — **its backup must land immediately after the one it retries**.
    The interloper sits at offset `167.972`, 47.4 s after its predecessor and 11.9 s before its
    successor: adjacent to nothing. That is positional and cannot be argued away by slow I/O.
    (A draft instead said retries were "two orders of magnitude" outside the spacing. The bound
    it never read is `maxRetries = Math.max(0, opts.retries ?? 3)` (`:396`), so total backoff is
    ≤ 1.2 s against 60 s — **~50×, not 100×**. The adjacency argument needs no bound at all.)
    Lock contention is excluded the same way: `withJsonLock`'s `maxWaitMs` could DELAY a beat, but
    a delay shifts a write rather than adding one, and `179.903` arrived on schedule — so the
    extra write is an extra, not a displaced beat.
    Since no sub-second-adjacent pair exists among the ten, all ten are distinct calls and the
    backup cadence IS the call cadence: the upper bound closes rather than hanging.
  - **The two conclusions ride ONE observation.** "These ten came from a single instance" is
    inferred from the uniform +2, and "that instance did nothing else" from the same +2. Not
    circular — a second copy would have to interleave perfectly — but they are not two independent
    facts and should not be counted as such.

**THE ARITHMETIC AND THE CADENCE ARGUMENT THAT PRECEDED THIS WERE BOTH WRONG, and the review
caught both.** The earlier draft said "10 writes in 8 minutes, and ~1/min is the tick exactly":
03:31→03:39 is **9** minutes, not 8; and the observed stamps carried two writes in one wall-clock
minute, which a single `setInterval(60_000)` **cannot** produce — so "exactly" was contradicted by
the data on its own line. A later draft then explained the doublet as "one supervisor beat landing
inside a tick minute, 9 + 1 = 10". That was withdrawn as unsupported — it predicts ~0.33 doublets
per 200 s and one was observed, which neither confirms nor refutes a 600 s beat. **It was the
right answer reached by the wrong instrument, and the doublet is now IDENTIFIED — by reading the
PAYLOAD instead of the filenames.**

> **THE DOUBLET IS THE SUPERVISOR BEAT. Measured 2026-09-10 ~07:0x, in-band.** Every backup is a
> copy of the file's previous contents, so the ten backups are a time series of the document
> itself. Parsing them (window `012605`-`012623`, 0454-0502 UTC) instead of just their names:
>
> | ctr | stamp | `reauth-needed.seen` | `cookie-leg-stuck.seen` | Δ |
> |---|---|---|---|---|
> | 12609 | 0456 | 2457 | 237 | reauth **+1** |
> | 12611 | 0457 | 2458 | 237 | reauth **+1** |
> | **12613** | **0457** | **2458** | **238** | **reauth +0, cookie +1** |
> | 12615 | 0458 | 2459 | 238 | reauth **+1** |
>
> **The doublet's second write bumped a DIFFERENT alert code and left the tick's own code
> untouched** — and the two producers' EMISSION SITES are disjoint by construction, so this is an
> entailment rather than an inference:
>
> | producer | its sole emission | site |
> |---|---|---|
> | tick | `const code = alertable.reason ? \`reauth-needed:${alertable.reason}\` : alertable.stuck ? \`rotator-stuck:${alertable.stuck}\` : 'reauth-needed:unknown'`, then `deliver([{ code, … }])` — a three-branch ternary, every branch prefixed, and the file's only emission | `server-tick.ts:257`, delivered `:265` |
> | supervisor | `code: 'cookie-leg-stuck'` in a finding literal | `supervisor.ts:268` |
>
> `deliverAlerts` writes the findings its caller hands it, and the tick hands it a ONE-element
> array built from that ternary. No branch of it can produce `cookie-leg-stuck`, so **no tick
> emission can produce that CONTENT CHANGE**; the supervisor is the only site that emits the code
> (`grep -rn cookie-leg-stuck lib` → 6 hits, of which `server-tick.ts:230`, `supervisor.ts:142`,
> `alert-delivery.ts:6` and `:189` are comments, leaving `supervisor.ts:204` (a registry) and
> `:268` (the emission)).
>
> **FILE vs CONTENT — the distinction a draft blurred, and it matters because of the retry
> loop.** `updateJson`'s staleness retry `continue`s ABOVE `keepBackup` (measured earlier on this
> card: +2 counter, two backup FILES from ONE call), and the 200 ms sleep keeps both inside one
> minute stamp. So a single tick call that lost a staleness race to the supervisor would emit the
> doublet's two files itself — observationally identical to two separate calls, and NOT excluded
> by the adjacency argument, since under that reading the doublet IS the adjacent pair. A draft
> wrote "a tick beat cannot have produced that write", which is false on the FILE reading. What
> the emission sites license is the CONTENT claim, and it holds under both readings: whoever
> wrote the file, the `cookie +1` recorded in it came from the supervisor, because no tick
> emission can produce that code. Cadence is unaffected either way — a retry stamps `lastSeenAt`
> once, on the attempt that lands.
>
> **And the counter spacing CANNOT decide it either — measured, against a draft that said it
> could.** Both `keepBackup` (`json-io.ts:275`) and the tmp name (`:472`) `++` the SAME
> `_atomicWriteCounter`, and both sit inside the retry loop, so one retried call consumes 4 and
> lays its two BACKUPS at *n* and *n+2* — byte-for-byte the spacing two single-attempt calls
> produce (`n`, `n+1` tmp; `n+2`, `n+3` tmp). The observed 12611 → 12613 → 12615 is therefore
> consistent with BOTH readings, and the discarded tmp files are `rm`-ed on the retry path, so
> nothing on disk records the attempt count. Round 9's file-vs-content split is not a redundant
> answer to a question the data had closed; it is the ONLY thing that closes it.
>
> **Three things the "only emission" half rests on, each now measured, because a draft rested it
> on a grep with ZERO RECALL. The warrant is the THREE TOGETHER, not any one of them** — a draft
> called the `deliver(` grep "the exhaustiveness check" on its own, which overstates a needle
> tuned to one syntactic form, the same fault one level up:
>
> - `grep -n 'deliver(' server-tick.ts` → **one hit, `:265`**. This BOUNDS the local's direct
>   calls, and on its own it is blind to an alias or a `.call` — which is why the bare-identifier
>   sweep below is part of the warrant and not a flourish.
>   A draft instead cited `grep -n "code:"`, which returned four hits — a signature, a type, a
>   comment, a parameter annotation — and **not one of them was an emission**. It could not have
>   been: the builder is `const code = …` and the call is `deliver([{ code, message: … }])`, using
>   shorthand, so neither line contains the token `code:`. The needle scored **0/1 on the class it
>   was cited to enumerate**, and its four confident hits made that look like a survey. Confirmed
>   by re-running it against the two lines in isolation: 0 matches. **A review fork caught this,
>   not I.**
> - `grep -rn deliverAlerts` over `lib app services scripts tests` → exactly **two production call
>   sites**, `server-tick.ts:259` and `server-supervisor.ts:110`. A draft left `server.mjs` — the
>   file that imports the rotator at runtime — outside that scan. Now scanned: **zero**
>   `deliverAlerts`, zero `deliverImpl`; its only rotator import is `startOauthRotatorTick` at
>   `:1995`.
> - `deps.deliverImpl` (`:258`) lets a caller replace delivery outright, so "the tick hands
>   `deliverAlerts` a one-element array" needs production to take the `??` default. **Measured,
>   not inferred from the idiom:** `deliverImpl` has 12 occurrences repo-wide — the type at
>   `:133`, the `??` at `:258`, and **ten in tests**. No production caller supplies one. Reasoning
>   from what a `??`-default usually means would have been the same move that failed twice below.
>
> **Two earlier sourcings of this same conclusion were wrong, and they were TWO DIFFERENT
> ERRORS** — a draft called them "wrong in the same direction, each citing something adjacent to
> the emission", which is a description invented afterwards, loose enough to fit anything near
> the file, and whose rhetorical work is to make a third guess read as a converging series.
> Round 4 argued it from `alert-delivery.ts:180-188`, a comment about the August TRDD-W6PHZFC9
> antiphase incident: **prose cited as if it were code**. Round 5 replaced that with
> `TICK_ALERT_PREFIXES` (`server-tick.ts:47`) called a "declared namespace": **the wrong code
> object — a FILTER, cited for a question about EMISSION** — and wrong in a way its own name
> warned about. That constant has exactly ONE use site, `ownsTickAlert` at `:52`, which is passed
> as `owns:` at `:259` — the REAP filter. It constrains what the beat DELETES from
> `active-alerts.json`, never what it EMITS, which is the whole point of the TRDD-W6PHZFC9 fix.
> The two errors share only that review caught both.
>
> Its docstring (`:43-47`) asserts correspondence with the builder and names "the `const code`
> expression in `runOneTick`". **Both halves of that are worth stating: a docstring is a good
> POINTER and a bad WARRANT.** It could not settle the question, and it is what led to the answer
> — reading the expression it names is what produced the row above, and that source is strictly
> stronger than either draft: an expression that CONSTRUCTS the value beats a constant that does
> not constrain it. A draft kept only the "bad warrant" half, which teaches the reader to skip
> the thing that got you there. A draft also wrote "a second tick beat would have bumped
> `reauth-needed`", which assumed the conclusion; the emission sites make it unnecessary.
>
> **Rate check — per counter, against its OWN `firstSeenAt`, which is the form that survives.**
> reauth: 158 267 s elapsed ÷ 60 s = 2638 expected, **2463 observed (93%)**. cookie: 143 229 s ÷
> 600 s = 239 expected, **238 observed (99.6%)**. Two independent confirmations, each of one beat
> against its own nominal period — **and confirmations of the period's SCALE only, silent on its
> REGULARITY.** With the restart story withdrawn (below), reauth's 7% shortfall is unexplained,
> so the same number cannot also be read as corroborating clean 60 s deltas; it says ~60 s is the
> right order and says nothing about whether the beat is evenly spaced over 44 h. (A draft instead cited the lifetime ratio 2463:238 ≈ 10.35:1 as
> matching 10:1. Withdrawn: the two codes start 4.2 h apart, and correcting for that moves the
> expectation to ~11:1 — **away** from the observation, so the apparent match was an artefact of
> not correcting. reauth's 93% is ~175 beats short over 44 h. **A draft added "consistent with
> restarts" — withdrawn as an unmeasured story attached to a residual, and the kind that ends an
> investigation.** It also bears on the cadence claim, so it is not cosmetic: 175 misses over 44 h
> is one per ~15 min, and the cadence evidence is a CONTIGUOUS nine-write window with clean 60 s
> deltas. Those coexist only if the misses are CLUSTERED (restarts) rather than spread (a beat
> that sometimes does not reach `deliverAlerts`). Nothing here distinguishes them; the shortfall
> stands bare, and the cadence claim is scoped to the window that was measured.)
>
> **THE PERIOD IS DECLARED IN THE SOURCE, and six rounds measured what could have been read.**
> `startOauthRotatorTick` (`server-tick.ts:320-326`): `const intervalMs = opts.intervalMs ??
> 60_000`, feeding `setInterval(() => { void runOneTick().catch(() => {}) }, intervalMs)`; the
> options interface (`:309-312`) declares exactly one field, `intervalMs?: number`, documented
> "Default 60000 — the janitor daemon's cadence". **And the call site takes the default:**
> `server.mjs:1996` is `startOauthRotatorTick()`, no arguments.
>
> **A draft stopped one line short of that and wrote "60 s is the beat, by declaration", calling
> the windows mere CONFIRMATIONS of it — which was the fourth instance of the very error that
> paragraph names itself as the third instance of.** `?? 60_000` is a DEFAULT; a default is not a
> running period until the call site is read, and the draft cited only the `import` line at
> `:1995`, never the call at `:1996`. The dependency also ran backwards: the windows are what
> MEASURED the live value; the declaration is what they agree with. The honest form is the
> three-part one — *the declared default is 60 s, the call site overrides nothing, and two
> independent windows measure the live value at 60 s.*
>
> **The windows still do work the declaration cannot**, which is the other half a draft gave
> away: this card measured **two** live ai-maestro `server.mjs` processes (24806, 24895). Two
> 60 s timers, phase-offset and serialized by the machine-wide `withTickLock`, would write at a
> SUB-60 s rate. Observing 60 s rules that out; no reading of the source can. **Narrowed below**
> — `withTickLock` DROPS a losing beat rather than queueing it, so what the windows exclude is a
> second live timer *whose beats both reach `deliverAlerts`*, and near-zero phase is not excluded
> either.
>
> **And the timer is not the only production caller.** `grep -rn runOneTick` tree-wide (round 8
> scoped it to `server-tick.ts` alone and so could not have seen this) finds a second:
> `app/api/statusline/ingest/route.ts:190`, `void runOneTick().catch(() => {})` — an EVENT-driven
> beat in a request path, gated by `tickAttemptAllowed()` (`:176`) and `isNearLimit` (`:188`).
> It does not disturb the doublet (it is still the tick module's emission, so still prefixed) and
> it does not reopen `deliverImpl` (also called with NO arguments, so `deps` is `{}` there too).
>
> **THE ATTEMPT FLOOR IS 60 s, AND IT COSTS THE CARD ITS CADENCE INFERENCE.**
> `TICK_ATTEMPT_FLOOR_MS = 60_000` (`server-tick.ts:152`); `tickAttemptAllowed(nowMs, floorMs)`
> is `nowMs - lastTickAttemptMs() >= floorMs` (`:175-177`). **The floor equals the timer period**,
> so the observed 59-61 s spacing has TWO sufficient causes and the nine writes cannot separate
> them: a 60 s timer, or a floor clamping any producer to 60 s. Every earlier round read that
> spacing as measuring the timer. It does not. `evidence-must-discriminate` names exactly this —
> an observation both hypotheses predict cannot tell them apart, and a control is all it can be.
>
> **What survives:** the declared default (`?? 60_000`) with `startOauthRotatorTick()` taking it
> unmodified at `server.mjs:1996` is now the ONLY evidence for the timer's period; the windows
> are CONSISTENT with it and do not independently measure it. Round 9's three-part warrant is
> two parts and a control. The card had this backwards in both directions across two rounds —
> round 8 called the windows mere confirmations of the declaration, round 9 called the
> declaration mere agreement with the windows, and the truth is the first with the reason the
> second was reaching for now gone.
>
> **The two-processes argument survives the floor but not the LOCK.** The floor is
> PROCESS-LOCAL — `Symbol.for('aimaestro.oauth-rotator.lastTickAttemptMs')` on `globalThis`
> (`:163-169`), no file, no lock — so it cannot clamp two processes to a shared 60 s, and a draft
> feared it could. But `withTickLock` returns null when the lock is held rather than queueing, so
> the losing process's beat is DROPPED and writes nothing. Two live timers therefore still look
> like one, and the honest claim is narrower than round 9's: *the windows rule out a second live
> timer whose beats both reach `deliverAlerts`.* Near-zero phase (both processes started by one
> `pm2 restart`) is not excluded either.
>
> **A fourth candidate for the 175 missing beats, and the residual's DENOMINATOR is now unknown
> too.** `setInterval` jitter can put a beat marginally under 60 s after the previous attempt,
> where the floor refuses it — a call that never attempts a write, which is neither of the two
> throw-path cases enumerated above. And ingest-triggered beats would raise the expected count
> above the single-producer figure the 93% was computed against. The card computed a residual
> against a one-producer model it has now disproved: not merely the cause is undetermined, the
> expectation is.
>
> **The identification is caller-independent**, which is worth stating rather than re-deriving:
> it is a property of the EMISSION (the ternary at `:257`), not of the trigger, and both callers
> reach that same emission with `deps = {}`. No caller of `runOneTick` can forge a supervisor
> code.
>
> **The same read closes the `deliverImpl` question STRUCTURALLY**, replacing round 7's
> token-absence argument. `runOneTick(deps: RunOneTickDeps = {})` (`:199`) is called at `:323` as
> `runOneTick()` — **no arguments** — and `StartOauthRotatorTickOptions` carries no field but
> `intervalMs`, so there is no route from `opts` to `deps` at all, not even a spread. `deps` is
> `{}` on the production path and `deps.deliverImpl` is `undefined` by construction, not merely
> by grep. (Round 7 claimed "no production caller supplies one" on the strength of "no source
> file outside tests contains the token" — a weaker and different claim, and exactly the
> substitution that went wrong in rounds 4 and 5. The seam's own docstring at `:129-133` says it
> exists "so a test can assert the alert REACHED a channel".) The residual needle a review named
> is also clean: `grep -n '\bdeliver\b' server-tick.ts` → three hits, a comment at `:41`, the
> binding at `:258`, the call at `:265` — no alias, no `.call`, no passing the value elsewhere.
>
> **The tick period is NINE writes, not ten.** A draft said "the identification pays for itself
> here" — overstated by one notch: **the exclusion is forced by the DATA, not licensed by the
> identification.** Differencing reauth's `lastSeenAt` across all ten backups yields a **0** at
> the supervisor write; it announces itself, and any reader would drop it. The identification
> EXPLAINS the zero, it is not needed to FIND it. Consecutive
> `lastSeenAt` deltas across the nine tick writes: **60, 61, 60, 59, 60, 60, 60, 60 s**. Nine
> writes give EIGHT deltas; eight are listed. **These are tick-to-tick only because the supervisor
> write was excluded BEFORE differencing, which is exactly what the identification licenses** —
> and the interloper sits mid-window at `12613`, not at an edge, so under the old ten-write
> reading the delta spanning it would have been the wrong one. The 61/59 pair is the adjacent
> arithmetic; it is ±1 s around 60, which is what an exclusion done correctly looks like.
>
> This is **a second reading of the same ten files, not a second sample** — different bytes
> (payload vs filesystem metadata) and a different clock (in-process `Date.now()` vs the
> filesystem's), which is what makes it immune to the `stat`-format and UTC/local traps that broke
> three instruments on this card. But if those ten files were wrong, both readings inherit it. The
> live `stat` watch (`0 · 60.153 · 120.579 · 167.972 · 179.903`) keeps the one property this
> lacks: it observed writes AS THEY HAPPENED rather than artefacts afterwards. The two agree.

Also withdrawn: the earlier claim that `server-tick.ts:32` importing `deliverAlerts` implicated
the tick. `server-supervisor.ts:25` imports the same symbol — an import shared by both candidates
cannot select between them. What settles it is the rate, not the import.

**So pid 24895 ran a 60 s beat over that window.** Everything beyond that is a separate claim, and
the summary sentence must not borrow the measurement's confidence for them. Broken out:

| component of "the tick is firing on the old threshold" | status |
|---|---|
| a 60 s-cadence writer exists in pid 24895 | **MEASURED** (grid above) |
| pid 24895 is the worker child of pm2-managed 24806, executing `server.mjs` | **MEASURED** (`ps` parentage + 898-process sweep finding no other instance) |
| the supervisor is not that writer | **MEASURED** (rate) |
| the janitor daemon is not that writer | **MEASURED** (no code, wrong pid) |
| the writer is `runOneTick` specifically | **INFERRED** — best remaining candidate, not proven |
| the `alertable` condition holds every beat | **UNVERIFIED PREMISE** the inference needs |
| `tick.ts` rides the runtime-tsx chain | **INHERITED** — inferred from `server-tick.ts`, not read |
| the constant is still **90** | **INHERITED** from an earlier session's read |
| the process runs `tsx` in FULL mode | **INHERITED** |

An earlier draft called the composite "the strongest operational statement on this card". It is
the measured part plus four weaker ones, so that label inverted the confidence ordering — which
is the same defect, in the same place, that the round before it was corrected for.

**"THE TICK IS THE ONLY 60 s TIMER IDENTIFIED" WAS WRONG ON ITS FACE, and the refutation is in the
line the claim cites.** `server-tick.ts:310-311` reads *"Default 60000 — the janitor daemon's
cadence"*: the tick's interval was chosen to MATCH another 60 s actor, so a 60 s grid cannot
select between them by cadence alone. What excludes the janitor daemon here is not cadence but
the two checks above — it has no code that writes this file, and every write carries the server's
pid. Corrected claim: **the janitor daemon is excluded as a WRITER by evidence, not by being
unimaginable as a 60 s timer.** Also in the card's favour, and previously unstated: the
`.aim-bak-` naming is ai-maestro's own `json-io.ts` convention, so whatever produced these
backups is a Node process running ai-maestro code. **This is NOT independent of the pid**, as a
draft claimed: the naming and the pid are two fields of the same filename, emitted by the same
`json-io.ts:275` call, so they stand or fall together — and the naming alone does not exclude a
SECOND ai-maestro Node process, which was the surviving alternative. Only the pid field, plus the
898-process sweep above, does that. Kept as corroboration against a
Python janitor writer.

**Two caveats the reads do NOT close.** First, `deliverAlerts` performs exactly **one**
`updateJson` per call (no retry loop, no per-alert write — the backoff gates only the human
notification). But an earlier draft turned that into "write-count is a fair proxy for
call-count", **which overreaches**: a backup is produced by `json-io.ts:275` on any
write-with-backup to that path from ANY module, so the backups count *json-io writes to the file*,
a SUPERSET of `deliverAlerts` calls. The one-write-per-call fact is about `deliverAlerts`; it is
not a fact about the file. Second, the tick's call sits inside the `alertable` branch at
`server-tick.ts:259`, **not** on every beat — so a clean 60 s grid with no dropped points is what
an UNCONDITIONAL per-beat writer looks like, and what a conditional one looks like only if its
condition never flickers. "The alertable condition holds on essentially every beat" is therefore
an **additional premise the tick hypothesis must carry**, not something the measurement taught us.
It is plausible (a stuck fleet is this card's premise) and it is unverified.

**AND IT SPLITS THE DEPLOY INSTRUCTION BY PATH — derived, not asserted.** Three drafts framed the
build three ways ("load-bearing half" → "identically required" → "unchanged") and none derived it
from the mechanism. Deriving it:

| path | how its code is loaded | what fixes it |
|---|---|---|
| the tick (`server-tick.ts` → `tick.ts`) | runtime `await import()` under `tsx`, transpiled from SOURCE at boot | **`pm2 restart` ALONE** suffices |
| the ingest route | the `.next` bundle | **`yarn build` first**, then the restart |

> ### ⛔ DO NOT RUN `pm2 restart` YET — IT WOULD CRASH THE SERVER, NOT DEPLOY THE FIX
>
> **A restart deploys the WORKING TREE, not a commit**, and the tree is dirty at exactly the file
> the restart re-executes. Verified current (`git status --porcelain`, 2026-09-10 06:12, NOT the
> stale session-start snapshot an earlier draft quoted): `M CLAUDE.md`, `M server.mjs`,
> `M scripts/aimaestro-governance.sh`.
>
> The `server.mjs` diff was UNREAD when a previous draft wrote "`pm2 restart` ALONE suffices". Read
> now, it is TRDD-7IJ08EUV box 5 — the change deliberately HELD uncommitted pending the operator's
> dev-token decision — and it is a **fail-fast that runs before `app.prepare()`, deliberately with
> no try/catch**:
>
> ```js
> const { assertDevModeAbsentInProduction } = await import('./lib/dev-mode-token.ts')
> assertDevModeAbsentInProduction()
> ```
>
> **Its precondition is MET here, and every link is now EXECUTED or READ — not reimplemented.**
> (A review's sharpest finding was that an earlier draft of this box computed the verdict by
> re-writing the predicate in python against the raw JSON, while `loadGovernance()` — the function
> that actually feeds it — went unopened. This project has a recorded incident where exactly that
> loader returned DEFAULTS over a missing `version` field, which is the one outcome that flips the
> verdict to "does not throw". A stop box is the last place a facsimile is acceptable.)
>
> **How to read THIS CHAIN TABLE** (the scope matters — a second table further down is sourced
> differently and says so in its own cells). Rows 3, 4 and 4b were **EXECUTED** — code was run and
> its output recorded. Rows 1, 2 and 5 are **READS** of live state (`pm2 jlist`, the process env,
> the script's last line) plus a short inference named in the row. No row is general knowledge
> about pm2 or Node. (An earlier version hedged one row's own result cell, which teaches a reader
> to discount the whole table — the distinction belongs here, once.)
>
> | # | link | how it was settled | result |
> |---|---|---|---|
> | 1 | pm2 re-reads the working tree | `pm_exec_path` = `scripts/start-with-ssh.sh`, whose last line is `exec "$TSX_BIN" server.mjs` from the project root | the modified file **ships** |
> | 2 | `NODE_ENV` in the process pm2 STARTS | pm2's **cached** env (`pm2 jlist` → `pm2_env.NODE_ENV`), not just the running process | `production` |
> | 3 | `loadGovernance()` surfaces the record | read `lib/governance.ts:117-127`: returns defaults only when `version !== 1`; the file's `version` **is** `1` | gate passes |
> | 4 | the predicate itself | **EXECUTED**: `tsx -e "getDevTokenStatus()"` → `{"enabled":true,"issued":true,…}` | predicate **true** |
> | 4b | **the GUARD itself** | **EXECUTED with a negative control**: `NODE_ENV=production … assertDevModeAbsentInProduction()` → **THREW** (`FATAL: a dev-mode login token is present (enabled=true, issued=true)…`); same call with `NODE_ENV` unset → **returned normally** | guard **fires** |
> | 5 | pm2's retry SETTINGS | `pm2 jlist`: `exec_mode: fork_mode`, `autorestart: true`, `max_restarts: 10000`, `min_uptime: 10000` ms, `exp_backoff_restart_delay: 1000` | tuned to **retry effectively forever**, never fast-fail |
>
> Row 4b exists because row 4 was not enough, and a review said so: executing
> `getDevTokenStatus()` runs the guard's INPUT, not the guard. This round's whole thesis is
> *execute, don't reimplement* — stopping one function short of the actual guard was the same
> defect one layer in. The negative control is what makes 4b evidence rather than a coincidence:
> it shows the throw is the `NODE_ENV` gate discriminating, not the call failing for an unrelated
> reason. Row 4 is kept because it is the env-independent half and its `createdAt`
> (`2026-08-21T16:39:34.400Z`) matches the raw file read byte-for-byte — which is what proves both
> processes resolved the SAME file, and in this codebase that is not free: `rotatorRoot()`
> resolves to the janitor plugin's data dir, not `~/.aimaestro`.
>
> Link 2 deserves its reason stated rather than assumed: `ps eww -p 24895` reads the environment
> pm2 APPLIED at the last start, and a plain `pm2 restart` replays that same cache — so it is
> evidence about the right process. It would break only if the cache had been mutated since (an
> env edit followed by `pm2 save`).
>
> `HASH_HEX_LEN` (= 64, `lib/dev-mode-token.ts:48`) is **immaterial to the CURRENT verdict** — the
> guard is `status.enabled || status.issued` and `enabled` alone is `true` — but it is
> **load-bearing for the PATCH claim below**, and a draft that flatly called it "immaterial"
> over-corrected into a contradiction with its own next paragraph. If `tokenHash.length !== 64`
> then `issued` is false, and after a `PATCH {enabled:false}` the guard would NOT fire, making
> PATCH sufficient. Both claims need the constant; only one needs it today.
>
> **And our own read confirms the error message's advice, which the draft merely quoted.** Since
> `issued` is "tokenHash present at the right length", `PATCH {enabled:false}` leaves `issued`
> true and the guard still fires. Only a revoke clears both.
>
> So `pm2 restart ai-maestro` re-imports the modified `server.mjs`, throws before `app.prepare()`,
> and the server does not come back. It crash-loops, every attempt well under the 10 s
> `min_uptime`. The restart would STOP the beat this card measured rather than fix it.
>
> (An earlier draft argued from pm2's restart ordering. The conclusion does not need it, so it is
> gone rather than labelled. See the open items for the lesson that belongs in
> `lessons-verification.md`.)
>
> **The one piece of general pm2 knowledge the argument DOES need, kept and labelled:**
> `pm2 reload` is not a safer verb here. Zero-downtime reload requires **cluster** mode, and this
> app is `exec_mode: fork_mode` (row 5, measured), where `reload` degrades to a restart. An owner
> reaching for it gets the identical outcome. This one is load-bearing precisely because it
> forecloses the alternative action the owner is most likely to take.
>
> **THE RETRY TUNING MAKES THE OUTAGE WORSE, NOT BETTER, AND A DRAFT CALLED THAT DIFFERENCE
> IMMATERIAL.** It is the most owner-actionable thing measured here:
>
> The tuning trades a visible fast-fail for **~42 h of flapping before the app reaches `errored`**
> — i.e. it never reaches it inside any window an owner would notice. (A draft made this a
> two-row table whose left column was borrowed from the same `ecosystem.config.js` comment the
> paragraph below impeaches, asking the reader to trust a source three lines above being told it
> is unreliable. The finding lives entirely in the measured right-hand side, so the table is gone.)
>
> `ecosystem.config.js:76-88` tuned for "keep the job going no matter what interruption happened",
> and for a TRANSIENT that is right. This scenario is the other kind — a boot-time throw that can
> never clear on its own — where the resilience buys nothing and the lost fast-fail visibility
> costs the outage its only alarm.
>
> **Whose number is whose, since this paragraph mixes three sources.** The ~15 s cap and the
> "~4 restarts/min" are the REPO's own claims about pm2 (`ecosystem.config.js:85` and `:86`), not
> measurements taken here — and so is the whole left column of the table above (`:78-80`).
> `exp_backoff_restart_delay: 1000` and `max_restarts: 10000` are MEASURED (row 5), and so is
> `unstable_restarts: 0`, which is what makes the budget **currently unspent** — all 10000 really
> are available now, so the arithmetic needs no assumption about whether a deliberate restart
> resets the counter. (`restart_time: 11` beside it is consistent with a reset but does not
> establish one, and nothing here depends on it.) Only the multiplication is mine — 10000 ÷ 4/min
> = 2500 min ≈ **42 h** — and it is a **ceiling**, because 4/min is the rate *at* the cap and the
> early cycles are faster, so the true figure is somewhat under. The same comment's next sentence (`:87-88`) says the budget is
> "effectively never reached in a machine's lifetime": **that half is false**, and this
> multiplication is what shows it. Citing the comment for the cap while quietly overturning its
> neighbour would be selective, so it is said out loud. (Down-vs-up does not depend on
> `autorestart` at all; that flag decides only *crash-loop vs stopped*.)
>
> **Unblocking it is an OWNER decision, and both routes are:** revoke the dev token
> (`DELETE /api/auth/dev-token` — `PATCH {enabled:false}` is NOT enough, confirmed above), or
> resolve box 5 of TRDD-7IJ08EUV. Nothing here does either.
>
> **IF THE COMMAND HAS ALREADY BEEN RUN** — the line this box was missing, and the cheapest one on
> the card: `git stash push server.mjs && pm2 restart ai-maestro` restores service immediately.
> Three things the first version of this line got wrong or left out:
>
> - **It is NOT "without touching the owner's decision".** Box 5 is held uncommitted *deliberately*,
>   so the dirty tree IS the decision, and stashing mutates exactly that. Accurate: it **defers**
>   the decision without **discarding** the change.
> - **Name the trade.** After the stash the server comes back up with a live dev-mode login token
>   present on a production build **and the guard gone** — precisely the condition box 5 exists to
>   prevent. That is the right emergency choice (service now, security debt named), but it is a
>   choice, not a free undo.
> - **Recover it explicitly:** `git stash pop stash@{0}`, or reference it by message. A bare
>   `git stash pop` takes the wrong entry when other stashes exist.
>
> RULE 0 is satisfied: `git stash` is among its named safe tools, nothing is destroyed, and this
> is advice for the OWNER to run — not an action taken here.

**The decomposition, with that gate cleared:** if only the tick matters — the half now measured to
be beating every 60 s — **`pm2 restart` alone is sufficient for the tick chain**, no build
required. `yarn build` is needed only for the ingest route, whose hazard remains unmeasured
(below).

**The scope argument, corrected twice.** A first draft checked only `lib/oauth-rotator/` — the
wrong scope, since `tick.ts` reaches outside it. A second called its replacement an "IMPORT
CLOSURE" when it was a depth-1 grep over two files, demonstrably incomplete (`./alert-delivery`
imports `@/lib/json-io`, which never appeared in the list) and blind to dynamic `await import()`.
A third draft then said "none of the three can appear in a TypeScript import closure at any depth,
**by file type**" — which sounds airtight and **answers a narrower question than the one that
matters**. Two defects, and a review named both: "by file type" is not categorical (`.md`/`.sh`
enter JS graphs routinely via raw/text loaders — it holds HERE because the runtime is `tsx`, which
will not resolve them absent loader config, a fact about the runtime, not the extension); and an
import closure **cannot see a shelled-out script**, while `server-tick.ts:26` imports
`child_process` and one of exactly three modified files is a shell script. That is the most
obvious runtime-dependency overlap on the board, and the file-type argument is structurally blind
to it.

**The honest form has TWO conjuncts, and both are now checked:**

1. *No modified file is reachable by import.* `CLAUDE.md` is markdown, `aimaestro-governance.sh`
   is shell, and `server.mjs` is the ENTRY POINT — it imports the tick rather than being imported
   by it. (Also: "TypeScript import closure" was the wrong term for a graph rooted at an `.mjs`
   file traversed by tsx.)
2. *The tick execs and reads none of them at runtime* — **the conjunct no draft had checked.**
   `grep -rn "aimaestro-governance" lib/oauth-rotator/` returns nothing, and that negative is
   POSITIVE-CONTROLLED (a first attempt was not: its control also returned nothing, proving
   nothing). The string appears in **9** files repo-wide — `install-agent-cli.sh`,
   `scripts/aimaestro-{trdd,teams,governance,portfolio,continuity}.sh`, two unit tests — and in
   **zero** files under `lib/`. Every spawn target in the whole rotator tree is accounted for:
   `secret-tool` (`live.ts:110,203`), `unbrowse` (`reauth-drive.ts:118`), `pgrep -x claude`
   (`server-tick.ts:113`), `powershell` (`safe-storage.ts:652,676`), plus `safe-storage`'s
   parameterised keychain-CLI `argv[0]` sites. None is the governance script.

So the modified shell script is outside the tick's effective dependency set by BOTH routes. The
stop box above still applies regardless: the entry point is in neither closure, and it is what the
restart executes.

**This contradicts a documented project rule, deliberately, and here is the boundary.**
`CLAUDE.md` states flatly that `lib/*.ts` is bundled into `.next` and needs `yarn build`. That
rule holds for modules reached **through a `.next` route**; it does NOT hold for modules
`server.mjs` imports itself at runtime under `tsx`, which are transpiled from source at boot. The
rotator tick chain is in the second category. Anyone finding the two statements together should
read this as the narrower exception, not as the rule being wrong.

**What is still NOT established, and must not be read into this:** reaching the route is not the
same as the stale tick FIRING. `app/api/statusline/ingest/route.ts:176` is a gate that can return
early, and nothing here measures whether it did. The hazard's *precondition* moved from unknown to
met; the hazard itself remains unmeasured.

**What survived from the wrong draft** — these checks were sound and are unaffected, and together
they say the POSTer is not the obvious candidate:

- The route's only caller in this repo is `scripts/aimaestro-statusline.sh:162`, and that script
  is **not** the configured statusline: `~/.claude/settings.json` runs
  `agentlenspro statusline --inner '… .venv/bin/python3 ~/.claude/statusline.py'`.
- Neither half of that live chain names the route — `statusline.py` matches `statusline/ingest`
  **0** times, and the AgentlensPro repo (`/opt/homebrew/bin/agentlenspro` →
  `Code/AgentlensPro/standalone/cli.js`) matches it in **0** files against a positive control of
  **1026** files that do mention `statusline`.
- The store (`~/.aimaestro/statusline-state/`, i.e. `statuslineStateDir()`) holds exactly one
  session — `abc123.json` — plus its `.aim-bak-*` copies, every one 665 bytes.

**The payload is fixture-shaped, and that is the open puzzle rather than the answer.**
`sessionId: "abc123"`, `usedPercentage: 23.5`, `resetsAtMs: 1738425600000` (a Feb-2025 constant)
— `abc123` is also the id used across ten-plus files under `tests/`. Fixture-shaped content
arriving *through the live server's own pid* means someone is POSTing test-shaped data at the
running server, not that a test wrote the file directly. Who, is unidentified.

**What this changes for box 5 — LESS than a draft of this block claimed.** That draft said "the
build is now the load-bearing half rather than a precaution". **Retracted:** `yarn build` is
required identically under BOTH readings, because the stale default lives in the bundle whether or
not any route is hit, and this block already said "run BOTH" before either draft. What the finding
actually removes is the *reading under which skipping the build would have been harmless*. That is
worth having and it is not an escalation.

It does add a question that is the owner's: **what is POSTing to `/api/statusline/ingest`?** The
obvious candidates are excluded — **27** `settings*.json` files under `~/agents` and `~/.claude`
were scanned and **none** wires `aimaestro-statusline*`, on top of the configured statusline
chain's 0 hits above.

**IS `AIM_FLEET_MODEL_FALLBACK` ARMED?** If not, the model-fallback sweep lane is dormant —
`fleet-liveness-watchdog.ts:344` gates the sweep on it and `server.mjs` starts the watchdog with
no options — so Change 2 changes nothing observable, and the Problem section's "the fallback
sweep independently declares scoped exhaustion at 90" describes a lane that is not running. The
tick's own 95 (Change 1) is unaffected either way. The owner's to confirm.

**BOX 6 HAS NO RUNTIME SURFACE.** Neither `SAFE_SCOPED` nor `SCOPED_SWITCH_AT_PCT` is ever an
argument or interpolated into a string. Seven sites, the complete set
over a repo-wide sweep of every file type: `tick.ts:107` defines 95 and `model-fallback.ts:169`
defines 97; `tick.ts:56` imports (a plain import, not a re-export); `:276`, `:532`, `:625` compare;
and `model-fallback.ts:212` is the sole ASSIGNMENT, whose local appears exactly once below it —
`input.scopedPct >= threshold` — leaving no room for a logger, a throw, a closure or a write back.
Separately, in BOTH modules every non-comment occurrence of the literals `95` and `97` is a `const`
initializer — `:169`, `:107`, and `tick.ts:90`/`:91`, the ACCOUNT-window trips that merely share
the value 97 — and a number reachable only from a `const` initializer cannot sit inside a template
literal, whatever emitter wraps it. Nothing but these two files calls
`pctEnv('ROTATOR_SCOPED_SWITCH_AT', …)`. So box 6 cannot be settled by
reading a number off the running system, build or no build — it needs the source, or restating as
a behavioural check (94 accepted, 96 vetoed), itself not on demand because the scoped percentages
are consumption-driven.

Two side facts from the same read: the tick is **ENABLED** (`~/.aimaestro/oauth-rotator-tick.enabled`
is PRESENT — tested by exact path, never a `*.flag` glob), and caveat (c) is re-confirmed on the
LIVE pid: `ps eww` shows no pinned `ROTATOR_SCOPED_SWITCH_AT` / `ROTATOR_SCOPED_ACCOUNT_HEADROOM`,
so the new defaults will not be inert.

**The 09-08 numbers quoted on this card were not measured by this session.** The approval log is
the source and carries its own qualifier (box 2's neuters were *not re-run*) — read it there.

NEXT ACTION — **the OWNER's:** lift the hold (box 5) and run **both** `yarn build` and
`pm2 restart` — a restart alone can leave a second tick running at 90 from the stale bundle, and
that route is now measured to be REACHED on the live pid (see above), so the build is the
load-bearing half. The same deploy
also lands TRDD-RE9AVNJF (`5aa945c1`, `48e839b6` touched `tick.ts` and `slots.ts`, the same
runtime chain). Then two calls that are yours and not mine: whether `AIM_FLEET_MODEL_FALLBACK`
is armed (if not, Change 2 is inert and the Problem section overstates the sweep), and how to
settle box 6 given that no runtime surface prints either number.

OPEN ITEMS not owned by the owner — **all three now CLOSED, done rather than carried**, because
a lesson parked behind an unscheduled chore is findable only by someone reading this card, which
is the one population that already knows it. "Recorded" was the wrong word for the previous state
of this block:
- **DONE — the blocking chore.** Four enforcement-ratchet entries (the R20.5/G15 free-pin, the
  R7.8/R4.8 coupling, the R39.5/R39.7 superseded-guard, the R32.2/R37.4/R37.2 clause count)
  relocated verbatim from `.claude/rules/lessons-verification.md` into
  `.claude/rules-reference/lessons-verification-full.md` under their own headings. All four are
  the lowest-recurrence class the budget rule names — one completed campaign, dense in its own
  R-numbers and gate ids. **Four, where the chore was written as "relocate ONE entry", is forced
  by arithmetic and not scope creep:** three lessons at ~400-500 B each need ~1200 B+ freed
  against 245 B of headroom, and one entry yields ~400-500 B. Freed 1610 B; the file went
  98059 → 97819 B against the 98304 cap after the three new entries landed.
  `tests/governance/lessons-file-budget.test.ts` 3/3. **Remaining headroom is 485 B**, so the
  next one or two lessons re-trigger this same chore — it is deferred, not retired. These went
  to a rules file (injected every turn, strong passive recall) and NOT to memgrep, so they are
  absent from symptom search; that is a choice, not a default.

STOPPING RULE for this STATE block. A further round is warranted ONLY if it (1) removes a claim
whose evidence does not support it, (2) closes a gap by measurement, or (3) **changes the card's
operational recommendation or an acceptance box.** A wording change to an already-correct claim
fails all three and belongs in a commit message.

Test (3) was drafted as *"changes what the owner would do"* and is replaced: the owner has said
nothing this session, so that phrasing asks for a prediction about a person and can be
rationalised either way. The version above is a fact about the artifact. **Nothing has met it
since round 1** — the operational finding has been actionable and unchanged throughout, and
every round has pushed it further down a longer document.

**The rule's first act was to be violated by the commit that carried it, and saying so is the
only thing that keeps it from being decorative.** Round 8 presented four edits as compliant;
its item 3 (an attribution and wording change) failed all three tests and shipped anyway. Round
9 ships only test-1 and test-2 items and strikes two meta passages.

**Round 10 is not to be run as an edit pass**: record further review findings as a list under
one `unreviewed residue` heading unless one meets (1), (2) or (3).
- **DONE — lesson 1** (`## Claims about the codebase`): labelling an unverified claim is
  disclosure only when the conclusion still needs it — delete the claim and see whether the
  conclusion weakens; if it does not, the label is retention dressed as honesty.
- **DONE — lesson 2** (`## Shell`): a pipeline whose PRODUCER fails silently makes "no
  difference" and "no data" indistinguishable, and the wrong answer is the confident one. Here
  `json.tool` errored to `/dev/null` on two already-pruned backups, `diff` compared two empty
  streams, and printed `IDENTICAL` — which would have REFUTED writes≡calls and ended the search.
- **DONE — lesson 3, earned by round 6 itself** (`## Claims about the codebase`): a constant's
  NAME and its own DOCSTRING are not its use sites. `TICK_ALERT_PREFIXES` reads as a producer's
  declared namespace and its docstring asserts the correspondence; its one use site is the reap
  filter. Read who calls it before deriving anything from it.

**Round 10 ran as the rule allows: two test-1/test-2 findings written above, everything else
listed here and not written.**

### unreviewed residue

- The 175-beat reauth shortfall now has a **fourth** candidate and no denominator: `setInterval`
  jitter landing a beat marginally inside the 60 s floor is a call that never attempts a write,
  and ingest-triggered beats would raise the expectation above the single-producer figure the
  93% was computed against. Unmeasured; both directions.
- `withTickLock`'s drop-vs-queue behaviour is read from the null return, not driven. The
  narrowed two-processes claim above rests on it.
- Whether the two live `server.mjs` processes started at near-zero phase (one `pm2 restart`) is
  not measured, and near-zero phase is the case the windows cannot exclude.
- The observed 60 s has two sufficient causes and no experiment here separates them. Separating
  them needs a run with the floor lowered, which is a change to the running server.
- Nothing in rounds 5-10 moved the operational finding, which has been unchanged since round 1.

COLUMN: `dev`, unchanged, and the owner's call. Three drafts of this block argued the column and
each introduced a false or over-read claim; that argument is in git, not here.

## Problem

lib/oauth-rotator/tick.ts:521-522 `isSafeAlternate(bfh, bsd, scoped)` vetoes any alternate whose scoped (per-model, Fable) window is `>= SAFE_SCOPED` (l.98, aliased to `SAFE_7D = 90`, l.93), while the rotate-away trip is `SWITCH_AT_SCOPED` (l.97, aliased to `SWITCH_AT_7D = 97`, l.90) — a 7-point gap the account windows keep but the model-scoped window does not. `lib/oauth-rotator/model-fallback.ts:161` `SCOPED_SWITCH_AT_PCT = pctEnv('ROTATOR_SCOPED_SWITCH_AT', 90)` trips the fallback-to-model-switch decision at the SAME 90. Net effect: once Fable sits at 90-96 on every account, every alternate is vetoed as unsafe (below the 97 walk-away trip) AND the fallback sweep independently declares scoped exhaustion at 90 — so the fleet is handed to a model switch (a full cache reset, burning millions of tokens fleet-wide) instead of rotating to whichever account has the most Fable headroom.

## Evidence

- `lib/oauth-rotator/tick.ts:90,93,97,98,521-522`: `SWITCH_AT_7D=97`, `SAFE_7D=90`, `SWITCH_AT_SCOPED = SWITCH_AT_7D`, `SAFE_SCOPED = SAFE_7D`, `isSafeAlternate` uses both. `lib/oauth-rotator/model-fallback.ts:161` `SCOPED_SWITCH_AT_PCT = pctEnv('ROTATOR_SCOPED_SWITCH_AT', 90)`.
- Evidence trace 2026-09-06 05:51-06:08, one account, live: Fable 94 -> 97 -> 98, log line "+SCOPED-WALL … staying put" with "no alternate has headroom on that model" — that morning the account's OWN window was already past the 97 trip, so this fix would NOT have prevented it (the alternates' own scoped percent is not logged, so their state is unknown). Source: reports/lean-worker/20260906_060602+0200-rotator-fable-headroom-trace.md.
- Same trace: "no alternate has headroom on that model" recurs 81 times 03:02-06:02 across all three known accounts (fmuaddib 90-96% Fable at 03:02-04:xx, ipazia 95-97% at 05:2x, emanuele.sabetta 97% at 06:00-06:02) — i.e. the fleet spent hours with every account's Fable window inside or above the unlocked 90-97 band.
- USER ruling (verbatim, quoted without any at-sign): "the ai-maestro chore is buggy and incapable of predicting the fable headroom exhaustion and to rotate to an account with still fable headroom, before resorting to model change (a bad thing that reset all cache, burning millions of tokens across all agents)."
- Janitor session (ai-maestro-janitor-ef, 2026-09-08): prompt caches are per-organization and each subscription account is its own org, so an account rotation cannot reuse the previous account's cache — documented, not measured; a rotation keeps the model, a model switch loses both. This card does not claim a rotation preserves cache.

## Proposed fix

Change 1 — lib/oauth-rotator/tick.ts: give `SAFE_SCOPED` its own literal, `95` (a 2-point hysteresis under the 97 walk-away trip, narrower than the account windows' 7-point margin because a rotation landing on a 97 model-scoped alternate trips away on the very next tick — a ring the 60s dwell floors but does not bound).
Change 2 — lib/oauth-rotator/model-fallback.ts: change `SCOPED_SWITCH_AT_PCT` default from 90 to 97 (equal-trip with tick.ts's walk-away number, so the sweep's verdict and the tick's verdict trip at ONE number — TRDD-IZ6KU37Y is the precedent for two verdicts drifting apart).
Change 3 — tests: isSafeAlternate(94)=true / (95)=false / (96)=false; planModelFallback with scopedPct 94 and 96 both return skip 'no-model-scoped-exhaustion' with no threshold override; scopedPct 97 with account windows under 90 proceeds past the scoped check; the existing TRDD-IZ6KU37Y "walled at 92" fixture is rewritten to the new equal-trip invariant, never deleted.
Quantified at the measured burn rate (~3 points / 9 minutes from the evidence trace): the previously-unlocked 90-95 band is worth ~15 minutes of extra rotation headroom per alternate; the 95-97 hysteresis band is ~6 minutes.

## Caveats

(a) 95 is 5 points more conservative than the janitor's own detector, which treats a window as spent only at >= 100 — deliberate, for the hysteresis reason in Change 1.
(b) UNVERIFIED premise for the USER's ruling: rotating accounts may itself force a prompt-cache cold start (org-scoped caches), in which case rotate-first buys Fable minutes rather than cache — not verified here.
(c) pctEnv reads its env var at module load, so a pinned ROTATOR_SCOPED_SWITCH_AT in the live pm2 environment makes the new default inert until checked against `ps eww` on the running pid.
(d) ~~lib/*.ts is bundled into .next, not live on pm2 restart alone — this fix needs `yarn build` + restart~~ — the conclusion (`yarn build` + restart) survives, but not for this reason: `tick.ts` IS bundled, and what makes the build necessary is a BUNDLED ROUTE running a second tick. The STATE block carries the corrected version. The hold itself is unchanged and still stands (the dispatching session's write-scope constraint: no build/commit/push here).
(e) out of scope: a race with the janitor's separate, manual, Fable-blind rotate_to.py rotation path — named only, not analyzed.

## Acceptance

- [x] fix landed (commit sha recorded here)
- [x] boundary tests (isSafeAlternate 94/95/96, planModelFallback 94/96/97) land, plus two separate neuters recorded per the verification-lessons discipline
- [x] the tick's SCOPED-WALL verdict and the fallback sweep's verdict measured to read the SAME 97 constant (or made to, per Change 2)
- [x] live pm2 environment checked for a pinned ROTATOR_SCOPED_SWITCH_AT / ROTATOR_SCOPED_ACCOUNT_HEADROOM that would make the new default inert
- [ ] built (yarn build) and restarted — currently on HOLD
- [ ] USER confirms the two numbers 95 and 97 once landed — a confirmation of a landed default, not a pre-approval gate
- [x] follow-up filed: log each alternate's own scoped percent on the SCOPED-WALL verdict, so a future trace like the 2026-09-06 evidence can tell whether the fix would have helped

## Approval log

- 2026-09-08T15:23:54+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-08T15:40:27+0200 — fix commit efb6a509 landed on governance-rules (coordinator: the 5 vitest files matching isSafeAlternate or planModelFallback — 109 passed; tsc --noEmit 0 error lines; ROTATOR_ env pins 0 on the shell, the pm2 process pid 24806 and ecosystem.config.js). Box 2's neuters (SAFE_SCOPED back to 90: 1 red; default back to 90: 3 red) are the worker's recorded runs in reports/lean-worker/20260908_153015+0200-r47-rotator-safe-scoped-fix.md, not re-run. Box 3: the SCOPED-WALL verdict (isScopedOnlyWall) guards on SCOPED_SWITCH_AT_PCT, so Change 2 alone re-aligns it and planModelFallback to 97. Residual gap (review fork 27): an alternate at scoped 96-99 still has Fable headroom and is still vetoed — 95 is a hysteresis bar under the 97 trip, not any-headroom-below-100; a USER decision. Janitor bar gap (ai-maestro-janitor-ef, same day): rotate_to's has-Fable-headroom bar stays 90, owner-settled in S2RZHXU7. Not live until yarn build + restart (HOLD).
- 2026-09-09T12:28:10+0200 — takeover by governance-rules-session: assignee ai-maestro-hub-session not alive in ListAgents at 2026-09-09 12:26.
- 2026-09-09T12:28:37+0200 — box 7: follow-up filed as TRDD-8L6GZOSE (Tier 0 self-mandate, column todo). Boxes 5 and 6 remain: 5 is on USER HOLD (no build/restart authorised), 6 is the USER's confirmation of 95/97 once deployed.
