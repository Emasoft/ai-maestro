---
trdd-id: N1F0QY77
title: Sandbox directory guard blocks commands that write nothing
column: blocked
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-06T00:39:08+0200
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T20:40:41+0200
derived: false
npt: []
eht: []
blocked-by: [LBFB7VST]
pre-block-column: todo
release-via: none
relevant-rules: []
labels: [manager-filed, testbot-session, owner-plugin]
external-refs: [Emasoft/ai-maestro#123]
---
# Sandbox directory guard blocks commands that write nothing

## Problem

The agent sandbox's directory guard rejects commands with no filesystem
write, in two distinct ways:

1. `/dev/null` is treated as a forbidden write target, so the standard
   discard idiom `cmd >/dev/null 2>&1` is unusable. This project's own
   agent-facing docs recommend that idiom for connectivity probes, so an
   agent following documented guidance is blocked. The workaround —
   redirect to a file under `/tmp` — turns every discard into a real
   write, making the guard's own objective worse.

2. Redirect detection does not respect shell quoting. A `>` inside a
   quoted string is parsed as a redirect operator. Verified minimal repro:

   ```
   echo "quoted data with a placeholder /Users/<owner>/agents/frank"
   -> blocked: writes to forbidden path(s): /agents/frank
   ```

   The reported target is `/agents/frank` — the text following the `>` in
   the literal `<owner>` placeholder. A control string of identical shape
   without angle brackets passes, so the trigger is the character, not the
   path.

   Real-world impact: any prose containing `<...>` is affected — HTML/XML
   fragments, generics (`Vec<T>`), comparisons, placeholder syntax, or a
   heredoc carrying any of the above. It was first hit while *redacting*
   a private home path to `<redacted>`, i.e. the guard punished the
   privacy-preserving behaviour it should want.

The deeper issue behind (2): a guard that finds redirects by scanning for
`>` is asserting shell semantics it does not implement. The false positives
are the observable half. Whether the same quoting-blindness yields false
negatives was NOT tested here (deliberately — probing a live sandbox
boundary is not an unprompted action, and a working bypass does not belong
in an issue). That question should be answered by audit, not assumption.

## Scope

1. Allowlist the discard/stream devices unconditionally: `/dev/null`,
   `/dev/stdout`, `/dev/stderr`, `/dev/fd/*`. None can retain data.
2. Replace string-scanning redirect detection with AST-based detection —
   parse with a real shell parser (`bashlex`, `tree-sitter-bash`, or
   equivalent) and enumerate redirect nodes. Quoted data then cannot be
   mistaken for a redirect, and the guard's notion of "redirect" matches
   the shell's.
3. Audit the false-negative direction of the old string-scanning approach
   before removing it, so the fix is informed by what it was actually
   missing. Handle any finding through the security process, not this
   public issue.
4. Ensure a blocked command reports the offending token AND the reason,
   so a caller can tell "you tried to write outside the sandbox" from
   "the parser thought this text was a redirect".

## Acceptance criteria

- [ ] `echo hi >/dev/null` succeeds.
- [ ] `cmd >/dev/null 2>&1; echo $?` succeeds and preserves the exit code.
- [ ] `echo "text with /Users/<owner>/agents/frank"` succeeds.
- [ ] A heredoc whose body contains `<placeholder>` succeeds when the
      heredoc itself targets an allowed path.
- [ ] A genuine out-of-sandbox write is still blocked — regression tests
      for the true-positive path, not only the false-positive fixes.
- [ ] Test cases cover quoting contexts explicitly: single quotes, double
      quotes, heredoc body, escaped `\>`, and a real redirect adjacent to
      quoted `>` in the same command.

## Non-goals

- Widening the sandbox's allowed write roots. The roots are correct; only
  the detection of what constitutes a write is wrong.
- Publishing or exercising any bypass. If the audit in scope item 3 finds
  a false negative, it goes through the security process.

## Verification

Drive the acceptance list as real commands through the guard, asserting on
exit status and on whether the command actually ran — not on message text
alone. Include at least one true-positive case in the same run, so a fix
that simply disables the guard cannot pass.

## Approval log

- 2026-08-06T00:39:08+0200 — BLOCKED on the `Emasoft/ai-maestro-plugin` repo. The
  remaining work lands there (measured absent at plugin v3.0.4); the durable work
  order is posted as `Emasoft/ai-maestro#123` comment 5198192106. Unblock when the plugin
  ships it; restore to `pre-block-column`.
