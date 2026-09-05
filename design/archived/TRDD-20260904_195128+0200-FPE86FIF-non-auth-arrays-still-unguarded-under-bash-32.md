---
trdd-id: FPE86FIF
title: 38 non-auth array expansions are still unguarded under bash 3.2 and abort their script when empty
scope: project
project-id: ai-maestro
column: complete
created: 2026-09-04T19:51:28+0200
updated: 2026-09-05T13:21:26+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: governance-rules-session
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
implementation-commits: [81fb5dc9]
---

# The same bash 3.2 crash remains in 38 non-auth array expansions

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

## The remaining set, measured 2026-09-04 (38 sites, 27 distinct arrays — `_auth` fixed, see below)

```
5 ACTIVE_INDICES   4 ATTACH_FILES   3 ARGS   2 stale_dirs   2 REACHABLE_INDICES
2 msg_files        2 GW_ARRAY       2 candidates
1 each: tool_flags TOOL_ARGS SEND_ARGS scripts REGISTRATIONS PROVIDERS
        plugin_skill_dirs options jq_args INJECTION_PATTERNS GW_ITEMS GH_ARGS
        CURL_HEADERS cmd_args clone_args claude_args cands BUILD_ARGS args
        AMP_BLOCKED_MIME_TYPES
```

(The original measurement also listed `1 _auth`; it is fixed and removed from
this table, which is why the totals read 38/27 rather than the 39/28 first
measured.)

**Triage first — and note this is inference from NAMES, not from reading the call
sites.** `stale_dirs`, `msg_files`, `candidates`, `cands`, `REGISTRATIONS` and
`plugin_skill_dirs` *sound like* search-result collections that would find nothing
on a clean system, and `ATTACH_FILES` sounds optional by definition. **Unverified.**
An earlier draft called these "near-certain live failures", which is a runtime
claim derived from identifiers — the same name-based inference this session has
repeatedly caught in other people's reports. Read each construction site; do not
inherit the guess.

`_auth` was listed here and is **already fixed** (`common.sh:732`) rather than
deferred: it is an auth-family array that escaped the parent sweep only because it
lacks the `_auth_args` suffix the filter keyed on, so the parent's already-proven
premise covers it and no new judgement was needed. Filing a site whose answer was
known would have been deferral, not scoping. **38 sites remain.**

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

MEASURED 2026-09-05 under /bin/bash 3.2.57 with `set -u` (fifteen `/bin/bash -c` probes; `f(){ echo $#; }`): unset array `${#a[@]}` → "unbound variable" exit 1; declared-empty `a=()` `${#a[@]}` → 0; bare `"${a[@]}"` → abort exit 127 for BOTH unset and declared-empty; `${a[@]+"${a[@]}"}` → argc 0 for both, argc 2 for `a=(x "")` (empty elements preserved); `"${a[@]:-}"` → argc 1 (one spurious empty argument); the colon-less `${a[@]-}` unquoted → argc 0 for unset and empty but argc 1 for `a=(x "")` (the empty element becomes an empty field that word-splitting drops), and quoted `"${a[@]-}"` → argc 2 on that array but argc 1 on an empty AND on an unset array (the same spurious-empty-argument defect as `:-`). So a `[ ${#a[@]} -gt 0 ]` wrapper is itself unsafe on an unset array, and `${a[@]+"${a[@]}"}` is the only MEASURED idiom that is both abort-free and element-preserving. The neuter half of any probe (guard removed → abort) holds only under /bin/bash 3.2: measured under the PATH bash 5.3.15, the bare expansion of an empty array yields argc 0 with no abort.

