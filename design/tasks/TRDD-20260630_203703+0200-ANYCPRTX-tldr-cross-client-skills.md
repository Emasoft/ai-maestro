---
trdd-id: ANYCPRTX
title: Author cross-client tldr-code+fastedit skill variants for all CLI ai-code clients
column: complete
created: 2026-06-30T20:37:03+0200
updated: 2026-07-10T04:20:51+0200
implementation-commits: [a5909778]
current-owner: main
assignee: main
priority: 4
severity: LOW
effort: L
labels: [tooling, skills, cross-client, code-analysis]
task-type: feature
parent-trdd: TRDD-ZFHY7UGU
derived: true
derived-kind: eht
npt: []
eht: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
test-requirements: []
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: []
external-refs: ["github.com/parcadei/tldr-code", "github.com/parcadei/fastedit"]
---

# TRDD-ANYCPRTX — Cross-client variants of the unified tldr-code+fastedit skill

> **Graph correction 2026-07-10 (corpus sweep).** This TRDD declared
> `npt: [TRDD-ZFHY7UGU]` while ZFHY7UGU declared `eht: [TRDD-ANYCPRTX]` — each
> claiming the other as its child, which is a cycle. Both statements were true as
> *ordering* ("this needs the four tools installed"; "shipping the tools obliges a
> per-client skill"), and ordering is not derivation. ZFHY7UGU is the parent: its
> own Open-questions section already calls this TRDD "EHT TRDD-ANYCPRTX", and this
> work exists *because* the tools became official deps. So `parent-trdd` is now
> ZFHY7UGU, this is its EHT, and the npt edge is gone. The prerequisite it stood
> for needs no separate edge — an effect follows its cause.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-06-30

- **▶ PIVOT 2026-07-01 (USER-directed):** the hand-authored variants shipped here are being
  SUPERSEDED by CONVERTER-GENERATED variants (all 6 clients from the single Claude source) via
  **TRDD-S4YA67F5** (converter gains github-copilot+kilocode) + its generator. This TRDD stays
  `complete` for its original hand-authored scope; the authoritative cross-client variants now
  come from S4YA67F5.
- **Status:** DONE — implemented + committed (`a5909778`) on 2026-07-01. column:
  complete. Approach B shipped: 7 in-repo per-client variants under
  `scripts/code-analysis-skill/` (claude canonical + codex/gemini/opencode/kiro +
  hand-authored copilot/kilocode) + conservative `distribute-code-analysis-skill.sh`.
  Follow-ups (out of scope, documented): verify exact per-client skill frontmatter/
  load-path against each client's docs; optional converter-path DRY migration needs
  the skill added to ai-maestro-plugin (separate repo).
- **Parent (this is an EHT of):** TRDD-ZFHY7UGU — which installed the 4 tools as
  deps on the client machine (tldr-code, **fastedit**, lean-ctx, distill). Making
  them official deps is what obliges a per-client skill; that is the effect this
  TRDD handles. (Until 2026-07-10 this line read "Depends on (NPT)", and the
  frontmatter matched — see the graph-correction note above.)
- **Origin:** ai-maestro runs ANY CLI ai-code client. The 4 tools are
  client-agnostic CLIs; the SKILL that teaches INTENTIONAL use must exist in each
  client's skill/instruction format. The canonical skill is the UNIFIED
  `tldr-code` skill authored this session (READ via tldr + WRITE via fastedit, one
  skill, ≤5000 tok).
- **NEXT ACTION:** read the cross-client converter (`lib/converter/universal-ir.ts`,
  `services/plugin-storage-service.ts` `emitForClient`/`convertAndStorePlugin`,
  `lib/client-plugin-adapters/`) + decide packaging (Phase A), then emit variants.
- **Load-bearing facts:**
  - The unified skill lives at `~/.claude/skills/tldr-code/SKILL.md` (Claude format).
  - tldr/fastedit/distill commands are IDENTICAL across clients (same CLIs) — the
    cross-client work is FORMAT conversion + client-appropriate invocation notes,
    not content rewrites.
  - The lean-ctx allowlist note is likely Claude-only (lean-ctx wraps Claude's
    shell). Confirm whether lean-ctx/distill exist for other clients; adapt/omit
    that note per client.
- **Durable artifacts:** `~/.claude/skills/tldr-code/` (the unified skill + refs);
  `docs_dev/2026-03-31-crucible-integration-analysis.md` (cross-client converter analysis).

## Goal

Every supported CLI ai-code client has a working variant of the unified
tldr-code+fastedit skill, so agents on those clients invoke tldr (read) + fastedit
(write) intentionally, just like Claude agents. See "Target clients (RESOLVED)".

## Target clients (RESOLVED — USER 2026-07-01)

**IN scope — every CLI-based ai-code client:**
- `claude` (Claude Code) — the canonical/base skill (authored this session)
- `codex` (OpenAI Codex CLI)
- `gemini` (Gemini CLI)
- `opencode` (OpenCode CLI)
- `github-copilot` (GitHub Copilot CLI)
- `kiro` — explicitly named by USER
- `kilocode` — explicitly named by USER
- …plus ANY other CLI-based ai-code client ai-maestro supports now or later —
  folding the skill into ai-maestro-plugin (Phase A) makes new CLI clients inherit
  it automatically.

**OUT of scope (hard exclusions):**
- `aider` — explicitly excluded by USER (despite being CLI).
- Every non-CLI / GUI / IDE client — **cursor**, windsurf, zed, VS Code
  extensions, JetBrains, etc. Rule: the client MUST be terminal-driven CLI. Not a
  terminal → out.

**Converter gap:** ai-maestro's converter (`lib/client-plugin-adapters/`) today
supports claude/codex/gemini/opencode/kiro/github-copilot. **`kilocode` has NO
adapter yet** → add a KiloCode adapter (NPT of impl), OR confirm KiloCode consumes
an existing format (e.g. VS Code-style) before assuming.

## Plan (phased — implement only after USER greenlight)

### Phase A — packaging decision
- Recommend: fold the unified `tldr-code` skill (+ a short distill/lean-ctx usage
  doc) into the core **ai-maestro-plugin**, so the EXISTING cross-client converter
  emits per-client variants automatically. Alternative: a standalone skill run
  through the converter. Decide based on the converter's input expectations.

### Phase B — leverage the cross-client converter
- Use `emitForClient(name, <client>)` / the `UniversalPluginIR` pipeline +
  `lib/client-plugin-adapters/` to produce: Codex, Gemini, Kiro, OpenCode (and
  GitHub Copilot) variants. Verify each client's skill/instruction format.

### Phase C — client-appropriate content
- tldr/fastedit/distill command catalog + intentional-use recipes are universal —
  carry them verbatim. Adapt the lean-ctx allowlist note (Claude-specific) per
  client; keep the "fastedit needs tldr-code installed first" note everywhere.

### Phase D — verify each variant loads/triggers in its client.

## Open questions (resolve at impl time)
- ~~Clarify "kilo" and the exact target-client list.~~ RESOLVED 2026-07-01 — BOTH
  Kiro and KiloCode; ALL CLI ai-code clients; exclude aider + all GUI/IDE. See
  "Target clients (RESOLVED)".
- Packaging: into ai-maestro-plugin vs standalone skill (Phase A).
- Does lean-ctx (and distill) exist for non-Claude clients? Likely NOT as a shell
  wrapper — lean-ctx wraps Claude's shell and ships `ctx_*` as an MCP server
  (usable by any MCP-capable client), while distill is a plain pipe
  (client-agnostic). tldr + fastedit are standalone CLIs (fully client-agnostic).
  ⇒ per-client variant: carry tldr/fastedit content verbatim; make the lean-ctx
  allowlist note Claude-only; keep distill as an optional pipe note. CONFIRM at impl.
- KiloCode adapter absent from ai-maestro's converter (see Converter gap).

## Acceptance
- Unified skill variants exist + load for each target client; cross-client agents
  can invoke tldr + fastedit intentionally. Commit-only, NO push (USER-gated).
