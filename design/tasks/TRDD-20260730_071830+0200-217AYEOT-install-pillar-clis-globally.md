---
trdd-id: 217AYEOT
title: The pillar CLIs are invisible to every agent outside this repo
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-30T07:18:30+0200
updated: 2026-07-30T07:18:30+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-30T07:18:30+0200
relevant-rules: [R25]
parent-trdd: L55IYKL4
derived: true
derived-kind: eht
blocked-by: []
npt: []
eht: []
labels: [pillar, script-layer, distribution, cross-project]
---

# The pillar CLIs are invisible to every agent outside this repo

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30T07:18

**USER MANDATE, 2026-07-30, relayed verbatim:** the janitor Claude reported it *"has no access to
the trddgrep at all"*, and the USER answered it —

> *"what? you don't have the trddgrep tool? notify immediately the ai-maestro claude, and ask it to
> make the tool available to all projects/agents, even non ai-maestro ones. the way ai-maestro
> install its scripts can be used."*

This **overrides** the recorded "repo-local, and here is why" decision in `TRDD-8KDIB2LT` and the
plan's out-of-scope list. Both are superseded by this card; do not re-litigate them.

**NEXT ACTION:** add `scripts/trddgrep.sh` (a `.sh` wrapper), which the installer's EXISTING
`scripts/*.sh` glob picks up with no installer edit.

### Why it was invisible — measured, not assumed (2026-07-30)

| fact | evidence |
|---|---|
| the installer copies `amp-*.sh` then `*.sh` | `install-messaging.sh:630`, `:755` |
| the pillar CLIs are `greptrdd.mjs` / `trdd-doctor.mjs` / `pillars-lint.mjs` | `ls scripts/` |
| so **zero** `.mjs` files exist in `~/.local/bin` | counted: 0 |
| `aimaestro-trdd.sh` IS installed | but it is the **API**-backed tool: it needs a live server, and `docs/SCRIPT-LAYER.md` records that its write verbs 403 for an agent caller |

So this was never a policy decision at the distribution layer — **a glob that cannot see `.mjs`**,
on top of a deliberate choice not to ship the Node-22 wrapper. The janitor therefore holds a TRDD
tool that asks ai-maestro's SERVER about ai-maestro's CORPUS, and lacks the corpus-local linter that
works on any `design/` folder — which is precisely what an agent auditing its OWN repo needs.

### The three real constraints the wrapper must satisfy

1. **Node 22.** `better-sqlite3` (the pillar index) is native and hard-caps at Node 25; the repo's
   `engines` is `>=22 <26` and yarn enforces it BEFORE any script runs. A global caller's default
   `node` may be 26. `scripts/pin-node.sh` already version-CHECKS each candidate binary (the brew
   `node@23/24/25` kegs on some machines are mislabelled and actually report v26) and FAILS FAST
   rather than falling back — reuse it, never re-derive the selection.
2. **The repo's `node_modules`.** `tsx` + `better-sqlite3` + `gray-matter` come from this install,
   so the wrapper must locate the ai-maestro tree and run the `.mjs` from there.
