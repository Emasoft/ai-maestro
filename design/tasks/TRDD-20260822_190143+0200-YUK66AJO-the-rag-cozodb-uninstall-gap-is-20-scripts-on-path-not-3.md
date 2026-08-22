---
trdd-id: YUK66AJO
title: The RAG-CozoDB uninstall gap is 20 scripts on PATH not 3
column: todo
created: 2026-08-22T19:01:43+0200
updated: 2026-08-22T17:02:57.700Z
current-owner: user
created-by: user
task-type: infra
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T19:01:43+0200
assignee: ai-maestro-hub
priority: 2
labels: [scripts, distribution, owner-act, census]
external-refs: [TRDD-GIONLYAF, TRDD-70a521d9]
---

# The RAG-CozoDB uninstall gap is 20 scripts on PATH not 3

# The RAG/CozoDB uninstall gap is 20 scripts on PATH, not 3

Found while re-running TRDD-GIONLYAF's byte-compare census as that card's last acceptance
box required. The census was re-run rather than its earlier figure quoted — and the re-run
did not confirm the old number, it **quadrupled the unowned bucket, 7 to 31**.

## The instrument defect that hid 20 files

The product's name has **two spellings on disk** — `aimaestro` and `AI Maestro` — and the
original census filtered its population with the joined form only. `kanban-sync.py` carries
the spaced form **13 times** and the joined form **zero** times, so a needle keyed on
`aimaestro` drops the very file GIONLYAF is about; the same needle dropped 17 of the 20
scripts below. Re-run with `ai[ _-]?maestro`:

```
symlinks=196  identical=67  differing=2  UNOWNED=31  not_ours=38
```

Decoded — a raw UNOWNED count is not a defect count:

| n | bucket | disposition |
|---|---|---|
| 4 | launchers (`aimaestro-agent` → its `.py`; `prrdgrep`/`specgrep`/`trddgrep`, one 5428-byte launcher under three names) | correct by design |
| 3 | `*.bak-20260808_153204+0200` backups of `aimaestro-continuity/panel/session.sh` | residue |
| **20** | **`docs-*.sh` (8) · `graph-*.sh` (10) · `memory-*.sh` (2)** | **this card** |
| 1 | `aimaestro-agent.py` — on a branch, not HEAD | separate question |
| 1 | `watch-inbox.sh` — `docs/AGENT-COMMUNICATION-GUIDELINES.md:748` tells the reader to CREATE it | correct behaviour |
| 2 | `kanban-sync.py` · `kanban-sync.sh` | ruled KEEP by GIONLYAF; see TRDD-WMNE9OU3 |

## The 20 are ONE commit, and the gap is already documented

Verified per file with `git log --all --diff-filter=AD`: every one was added `bbe4fc77`
(2026-03-26) and removed `b862c6b0` (*"Phase 7+8 — scripts/docs cleanup + npm package
removal"*, TRDD-70a521d9 — the RAG/CozoDB removal). Spot-checked on four spanning all three
families: `docs-search.sh`, `docs-stats.sh`, `graph-find-path.sh`, `memory-search.sh`.

`docs/SCRIPT-MANIFEST.md` already records the removal and states *"the plugin skills were
never updated"*. So the documentation is correct as written — this is a missing **uninstall
step**, not a doc defect. GIONLYAF classified 3 of these correctly and could not see the
other 17 for the reason above.

## Why an agent cannot close it

They live in `~/.local/bin`, **outside any project tree**: `/janitor-safe-delete` refuses
paths outside the project root, and `git` cannot undo the removal. RULE 0 forbids an
unrecoverable delete of anything not committed and recoverable. The risk is also real and
named in GIONLYAF: *removing an executable another session is invoking breaks that session
with an error that will look like something else entirely.*

**None of them were executed** to establish any of this — the standing rule about argv-less
scripts that perform their side effect on any flag, `--help` included.

## Re-derive (a census is a snapshot, never a citable number)

```bash
find ~/Code ~/ai-maestro \( -name .git -o -name node_modules -o -name .next -o -name .venv \
  -o -name venv -o -name __pycache__ -o -name .mypy_cache -o -name .trashcan \) -prune \
  -o -type f -print > /tmp/code-index.txt
grep -c '/publish\.py$' /tmp/code-index.txt      # control, expect > 0
grep -c '/trddgrep\.mjs$' /tmp/code-index.txt    # control, expect 1
```
then byte-compare `~/.local/bin/*` against that index, judging **file TYPE first** (a symlink
has no bytes of its own, so it falls into UNOWNED by construction) and filtering the
population on **both** spellings of the product name.

## Acceptance

- [ ] The owner rules on disposal of the 20 (delete / re-home under `scripts/` / leave and record)
- [ ] Same ruling covers the 3 `.bak-20260808_153204+0200` files sitting on PATH
- [ ] If disposal: it is performed by the owner, and the census re-run afterwards shows the
      bucket reduced by exactly the number removed — never assumed from the command's exit code

## Approval log

- 2026-08-22T19:01:43+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
