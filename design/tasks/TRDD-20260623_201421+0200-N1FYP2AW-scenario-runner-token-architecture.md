---
trdd-id: N1FYP2AW
title: Token-optimized scenario-runner — Sonnet[1m] executor + Opus screenshot-interpreter
column: dev
created: 2026-06-23T20:14:21+0200
updated: 2026-06-23T20:22:26+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 1
severity: HIGH
effort: L
labels: [scenario-tests, tokens, cost, agents, dev-browser]
task-type: refactor
parent-trdd: null
npt: []
eht: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
test-requirements: [integration]
audit-requirements: []
review-requirements: [human-review]
runtime-targets: [macos]
impacts: [ci-pipeline]
attempts: 0
last-test-result: not-run
implementation-commits: []
external-refs: []
---

# TRDD-N1FYP2AW — Token-optimized scenario-runner (Sonnet[1m] executor + Opus screenshot-interpreter)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-06-23

**Why this exists:** the overnight scenario batch burned a full week of the
user's token quota in a few hours. The user ordered: investigate the specific
consumer, then redesign the runner — keep Opus ONLY for screenshot
interpretation (a specialized Opus sub-agent with CONCISE output); use
**Sonnet[1m]** for scenario EXECUTION; route dev-browser bulk output to the
Sonnet agent; the executor must be a **curated `.md` agent (NOT a forked
general-purpose agent)** with minimal tools/skills and concise instructions;
carry the optimizations into a future scenario-running **plugin**.

**Investigation: DONE (measured, not guessed).** Numbers below are extracted
from the real subagent transcripts at
`~/.claude/projects/-Users-emanuelesabetta-ai-maestro/<session>/subagents/agent-*.jsonl`
via the `usage` blocks on assistant turns (the method is reproducible — see §7).

**Root cause (one sentence):** per scenario run the cost is dominated by
**cache_read ≈ 98M tokens** — the full accumulated context (base ~213K growing
to ~445K) re-read on every one of ~284 turns — billed at **Opus** rate × ~7 runs.

**Phase 1 (file writes): DONE 2026-06-23.**
1. `.claude/agents/scenario-runner.md` — CURATED IN PLACE (NOT a new
   scenario-executor.md — DRY, and the batch skill + Rule 13 cron reference it
   by the name `scenario-runner`): `model: opus → sonnet[1m]`; added explicit
   `tools: Bash, Read, Write, Edit, Glob, Grep, Skill` (NO MCP — the L2 win);
   added a Token-discipline section (L3 snapshot-digest + L4 vision policy);
   stopped the Phase-A double-Read of the 22K rules file (already loaded via the
   `scenarios-rules` skill); kept the IRON write-guard hook + all Rule-0 safety.
2. `.claude/agents/screenshot-interpreter.md` — NEW: `model: opus`, tools
   `Read, Glob` only, no MCP/skills, ≤5-line output contract.

**NEXT ACTION (Phase 2 — needs explicit user go; COSTS TOKENS):** single-scenario
A/B — run ONE self-contained scenario (e.g. SCEN-002/003) with the curated
runner, extract its subagent `usage` (§7), compare cost-weighted tokens to the
§1 Opus baseline. Confirm: (a) turn-1 base dropped well below 213K (proves the
no-MCP `tools:` sheds the schemas), (b) peak context stays manageable, (c) the
scenario still PASSes. Do NOT run until the user OKs a paid validation run.

**DO NOT** spawn any scenario-runner / scenario-executor to "validate" until the
user OKs a paid validation run — the batch is HALTED over the token incident.
Verification (§7) is a single 1-scenario A/B, run only on explicit go.

**Load-bearing facts / gotchas:**
- Peak context ~445K > 200K ⇒ the executor MUST be a **1M-context** model
  (`sonnet[1m]`), not base Sonnet. Confirmed by `maxRead ≈ 445K` in the data.
- ~95K of the 213K base (both CLAUDE.md + all 27 `~/.claude/rules/`) is
  **harness-injected into every agent** and CANNOT be shed by the agent.md.
  The **sheddable** ~118K is tool/MCP schemas + the dev-browser skill + the
  scenario file — a curated `tools:` list with NO MCP servers reclaims most.
