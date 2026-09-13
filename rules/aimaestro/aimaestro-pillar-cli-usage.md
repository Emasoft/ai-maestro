<!-- ai-maestro:installed-dep-rule -->

# ai-maestro — pillar CLI usage (`trddgrep` / `prrdgrep` / `specgrep` / `memgrep`)

> **Why this lives IN THE REPO, not at `~/.claude/rules/`** (issue #162). These rules describe the
> behaviour of `trddgrep`/`prrdgrep`/`specgrep` — CLIs whose implementation is `scripts/*.mjs` and
> `lib/trdd-doctor.ts` in THIS repo. A copy pinned outside the repo (USER scope) drifts from the
> tools the moment either moves, with no signal that it drifted. Versioning the rules alongside the
> code they describe is the fix. `~/.claude/rules/three-pillars-tools-only.md` is the
> janitor-shipped GLOBAL COPY of these rules; this is the in-repo copy, versioned with the tools.
>
> **They are two COPIES, not a base and an overlay, and which one wins is not yet decided.**
> Measured 2026-09-13: the two differ on 21 of ~84 lines — this header, the `scripts/pillar-cli`
> gate paragraph (#161), and the `help`-without-a-corpus correction (#159). Everything else is
> byte-identical. Do NOT describe this file as EXPANDING the other: that word is the sibling
> overlays' contract and it promises the base is never restated, which is false here. Resolving
> the duplication is tracked on `TRDD-9JOCY2EJ` and needs the janitor repo.
>
> **Why `rules/aimaestro/` — this file is one of the server-distributed overlays.** An earlier
> draft of this header said the opposite; the seeder refutes it. `ensureAgentRules`
> (`lib/agent-rules-seed.ts:107`, keyed on `rules/aimaestro` at `:49`) selects files here by
> `readdir` plus an `.endsWith('.md')` filter at `:115`, and seeds them into each registered agent
> workdir's `.claude/rules/`. The directory's membership is pinned by
> `tests/unit/aimaestro-overlay-filename-contract.test.ts`: a file dropped here without a matching
> contract change reds the suite; that is how this one surfaced. It was then added to
> `EXPECTED_OVERLAY_SET` by USER ruling 2026-09-13, on the grounds that the CLIs it governs are
> installed on PATH host-wide, so an agent holding only the unversioned copy cannot track the tools
> as they move. Like `aimaestro-agent-rules.md`, this file is deliberately NOT in that test's
> `CROSS_REPO_CONTRACT` list. Seeded copies land mode `0444` (`RULE_FILE_MODE`) and are restored
> to the shipped bytes whenever they differ, so they cannot drift — the drift the first paragraph
> warns about is the UNMANAGED global copy, not these.
>
> `docs/` was the other candidate: `docs/SCRIPT-MANIFEST.md` documents scripts for a HUMAN reader
> (what a script does, when to run it) and never carries agent-facing constraints like a
> forbidden-tools list or an exit-code contract. This file's content — the verb tables, the
> FORBIDDEN line, the exit-code trichotomy — is AGENT-CONSUMED rule text, which is what the
> `rules/` tree is for.

`trddgrep`=TRDD cards · `prrdgrep`=PRRD · `specgrep`=specs. PRRD G12.1 (GOLDEN). No `kanban`
CLI, board=`trddgrep`.

**FORBIDDEN:** `cat sed awk head tail grep find less` · `Read`/`Edit`/`Write` tools · `sed -i perl -pi`
heredoc/redirect.

## trddgrep — 18 verbs

| cmd | does | R/W |
|---|---|---|
| `trddgrep` | board | R |
| `next` | workable, ranked | R |
| `why <id>` | blocker chain | R |
| `unblocks <id>` | frees what | R |
| `roots` | root blockers | R |
| `show <id>` | card+STATE | R |
| `<pattern>` | search | R |
| `lint` | findings/rule | R |
| `validate` | write-gate | R |
| `fix` | repairs ALL findings corpus-wide, no id; `--dry-run` first | W |
| `new --title T --task-type X` | mint card | W |
| `set <id> <field> <value>` | edit field | W |
| `append <id> <heading> <line>` | append | W |
| `check-box <id> <n>` | tick/untick | W |
| `move <id> <column>` | col+zone mv | W |
| `edit <id> [--at-line N] --expect X --replace Y` | guarded replace | W |
| `env` | corpus kind | R |
| `index-verify [--repair\|--all]` | integrity | R/W |

## prrdgrep / specgrep — 6 verbs, same shape

| cmd | does | R/W |
|---|---|---|
| `<tool>` | records | R |
| `show <id>` | 1 record | R |
| `<pattern>` | search | R |
| `edit <id> [--at-line N] --expect X --replace Y` | replace | W |
| `lint`/`validate` | grammar/uniq | R |
| `env` | corpus, why | R |

Both tables: no `--at-line` ⇒ own line; `--expect` guards not locates; mismatch aborts.

## Flags

| Flag | Meaning |
|---|---|
| `--design-dir <p>` | corpus root |
| `--porcelain` | TAB: trddgrep=path·id·col·zone·title; prrd/spec=path·id·line·zone |
| `--limit N` | cap rows, 0=unlimited |
| `--strict` | lint/validate: warnings fail too |
| `--min-severity warn\|error` `--rule CODE[,…]` | filter findings |
| `--column C` | board: 1 col |
| `--design-body`/`--no-design-body` | 1 half of body |
| `--no-index` | walk, skip SQLite |
| `--no-bump` | skip `updated:` bump |
| `--uncheck` | untick |
| `--approver --reason --superseded-by --clear-blocker` | move |
| `--author --assignee --column --min-approval --authority --parent --npt --eht --body` | new |
| `--expect X --replace Y [--at-line N]` | edit triple |

Exit: trddgrep `0 clean·1 findings·2 no-run`; prrd/spec `0 ok·1 no-match·2 no-run`.
STALE=retry, BLOCKED=illegal.

## Corpus / writes / exempt

cwd resolves corpus: no `--design-dir` ⇒ `<cwd>/design`. Exit 2 ONLY if none exists — if the cwd
project HAS a `design/`, the command silently targets THAT corpus. cwd selects which project you
act on. Never `cd` to retarget, pass `--design-dir`.
LOCAL `~/.claude/projects/<slug>/design` · USER `<root>`.
Unsure? `<tool> env` first.

`AIM_PILLAR_ALLOW_WRITE=1` prefix lifts the gate on trddgrep/prrdgrep `fix`/`edit` ONLY —
`new set append check-box move` are W, ungated. specgrep has no gate:

`AIM_PILLAR_ALLOW_WRITE=1 trddgrep --design-dir <root> edit <id> --expect X --replace Y`

The gate itself lives in `scripts/pillar-cli` (issue #161) — a single shared launcher installed
under each pillar's name (`trddgrep`, `prrdgrep`, `specgrep`), NOT in the earlier
`scripts/install-pillar-tooling.sh` per-CLI wrapper generator, which is orphaned (superseded, kept
only as a fallback path — `install-messaging.sh` is the installer that ships `scripts/pillar-cli`).

Exempt: git/wc/checksum/ls · `grep -rl` paths-only (`-rn`=read, forbidden) · PARSE/LINT-error
card `cat`-able ("not found"=wrong id, "no TRDD corpus at"=wrong `--design-dir`).

`command -v trddgrep` fails + `~/.local/bin/trddgrep` absent ⇒ INERT, ordinary tools.
More opts: `prrdgrep|specgrep|memgrep --help|-h|help`. `trddgrep help`/`--help`/`-h` now work with
**no corpus present** (issue #159, landed at `ac94f564b`) — help no longer requires
`--design-dir <root>`; the earlier restriction here is retired.
