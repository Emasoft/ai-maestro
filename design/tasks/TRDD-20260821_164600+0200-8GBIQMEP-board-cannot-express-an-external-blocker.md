---
trdd-id: 8GBIQMEP
title: The board cannot express an external blocker so external waits go stale unwatched — 9 of 12 cited issues already closed
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-21T16:46:00+0200
updated: 2026-08-21T23:25:16+0200
current-owner: ai-maestro-orchestrator-agent
created-by: ai-maestro-orchestrator-agent
assignee: unassigned
task-type: infra
priority: 0
min-approval-requirement: none
severity: high
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
labels: [kanban, blockers, drift, measurement]
external-refs: [janitor#73, janitor#77, janitor#100, janitor#139, janitor#167, janitor#283, ai-maestro#46, ai-maestro#55, orch#27]
---

# TRDD-8GBIQMEP — the board cannot express an external blocker

Filed by the ORCHESTRATOR session on hub instruction (ai-maestro-e7, 2026-08-21), out of the
hub-authorized stale-blocker sweep. Evidence report:
`reports/orchestrator/20260821_164101+0200-blocker-sweep-and-checkbox-census.md`.

**Parent context (cited, not `parent-trdd:`): [[5YRLA53W]].** That card already recorded the
*vocabulary* half of this under "VOCABULARY GAP" — `blocked-by:` takes TRDD ids only, so a card
waiting on a GitHub issue cannot use `column: blocked` without making `blocked-by:` a lie, and the
`todo` + `external-refs:` precedent ([[35VKIGTC]] ← `janitor#167`) is also wrong because `todo`
asserts "ready to be pulled". **This card does not restate that. It adds the consequence and the
measurement, which are new.**

> **⏹ 2026-08-21T22:56 — THIS CARD NOW GATES A P0, so it was re-prioritised `1` → `0`.**
> The link above ran one way only: this card cited [[5YRLA53W]] as parent context, and that card
> named nothing. Its last open acceptance box is *"every card sitting still names a TRUE
> `blocked-by:`"* and it is **not closable without the corpus-level answer this card owns** — so
> `5YRLA53W` now carries `blocked-by: [8GBIQMEP]` / `column: blocked`, and the edge is wired at
> both ends. Consequence worth stating plainly, because it changes what pulling this card is
> worth: **closing 8GBIQMEP is the single move that unblocks a P0**, and `assignee: unassigned`
> on a card in that position is itself the stall this card is about. The `priority: 1` was
> correct when filed and became wrong the moment the P0 declared its dependency; a blocker
> inherits the urgency of the most urgent thing it blocks, or the board cannot be ordered.

## Problem

The gap is not only that an external wait is *unsayable*. It is that an external wait is
**unwatchable**, and the two compound:

1. An external dependency can only be recorded in **prose**.
2. Prose is checked **once**, at write time, by whoever wrote it.
3. Nothing re-checks it. No field holds it, so no detector can sweep it and nothing ever reddens.
4. Parking a card is precisely what stops anyone re-reading it — **so the staler a claim gets, the
   less likely anyone is to look at it.** Staleness is self-concealing.

The board has a live, machine-checkable edge for internal dependencies and **no edge at all** for
external ones. It is not a missing convenience; it is a whole class of dependency that the corpus
cannot represent and therefore cannot monitor.

## Measurement (2026-08-21, read-only, `gh issue view --json state,closedAt`)

Two sweeps over `design/tasks/*.md`, 122 cards:

| surface | result |
|---|---|
| `blocked-by:` (TRDD-id blockers) — 14 blocked cards, 20 distinct ids | **20/20 live. 0 stale.** |
| GitHub issues named in blocking prose ("blocked on" / "waiting on" / "gated on") | **9 of 12 CLOSED (75%)** |

**The contrast IS the finding.** The machine-checkable surface is perfectly clean. The prose-only
surface is 75% dead. Same board, same authors, same week — the only variable is whether the
dependency had a field that something could sweep.

Longest dead waits found: `janitor#73` closed 2026-07-09 (**43 days**) and `orch#27` closed
2026-07-16 (**36 days**), both still cited as an active WAIT on gate G2 of [[903B7A20]].

## The sub-finding worth its own sentence

The worst instance was not a careless claim — it was a **checked** one. [[5YRLA53W]] line 138 read:

> blocked on `janitor#139` — **verified OPEN, 0 comments, untouched since 2026-07-30**

`janitor#139` closed **2026-08-05**, three days after that line was written; the claim then stood
for 16 more days. A bare citation of the issue would have invited the next reader to check. A dated
verification **forecloses** the check — it is trusted *because* it looks checked. **A verification
claim with no expiry becomes more trusted as it becomes less true.** Any fix here has to handle the
checked claim, not just the lazy one.

> Phrasing note: this paragraph deliberately does **not** spell out the dead claim in
> assertion-shaped prose. `scripts_dev/sweep-external-blockers.sh` matches on blocking phrasing near
> an issue ref, so a card that quotes a dead wait verbatim gets reported as holding one — this card
> did, on its first run. Struck spans and `>` blockquotes are skipped by the sweep; bare prose is
> not. Quote a dead claim inside `~~` or a blockquote, or describe it.

Two closures also carried a title saying the *finding itself* was a detector bug (e.g.
`janitor#283`), so a stale external wait can outlive not only its blocker but the premise the card
was filed on.

## The question this raises (deliberately NOT answered here)

Per the hub: state the problem and the measurement, do not design the answer. The two candidate
shapes already on the table, from [[5YRLA53W]]:

- **`blocked-by:` grows an external-ref form** (e.g. `blocked-by: [gh:Emasoft/ai-maestro-janitor#139]`),
  making the edge machine-checkable, plus possibly a `blocked-external` column so `blocked` /
  `todo` both stop lying; or
- **a detector sweeps cited issues on a cadence** and reddens a card whose cited issue is closed —
  which needs no schema change but only works on refs it can find, i.e. prose parsing.

Open sub-questions either way: what a "cited" issue is (any `owner/repo#N` in the body, or only one
in a declared field); what the cadence is; and whether a closed blocker should auto-move the card or
only flag it (auto-move is wrong when the closure is unrelated to why the card cited it).

## Acceptance

- [x] Decision recorded on which shape is taken (field, detector, or both), with the rejected one's
      reason stated.
      **⏹ 2026-08-21T23:2x — DETECTOR, not field.** The FIELD was rejected on a measurement:
      `external-refs:` **already exists and 45 open cards already populate it**, and nothing in
      `scripts/` or `lib/` had ever read it back (positive control — the same grep finds
      `blocked-by` in 3 files). So the gap was never expression, it was a MISSING CONSUMER. That
      also decides the floor, which is why this could be done at all: adding/altering a shared
      TRDD field is a schema change needing janitor coordination at a `manager` floor, whereas a
      repo-local consumer of an existing field is floor `none`. Shipped as `yarn trdd:extrefs`
      (`scripts/trdd-extrefs.mjs`), with a non-vacuity guard and 3 subprocess tests; neutering the
      guard reds 2 of 3.
- [x] Whichever is taken, the mechanism can answer "is every externally-cited blocker on this board
      still open?" **without a human reading prose**.
      **⏹ Yes, for the FRONTMATTER surface.** `yarn trdd:extrefs` → 45 open cards, 70 resolvable
      refs across 14 repos, **0 unresolved, 0 query failures**, and **17 cards citing ONLY closed
      issues**. Exit trichotomy 0/1/2, so a blind run cannot render as a clean board. Bare
      (`janitor#167`, 19 of them) and naked (`#46`) shapes are COUNTED and REPORTED, never guessed
      — `#46` resolves in 4 of 6 known trackers, so any mapping invents an attribution.

> **⚠ SCOPE OF WHAT LANDED — the two mechanisms measure DIFFERENT SURFACES, and boxes 4-5 below
> are the half that did NOT land.** `trdd-extrefs` reads the `external-refs:` **frontmatter line**
> (anchored at line start, so a body that merely DISCUSSES an issue is a mention, not a citation).
> `scripts_dev/sweep-external-blockers.sh` greps the card **BODY** for prose claims —
> `(blocked|waiting|gated|pending) (on|by) …#N` — which is a different question about a different
> surface. Re-run 2026-08-21: the sweep exits **1** with `0 OPEN, 1 CLOSED, 5 unresolved`, every
> unresolved one a naked prose ref (`#46`, `#35`, `#37`, `#100`, `#103`).
>
> So `trdd-extrefs` reporting `naked-refs=0` is **honest, not blind**: no card's `external-refs:`
> line contains a naked number. It does not and cannot make the sweep exit 0, because the sweep is
> not measuring frontmatter. Box 1 offered "field, detector, **or both**" — the answer is BOTH
> DETECTORS, and only the frontmatter one exists. **Whoever takes boxes 4-5 is building the prose
> detector**, which is also where the dated-verification mode (box 5) lives: a card asserting
> *"re-verified 2026-08-06"* in prose is a claim with a silent timestamp, and no frontmatter reader
> can see it.
- [ ] The 4 cards corrected on 2026-08-21 (`903B7A20` ×2, `5YRLA53W`, plus `KCRMSNL7` / `SCLSRS6E`
      handed to the hub as out-of-lane) are re-checked under the new mechanism and it finds them.
- [ ] `bash scripts_dev/sweep-external-blockers.sh` exits **0** after the mechanism lands. A second
      run still scoring ~75% closed means the mechanism did not work.
      **⏹ 2026-08-21T23:3x — 6 findings → 3, and the two that CLEARED were a false positive and a
      concealment, not a fix.** Progress, not closure; exit is now **1** (was 1, via 2), and the
      convention is `closed>0 ⇒ 1`, `unresolved>0 ⇒ 2`, so 0 needs BOTH empty.
      1. **A false positive was removed from the SWEEP.** Its strike-stripping was line-wise
         (`sed 's/~~[^~]*~~//g'`) and its own `ponytail:` note admitted the ceiling. `SCLSRS6E`
         struck its dead claim across **lines 308-310** and added a `>` note explaining the
         correction — doing exactly what this card's phrasing guidance says — and was reported
         anyway. Fixed to `perl -0777 -pe 's/~~.*?~~//gs'` (slurped, non-greedy so two struck
         spans on one line are not merged). Positive-controlled: a seeded live "blocked on
         Emasoft/ai-maestro#1" card is still found, so the fix did not blind it. **A linter that
         reddens on correct authoring is one that gets routed around** — which is the fate this
         sweep exists to avoid.
      2. **Two bare refs were qualified from each card's OWN frontmatter** (evidence, not a guess):
         `17K0SHDQ` `#46` → `ai-maestro#46`, `KCRMSNL7` `#100` →
         `Emasoft/ai-maestro-janitor#100`. **Both then resolved to CLOSED.** So the bare-number
         form was not merely unresolvable — it was *concealing two dead waits*, and this card's
         thesis has a named mechanism: ambiguity is how an external wait hides. Neither card's
         `updated:` was bumped; qualifying a ref makes the same claim machine-checkable and
         changes no fact (a mechanical repair must not reorder the board).
      **Remaining for box 4:** 3 bare refs still unresolvable WITHOUT GUESSING — `903B7A20` `#35`
      and `#37` (resolve in 5 of 6 known trackers), `U9UNWXMV` `#103` (3 of 6) — plus the two
      now-revealed stale waits, which need a card-level judgment (is that card actually unblocked
      now?) and not linter-appeasement.
      **Also note, because it affects who can ever close this box:** `scripts_dev/` is gitignored
      (`.gitignore:123`), so this box's named acceptance instrument is not shareable and dies with
      the working copy. A backup of the pre-fix script is at
      `reports/colony/sweep-external-blockers.sh.bak-20260821`.
      **⏹ 2026-08-21T23:4x — NOW `0 OPEN, 0 CLOSED, 3 unresolved` (exit 2), AND EVERY "CLOSED"
      FINDING TONIGHT TURNED OUT TO BE A FALSE POSITIVE.** Not one card was asserting a live dead
      wait. Three detector defects, all the same family — *the needle cannot tell an ASSERTED wait
      from a DISCUSSED or DENIED one*:
      1. **multi-line strike** (fixed above) — `SCLSRS6E`;
      2. **negation blindness** — `(blocked|waiting|gated|pending) (on|by)` matched
         `17K0SHDQ`'s *"a feature nobody is blocked on"* and `KCRMSNL7`'s *"unblocked by reading
         the janitor SOURCE instead of waiting on"* the janitor coordination issue. Both say the
         OPPOSITE of a wait. Fixed by stripping negated spans (`nobody|not|never|no longer|instead
         of|without|rather than` within 40 chars of the blocking verb) BEFORE extraction;
      3. **the negation filter had the multi-line bug too** — `KCRMSNL7`'s *"instead of"* ends one
         line and *"waiting on …#100"* begins the next, so a line-wise `perl -pe` could not see
         it. I shipped the identical defect I had just fixed one stage upstream, and only the
         re-run caught it. Fixed with `-0777 …/gis`.
      **Controlled, not assumed:** a seeded probe card asserting a plain wait on a real issue is
      still caught, while a second, line-wrapped, negated wait in the same probe is skipped — so
      the fixes removed false positives without blinding the detector. (The probe's literal text
      is deliberately NOT quoted here. This very note demonstrated why: an earlier draft quoted
      both example phrases verbatim, and the sweep then reported **this card** as holding two live
      waits. The detector caught its own author — the same use-vs-mention trap the card documents,
      arriving through the documentation OF the fix. Describe the shape; never paste it.)
      **This puts a question mark on this card's own headline measurement.** The Problem section
      claims *"9 of 12 CLOSED (75%)"* for the prose surface. That figure was produced by a
      detector that counted negated and struck prose as live waits. Some of the 12 were genuinely
      corrected since (box 3's four cards), so the delta cannot be attributed cleanly here — but
      **75% is an upper bound, not a measurement**, and whoever closes this card should re-derive
      it with the fixed sweep rather than cite the number.
      **The fixed script is UNCOMMITTABLE** — `scripts_dev/` AND `reports/` are both gitignored, so
      the fix exists only on this disk (`reports/colony/sweep-external-blockers.sh.fixed-20260821`).
      Closing box 4 therefore requires promoting the sweep into tracked `scripts/` first. Not done
      unilaterally: this box names the `scripts_dev/` path, so moving it changes the card's own
      acceptance and is the next owner's call, not a 23:45 side effect.
- [ ] The dated-verification failure mode is addressed explicitly, not just the bare-citation one.

## Verification — **the re-run IS the acceptance check**

```bash
bash scripts_dev/sweep-external-blockers.sh          # read-only; no CLI verb, no card writes
```

`scripts_dev/` is gitignored, so the script is a local instrument, not a shipped artifact. It emits
one line per cited blocker — `card | owner/repo#N | OPEN|CLOSED|AMBIGUOUS|UNKNOWN-REPO|MISSING` —
and exits **0** when every cited blocker is open, **1** when any is CLOSED (a card holds a dead
claim), **2** when something could not be resolved and nothing is closed.

**A snapshot is what rotted in the first place, so the finding is not allowed to be one.** The
2026-08-21 manual sweep scored 9 of 12 closed; that number is already history. What the card asserts
going forward is the script's exit code, not a figure in a report.

Run of 2026-08-21T17:0x, after the in-lane corrections landed: **1 CLOSED, 5 unresolved, exit 1.**
The one remaining live dead claim is `SCLSRS6E` → `ai-maestro#55` (hub-owned, out of the
ORCHESTRATOR's lane).

### The `AMBIGUOUS` bucket is the sharper half of the evidence

All 5 unresolved are a bare `#N` with no repo. The script reports them as `AMBIGUOUS` rather than
guessing, and then counts how many known trackers the number actually resolves in:

| card | ref | resolves in |
|---|---|---|
| `903B7A20` | `#35` | **5 of 6** |
| `903B7A20` | `#37` | **5 of 6** |
| `17K0SHDQ` | `#46` | **4 of 6** |
| `KCRMSNL7` | `#100` | **3 of 6** |
| `U9UNWXMV` | `#103` | **3 of 6** |

**Not one of them resolves in exactly one tracker.** And this is not a frequency observation that
better luck could improve — it is structural: `CLAUDE.md` records that this project spans **two
remotes on purpose** (`origin` = `23blocks-OS/ai-maestro` upstream, `fork` = `Emasoft/ai-maestro`),
so for a hub card a bare `#N` is **ambiguous by construction, always, ≥2 by layout**. `gh issue
view` also resolves PRs, so `#N` does not even separate issue from PR inside a single repo.

**The instance that proves guessing would be worse than not knowing** (surfaced by the plugin
session, resolved by the hub, verified here 2026-08-21): the same bare `#63` is a **MERGED PR** in
`23blocks-OS/ai-maestro` ("fix: Add migration support for legacy 'local' host ID") and an **OPEN**
launch issue in `Emasoft/ai-maestro` ("[LAUNCH] MANAGER needs the launch plan … go/no-go gates").
A sweep that picked a repo would have returned **the exact opposite of the truth**, in either
direction. A human reader has no more information than the script does. Reporting `AMBIGUOUS` is not
caution — it is the only correct answer available, and no amount of parsing changes that.

**The script is NARROWER than the manual sweep that produced the 9-of-12 figure, and the two must
not be conflated.** The manual pass followed refs a human judged to be blockers, wherever they sat;
the script only matches a ref sitting on a line with blocking phrasing. It therefore resolves 6 refs
where the manual pass resolved 12, and its `0 OPEN` means *"no blocking-phrased line cites an open
issue"* — **not** *"no external wait is live"*. `ai-maestro#121`, `#90` and `#76` are cited as real
constraints by `T3FXA0Y0`, `5CIL7A07` and `IBKR7F74` and are genuinely OPEN; the script does not see
them, because those cards state the dependency in prose it cannot recognise. That gap is not a bug
to file against the script — **the instrument reproducing the defect it was built to measure is the
card's evidence, not its bug** — and it is the strongest argument for a real field over better
parsing.

**Do not widen the needle.** A wider match buys a few more refs and pays in false positives, and
every step of that trade is itself the argument for the field: you cannot parse your way to a
dependency graph out of prose, because prose has no schema and no namespace. The `AMBIGUOUS` bucket
below proves the namespace half independently.

### A correction must be marked in a form the checker can see

The sweep's first run reported the two cards whose dead claims had **just been corrected** — because
a good correction *quotes the dead claim on purpose* (the wrong claim's shape is the evidence), which
makes the correction **indistinguishable from the defect to a text matcher**. The requirement that
produced the correct behaviour also manufactured the false positive.

Skipping `~~struck~~` spans and `>` blockquotes is the fix, and it is really a **contract with two
halves that must be stated together**:

> **QUOTE the dead claim** — so the record stays honest and the wrong claim's shape survives as
> evidence — **AND MARK it, at EVERY site where it is asserted** — so neither a checker nor a human
> reads it as live.

Quote-without-mark leaves the falsehood live. Mark-without-quote destroys the evidence. Requiring
only the first half is what manufactured this sweep's false positive.

**"At every site" is the half that gets skipped, and it is the expensive one.** Two independent
instances in one day, from two different sessions:

1. **The sweep re-reported cards that were already corrected** — correction present, mark absent.
2. **A correction was filed at the FOOT of a 340-line card while the disproved claim stayed
   unmarked in the card's STATE block.** Per TRDD rule 10 the STATE block is *authoritative and read
   FIRST on resume*, so the correction was **silently outranked by the very claim it disproved**: a
   human resuming that card reads the false version and stops there, having never reached the
   disproof 230 lines below. **A correction filed at the bottom of a long card does not correct the
   card.** Put the disproof inline at each assertion site, not a pointer to where it lives.

**And a strike does not propagate to the sentence it licensed.** Measured on `SCLSRS6E` after that
repair: the premise (*"`get_auth_args` emits only the AID bearer"*) was struck at line 304, while
the conclusion it supported — *"fleet-wide arm (`janitor#77`) is therefore **blocked on
`ai-maestro#55`**"* — stands unmarked four lines later and still reports as a live external wait.
The word doing the work is **"therefore"**: an argument's premise and its conclusion are two
assertion sites, and striking the first does not touch the second. When you strike a premise, follow
its inferences.

This generalises past this script — it is a standing hazard for every honest checker in this repo.
**A permanent false positive is how a check dies:** people route around a linter that cries about
work they have already done.

### The worst case: a stale blocker whose CATEGORY is wrong

A stale blocker wastes the time between the closure and the re-check. **A stale blocker filed under
the wrong CATEGORY is worse, because even re-checking the right question returns the wrong answer.**

Measured on this board, 2026-08-21, and it is the reason this card's own author sat parked for
nineteen days. Four cards across two repos plus a closed issue all recorded the CLI's host-wide 401
as *"the script layer has no USER auth path"* — a **missing capability**. Verified first-hand
against the copy that actually runs (`~/.local/share/aimaestro/shell-helpers/common.sh`, dated
2026-08-19, `cmp`-identical to the repo): `get_auth_args` falls back from the AID bearer to a
`Cookie: aim_session=$tok` header, and `aimaestro-governance.sh --help` cites `ai-maestro#55` as the
origin of its own `login` verb. The capability **shipped**. What is missing is
`~/.aimaestro/cli-session` — it does not exist on this host, `get_session_token` returns empty,
`get_auth_args` emits **no auth header at all**, and every verb 401s including read-only `search`.

It was a **missing credential**, and it had been for the whole nineteen days.

The category error is what made it durable. Nobody re-reads a solved problem, so *"the feature does
not exist"* is a claim that stops being questioned the moment the feature ships — while
`stateReason: COMPLETED` sat visible on #55 the entire time. A sweep of the kind this card proposes
would have flagged #55 as CLOSED, but a reader who then asked *"has the capability shipped?"* would
still not have found the answer, because that was never the question. **Any mechanism here must
report the closure as a prompt to re-derive the blocker, not to re-confirm the old one.**

### Three ways prose-cited state rots (the third was found by accident)

1. **The blocker closes** and nothing re-checks the prose — 9 of 12, the original finding.
2. **The citation cannot be resolved at all** — bare `#N`, ambiguous by layout, above.
3. **The citing card moves out from under the reader.** `8KDIB2LT` appeared as a hit on one run and
   was gone at that path on the next; the hub had archived it minutes earlier. A sweep over a live
   corpus can report a card that no longer exists where it looked — so a stale *result* is a third
   rot mode, distinct from a stale claim.

Known limits, stated so a later reader does not mistake a clean run for proof:
- Only lines with blocking phrasing ("blocked/waiting/gated/pending on|by") near a ref are checked.
  A wait phrased any other way is invisible to it — the same prose-parsing weakness the card is about.
- `~~struck~~` spans and `>` blockquotes are skipped, so corrected claims stop re-reporting.
- Unmapped shorthands are reported, never guessed; extend `repo_for()` when a new one appears.
- Sweeping **zero** refs exits 2, not 0 — a typo'd path used to read as "clean". Same family as the
  vacuous completion gate: `ERROR` vs `no findings` vs `could not run` must never collapse into one
  exit code. **Every gate in this repo deserves auditing for that collapse.**

## Out of scope

The 3 `dev` cards naming dead pseudo-identities (hub-queued, separate). `GIONLYAF`'s boxlessness
(mid-correction, in the owner's decision queue — do not add boxes to a card whose scope is under
revision). The disk/`alcore` host signal (hub owns the escalation).

## Approval log

- 2026-08-21T16:46:00+0200 — Filed at `column: todo` under Tier-0 authority, on explicit hub
  instruction (ai-maestro-e7). No CLI verb invoked; `aimaestro-trdd.sh` remains 401 host-wide.
