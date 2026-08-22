---
trdd-id: 1HUKAYI6
title: aimaestro-governance.sh login echoes the governance password when stdin is not a keyboard
column: proposal
min-approval-requirement: user
priority: 0
severity: critical
effort: small
task-type: security
created: 2026-07-15T01:08:00+0200
updated: 2026-08-22T15:01:54+0200
scope: project
labels: [scenario-improvement, scen-029]
current-owner: scenario-runner
external-refs:
  - reports/scenarios-runner/SCEN-029_20260714T212851Z.report.md
---

# The one CLI that takes the governance password can leak it in cleartext

## Problem

`cmd_login` in `scripts/aimaestro-governance.sh` refuses a non-TTY stdin
(`[ ! -t 0 ]` → error), on the correct reasoning that a password must never be an
argument or an env var (it would leak via `ps`/history). It then reads with
`read -rs`, which disables terminal echo.

But if a caller supplies a **pty** (the obvious workaround for the TTY check —
`script`, `expect`, `unbuffer`, most CI harnesses) and pipes the password in, the
pty echoes the input **before `read -rs` takes control of the terminal**. The
password is then printed in cleartext to stdout, where it lands in the caller's
logs and transcript.

This was hit for real during SCEN-029: the runner, following the script's own hint
("Humans: run `aimaestro-governance.sh login` once"), gave it a pty, and the
governance password appeared in cleartext in the run transcript. **The password on
this host must now be rotated.**

The irony is exact: `aim__password_json` in the scenario helpers exists precisely so
the value never passes through a runner (TRDD-44RGLOO8, TRDD-E9BZ5P7S — 197 copies
of the old password once escaped into a public repo). The CLI reintroduced the same
class of leak through a different door.

## Root cause

`read -rs` protects against *terminal echo by the shell*, not against *echo by the
pty layer* when stdin is a pipe wearing a pty costume. The TTY check makes the pty
workaround the ONLY way to use the command non-interactively — so the guard against
one leak actively steers callers into another.

Secondarily: there is no non-interactive owner auth path at all. A human at a
terminal can log in; a script, a cron, or an agent-harness acting for the owner
cannot. That is the other half of ai-maestro#55 and it is why the workaround gets
reached for.

## Proposed fix

1. **Turn off echo on the pty itself before reading**: `stty -echo` on `/dev/tty`
   (save/restore in a trap), not just `read -rs`. Belt and braces.
2. **Detect the pty-with-piped-stdin case and refuse it loudly** rather than reading:
   if stdin is a tty but not a *controlling terminal with a human on it* (no
   `isatty(2)` on stderr, or `-p` detects a pipe upstream), exit with a clear message.
   Refusing is strictly better than echoing.
3. **Give the owner a real non-interactive path** so nobody needs the workaround:
   accept the password on **fd 3** (`aimaestro-governance.sh login 3< secret`) or via
   an `askpass`-style helper command. Never argv, never env — the existing reasoning
   holds; fd-passing does not appear in `ps` or history.
4. Add a test that pipes into a pty and asserts the password does **not** appear on
   stdout.

## Verification

`printf '%s\n' "$PW" | script -q /dev/null bash -c 'aimaestro-governance.sh login'`
must either refuse or complete **without the password appearing anywhere in the
output**. Grep the captured stdout for the value; it must not be there.

## Estimated risk

LOW to fix, CRITICAL to leave. Tier 3 because it concerns the owner credential
itself. Independent of the code fix, the governance password on any host where this
was invoked through a pty should be rotated
(`POST /api/governance/password/invalidate`, Settings → Revoke).

## Approval log

## VERIFIED STALE 2026-08-22T15:0x — no live defect. Do not spend an owner decision here.

The claim under test is *"echoes the governance password when stdin is NOT a keyboard."* Read
first-hand in `scripts/aimaestro-governance.sh`; **both non-TTY paths refute it:**

- `:321` `cmd_invalidate_password` — `if [ ! -t 0 ]; then … exit 1`. It **REFUSES** a non-TTY
  outright, with an explicit error saying the password is never taken as an argument or env var.
- `:372` `cmd_login` — the TTY branch prompts and uses `read -rs`. The **non-TTY branch no longer
  reads a password at all**: it takes an env var or the gitignored `.env.local`, and passes the
  secret to `jq` **via stdin, not `--arg`** (fixed 2026-08-21, `2b881dcf` — *"unattended dev-mode
  login"*), precisely so it never enters any process's argv.

**A false positive worth recording, because it will be re-proposed otherwise.** A verification
pass on this card returned CONFIRMED on the ground that `read -rs` appears "with no `stty -echo`".
That is not a defect: **`read -s` IS bash's echo suppression.** `stty -echo` is an ALTERNATIVE
mechanism, not a required addition, and this file's own comment at `:312` states the design —
*"The password is read with `read -s` from the terminal. NEVER an argument, never an env var on
the command line."* Anyone re-auditing this should check what `-s` does before treating its
presence-without-`stty` as a finding.

**Recommended disposition: REFUSE as superseded by measurement, or close it.** Keeping it open
costs an owner decision on a non-issue — and, worse, it sits in a batch beside three CONFIRMED
security items where one stale entry is what lets a reader discount the rest.