- `cache_creation` is INCREMENTAL (~0.9–1.3M/run total), NOT the killer.
  Do not over-index on cache TTL expiry; the killer is cache_READ volume.
- The executor must NOT accumulate raw dev-browser snapshots in its own
  context (that is the 213K→445K growth, re-read every turn). Snapshots are
  consumed, distilled to a concise digest, and the raw blob is dropped.

**SUPERSEDED — do NOT carry forward:**
- ✗ "base context is ~140K" (my pre-measurement estimate). Real base ≈ **213K**.
- ✗ "dev-browser cache-busting re-bills the full 140K dozens of times." The
  cache_creation is incremental; the real mechanism is cache_READ of the
  growing context, every turn.

**Durable artifacts to read before acting:**
- This TRDD §1–§5 (the measured numbers + the design).
- `.claude/agents/scenario-runner.md` (current Opus runner — the thing being replaced).
- `tests/scenarios/SCENARIOS_TESTS_RULES.md` Rule 8 (dev-browser) + Rule 13 (autonomous batch).
- `.claude/rules/prevent-subagents-to-write-outside.md` (IRON write-guard the executor must keep).

---

## §1. Problem & investigation (measured)

The overnight batch exhausted a week of tokens. Measured per-run cost from the
real subagent transcripts (one run = one `scenario-runner` subagent):

| Metric | Per run | Note |
|---|---|---|
| Turns (assistant) | ~240–294 | one per tool-call round |
| **cache_read** | **~85–105M tokens** | **DOMINANT** — context re-read every turn |
| cache_creation | ~0.9–1.3M | incremental writes; not the killer |
| input (uncached) | ~70–141K | tiny |
| output | ~14–70K | tiny |
| base context (turn 1) | **~213K** | the system prompt (see §2 breakdown) |
| peak context | **~445K** | base + accumulated dev-browser snapshots |
| cost-weighted total | **~10–12M tok-equiv/run** | cc×1.25 + cr×0.10 + in + out |

Across ~7 Opus runs that is ~70–80M cost-weighted tokens at **Opus** rate — the
observed week-in-hours burn.

## §2. Root-cause model

Cost ≈ Σ_turns (context_size_at_turn). With ~284 turns and context averaging
~344K, cache_read ≈ 98M. Two additive components:

1. **Base re-read:** base 213K × 284 turns ≈ **60M**. The base system prompt is
   re-read on every turn. Decomposition of the ~213K (approx):
   - both CLAUDE.md (global ~7.8K + project ~27K) ≈ **35K** — harness-injected.
   - all 27 `~/.claude/rules/*.md` ≈ **60K** — harness-injected.
   - full tool + MCP tool-schema definitions (serena 30+, chrome-devtools 30+,
     grepika, codegraph, …) ≈ **50–100K** — **controllable** via `tools:` / no MCP.
   - dev-browser skill ≈ **57K** — needed by the executor; trim only at source.
   - scenario file + SCENARIOS_TESTS_RULES + agent.md ≈ remainder.
2. **Accumulation re-read:** context grows 213K→445K as raw dev-browser
   accessibility snapshots (5–20K each) pile up; that growth (avg +~130K) ×
   284 turns ≈ **38M**.

`cache_creation` is incremental and small — NOT the driver. The driver is the
re-read of (base + accumulated snapshots) every turn, at Opus rate.

## §3. The four levers (each validated by the data)

| # | Lever | Attacks | Est. effect |
|---|---|---|---|
| **L1** | **Sonnet[1m] executor** (was Opus) | the per-token RATE on all ~98M cache_read | ~5× cheaper $ (Sonnet ≈ 1/5 Opus). 1M context REQUIRED (peak 445K). |
| **L2** | **Curated minimal-tool agent** (no MCP, tiny `tools:`) | the controllable ~118K of base, re-read every turn | base ~213K→~100K ⇒ ~113K×284 ≈ **33M fewer** cache_read |
| **L3** | **Offload dev-browser bulk to the interpreter; keep only a concise digest in the executor** | the 213K→445K accumulation | removes the ~38M growth component |
| **L4** | **Opus screenshot-interpreter sub-agent, concise output, invoked rarely** | preserves vision quality WITHOUT paying Opus on 284 turns | Opus billed only on the few steps the a11y tree can't answer |

