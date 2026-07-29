---
trdd-id: 8KDIB2LT
title: Propagate the new pillar CLI contract to every consumer and document
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T01:39:53+0200
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

**Revised order of work:** (a) write the pillar-CLI section in `docs/SCRIPT-LAYER.md` plus a CLAUDE.md
pointer, stating the exit trichotomy (`0` clean · `1` findings · `2` could-not-run) and `--design-dir`
/ `--no-index`; (b) record the distribution decision (box 3) — today no `*.mjs` is copied to
`~/.local/bin`, and copying one means carrying the Node-22 wrapper, so "repo-local, and here is why" is
the likely answer and needs writing down either way; (c) re-sweep for box 4 with several phrasings;
(d) leave the `prrdgrep`/`specsgrep` naming for when those tools exist.

## Acceptance

- [ ] Every document that states an exit-code meaning states the trichotomy
- [ ] `docs/SCRIPT-LAYER.md` and `CLAUDE.md` name `prrdgrep` and `specsgrep` with their subcommands
- [ ] The distribution decision is recorded explicitly — either "repo-local, and here is why" or
      "distributed, wrapper included"
- [ ] A grep for the old two-outcome wording returns nothing

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
