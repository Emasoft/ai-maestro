---
trdd-id: 7OJ4TEHV
title: Build the frozen-CLI script manifest from the Usage contract, not from --help
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-03T01:42:37+0200
updated: 2026-08-06T06:19:47+0200
implementation-commits: [4fc3796d]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-03T01:42:37+0200
severity: medium
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [frozen-cli, scripts, fleet-coordination]
external-refs: [Emasoft/ai-maestro#35, Emasoft/ai-maestro#56, Emasoft/ai-maestro#16]
---

# Build the frozen-CLI script manifest from the Usage contract, not from --help

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-05

**THE SCOPE QUESTION THIS CARD LEFT OPEN IS NOW ANSWERED BY MEASUREMENT, and the card's own scope
line was wrong.** It says: *"all four families (`aimaestro-*`, `amp-*`, `aid-*`, `agent-*`), minus
the internal libs (`amp-helper`, `amp-security`, `aid-helper`, `agent-helper`, `common.sh`)"* — and
notes scope confirmation was asked of the MANAGER on #35 and never answered. Measured 2026-08-05:

**`agent-*` IS NOT A SKILL-FACING FAMILY. It is `aimaestro-agent.sh`'s module set — ALL SIX of
them.** `scripts/aimaestro-agent.sh:64-73` sources every one:

```
_source_module "agent-helper.sh"   _source_module "agent-core.sh"     _source_module "agent-commands.sh"
_source_module "agent-session.sh"  _source_module "agent-skill.sh"    _source_module "agent-plugin.sh"
```

The dispatcher's ~19 verbs (`list show config resolve create delete update rename session hibernate
wake restart skill plugin export import presence hibernation subconscious`) resolve to `cmd_*`
bodies **in those modules** — e.g. `cmd_resolve` is `scripts/agent-session.sh:290`, not in the
dispatcher at all. So the card's exclusion list (which names only `agent-helper`) would have put
**five module files into a manifest of skill-facing CLIs** — the precise "reads authoritative,
is wrong" failure this card exists to prevent, found while building it.

**The discriminator that actually works, and the two that do NOT.** A script is skill-facing iff it
**dispatches at top level** (a `case` on `$1` outside any function). Both cheaper tests fail:
- *"has `main "$@"`"* → only **4** of 87 match; `amp-kanban-create-task.sh` parses args at top level
  with no `main()` and is plainly skill-facing.
- *"is sourced by another script"* → misses dynamic sourcing entirely (`_source_module "${module}"`
  is a variable, so a literal-name grep sees none of the six above) AND over-captures, since
  `amp-send.sh` is both sourced once and unambiguously skill-facing.

**Re-measured counts (the card's are 2 days stale, which is itself the argument for generating
this):** `aimaestro-*` **14** (card said 13) · `amp-*` 31 · `aid-*` 7 · `agent-*` 6 · **87** total
`.sh` at `scripts/` top level (card said 85). Two scripts landed in two days.

**Confirmed standalone CLIs** (spot-checked, each ends in a top-level dispatch carrying its own
`--version|-v)` and `*)` arms): `aimaestro-teams.sh`, `aimaestro-trdd.sh`, `aimaestro-groups.sh`,
`aimaestro-governance.sh`, `aimaestro-portfolio.sh`.

**NEXT ACTION:** write `scripts/build-script-manifest.mjs` using the top-level-dispatch
discriminator above, excluding the whole `agent-*` family plus `amp-helper` / `amp-security` /
`amp-name-resolve` / `aid-helper` / `common.sh`. The exclusion list must be DATA a test asserts
(per the card's own box 2) — and the test should assert the DISCRIMINATOR, not the list, so a new
module added tomorrow is excluded by construction rather than by someone remembering.

## ⏵ SUPERSEDED STATE — 2026-08-03 (its measurements stand; its SCOPE line does not)

The core plugin has asked for a canonical **FROZEN script manifest** since #35 — it can grep what its
skills *call*, but cannot prove *full coverage* (no script uncovered, no skill on a stale signature)
without an authoritative list from this repo. I committed to build it on **#56 (2026-07-11)** and it
never moved, because **no card was ever filed** — an un-carded commitment on a GitHub thread is
invisible to the board, which is the whole reason the board exists.

`scripts/script-manifest.json` does not exist. Verified 2026-08-03.

**NEXT ACTION:** write the generator against the **`case` dispatch arms** of every skill-facing
script in `scripts/` (all four families), emitting `# Usage:` as human text — NOT against `--help`
output. See the measurements below for why the original plan was wrong.

