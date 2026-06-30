---
trdd-id: ANYCPRTX
title: Author cross-client variants of the unified tldr-code+fastedit skill (codex/gemini/kiro/opencode)
column: todo
created: 2026-06-30T20:37:03+0200
updated: 2026-06-30T20:37:03+0200
current-owner: main
assignee: main
priority: 4
severity: LOW
effort: L
labels: [tooling, skills, cross-client, code-analysis]
task-type: feature
parent-trdd: null
npt: [TRDD-ZFHY7UGU]
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-06-30

- **Status:** PLAN authored (column `todo`). Awaiting USER greenlight to implement.
- **Depends on (NPT):** TRDD-ZFHY7UGU (the 4 tools installed as deps on the client
  machine: tldr-code, **fastedit**, lean-ctx, distill).
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

Every supported non-Claude client (codex, gemini, kiro, opencode, github-copilot)
has a working variant of the unified tldr-code+fastedit skill, so agents on those
clients invoke tldr (read) + fastedit (write) intentionally, just like Claude agents.

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
- Clarify "kilo" (Kiro? KiloCode?) and the exact target-client list.
- Packaging: into ai-maestro-plugin vs standalone skill.
- Does lean-ctx (and distill) exist for non-Claude clients? (drives the per-client
  invocation note.)

## Acceptance
- Unified skill variants exist + load for each target client; cross-client agents
  can invoke tldr + fastedit intentionally. Commit-only, NO push (USER-gated).
