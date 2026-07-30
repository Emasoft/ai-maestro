---
trdd-id: 217AYEOT
title: The pillar CLIs are misnamed and invisible to every agent outside this repo
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-30T07:18:30+0200
updated: 2026-07-30T12:07:54+0200
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
labels: [pillar, script-layer, distribution, cross-project, naming]
---

# The pillar CLIs are misnamed and invisible to every agent outside this repo

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30T07:32

**USER MANDATE, 2026-07-30, in two parts, relayed verbatim.** First the janitor Claude reported it
*"has no access to the trddgrep at all"*, and the USER answered it —

> *"what? you don't have the trddgrep tool? notify immediately the ai-maestro claude, and ask it to
> make the tool available to all projects/agents, even non ai-maestro ones. the way ai-maestro
> install its scripts can be used."*

then, revising the first cut of this card —

> *"the trddgrep tool must be only one and named trddgrep. It must detect if the current project
> folder it is in is a project outside of ai-maestro or an agent part of ai-maestro by itself, and
> enabling the additional functionalities accordingly. the 3-pillar system must work in any case,
> and the tools (trddgrep, prrdgrep and specgrep) must be available to all agents. the tools
> themselves must detect the environment. but they must be installed where everyone can reach for
> them. see what you can do about this, and coordinates with the other plugins. don't create
> multiple versions of the tools, it will just confuse the user and the agents."*

and finally the naming law —

> *"all names must be in the form of `<document type>grep`. So memgrep, trddgrep, prrdgrep,
> specgrep."*

This **overrides** the recorded "repo-local, and here is why" decision in `TRDD-8KDIB2LT` and the
plan's out-of-scope list, and it **supersedes this card's own first cut** (a `trddgrep.sh` shim
wrapping `greptrdd.mjs`, plus a second `trdd-doctor.sh`) — that shape violated *"only one"* three
ways. Do not re-litigate any of it.

**NEXT ACTION:** Phase 4 — add the `env` verb to `scripts/trddgrep.mjs` (print the resolved mode +
reason) and the `doctor`/`fix`/`board` subcommands delegating to `lib/trdd-doctor.ts`; then the
end-to-end zero-writes test (`trddgrep env` under a fake `$HOME`), which is the one acceptance box
no unit test can carry — see the note under it.

**DONE so far (commits `84be70dd`, `6fb580bc`, `2d241d3d`, `79845e28`):**

| phase | state |
|---|---|
| 1 · rename `greptrdd` → `trddgrep` | **done** — 6 load-bearing sites; 57 tests green. 10 prose/comment mentions remain (Phase 5), and `design/archived/` stays frozen |
| 2 · `lib/pillar/environment.ts` | **done** — 12 tests, 4 neuter runs recorded |
| 3 · `scripts/pillar-cli` + installer step | **done** — 6 tests; verified end-to-end from a foreign project |
| 4 · `env` verb + doctor subcommands | **NEXT** |
| 5 · docs, prose sweep, coordination issues | pending |

**Four things were MEASURED here that a reader must not re-derive from reasoning:**

1. `--import tsx` resolves the bare specifier against the **CWD** — from a caller's project it dies
   `Cannot find package 'tsx'`. The launcher passes tsx's entry by absolute path.
2. tsx discovers `tsconfig.json` from the **CWD** too, so `@/lib/...` inside `lib/*.ts` went
   unresolved (`MODULE_NOT_FOUND` from `lib/trdd-graph.ts`). Hence `TSX_TSCONFIG_PATH`. Both fixes
   exist to keep cwd = the CALLER's; running node from the install root would resolve everything for
   free and break `--design-dir` defaulting, detection, and every printed relative path.
3. **`pin-node.sh` must be sourced from BASH.** From zsh its version gate degrades silently: same
   tree, same minute — bash → `v22.23.1`, zsh → `v26.5.0`, past the `engines: <26` cap. The repo's
   pin is correct; a zsh `source` is not. The launcher is `#!/bin/bash` for this reason.
4. The `loadAgents()` write hazard is **real and reproduced** (subprocess, fake `$HOME`): the naive
   detector created `.aimaestro/` and `.aimaestro/agents/`; `resolvePillarEnvironment` created
   nothing.

