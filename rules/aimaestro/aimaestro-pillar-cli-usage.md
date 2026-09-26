<!-- ai-maestro:installed-dep-rule -->

# ai-maestro — pillar CLI usage (`trddgrep` / `prrdgrep` / `specgrep` / `memgrep`)

> **Why this lives IN THE REPO, not at `~/.claude/rules/`** (issue #162). These rules describe the
> behaviour of `trddgrep`/`prrdgrep`/`specgrep` — CLIs whose implementation is `scripts/*.mjs` and
> `lib/trdd-doctor.ts` in THIS repo. Versioning the rules alongside the code they describe is the
> fix.
>
> **This is now the CANONICAL copy (resolved 2026-09-26, TRDD-9JOCY2EJ).** The janitor-shipped
> global copy `~/.claude/rules/three-pillars-tools-only.md` was retired — it no longer exists at
> USER scope (verified 2026-09-26: the janitor's rules dir carries no pillar-usage file in any
> cached version) — and this in-repo copy, versioned with the tools it describes, is the single
> source. Do NOT describe this file as EXPANDING a sibling: that word is the overlays' contract
> and it promises a base that does not exist.
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

`trddgrep`=TRDD cards · `prrdgrep`=PRRD · `specgrep`=specs. No `kanban` CLI, board=`trddgrep`.

## ⚠ HARNESS-ONLY — enact ONLY inside the ai-maestro harness

The governance mandate below is ENACTED ONLY when this Claude Code session is running inside the
ai-maestro harness. **Outside it — an ordinary Claude Code session — IGNORE it**: use the CLIs
purely as tools, with no PRRD-mandate obligation attached. Everything else in this file (the verb
tables, flags, exit codes, corpus resolution, the FORBIDDEN line below) is CLI usage documentation
and applies everywhere the tools are installed, harness or not.

PRRD G12.1 (GOLDEN): tool-only access to TRDD/PRRD/spec files.

**FORBIDDEN:** `cat sed awk head tail grep find less` · `Read`/`Edit`/`Write` tools · `sed -i perl -pi`
heredoc/redirect.

## trddgrep — 19 verbs

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
| `fix` | repairs ALL findings on ONE target (`fix <id>` or `fix --path <file>`; `--dry-run` first); corpus-wide batch repair is `yarn trdd:fix` | W |
| `new --title T --task-type X` | mint card | W |
| `set <id> <field> <value>` | edit field | W |
| `append <id> <heading> <line>` | append | W |
| `check-box <id> <n>` | tick/untick | W |
| `move <id> <column>` | col+zone mv | W |
| `archive <id\|path> [--approver][--as][--reason][--superseded-by][--clear-blocker]` | authorized terminal archive (TRDD-4NISAY49) | W |
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

The write gate lives in NODE (`lib/pillar/write-gate.ts::writeRefusal`), keyed on the VERB each
tool has already parsed for itself — never a bash argv scan. `trddgrep fix|edit`, `prrdgrep
edit|add`, and `specgrep edit` are refused when the caller's cwd is outside the ai-maestro
checkout; every other verb on every tool (`new set append check-box move`, and any query verb)
is ungated. Because the gate is asked AFTER the verb is resolved, a SEARCH whose text happens to
contain "edit" or "fix" (`trddgrep "edit the rotator"`) is never mistaken for the verb — the old
`scripts/pillar-cli` bash scan matched on argv text and both refused that search and missed
`prrdgrep add` (ai-maestro#161). `AIM_PILLAR_ALLOW_WRITE=1` is the one escape hatch, checked
first:

`AIM_PILLAR_ALLOW_WRITE=1 trddgrep --design-dir <root> edit <id> --expect X --replace Y`

`scripts/pillar-cli` (issue #161) is still the single shared launcher installed under each
pillar's name (`trddgrep`, `prrdgrep`, `specgrep`) — it now carries NO write gate of its own, by
design; it locates the install, pins Node, and `exec`s the tool's own `.mjs`, which asks the node
gate above. (`scripts/install-pillar-tooling.sh` was retired 2026-09-13 — a tracked orphan,
deleted at 7e10177ab; `install-messaging.sh` is the installer that ships `scripts/pillar-cli`.)

Exempt: git/wc/checksum/ls · `grep -rl` paths-only (`-rn`=read, forbidden) · PARSE/LINT-error
card `cat`-able ("not found"=wrong id, "no TRDD corpus at"=wrong `--design-dir`).

`command -v trddgrep` fails + `~/.local/bin/trddgrep` absent ⇒ INERT, ordinary tools.
More opts: `prrdgrep|specgrep|memgrep --help|-h|help`. `trddgrep help`/`--help`/`-h` now work with
**no corpus present** (issue #159, landed at `ac94f564b`) — help no longer requires
`--design-dir <root>`; the earlier restriction here is retired.
