---
name: trdd-conventions
description: "How to author a TRDD in this project + the recurring zsh gotcha — the shell var holding the UUID MUST be TID, never UID (UID is readonly in zsh, so UID=$(...) errors and ${UID:0:8} gives 'bad math expression: operator expected'). Also: where TRDDs live (design/tasks vs proposals/archived) and the canonical authoring snippet."
ocd: 2026-06-23
lmd: 2026-06-23
metadata:
  node_type: memory
  type: reference
  tier: component
---

TRDDs (Task Requirement Design Documents) are this project's git-tracked task specs, one `.md` per task under `design/`. The full spec is the global rule `~/.claude/rules/trdd-design-tasks.md` (v2 — `column:` kanban, NPT/EHT, the STATE block); approval tiers + the folder lifecycle are in `~/.claude/rules/trdd-approval-tiers.md`; project rules they cite live in `~/.claude/rules/prrd-design-rules.md`.

## The canonical authoring snippet — the shell var is `TID`, NEVER `UID`

```bash
# TID, not UID. `UID` is a READONLY special variable in zsh (the user's numeric
# user-id): `UID=$(...)` errors, and `${UID:0:8}` triggers arithmetic expansion
# -> "zsh: bad math expression: operator expected". Always use TID.[^1]
TID=$(python3 -c "import uuid; print(uuid.uuid4())"); SHORT="${TID:0:8}"
TS=$(date +%Y%m%d_%H%M%S%z)          # filename timestamp (compact, Windows-safe)
ISO=$(date +%Y-%m-%dT%H:%M:%S%z)      # frontmatter created:/updated:
# File: design/tasks/TRDD-$TS-$SHORT-<slug>.md  (frontmatter trdd-id: $TID)
```

`TID` is the ratified ecosystem-canonical name (matches the `trdd-id:` frontmatter field; short; valid; not reserved in bash or zsh). The `<uid-first-8>` *filename* segment keeps its name — that's a documentation term for "first 8 hex of the UUID", not a shell variable.

## Where a TRDD lives (folder = lifecycle)

- `design/tasks/` — OPEN work (authorized): every `column:` from `planned` through `dev`/`testing`/`blocked`/`failed`. A `failed` TRDD stays here (retryable), never archived.
- `design/proposals/` — authored, awaiting approval (`column: proposal`, Tier 1/2/3).
- `design/refused/` — proposals never approved.
- `design/archived/` — once-approved TRDDs now terminal (`completed`/`cancelled`/`superseded`).

Trivial in-session work uses a TaskCreate entry, not a TRDD. Every TaskCreate that references a TRDD carries its `TRDD-<8hex>` prefix.

## See also
- Global spec: `~/.claude/rules/trdd-design-tasks.md`, `trdd-approval-tiers.md`.
- Plugin alignment: the core plugin `ai-maestro-plugin` bundles a copy of the TRDD rule + TRDD skills (`ama-trdd-write`, `ama-trdd-transition`); its bundled `rules/trdd-design-tasks.md` still used the broken `UID` and its skills used `TRDD_UUID` — tracked in Emasoft/ai-maestro-plugin#15 to converge on `TID`.

## Notes and lessons learned
[^1]: [ocd:2026-06-23 lmd:2026-06-23] The global `trdd-design-tasks.md` (+ its v1 backup) shipped the authoring snippet with `UID=$(...)` / `SHORT=${UID:0:8}`. On macOS (zsh default) this fails every time — `UID` is readonly (the numeric user-id), so the assignment errors and `${UID:0:8}` is parsed as arithmetic → "bad math expression: operator expected". Agents kept re-discovering it mid-task. Fixed 2026-06-23: global rules standardized on `TID` + an inline anti-pattern note; ai-maestro project shell scripts audited clean (zero bare `UID`); plugin fix requested via ai-maestro-plugin#15. Lesson: the var name was the bug — never name a shell var `UID` (or other zsh specials: `STATUS`, `PATH`, `PWD`, `PID`); verify shell snippets in rules run under zsh, not just bash.
