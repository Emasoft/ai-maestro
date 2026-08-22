---
trdd-id: 39OPYXQ9
title: aimaestro-continuity.sh is entirely non-functional — _api is never defined
column: todo
created: 2026-08-22T18:07:14+0200
updated: 2026-08-22T18:07:14+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T18:07:14+0200
---

# aimaestro-continuity.sh is entirely non-functional — _api is never defined

## Problem
**All three verbs of `aimaestro-continuity.sh` fail with `exit 127` before reaching the server.**
The script calls `_api` at `:71` (`status`), `:79` (`ensure-resume`) and `:95` (`restart-self`),
and `_api` is never defined in it.

Measured 2026-08-22 by running the BARE command on `PATH`:

    $ aimaestro-continuity.sh status <id>
    /Users/…/.local/bin/aimaestro-continuity.sh: line 71: _api: command not found   (exit 127)
    $ aimaestro-continuity.sh ensure-resume <id>
    …: line 79: _api: command not found                                             (exit 127)

**The repo copy and the installed copy are byte-IDENTICAL (`cmp`), so this is not deployment
drift — the defect is in the source.**

The script DOES source the shared helper (`:53` / `:55`, falling back to
`~/.local/share/aimaestro/shell-helpers/common.sh`, which exists here, so the source succeeds) —
but `common.sh` does NOT define `_api`. Each sibling CLI defines its own private copy:
`aimaestro-trdd.sh:93`, plus `amp-register.sh` and `aimaestro-statusline.sh`. So the author
reasonably assumed the shared helper provided it, and nothing said otherwise.

**Control, so the diagnosis is not ambiguous:** `aimaestro-trdd.sh search` — a sibling that DOES
define its own `_api` — reaches the server and exits 0 in the same shell, same session, same auth.

## Why nothing caught it
`shellcheck` cannot flag a call to a function it assumes is defined elsewhere at runtime, and
`tsc` does not read shell. `TRDD-DXJZM3BW` pinned the ROUTE with unit tests and recorded its own
open box as *"the LIVE end-to-end route test — needs an authenticated caller, deferred"*. That box
is exactly what would have caught this, and it is why the box existed. The surface is meanwhile
registered in `docs/SCRIPT-LAYER.md` "so CORE can teach its skills against the surface" — i.e. a
documented, taught CLI that has never worked.

## Proposed fix
Define `_api` in `aimaestro-continuity.sh` mirroring `aimaestro-trdd.sh:93`. Prefer that over
promoting `_api` into `common.sh` in the same change: three scripts already carry private copies
that may have diverged, so consolidating them is its own task with its own regression surface.

## Verification
- `aimaestro-continuity.sh status <self>` reaches the server (exit 0/1, never 127).
- A live R42 negative: a `<self>` that is not the caller's own identity is REFUSED by the route,
  not by a missing shell function.
- A smoke test that invokes each verb through the BARE command on `PATH` and asserts the exit code
  is never 127 — the check that would have caught this class, for every CLI in the script layer.

## Approval log

## Approval log

- 2026-08-22T18:07:14+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