MEASURED 2026-09-05 13:12 at close (governance-rules-session, first-hand, `/bin/bash` 3.2.57 `set -u`): the SHIPPED form keeps the outer quotes — `"${a[@]+"${a[@]}"}"`, the same shape the parent landed at agent-core.sh:416 (parent fix commit 5542ca89, verified by `git log --grep=WV8FDAH0`) — and it measures argc 0 on an empty array, argc 0 on an unset array, argc 3 on `(x "y z" "")` (the empty element preserved); identical under PATH bash 5.3.15. The worker's own probes used the unquoted form, so this is the measurement of what shipped. Diff shape: 9 removed lines (each a bare `"${NAME[@]}"`), 109 added = 9 guards + 99 comment lines + 1 blank separator (amp-helper.sh) + 0 other. Inverse transform (guard → `${NAME[@]}`, positive-controlled on a literal) applied to BOTH the HEAD and post images: 0 non-comment diff lines in all 19 files. shellcheck 0.11.0 per file, HEAD vs post: identical diagnostic counts and identical code histograms in all 19. Census: the card said 38; MEASURED 42 — I re-added the card's own table above: 5+4+3+2+2+2+2+2 = 22 plus twenty "1 each" names = 42 sites over 28 names, so the 38/27 headline was an arithmetic slip in the card, not a measurement gap. 9 guarded, 33 left with a WHY comment; the worker's report table omits the AMP_BLOCKED_MIME_TYPES row, but the site (amp-helper.sh:1988) carries its comment — 42 of 42 dispositioned. pin-node.sh (sourced from zsh) received a comment only, no guard. Worker report: reports/lean-worker/20260905_130431+0200-FPE86FIF-bash32-guards.md (gitignored).

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

- [x] `_auth` — an auth-family array the parent's suffix filter missed. Fixed
      immediately (`common.sh:732`) rather than carried here: the parent's proven
      premise already covers it, so filing it would have been deferral.
- [x] Each of the remaining sites (the card said 38; MEASURED 42, the card table sums 22 + 20) either guarded (9), or left with a comment (33)
      stating why the array cannot be empty.
- [x] `bash -n` clean on every touched script; no NEW shellcheck diagnostics
      (the nested-quote form is exactly the shape that trips quoting lints).
- [x] Inverse-transform diff clean, with its sed positive-controlled before use.
- [x] Full unit suite no worse than before the change.

## Approval log

- 2026-09-04T19:51:28+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a bugfix inside this repo, reversible,
  no governance or public surface. Derived from TRDD-WV8FDAH0.
- 2026-09-05T12:45:06+0200 — column → dev by governance-rules-session. lean-worker dispatched 2026-09-05 with the card as spec; write-scope = the shell scripts its site table names; it does not commit
- 2026-09-05T13:13:41+0200 — COMPLETE by governance-rules-session. all 5 boxes measured first-hand at close: bash -n 19/19, shellcheck histograms identical, inverse transform 0 residue, yarn test 513/513 files, 42/42 sites dispositioned; fix commit 81fb5dc9.
- 2026-09-05T13:18:22+0200 — CORRECTION by governance-rules-session (Approval-log append, the frozen-card exemption). The COMPLETE line above overstates: box 1 (`_auth`, common.sh:732) was closed on 2026-09-04 in the prior session; boxes 2-5 are the ones measured first-hand at close. "42/42 sites dispositioned" is now MEASURED, not inferred: a per-site sweep over the 28 census names across scripts/*.sh (comment lines excluded, positive control = exactly 42 rows) found 9 guard-shaped sites, 21 bare sites with a TRDD-FPE86FIF comment within 6 lines, and 12 bare sites whose covering comment sits 9-98 lines above — each of those 12 comments names the array and sits in the same enclosing function as the site (test-amp-cross-host.sh main(), aimaestro-check-decoupling.sh, amp-send.sh, amp-helper.sh list_inbox(), start-with-ssh.sh). No unquoted ${NAME[@]} of the 28 names exists (positive control, 0 hits). Evidence files fpe-all42b*.txt, fpe-naked3.txt, fpe-unquoted.txt in the session scratchpad.
- 2026-09-05T13:21:24+0200 — CORRECTION 2 by governance-rules-session. The 13:18 line's "same enclosing function" overstates for 6 of the 12 group-covered sites: the sweep measured only that no function definition lies between the covering comment and the site. Per file: test-amp-cross-host.sh 430→456 and 480→538/541/578 (both sides after main() at 376), amp-helper.sh 1581→1591/1593 (both after list_inbox() at 1547); aimaestro-check-decoupling.sh 67→134/148, amp-send.sh 191→200 and 247→274/291, start-with-ssh.sh 55→65 — both sides in the top-level body after the last function definition. Seven covering comment lines for twelve sites; each comment block names its array. The "no unquoted expansion" claim rested on a grep that could not see an expansion ending a line; re-measured with an anchored pattern seeded on two known-positive lines (2/2 hit): 0 hits across scripts/*.sh. Evidence copied to reports/governance-rules-session/20260905_132102+0200-FPE86FIF-close-evidence/ (gitignored, 12 files).
