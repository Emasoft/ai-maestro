---
trdd-id: 8KDIB2LT
title: Propagate the new pillar CLI contract to every consumer and document
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T12:22:17+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# Propagate the new pillar CLI contract to every consumer and document

## The hole this handles

The parent changes the CLI contract in three ways at once:

1. **Exit codes become a trichotomy** — `0` clean · `1` findings · `2` the check could not run.
   Today `greptrdd validate` returns 0 or 1 only, and returns **0** when it read nothing.
2. **`--design-dir` exists**, so the tools stop being "must be run from the repo root".
3. **Two new commands exist** — `prrdgrep`, `specsgrep`.

Every one of those is a documented surface somebody or something reads.

## Verified starting position

Nothing in `.github/workflows/`, no git hook, and no `package.json` script branches on these exit
codes today — the only automated gate is the vitest test
`tests/unit/trdd-doctor.test.ts:436`. So this is a **documentation and consumer sweep, not a live
break** — which is exactly why it is easy to forget, and why it is an EHT rather than a footnote.

## What must be swept

- `scripts/aimaestro-trdd.sh` (387 lines) — the script-layer wrapper agents call
- `docs/SCRIPT-LAYER.md` — the canonical per-subcommand reference
- `CLAUDE.md` — the pillar-tooling section
- `package.json` scripts (add `prrdgrep` / `specsgrep` / `pillars:lint` alongside `greptrdd`)
- the `install-messaging.sh` distribution decision: today **no `*.mjs` is copied to
  `~/.local/bin`** and the pillar CLIs are repo-local. If that changes, each copied CLI must carry
  the Node-22 wrapper, because `better-sqlite3` is native and hard-caps at Node 25
- any skill or agent definition that tells a reader "exit 0 means clean"

## MEASURED 2026-07-30, before building anything — the scope is not what the boxes assume

Measured after `4VCXRHAY` and `YN8EQWYP` each turned out to have boxes whose premise was wrong. Same
discipline here, and it pays again:

**Box 1's set may be EMPTY, for a reason worse than "already done".** Grepping every file under
`docs/`, `CLAUDE.md`, `.claude/` and `scripts/*.sh` that mentions `greptrdd` / `trdd-doctor` /
`pillars:lint` returns exactly three, none of them a user-facing contract document:

| file | what it is |
|---|---|
| `docs/GOVERNANCE-ENFORCEMENT-MAP.md` | cites the tools as guards; does not document their CLI |
| `.claude/rules/lessons-verification.md` | lessons, not a contract |
| `.claude/project/memory/pillar-tooling-scale-and-index.md` | memory, not a contract |

**`docs/SCRIPT-LAYER.md` does not mention them at all, and neither does `CLAUDE.md`.** So there is no
document stating an exit-code meaning to CORRECT — the real gap is that the pillar CLIs are
undocumented in the script layer entirely. That is a bigger and more useful job than the box implies,
and it splits box 2: the `prrdgrep`/`specsgrep` half stays gated on those tools existing (Phase 3,
transitively on the user-held `Q3GZJI1X`), but **`greptrdd` EXISTS and is undocumented, so its half is
doable now.**

**Box 4 is NOT yet verifiable as satisfied.** One sweep for old two-outcome phrasing (`exits 0 …
otherwise/non-zero`, `non-zero if/when/on`, scoped to lines naming these tools) returned nothing. That
is ONE regex, and a DOESN'T-EXIST claim from a single pattern is exactly the shape that has been wrong
here before — re-run with alternate phrasings ("fails with", "returns 1", "success/failure") before
ticking it.

The word "trichotomy" appears only inside `.claude/chat_history/` exports — transcript noise, not
documentation.

### Box 4 RE-SWEPT and SATISFIED — but vacuously, and the sweep found something else

