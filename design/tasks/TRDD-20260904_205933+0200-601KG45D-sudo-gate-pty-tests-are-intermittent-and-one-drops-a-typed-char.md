---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail intermittently and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T20:59:33+0200
updated: 2026-09-05T01:11:45+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: bugfix
priority: 2
severity: medium
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-04T20:59:33+0200
parent-trdd: WV8FDAH0
blocked-by: []
npt: []
eht: []
implementation-commits: [fc3b6f76, 1a2a1b2c, b0ec7002, 5aab3a19, 65a56eeb, bb0e23c2, e3787efb, c74d8798, c6f8252e]
labels: [flaky-test, pty, sudo-gate]
---

# The sudo-gate pty tests are intermittent, and these are the tests that pin a security fix

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-04

## ⏵ BOTTOM LINE — READ THIS FIRST, IT IS WHAT A READER CAN ACT ON (2026-09-05T01:09)

The card ran eight review rounds without ever stating one. Synthesis on the corrected facts:

1. **The truncation is REAL and reproducible** — 11 events, always TAIL-1, always the last byte
   before the terminator, length-independent (22 and 40 chars both lose exactly one).
2. **The trigger needs a signal PLUS a machine-timed write.** P13 removed the `^C` and got zero
   in 320 detecting typings; blind writing alone does not reproduce the rate.
3. **THE BINDING CONSTRAINT IS THE SIGNAL, NOT THE TERMINAL.** `common.sh:729` excludes
   **pipe-spawned** callers (CI, `child_process.spawn`, a session-less daemon) — **it does NOT
   exclude agents as this project actually deploys them.** ai-maestro agents live in **tmux**
   panes (`scripts/remote-install.sh:1643` spawns them; `server.mjs:9` imports `node-pty`), and
   a process in a tmux pane HAS a controlling terminal, so `: < /dev/tty` succeeds and the probe
   PASSES. An agent running `aimaestro-agent.sh` in its own pane reaches `read -rs` exactly as a
   human does. What it still cannot easily do is deliver **SIGINT** to itself mid-prompt — and
   that is less exotic than "no plausible analogue", since the dashboard streams these terminals
   and can write `\x03` into a pane.
4. **⇒ User-facing risk is confined to one narrow conjunction:** a `^C` landing mid-prompt AND a
   machine-timed write inside a millisecond window. For a human the two halves are
   near-mutually-exclusive (someone pressing `^C` is not simultaneously pasting).
5. **IT FAILS CLOSED. This is NOT a credential-disclosure or auth-bypass bug** — a short password
   is simply wrong, the server refuses it, nothing is minted. **This is the fact that makes LOW
   obviously right rather than a judgment call**, and its absence let a skim read "credential
   truncation" as something graver.
6. **Ownership is probably NOT ai-maestro's.** The gate does the ordinary thing (`stty -echo`,
   `trap INT`, `read -rs`), so every bash script reading a password under an INT trap shares the
   exposure.
7. **The failure is LOUD, not silent** (`sudo exchange refused`, `RC=1`). The defect is that a
   truncated password is indistinguishable from a mistyped one.

**ACTIONABLE, in priority order:**
- **(a)** The ~10-line **upstream reproduction outside this repo** — bash + pty + `trap INT` +
  `read -rs`, `^C` then a timed write. Settles ownership faster than any in-repo cell.
- **(b)** The **hot-spot sweep** (~130 runs, ~1 h) — a flat result falsifies the
  transitional-window story outright, which is the cheapest possible outcome.
- **(c)** Optional, independent of both: **retry-on-refusal** in the gate. Good UX regardless of
  who owns the bug.

**Whether to close this card is now a judgment a reader can actually make.** My own read: the
severity is LOW on (4), so (a) and (b) are worth one session, and (c) is worth doing whatever
they find.

## ⏵ P13 ANSWERED 2026-09-05T00:56 — ZERO in 320 detecting typings. THE INTERACTION IS REQUIRED.

**40 runs. 3 truncations, ALL in the fixed arm (`run 10 [P8 P9]`, `run 15 [P9]`). P13: zero.**
The no-signal blind-write cell did not truncate once.

**WHAT THIS LICENSES — exactly one thing.** Blind writing ALONE does not reproduce the fixed-arm
rate, so *"the harness types into an unready tty and that is the whole story"* is rejected: **the
`^C`/signal path is implicated as a NECESSARY CO-FACTOR.** That is the payoff of breaking the
collinearity, and it is all of it.

**"IMPLICATED" IS NOT "DEFECTIVE", AND THE CARD HAD ALREADY SLID INTO SAYING SO.** It claimed a
signal-interrupted `read` losing a byte "is `common.sh`'s problem, not the harness's". But
`common.sh` does an entirely ordinary thing — `stty -echo`, `trap INT`, `IFS= read -rs`. If a
byte dies when bash restarts a `read` after a trapped signal, the defect plausibly lives in
**bash's read-restart path or the tty line discipline**, and `common.sh` is merely where it
SURFACES. Any change there would then be a WORKAROUND, not a fix. Ownership is unresolved;
"product bug" pre-judged it, and in the direction I had been building toward all session.

**If anything the reframe is still UNDER-corrected.** Because the gate does nothing unusual,
**every bash script that reads a password under an INT trap has the same exposure** — which makes
this a bash / line-discipline issue that ai-maestro merely HOSTS. **The fastest way to settle
ownership is an upstream reproduction OUTSIDE this repo:** a ~10-line bash script under a pty,
`trap INT` + `read -rs`, `^C` then a timed write. If it truncates there, the question leaves this
card entirely.

**But "not our bug" must NOT become "no action" — though the action I proposed was theatre.** I
wrote that "the gate knows the credential's expected shape at the point of use". **It does not.**
A password is opaque: no length, no charset, no checksum the gate can assert without hardcoding a
policy it does not own — and encoding a password policy in a shell script is worse than the bug.

**And "silently failing" was simply false.** The server rejects a wrong password, the gate
surfaces it as `sudo exchange refused` with `RC=1`, and **P1 asserts exactly that** — so the
failure is loud. **The real gap is DIAGNOSIS, not detection:** a truncated password is
indistinguishable from a mistyped one, so a user who typed correctly is told they got it wrong.

**The proportionate fix is therefore a RETRY AFFORDANCE — re-prompt once on refusal instead of
`return 1`.** It needs no shape validation, it is good UX independent of this bug, and it is the
lazy correct change; the shape check was the over-built one. **Scope it precisely: retry ONLY on
`401 invalid password`, NEVER on a network/5xx error** (re-prompting someone who typed correctly
is the diagnosis problem inverted), and **ONE retry, not a loop.** No brute-force amplification —
the server is the rate-limit authority and a local re-prompt does not touch its accounting; no
token-state hazard either, since a refusal means nothing was minted.

**⚠ THE EXPOSURE QUESTION WENT WRONG TWICE, IN OPPOSITE DIRECTIONS, AND THE ANSWER IS A THIRD
THING NEITHER ROUND NAMED.** First I wrote *"no human ever reproduces it… nobody at risk"*. Then
I over-corrected to *"agents drive this gate at machine speed by design — the NORMAL case"*.
**Both were written without opening the gate's own entry conditions. One grep settles it:**

```
:729   if ! { : < /dev/tty; } 2>/dev/null || ! { : > /dev/tty; } 2>/dev/null; then
:730       "Error: this operation is strict (sudo-gated) and needs the MAESTRO password from a terminal."
:731       "       Non-interactive callers must pre-mint a token into AIMAESTRO_SUDO_TOKEN."
```

**The gate refuses PIPE-SPAWNED callers, by design, with a documented alternative.** Prompt and
read are BOTH on `/dev/tty` (`:752`, `:753`), and the guard at `:729` is a real OPEN probe whose
own comment records it was MEASURED against a session-less spawn. The tests pay for `ptySpawn`
because **the gate needs a terminal** — which is all that proves.

**⚠ AND THIS REFUTATION OVER-CORRECTED IN TURN — the THIRD reversal on this one question,
corrected 2026-09-05T01:11.** I wrote that agents "**never reach this code**". That is false on
the deployment this repo actually ships: **ai-maestro agents live in tmux panes**
(`scripts/remote-install.sh:1643`; `server.mjs:9` imports `node-pty`), a tmux pane IS a pty, so
a process there HAS a controlling terminal and **passes the `:729` probe**. The guard excludes
CI, `child_process.spawn`, and session-less daemons — **not agents as deployed.** The
`AIMAESTRO_SUDO_TOKEN` path existing does not establish that every agent-driven strict operation
takes it.

**The binding constraint is the SIGNAL, not the terminal** — see bottom-line fact 3. Note the
recursion: I accepted the prior round's `/dev/tty` inference without checking it against the
architecture named in the first line of this project's own CLAUDE.md. I did catch it in parallel
by grepping for `tmux new-session` — but only AFTER committing it.

**WHAT ACTUALLY SURVIVES — the conjunction, stated so a reader can judge it:** a HUMAN, at a real
terminal, who presses `^C` mid-prompt, and who then **PASTES** rather than types (paste is the one
plausible route to a machine-timed write into a real tty), and whose paste lands inside a window
measured in milliseconds. Narrow — and note the two preconditions are near-mutually-exclusive in
human use, since someone pressing `^C` is not simultaneously pasting.

**THE META-LESSON, in two sentences.** Invoking your own bias pattern is not evidence — check the
claim; one grep settled this one, three times. And the tell is consistent: **what I DERIVED
(handler ordering, sweep power) held up; what I ACCEPTED FROM REVIEW UNCHECKED did not.**

What P13's zero DOES say, stated at its real strength: **no evidence of truncation at a rate
comparable to the fixed arm** when the signal is absent. Not "safe" — at the pessimistic end of
the rate CI, P(0 in 320) ≈ 3.2%.

**WHAT IT DOES NOT LICENSE, and the second row is the one that hurts:**

| framing | number | verdict |
|---|---|---|
| unpaired, **this batch's own rate 1.875% (3/160)** — the only same-suite comparison | P(0 in 320) ≈ **0.25%** | strong — **IF the trials are independent** |
| ~~unpaired, pooled 2.29% (11/480 over 120 runs)~~ | ~~0.065%~~ | **WITHDRAWN, not merely flagged** — see below |
| **paired within-run, clustering-robust** | only **2 discordant runs** ⇒ `(1/2)^2` = **0.25** | **WEAK — not significant** |

**The clustering-robust test cuts BOTH ways, and I would have missed that if I had only quoted
it where it flattered me.** It is powerful for polling-vs-fixed (8 discordant runs, p = 0.0039)
and nearly powerless for P13-vs-fixed, because this batch produced only 3 events and therefore
only 2 discordant runs. So the strong P13 numbers rest entirely on the independence assumption
the card has NOT been able to defend — the same assumption the sign test exists to avoid needing.

**THE BATCHES MAY NOT BE POOLABLE, and I pooled them without checking.** Batches 1-2 (the 80
logged runs) PREDATE P13; batch 3 contains it, and per-run duration went **14.5 s → 25.8 s**. The
entire hypothesis space here is load- and timing-sensitive, so a suite that now takes 78% longer
per run is not obviously the same experiment. The `11/480` pooled rate silently assumes it is.
The per-batch rates are close (1.875% in batch 3 vs 2.5% over batches 1-2), which is reassuring
and is not a test.

**FLAGGING IT WAS NOT ENOUGH, SO THE POOLED NUMBER IS WITHDRAWN.** Ordinarily a caveat beside a
figure would do. Not on THIS card, whose demonstrated failure mode is exactly numbers outliving
their caveats: the 7-vs-0 survived inside a block I had just edited, and a superseded p was
carried into three separate paragraphs. Leaving `11/480` in place with a warning next to it is
the same shape as both. **Report the two per-batch rates separately, derive nothing from a pooled
figure, and compute one only at a point of use with the assumption stated inline.**

**Honest summary: the interaction is IMPLICATED, not established.** The continuum caveat still
stands too — a zero rules out "blind writing reproduces the fixed-arm rate" and does NOT rule
out "blind writing contributes a smaller amount" (at 0.5% a zero has P ≈ 20%).

**NEXT ACTION — SWEEP THE WRITE DELAY. TARGET A HOT SPOT, NOT AN EDGE — the edge version is not
viable and "measure the WIDTH" implied it.** Vary the one number in P8's shape (write at 400 /
600 / 800 / 1000 / 1200 / 1600 / 2400 ms after the `^C`). **Computed independently before the
review's own figure arrived, and they agree exactly** — at ~2%/typing, `P(0) = 0.98ⁿ`:

| n per delay point | P(0) if the rate is still 2% | verdict |
|---|---|---|
| 8 ("several") | 0.85 | **useless** — a zero means nothing |
| 25 | 0.60 | enough for a 5-10× HOT SPOT |
| 150 | 0.048 | what a confident EDGE needs |

**Edges: ~150/point × 7 points ÷ 8 typings/run ≈ 900 runs ≈ 6.5 h. Not viable.**
**Hot spot: ~25/point ≈ 19 runs/point ≈ 130 runs ≈ 1 h. Run this, coarse, first.**

**And the cheapest possible outcome is a FLAT result:** if the rate does not vary across
400-2400 ms, the transitional-window story is falsified outright with no edge needed.

**Anchor the delay to `PRIOR-INT`, not to the prompt.** That is what the retraction below is
actually good for: it removes the jitter between "harness wrote `\x03`" and "bash handled it",
which would otherwise smear every point of this sweep.

One harness change, one batch, and it answers BOTH open questions at once:

- **MECHANISM** — a narrow window pins the loss to a specific transition in the resume sequence
  (the handler's `stty` calls, the `read` restart); a wide one falsifies the transitional-window
  story outright.
- **USER IMPACT, which is the question that decides whether this card matters** — window width
  versus human typing latency IS the product-bug question. Microseconds ⇒ nobody is at risk and
  this closes as a harness artifact with a signal precondition. ~100 ms ⇒ a paste could hit it
  and it is real.

**Attribution: the sweep is the SIXTH REVIEW's finding, not mine.** An earlier version of this
line said only "nobody proposed measuring the window through five review rounds", which is true
and quietly framed the idea as arriving rather than as being handed to me. Every other finding on
this card is attributed; this one gets the same treatment, or the provenance record becomes
selectively generous to its author. It dominates every remaining binary cell.

**THEN the localization probe:** does the byte FAIL TO REACH the line discipline, or reach it and
get DROPPED at commit? Hypothesis 2 is the sole survivor by ELIMINATION, never by direct
measurement. A probe with echo left ON shows what the discipline received — 40 echoed chars with
`read` getting 39 means it arrived and was dropped at commit; 39 echoed means it never arrived.

## ⏵ LENGTH EXPERIMENT — ANSWERED 2026-09-05T00:21. 39 bytes, TAIL-1, 4/4 at 40 chars.

```
run-007  run-009  run-012  run-039   jq -Rnc stdin: 39 byte(s) for 40 expected · TAIL loss: 1
```

Exactly the pre-registered **expected** row. **The loss is ONE BYTE AT THE END, INDEPENDENT OF
LENGTH.** This kills two branches outright: an absolute cap would have given 21, and a
proportional/streaming effect would have given ≤38. Rate held at 4/40 at both lengths — **and
that coincidence is not evidence of anything.** At n=4 the interval on 4/40 spans roughly 3-25%;
two draws landing on the same integer is unremarkable, and a later reader must not read it as
stability.

**FOUR THINGS THIS RESULT ESTABLISHES THAT THE FIRST WRITE-UP DID NOT DRAW.** Each is free from
data already in hand; three were surfaced by review after I had recorded only the two kills.

1. **Every mechanism keyed to an offset MEASURED FROM THE START of the stream is dead.** If the
   loss sat at a fixed position counted forward — an index, a buffer mark, a byte budget — a
   40-char payload would lose its byte at a different *relative* place than a 22-char one. It
   does not. The loss tracks the payload's END. **"From the start" is load-bearing:** the
   SURVIVING hypothesis is itself a fixed offset (one byte, from the end), so the unqualified
   "every fixed-absolute-offset mechanism is dead" that an earlier draft of this line asserted
   contradicts the survivor named two rows below it. No hypothesis on this card had named this
   class, which is why nothing had eliminated it.
2. **TAIL-1-EXACTLY at two lengths is hard to reconcile with a partial transfer.** An inference
   to the best explanation, not a deduction — an earlier draft asserted it flatly, which
   over-claims. **The argument that does the work is about VARIANCE:** a partial transfer is
   scheduling-dependent, so it predicts a loss that VARIES with how the race falls. Observed:
   8 of 8 at exactly 1, across two payload lengths. An off-by-one at a boundary predicts that
   constant and owes nothing further. **Evidence against H5 in its short-write form
   specifically**, which the H5 section below does not yet credit.
3. **THE TERMINATOR SURVIVED, IN ALL 8 EVENTS.** `read -rs` returned, so the `\r` reached the
   line discipline; the byte immediately before it did not. Verified by construction, not
   inferred: the shim records a length only when `jq -Rnc` runs, and `common.sh` reaches `jq`
   (`:761`) only after `read` returns (`:753`) AND past the `[ -z "$_pw" ]` fail-closed branch
   (`:757`). A dropped data byte with an intact terminator is a narrow signature — the line being
   COMMITTED one byte early, not a transport losing bytes.
4. **All 8 events are invisible at the `read(2)` layer.** No error, no short-read retry, a
   complete line as far as bash is concerned. Whatever happens, happens below the interface the
   gate can see — so no hardening inside `common.sh` around `read` could ever detect it.

**WHICH 8 — because this card also carries a "7" and an "11", and they are three different
sets.** The 8 are the SHIM-RECORDED events (batch 1's 4 + batch 2's 4); claims 3 and 4 hold for
those and ONLY those, because the 3 earlier truncations predate the shim, so no `jq` length was
ever captured for them and the read-returned chain cannot be asserted there. **Total truncations
observed to date is 11** (3 pre-shim + 8 shim-recorded). See the correlation block below for
what that does to the 7-vs-0 arithmetic.

**A SURVIVOR I BRIEFLY PROMOTED, AND HAVE NOW RETIRED — H6, a chunk boundary in the harness's
own write.** The reasoning that raised it was sound: "one byte at the end regardless of length"
is NOT the same claim as "the mechanism ignores length", and a mechanism keyed to the LAST
CHUNK'S EDGE predicts identically to one keyed to the terminator IF node-pty splits the 41-byte
payload differently from the 23-byte one. **But that `if` is false, and it was checkable in two
minutes rather than by experiment.** `node-pty` does no chunking anywhere in the path:
`Terminal.write` → `this._write(data)` (`node_modules/node-pty/lib/terminal.js:88`) →
`this._socket.write(data)` (`unixTerminal.js:167-168`) on a `PipeSocket` over the pty master fd.
There is no size-dependent branch to split on, and 41 bytes into an empty master buffer is one
`write(2)`. With one write, "the last chunk's edge" and "the payload's end" are the SAME
POSITION — so H6 is a redescription of hypothesis 2, not a rival to it.

**And promoting it was the same error this section was written to correct**, committed in the
same breath: I flagged "the card was about to record a sole survivor it had not earned", then
earned a second survivor no better. The split-write experiment it came with is also withdrawn —
and it was confounded anyway: `p.write(SECRET)` then `p.write('\r')` a few ms later removes
hypothesis 2's own precondition (the terminator arriving in the same feed as the last data
byte), so both hypotheses would have predicted "vanishes" and the cell would have discriminated
nothing. Splitting in the MIDDLE, same tick, is what a chunk-boundary test would have needed —
noted only so the next reader does not re-derive the broken version.

## ⏵ THE CAUSAL READING OF THE TYPING CORRELATION IS UNSUPPORTED — and one arm is a PRODUCT BUG

**The correlation is SUGGESTIVE, not statistically real — `p ≈ 0.07` once the denominator counts
DETECTION rather than exposure (see the detection table below); "statistically real" was written
against `p ≈ 0.03` on an exposure count that included four polling typings which cannot see a
truncation at all. And my attribution of it was never supported either.** I wrote that it is
"evidence for H5 (harness artifact)". It is evidence for a **DISJUNCTION**, and at least one
member is gate-side. **THREE variables are perfectly collinear across all 11 events** — there is
no cell in the design where any two differ:

| | P1–P5 | P8/P9/P10 |
|---|---|---|
| write timing | polls for `-echo` | fixed 1200 ms, blind |
| prior `^C` | never | always, at 300 ms |
| **gate state when the write lands** | first `read`, never interrupted | **`read` RESUMED AFTER A SIGNAL**, INT handler ran, traps re-armed |

**The third is a real product bug** — a signal-interrupted `read` losing a byte on resume is
`common.sh`'s problem, not the harness's. Reading 7-vs-0 as "harness artifact" picks one member
of a disjunction and discards the one that would matter most.

**The proposed experiment would MASK it.** Switching P8/P9/P10 to wait-for-readiness changes
the write timing while LEAVING THE `^C` IN PLACE, so a null result is consistent with both "the
harness raced the tty" and "waiting long enough lets a gate-side resume race resolve itself" —
and I would have closed the card calling `common.sh` innocent. **TWO cells were proposed — and
they separate TWO of the three variables, not three. Only ONE of the two turned out to be
constructible.**
- ~~**`^C` + polling** — truncations persist ⇒ the signal path is implicated, not write
  timing.~~ **NOT CONSTRUCTIBLE**, discovered by trying to write it (2026-09-05). The card
  already knew the reason and had not connected it to the design: `typeWhenNoEcho` is not a
  readiness check, it polls for `-echo`, which the gate sets at `:749` BEFORE `read` at `:753`,
  so the flag is already true when the poll starts and the loop breaks on its first iteration.
  Scheduled before the `^C` it types AHEAD of the signal (a different cell); scheduled at
  1200 ms to match the other cell's delay it breaks immediately and reduces to P8 exactly.
  Either way it varies the DELAY, not the readiness — so it cannot hold timing fixed while
  removing the signal.

  **⚠ RETRACTED 2026-09-05T00:58 — THE CELL IS BUILDABLE, and I committed "NOT CONSTRUCTIBLE,
  discovered by trying to write it" as a verified finding.** What I actually established is that
  `typeWhenNoEcho` cannot do it. That is a limitation of ONE probe, not of the idea, and I
  generalized from the probe I had to the cell being impossible. **The readiness signal already
  exists and P8 already asserts it: the prelude is `trap 'echo PRIOR-INT' INT`, so `PRIOR-INT`
  appears in the pty stream ONLY AFTER the handler has run** — precisely the post-signal,
  `read`-resuming state the cell needs to detect.

  **⚠ AND THAT RETRACTION ITSELF OVER-CORRECTED — corrected again 2026-09-05T01:05.** `PRIOR-INT`
  is echoed by the handler **while the handler runs**: SIGINT arrives → `read` is interrupted →
  handler runs → `echo PRIOR-INT` → handler returns → **only then** does bash decide whether to
  restart the `read`. So the token marks the handler having **STARTED**, not `read` having
  RESUMED — it lands at the *beginning* of the very transitional window this card hypothesizes,
  so writing on it would hit the WORST moment, not a safe one. My own phrase "plus a settle
  margin" conceded this without noticing: a settle margin is a fixed delay again, so the cell
  becomes "anchor + fixed N ms" — varying the ANCHOR, not the readiness, which is not what the
  cell was for. `NOT CONSTRUCTIBLE` was too strong; "constructible in three lines" is too strong
  in the other direction, **and it was the tidier story, which is why it was the one to
  distrust.**

  **What the discovery IS good for: it is a better ZERO POINT for the sweep.** Anchoring to
  `PRIOR-INT` removes the jitter between "harness wrote `\x03`" and "bash actually handled it" —
  exactly the noise that would otherwise smear every delay point.
- **no `^C` + fixed 1200 ms** — truncations appear ⇒ blind writing alone suffices ⇒ harness.
  **BUILT as P13** (`c6f8252e`), 8 iterations per run so a null has power, and all 8 DETECT (it
  asserts every length). **Power is computed against the ALTERNATIVE, so the rate is the fixed
  arm's DETECTING rate — 2.5% (8/320), not the pooled 0.91% an earlier version used, and not the
  1.67% that superseded it.** P(0 events in 320 typings) ≈ **0.03%** — **but that is a POINT
  ESTIMATE off 8 events and must not be quoted bare.** The Poisson 95% CI on 8 events is
  [3.45, 15.76], so the rate CI is **[1.08%, 4.93%]** and P(0 in 320) ranges from **~3.2%** at
  the pessimistic end to ~10⁻⁷ at the optimistic one. The design still holds at 3.2%; "0.03%"
  alone is two orders of magnitude more confident than 8 events support. The same denominator
  correction that WEAKENED the correlation above STRENGTHENS this experiment; the two moves are
  independent and the pleasant one must not be allowed to carry the unpleasant one.

  **BUT THE ALTERNATIVE IS A CONTINUUM, NOT A BINARY, and a zero here does not license the
  conclusion it looks like it licenses:**

  | if blind writing… | P13's rate | P(0 in 320) |
  |---|---|---|
  | fully suffices | 2.5% | **0.03%** — decisive |
  | contributes PARTIALLY (say 0.5%) | 0.5% | **~20%** — a zero says nothing |
  | is not involved (interaction required) | ≈ 0 | a zero confirms |

  So a zero rules out *"blind writing reproduces the fixed-arm rate"* and **does NOT** rule out
  *"blind writing contributes a smaller amount"*. And `P(0 | H_A) = 0.03%` is **not** "99.97%
  sure of the interaction" — that slide from likelihood to posterior is the one sentence this
  block exists to forbid.

  Costs ~12 s per run.

  **INDEPENDENCE IS THE ASSUMPTION DOING THE MOST WORK, and the evidence is now MIXED.** Poisson
  P(0) assumes 8 back-to-back gate runs in one process, one test, ~12 s, one machine are
  independent draws; under perfect within-test clustering the same marginal gives P(0) ≈ 36% —
  three orders of magnitude from 0.03%. Measured over the two clean 40-run batches: **8 events in
  8 DISTINCT runs, zero doubletons** — which is **CONSISTENT with independence and carries almost
  no evidential weight**, because under independence that is the MODAL outcome: 8 events among
  80 runs land in 8 distinct runs with probability ∏(1−i/80) ≈ **0.70**. An earlier version of
  this line offered it as "supports independence", which is the claim on this card that most
  flattered my own position — Fisher NEEDS independence, and I was citing a ~70%-likely
  coincidence as evidence for it. **Against it: the live batch's
  run-010 is the first doubleton** — P8 AND P9 truncating in the same run, both TAIL-1, both
  `stdin: 39`. **But read it at the right scope:** that is TWO ADJACENT TESTS inside one run, i.e.
  RUN-level clustering, whereas P13's assumption is about 8 iterations WITHIN one test. Related
  and not identical — adjacency makes it genuinely suggestive, since a machine-state transient
  would hit neighbours — but a run-level doubleton is not direct evidence about within-test
  independence, and one doubleton in a small sample is weak on its own. It must be weighed before
  any P13 number is called decisive; it does not settle anything.

**TWO CORRECTIONS OWED TO P13's COMMENT, deferred to after the running batch. THE DEFERRAL IS
RIGHT AND MY FIRST REASON FOR IT WAS NOT.** I wrote that a mid-batch edit "would split the
artifact the batch measures" — false for COMMENT-ONLY changes, which have no runtime effect and
change nothing any run measures. That is the plausible-mechanical-claim-nobody-checked pattern
this card exists to catch, applied to my own reasoning. The defensible reason is OPERATIONAL:
editing a file vitest may re-read or re-transform mid-run risks a transform race for the run in
flight, and it makes "the batch ran tree-state X" untrue. Same decision, honest reason.

- **"byte-for-byte P8 except the ONE knob" is FALSE as written.** P8's prelude ends
  `…; echo RC=$?; stty -a </dev/tty | tr -s " " "\n" | grep -E "^-?echo$"` (`:556`); P13's ends
  `…; echo RC=$?` (`:665`). **The cell is still sound** — the extra command runs AFTER
  `maestro_sudo_ensure` has returned, so it cannot touch the byte under measurement — but the
  claim is exactly the verified-sounding-and-unchecked kind this card keeps catching. P13 also
  pins `COPIES[0]` where P8 loops both copies, so **P13 can say nothing about
  `agent-helper.sh`** and neither the comment nor this card recorded that scope limit.
- **P13 conflates a TRUNCATION with a TIMEOUT**, which this card un-conflated as a corrected
  error. A gate run SIGKILLed at 25 s records nothing, so `recordedLens()` returns 7 and the
  `toEqual` fails identically. **They ARE separable in the log and here is the rule for reading
  the batch now:** the note prints `jq -Rnc stdin: 40,40,40,40,40,40,40` (seven full-length
  entries = one gate run died) versus a list CONTAINING `39` (a real truncation). The batch
  runner surfaces both as a bare `P13` FAIL line, so read the note, never the test name.

