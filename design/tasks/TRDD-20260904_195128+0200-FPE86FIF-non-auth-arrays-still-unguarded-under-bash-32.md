---
trdd-id: FPE86FIF
title: 39 non-auth array expansions are still unguarded under bash 3.2 and abort their script when empty
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T19:51:28+0200
updated: 2026-09-04T19:51:28+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: bugfix
priority: 2
severity: medium
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-04T19:51:28+0200
parent-trdd: WV8FDAH0
blocked-by: []
npt: []
eht: []
labels: [bash32, shell, set-u]
---

# The same bash 3.2 crash remains in 39 non-auth array expansions

## Problem

`5542ca89` (TRDD-WV8FDAH0) guarded 78 expansions in the **auth family** —
`auth_args`, `sudo_args`, `_KANBAN_AUTH`, and the `_<verb>_auth_args` siblings.
It did **not** touch the rest, and the rest have the identical defect.

Under `set -u`, bash 3.2 treats `"${arr[@]}"` on an **empty** array as an unbound
variable and aborts the script with exit 127. Measured on this machine's
`/bin/bash` 3.2.57:

```
/bin/bash -c 'set -u; declare -a a=(); echo "[${a[@]}]"'   # a[@]: unbound variable, exit 127
```

This is not machine-specific: `CLAUDE.md` documents **macOS 12+** as the platform
and stock macOS ships 3.2.57, so it reproduces for every stock-macOS user.

## The remaining set, measured 2026-09-04 (39 sites, 29 distinct arrays)

```
5 ACTIVE_INDICES   4 ATTACH_FILES   3 ARGS   2 stale_dirs   2 REACHABLE_INDICES
2 msg_files        2 GW_ARRAY       2 candidates
1 each: tool_flags TOOL_ARGS SEND_ARGS scripts REGISTRATIONS PROVIDERS
        plugin_skill_dirs options jq_args INJECTION_PATTERNS GW_ITEMS GH_ARGS
        CURL_HEADERS cmd_args clone_args claude_args cands BUILD_ARGS args
        AMP_BLOCKED_MIME_TYPES _auth
```

**Several are near-certain live failures rather than theoretical ones**, because
their *common* case is empty: `stale_dirs`, `msg_files`, `candidates`, `cands`,
`REGISTRATIONS` and `plugin_skill_dirs` are all search-result collections that
find nothing on a clean system, and `ATTACH_FILES` is optional by definition.

`_auth` is the odd one out — the naming convention says it belongs to the auth
family the parent card swept, and it escaped only because it lacks the
`_auth_args` suffix the sweep keyed on. Check it first.

## Why this is a separate card rather than part of WV8FDAH0

The parent was scoped to the arrays its **failing tests** exercised. That was the
wrong axis and a review said so — but widening the same commit to 39 more sites
in code no test covers would have made a large, unverifiable change larger. These
need a per-site judgement the auth family did not: an array that genuinely cannot
be empty needs no guard, and a blanket sweep would add noise.

## Proposed fix

Per site, decide whether the array can be empty. Where it can, apply
`${arr[@]+"${arr[@]}"}` — verified correct by argument count on 3.2.57
(`argc=0` when empty, `argc=2` when populated), NOT by `printf '<%s>'`, which
prints `<>` for zero arguments as readily as for one empty argument and cannot
discriminate between them.

Where the array provably cannot be empty, leave it and say why in a comment —
an unexplained non-guard is indistinguishable from a missed one.

## Verification

- `bash -n` clean on every touched script.
- The inverse-transform check from the parent: strip the guard from the
  post-image with `sed -E 's/\$\{[A-Za-z_][A-Za-z0-9_]*\[@\][+]"(\$\{[A-Za-z_][A-Za-z0-9_]*\[@\]\})"\}/\1/g'`
  and diff against the pre-image — anything but the intended comment lines is a
  bad edit. **Positive-control that sed first**: `\+` is not a literal in BSD
  ERE and `\1` backreferences are not honoured in the pattern; both failure modes
  produce a silent no-op that reports CLEAN.
- For any site left unguarded, the comment states why.

## Estimated risk

LOW. The guard is a no-op on a populated array (measured), and there is no
`eval`-embedded or larger-word expansion among these sites — both checked on the
parent's sweep and clean.

## Acceptance

- [ ] `_auth` triaged first — it is an auth-family array the parent's suffix
      filter missed.
- [ ] Each of the 39 sites either guarded, or left with a comment stating why the
      array cannot be empty.
- [ ] `bash -n` clean on every touched script; no NEW shellcheck diagnostics
      (the nested-quote form is exactly the shape that trips quoting lints).
- [ ] Inverse-transform diff clean, with its sed positive-controlled before use.
- [ ] Full unit suite no worse than before the change.

## Approval log

- 2026-09-04T19:51:28+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a bugfix inside this repo, reversible,
  no governance or public surface. Derived from TRDD-WV8FDAH0.
