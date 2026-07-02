---
name: trdd-conventions
description: "How to author a TRDD in this project: the trdd-id is now an 8-char UPPERCASE base36 id (NOT a UUID) — TRDD-K3QX9P2W style, case-insensitive lookup, create-time collision check. Also: where TRDDs live (design/tasks vs proposals/archived/refused), the canonical authoring snippet, and the zsh gotcha that the shell var must not be named UID."
ocd: 2026-06-23
lmd: 2026-06-23
metadata:
  node_type: memory
  type: reference
  tier: component
---

TRDDs (Task Requirement Design Documents) are this project's git-tracked task specs, one `.md` per task under `design/`. The full spec is the global rule `~/.claude/rules/trdd-design-tasks.md` (v2 — `column:` kanban, NPT/EHT, the STATE block); approval tiers + the folder lifecycle are in `~/.claude/rules/trdd-approval-tiers.md`; project rules they cite live in `~/.claude/rules/prrd-design-rules.md`.

## The canonical authoring snippet — 8-char UPPERCASE base36 id (no UUID)

```bash
# The id is an 8-char UPPERCASE base36 string (A-Z + 0-9), e.g. K3QX9P2W — NOT a
# UUID.[^2] The while-loop is the create-time collision check (re-roll on a hit;
# 36^8 ≈ 2.8e12 so ~never). The var is TID, never UID — UID is readonly in zsh.[^1]
gen() { python3 -c "import random,string; print(''.join(random.choices(string.ascii_uppercase+string.digits,k=8)))"; }
TID=$(gen); while ls design/tasks/TRDD-*-"$TID"-*.md >/dev/null 2>&1; do TID=$(gen); done
SHORT="$TID"                          # the 8-char id IS the canonical id (no UUID to slice)
TS=$(date +%Y%m%d_%H%M%S%z)          # filename timestamp (compact, Windows-safe)
ISO=$(date +%Y-%m-%dT%H:%M:%S%z)      # frontmatter created:/updated:
# File: design/tasks/TRDD-$TS-$SHORT-<slug>.md  (frontmatter trdd-id: $TID)
```

`TID` is the ratified ecosystem-canonical name (matches the `trdd-id:` frontmatter field; short; valid; not reserved in bash or zsh). The `<id8>` *filename* segment is the same 8-char id. Lookups are case-insensitive, but the id is always WRITTEN uppercase — macOS/Windows filenames are case-insensitive, so a lowercase letter could fold onto an existing id's file.

## Where a TRDD lives (folder = lifecycle)

- `design/tasks/` — OPEN work (authorized): every `column:` from `planned` through `dev`/`testing`/`blocked`/`failed`. A `failed` TRDD stays here (retryable), never archived.
- `design/proposals/` — authored, awaiting approval (`column: proposal`, Tier 1/2/3).
- `design/refused/` — proposals never approved.
- `design/archived/` — once-approved TRDDs now terminal (`completed`/`cancelled`/`superseded`).

Trivial in-session work uses a TaskCreate entry, not a TRDD. Every TaskCreate that references a TRDD carries its `TRDD-<id8>` id.

## See also
- Global spec: `~/.claude/rules/trdd-design-tasks.md`, `trdd-approval-tiers.md`.
- Plugin alignment: the core plugin `ai-maestro-plugin` bundles a copy of the TRDD rule + TRDD skills (`ama-trdd-write`, `ama-trdd-transition`); its bundled `rules/trdd-design-tasks.md` still used the broken `UID` and its skills used `TRDD_UUID` — tracked in Emasoft/ai-maestro-plugin#15 to converge on `TID`.

## Notes and lessons learned
[^1]: [ocd:2026-06-23 lmd:2026-06-23] The global `trdd-design-tasks.md` (+ its v1 backup) shipped the authoring snippet with `UID=$(...)` / `SHORT=${UID:0:8}`. On macOS (zsh default) this fails every time — `UID` is readonly (the numeric user-id), so the assignment errors and `${UID:0:8}` is parsed as arithmetic → "bad math expression: operator expected". Agents kept re-discovering it mid-task. Fixed 2026-06-23: global rules standardized on `TID` + an inline anti-pattern note; ai-maestro project shell scripts audited clean (zero bare `UID`); plugin fix requested via ai-maestro-plugin#15. Lesson: the var name was the bug — never name a shell var `UID` (or other zsh specials: `STATUS`, `PATH`, `PWD`, `PID`); verify shell snippets in rules run under zsh, not just bash. (Historical: this snippet generated a UUID and sliced its first 8 chars; the UUID was dropped 2026-06-23 — see [^2] — but the "never name a var UID" lesson stands.)
[^2]: [ocd:2026-06-23 lmd:2026-06-23] TRDD ids used to be the first 8 hex of an RFC-4122 UUIDv4 (the FULL UUID in `trdd-id:`, the 8-hex prefix in the filename). The user found the long UUIDs hard to type/remember and pointed out 8 chars over the full 36-symbol alphabet (`A-Z`+`0-9`) is plenty: 36^8 ≈ 2.8e12 ⇒ ~1-in-5.6M collision odds at 1000 TRDDs, ~2M TRDDs for a coin-flip. Changed 2026-06-23: `trdd-id` IS now an 8-char UPPERCASE base36 id (no UUID at all). Uppercase-only because macOS/Windows filenames are case-insensitive — a lowercase letter could fold two distinct ids onto one file and silently overwrite. Collisions are handled by a create-time regenerate-on-hit `while ls` check, NOT the old "widen to 12 chars" idea (prevention beats post-hoc repair). Global rules updated together: `trdd-design-tasks.md`, `trdd-approval-tiers.md`, `commit-discipline.md`. Lesson: size an id to its population — a 36^8 space is collision-free for any realistic TRDD count, and short ids are the ones humans actually cite without typos.