Combined projection: cache_read ~98M → ~25–30M (base ~100K re-read + minimal
growth), then L1 makes that ~5× cheaper in dollars → **order ~15× dollar
reduction per run**. To be confirmed by the §7 A/B.

## §4. Target architecture — 2-tier

```
                 ┌──────────────────────────────────────────┐
   orchestrator  │  scenario-executor  (model: sonnet[1m])    │
   spawns ──────▶│  • curated: Bash/Read/Write/Edit/Glob/Grep │
                 │  • loads ONLY dev-browser skill, NO MCP     │
                 │  • drives UI; reads a11y snapshots          │
                 │  • DISTILLS each snapshot to a digest,      │
                 │    DROPS the raw blob (L3)                  │
                 │  • FIX-AS-YOU-GO, writes report + proposals │
                 │  • returns 2-line verdict                   │
                 └───────────────┬────────────────────────────┘
                                 │ only when pixels are needed
                                 ▼
                 ┌──────────────────────────────────────────┐
                 │  screenshot-interpreter (model: opus)      │
                 │  • tools: Read (screenshot path) only      │
                 │  • input: 1 screenshot + 1 focused question │
                 │  • output: CONCISE (≤5 lines): what's on    │
                 │    screen / does X appear / coordinates     │
                 └────────────────────────────────────────────┘
```

- The executor uses the **accessibility snapshot** (`page.snapshotForAI`) for
  almost all steps — it is text, structured, and cheap to distill. Pixel
  interpretation is the EXCEPTION, routed to L4.
- The executor NEVER keeps a raw a11y snapshot or screenshot in its running
  context beyond the turn that consumes it: it extracts the few facts it needs
  (element present? bbox? text?) and proceeds. This is the L3 discipline.

## §5. What a curated agent CAN and CANNOT shed (honest constraint)

- **CANNOT shed (harness-injected into every agent):** global `~/.claude/CLAUDE.md`,
  project `ai-maestro/CLAUDE.md`, all `~/.claude/rules/*.md`, project
  `.claude/rules/*.md`. ≈ **95K**, fixed. An agent.md cannot opt out.
- **CAN shed (agent-controllable):** MCP server tool-schemas + instructions
  (serena/chrome-devtools/grepika/codegraph/…), the breadth of built-in
  `tools:`, and any non-essential auto-loaded skills. ≈ **80–120K**.
  ⇒ a curated executor declaring a TINY `tools:` set and **zero MCP servers**,
  loading **only** the dev-browser skill, reclaims the bulk of the sheddable base.
- **The real plugin win (future):** when the runner ships as a standalone
  plugin run from a minimal working dir, even the ~95K harness floor can be cut
  (a pared scenario-only CLAUDE.md + a scenario-only rules set). Out of scope
  for Phase 1; captured in §8.

## §6. Implementation plan (phased)