The surviving cell is the one that can implicate the harness AFFIRMATIVELY rather than by
absence, which is the better half to keep — this card already has a surplus of nulls.

**But "prior `^C`" and "`read` resumed after a signal" are NOT separable by either cell, because
the `^C` is what CAUSES the resume** — they are one manipulation seen at two layers, and every
cell above either keeps both or removes both. An earlier version of this block said "neither
alone resolves it; the pair does". The pair resolves {write timing} vs {`^C` + resume}, which is
still the decision the card needs (harness vs product) — but it is two of three, and the block
must not sell it as three.

**The third cell exists, and it is one-directional:** deliver SIGINT from OUTSIDE the tty
(`kill -INT` at the gate's shell) with no `^C` byte typed. That gives the signal-resume without
the tty input; the converse is impossible under `ISIG`, which is why only one direction is
available. If truncations persist there, the signal path is implicated independently of anything
the tty did with the `^C` byte itself.

**`typeWhenNoEcho` MAY HAVE CONTAMINATED THE GROUPING, and nothing logs it.** On any
`execFileSync` throw it hits `catch`, sleeps 200 ms, `break`s, and **writes anyway** — degrading
to a *fixed 200 ms blind write*, i.e. a worse version of the thing it is being contrasted with.
It also only polls for `-echo`, which the gate sets at `:749` BEFORE `read` at `:753`, so even
the success path proves "echo is off", not "`read` is blocked and consuming". Log which path
each write took before trusting 7-vs-0.

**EVERY DENOMINATOR ON THIS CARD COUNTED EXPOSURE WHERE THE p-VALUE NEEDS DETECTION — and that
inverts the result. `p ≈ 0.07`, not `0.018`.** Corrected 2026-09-05 after review; verified by
reading each test's assertions, not by counting call sites. A typing is only in the denominator
if a 1-byte loss would MAKE ITS TEST FAIL. Most cannot:

| test | arm | detects a 1-byte loss? | why |
|---|---|---|---|
| P12e `:435` | polling | **YES** | asserts the recorded length directly |
| P3 `:683` | polling | **YES** | truncated `GOOD` ⇒ server refuses ⇒ no token ⇒ `expect(strict).toBeDefined()` fails. **The middle link is now READ, not inferred:** the fake server does `if (pw === GOOD)` — strict equality, so a short value cannot match. An earlier version of this row claimed the whole chain was "verified by reading the assertions" when the server's comparison had never been opened, and P3 is the highest-leverage row here. **A DIFFERENT ROUTE from the shim assertion** — anyone later "unifying" this table by grepping `recordedLens()` will drop P3 wrongly |
| P2 `:474` | polling | **YES** | `expect(seen[0].body, diagnose(…)).toContain(SECRET)` — it asserts the request body carries the WHOLE secret, and it even calls `diagnose()`. **Classified BLIND for one commit, and the error was the INSTRUMENT:** I read each test with a 10-line `sed` window, and P2's detecting assertion is its LAST, 14 lines in. The window showed the first two and cut the one that mattered |
| P1 `:453` | polling | no | a truncated WRONG password is still a wrong password; refusal is asserted and happens either way |
| P4 `:506` | polling | no | asserts echo restored after refusal |
| P5 `:513` | polling | no | asserts the prior INT trap survived |
| P8 ×2 copies | fixed | **YES** | the `:585` coverage line |
| P9 ×2 copies | fixed | **YES** | the `:611` coverage line |
| P10 ×2 copies | fixed | no | `PRIOR-INT` / `not.toContain(SECRET)` / `RC=1` all pass on a truncated value. **RE-READ AT FULL WIDTH (`614-657`) after the P2 discovery — exactly 3 assertions, no fourth hiding below.** The risk was live and specific: P10's classification had been carried forward from the truncated-window pass, and if it detected, the fixed arm would be 6/run and the p would move again. It does not |
| P11a-j, P12a-d, P12f | — | n/a | **They type NOTHING — now READ, not inferred:** `grep -c 'runAtTerminal\|runGate\|ptySpawn'` over `336-433` returns **0**, so not one of them drives a real gate. An earlier version asserted the table was "complete" while carrying these from partial reads — the third consecutive round of claiming a completeness warrant I had not earned |
| P6, P7 | — | n/a | **They type NOTHING.** `runGateCtrlC` writes only `\x03` and never the password, so they are in neither denominator. Checked because the boundary sweep surfaced P6's 3 assertions and an unclassified test with assertions is exactly the shape of the P2 error |

> **⏹ THE STATISTIC IS FROZEN AS OF 2026-09-05T00:56. It is post-hoc, non-decisive, and
> SUPERSEDED BY P13. Do not refine it further.** Five review rounds went to arithmetic while the
> mechanism sat untouched, and the decisive argument is not "diminishing returns" — it is that
> **a correlation p CANNOT answer this card's question, which I established myself and then spent
> five rounds ignoring.** Three variables are perfectly collinear across every event, so a p of
> any size says "these two trial sets differ" and can never say WHICH of write timing, the `^C`,
> or the signal-resume did it — and the middle one is the only one that would exonerate
> `common.sh`. The correlation was only ever a prior that P13 was worth running. P13 is running,
> and **its reading needs no correlation statistic at all.** Everything below is kept as the
> record of how the number was arrived at, not as a live question.

**THE TEST, CHOSEN BEFORE THE ARITHMETIC AND FIXED FROM HERE ON: Fisher exact, one-sided,
CONDITIONED ON THE 8 EVENTS OBSERVED.** Poisson `P(0)` answers a different question — "how
surprising is zero given a KNOWN pooled rate" — and by not conditioning on the 8 it runs ~3×
conservative here. Naming the test first is the discipline this card has been missing; see the
churn note below for why.

**DETECTING trials over the 80 logged runs: polling 3/run = 240 with ZERO events; fixed 4/run =
320 with 8.** Fixed detecting rate **2.5%**.

| test | p (one-sided) |
|---|---|
| **Fisher exact, conditioned on 8** | **0.011** ← the number |
| binomial, `(320/560)^8` | 0.011 (cross-check) |
| **paired within-run sign test** | **0.0039** ← the CLUSTERING-ROBUST check |
| Poisson `P(0)`, λ = 3.43 | 0.032 (the wrong test, kept to show the gap) |

**The sign test is the one that survives the independence problem, and it is free.** Treat each
run as its own stratum: 8 runs where the fixed arm truncated and the polling arm did not, ZERO
the other way ⇒ one-sided `(1/2)^8 = 0.0039`. Run-level clustering cannot inflate it (run-010's
two events count ONCE), and it assumes only exchangeability of DIRECTION within a run — exactly
the assumption that IS defensible here. It is a robustness check BESIDE Fisher, not a
replacement: agreement between a clustering-sensitive test and a clustering-robust one is worth
more than either alone.

**TWO CAVEATS THAT TRAVEL WITH IT WHEREVER IT IS QUOTED:** the correlation was found by LOOKING
AT THE DATA, never pre-registered, so it is a post-hoc p; and every value here is VOID if the
trials are not independent — see the independence note on P13.

**THE p HAS NOW BEEN FOUR DIFFERENT NUMBERS IN ONE SESSION — 0.018 → 0.070 → (0.038) → 0.011 —
and the churn is a finding about my method, not about the data.** Each value was recomputed
under correction pressure rather than derived once from a test chosen in advance: 0.018 counted
EXPOSURE not detection; 0.070 used the right denominators with the wrong TEST; 0.038 fixed the
test but kept a table with P2 misclassified; 0.011 is the first computed with the test named
first and the table read at full width. Nothing but the arithmetic is load-bearing here — the
mechanism question is untouched by any of it.

**The 6-vs-6 "DEAD HEAT" I committed earlier is wrong, and the 2-vs-4 that replaced it was also
wrong.** On detection it is **3 vs 4**, because P2 detects. The polling arm is still the
disadvantaged one, but only slightly — and the sentence "the omission made the card CONSERVATIVE,
so fixing it strengthens the correlation" remains FALSE on detection counting.

**8 IS A FLOOR ON THE EVENT COUNT — BUT THE RATE IS NOT A FLOOR, and an earlier version of this
line said it was.** P10 contributes 160 blind typings to the FIXED arm, so some truncations there
were never observable and the observed COUNT understates how many occurred. The RATE is
unaffected: it is 8 events ÷ 320 **detecting** trials, and P10's typings are excluded from
numerator AND denominator alike, so 2.5% is an unbiased estimate of the per-typing probability
(assuming blind and detecting trials share the underlying rate — reasonable, since P8/P9/P10 are
all `^C`-then-blind-write at identical offsets). "Every rate on this card is a lower bound"
contradicted the lesson written from this very finding, which correctly says COUNT.

The 3 pre-shim truncations are ALSO in the fixed arm — raw count **11-vs-0** — but they have no
countable denominator (different suite composition, per-run typing counts never recorded), so
they stay out of the statistic rather than folded in with a guessed exposure.

**P13 IS A THIRD ARM, and the next batch's numbers must not pool it into the fixed one.** It adds
8 typings/run at (no signal, blind write), ALL OF THEM DETECTING (it asserts all 8 lengths) — a
cell that exists precisely to be CONTRASTED with the fixed arm, so folding it into that arm's
denominator would dissolve the comparison. Three arms from the next batch on, in DETECTING terms:
**polling 3/run · fixed 4/run · blind-no-signal 8/run.**

**AND THE "OFF-BY-ONE vs TERMINATOR-EARLY" DICHOTOMY IS FALSE — I renamed the hypothesis.** Both
describe the same observable and the same mechanism class, with no differing prediction, so no
experiment separates them. Correcting "I refuted a hypothesis nobody proposed" by MINTING A
SECOND NAME for the one that is held reproduces that error in mirror image. There is **one**
surviving mechanism class — *the line is cut one byte short at its terminator* — whose CAUSE is
the open question, and the real alternatives are the three collinear variables above.

## ⏵ THE STRONGEST CORRELATION ON THIS CARD, and it was mislabelled for the whole session

**All 11 truncations are in the FIXED-DELAY typing path. Zero are in the wait-for-readiness
path.** Verified by reading the file, not inferred. (Was "all 7" until 2026-09-05: batch 2 added
4 more — `run-007` P8, `run-009` P9, `run-012` P8, `run-039` P8, every one `common.sh` — and the
count was not carried forward when the blocks above it were edited.)

| typing strategy | site | tests | truncations |
|---|---|---|---|
| `typeWhenNoEcho` — POLLS the tty until it reports `-echo`, then writes | `:225` (`runAtTerminal`), `:486` (`runGate`) | P1, P2, P3, P4, P5 | **0, ever** |
| `setTimeout(() => p.write(SECRET + '\r'), 1200)` — writes BLIND on a timer | `:561`, `:602`, `:624` | P8, P9, P10 | **all 11** |

**The card has carried this as "the P8/P9 concentration" since it was first noticed, which
framed it as *which test*. The real variable is *which typing strategy*** — and that has an
obvious mechanism where "P8 vs P9" never did. `typeWhenNoEcho` waits until `read -rs` has
actually configured the terminal; the 1200 ms path writes blind, betting the gate has resumed
after the `^C`. A write landing in the transitional window — while the INT handler runs its
`stty` calls, before `read` re-arms — can lose a byte at that boundary.

**This is evidence for H5 (a harness artifact), and it is the cheapest decisive test on the
card:** switch P8/P9/P10 to wait for readiness instead of a fixed delay. If the truncations
vanish, the byte is being lost because the HARNESS types into a tty that is not ready — and
`common.sh` is innocent. **NEXT EXPERIMENT, ahead of everything else**, because it answers
"is there a product bug at all" rather than characterising one that may not exist.

Recorded rather than acted on immediately only because the 40-char batch was already running;
that batch's result is still informative about the loss's SHAPE either way.

## ⏵ THE EXPERIMENT FIRED — 2026-09-04T23:37, N = 21, TWICE

**BATCH COMPLETE — 4 truncations in 40 runs, and all four read `jq -Rnc stdin: 21 byte(s)
for 22 expected`, TAIL loss 1 char. Zero `SHIM-ERROR` in any run**, so the instrument was
clean throughout and no run needs discarding.

```
run-008  P9 [agent-helper.sh]        TAIL loss: 1 · jq -Rnc stdin: 21 byte(s) for 22 expected
run-012  P8 [agent-helper.sh]        TAIL loss: 1 · jq -Rnc stdin: 21 byte(s) for 22 expected
run-027  P8 [shell-helpers/common.sh] TAIL loss: 1 · jq -Rnc stdin: 21 byte(s) for 22 expected
run-033  P9 [shell-helpers/common.sh] TAIL loss: 1 · jq -Rnc stdin: 21 byte(s) for 22 expected
```

**THE DISTRIBUTION IS SYMMETRIC** — one firing in each of the four (test × copy) cells.

**I FIRST WROTE THAT THIS "REFUTES the P8 concentration". It refutes something nobody
claimed.** The concentration was always a statement about the **3 presumed TIMEOUTS** (the
card says so verbatim), and timeouts are a DIFFERENT failure mode — this card's own headline
insists the two were wrongly pooled by earlier revisions. What the batch shows is only that
the TRUNCATIONS do not favour P8 (2/2), which nobody had asserted either way. **The P8
concentration is UNTOUCHED by this batch**, and cannot be touched by it, because:

**THE TIMEOUT MODE DID NOT REPRODUCE IN 40 INSTRUMENTED RUNS.** State it as an ABSENCE OF
REPRODUCTION, never as "0 tonight vs 3 historically" — **that is the rate claim this card
forbids itself, and I wrote it once already.** The first version led with the count and hedged
in a parenthetical, which a reader takes exactly backwards.

Every word of the no-control-arm disclaimer applies here, and applies HARDER: a timeout is a
TIMING failure by construction (the 25 s SIGKILL), so it is the failure mode most plausibly
sensitive to the shim's added forks and to machine load — the one class where the missing
control arm matters most is the one I quoted a bare count for. Whether the non-reproduction is
the shim, the load, or chance is UNKNOWN.

**What the batch can and cannot say about the P8 concentration.** It cannot compare P8 against
P9 within the timeout population, because that population is empty tonight. It does record
that the timeout phenomenon did not reproduce at all under instrumentation — a failed
replication of the whole mode, which is a weak update rather than nothing. An earlier version
said the concentration "cannot be touched by this batch"; that under-claimed.

**Copy-independence: I talked myself out of the card's own correct judgement and am reverting
to it.** It was recorded as *"nearly a tautology and… weak"*, which is right — the two copies
are VERIFIED BYTE-IDENTICAL, so the split can only ever rule out per-copy STATE (load order,
path, mtime). 2 firings per copy is weak corroboration of that, not a promotion to
"measurement".

**IS A PERFECT 1-PER-CELL SPLIT SUSPICIOUS? No — computed, not assumed.** Four events into
four cells under a uniform model gives P(exactly one per cell) = 4!/4⁴ = **0.09375, about 1 in
10.7**. Mildly unlikely, entirely unremarkable, and NOT grounds to suspect a harness artefact.
Worth computing rather than reading the symmetry as either reassuring or sinister.

**"Zero SHIM-ERROR, therefore the instrument was clean" is the WEAK form of the claim, and
finding K is why.** `fail 90` cannot write its own marker (`mktemp` fails for the same reasons
that break the append), so the marker's ABSENCE proves less than it appears to. The strong form
is available and was measured: **0 of 40 runs reported `NOT RECORDED`** — every run recorded a
real value, and a `fail 90` would necessarily have produced `NOT RECORDED` on that run. That
closes K's hole for this batch by positive evidence instead of by absence of a marker.

**n is 4 here, 7 across the card's history** — batch-A P9, `P8 [common.sh]` run 23,
`P8 [agent-helper.sh]` 22:41, plus tonight's four — **and every single one is TAIL-1.**

**FIRST, THE CONFOUND, because the conclusion is worthless without it.** The shim measures
`wc -c < "$t"` and feeds `"$REAL" "$@" < "$t"` — the SAME file — so *"the gate handed jq 21"*
and *"the shim's own `cat` lost a byte"* produce byte-identical observations. Two things
exclude the second, and both were already on this card, attached to other sections:

1. **The phenomenon PREDATES the shim.** Three truncations with the same TAIL-1 signature were
   observed on plain `jq` — batch-A P9, `P8 [common.sh]` run 23, `P8 [agent-helper.sh]` 22:41.
   An instrument cannot cause an effect recorded before it existed.
2. **PIPE_BUF atomicity** (hypothesis 3's own row): `printf '%s' "$_pw"` is a builtin writing 22
   bytes to a pipe, far under `PIPE_BUF`, so the write is atomic and a `cat` reading to EOF
   cannot silently short-read it.

So N=21 means **`_pw` ITSELF held 21 characters** — upstream of `jq` and upstream of the shim.

**WHAT THIS ESTABLISHES.** The gate handed `jq` a line that was ALREADY short. "The loss is
at or before `read`" stops being an argument from the pipeline's composition and becomes a
MEASUREMENT. **Hypothesis 3 (the shell→curl leg) is now excluded by measurement, not by
reasoning** — the same conclusion the composition argument reached, but this card has
retracted four mechanisms that were reasoned rather than measured, so the distinction is the
point. Both 21, both TAIL, so it is not a one-off reading — but **"two INDEPENDENT runs" was
claimed and is withdrawn**: same batch, same machine state, same script copy, four runs apart,
so a transient common cause (scheduler, memory pressure, a background job) is not excluded.
That is a REPEAT, not a replication. It costs nothing — ONE firing pins the boundary just as
well, and independence would only matter for a rate claim, which is disclaimed below.

**A TAIL LOSS EXCLUDES H1 OUTRIGHT, and the "circularity" objection is WRONG — worked from
the mechanism, not taken from a reviewer.** `TCSAFLUSH` discards the input received but not
yet read, i.e. the WHOLE pending queue, never a suffix of it. In canonical mode with `read`
blocked, a flush landing after character *k* discards 1..*k*; characters *k*+1..22 and the
`\r` survive, so what `read` returns is a **SUFFIX** of the password — a LEADING loss. A flush
landing after the `\r` is queued discards everything, giving an empty `_pw` and the
fail-closed branch. **Neither is a one-character tail.** Load changes *k*, so it changes the
SIZE of a leading loss; it does not change which END the loss is at. H1's entire prediction
family is leading/total losses at every load, so a TAIL observation is inconsistent with it.

**SCOPE THIS CLAIM to the gate's own sequence — it is not a universal about `TCSAFLUSH`.**
What is established is that *the gate's `stty` calls, in CANONICAL mode, against a single-line
`read`,* cannot produce a one-character tail. Three edge cases were checked and none rescues
H1 here: a split `\r` delivery gives LEADING-21, not TAIL-1; `ICANON` off with `VMIN`/`VTIME`
could short-read, but the gate never leaves canonical mode (`stty -echo` alters ECHO only, and
bash's `read -rs` does not set `-icanon`); and a partially-consumed line cannot be flushed,
since bash issues one `read(2)` per line in canonical mode. An UNQUALIFIED "a flush can never
produce a tail loss" is the kind of sentence a future reader carries to a different code path
where it is false.

**Round three's FINDING N is therefore WRONG in its conclusion, and I adopted it verbatim
one commit ago** — it conflated *load-dependence of the loss SIZE* with *load-dependence of
the loss END*. The load caveat below is struck to that extent. Recorded rather than quietly
reverted, because "the reviewer said so" is how a correct claim got weakened in the first
place, and a fourth reviewer saying the opposite is not better evidence than the mechanism.

**So H2 survives on EVIDENCE, not by elimination**, and the position reading does discriminate.

**WHAT IS STILL NOT ESTABLISHED:** why a canonical-mode line delivers its terminator one byte
early. That is the whole remaining question.

**HYPOTHESIS 2 IS THE ONLY SURVIVOR, and it is now the thing to instrument.** The next
question is why a canonical-mode line delivers its terminator one byte early.

**RATE IS STILL NOT CLAIMABLE:** 2 in 13 here vs 1 in 24 before is exactly the comparison
the missing control arm forbids (see the load caveat). Do not quote it as a rate change.

**Both firings were on `agent-helper.sh`.** Across the card's whole history both copies have
now shown it, so it remains copy-independent; the split within one batch is noise at n=2.

**WHAT IS MEASURED — this is the headline, and every mechanism story on this card has died.**

- **Two distinct failure modes.** Truncations: **3 observed** — the batch-A P9, `P8
  [common.sh]` in run 23, and `P8 [agent-helper.sh]` on an incidental run at 22:41. Timeouts:
  3 observed. Earlier revisions pooled the two modes.
- **The truncation position is TAIL, 1 char, three for three**, measured by a validated
  classifier on the last two. **Both COPIES exhibit it** — but that rests on BATCH 1 ALONE, and
  batch 2 did not reconfirm it: batch 2 was 4/4 `common.sh`, zero `agent-helper.sh` (p = 6.25%
  under batch 1's uniform model, so not a finding either way — just not a second confirmation)
  (`common.sh` and `agent-helper.sh`),
  so it is not copy-specific — the two files are verified-identical, so this is a consistency
  check that passed rather than a surprise.
- **The CURRENT wiring is now validated end-to-end.** `diagnoseBody` (not just `fc3b6f76`'s
  `diagnoseTyped`+`pwOf`) produced the 22:41 diagnosis on a real loss, closing the gap this
  block flagged an hour ago.
- **Rate:** 1 truncation in 24 consecutive runs, single-arm, P0 absent, idle machine. Read
  §Step 2 before quoting it — it is per-RUN, the denominator moved this session, and box 1's
  tick was taken and withdrawn.
- **The loss is at or before `read`** — the gate builds its body with `jq -Rnc` from the
  variable, so a well-formed body with a short value cannot come from a downstream cut.

**HYPOTHESES AND THEIR STATUS.** None is tested. Four have been proposed this card; the full
account of each retraction is in the commit trail (`ab90429f`, `d67db73b`, `38f995c1`,
`ca1df277`) and is deliberately NOT re-narrated here — this block is the state, not the diary.

| # | claim | status |
|---|---|---|
| 1 | a `stty` TCSAFLUSH eats queued input | **CONTRADICTED by the code path as read** (idle-machine timing; UNMEASURED under load). The gate's only `stty` calls are at t≈0, at the ^C (t≈300 ms) and after `read` returns; the password is typed at t≈1200 ms, and at 300 ms the queue is empty (the ^C arrives as a SIGNAL under `ISIG`, not as data). A flush there flushes nothing. **Not "REFUTED"** — every step is a source READ, not an instrumented handler, and the one condition batch A ran under (load) is the one not checked. Using the strongest verb for the one refutation nobody instrumented is the wrong asymmetry on a card with four dead mechanisms |
| 2 | the line terminated one byte early | **OPEN.** Favoured, but NOT the sole survivor — see H5, which seven review rounds failed to list. (H6, a chunk boundary in the harness's write, sat here for one commit and is **RETIRED**: node-pty does no chunking, so with a single `write(2)` it names the same position as this row — a redescription, not a rival. Evidence in the STATE block) |
| 5 | **the HARNESS's own write loses the byte** — `p.write(password + '\r')`, node-pty pushing 23 bytes into the pty master | **OPEN, NEVER PREVIOUSLY LISTED, and it is the one that decides whether there is a product bug at all.** The card's localisation is *"at or before `read`"*, and the harness write IS before `read` — so every one of the seven events is equally consistent with the byte being lost on the WRITE side. If it is, `common.sh` is innocent and these tests are flaky for a reason unrelated to the gate. **Discriminator:** split `p.write(password + '\r')` into two writes with a gap, or write char-by-char; if the loss changes shape or vanishes, it is the write path. NB the card already calls a NEIGHBOURING claim a non-sequitur (*"one `p.write`, so the line discipline holds the line"*) — correctly, because that was about the RECEIVER. The WRITER-side question is different and was never asked |
| 3 | the loss is in the shell→curl leg | **EXCLUDED BY MEASUREMENT 2026-09-04T23:37** (`jq -Rnc stdin: 21` on two runs), superseding the composition argument that had excluded it by reasoning. The argument was right; it is the class of thing this card has been wrong about four times, so the measurement is what the exclusion now rests on |
| 4 | a wall-clock timing slip (§Proposed fix step 2) | **OPEN for the TIMEOUTS, with two objections.** It came from the card rather than from me and that does NOT pre-validate it — §Proposed fix is a *proposal*, never a finding |

**The two objections to #4, because it is the one currently doing work.** (i) A canonical-mode
tty BUFFERS characters typed while nobody is reading and delivers them on resume, so a merely
late resume predicts a PASS — or an echo failure if the password lands while echo is back
ON — **not a timeout**. (ii) **P10 has never failed** in ~59 runs, and it shares P8's exact
offsets while doing MORE work in the resume window (`trap 'echo PRIOR-INT; return'`); if a
work-in-the-window slip were the mechanism, P10 should fail at least as often as P8.
**Weak evidence, and an earlier version of this line called it a CONTRADICTION, which
over-claims twice over:** 0 failures in ~59 runs is unremarkable at a ~4% rate (P(0) ≈ 9%),
and the argument PRESUPPOSES the per-test uniformity it purports to test — if the mechanism is
caller-shape-specific, per-test rates differ by construction, which is exactly what the P8
concentration claims. A circular control is not a control.

**A trap worth restoring from the compressed narrative, because a future session can
re-derive and re-believe it:** *"the harness writes the secret and its terminator in ONE
`p.write`, so the line discipline holds the line until the terminator"* is a NON-SEQUITUR. How
many `write(2)` calls the WRITER makes says nothing about the RECEIVER — the kernel feeds the
canonical buffer character by character, and a `tcsetattr` from another process can land
between any two. It was the first (wrong) argument used to refute hypothesis 1.

**A ONE-BIT DISCRIMINATOR NOW ESCAPES EVERY TIMEOUT — but read the label carefully, because
the first version of this paragraph had it BACKWARDS and promised a measurement that could
not fire.** Both halves were wrong:

- **Wrong direction.** I wrote that a timing slip predicts `seen[] === []`. It predicts the
  OPPOSITE: canonical mode BUFFERS input typed while nobody is reading and delivers it on
  resume, so a late resume yields a POPULATED `seen[]` and a late-but-completing run.
  **`requests=0` means the terminator never reached `read` at all** — the signature of input
  being DISCARDED, not of a slow resume. Same fact I had used one commit earlier to build the
  objection to hypothesis 4, applied backwards here.
- **Wrong about it being free.** `diagnoseBody`'s message rides the `seen[0]?.body` assertion,
  which in P8/P9/P10 comes AFTER `expect(out).toMatch(/RC=1/)` — and a 25 s SIGKILL means
  `echo RC=$?` never runs, so THAT assertion fails first and the diagnosis is never reached.
  **An assertion-masking error, made while reasoning about assertion masking**, in the same
  session that split P11 to fix exactly this and wrote the lesson into
  `lessons-verification.md`.

**Fixed in code, then fixed AGAIN when the first fix turned out to mask the same way.**
`timeoutContext(out, seen.length)` is the message on the `RC=1` assertion, and that assertion
is now **FIRST** in P8/P9/P10. Placing it third (its original position) left
`expect(out).toMatch(/PRIOR-INT/)` ahead of it in P8 and P10 — and if a timeout's cause is the
handler failing to complete, `PRIOR-INT` is absent, so that assertion fails first and the
context never prints. **The masking had moved one assertion earlier, not gone.** Asserting
"the run completed" before anything about what it contains is the general form of the fix.

A `secret echoed:` boolean was tried and REMOVED: `expect(out).not.toContain(SECRET)` ran
before it at every call site, so an echoed secret failed there and the boolean could only ever
print `false` — a field with one reachable value, sold in a commit message as a deliberate
security-conscious design. The tail is still deliberately omitted (a real gate's failure would
put a live password in a log).

**`requests=0` spans TWO causes, and the message alone cannot separate them:** `read` never
returned (the timeout case), or `read` returned EMPTY — the gate's `[ -z "$_pw" ]` fail-closed
branch returns before `jq`/`curl`, printing `Error: empty password` and `RC=1`, which is not a
timeout at all. A flush that discarded the queued characters and then let the `\r` through
produces exactly the second. Check `out` for the fail-closed error before reading `requests=0`
as a stranded read.

**`timeoutContext` is pinned by P11h/i/j, split per branch and each NEUTERED.** Three run:
freeze `requests=${seenCount}` → P11h; re-add the raw `out` tail → **P11j**, the secret-leak
regression; drop the size clause → P11h+P11i. Restores verified byte-identical.

**THE ASSERTION-PLACEMENT QUESTION TOOK THREE ATTEMPTS, and the first two were each half
right.** Recorded in full because both wrong versions were shipped and described as the fix:

1. **`RC=1` moved to the front** — the context printed, and it DEMOTED
   `expect(out).not.toContain(SECRET)` behind a liveness check in P8/P10. Wrong trade: the
   echo guarantee is what P6/P8/P9/P10 exist for.
2. **Order reverted, message on whichever assertion is already first** — priority protected,
   **and the diagnosis lost again**, which the card wrongly called "same diagnosis, no cost".
   A message surfaces only when ITS OWN assertion fails, and on a timeout whose handler
   COMPLETED, `PRIOR-INT` is present, so P8/P10's first assertion PASSES and the failure lands
   bare on `RC=1`. In P9 the message rode `not.toContain(SECRET)`, which passes on every
   timeout — so the context printed in **zero** P9 cases. Worse than attempt 1, which at least
   covered the larger subset.
3. **Attached to BOTH landing spots, order untouched** — current. Handler-failed timeouts fail
   on the first assertion, handler-completed ones on `RC=1`, and neither costs a demotion.

**OPEN INSTRUMENT DEFECTS — recorded, NOT fixed, per the stop note below. Do not "just fix"
these; they are the loop's output, and fixing them is what the note forbids.**

1. **An `afterEach` is the right design and is not what is shipped.** Reading the failed task's
   state would carry the context out of *whichever* assertion failed — one hook instead of six
   attachments, strictly smaller than the current code.
2. **The context now prints on NON-timeout failures too.** `timeoutContext` rides
   `toMatch(/PRIOR-INT/)`, so a genuine handoff regression — the real bug P5/P8 pin — fails
   carrying `requests=1 · out 847b`, which is irrelevant to it and is the first thing the
   reader sees. The same trade as the reorder in a quieter form: instrument convenience paid
   for out of the assertion that carries the meaning.
3. **P11g BUNDLES dispatch and delegation, so the split is incomplete there.** It asserts the
   no-request/unparseable DISPATCH *and* `/^TAIL loss/` on a short-value body, which is why
   neuter A (a `diagnoseTyped` mutation) reaches it — a mutation reddening three tests means
   those three share a branch. Split the delegation assertion out, or accept that P11g is two
   tests. **An earlier version of this entry said P11g "is not testing what its name says",
   taken from a review rather than checked: the name ends "— the truncation case", which does
   cover the TAIL assertion.** The defect is bundling, not mislabelling. The three-test
   attribution was measured correctly and then read as reassurance rather than as this.

**"Both copies exhibit it" is nearly a tautology and is recorded as weak.** The two files are
verified-identical, so the only thing the copy split can rule out is per-copy state — load
order, path, mtime. Worth one clause, not a finding.

**One firing validates ONE branch.** The 22:41 failure exercised `diagnoseBody`'s TAIL path
end-to-end. Its "unparseable body" and "no request" branches remain validated by P11g alone,
i.e. by construction, not on real data.

**WHAT MUST BE KEPT NEXT TIME A TIMEOUT FIRES: the full run log.** No log from batches A or C
survives, so nobody can now check what those three timeouts looked like — `out`, RC, or
whether the server saw a request. "It timed out" is a symptom, and the harness captures enough
to separate several causes behind it.

**On the P8 concentration** (all 3 presumed timeouts are P8): treat it as weak. It is 3 events,
2 of them in one batch, on one of ~7 tests that could time out; the work difference between
P8's `eval 'echo PRIOR-INT'` and P9's `eval ''` is MICROSECONDS inside a 900 ms budget, which
is not a mechanism; and P10 contradicts it (above). The partition itself rests on ONE inherited
sentence — §"The clue"'s *"One P9 failure was not a timeout"* — never verified against a log,
which is the same shape as two claims this card has already retracted. Say "the 3 PRESUMED
timeouts", not "the timeouts".

**Verified because it was queried:** the handler DOES run in P9. `maestro_sudo_ensure` installs
`trap '_maestro_sudo_on_int' INT` BEFORE the `read`, replacing the caller's disposition; the
caller's `''` is only saved in `_MAESTRO_PREV_INT` and restored inside the handler. So P8 and
P9 run the same handler, differing only in the body it `eval`s.

**THE INSTRUMENT.** `diagnoseTyped`, `pwOf`, `diagnoseBody` in the pty test (`fc3b6f76`,
`1a2a1b2c`), used as the failure message on every assertion pinning the password's arrival.
Pinned by **P11a-j, one `it()` per branch; 11 neuters, all 10 tests redden.** Provenance,
because "all 11 hold against the current file" was asserted once and is only two-thirds
measured: **A and B were RE-RUN** after the split (A reds P11b+P11c+P11g, B reds P11d) — their
earlier attributions had been carried across a refactor that moved the test boundaries they
depend on. **C-H were run against the P11a-g arrangement and are NOT re-run**; they hold because neither
the function each mutates nor the test each reddens has changed since. **That premise was labelled
"an argument, not a measurement", then CHECKED — twice, because the first check was the wrong
instrument.** `git log -S` was used first and is INSUFFICIENT here: it detects a change in the
COUNT of a string, so an edit that rewrites a line while preserving occurrences is invisible to
it — the same class of hole this card has been finding all session, in the very step claiming
to close one. What establishes the
claim is a **CONTENT diff of the P11 block between the two END TREES** — `1a2a1b2c` (the commit
that created P11a-g, and the tree these neuters ran against) and HEAD: **additions only**,
P11h/i/j inserted, with **no line of P11a-g removed or modified**. A diff of the actual blobs at
two commits cannot miss anything, whatever happened in between, which is why it is the check
cited. The classifier functions are likewise untouched. Premise holds.

A commit ENUMERATION (`git log -- <path>`) was also run and agrees, but it is CORROBORATING, not
decisive: an earlier version of this paragraph said it "cannot miss an edit, because it lists
every commit that touched the file at all", and that is too strong — `git log -- <path>` applies
history simplification by default and prunes merges, so an edit made INSIDE a conflict
resolution never appears — `--full-history -m` is what lists everything. Fine here
(`1a2a1b2c..HEAD` is a linear string of this session's own commits, no merges), wrong as a
general claim, and a future session would have copied it onto a repo that has them.

**Both corrections in this paragraph are the same shape: the right answer, credited to a method
that does not carry the guarantee claimed for it** — first `-S`, then the enumeration. Worth
noticing as a pattern rather than twice as an incident.

**Use `-G`, never `-S`, to ask "did anything touch these lines".** `-S` is a pickaxe on
occurrence COUNT; `-G` matches any hunk touching the pattern. Worth writing down because the
card briefly cited `-S` as proof of unchangedness, which it cannot give.

What they pin, in three categories — the two-way split published earlier over-claimed, then
the correction under-claimed:

- **branch EXISTENCE** (delete the branch): C, D, F, H
- **branch DISCRIMINATION** (both predicates compute and select distinctly): A
- **computation**: B (the index), I (request count), K (size) · **message text only**: E, G
- **security**: J — re-adding the raw `out` tail reddens P11j, the only assertion here whose
  failure has a consequence beyond a worse message

**THE `jq` SHIM IS BUILT (`e3787efb`), and the stop note is discharged for exactly that
item — nothing else.** A PATH shim over `jq`, installed only for these tests, records the
BYTE LENGTH (never the content) of what the gate hands `jq -Rnc` at `common.sh:761` /
`agent-helper.sh:279`. Argv-filtered on `-Rnc`; every other call `exec`s through BEFORE
stdin is touched (common.sh calls `jq` ~20 times, one on the RESPONSE at `:770`, several
with a filter and a file and no stdin at all). Zero shipped code changed.

**P12f WAS ADDED BY THE REVIEW, and it is the one that pins the number the experiment turns
on.** A shim that ignored stdin and appended a hard-coded `22` passes P12a (the secret is 22
bytes) AND P12e (which counts lines, not values) — so before P12f, *nothing* asserted the
recorded length was a function of the gate's stdin at all. MEASURED, not argued: that exact
mutation reddens P12f alone, 5 of 6 still green. Two different input lengths make a constant
impossible.

**P12e COVERED ONLY ONE OF THREE SPAWN SHAPES, and not the one that matters.** It drives
`runAtTerminal`; `runGate` and the P8/P9/P10 inline `ptySpawn`s are separate shapes, and
**all three observed truncations happened in P8/P9** — so "the shim is on that PATH too" was
asserted by nobody. P8 and P9 now carry the coverage assertion, deliberately LAST: on a
truncating run the body assertion fails first and `diagnose` already reports the number, so
the new line runs only on an otherwise-green run, which is exactly the uncovered case.
MEASURED — a single-but-WRONG recorded value (`sed 's/^/9/'`) reddens **7**: P12a, P12e,
P12f, and all four P8/P9 variants.

**That same neuter settles what the second review challenged about P12e's `toEqual` form.**
It produces `['922']`, an array of length ONE — so `toHaveLength(1)` would PASS and
`toEqual(['22'])` FAILS. The value form is therefore load-bearing on all three gate paths,
by arithmetic on the neuter's own output rather than by argument. **What it does NOT do is
isolate P12e from P12a** — both call the shim with identical argv and stdin, so no shim
mutation can redden one without the other. P12e's unique contribution is PATH coverage, not
value coverage, and saying otherwise would over-claim.

**Pinned by P12a-f, one `it()` per branch, five neuters run and ATTRIBUTED:** guard never
matches (`-RnZ`) → P12a+P12e · guard matches everything (`-n "$a"`) → P12d+P12e · `wc -c`
→ `wc -l` → P12a · forward replaced by `echo '{}'` → P12b. The last two ran TOGETHER; they
are independent by construction (one writes the record file, one writes stdout, and each
test reads only one of those) and the prediction was stated before the run. Restored,
verified by diff. 29 pass, tsc 0 lines.

**P12e is the only one of the five that is not vacuous alone, and that is why it exists.**
P12a-d drive the shim DIRECTLY, so all four pass with the shim absent from the child's
PATH entirely — in which case `jqStdinNote` prints "NOT RECORDED" forever, which reads
exactly like a run that lost nothing. P12e drives the REAL gate at a real pty and asserts
the shim was in that path. Measured: it is.

**WHAT THE SHIM BUYS, stated narrowly.** "The loss is at or before `read`" was an ARGUMENT
from the pipeline's composition, and it is now MEASURABLE: a short length at `jq -Rnc`
confirms it, a full length REFUTES it. The measurement has NOT been taken — no truncation
has fired since the shim landed.

**THE TIMING CAVEAT, CORRECTED — the first version named the wrong mechanism and was
wrong in the direction that would have discarded a real finding.** It said the shim
"perturbs the timing of the very window the surviving hypotheses live in", so a post-shim
rate was not comparable in either direction. **The shim runs at `common.sh:761`, which is
AFTER `read` returns at `:753`.** Both surviving hypotheses (1, a flush at the prompt; 2,
the line terminating a byte early) resolve at or before `read`, i.e. strictly UPSTREAM of
every line the shim adds. So the shim cannot perturb the truncation window at all, and the
rate SHOULD be unchanged.

**"Cannot perturb at all" was itself too strong, and the second review caught it one
revision later.** It is true WITHIN one gate invocation and false ACROSS runs, which is the
scale the batch actually operates at: one vitest process runs P1, P2, P3, P8×2, P9×2 and
P12a-f in sequence, so the shim's extra forks consume wall-clock and change machine state
BEFORE the next test's `ptySpawn` and its `stty`-vs-type race — and the batch is 40 such
processes back to back. Batch A's truncation is recorded as having happened UNDER LOAD,
which is the one condition this card has never checked.

**So a rate change is AMBIGUOUS, and cannot be read as either answer.** Two revisions of
this paragraph have now over-claimed in opposite directions — first "discount any rate
change", then "a rate change is a finding" — and both were reaching for a conclusion the
design cannot support, because **there is no control arm.** Installing the shim at all six
spawn sites DELETED the shim-off condition; comparing a shim-on batch against a remembered
"1 in 24" from another session, another machine state and a different test count (24 then,
30 now) is not a comparison.

**If the RATE is ever to be claimed, it needs an env-gated shim** (`AIM_JQ_SHIM=0` → plain
PATH) with the two arms INTERLEAVED — the same discipline this card already invokes for
two-arm comparisons. Nothing below depends on that: the POSITION reading (N=21 vs 22 when
a truncation fires) is unaffected by load, and position is what the shim was built for.

Found by the adversarial reviews of `e3787efb` and `8e169da2`. The original caveat was
written to be conservative and was conservative about the wrong axis; the correction then
over-corrected. What survives both is narrow and worth keeping: **the shim is downstream of
`read` within a gate call, so it cannot explain a truncation — and it is upstream of
nothing that would let a rate comparison stand without a control arm.**

**AND "POSITION IS UNAFFECTED BY LOAD" IS CIRCULAR — third review, FINDING N, the most
substantive of that round.** I wrote that rate needs a control arm but position does not.
That holds only under H2, where the tail is fixed by construction. Under **H1** the loss
position depends on how many characters sit in the canonical buffer when the flush lands,
which is a function of the writer's rate against the flush's timing — so a loaded machine
buffers fewer characters and the loss moves toward the START. **The claim therefore assumes
H2, which is exactly what the position reading is supposed to test** — the same circularity
this card already flags in the P10 objection, committed again one paragraph away from it.

**STRUCK 2026-09-04T23:44 — the correction above was itself wrong.** Load changes the SIZE of
a leading loss, not the END it falls at; a flush cannot produce a one-character tail at any
load. The mechanism is worked in the result block at the top of this STATE. What survives of
FINDING N is nothing: position DOES discriminate H1 from H2, and the claim it attacked was
right as originally written. Left in place rather than deleted so the next reader sees that
this card weakened a correct claim on a reviewer's word and then restored it on the mechanism.

**And "batch A's truncation happened UNDER LOAD" is INHERITED AND UNVERIFIED.** It appears on
this card as an assertion with no measurement behind it, and I repeated it as evidence for H2.
Same shape as *"One P9 failure was not a timeout"*, which this card already flags as never
checked against a log. **TAIL for batch A IS established** — directly from the recorded strings
(`…x7q` vs `…x7q2`), no classifier needed. The load half is not.

**The `jqStdinNote` message rides `expect(actual, message)` and is TOTAL** — vitest
evaluates it EAGERLY on every run, so a missing record file returns a sentence, never a
throw. Same trap this card hit with `diagnoseBody`, now recorded in
`lessons-verification.md`. `diagnoseBody` itself is UNTOUCHED and keeps its ten pinning
tests; the three message call sites use `diagnose()`, which composes the two.

**STOP INSTRUMENTING THE DIAGNOSTIC. The three defects below stay unfixed.** Seven
revisions of the instrument against ONE 24-run experiment; the diagnostic ceiling is reached
(position is TAIL three-for-three, and no further message refinement separates hypothesis 2
from the shell-side remnant).

**`implementation-commits` IS COMPLETE — six entries, and code commits have stopped.** An
earlier note called the field "one behind by construction, a commit's SHA cannot be written
into itself"; the first half is true and the second made it sound permanent. The lag is one
commit *while code commits continue* and it CLOSES when they stop, which a following card-only
commit does — and has. **`431e13b6` also touched the test file and is deliberately excluded:**
the IND rule says the field accumulates the SHAs that landed this TRDD's **code**, and a
comment lands none. (A review reported six-for-six and missed `431e13b6` entirely; the
exclusion is a decision, not an oversight, which is why it is written down. And "a comment
cannot introduce a bug" would be too strong as a general reason — the comment `431e13b6` added
is the eager-evaluation warning that stops a future edit making `timeoutContext` throw, so
deleting it could contribute to one. The rule's own word "code" is the firmer ground, which is
why the justification now rests there rather than on purpose.)

**THE CLOSING CONDITION, on its second attempt, because the first was unfalsifiable.** From
here, **instrument findings are RECORDED on this card, not fixed**, until the shim exists.
A false claim on the card is corrected **by editing the card to say what is actually true —
including "this is broken and is not being fixed"** — never by changing code.

The first version carved out "a false claim of RECORD gets corrected", and the commit carrying
it then changed six call sites. That exception swallows the rule: **every instrument defect
this loop has surfaced was also, at the moment of discovery, a false claim somewhere** — the
card said the instrument worked, the neuters covered, the context printed. An exception for
false claims exempts the entire output of the review gate, which is what makes a stop note
aspirational. The honest move that pass was to write "the diagnosis is lost in most timeout
cases" and leave it lost.

"Stop" cannot mean "stop when the findings stop": the gate fires on every commit, findings are
always available, and each fix is itself reviewable. **The loop cannot self-terminate; the exit
is to stop committing code here.**

**THE STOPPING RULE, ADOPTED 2026-09-04 — per-FINDING, not per-round.** Three review rounds
each produced code commits while each round's findings were individually defensible as small,
which is what a self-sustaining loop looks like from the inside. The rule that ends it:

> **Fix a finding only if leaving it unfixed would change the NUMBER the experiment reports,
> or make a reader mis-read that number. Everything else is RECORDED and not fixed.**

It is falsifiable without waiting for findings to cease, because each finding is tested
against a fixed question instead of against judgement. Applied to round three: findings K
(marker unreachable for 90), M (a harness failure reads as a security failure), N (the
position/load circularity) and O (`['922']`'s length inferred, not read back) all change how
a reader INTERPRETS the number, never the number — so all four are recorded above and **zero
code changed**. That is the loop terminating under its own rule.

**Two things the rule is NOT, stated so nobody assumes more of it than it gives.** It protects
the EXPERIMENT'S integrity, not general clarity — so it deliberately permits finding M (a shim
failure reddening four security-named tests is genuinely misleading, and stays). And this is
**precommitment, not the absence of judgement**: I chose to adopt the rule, chose the
classifications, and commissioned the review that proposed it. Better than a per-finding call
because the question is fixed in advance; not the same as the loop terminating by itself.

**THE NEXT MEASUREMENTS, cheapest first — and the FIRST one needs no new code at all.**
The backstop is DISCHARGED (40/40 completed), so instrument edits are permitted again.

1. **DONE 2026-09-04T23:53 — and it CORRECTS the claim that sent me to do it.** I wrote that
   re-reading the logs "already favours terminator-timing over a buffer truncation". **It does
   not, and I should not have said so before looking.**

   All four received strings are **BYTE-IDENTICAL**: `wrong-pw-9MZQ4T7E-x7q`, i.e. exactly the
   expected string's 21-byte prefix, 4/4.

   **What it establishes is a POSITIVE CONTROL ON THE CLASSIFIER, not new mechanism data — my
   "more than the classifier's per-run verdict" was false.** Work `diagnoseTyped` backwards:
   `TAIL loss: 1` is emitted only when `received.length === 21` AND `expected.startsWith(received)`,
   and a 21-char prefix of a FIXED 22-char string is uniquely `expected.slice(0,21)`. So the four
   verdicts already ENTAILED four byte-identical strings. Reading the raw bodies confirms the
   classifier was not lying — worth having, and a different thing from what I claimed.

   **And "always the same single final character" is half tautology:** the final character is
   `2` every run because the password is a CONSTANT. The non-trivial half is that the position
   and magnitude were identical across four firings (tail, exactly 1) when they could have
   varied. The trivial half was carrying the emphasis.

   **What it does NOT establish:** terminator-timing over a buffer effect — a 21-byte cap and a
   one-early terminator both produce a 21-byte prefix.

   **BUT THE RETRACTION WENT TOO FAR, and this is the THIRD time tonight.** The prefix property
   does not discriminate; a PRIOR does, and I discarded it along with the claim. **A 21-byte cap
   has no candidate implementation anywhere in this pipeline:** `MAX_CANON` is 1024 (4096 on some
   systems), `PIPE_BUF` ≥ 512, bash's `read -rs` has no small fixed cap, `jq -Rnc` none. **21 is
   not a power of two and not a documented constant of any layer here.** Terminator-timing has an
   obvious candidate mechanism; a 21-byte cap has none.

   **AND THAT CORRECTION REFUTED A HYPOTHESIS NOBODY PROPOSED — the same error, in the sentence
   fixing the previous one, ONE COMMIT after naming the pattern.** A "21-byte CAP" is an
   ABSOLUTE bound; the observation is a RELATIVE loss of exactly one byte from a 22-byte input.
   Different shapes. Nothing in this card's history ever proposed an absolute cap — the live
   alternative to terminator-timing was always an **off-by-one at a delivery boundary**. So
   "no layer has a 21-byte bound" is true, and it defeats nothing anyone held.

   Correct statement: *the prefix alone does not discriminate; a fixed 21-byte cap is
   implausible but was never the live alternative; the live alternative is a ONE-BYTE OFF-BY-ONE
   at a delivery boundary, which the length experiment tests directly.*

   **The pattern, named because it has now recurred three times:** a reviewer challenges a claim,
   I concede the reviewer's LOCAL point, and discard a PRIOR the reviewer never addressed. The
   local point has been right every time; the concession too broad every time.
2. **~~Change the last character of `SECRET`.~~ DROPPED — no live hypothesis needs it.** Name
   the hypothesis under which the character's VALUE matters: the tty does not care, `read -rs`
   is value-blind, `jq -Rnc` treats digits and symbols identically. It was a speculative test,
   and step 3 subsumes it anyway — a 40-character password ends in a different character, so
   "the last char, whatever it is" gets tested for free.

3. **VARY THE PASSWORD LENGTH — RUNNING (40 chars, `7ee3ffb0`). PRE-REGISTERED OUTCOMES, and
   the first version of this list was missing the likeliest one.**

   | observed at 40 chars | reading |
   |---|---|
   | **39** (TAIL-1) | one byte at the end, length-independent — off-by-one at the line boundary. **Expected** |
   | **21** | a genuine absolute bound — resurrects the cap frame, major surprise |
   | **40, no loss** | length-, timing- or content-sensitive in a way 22 triggers and 40 does not — **AND it is also just what a batch that did not fire looks like.** At ~10 %/run, ~30 runs are needed before a clean batch means anything, and changing the length also changes the write's timing, so a null here is DOUBLY ambiguous. This row was missing entirely |
   | **≤38, TAIL-n** | the loss SCALES with length ⇒ neither off-by-one nor cap; a proportional/streaming effect, and the most informative of the four |
   | anything non-TAIL | contradicts all seven prior events — treat as a harness change, not a finding |

4. **THE HARNESS-WRITE DISCRIMINATOR (H5), which may matter more than 3.** Split
   `p.write(password + '\r')` into two writes with a gap, or write char-by-char. If the loss
   changes shape or vanishes, the byte is being lost on the WRITE side and there is no product
   bug. Run it alongside 3 — they answer different questions and neither settles the other.

**AMENDED 2026-09-04T23:57 — round 7 EARNED ITSELF and the "closed" call was one round early.**
It surfaced H5 (the harness's own write, never listed in seven rounds, and the hypothesis that
decides whether there is a product bug at all) and a third over-retraction. A stopping rule
that fires one round before the best finding is mis-tuned, so the condition is sharpened:

> **STOP REVIEWING when a round's findings are all about how a claim is WORDED, rather than
> about what is TRUE or what to DO next.**

Round 7 produced two of each, so it passes. Rounds 4-6 were mostly wording and did not. The
next round producing only wording-shaped findings is the signal to stop — and the tokens go to
the measurement instead. **The card is closed for review AFTER this amendment.**

**THE ORIGINAL CLOSING NOTE, 2026-09-04T23:55 — pending NEW MEASUREMENT only.** Seven
rounds ran tonight. The experimental content settled at 23:37 when the batch returned 4/4 at
N=21; rounds 4-7 adjusted the WORDING of claims about a result that has not changed since.
Each round's fixes generated the next round's findings — three separate paragraphs on this
card now correct the *correction* of the load caveat — which is the failure the stopping rule
itself predicted: *"the loop cannot self-terminate; findings are always available."* An
adversarial reviewer pointed at any text will find something; that is what it is for.

> **STOP REVIEWING when a round produces no finding that changes a MEASUREMENT, a NEXT STEP,
> or a COLUMN** — i.e. when every finding is about how a settled result is worded.

Round 6 met that for 3 of 6 findings; the 3 acted on were a rate claim a reader would
mis-read, a STATE header contradicting its own body, and one unrun check. **The next real
information comes from RUNNING step 2 or 3, not from re-reading step 1.** If the review gate
fires on these card edits, the correct response is one line saying the card is closed for
review pending new measurement — not another round.

**BACKSTOP, in case a later round argues past it: the batch RUNS TO COMPLETION before any
further instrument edit.** Two batches were already killed mid-flight for instrument fixes; a
third would be evidence the instrument had become the subject. An instrument revised between
every run measures nothing.

21 pty tests pass, tsc 0 lines. **The DETECTOR half is validated for `fc3b6f76`'s wiring
only** — run 23 fired it on a real loss end-to-end, and `1a2a1b2c` then replaced that wiring
with `diagnoseBody`, which has never fired on real data.

**Step (a) is discharged, and so is (c), together.** The body orders a throwaway probe under
`scripts_dev/` then a port to the shipped gate; the probe was skipped because the shipped
harness already has a real pty, a real server and the real pipeline, so nothing had to be
validated and then thrown away.

**NEXT ACTION — in this order.**

1. **Wait for the next TIMEOUT and read its own message.** Free, already built: `seen[] === []`
   discriminates a timing slip, and `diagnoseBody` prints "no request reached the server at
   all" when it holds. **Keep the full run log** either way.
2. **~~Instrument the `jq` boundary from the test.~~ DONE — `e3787efb`.** The shim exists,
   is pinned, and is proven to sit in the gate's own path (P12e). Nothing to build.

3. **RUN THE BATCH AND WAIT FOR A TRUNCATION — this is the whole remaining experiment, and
   it is a MEASUREMENT, not a code change.** At the pre-shim rate (1 in 24 runs, and see the
   caveat above about why that number no longer predicts anything) a truncation needs tens of
   consecutive runs. When one fires, the failure message now carries `jq -Rnc stdin: N
   byte(s) for 22 expected`, and N is the answer:
   - **N = 21** → the loss is at or before `read`. Hypothesis 2 (the line terminated one byte
     early) is the only survivor and becomes the thing to instrument next.
   - **N = 22** → the loss is AFTER `jq`, which REFUTES the composition argument this card
     has been resting on since `38f995c1`, and re-opens hypothesis 3.
   - **N ≤ 20** → a MULTI-byte loss, which no observation on this card has ever shown (all
     three were exactly one char). A different finding, not a stronger version of N=21.
   - **N > 22** → something ENTERED the buffer that the gate did not type — a stray `\r`, an
     echo artefact, input from another test. Also a different finding, and the one that would
     most change what this card is about.
   - **NOT RECORDED** → the shim did not fire on that run. That is a finding about the
     HARNESS, not about the gate; do not read it as either answer.
   - **The baseline control is TAKEN AUTOMATICALLY, on every run — P12e asserts the VALUE.**
     An earlier version of this line said to "take one green reading before trusting a red
     one", which was not executable: `fakeHome` is torn down in `afterEach`, so no later step
     can read the number back, and a control that cannot be run is not a control. P12e now
     asserts `['22']` rather than a length of 1, so a green suite IS the control. It follows
     that P12e also fires on a real truncation — intended, and the note separates the two
     (`NOT RECORDED` = the shim never ran; `21 byte(s) for 22 expected` = the answer).
     **"Cannot be forgotten" was claimed for this control and is WITHDRAWN:** an edit
     reverting the assertion to `toHaveLength(1)` removes it and leaves all 30 tests green,
     and no neuter can catch that — a test cannot pin the FORM of its own assertion. The
     control is taken by every green run; it is not protected against being deleted.
   - **THREE tests now fire on ONE truncation** — the failing gate test via `diagnose`, plus
     P12e or the P8/P9 coverage line. Do not read a count of failed test names as a count of
     truncations: one event, several reporters.

   **`SHIM-ERROR-90/91/92` in the note means a HARNESS failure, never the bug — discard that
   run.** `mktemp` and `cat` both fail toward a SHORT length (a full disk mid-`cat` leaves a
   truncated file, so the shim would record a short length AND hand `jq` short input,
   manufacturing exactly the observation this card hunts).

   **Two defects in the first cut of those guards, both found by the second review:**
   `wc -c … | tr … || exit 92` tested **`tr`'s** status, not `wc`'s — the
   `$?`-after-a-pipeline trap, from this repo's own lessons file — so the guard was
   unreachable in the case it was added for; fixed with `set -o pipefail`. And an `exit` was
   INVISIBLE: the gate calls the shim inside `_body="$(… | jq …)"`, so command substitution
   swallows the code and the reader sees only a generic refusal. "Discard the run" was an
   instruction nobody could follow — the same un-executable-procedure defect as the baseline
   control, one commit later. The guards now WRITE the marker into the record file, so
   `jqStdinNote` prints it and the failure identifies itself.

   **The marker covers 91 and 92 ONLY — `fail 90` cannot write it** (third review, FINDING K).
   `mktemp` fails almost exclusively for reasons that ALSO break the append (`fakeHome` gone,
   unwritable, full), so a 90 degrades to `NOT RECORDED`. **Left unfixed deliberately** under
   the stopping rule below: `NOT RECORDED` is already classified as a harness finding, so
   nothing is misread as the bug — the guard is incomplete, not misleading.

   **A shim failure now turns FOUR SECURITY-NAMED TESTS RED** (P8×2, P9×2 — third review,
   FINDING M). Test names are what a reader scans, so "P8 and P9 failed" reads as an
   echo/secret regression when it may only mean the shim did not fire. The note disambiguates
   *if read*. The cost is accepted for green-run coverage; it is written here so the next
   reader is not sent hunting a security bug that is not there.

   **The runner prints EVERY note, never the first.** Passing tests emit none (measured: 0 in
   a green run, 1 in a neutered one), so every note in a log belongs to a failed test — but
   P3, P8×2 and P9×2 all carry a `diagnose()` message, so a two-failure run has two notes and
   `head -1` would attribute a length to the wrong test.

   **Keep the full run log either way** — no log survives from batches A or C, which is why
   nobody can now say what those three presumed timeouts looked like.

**NOT the way two earlier versions of this line said** — *"print `${#pw}` inside the gate"*
would have added a debug print to `scripts/shell-helpers/common.sh`, which is SHIPPED and runs
against the owner's REAL governance password; it would also not have worked (`_pw` is `local`
and `unset` one line later). Reasons in `ab90429f`/`38f995c1`.

**Waiting on nothing and nobody** — no `blocked-by:`, no owner decision. It sits in `todo`
because the turn ended, not because it is parked; the sibling `TRDD-BAXXIG0J` is the one
awaiting a USER call, and this card does not depend on it.

**Do not re-derive the interleaving requirement for the run that already happened.** Box 4's
randomisation clause governs comparing two ARMS. P0 is deleted, so there is one arm; a
single-arm rate needs no assignment mechanism, and none was claimed.

## Problem

`tests/unit/maestro-sudo-gate-pty.test.ts` has failed intermittently — 4 failures in 35 runs,
and not always the same test. **Read that rate as conditional, not as the file's baseline.**
Split by whether the since-deleted P0 was present, it is **4 / 21 with** and **0 / 14
without** — but **three of those four failures are in ONE batch that also ran under
background load, so the experiment cannot separate P0 from load** (see §Evidence; no
p-value is quotable here and earlier versions of this card wrongly quoted one). The
intermittency is real and was observed; what it depends on is open, and that is step 0.
This matters more than an ordinary flake because P6, P8,
P9 and P10 in that file are the *only* behavioural pin on TRDD-WV8FDAH0's fix — the one that
stops a ^C at the password prompt leaving the terminal echo-off or putting the typed password
on screen. **An unreliable pin on a security fix is close to no pin**: a real regression would
read as "the flaky one again".

## Evidence — measured 2026-09-04, four batches

| batch | P0? | condition | failures / runs | which |
|---|---|---|---|---|
| A | present | pty-based P0 | 3 / 13 | P8 ×2, P9 ×1 |
| B | **absent** | that P0 `it.skip`ped | 0 / 6 | — |
| C | present | the final, non-pty P0 | 1 / 8 | P8 ×1 |
| D | **absent** | P0 fully removed | 0 / 8 | — |

**with P0: 4 / 21 · without P0: 0 / 14.**

Batch B counts as P0-ABSENT, and an earlier version of this card had it the other way round.
`it.skip` does not merely stop the assertion — **a skipped test's `beforeEach` does not run
either**, so B's runs carried no extra HTTP `listen(0)`, no `mkdtemp`, and no pty. Measured
with a throwaway probe rather than assumed: a describe with one skipped and one real test
saw the hook fire **once**, not twice; a second probe with two real tests and one skipped saw
**two**, which removes the "counter read too early" reading of the first. Correcting it moved
6 clean runs across the split — it changed the numbers, and what those numbers support is
settled further down, not here.

**How this was read wrong, four times, compressed.** B looked like "the extra pty causes
it"; C looked like a refutation, so I called the flake pre-existing; D undercut that (C's P0
still ran `beforeEach`); and re-classifying B as P0-absent moved 6 runs across the split.
Then the p-values computed on that table were withdrawn outright. Every wrong reading shared
one mistake — treating a clean batch of 6-8 as evidence of absence — and it is recorded as a
general lesson in `.claude/rules/lessons-verification.md`, not re-argued here.

**What the data supports, and it is not much:**

> **4 failures in 35 runs. All 4 in P0-active batches; 3 of those in ONE batch that also ran
> under background load.** P0 and machine load varied together, so this design cannot
> separate them. The rate is **not** summarised here as an interval: a binomial CI needs
> independent draws from ONE population, and these are four file versions under varying
> load. A Wilson CI was briefly quoted and withdrawn — same borrowed authority as the
> p-values, in the more persuasive costume of caution.

No p-value is quotable *from this design*, and neither is a binomial interval. A permutation
test needs randomisation; a CI needs independence and homogeneity; this data supplies
neither. A permutation test inverts a
randomisation null, and these batches ran in time order against four different versions of
the file. Two earlier versions of this card quoted p anyway — 0.052, then 0.114, then 0.36
for an A-excluded split that was itself unfair, since dropping the batch holding 3 of 4
events *because* it is confounded biases hard toward the null.

**Two confounders that survive.** Batch A ran under background-agent load. And C was never a
clean control: its P0 still EXISTED and merely lacked a pty, so it still ran `beforeEach` —
an HTTP `listen(0)` plus a `mkdtemp` before the first pty test. "No extra pty" was therefore
never the same condition as "no P0".

**A limit on the skip finding**, since the split rests on it: measured for a *static*
`it.skip`, which is what B used. A runtime `ctx.skip()` runs `beforeEach` first;
`describe.skip` and `-t` filtering are untested. Do not generalise past B's form.

**Step 0 must fix the DESIGN, not raise `n`:** interleave the arms within one session on a
quiet machine. More runs of the same shape buy precision about nothing.

## Relationship to WV8FDAH0, and a correction its own commit cannot carry

WV8FDAH0 closed `complete` (`b47c423e`) while this card was open, and that was right: its
code is landed and verified, and what THIS card governs is confidence in the TEST, not
completion of the FIX. So this is not a `blocked-by:` of it.

**`b47c423e`'s commit message gives a different, wrong reason** — that a `blocked-by:` would
"make the board claim work is in flight". It would not; `blocked` is precisely the column for
a card sitting still with a named blocker. The card is frozen and the commit is immutable, so
the correction lives here, on the unfrozen card that owns the relationship and that a reader
asking the closure question will reach.

## A separate gap this turned up: nothing executes the shebang

The deleted P0 asked "does the harness's bash match the scripts' `#!/usr/bin/env bash`?"
That question was **confused from the start**, and noticing why is worth more than the test
was. The pty tests run `bash -c '… source <copy>; maestro_sudo_ensure …'` — they **source**
the scripts into an already-running bash (5 such sites) and **never execute the shebang at
all**. So no test in this file ever depended on the answer.

But production *does* invoke these scripts through that shebang, and **no test exercises
that path**. A review challenged this as fabricated, on the grounds that
`aimaestro-agent-ctrl-c.test.ts` runs the agent script — so it was measured, and the gap is
real. Every invocation in the suite passes the script as an ARGUMENT to bash:

- `ptySpawn('bash', [AGENT, 'probe', …])` — aimaestro-agent-ctrl-c.test.ts:42
- `execFileSync('bash', [join(SCRIPTS, 'aimaestro-agent.sh'), …])` — cli-help-exit-contract, capabilities
- `source ${copy}` — the five gate-pty sites

**`bash <script>` does not use the shebang line either** — that is the part the challenge
missed, and it is why "a test runs the script" is not the same as "a test exercises the
shebang". Searched for a `.sh` executed with no leading interpreter across `tests/`,
`package.json` and `.github/`, covering literal paths, template literals, `shell: true`, and
`./x.sh` / `sh -c` forms: no hits. **Bounded claim:** the search names a literal `.sh`, so a
PATH-resolved bare name or a path held in a variable would not be caught; nothing here puts
`scripts/` on PATH, but the negative is 'no direct-execution form naming a .sh literal',
not a proof. (An earlier grep matched only identifier-shaped arguments under `tests/unit`,
supporting far less than the sentence beside it claimed.)

It is NOT this card's job: it belongs in its own file, where an extra pty costs nothing, and
it must invoke the script as a program (`execFileSync(SCRIPT, …)`), not under `bash`.

## The clue worth chasing first

One P9 failure was **not** a timeout. The gate reached the server and POSTed a password that
was the real one **minus its final character**:

```
expected '{"password":"wrong-pw-9MZQ4T7E-x7q"}' to contain 'wrong-pw-9MZQ4T7E-x7q2'
```

The harness writes `SECRET + '\r'` in a single `p.write`, so nothing split the *write*. The
loss happened between that write and `read` consuming the line. Two hypotheses, both
UNVERIFIED — do not treat either as a finding, and do not test only the first:

1. **`stty` flushed queued input.** `stty` uses `TCSAFLUSH` on some paths, which discards
   pending input, and the gate manipulates the tty at exactly that moment (`stty -echo` on
   the handler's RETURN trap). **If this is it, it is a user-facing bug, not a test
   problem** — a human typing while the gate re-disables echo loses a character and gets an
   unexplained refusal. Against it: a flush would tend to drop a leading or middle run, not
   exactly the final byte.
2. **The line terminated one byte early.** The pty is in canonical mode, so the line
   discipline assembles the line; a `\r` arriving while `stty` is mid-transition can end it
   before the last byte lands. This fits "short by exactly the tail" better than (1) does.

Ruled out: a truncated HTTP body. The JSON parsed cleanly and only the *value* was short.
Also not `MAX_CANON` (1024 on Darwin) — the secret is 22 characters.

## Step 1, 2026-09-04: ONE loss seen in a probe (n=1), position unrecorded

**Two one-character shortfalls exist, with very different evidential strength. Both belong
here; an earlier draft deleted the stronger one while correcting an overstatement.**

| observation | where | position | strength |
|---|---|---|---|
| `…x7q` for `…x7q2` (the original P9 failure) | the **SHIPPED gate**, full pipeline + live HTTP | **MEASURED: a tail loss** | 1 event, but position established |
| `len=35/36` | `fix2.sh`, a **reimplementation**, no pipeline | **unrecorded** (lengths compared, not strings) | 1 event, position unknown |

**Whether they share a mechanism is open** — that is the question, not a settled link. What
the second adds is that a single-character shortfall is **reachable outside the full gate**,
across 1 loss in 12 runs spanning TWO probe variants (a 2-run pair with a `printf` in the
RETURN-trap window, and a 10-run batch without it). That is not one measured cell, and no
rate should be quoted from it.

**What this card said an hour ago, and why it was wrong — three times over.**

1. *"10/10 intact, evidence against hypothesis 1."* A delay sweep with no demonstrated power.
2. *"The instrument cannot detect input loss at all."* Retracted on an eat-control that
   consumed nothing (`ATE=[]`, measured). Either the outer `read` had already taken the line,
   or canonical mode had not yet released it — **both make the control void**, so it never
   showed the probe was blind. This was a stronger false claim than the one it replaced.
3. *"The P9 signature reproduced — short by exactly one, at the tail."* **The tail is
   unmeasured.** The probe compared LENGTHS only; `len=35` is equally consistent with a lost
   first, middle, or last character. "At the tail" was inherited from the original P9 failure
   (`…x7q` vs `…x7q2`, genuinely a tail loss) and silently transferred onto an observation
   that cannot support it. Commit `6c07f598`'s message carries that overstatement — a reader
   following `implementation-commits` back should not inherit it.

**One event is not a reproduction.** A single LOSS is exactly as weak as a single clean run,
which this card spent several revisions establishing about clean runs. It shows the outcome
is possible; it gives no rate and no mechanism.

**No mechanism is attributed.** An earlier draft blamed extra work (`printf`) inside the
RETURN-trap window. The data contradicts it: the variant with `sleep 0.4` + a `read` in that
same window lost nothing in 2 runs, and the losing run's own sibling at a different delay was
intact. The variable that differed was the delay, on n=1. Guess withdrawn.

**Next, in order:** (a) rebuild the probe under `scripts_dev/` and **validate its loss
branch**: the last version does contain diffing logic, but it has produced 10 INTACT and
**zero losses, so that branch has never executed** — an untested error path is not a working
instrument, which is this card's own recurring theme. Induce a loss deliberately and confirm
the diff output is right BEFORE trusting any position it reports. (b) Then run to a few
hundred iterations for a rate and a position. (c) Port to the SHIPPED gate — this probe is
not it. (d) Only then discriminate the hypotheses.

**SUPERSEDED 2026-09-04 by the STATE block — (a) and (c) are DONE, and (c) absorbed (a).**
The paragraph above is kept because its REASON still governs: an untested error path is not
an instrument. What changed is only where the instrument lives. Building it in the shipped
harness discharged (a) and (c) in one step and left no throwaway to port, so a reader
following this list must not go and rebuild the `scripts_dev/` probe it describes.

## Step 2, 2026-09-04: the flake REPRODUCED, and the position is TAIL

24 consecutive runs of the shipped pty file, single arm (P0 deleted), ~10 s each, idle
machine. Logs `/tmp/flake601/`.

| | |
|---|---|
| **rate** | **1 failure / 24 runs (4.2%)** |
| **which test** | `P8 [scripts/shell-helpers/common.sh]`, run 23 |
| **what the instrument said** | `TAIL loss: 1 char(s) dropped at the end (received is a prefix of expected): expected '{"password":"wrong-pw-9MZQ4T7E-x7q"}' to contain 'wrong-pw-9MZQ4T7E-x7q2'` |

**Three things this settles, and two it does not.**

SETTLED:
1. **The truncation OCCURS with P0 absent.** That is all one failure establishes, and it is
   worth having: a P0-caused defect cannot fire with P0 deleted. **It does NOT establish
   "the intermittency does not depend on P0", which is what an earlier version of this line
   claimed** — that is a comparative claim, and pooling §Evidence's batches B and D (0/14,
   P0-absent) with today's run gives **1/38 (2.6%) without P0 against 4/21 (19%) with it**.
   That gap is at least as consistent with P0 mattering, or with load mattering (batch A's
   confound), as with neither. I quoted the new number and left the 14 runs already sitting
   in the table I was editing out of the comparison — ticking on the favourable half of my
   own data, which is worse than ticking on n=1.
2. **The position of THIS loss is TAIL, and it is MEASURED rather than eyeballed.** Two
   single-character tail losses now exist — the original P9 and this P8 — but **do not read
   them as one phenomenon confirmed twice.** They are two CALLER SHAPES: P9 is `trap '' INT`
   (an empty handler body, no work in the tty-transition window) and P8 is a returning trap
   that prints. If hypothesis 2 is right that window is exactly where the risk lives, so the
   shape is a signal and should be tabulated across future failures, not averaged away.
   (Gate VERSION does not separate them: `git log -S "P9 ["` shows P9 was INTRODUCED by
   `e4393a49`, so it cannot predate that rewrite. A review claimed it did; measured, it
   does not.)
2b. **A correction that belongs to a commit message, which cannot be edited.** `1a2a1b2c`
   justifies the `diagnoseBody` split by calling the unparseable-body case "the instrument's
   own most likely real failure" — and §"The clue worth chasing first" **rules that out**:
   *"Ruled out: a truncated HTTP body. The JSON parsed cleanly and only the value was
   short."* The split is still worth having (it is honest, it is cheap, P11g pins it), but
   its justification is **"a case that would otherwise be described falsely,"** not "the most
   likely failure." Recorded here because a reader following `implementation-commits:` back
   would otherwise inherit a claim this card contradicts two sections earlier.
3. **The `fc3b6f76` wiring fired end-to-end.** Run 23 exercised `diagnoseTyped(SECRET,
   pwOf(...))` on a REAL loss through the real pipeline and printed the right answer — the
   one thing a synthetic mutation could not supply. **But that is not the code in the tree**:
   `1a2a1b2c` replaced that wiring with `diagnoseBody`, which has never fired on real data.
   The classifier is validated by P11a-g; the current capture path is validated only by
   construction.

NOT SETTLED:
4. **The rate is one event, and "4.2%" is not even a rate OF anything stable.** 1/24 is
   per-RUN, and a run contains ~6 password-typing opportunities on the ^C path (P8/P9/P10 ×
   2 copies) plus P1/P2/P3 — so per-opportunity it is nearer **1/144 ≈ 0.7%**. Worse, the
   per-run denominator is a function of how many tests the file has, **which I changed in
   this same session by splitting P11**. A number that moves when you refactor the test file
   is not a property of the bug. Quote the count and the denominator you mean.
5. **These 24 runs are LOW-LOAD only.** Batch A's confound was background load, and this
   machine was idle. A clean-ish result here says nothing about the loaded condition under
   which 3 of the original 4 failures occurred.

**The flake has (at least) TWO failure modes, and §Evidence pooled them.** Of the 4 historical
failures, exactly ONE was a truncation (the P9 in batch A — §"The clue" says it "was **not** a
timeout"); the other three were timeouts. So `4/35` is a rate for *"the file went red"*, not
for the truncation, and today's `1/24` is a rate for the **truncation alone**. Do not compare
them as if they measured the same event. Two consequences:

- **Box 1's tick is about P0-dependence and is still sound, but read it narrowly.** For the
  truncation specifically the evidence is 1 event with P0 present and 1 without — thin, and
  it is the direction that matters (a P0-caused defect cannot fire with P0 deleted), not the
  magnitude.
- **P8 is the usual failer, not P9.** P8 ×3 and P9 ×1 historically, P8 again today. Earlier
  prose on this card framed the phenomenon around "the P9 failure" because that was the one
  with the readable signature; the failing test is more often P8.

**P8, P9 and P10 type IDENTICALLY — verified in the source, not assumed.** All three send
`\x03` at 300 ms and `SECRET + '\r'` in ONE `p.write` at 1200 ms (`:346`, `:371`, `:390`);
only the prior-trap prelude differs. So which of them fails carries no information about the
input-delivery mechanism, and pooling the P9 and P8 truncations on THAT question is
legitimate. Both are also post-`e4393a49` — the §Evidence batches were all run on the fixed
file, since these tests exist to pin that fix — so no gate-version difference separates them.

**Where it leaves the hypotheses — and there are THREE, not two.**

**The biggest correction on this card so far: the hypothesis space has been two-valued since
it was written, and both entries are TTY-LAYER, while the observation is SERVER-SIDE.**
Between the tty and the body the instrument reads sit bash's `read`, a shell variable,
whatever composes the JSON, `curl -d @-`, and a pipe. §"The clue worth chasing first"
asserts *"the loss happened between that write and `read` consuming the line"* — **that was
never established.** It was assumed on the first occurrence and has been inherited unexamined
through every revision since, including the ones that were busy correcting other overreach.
So:

3. **The loss is in the shell→curl leg, after `read` already had the full line.** **CORRECTED
   the same session, and mostly CLOSED — I over-stated it, using the accusation that the card
   was sloppy to introduce a hypothesis the card had already narrowed.** The gate's actual
   chain is `IFS= read -rs _pw < /dev/tty` → `printf '%s' "$_pw" | jq -Rnc '{password:
   input}'` → `curl -d @-`. Two consequences I should have derived before writing the
   hypothesis:
   - **The JSON is CONSTRUCTED by `jq` from `$_pw`**, so a well-formed body carrying a short
     value means `jq` already received a short input. A loss anywhere AFTER `jq` would cut
     the JSON mid-string (`…x7q` with no closing quote or brace) — and the observed body was
     `{"password":"wrong-pw-9MZQ4T7E-x7q"}`, intact. §"The clue" said exactly this
     (*"Ruled out: a truncated HTTP body. The JSON parsed cleanly and only the value was
     short"*) and I quoted that very line in `11c90b6e` while leaving this hypothesis
     over-broad in `ab90429f`.
   - The only shell-side survivor is a short write on the `printf`→`jq` pipe, and that is not
     credible for 22 bytes: `printf` is a builtin issuing one write, far under `PIPE_BUF`,
     where writes are atomic.

   **So the loss is at or before `read`, and hypotheses 1 and 2 are the live space after
   all.** What hypothesis 3 leaves behind is not a candidate but a MEASUREMENT worth taking,
   because it is the only thing that separates "the line `read` returned was short" from
   every story about what happened later.

**And the tty reasoning I published an hour ago was broken in two places, though its
conclusion survives.** Recorded rather than quietly rewritten, because a reader who checks a
broken argument discards the conclusion with it:

- **The "one `p.write`" step was a non-sequitur.** How many `write(2)` calls the HARNESS made
  says nothing about the RECEIVER: the kernel feeds the canonical buffer character by
  character, and a `tcsetattr(TCSAFLUSH)` from the `stty` process can land between any two of
  them regardless. I used a fact about the writer as a fact about the line discipline.
- **The hedge was backwards, and it weakened my own claim.** I wrote *"a flush landing when
  only the last byte is still queued would also take the tail."* Under canonical mode it
  cannot: the earlier characters can only LEAVE the buffer when a terminator arrives, and the
  terminator comes after the last byte — so at the moment the final `2` is queued, all 22 are
  queued, and a flush there discards all 22 and produces **no request at all**, not a tail
  loss. Worked through properly, a flush predicts a **LEADING or total** loss at every point.

**HYPOTHESIS 1 IS REFUTED ON TIMING, and this replaced a "relocation" I published minutes
earlier — the second mechanism story this card produced and killed in one pass.**

Read the gate's actual `stty` calls. There are exactly three, all in
`maestro_sudo_ensure`/`_maestro_sudo_on_int`: `stty -echo` **before** the prompt (t≈0); the
INT handler's `stty echo` plus its RETURN trap's `stty -echo`, both at the **^C** (t≈300 ms);
and `stty echo` **after** `read` returns. The harness types the password at **t≈1200 ms**.

So no `stty` runs within ~900 ms of the password write. At t≈300 ms the input queue is
**empty** — nothing has been typed, and the `^C` arrives as a SIGNAL under `ISIG`, not as
queued data. **A flush there flushes nothing.** It cannot shorten the password (the original
hypothesis 1) and it cannot strand `read` either (the "relocation"), because by the time the
password is typed the handler has been finished for most of a second.

**What I had published between those two positions.** That a flush blocks `read` until the
25 s `SIGKILL`, hence explains the 3 timeouts. Each step of that is defensible in isolation;
the argument never checked whether a flush happens anywhere near the password, and it does
not. **It was the same failure as the statusline attribution earlier in the session** — a
chain of plausible steps published without measuring the one quantity that decides whether
any of it occurs. Recorded rather than deleted because the pattern is the finding: this card
has produced one confident mechanism per pass, and retracted every one.

**One survivor of the timing argument, and it is a hypothesis, not a rescue.** The 900 ms gap
is measured on an **idle** machine, where the handler is a few shell commands and one
subshell. Batch A — which holds 3 of the 4 historical failures — ran under **background
load**. Whether load can stretch that handler by ~900 ms is untested, and saying "it might"
is exactly the move this section exists to warn against. It is written down as a thing to
measure, not as a reason hypothesis 1 lives.

**So for the TRUNCATION nothing is left but hypothesis 2, unexamined — and for the TIMEOUTS,
nothing at all.** That is a worse position than the card claimed an hour ago and a more
honest one.

**If the loss is at the tty (hypothesis 2), this is a USER-FACING bug, not a test problem** —
a human typing while the gate re-disables echo loses their last character and gets an
unexplained refusal. §Proposed fix step 1 said so from the start. **If it is hypothesis 3 it
may well be harness-only**, since a human does not pipe through this harness's `curl` path.
That is exactly why the cheap length probe comes first: the two branches differ in severity,
not just in mechanism.

## Proposed fix

Investigate in this order, and do not skip to the third:

1. **Decide whether input is genuinely being lost**, by driving the gate at a pty and typing
   a known string across the stty transition, asserting on what the server received. If
   characters are lost, the defect is in the gate and this card changes shape entirely.
2. If the tty is innocent, remove the harness's dependence on wall-clock timing. The tests
   type at fixed offsets (^C at 300 ms, password at 1200 ms) after seeing the prompt, which
   assumes the caller's trap ran and the read resumed inside 900 ms. Drive on OBSERVED
   output where a marker exists (P8/P10 print `PRIOR-INT`).
3. Only P9 has no marker — `trap '' INT` prints nothing by construction — so it is the one
   case that may legitimately need a wider margin. Widen it last, and say in the test why
   that one is timing-bound when the others are not.

## Verification

> **STALE — this section predates the two-modes split (§Step 2) and is kept for its
> reasoning, not its numbers.** Every rate below is **per-run and ALL-MODES**: it pools the
> truncations and the timeouts, which §Step 2 shows are distinct events with different
> candidate causes. So the table answers "how often does the FILE go red", not "how often
> does the truncation happen", and the "30 consecutive runs" criterion inherits that. Do not
> read it as current guidance; recompute per mode when the modes have rates worth pooling.

- The file passes **30 consecutive runs** — but read what that does and does not buy, because
  it depends entirely on the true rate, which is the thing in dispute. The table below is
  **ILLUSTRATIVE ONLY**: each row assumes independent runs at a fixed rate, which is the same
  assumption the withdrawn p-values leaned on and which this data does not satisfy. It is
  here to show how strongly the answer depends on a rate nobody has measured cleanly — not
  to be quoted as a probability.

  | assumed rate | 30 clean runs by luck |
  |---|---|
  | 19.0% (P0-active, 4/21) | 0.2% |
  | 11.4% (pooled, 4/35) | 2.6% |
  | **4.5% (batch A excluded, 1/22)** | **24.8%** |

  So if the A-excluded picture is the true one — and §Evidence says it may well be — then
  **30 green runs prove almost nothing**, coming up clean a quarter of the time anyway. Do
  not read a 30-run sweep as closure until step 0 has fixed the rate; and do not trim the
  number without redoing this arithmetic against whatever step 0 measures.
- If step 1 finds real input loss, that becomes its own fix with its own pty test, and this
  card cites it.

## Estimated risk

LOW for the harness work. Step 1 could raise the severity sharply if input loss is real.

## Acceptance

- [ ] Step 0: re-measured the flake rate with P0 fully absent, n >= 24, settling whether the
      intermittency pre-dates P0 at all — every failure so far had some P0 present.
      **UNTICKED after being ticked prematurely (§Step 2 item 1).** The n>=24 half is done
      (24 runs, P0 absent, 1 truncation), and it establishes the phenomenon OCCURS without
      P0. The *settling* half is not: pooled with §Evidence's P0-absent batches it is 1/38
      vs 4/21 with P0, which does not settle the comparison in either direction. Note the
      box's own wording is unsatisfiable as written — no forward measurement can show what
      "pre-dates" P0 — so when this is next worked, restate the box as the answerable
      question (does P0 raise the rate?) rather than tick the unanswerable one.
- [ ] Established whether the truncated password was tty input loss or a harness artifact,
      with the measurement recorded here, testing BOTH hypotheses in the clue section.
- [ ] The timing dependence removed wherever an observable marker exists.
- [ ] **UNSATISFIABLE AS WRITTEN — restate before working it (2026-09-04).** Two reasons.
      (i) Its arms were P0-present vs P0-absent and **P0 is deleted**, so there are no arms to
      interleave; the STATE block's "do not re-derive the interleaving requirement" reads as
      *don't worry about it* when what it means is *this box needs restating*. (ii) Since the
      two failure MODES were split, "green" is ambiguous — a series that fixes the timing slip
      and leaves the truncation would show a long green streak and satisfy this box while the
      security-pin defect it exists for remains. Restate as a per-MODE criterion. Original
      text kept below.
- [ ] Green across an INTERLEAVED design. **The arm size is a CONVENTION, not a derivation** —
      nothing here derives one, and 12/arm would be WEAKER than the '30 consecutive' it
      replaced. Prefer a relative criterion: run until the arms' counts differ by more than
      chance, or report that they do not. Any fixed n quoted before the interleaved run has
      produced a rate estimate is decoration. NOTE: the interleaved design RESTORES
      randomisation ONLY IF the arm order is RANDOMISED per run (coin-flip per iteration,
      sequence recorded). Deterministic alternation is balancing against a time trend, not
      random assignment, and stays vulnerable to any period-2 effect — it would NOT earn a
      p-value. Randomise, or carry no test.
- [ ] TRDD-WV8FDAH0's STATE block updated to drop its caveat about the pin being intermittent.

## Approval log

- 2026-09-04T20:59:33+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a test-reliability bugfix inside this repo,
  reversible, no governance or public surface. Derived from TRDD-WV8FDAH0.