3. **THE CORRECTNESS POINT — it must lint the CALLER's corpus, never ai-maestro's.** A global
   `trddgrep` that resolved `design/` relative to the ai-maestro install would report ai-maestro's
   corpus to every other project, i.e. answer a question about a corpus the caller never named. That
   is the exact shape of the bug the exit trichotomy exists to prevent ("a gate that passes because
   it read nothing"), inverted into "a gate that passes because it read someone ELSE's corpus".
   Default `--design-dir` to the CALLER's `$PWD/design`, and let the existing exit `2` fire when the
   caller has no corpus.

### The crux: how the installed wrapper FINDS this install (do not hardcode `~/ai-maestro`)

`CLAUDE.md`'s install-location-independence note is explicit: when ai-maestro ships as a package
**there is no `~/ai-maestro`** — only `~/.aimaestro/` and `~/agents/` stay at fixed home paths. So a
wrapper that hardcodes the dev-repo path works on this machine and nowhere else.

The installer already establishes the right convention: `install-messaging.sh:780` writes
`~/.local/share/aimaestro/shell-helpers/`. So:

- the installer records its own source tree once (e.g. `~/.local/share/aimaestro/install-root`,
  written from the installer's own `$SCRIPT_DIR` — the one place that provably knows it);
- `trddgrep.sh` reads that file, `source`s `<root>/scripts/pin-node.sh` for the Node selection, and
  `exec`s `node --import tsx <root>/scripts/greptrdd.mjs "$@"`;
- a missing/stale root file is an explicit refusal naming the file and the fix, never a fallback
  guess at a path.

Shape (the wrapper is deliberately thin — the tool stays ONE implementation, invoked from elsewhere):

```bash
#!/bin/bash
set -euo pipefail
ROOT_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/aimaestro/install-root"
[ -r "$ROOT_FILE" ] || { echo "trddgrep: no ai-maestro install recorded at $ROOT_FILE — re-run install-messaging.sh" >&2; exit 2; }
AIM_ROOT="$(cat "$ROOT_FILE")"
[ -f "$AIM_ROOT/scripts/greptrdd.mjs" ] || { echo "trddgrep: recorded install root $AIM_ROOT is stale" >&2; exit 2; }
CALLER_DESIGN="$PWD/design"        # the CALLER's corpus — never the install's
source "$AIM_ROOT/scripts/pin-node.sh" || exit 2
case " $* " in *" --design-dir "*) exec node --import tsx "$AIM_ROOT/scripts/greptrdd.mjs" "$@" ;; esac
exec node --import tsx "$AIM_ROOT/scripts/greptrdd.mjs" "$@" --design-dir "$CALLER_DESIGN"
```

Note the refusals exit **2**, matching the trichotomy: "I could not run" is not "I found nothing".
A second wrapper (`trdd-doctor.sh`) is the same shim with one filename changed; keep the shared part
in one helper rather than copy-pasting a third time.

### Explicitly NOT in scope

- `prrdgrep` / `specsgrep` — they do not exist yet (Phase 3, gated on `Q3GZJI1X`). The wrapper ships
  for the tools that exist; `8KDIB2LT`'s remaining box still tracks naming those two in the docs.
- Vendoring `better-sqlite3` or shipping a standalone binary. The wrapper delegates to this install;
  a caller with no ai-maestro install gets a clear refusal, not a silent walk.

## Acceptance

- [ ] `scripts/trddgrep.sh` exists and is picked up by the installer's EXISTING `*.sh` glob — proven
      by a test that reads `install-messaging.sh`'s globs, not by re-running the installer
- [ ] invoked from a DIFFERENT project's directory it lints THAT project's `design/`, proven by a
      test that seeds a corpus in a tmp dir, runs the wrapper with that dir as cwd, and asserts the
      seeded card's id appears in the output
- [ ] invoked from a directory with NO `design/` it exits **2** (could-not-run), never 0
- [ ] it selects Node 22 through `scripts/pin-node.sh` rather than re-deriving the selection, and
      refuses with a named error when no conforming Node exists
- [ ] a caller with no ai-maestro install gets an explicit refusal naming what is missing
- [ ] `docs/SCRIPT-LAYER.md` records the new wrapper AND supersedes the "repo-local, and here is
      why" paragraph (the decision it documents is now reversed by USER mandate)
- [ ] a recorded **neuter run** per guard (break it, watch the NAMED test fail; read the test COUNT,
      never the exit code)
- [ ] full suite green

## Notes and lessons learned

- The USER's phrase *"the way ai-maestro install its scripts can be used"* is load-bearing and
  already true: because `install-messaging.sh` globs `scripts/*.sh`, a NEW `.sh` file needs **no
  installer change at all**. The cheapest correct fix is a shim with the right extension, not a new
  distribution mechanism.

## Approval log

- 2026-07-30T07:18:30+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Relayed verbatim in the STATE block. Supersedes TRDD-8KDIB2LT's recorded repo-local decision.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
