---
trdd-id: N1FYP2AW
title: Token-optimized scenario-runner — Sonnet[1m] executor + Opus screenshot-interpreter
column: dev
created: 2026-06-23T20:14:21+0200
updated: 2026-06-23T21:43:37+0200
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
3. `.claude/skills/scenario-region-capture/` — NEW skill (L5): DOM/ARIA-guided
   clipped screenshots + scoped aria snapshots. Lean SKILL.md (base-cheap) +
   `references/region-capture.js` (loaded on demand). Wired into the runner's
   `skills:` frontmatter + the L5 Token-discipline rule.
4. Four child TRDDs spawned + implemented (more levers): **L6** TRDD-63K2WJ26
   batch steps/turn (`scenario-step-batch` skill + `references/step-driver.js`);
   **L7** TRDD-LLGW31JX context load-order (Phase A rule); **L8** TRDD-H3F2DFP7
   scoped source reads (`tldr search/extract` + ranged Read, no MCP — Phase D);
   **L9** TRDD-UDFMS3UN lean tool wrappers (`tests/scenarios/scripts/lean/leantool.py`,
   selftest-passing — Phase D). All wired into `scenario-runner.md`.

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
- Peak context reaches **~505–557K** (per-tool ledger §1b; corrects the earlier
  ~445K estimate) ⇒ the executor MUST be a **1M-context** model (`sonnet[1m]`)
  UNLESS L3 caps per-turn growth near the base. If L3 holds per-turn context to
  ~100–150K, base Sonnet (200K) would suffice and save even more. Measure in Ph2.
- **L3 is the #1 lever** (per-tool ledger): cost is super-linear in run length
  because per-turn context GROWS with accumulated snapshots; capping that growth
  makes cost linear in turns. 94% of the week's input came from the 6
  dev-browser runs; Bash/dev-browser was 73–88% of their tool calls.
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

## §1b. Per-tool ledger (richer evidence — `reports_dev/tools-use-log.json`)

A per-session tool log (12 sessions, 2026-06-23) sharpens §1 and supersedes the
peak estimate. The 6 dev-browser scenario runs vs the 6 non-browser sessions:

| scenario | turns | Bash% | input tok | in/turn | est peak |
|---|---|---|---|---|---|
| SCEN-001 | 367 | 88% | 141.3M | 385K | ~557K |
| SCEN-002 | 349 | 88% | 133.5M | 382K | ~552K |
| SCEN-003 | 294 | 73% | 105.6M | 359K | ~505K |
| SCEN-015 | 240 | 81% | 85.9M | 358K | ~503K |
| SCEN-012 | 227 | 81% | 79.8M | 352K | ~490K |
| SCEN-013 | 214 | 81% | 70.8M | 331K | ~448K |
| 6 non-browser | 10–75 | ≤60% | 2–19M | ~240K | — |

Hard findings:
1. **94% of all 655M input tokens came from the 6 dev-browser runs** (616.8M);
   the non-browser sessions were 6%. The dev-browser runs ARE the week.
2. **Bash (= dev-browser CLI) is 73–88% of each run's tool calls** — each returns
   a large a11y snapshot that lands in context and never leaves.
3. **Accumulation signature:** `in/turn` climbs monotonically with run length
   (214 turns→330K, 367 turns→385K) — per-turn context is NOT flat at the 213K
   base; it grows to **~505–557K** peak. (Corrects the earlier ~445K estimate.)
4. NOT a caching problem: hit rate 98%, cache_creation ~1M/run. The cost is the
   VOLUME of cache_READS — a huge, growing context re-read every turn.
5. **Super-linear in run length:** SCEN-001 had 1.7× the turns of SCEN-013 but
   2.0× the cost (longer run ⇒ bigger per-turn context). Cost ≈ ½·turns·peak.
   ⇒ L3 (cap per-turn growth) makes cost LINEAR in turns, the single biggest win.

## §1c. FULL-WEEK correction (989-session export — supersedes §1b's "94%")

§1b's "94% from dev-browser runs" was 94% of a 12-session SNIPPET — a biased
subset. The full 989-session export (`~/Downloads/export_sessions_20260623_202034.json`,
**13.15B input tokens / 38,031 turns**) shows the scenario runner is only ~7%
of the real burn:

| category | sessions | turns | input | %week | in/turn |
|---|---|---|---|---|---|
| MAIN sessions (long-lived) | 11 | 14,720 | 7.80B | **59%** | 530K |
| other subagents (feature/CPV/janitor) | 968 | 20,879 | 4.47B | **34%** | 214K |
| scenario dev-browser subagents | 10 | 2,432 | 0.88B | **7%** | 363K |

Dominant culprits at full scale:
1. **Two marathon MAIN sessions** — the current one (`e1b4c900`, 4.86B / 9,557
   turns / 11 days) + an iOS-app one (`aadcdba9`, 2.80B / 4,612 turns) = **58%
   alone**. Mechanism: thousands of turns × ~530K accumulated context, re-read
   every turn.
2. **The ~95K CLAUDE.md+rules FLOOR re-read every turn × 38,031 turns ≈ 3.6B =
   27%+** of the week (lower bound; excludes tool/MCP schemas). Cross-cuts ALL
   categories.

**This redesign addresses the 7% scenario slice.** The bigger ecosystem levers —
(a) a CLAUDE.md + `~/.claude/rules/` diet (helps every turn of every session),
and (b) main-session hygiene (don't run one session for days/thousands of
turns) — are OUT OF SCOPE here and warrant their own TRDD + user direction
(the global config is the user's to trim).

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
| **L5** | **DOM/ARIA-scoped observation** (`scenario-region-capture` skill) | the per-observation SIZE — scoped aria 0.2–2K vs 5–20K full-page; clipped screenshot ~16–320 vs ~1,365 full | shrinks every snapshot/screenshot L3 still keeps; compounds with L2/L3 and makes the L4 interpreter call cheap too |

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
  - `scenario-region-capture` skill (NEW, L5): DOM/ARIA-guided clipped
    screenshots + scoped aria snapshots; lean SKILL.md + on-demand
    `references/region-capture.js`; wired into the runner frontmatter + L5 rule.
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
