---
trdd-id: 1657a5f4-c54b-4e4b-95da-12f9aa149937
title: Chat-history browser redesign — comic-bubble timeline, parallel lifelines, token economics, context-panel + PSS lifeline, Tailwind migration
status: completed
created: 2026-05-29T23:41:37+0200
updated: 2026-06-14T11:29:35+0200
---

# TRDD-1657a5f4 — Chat-history browser redesign

**Filename:** `design/tasks/TRDD-20260529_234137+0200-1657a5f4-chat-history-browser-redesign.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)

## ✅ COMPLETED — 2026-06-14 (merged into `governance-rules`, pending push)

Implemented across 10 feature-branch commits (Phases 1–8 + fork-audit
security/correctness fixes). Pre-merge IRON review by 3 reviewers
(security / correctness / UI) returned **0 CRITICAL, 1 MAJOR, 12 MINOR/NIT**.
The MAJOR — the new `confineToProjectsStore` path-traversal guard shipped
with zero negative tests — was fixed on the branch with 13 real tests
(12 rejection cases × 3 routes + 1 positive boundary), commit `e821a2db`.
Merged into `governance-rules` at merge commit **`841088dd`**.
Post-merge verification: `tsc --noEmit` 0 errors · vitest **1518 passed** ·
`yarn build` exit 0. Review reports under `reports/chat-history-review/`.

**Open follow-ups (non-blocking, recorded — NOT done here):** MINOR-2
(`hasSessionCookie` is presence-only; pre-existing project-wide — recommend a
dedicated hardening TRDD to call `validateSession()`) plus the other MINOR/NIT
items in the review reports. **The merge is local on `governance-rules`; not
yet pushed.**

The page under redesign is the **Agent Profile → "Sessions" tab** — the read-only JSONL transcript browser (`app/page.tsx:65` → `components/agent-profile/SessionsTab.tsx` + `sessions/*` + `useJsonlSession.ts` + `styles/sessions-browser.css`; server `app/api/sessions-browser/*`; rust `rust-tools/aim-jsonl-reader`). It is the **literal memory of every agent conversation since the beginning** — crucial, currently built sloppily, and headed for a PR to the ai-maestro owner who rejects convention violations.

---

## 1. The vision (user's requirements, verbatim intent)

1. **Comic chat layout** — agent bubbles on the **left**, human on the **right**, literal text as a speech bubble with a **pointy tail elongated to the avatar** (agent's or user's), so it reads like a true comic conversation.
2. **Pseudo-terminal blocks** — tool outputs, code diffs, bash output, tables, etc. rendered as nicely-formatted **ANSI in a terminal-style block** (not bubbles).
3. **Token economics per element** — every speech bubble AND every terminal block reports its token usage; a **summary that expands into a detailed cost breakdown**. Money is an *approximation only* (flat-rate Pro/Max subscriptions → indicative equivalent at normal per-token API prices; never claim exact cost).
4. **Parallel sub-agent visualization** — sub-agents running in parallel (recorded in the main jsonl or in **separate forked jsonl** sidecars) shown in a **timestamped multi-column** view of all sessions running concurrently. With 100+ parallel agents, **aggregate** into very thin columns, with **expand/collapse one-by-one**. **The whole history in the json files must be reported no matter what** — every event at its exact time, nothing dropped.
5. **Prominent timestamps + chronological ruler** on the left: a **tick/mark per event** (bubble, tool execution, tool output, agent launch, MCP use, MCP output, …). The chat history must be a **complete timeline of all agents' lifelines**.
6. **Cost in evidence per operation** (tokens primarily; money only indicative, see #3).
7. **ai-maestro convention compliance** — especially **CSS classes → Tailwind** (the page leans on `styles/sessions-browser.css`); fix every aesthetic/styling deviation the owner would reject.
8. **Mobile + touch-friendly** version.
9. **Export intervals to Markdown or PDF.**
10. **Context panel updates** — the panel that appears when selecting a conversation item to show the exact **context-memory content at that time** needs updates after recent Anthropic/Claude-Code changes (compare new vs old jsonl).
11. **PSS lifeline integration** — use the perfect-skill-suggester Rust "lifeline engine" so the context panel can show **which installed component (plugin/skill/agent/…) was active when / installed when / uninstalled when**, per project folder. (Sparse historical data today; will accrue over time.) Open issues on the PSS repo for problems found — **done: [Emasoft/perfect-skill-suggester#10](https://github.com/Emasoft/perfect-skill-suggester/issues/10).**

**Process constraints from the user:** huge undertaking → use a **Workflow**; **evaluate-and-fix in the same pass** (don't read the same code twice); if fix-as-you-go collides with predefined workflow steps, optimize agent use to avoid token waste; **plan carefully**; deliver **bug-free + beautifully styled**.

---

## 2. Investigation findings (this session — full detail in the report files)

All four read-only investigations are persisted under `reports/chat-browser-redesign/` and the prior audit under `reports/chat-browser-audit/`. Summary:

### 2a. JSONL schema evolution + context-panel impact — `…-IN-1-jsonl-schema-evolution.md`
- **LIVE REGRESSION (P0):** the `/context` snapshot parser (`services/sessions-browser/local-context-breakdown.ts:996,1010-1022`) hard-requires an **"Autocompact buffer" line that Claude Code REMOVED** → `recordedSnapshot` is silently dropped for **every modern session** → the recorded-vs-heuristic Δ comparison in `ContextBreakdownPanel` is **dead**. (Directly the "context panel needs updates" item.)
- **Opus→1M context-limit bug (P0), mirrored in BOTH `rust-tools/.../context.rs:337` AND `local-context-breakdown.ts:849`:** any `claude-opus-4*` returns 1,000,000, but standard Opus 4.6/4.7/4.8 are **200K** (only the `[1m]` variant is 1M) → over-reports free space by 800K. (Two independent mirrors = a single-source-of-truth smell.)
- `redacted_thinking` block is new; thinking text lives in `b.thinking` not `b.text`, so `extractText` **drops all reasoning**.
- **~28 new top-level record types** (hook_success, attachment, queue-operation, task_reminder, compact_boundary, …) → `HIDDEN_RECORD_TYPES` is stale → many render as empty rows.
- `lib/jsonl-reader.ts` needs **zero** changes (pure I/O). All schema-sensitive logic is in the Rust reader + `local-context-breakdown.ts`.
- REFUTED: the "2.1.152 cache_creation_input_tokens only via nested breakdown" hypothesis — the flat field is always present (== ephemeral_5m+1h across all 6,173 usage records). Add a nested fallback as future-proofing only.
- **9 schema changes, 18 data-layer updates.**

### 2b. PSS lifeline engine — `…-IN-2-pss-lifeline-engine.md`
- Engine EXISTS: Rust crate `skill-suggester` (`temporal.rs`), CozoDB-on-SQLite at `~/.claude/cache/pss-skill-index.db`, **CLI binary only** (no MCP). Verbs: `as-of`, `lifespan`, `timeline`, `installed-between`, `removed-between`, `by-plugin`, `health`, `scan-log`, … fast (<50 ms), JSON-native, parametrized (no injection).
- **NOT fit yet:** history never accrues after the initial seed (only 2 scans ever); install dates are synthetic (migration date); no single "active in folder X at time T" query; `enabled` is uniformly true; `--top` defaults to 4 (silent truncation); slug contract ambiguous. → **10 problems filed as PSS#10.**
- Integration design: **shell out to the binary** (`execFile`, args array) from a server route; **health-gate** first and show a "history stale" banner; never read the DB file directly; never silently mutate PSS state. **Degrade gracefully** — the chat browser must not break when PSS is stale/unavailable.

### 2c. Parallel/forked-subagent timeline model — `…-IN-3-parallel-timeline-model.md`
- **Linking FOUND:** subagent transcripts at `…/<session-uuid>/subagents/agent-<id>.jsonl`; parent→child via the `agent-<id>` filename + a top-level field + structured `agent_progress.parentToolUseID` (NOT `parentUuid`).
- **Server-side lane/manifest/global-order model is ~90% already built** (prior TRDD-d46b42e9 Phase 6). The gaps are: the **UI is single-stream** (no multi-column lanes), and a **missing per-event `tsMs`** for precise placement on one absolute axis.
- Aggregation for 100+ lanes: thin columns + lane bucketing + expand/collapse + virtualization; every recorded event still represented (no drops).

### 2d. Styling conventions + Tailwind migration — `…-IN-4-styling-conventions.md`
- Convention: **Tailwind-utility-first**, arbitrary values idiomatic (618 arbitrary-utility occurrences project-wide). Decisive proof: `AgentSearch.tsx:104` renders the **same** search-highlight `<mark>` in pure Tailwind (`bg-yellow-300/30 …`) that sessions wrote as the CSS class `.aim-match`.
- `styles/sessions-browser.css` = **22 `aim-*` classes** → ~13 trivially Tailwind-able, ~6 need arbitrary values, 3 "must-stay" glow rules **refactor to `group`/data-attr → zero bespoke CSS achievable**. Other violations: the stylesheet import itself + 9 hardcoded `rgb()` bucket literals (`ContextBreakdownPanel.tsx:68-76`) + 5 `style={{touchAction…}}` → `touch-pan-y overscroll-contain`.
- **Comic bubble tail:** Tailwind arbitrary `[clip-path:polygon(...)]` on a sibling div (beats a CSS `::after` triangle — which can't elongate — and beats inline SVG), reusing the existing `ROLE_STYLES` palette tokens. **Pseudo-terminal:** reuse `lib/ansi.ts` + the `#0d0b11` xterm bg already in `globals.css`. Target: **delete `sessions-browser.css` entirely**; at most one descendant rule in `app/globals.css`.

### 2e. Prior code audit cross-reference — `reports/chat-browser-audit/…-chat-history-browser-ui-audit.md`
The redesign MUST also resolve the audit's verified findings: 5 CRITICALs (live-tail 2s poll C1 + its race C2 + cross-session contamination C3; scroll-to-match offset/array-index mismatch C4; mobile drawer fake-modal C5) and the MAJOR/MINOR themes (a11y, mobile parity, data-viz honesty incl. `cacheRead` dropped, stale-data-on-switch). The earlier audit's "leave contextLimitForModel" note is **superseded** by finding 2a (it IS a real bug).

---

## 3. Phased plan (build) — each phase ≤5 files where practical, verify before next

Ordered by dependency + value. Correctness foundations first, then convention compliance, then the visual/feature redesign, then the heavy parallel-timeline, then context-panel/PSS, then mobile/export.

### Phase 1 — Data-layer correctness (foundation)
Fix the bugs that make the current data wrong, so everything built on top is trustworthy.
- Fix `/context` parser regression (2a): tolerate the removed "Autocompact buffer" line; re-enable `recordedSnapshot`.
- Fix Opus→1M context-limit bug in **both** mirrors (`context.rs:337` + `local-context-breakdown.ts:849`): only `[1m]` variants → 1M; standard Opus 4.x → 200K. **Derived task:** collapse the two mirrors toward one source of truth (or a shared table) to kill the drift.
- Thinking extraction: read `b.thinking` + handle `redacted_thinking`; decide render policy (collapsed "thinking" block).
- Refresh `HIDDEN_RECORD_TYPES` for the ~28 new record types; classify each as render / hide / dedicated-event.
- Audit CRITICALs C1/C2/C3: remove/gate the 2s live-tail `setInterval` (gate to `isOngoing` + explicit follow-tail toggle, or WebSocket/file-watch); fixes the race + cross-session contamination.
- Audit CRITICAL C4: `scrollToLine` must map `lineIndex → array-position` before indexing `offsets[]`.
- Add per-event `tsMs` to the parsed model (needed by Phase 5/6) — 2c gap.
- **Derived:** unit tests for context-limit-by-model, /context parse, scroll-to-match-with-filtered-metadata.

### Phase 2 — Tailwind migration (convention compliance; do before the visual layer lands on top)
- Migrate all 22 `aim-*` classes to Tailwind (13 utilities, 6 arbitrary, 3 glow → `group`/data-attr). Delete `styles/sessions-browser.css` + its `SessionsTab.tsx:24` import.
- Replace 9 hardcoded `rgb()` bucket literals + 5 `style={{touchAction}}` with Tailwind tokens/utilities.
- **Derived:** verify no other component imports the deleted stylesheet; `yarn build` + visual parity screenshot before/after.

### Phase 3 — Comic chat-bubble + pseudo-terminal layout
- Bubble: agent left / human right; speech-bubble tail via `[clip-path:polygon()]` sibling toward the avatar; reuse `ROLE_STYLES` palette.
- Pseudo-terminal block for tool_use/tool_result/diff/bash/tables via `lib/ansi.ts` + `#0d0b11` bg.
- Preserve the audit's verified-safe content path (React-escaped, no innerHTML).
- **Derived:** long-content wrapping (no horizontal inner scrollbar per no-nested-scroll rule); a11y (roles, focus-visible on copy, non-color match cue).

### Phase 4 — Token/cost economics
- Per-bubble + per-terminal-block token badge; expandable detailed breakdown (in/out/cache-read/cache-creation incl. nested ephemeral_5m/1h; **stop dropping `cacheRead`** per audit).
- Money = **clearly-labeled approximation** (equivalent API-price estimate; caveat for flat-rate Pro/Max). Never present as exact.
- **Derived:** roll-up summaries per session + per subagent + per lane (feeds Phase 6).

### Phase 5 — Timeline + chronological ruler
- Left chronological ruler: one tick per event (bubble, tool exec, tool output, agent launch, MCP use/output) using `tsMs`.
- Prominent, always-visible timestamps.
- **Derived:** event taxonomy/classifier (2c); ruler virtualization for long sessions.

### Phase 6 — Parallel multi-column lifelines (the heaviest sub-project) — DEFERRED
**DECISION (2026-05-30): split to its own follow-up TRDD/PR.** This build ships Phases 1-5 + 7-8 (most of the value); the parallel multi-column lifeline view is authored + built separately so the first PR stays reviewable and token-bounded. The §2c server lane/manifest model + the Phase-1 `tsMs` addition are the groundwork the future TRDD will consume.
- Multi-column lane view of main + all forked subagents on one absolute time axis (leverage the ~90%-built server lane/manifest/global-order model, 2c).
- Aggregation for 100+ lanes (thin columns, bucketing, expand/collapse one-by-one, virtualization); **no event dropped**.
- **Derived:** lane↔subagent-jsonl linking via `agent-<id>` + `parentToolUseID`; performance test with a synthetic 100-lane fixture. **This phase may warrant its own follow-up TRDD** given its size.

### Phase 7 — Context panel updates + PSS lifeline integration
- Apply the 2a context-panel fixes (recordedSnapshot, limits, cacheRead, data-viz-honesty MAJORs from the audit: aria-valuenow clamp, bucket-sum vs total, exhaustiveness guard).
- PSS integration (2b): server util `lib/pss-lifeline.ts` shelling out to the binary; **health-gate + "history stale" banner**; show "components active at T" with graceful degradation. **Blocked-soft by PSS#10** — build the integration to degrade now (sparse data) and improve as PSS lands the fixes; do NOT block the redesign on PSS.
- Fix audit CRITICAL C5 (drawer fake-modal: Escape/focus-trap/return-focus/scroll-lock) + the toggle non-`relative`-ancestor MAJOR.

### Phase 8 — Mobile/touch + export
- Mobile parity (audit theme C): session pills tooltip/aria, list errors not masked as empty, refresh/metadata on mobile, ≥44px touch targets, `prefers-reduced-motion`.
- Export selected interval → Markdown and PDF. **Decision needed: PDF approach** (see §5).

---

## 4. Build workflow design (the user opted into a Workflow)

- **Per-phase fan-out, eval-and-fix-in-one-pass:** each build agent OWNS a component/file and BOTH finds and fixes its issues in a single context (no separate "audit then fix" double-read — this honors the user's "don't read twice"). The investigation findings (this TRDD's §2) ARE the per-agent briefs, so agents start from a known target list rather than re-discovering.
- **Reconciling fix-as-you-go vs predefined workflow:** the workflow defines the PHASE BOUNDARIES and the file→agent assignment; within an assignment, the agent fix-as-it-goes. Cross-file/contract changes (e.g. adding `tsMs` to the type consumed by 3 components) are done as a single coordinated agent or a barrier step, not split.
- **Verification:** after each phase, a verify pass (re-read changed files / run `yarn build` + `yarn tsc --noEmit` + targeted tests) before the next phase — and surface refuted/false-positive findings (the lesson from the audit's C5 false-positive).
- **Worktree isolation** for parallel code-modifying agents (per the project IRON rule + write-guard), merged per phase.
- **No PR until the whole thing is bug-free + convention-clean** (the owner-rejection risk).

---

## 5. Decisions (RESOLVED 2026-05-30)

1. **PDF export approach → CLIENT-SIDE print-to-PDF.** Render a print-styled view + browser print/save-to-PDF (light lib only if needed); no server/browser dependency; high fidelity to on-screen styling. Markdown export alongside. (Phase 8.)
2. **Parallel-timeline scope → SPLIT to its own TRDD/PR.** This build = Phases 1-5 + 7-8. Phase 6 deferred (see §3 Phase 6).
3. **Live-tail behavior → gate to `isOngoing` + explicit "follow tail" toggle** (self-decided, my recommendation; can be revisited in Phase 1). Removes the unconditional 2s poll (audit C1/C2/C3).
4. **PSS dependency posture → degrade gracefully now**, improve as PSS#10 lands. Phase 7 PSS integration must not block the redesign. (self-decided.)
5. **Sequencing → COMPACT FIRST, then build.** Auto-compact is broken in this session; the build launches from a fresh/compacted context, resuming from this TRDD.

## 6. Dependencies / blockers
- **PSS#10** (lifeline engine fixes) — soft blocker for full Phase 7 PSS fidelity; graceful degradation unblocks the rest.
- **Anthropic/Claude-Code jsonl format** — investigated (2a); no external blocker.
- The prior chat-browser audit + these 4 investigations are the authoritative input; do not re-discover.

## 7. Acceptance criteria
- All 5 audit CRITICALs + the 2a data-layer P0s resolved; `yarn build` + `yarn tsc --noEmit` clean; targeted tests pass.
- `styles/sessions-browser.css` deleted; zero new bespoke stylesheets; Tailwind-utility-first throughout (owner-convention-clean).
- Comic bubbles (agent-L/human-R + avatar tail) + pseudo-terminal blocks render correctly, light/dark, desktop + 390px mobile.
- Token economics per bubble/block with expandable breakdown; cacheRead no longer dropped; money clearly labeled approximate.
- Chronological ruler + prominent timestamps; complete event coverage (nothing dropped).
- (If Phase 6 in scope) parallel multi-column lifelines with 100+-lane aggregation + expand/collapse.
- Context panel: /context regression fixed, limits correct, PSS "active-at-T" integrated with health-gate + graceful degradation.
- Mobile/touch parity; Markdown + PDF interval export.

## 8. Status / next action
`in-progress`. **Build COMPLETE** (2026-05-30) on branch `feat/chat-history-redesign` (worktree off `c9528b88`). Phases 1-5 + 7-8 built, each gated (tsc 0 / unit tests / `yarn build` 0 / claim-verified) and committed separately. Phase 6 (parallel multi-column lifelines) DEFERRED to its own follow-up TRDD per §3/§5.2.

**Commits (one per phase):**
- Phase 1 data-layer correctness — `3550e4d6`
- Phase 2 Tailwind migration (delete sessions-browser.css) — `48ce21b6`
- Phase 3 comic bubbles + pseudo-terminal — `a1dea5dc`
- Phase 4 token/cost economics — `321ab8f0`
- Phase 5 chronological ruler + event timeline — `8a8751bb`
- Phase 7 context panel + PSS lifeline — `79e705ec`
- Phase 8 mobile/touch + interval export — `0d6e529a`

**Final gate:** tsc --noEmit 0 errors; 272 unit tests pass (14 files); eslint clean on the redesign surface; `yarn build` exit 0. Scope: 27 files, +5285/-855; sessions-browser.css deleted; 6 new lib modules + 1 API route + 2 new components (PseudoTerminal, TimelineRuler) + 7 new test files.

**Acceptance criteria (§7) — met (code):** all 5 audit CRITICALs (C1/C2/C3 live-tail, C4 scroll-to-match, C5 drawer real-modal) + the 2a data-layer P0s (/context regression, Opus->1M limit) resolved; Tailwind-utility-first (zero bespoke CSS); comic bubbles + pseudo-terminal; token economics (cacheRead shown, money clearly approximate); chronological ruler + prominent timestamps; context panel /context + limits + PSS active-at-T with health-gate + graceful degradation; mobile/touch parity; Markdown + client-side print-to-PDF export.

**PENDING (user-gated):** (1) **visual render verification** (light/dark, desktop + 390px) — held for a safe environment, because running a 2nd ai-maestro server against the live shared `~/.aimaestro` state (startup manager-check + session reconciliation) is unsafe unattended; do it with the user or post-merge on the main instance. (2) **merge** `feat/chat-history-redesign` -> `governance-rules` — held per the review-before-merge rule. (3) **PR**. No merge/PR without the user's word.