Eight phrasings (`exits? 0`, `returns? 1`, `exit code`, `non-?zero`, `success/failure`, `fails with`,
`0 on success`, `1 on failure|error`) across `docs/SCRIPT-LAYER.md`, `CLAUDE.md`,
`docs/GOVERNANCE-ENFORCEMENT-MAP.md` and the memory page, filtered to lines naming these tools.
**Positive control first** (the same patterns match 5 lines of `pillar-cli-exit-codes.test.ts`, so
they are live and not silently broken). Result: seven patterns return zero, and `exits? 0` returns
two — both in the MEMORY page and both MEASUREMENT records (`exit 0, 2.43 GB, 22.6 s`), not
exit-code contract statements.

So box 4 holds — **for the reason that makes box 1 fail.** There is no stale two-outcome wording
because nothing documents these tools' exit codes at all. Ticking it as though a cleanup happened
would misreport that.

### ⚠ FOUND WHILE SWEEPING — the script layer ALREADY has a 1/2 convention, and it is INVERTED

`scripts/aimaestro-trdd.sh:200-206` documents its own three-code contract for `verify`:

> **EXITS NON-ZERO WHEN THE APPROVAL DOES NOT VERIFY (2 = INVALID, distinct from 1 = ERROR).**

Against the pillar CLIs' trichotomy (`1` = findings · `2` = could-not-run) the two meanings are
**swapped**: in the wrapper, `2` is the substantive negative ANSWER and `1` is the tool FAILING; in
`greptrdd validate`, `1` is the substantive negative answer and `2` is the tool failing. An agent that
learns one from the script layer and then reads the other has two contradictory contracts on the same
surface, and nothing anywhere says so.

The wrapper also *teaches* an idiom that erases the distinction —
`aimaestro-trdd.sh verify "$CARD" || { echo "unverified — refusing"; exit 1; }`. That is correct for
`verify` (both non-zero codes mean "do not proceed"), but copied onto `greptrdd validate` it collapses
"found findings" into "could not run", which is exactly the conflation the trichotomy exists to
prevent — and `||` is the obvious thing to copy.

**This converts box 1 from prose into a DECISION**: document the trichotomy *and* reconcile it with the
wrapper's existing inverted convention (renumber one, or state both explicitly and warn against `||`).
Do not write the SCRIPT-LAYER.md section until that is chosen, or the canonical reference will document
two conflicting meanings for `2`.

**Revised order of work:** (a) write the pillar-CLI section in `docs/SCRIPT-LAYER.md` plus a CLAUDE.md
pointer, stating the exit trichotomy (`0` clean · `1` findings · `2` could-not-run) and `--design-dir`
/ `--no-index`; (b) record the distribution decision (box 3) — today no `*.mjs` is copied to
`~/.local/bin`, and copying one means carrying the Node-22 wrapper, so "repo-local, and here is why" is
the likely answer and needs writing down either way; (c) re-sweep for box 4 with several phrasings;
(d) leave the `prrdgrep`/`specsgrep` naming for when those tools exist.

### DECISION 2026-07-30 — document both; the trichotomy is canon, the wrapper's `verify` is a NAMED exception

Neither side is renumbered. Measured, not preferred:

| fact | measurement |
|---|---|
| **`grep`'s own convention is the trichotomy** | run directly: match → `0`, no match → `1`, unreadable path → `2`. The pillar CLIs match it EXACTLY, and `greptrdd` is a grep-shaped tool |
| **the trichotomy is already PINNED** | `tests/unit/pillar-cli-exit-codes.test.ts` carries 12 exit-code assertions |
| **the pillar CLIs are repo-local** | no `*.mjs` on `~/.local/bin`; `install-messaging.sh` names none of them. So they are the *cheap* side to change — and the side that is already right |
| **the wrapper is the EXTERNAL contract** | `scripts/aimaestro-trdd.sh` is the decoupling layer plugins consume. It has NO in-repo caller that branches on its code — every in-repo mention is prose — so its only consumers live in repos I cannot grep |
| **the SPEC pins only "non-zero"** | `governance-spec.md` `R41.enf-verify`: "`verify` exits **non-zero** when the approval does not verify". The `2 = INVALID / 1 = ERROR` split lives ONLY in the script's own header comment — the spec is satisfied under either numbering |