## The plan I committed to on #56 was wrong three ways

Measured before building, which is the only reason this was caught:

| the #56 claim | measured 2026-08-03 |
|---|---|
| "7 `aimaestro-*` scripts" | **13** |
| "all already implement `--help`" | **12 of 13** — `aimaestro-settings.sh` does not |
| (implied) `aimaestro-*` IS the frozen surface | `aimaestro-*`=13 · **`amp-*`=31** · `aid-*`=7 · `agent-*`=6 |

A manifest generated from `aimaestro-*.sh --help` would have documented **12 of ~51** skill-facing
scripts **and emitted no warning about the other 39** — a manifest that reads complete while covering
a quarter of the surface. That is exactly the vacuity the manifest exists to eliminate.

The concrete instance: **`amp-create-branch.sh` has no `--help`**, and it is one of the ten scripts
the core plugin's `agent-repo-workflow` skill documents. The generator would have silently skipped a
script a shipped skill calls. `aid-auth.sh` is in the same position.

`aimaestro-settings.sh`'s missing `--help` is deliberate, not an oversight: it is the one wrapper that
does **not** talk to the HTTP API (it drives `settings-gate.ts` in-process, because the installer runs
with the server DOWN). So the generator's premise excluded the script whose reason to exist is being
callable when nothing else is.

## `# Usage:` is the right source — and it is the fleet's convention, not ours to invent

| candidate source | coverage of `scripts/*.sh` |
|---|---|
| `--help` dispatch | 59 / 85 |
| **`# Usage:` header** | **67 / 85** |

Deciding fact: the core plugin's `agent-repo-workflow` skill already documents each script *"against
its frozen `# Usage:` contract"*. **The fleet already treats `# Usage:` as the frozen contract.**
Generating from `--help` would create a second, differently-shaped answer to "what is frozen" — the
precise condition a manifest is supposed to remove.

## `--help` is also a NOISY drift signal — measured, not theorised

`amp-kanban-create-task.sh` is stale deployed-vs-source. The entire difference:

```diff
-  --relevant-rules "3,27"    PRRD rule numbers this task complies with (comma-separated)
+  --relevant-rules "R25,G7"  Rule citations, comma-separated. R<n>=GOVERNANCE-RULES, G<n>/S<n>=PRRD
```

One line of help **prose**. The twelve frozen flags (`--parent --npt --eht --supersedes
--relevant-rules --severity --effort --release-via --task-type --team --id --external-ref`) are
**byte-identical**.

So a `--help`-diffing `--check` mode raises a frozen-CLI drift alarm on a documentation improvement.
**A drift check that cries wolf is a drift check people route around** — the same failure recorded for
any linter that flags what no consumer reads. The contract is the dispatch set; the prose is not.

## Design

- **Source of truth:** the `case` arms — the verb set and the per-verb flag set. Parse them; do not
  execute the script to ask it.
- **Carry `# Usage:` as human text** in each entry, so the manifest is readable, but never diff it.
- **Scope:** all four families (`aimaestro-*`, `amp-*`, `aid-*`, `agent-*`), minus the internal libs
  (`amp-helper`, `amp-security`, `aid-helper`, `agent-helper`, `common.sh`) which are correctly not
  skill-faced. Scope confirmation asked of the MANAGER on #35.
