---
trdd-id: CS51MFIX
title: Align to CC 2.1.197 — Sonnet 5 native 1M context window in the context-breakdown reader
column: dev
created: 2026-07-03T21:39:08+0200
updated: 2026-07-03T21:39:08+0200
current-owner: alexandre
assignee: alexandre
priority: 3
severity: MEDIUM
effort: S
labels: [claude-code-alignment, context-limits, converter]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
test-requirements: [unit, typecheck]
impacts: []
runtime-targets: [macos]
attempts: 0
last-test-result: not-run
implementation-commits: []
external-refs: ["https://docs.claude.com/en/release-notes/claude-code (CC 2.1.197, 2026-06-30 — Sonnet 5 default + native 1M)"]
---

# TRDD-CS51MFIX — Align to CC 2.1.197: Sonnet 5 native 1M context window

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-03

**Trigger:** user "update the codebase to align to the recent claude code changes" +
the CC changelog 2.1.181→2.1.200. Triaged to 5 touchpoints; **4 need NO code change**
(version-proof substring matching already handles them) and **exactly 1 is a real bug.**

**THE ONE REAL BUG (VERIFIED, not assumed):** CC 2.1.197 (2026-06-30) made **Claude
Sonnet 5** the default model with a **native 1M-token context window**. CC writes the
**bare** id `claude-sonnet-5` to the JSONL (NO `[1m]` tag) — **ground-truthed: 2554 real
`"model":"claude-sonnet-5"` records** across other sessions' `~/.claude/projects/*.jsonl`
(self-match from this session excluded). Both context-limit resolvers gate 1M ONLY on the
`[1m]` substring, so a `claude-sonnet-5` session is under-reported as 200K — free-space is
understated by 800K on every real Sonnet-5 session shown in the context-breakdown UI.

**FIX (minimal, robust to either tagging):** in both mirrored resolvers, a model id whose
lowercased string contains `sonnet-5` resolves to 1M **in addition to** the existing `[1m]`
check. Correct per the authoritative changelog AND safe regardless of whether CC ever also
tags the id `[1m]` (redundant-if-tagged, fixing-because-untagged-today). Kept family-narrow
(`sonnet-5` only) — bare `sonnet` / `claude-sonnet-4-6` stay 200K (Sonnet 4.6 is NOT 1M).

**FILES (the sync invariant — TRDD-1657a5f4 Phase 1 — MUST move together):**
1. `lib/context-limits.ts` — add `sonnet-5` native-1M rule + doc-comment update.
2. `rust-tools/aim-jsonl-reader/src/context.rs` — mirror the rule + its `#[test]`.
3. `tests/unit/context-limits.test.ts` — add the `claude-sonnet-5 → 1M` case.
4. `tests/unit/converter-model-mapping.test.ts` — add regression `mapModel('claude-sonnet-5',
   claude, codex) === 'gpt-5.3-codex'` (converter already correct via `claudeFamily` — this
   pins it; NO converter code change).

**NO CODE CHANGE (verified by source read):**
- `lib/converter/rewrite/model.ts` — `claudeFamily('claude-sonnet-5')` → `sonnet` →
  `gpt-5.3-codex` already (family-normalized). Only a regression test is added.
- `lib/token-cost.ts` — `modelFamily()` substring `sonnet` → PRICES.sonnet already correct;
  the promo price is temporary + the module is explicitly indicative. No change.
- **permissionMode** (CC 2.1.200 "default"→"Manual" label) — cosmetic CLI label; no repo code
  names the permission-default label operationally. Doc-only note if any doc surfaces it.
- **mcp server arrays / `/agents` wizard removal (CC 2.1.198)** — CLI-internal; ai-maestro
  drives agents via `claude --agent`, never the interactive `/agents` wizard.

**NEXT ACTION:** apply fixes 1–4, gate `npx tsc --noEmit` + `yarn test` (vitest) + `cargo test`
(in `rust-tools/aim-jsonl-reader`), commit by explicit file name with `TRDD-CS51MFIX` in the
subject. **NO push** (ai-maestro is not a plugin — push is USER-gated).

**DERIVED AUDITS (lower priority, separate commits if pursued):**
- (a) `.claude/settings.json` hook matchers — CC 2.1.195 made hyphenated-identifier hook
  matching exact-match; audit for substring reliance (silent-break risk).
- (b) grep README/CLAUDE.md/docs for stale `/agents` interactive-wizard references (CC 2.1.198).

## Why (the WHY the commit + code comments must carry)

The context-breakdown reader powers the sessions-browser "free space" gauge. Under-reporting a
Sonnet-5 session's window as 200K instead of its true 1M makes the UI show a session as far
more full than it is (off by 800K) — misleading exactly on the model that is now the DEFAULT.
The `[1m]`-tag-only rule was correct for the Opus-4 line (where 1M is an opt-in variant) but is
wrong for Sonnet 5, whose 1M is native and whose id carries no tag. The fix stays family-narrow
so it does not resurrect the old over-reporting bug the `[1m]`-only rule was created to kill.

## Verification

- `tests/unit/context-limits.test.ts` — `claude-sonnet-5` → 1_000_000; `claude-sonnet-4-6`
  stays 200_000 (guard against over-generalizing).
- `rust-tools/aim-jsonl-reader` `cargo test` — mirrored assertion green.
- `tests/unit/converter-model-mapping.test.ts` — `claude-sonnet-5 → gpt-5.3-codex`.
- `npx tsc --noEmit` clean; `yarn test` green.