So the wrapper is the one inverted against the universal convention, and its spec would *permit*
renumbering. **Rejected anyway**, because the breaking case is exactly the one I cannot audit: a
consumer doing `[ $? -eq 2 ]` in a repo outside this one. `||` consumers are unaffected (both codes are
non-zero), and `||` is the idiom the wrapper itself teaches — but "probably nobody branches on 2" is an
assumption, and a zero-risk option exists. Revisit only if auditing external consumers becomes possible.

**What gets written, then:**

1. The trichotomy (`0` clean · `1` findings · `2` could-not-run) is the **canonical convention for every
   pillar CLI and every new surface** — it is grep's, so a reader already knows it.
2. `aimaestro-trdd.sh verify` is documented as the **one grandfathered exception** (`2` = INVALID,
   `1` = ERROR), *named as an exception with its reason*, not as a second convention. One legacy oddity a
   reader is warned about beats two live conventions a reader must guess between.
3. An explicit warning that **`cmd || { … }` collapses `1` and `2`**. It is correct for `verify` (both
   non-zero mean "do not proceed") and WRONG for `greptrdd validate`, where it turns "could not run"
   into "found findings" — the exact conflation the trichotomy exists to prevent, and `||` is the
   obvious thing to copy across from the wrapper.

## Acceptance

- [x] Every document that states an exit-code meaning states the trichotomy — **all three now do**:
      `docs/SCRIPT-LAYER.md` (new "The pillar CLIs" section: the trichotomy, `grep`-verified, plus the
      `||` warning), `CLAUDE.md` (a tight pointer — it is injected every turn), and
      `scripts/aimaestro-trdd.sh` itself, whose header now names its own numbering as the
      grandfathered EXCEPTION and states the canon beside it. That last one is the load-bearing edit:
      a reader of the script alone previously learned the inverted rule in isolation
- [ ] `docs/SCRIPT-LAYER.md` and `CLAUDE.md` name `prrdgrep` and `specgrep` with their subcommands —
      **still open, but no longer GATED on a decision**: `Q3GZJI1X` closed 2026-07-30 (janitor#144
      filed), so this is now plain Phase-3 build work — the two tools do not exist yet. The docs
      deliberately say so rather than describing them: a name is installed only when its `.mjs`
      exists, because an agent that finds a tool and gets an error cannot tell *planned* from
      *broken*. **Note the spelling: `specgrep`, not `specsgrep`** — the USER's naming law
      (2026-07-30) is `<document type>grep`.
- [x] ~~The distribution decision is recorded explicitly — **"repo-local, and here is why"**~~
      **SUPERSEDED 2026-07-30 by USER mandate (TRDD-217AYEOT). Do not restore it.** The recorded
      reasoning was internally sound and still wrong, which is why the section that replaced it keeps
      the CAUSE and not just the conclusion: the janitor's Claude reported *"no access to the trddgrep
      tool at all"* while the file sat in this repo. A 3-pillar system every agent is governed by,
      whose tools only one repo can run, is a governance corpus nobody can query. Two independent
      causes had to be fixed — not distributed (the installer globs `scripts/*.sh`, these are `*.mjs`)
      AND not guessable (the tool was named `greptrdd`, the two words backwards).
      The Node-22 objection quoted above was REAL and is now HANDLED rather than avoided:
      `scripts/pillar-cli` sources `scripts/pin-node.sh` (which version-CHECKS each candidate and
      FAILS rather than falling back) and loads tsx by ABSOLUTE path with `TSX_TSCONFIG_PATH` pinned,
      because both `--import tsx` and tsx's tsconfig discovery resolve against the CWD. The
      "not an API surface" half SURVIVES unchanged and is still recorded: these are developer/agent
      tools over a git-tracked corpus; the API-facing verbs remain `aimaestro-trdd.sh`.
- [x] A grep for the old two-outcome wording returns nothing — **8 phrasings, positive-controlled;
      SATISFIED but VACUOUSLY**, because nothing documents these tools' exit codes at all. The sweep's
      real yield is the inverted `1`/`2` convention in `scripts/aimaestro-trdd.sh:200-206`, recorded
      above, which box 1 must now resolve before any prose is written

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