- **Phase 1 (this session — file writes only, no spawns, no token risk): DONE.**
  - DECISION: curate `scenario-runner.md` IN PLACE rather than fork a new
    `scenario-executor.md`. Reasons: single-source-of-truth (two near-identical
    280-line agent files would drift — the user's own recheck/DRY principle);
    the `run-scenarios-batch` skill + the Rule 13 cron reference the agent by
    the name `scenario-runner`, so in-place is least-disruptive; the Opus
    baseline survives in git history + the measured §1 numbers, so no separate
    file is needed for A/B.
  - `scenario-runner.md`: `model: sonnet[1m]`; explicit `tools:` (no MCP, L2);
    Token-discipline section (L3 + L4); removed the Phase-A 22K rules double-Read;
    IRON write-guard + Rule-0 safety retained verbatim.
  - `screenshot-interpreter.md` (NEW): opus, `Read, Glob` only, ≤5-line contract.
  - Commit (no push; ai-maestro is commit-only).
- **Phase 2 (on explicit user go — costs tokens):**
  - Single-scenario A/B validation (§7) on a self-contained scenario (e.g.
    SCEN-002 or SCEN-003). Measure cost vs the baseline numbers in §1.
  - Iterate the executor prompt until a self-contained scenario passes end-to-end.
- **Phase 3:** wire the batch runner (`run-scenarios-batch` skill / Rule 13 cron
  prompt) to spawn `scenario-executor` instead of `scenario-runner`.
- **Phase 4 (plugin):** extract executor + interpreter + dev-browser-routing +
  the curated-context discipline into a standalone scenario-running plugin;
  there, cut the ~95K harness floor too (§8).

## §7. Verification plan (reproducible, fact-based)

Reuse the exact measurement that found the root cause. After a new-architecture
run, extract the executor (and interpreter) subagent `usage` from their
transcripts and compare to the §1 baseline:

```python
# per transcript: sum input/cache_creation/cache_read/output over assistant turns;
# cost-weighted = cc*1.25 + cr*0.10 + input + output  (Sonnet $ then ~1/5 Opus)
```

**Acceptance:** for a self-contained scenario, new-architecture cost-weighted
tokens (executor + interpreter combined, at their model rates) are **≤ ~1/8** of
the Opus baseline for the same scenario, with the scenario still PASSing
end-to-end (FIX-AS-YOU-GO intact). Record the before/after in this TRDD.

## §8. Plugin migration (Phase 4)

Carry into a standalone `scenario-runner` plugin: the executor + interpreter
agent defs, the dev-browser routing/digest discipline, the curated tool set,
and a **scenario-only context floor** (minimal CLAUDE.md + minimal rules in the
plugin's run dir) to cut the ~95K harness floor that an in-repo agent cannot.
The plugin is the place where L2 can go past the harness-injection limit.

## §9. Risks / open questions

- **Interpreter spawn cost:** each Opus interpreter spawn also pays its own
  base-context tax (~95K harness floor + its tiny tools). Mitigation: invoke it
  RARELY (a11y tree answers most steps); consider one persistent interpreter
  fed via SendMessage instead of N fresh spawns. Measure in Phase 2.
- **Subagents likely cannot nest-spawn other subagents.** The runner's own
  rules say "NEVER spawn nested subagents," and the curated runner has NO
  `Agent` tool (deliberate — the agent-type registry is itself large base
  context that would defeat L2). CONSEQUENCE: the Sonnet executor does NOT
  spawn the Opus interpreter directly. The L4 path is (a) the executor uses its
  OWN Sonnet vision for the rare pixel question (Sonnet has vision; the a11y
  tree covers almost everything anyway), and (b) for a genuinely Opus-grade
  pixel case it flags `NEEDS-OPUS-VISION: <path> — <question>` in its report and
  the ORCHESTRATOR (or user) invokes `screenshot-interpreter`. Whether nesting
  is allowed in this Claude Code build is unconfirmed; the design does not
  depend on it.
- **Sonnet UI-driving quality:** Sonnet may need more explicit step instructions
  than Opus. Mitigation: the scenario files are already explicit; FIX-AS-YOU-GO
  + the interpreter cover the gaps. Validate in Phase 2.
- **Does a subagent actually inherit MCP servers?** The transcripts didn't
  confirm MCP injection into subagents (system prompt isn't transcribed). If
  subagents do NOT auto-load MCP, part of L2's win is already present and the
  remaining base is mostly CLAUDE.md+rules+skill. Confirm by measuring the
  executor's turn-1 base in Phase 2 (target: well under 213K).
- **1M-context availability for Sonnet subagents:** confirm `sonnet[1m]` is a
  valid `model:` for a project agent in this Claude Code build; fall back to the
  highest-context Sonnet variant available if not.

## Approval log
- 2026-06-23T20:14:21+0200 — Authored by the Opus session under /go-on-yourself
  (user directly ordered the investigation + redesign). Tier 0 (in-scope test
  infrastructure). Phase 1 (file writes) proceeds; Phase 2+ (paid validation)
  waits for explicit user go because the scenario batch is HALTED over the
  token-burn incident.
