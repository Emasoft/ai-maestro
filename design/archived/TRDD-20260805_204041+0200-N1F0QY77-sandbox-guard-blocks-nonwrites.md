---
trdd-id: N1F0QY77
title: Sandbox directory guard blocks commands that write nothing
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-22T01:29:00+0200
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: bugfix
priority: 1
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T20:40:41+0200
derived: false
npt: []
eht: []
blocked-by: []
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

**VERIFIED 2026-08-22 by driving the INSTALLED guard directly** —
`~/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-plugin/3.1.31/scripts/directory-guard.cjs`,
with `AGENT_WORK_DIR` exported. That last detail is load-bearing: the guard **abstains silently
without it**, and an abstaining run returns "allow" for everything, so a pass would have been
vacuous. **Every allow below is therefore paired with a must-DENY control in the same run**
(`echo pwned > ~/.claude/settings.json` → `deny`), which is what proves the guard was live and
discriminating rather than asleep.

- [x] `echo hi >/dev/null` succeeds. → `permissionDecision: allow`
- [x] `cmd >/dev/null 2>&1; echo $?` succeeds and preserves the exit code. → `allow`
- [x] `echo "text with /Users/<owner>/agents/frank"` succeeds. → `allow`
- [x] A heredoc whose body contains `<placeholder>` succeeds when the
      heredoc itself targets an allowed path. → `allow` (heredoc targeting `$AGENT_WORK_DIR`,
      body containing a literal `<placeholder>`)
- [x] A genuine out-of-sandbox write is still blocked — regression tests
      for the true-positive path, not only the false-positive fixes.
      → the control above denies, AND the guard's own suite
      (`tests/test_directory_guard_bash.py`, 368 lines, 6 deny + 6 allow assertions) carries
      `test_wo123_acceptance_denies`, `test_bypass_is_denied`, `test_sanity_baseline_deny`, and
      `test_denies_for_the_right_reason` — the last being the one that stops a deny-for-any-reason
      from passing as a deny-for-the-right-reason.
- [x] Test cases cover quoting contexts explicitly: single quotes, double
      quotes, heredoc body, escaped `\>`, and a real redirect adjacent to
      quoted `>` in the same command.
      → confirmed behaviourally by me in the same run: single-quoted `>` → `allow`,
      double-quoted `>` → `allow`, escaped `\>` → `allow`, heredoc body → `allow`; and the suite
      pins them as `test_wo123_acceptance_allows` (named for this card's issue, #123).

**Delivered by `Emasoft/ai-maestro-plugin` v3.1.24 (commits fe8919d, aeb7c16) — the guard lives
in that repo, not this one**, so nothing was changed here. The bare `>` string scan is replaced by
`scanRedirects`, a state machine over the RAW command in which the OPERATOR's quoting decides
rather than the target's. `Emasoft/ai-maestro#123` closed 2026-08-21T19:59:59Z.

**Why this card sat open for 5.5 hours after its fix shipped:** nothing closes a card when the
work lands in a DIFFERENT repo. The issue was closed, the plugin was published, and this card kept
asserting six open boxes — the seventh stale record found on this board in one night. The lesson
is not "someone forgot"; it is that a card whose work is delivered elsewhere has no event that can
close it, so it must be re-derived rather than waited on.

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
- 2026-08-20T19:35:19+0200 — **UNBLOCKED `blocked → todo` (mechanical correction, INTEGRATOR).**
  `LBFB7VST`'s directive-1 absence probe has flipped. It measured ZERO as recently as plugin v3.1.23
  (2026-08-15). Re-measured against the shipped default branch (latest release **v3.1.31**,
  2026-08-20T15:16:20Z):

      gh api repos/Emasoft/ai-maestro-plugin/contents/scripts/directory-guard.cjs \
        --jq '.content' | base64 -d > /tmp/dg.cjs
      wc -l < /tmp/dg.cjs        # → 879      (was 639)
      grep -c '/dev/null'   /tmp/dg.cjs   # → 2   (was 0)
      grep -c scanRedirects /tmp/dg.cjs   # → 2   (was 0)

  Both halves of the directive — `/dev/null` recognised as a sink, and the bare `>` scan replaced by
  the `scanRedirects` tokenizer — are present on the shipped tree. Unambiguous; no caveat.