- **`--check` mode** diffs the dispatch set only, and exits on the grep trichotomy — `0` clean · `1`
  drift · `2` COULD NOT RUN. A reader that returns empty on an I/O error would make the gate pass
  because it read nothing.
- **Non-vacuity guard in the tool itself**, not only in a test: assert the parsed script count is at
  or above a floor derived by walking the directory, so a broken parser cannot certify an empty read.
  Re-derive the floor through the code that BUILDS the set, never from a hand count.

## Deploy drift measured the same day (context, not scope)

`~/.local/bin` vs source across the three deployed families: **50 deployed · 5 stale · 1 never
deployed**. Stale: `aimaestro-settings.sh`, `aimaestro-statusline-capture.sh`, `aimaestro-trdd.sh`,
`amp-helper.sh`, `amp-kanban-create-task.sh`. Never deployed: **`aimaestro-check-decoupling.sh`** —
the script that checks decoupling is the one the installer does not ship. `install-agent-cli.sh`
clears all six.

## Verification

```bash
find scripts -maxdepth 1 -name 'script-manifest*'        # must be non-empty when done
node scripts/build-script-manifest.mjs --check; echo $?  # 0 clean / 1 drift / 2 could-not-run
```

A test must pin BOTH directions: a renamed flag reddens `--check`, and a reworded `# Usage:` line does
NOT — with a neuter recorded showing which test each guard alone reddens. Without the second half the
whole point of choosing the dispatch set over the prose is unpinned.

## Estimated risk

LOW. Additive — a new generator plus a JSON artifact; no existing script's interface is touched (which
would be the frozen-CLI violation this card exists to make detectable). The risk is a parser that
under-reads, which the non-vacuity floor is there to catch.

## Acceptance

- [x] generator parses the `case` dispatch arms of every skill-facing script in all four families
      (48 included / 10 internal / 58 walked; validated against this card's hand-verified ground
      truth — exactly the 20 dispatcher verbs incl. the nested `list)` arm, kanban's 25 flags).
      The STATE's "iff top-level case" discriminator was REFUTED by 4 measured counterexamples and
      widened to: top-level arg-dispatch ∨ `main "$@"` ∨ unconditional column-0 exit/exec.
- [x] internal libs explicitly excluded, and the exclusion list is data the test asserts —
      exactly the 10 (six agent-* modules + amp-helper/amp-security/amp-name-resolve/aid-helper),
      classified by DISCRIMINATOR; `common.sh` is out of family scope entirely, not "excluded".
- [x] `# Usage:` carried as human text, never diffed
- [x] `--check` exits `0` clean / `1` drift / `2` could-not-run — absent/corrupt manifest and
      unreadable/empty corpus all land on 2, driven end-to-end via the temp-copy fixture harness
- [x] non-vacuity floor inside the TOOL, derived by walking the dir (every walked file must
      classify; zero CLIs from a non-empty walk = broken parser = could-not-run)
- [x] a renamed flag reddens `--check`; a reworded `# Usage:` line does not — both pinned;
      observed neuter pair with DISJOINT red sets recorded in the test header (incl. the
      first-aim miss: the projection was shadowed by diffManifests' own kinds list)
- [x] manifest posted to `#35` / `#56` (comments 5200338854 / 5200338449)

## Approval log

- 2026-08-03T01:42:37+0200 — SELF-MANDATE (min-approval-requirement: none). Additive infra inside the
  scripts owner's own domain; no frozen interface changed, no cross-team reach, reversible. Sourced
  from the `Emasoft/ai-maestro#35` verification pass; no approval request was sent.
- 2026-08-06T06:19:47+0200 — COMPLETED by ai-maestro (Tier 0, self-mandate). Implemented in
  `4fc3796d`; ground-truth-validated discriminator (the STATE's "iff" widened by 4 measured
  counterexamples); manifest announced on #56 (comment 5200338449) and #35 (5200338854).
  All boxes checked; NPT/EHT empty → archive.
