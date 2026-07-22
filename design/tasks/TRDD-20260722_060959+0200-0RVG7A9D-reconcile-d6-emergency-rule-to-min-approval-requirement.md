---
trdd-id: 0RVG7A9D
title: Reconcile the D6 emergency-rule vocabulary in aimaestro-trdd-approval.md to the live min-approval-requirement field
column: testing
created: 2026-07-22T06:09:59+0200
updated: 2026-07-22T06:09:59+0200
current-owner: ai-maestro
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T06:09:59+0200
relevant-rules: []
labels: [governance-rules, dep-overlay, approval-tiers, am80-amendment-b]
external-refs: [Emasoft/ai-maestro#80, Emasoft/ai-maestro-plugin#35]
release-via: none
implementation-commits: []
---

# Reconcile the D6 emergency-rule vocabulary in aimaestro-trdd-approval.md to the live min-approval-requirement field

Surfaced by the ai-maestro-plugin (core) Claude's Amendment B on `ai-maestro#80` (2026-07-22):
`aimaestro-trdd-approval.md` still carried 4 `approval-tier` mentions — "confirm they are
decode-only, not live teaching." Verified: 3 (lines 286/288/296) ARE the deprecation notice
itself; but **D6 (the emergency-enforcement section) was a stale straggler** that still used the
numeric `min-tier` and instructed writing the retired `approval-tier:` field.

## Why this is a real bug, not cosmetic

The USER rename (2026-07-10) made `min-approval-requirement:` (a TITLE) supersede `approval-tier: N`
(a number); the whole file reads `min-approval-requirement:` (D3 floor, D4 watchdog) EXCEPT D6.
So an emergency rule following D6 literally would raise a matched TRDD's **`approval-tier:`** — a
field the D4 watchdog and the rest of the approval system no longer read. The emergency escalation
would silently **fail to raise the bar**. This is the one spot in the file where a retired field is
still WRITTEN by a live mechanism.

## Fix (behavior-identical — Tier 2 ≡ manager on the ratified ladder)
- Emergency-rule YAML field `min-tier: 2  # raise matches to >= Tier 2`
  → `min-requirement: manager  # raise each match's min-approval-requirement to >= manager`
- Prose "raise their `approval-tier:` to `min-tier`"
  → "raise their `min-approval-requirement:` to the rule's `min-requirement`"

The deprecation section (286/288/296) is left exactly as-is — it correctly documents that
`approval-tier:` is retired. No policy change: the emergency mechanism still raises the required
approval and forbids self-approval; only the FIELD it writes is corrected from the retired one to
the live one.

## Files
- `rules/aimaestro/aimaestro-trdd-approval.md` (D6 section only)

## Edge cases
- The file is symlinked into this repo's `.claude/rules/` and seeded to agent workdirs — a live
  DEP overlay. Change is a vocabulary reconciliation to the file's OWN USER-dated rename, not a new
  policy, so it is Tier-0 (applying a ratified decision consistently).
- `min-requirement` names the emergency-rule's own floor (a title), distinct from a TRDD's
  `min-approval-requirement:` frontmatter field it raises — the prose ties the two explicitly.
- No test reads this file's CONTENT (the filename-pin test checks names; agent-operating-rules
  checks a different file), so verification is a re-grep confirming zero remaining `min-tier` /
  written-`approval-tier` outside the deprecation notice.

## Verification
- Post-edit: `grep -nE 'min-tier|approval-tier' rules/aimaestro/aimaestro-trdd-approval.md` shows
  only the 3 deprecation-notice lines (286/288/296) — no `min-tier`, no live-written `approval-tier`.
- Commit by name (no push); record SHA.

## Approval log
- 2026-07-22T06:09:59+0200 — MANDATE (Tier-0, self, in-scope consistency fix in own DEP overlay,
  implementing the file's own USER 2026-07-10 rename in the one section that missed it). Surfaced by
  core Amendment B on #80; USER "be careful with implementation details / edge cases" (2026-07-22).
