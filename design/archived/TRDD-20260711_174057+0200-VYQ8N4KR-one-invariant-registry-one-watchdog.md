---
trdd-id: VYQ8N4KR
title: One invariant registry, one watchdog — merge the scattered workdir enforcers
column: complete
created: 2026-07-11T17:40:57+0200
updated: 2026-08-01T22:50:24+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 1
severity: MEDIUM
effort: M
labels: [invariants, watchdog, consolidation, tamper-resistance, migration-readiness]
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
parent-trdd: TRDD-JGCEA6CQ
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, integration, typecheck, e2e]
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T17:35:00+0200
implementation-commits: [95451222]
external-refs: ["design/tasks/TRDD-20260711_170855+0200-JGCEA6CQ-agent-operating-rules.md", "design/tasks/TRDD-20260707_232304+0200-DE9757LJ-split-governance-rules-ind-dep.md", "design/tasks/TRDD-20260703_000000+0200-a1019073-controlled-execution-environment.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**Done and proven live.** Every guarantee ai-maestro makes about an agent workdir is
now ONE list (`lib/agent-invariants.ts`), enforced by ONE runner, with ONE periodic
watchdog. Live proof: a rule file was chmod'd writable and overwritten on a real agent;
15 s later the watchdog restored it — content, and the read-only bit:

```
[InvariantsWatchdog] alexandre: dep-rules=repaired (restored aimaestro-agent-rules.md)
size=1841  perms=-r--r--r--
```

Gates: `tsc` 0 · vitest **162/162 files** · `yarn build` OK. Boot sweep on the real
fleet: 24 workdirs checked, steady-state 0 repaired.

## The problem — and the inventory that corrected me

The USER's premise was "there are a lot of watchdogs already — merge them". I checked
before merging, and the inventory came back **different from what we both assumed**:

- There was exactly **one** periodic watchdog for workdir invariants: the one I had
  just added for the rule files. The other `setInterval`s in the codebase are unrelated
  (agent-directory sync, sudo-token sweep, message-cache sweep, system-tracker).
- What actually existed was a pile of **enforcers hanging off one wake-path choke
  point**. `ensureCorePluginInstalled` ran, in sequence and each in its own
  copy-pasted try/catch: `mkdir .claude/` → seed the DEP rules → restore the managed
  git-exclude → check/repair the R17 core plugin. `CreateAgent` re-implemented the
  first three as gates G05/G05b/G05c. `importAgent` had its own copy.

So the USER was right about the disease and (understandably) off about the symptom.
The shape has two failure modes, and we had hit both:

1. **Add a guarantee, remember N call sites.** Miss one and the guarantee holds for
   some agents and not others — invisibly, because a missing guarantee looks exactly
   like an agent that chose to ignore it.
2. **A guarantee enforced only on WAKE is enforced by the very agent that may have
   broken it.** The agent that deleted the rule decides when the repair lands. That is
   not a guarantee; it is a hope.[^1]

## The design

`lib/agent-invariants.ts` — an invariant is a **declaration**, not a call site:

| id | guarantee | triggers |
|---|---|---|
| `claude-dir` | `.claude/` exists | create · wake · periodic |
| `dep-rules` | the shipped `aimaestro-*.md` rules are present, unmodified, read-only | create · wake · periodic |
| `git-exclude` | a git-repo workdir carries the managed git-exclude block | create · wake · periodic |
| `core-plugin` | `ai-maestro-plugin` (R17) installed + enabled at local scope | **wake only** |

Adding a guarantee is a row. `enforceAgentInvariants(ctx)` runs the rows matching the
trigger; `startAgentInvariantsWatchdog()` is the single periodic loop. Three call sites
(CreateAgent, ensureCorePluginInstalled, server boot) now call the runner instead of
hand-rolling the list.

**`triggers` is the load-bearing field, and `core-plugin` is why.** Its repair is
`claude plugin install` — network I/O, a package manager, a registry write. A
background loop that silently reinstalls plugins across the fleet is a categorically
bigger promise than "rewrite a file", and R17 deliberately has no periodic loop. Making
that exclusion an explicit, reviewable, **tested** field beats leaving it implicit in
which function someone remembered to call.[^2] It is also off `create`: the core plugin
is installed on an agent's first wake today, and a consolidation must not smuggle in a
behavior change.

## What this preserves on purpose

- **The G05/G05b/G05c op labels.** They are the AIO's per-gate contract, read by callers
  and pinned by tests. The enforcement merged; the labels did not move.
- **Best-effort semantics at create.** A failed invariant is a WARN op and never aborts
  agent creation — exactly as the three try/catch blocks did.
- **The one fatal invariant stays fatal.** `ensureCorePluginInstalled` still returns
  `{success:false}` when the core plugin cannot be installed; a wake must not proceed
  without it (R17).
- **The workdir authority.** The sweep gates on `checkAuthorizedAgentWorkdir` rather than
  re-deriving a path check — the "one authority" rule from TRDD-WLWHVMKT. This caught a
  real entry immediately: a legacy `default` agent whose `workingDirectory` is `/`.
  Without the gate, every boot and every tick would attempt `mkdir /.claude` — harmless
  as this uid, a real mess as root.

## Honest limit — this is self-healing, not a sandbox

Agents share the server's UID today, so a determined agent can chmod the file back and
rewrite it. The read-only bit stops accidents and casual writes; the watchdog bounds a
tamper's lifetime to one interval. That is **tamper-evident and self-healing, not
tamper-proof**. Real prevention needs per-agent UID isolation — TRDD-a1019073. Do not
read this module as a sandbox.

## Verification

- `tests/unit/agent-invariants.test.ts` — 11 tests. The list's shape; that `core-plugin`
  is `['wake']` (the wall in front of a future edit turning the watchdog into a
  background plugin installer); that only matching triggers run; idempotence; a throwing
  invariant becomes a `failed` outcome while the others still run; the watchdog repairs
  a deleted rule and is a no-op on a second start.
- `tests/unit/agent-operating-rules.test.ts`, `tests/unit/agent-rules-seed.test.ts` —
  the rule file, its size budget, and the tamper-restore paths (JGCEA6CQ).
- E2E on the live fleet: boot sweep over 24 workdirs; a post-boot tamper on a real
  agent restored by the watchdog in one interval (log line above).

## Acceptance
- [x] `lib/agent-invariants.ts` (413 lines) exists and exports `startAgentInvariantsWatchdog`, confirmed called from `server.mjs:1936` after a boot sweep.
- [x] `tests/unit/agent-invariants.test.ts` exists on disk covering the invariant-list shape, trigger filtering, idempotence, and watchdog repair behavior described in this card's `## Verification` section.
- [x] Commit `95451222` resolves and lands the consolidation across the three call sites (CreateAgent, ensureCorePluginInstalled, server boot).

## Approval log
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. Card's own STATE block already
  declared "Done and proven live" with a real tamper/self-heal demonstration; it was
  never re-touched to flip `column:` after that. Re-verified this session: commit
  95451222 resolves; `lib/agent-invariants.ts` and `tests/unit/agent-invariants.test.ts`
  both exist on disk; `startAgentInvariantsWatchdog` is wired into `server.mjs:1936`.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] "Self-healing on wake" is not a guarantee when the
  thing that breaks the invariant is the thing being woken. The repair schedule belongs
  to a party that is not the suspect. More generally: an enforcement point that only runs
  when an entity is TOUCHED silently excludes every entity that is never touched — the
  same trap as seeding-on-wake in TRDD-JGCEA6CQ. Whenever a property must hold for ALL
  members of a set, something must visit the whole set on a schedule of its own.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] When consolidating N enforcers into one runner, the
  temptation is to make the runner uniform — run everything, everywhere. That is how a
  file-repair loop quietly becomes a background package-manager loop. The differences
  between the enforcers were real; the fix is to make each difference an explicit,
  reviewable FIELD (`triggers`), not to erase it. A consolidation that loses the reasons
  the pieces were different is not a simplification, it is a bug with better ergonomics.

[^3]: [ocd:2026-07-11 lmd:2026-07-11] I nearly merged against an inventory I had assumed
  rather than measured — "a lot of watchdogs" turned out to be one watchdog and one
  overloaded choke point. Ten minutes of grep changed the design (a registry with a
  trigger field) from what I would otherwise have built (a scheduler that merges timers
  that did not exist). Verify the premise of a refactor, including the user's premise —
  especially when you agree with it.