### Why it was invisible — TWO independent causes, both measured (2026-07-30)

| fact | evidence |
|---|---|
| the installer copies `amp-*.sh` then the rest of `scripts/*.sh` | `install-messaging.sh:630`, `:744-765` — both globs are `.sh`-only |
| the pillar CLIs are `.mjs` | `ls scripts/` → `greptrdd.mjs`, `trdd-doctor.mjs`, `pillars-lint.mjs` |
| so **zero** `.mjs` files reach `~/.local/bin` | counted: 0 |
| **and nothing anywhere is NAMED `trddgrep`** | our tool is `greptrdd` — the two words are **backwards** |
| `memgrep` IS installed and on PATH | `command -v memgrep` → `~/.cargo/bin/memgrep` (the janitor's Rust memory-corpus tool) |
| `aimaestro-trdd.sh` IS installed | but it is the **API**-backed tool: it needs a live server, and `docs/SCRIPT-LAYER.md` records that its write verbs 403 for an agent caller |

The second cause is the one the first cut missed. `memgrep` is shipped, on PATH, and names the
convention; an agent that reasons *"memgrep exists for the memory corpus, so trddgrep exists for the
TRDD corpus"* is reasoning **exactly as the convention invites** — and finds nothing, because the
name does not exist in this repo, in `~/.local/bin`, or anywhere else. So even a perfectly
distributed `greptrdd` would have stayed unfindable. **The fix is a RENAME plus a distribution.** A
wrapper named `trddgrep` around `yarn greptrdd` would leave two names for one tool — precisely the
confusion the USER forbids.

### The three real constraints the launcher must satisfy

1. **Node 22.** `better-sqlite3` (the pillar index) is native and hard-caps at Node 25; the repo's
   `engines` is `>=22 <26` and yarn enforces it BEFORE any script runs. A global caller's default
   `node` may be 26. `scripts/pin-node.sh` already version-CHECKS each candidate binary (the brew
   `node@23/24/25` kegs on some machines are mislabelled and actually report v26) and FAILS FAST
   rather than falling back — reuse it, never re-derive the selection.
2. **The repo's `node_modules`.** `tsx` + `better-sqlite3` + `gray-matter` come from this install,
   so the launcher must locate the ai-maestro tree and run the `.mjs` from there.
3. **THE CORRECTNESS POINT — it must read the CALLER's corpus, never ai-maestro's.** A global
   `trddgrep` that resolved `design/` relative to the ai-maestro install would report ai-maestro's
   corpus to every other project, i.e. answer a question about a corpus the caller never named. That
   is the exact shape of the bug the exit trichotomy exists to prevent ("a gate that passes because
   it read nothing"), inverted into "a gate that passes because it read someone ELSE's corpus".
   Default `--design-dir` to the CALLER's `$PWD/design`, and let the existing exit `2` fire when the
   caller has no corpus.

### ONE implementation, three entry names (busybox dispatch)

`scripts/pillar-cli` — **extensionless on purpose** (see *The installer does need an edit*) — is a
single bash launcher that dispatches on `$(basename "$0")`. It is installed to `~/.local/bin/` under
each pillar's name. Not three scripts: **one script, three names**, which is the literal reading of
*"don't create multiple versions of the tools"*.

- the launcher reads `~/.local/share/aimaestro/install-root` (written by the installer from its own
  `$SCRIPT_DIR` — the one place that provably knows it; precedent `install-messaging.sh:780`, which
  already writes `~/.local/share/aimaestro/shell-helpers/`),
- `source`s `<root>/scripts/pin-node.sh` for the Node selection,
- `exec`s `node --import tsx <root>/scripts/<doctype>grep.mjs "$@"`, defaulting `--design-dir` to
  the caller's `$PWD/design`,
- a missing/stale root file is an explicit refusal naming the file and the fix, **never** a fallback
  guess at a path. `CLAUDE.md`'s install-location-independence note is explicit: when ai-maestro
  ships as a package **there is no `~/ai-maestro`**, so a hardcoded dev-repo path works on this
  machine and nowhere else.

Refusals exit **2**, matching the trichotomy: "I could not run" is not "I found nothing".

**`prrdgrep` and `specgrep` have no implementation yet** (Phase 3 of the plan, gated on
`Q3GZJI1X`). Install only the names that resolve; the dispatcher already handles all three, so the
day each implementation lands the install list grows by one word. **Rejected:** shipping them now as
stubs that exit 2 *"not implemented"*. An agent that finds a tool and gets a refusal cannot tell
"planned" from "broken", and this card exists to stop pillar tools from being invisible-or-
misleading — `CLAUDE.md` + `docs/SCRIPT-LAYER.md` can say "they land with Phase 3" without shipping
a dead command.

### The tool detects its own environment — and must not WRITE while doing it

The USER is explicit that **the tools themselves** detect the environment, so detection lives in the
`.mjs` (`lib/pillar/environment.ts`), never in the bash launcher — whose only job is finding the
install and Node 22.

| mode | when | what is enabled |
|---|---|---|
| `standalone` | the cwd is not a registered ai-maestro agent workdir — a plain project (the janitor's repo, any clone, this repo) | **the whole 3-pillar surface**: search, lint, validate, graph, board, doctor, fix, index. Corpus-local; no server, no network. |
| `agent` | the cwd IS an authorized ai-maestro agent workdir | the above **plus** the server-backed verbs — governance approve/refuse/promote/archive through the script layer, and cross-scope / cross-project boards |

*"The 3-pillar system must work in any case"* ⇒ `standalone` is the FULL pillar surface, never a
degraded one. The `agent`-mode extras are exactly the operations that are **impossible** without a
live server and an AID, not a paywall on core function.

**The finding that changes the implementation.** The obvious detector is
`checkAuthorizedAgentWorkdir(cwd)` in `lib/agent-workdir-policy.ts` — the ONE workdir authority,
which must never be re-derived. But it calls `loadAgents()`, and `lib/agent-registry.ts:194` runs
`ensureAgentsDir()` **before** its `existsSync` guard. So merely ASKING *"am I in an agent
workdir?"* **mkdirs `~/.aimaestro/agents/`** on a machine that has no ai-maestro — a read-only query
tool planting ai-maestro state inside a stranger's project, on the janitor's very first
`trddgrep` call. That is the "observer that creates what it measures" bug.

So the order is fixed and load-bearing:

1. `existsSync(~/.aimaestro/agents/registry.json)` — a pure read, no mkdir.
2. **Absent** ⇒ mode is `standalone`, and the authority is never called. This is sound, not a
   heuristic: no registry ⇒ no agents ⇒ this cannot be an agent's workdir.
3. **Present** ⇒ call `checkAuthorizedAgentWorkdir` and let it decide.

The authority stays the sole decider whenever there is anything to decide, and the tool never
writes. (Do NOT "fix" this by making `loadAgents` lazy — that is a separate change to a hot path
with many callers; if it is worth doing it is its own card, not a side effect of this one.)

### `trddgrep` absorbs the doctor — no fourth name

The first cut proposed a second shim `trdd-doctor.sh`. **Rejected:** the USER's naming law lists
four names total (`memgrep`, `trddgrep`, `prrdgrep`, `specgrep`), so a distributed `trdd-doctor` is
a fifth and a `<doctype>grep` violation. The doctor becomes `trddgrep doctor` / `trddgrep fix` /
`trddgrep board`, delegating to the existing `lib/trdd-doctor.ts` — ONE agent-facing TRDD tool.
`yarn trdd:doctor` stays as a repo-dev alias; a yarn script is not a distributed name.

### The installer DOES need an edit — correcting this card's own first cut

The first cut claimed *"a NEW `.sh` file needs no installer change at all"*, citing the
`scripts/*.sh` glob, and called that the cheapest correct fix. That is true of a `.sh` file and
**false of the tool the USER asked for**: `trddgrep` has no extension, so neither the `amp-*.sh`
loop (`:630`) nor the "rest of `scripts/*.sh`" loop (`:744`) can see it. And naming the launcher
`pillar-cli.sh` to ride the existing glob would install a **fourth** name
(`~/.local/bin/pillar-cli.sh`) for the same tool — the confusion again. So: extensionless launcher
plus an explicit install step that copies it under each resolving pillar name. That is the price of
the naming law, and it is one small loop.

### Measured rename scope (2026-07-30)

**24 live files** mention `greptrdd`. **11 archived cards** also do and are **FROZEN** (IND §12) —
do not touch them; the old name in an archived card is a correct historical record.

Load-bearing (behaviour, not prose) — these five are Phase 1:

| site | what it is |
|---|---|
| `package.json:42` | the `greptrdd` yarn script |
| `scripts/greptrdd.mjs` | the file itself → `scripts/trddgrep.mjs` |
| `lib/pillar/index-verify.ts:334` + `scripts/greptrdd.mjs:639` | both EMIT the repair hint `greptrdd index-verify --repair` |
| `tests/unit/pillar-index-verify.test.ts:313` | ASSERTS that emitted string |
| `tests/unit/pillar-cli-exit-codes.test.ts` | 7 × `runCli('greptrdd.mjs', …)` + describe names |

The remaining 19 are comments and docs (`CLAUDE.md`, `docs/SCRIPT-LAYER.md`, `server.mjs:2037`,
`lib/pillar/index-{build,db}.ts`, `lib/trdd-{doctor,graph,store}.ts`, `scripts/bench-cold-index.mjs`,
3 more test files, the memory page, the lessons file, and 7 live design cards).

*(A `sort | head -20` in the first survey put `tests/` past the cut and I read the absence as "no
test drives the CLI by path". Two of the five load-bearing sites are tests. Measured properly here.)*

### Why the rename is IN this card and not an NPT

217AYEOT is `derived: true`, so depth-1 forbids it carrying `npt:`/`eht:` of its own. The rename is
not a separable prerequisite anyway: the deliverable the USER named is *one tool, named `trddgrep`,
reachable everywhere*. Renaming without distributing helps nobody, and distributing under the wrong
name is the bug this card exists to fix.

### Phases (≤5 files each; verify before advancing)

1. **Rename** — the 5 load-bearing sites above. Suite green.
2. **Detection** — `lib/pillar/environment.ts` + its test + a `trddgrep env` verb that prints the
   resolved mode and why.
3. **Launcher + installer** — `scripts/pillar-cli`, the install step, the `install-root` write.
4. **Doctor subcommands** — `trddgrep doctor|fix|board` delegating to `lib/trdd-doctor.ts`.
5. **Docs + coordination** — `CLAUDE.md`, `docs/SCRIPT-LAYER.md`, the memory page, the lessons
   file; then the two coordination issues.

### Explicitly NOT in scope

- Making `loadAgents()` lazy (see the detection section — its own card if wanted).
- Vendoring `better-sqlite3` or shipping a standalone binary. The launcher delegates to this
  install; a caller with no ai-maestro install gets a clear refusal, not a silent walk.
- Renaming the old name inside `design/archived/` (frozen, and historically correct).

## Acceptance

- [x] one name per pillar, all `<doctype>grep`: **zero** executable references to the old name
      remain (`grep -rn "greptrdd\.mjs\|\"greptrdd\""` outside `design/`); 10 prose mentions are
      Phase 5 and `design/archived/` is frozen
- [x] exactly ONE launcher file exists, and `~/.local/bin/trddgrep` is that file — proven by a test
      that reads `install-messaging.sh` and asserts the explicit install step names it, not by
      re-running the installer (`tests/unit/pillar-cli-install.test.ts`, 6 tests; neuter: rename it
      to `pillar-cli.sh` → exactly the 2 predicted tests fail)
- [x] invoked from a DIFFERENT project's directory it reads THAT project's `design/` — verified
      end-to-end from a seeded tmp project through a COPY of the launcher in a tmp bin dir, with
      `XDG_DATA_HOME` redirected so no real state was written
- [x] invoked from a directory with NO `design/` it exits **2** (could-not-run), never 0
- [x] `trddgrep env` reports `standalone` in a plain dir and `agent` in a registered workdir, driven
      through an INJECTED home + registry — never the developer's real `~/.aimaestro` (0-IMPACT).
      *The detector itself is done and pinned (12 tests); this box is the CLI verb.*
      **Done in a real subprocess** (`tests/unit/pillar-cli-env.test.ts`), and the agent case is the
      POSITIVE CONTROL for the box below. It found a LIVE bug: `process.cwd()` is always a kernel
      realpath while `workingDirectory` is a typed string, so the lexical `path.resolve` compare
      made a workdir registered under `/var`|`/tmp` never match a cwd of `/private/var` — an agent
      standing in its own workdir reported `standalone`. Both sides are canonicalized now.
- [x] **detection performs ZERO writes**: with a fake home containing no `.aimaestro`, assert
      `<fakehome>/.aimaestro` is still absent after a full `trddgrep env` run.
      **This box cannot be satisfied by a unit test, and the attempt to do so was itself a finding:**
      `lib/agent-registry.ts` fixes its paths at MODULE LOAD, so an in-process `$HOME` swap never
      reaches them — the neuter that swapped in `loadAgents()` left the in-process assertion GREEN
      while the write went to the developer's REAL `~/.aimaestro`. Only a subprocess run, where the
      whole module graph loads under the fake home, can observe it (measured: naive → created
      `.aimaestro/` + `.aimaestro/agents/`; shipped → nothing).
- [x] it selects Node 22 through `scripts/pin-node.sh` rather than re-deriving the selection, and
      refuses with a named error when no conforming Node exists — and the launcher is `#!/bin/bash`
      because sourcing that script from zsh silently yields an out-of-range Node
- [x] a caller with no ai-maestro install gets an explicit refusal naming what is missing (and a
      STALE recorded root gets its own refusal naming recorded-vs-expected)
- [x] `trddgrep doctor|fix|board` reach the doctor; no distributed `trdd-doctor` name exists.
      `board`/`lint`/`validate` already did; this card added `fix` (which `lint` had been
      ADVERTISING as `[--fix]` while pointing at `yarn trdd:fix`, a repo-local script an agent in
      another project cannot run) and `doctor` as an alias for `lint`, because `trdd-doctor` is the
      word an agent carries and a guessed name that is not found costs the tool
- [x] `docs/SCRIPT-LAYER.md` records the four-name convention, the two modes, and supersedes the
      "repo-local, and here is why" paragraph (that decision is now reversed by USER mandate).
      The section keeps the overruled argument's CAUSE, not just its conclusion — that a governance
      corpus whose tools one repo can run is a corpus nobody can query
- [x] a recorded **neuter run** per guard (break it, watch the NAMED test fail; read the test COUNT,
      never the exit code). `canonical()` → `path.resolve` reddens exactly 2 named tests
      ("recognises an agent standing in its own registered workdir" + the subprocess POSITIVE
      CONTROL); restored 14/14. The earlier guards' neuters are recorded in this card's history
- [x] full suite green — 279 files / 4153 passed / 2 skipped, with the corpus's 2 known
      BODY-STATE-CLAIM errors still inside the test's explicit exactly-2 allowance (they are
      ARCHIVED cards, frozen by IND rule 12, and awaiting janitor#139)

## Coordination with the other plugins

- **ai-maestro-janitor** (user-owned ⇒ an issue is authorized) — it asked for the tool and it owns
  the IND base rules that DEFINE the corpus `trddgrep` reads. Tell it: the name, the install path,
  that `standalone` mode is the full pillar surface, and that its IND bases may cite `trddgrep`
  where they currently prescribe raw `find`/`grep` idioms. It already ships `memgrep`, so the
  four-name convention is half its own.
- **the core `ai-maestro-plugin`** (user-owned) — a skill should teach the `<doctype>grep` family so
  an agent reaches for the right name instead of inventing one.

Neither is a local edit: cross-project fixes go via issue, never by touching their trees.

## Notes and lessons learned

- The first cut's *"the way ai-maestro install its scripts can be used"* reading was too literal: it
  optimized for touching no installer, and bought that with a `.sh` name the USER's naming law
  forbids. **The cheapest change and the correct change were different, and the naming law is the
  requirement** — a tool nobody can name is not reachable, however well it is copied.

## Approval log

- 2026-07-30T07:18:30+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Relayed verbatim in the STATE block. Supersedes TRDD-8KDIB2LT's recorded repo-local decision.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-07-30T07:32:27+0200 — MANDATE REVISED by USER (same authority): one tool named `trddgrep`,
  self-detecting its environment, three pillar names under the `<doctype>grep` law, coordinated with
  the other plugins. The card's own first-cut design is superseded above.
