---
trdd-id: DXQNUJII
title: prrdgrep edit changes a rule's TEXT without bumping its VERSION, which the PRRD format forbids
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T17:55:08+0200
updated: 2026-08-16T17:55:08+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-16T17:55:08+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: small
labels: [pillar-tooling, prrd, governance, latent, colony-pillar-run]
external-refs: []
---

# `prrdgrep edit` skips the version bump the PRRD format requires

## Problem

`~/.claude/rules/prrd-design-rules.md` — the IND base loaded in every session — defines the rule
id as `<letter><number>.<version>` and states the invariant twice:

> **version** — edit counter, **bumped on every text change**, forward only

> Editing the text bumps only the version (`S70.3` → `S70.4`).

`prrdgrep edit` does not bump it. Reproduced first-hand 2026-08-16 against a throwaway fixture
(built under `mktemp -d`, `--design-dir` pointed at it, removed after; no live PRRD touched):

```
$ prrdgrep --design-dir $TMP/design edit G7.4 --expect "rule text." --replace "changed text."
edited PRRD.md
@@ line 5 @@
-- **G7.4** — rule text.
+- **G7.4** — changed text.
exit=0

$ grep 'G7' $TMP/design/requirements/PRRD.md
- **G7.4** — changed text.          ← still .4
```

The text changed, the version did not, and the tool exited 0. **A citation pinned as `PRRD G7.4`
now resolves to different text than it did before, with nothing in the id to say so** — which is
the exact failure the version field exists to prevent. That makes every pinned citation in every
TRDD silently unreliable rather than loudly stale.

## Why this is filed as LATENT, not urgent

**This repo carries no PRRD at all** — `find . -iname 'PRRD*.md'` returns nothing repo-wide, and
`lib/pillar/kinds.ts:181-182` says so in its own comment (*"this repo has none yet"*). So nothing
is corrupted today. It bites the first project that adopts one, and it will bite silently.

## The decision this needs — deliberately NOT taken here

Two defensible fixes, and this is a governance tool, so the choice is not a detail:

- **(a) AUTO-BUMP.** `edit` increments the version whenever the replaced text differs. Matches the
  rule's wording exactly ("bumped on every text change"), costs the caller nothing, and cannot be
  forgotten. Risk: it bumps on a whitespace or typo fix too, and a version is a public number other
  documents cite — an inflated counter is itself a small lie.
- **(b) REFUSE.** `edit` fails with a could-not-run when the replacement changes the rule text and
  the caller did not also supply the new version. Never writes anything wrong; costs one extra
  argument. Risk: friction on legitimate edits, and friction on a governance tool is how people
  route around it.

A third possibility worth naming so it is not rediscovered: **`edit` may be intended as a generic
text primitive** whose caller owns the version, in which case the defect is the missing ENFORCEMENT
elsewhere rather than in `edit` itself. Settling that requires reading who calls it and what the
PRRD write path is supposed to be — not assuming.

**Do not change PRRD edit semantics unilaterally.** The IND base rule is USER-owned; a tool that
silently starts renumbering rules is worse than one that silently does not.

## Verification

- Unit: a fixture PRRD with `- **G7.4** — <text>`; run `edit` changing the text; assert the id
  reads `G7.5` (option a) or that the call refuses non-zero and the file is UNCHANGED (option b).
- **Complementary half, mandatory:** an edit that changes NOTHING (same text) must not bump.
  Without it, an implementation that bumps unconditionally passes the first test.
- **Neuter:** disable the new behaviour → exactly the named test reddens and only it.
- Cross-check `specgrep`, which shares `lib/pillar/edit.ts` — the spec corpus has no version field,
  so confirm the change is PRRD-kind-scoped and does not alter spec edits.

## Acceptance

- [ ] The design decision (a / b / "enforcement belongs elsewhere") is taken and recorded here with
      its reason, before any code changes.
- [ ] `prrdgrep edit` on a text-changing edit either bumps the version or refuses — whichever (a)/(b)
      the decision selected — and never silently writes changed text under an unchanged version.
- [ ] A no-op edit (identical text) does NOT bump, pinned by its own test.
- [ ] `specgrep edit` behaviour is unchanged, pinned by a test (shared `lib/pillar/edit.ts`).
- [ ] Neuter run recorded: which test reddens, and that it is the only one.
- [ ] The fixture used is a temp dir, never a live corpus — a governance-tool test that writes to a
      real PRRD is a worse defect than the one being fixed.

## Approval log

- 2026-08-16T17:55:08+0200 — Authored in `design/tasks` as a Tier-0 self-mandate: our own tool, our
  own repo, reversible, no baseline/governance-rule/release surface (the RULE is not being edited —
  only the tool's conformance to it). Found by the colony pillar-run audit (worker-5) and
  **reproduced first-hand by the hub before filing**, per the standing rule that a worker report is
  a hypothesis until re-run.
