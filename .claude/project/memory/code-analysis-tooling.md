---
name: code-analysis-tooling
description: "what is tldr / fastedit / distill / why don't the tldr hooks fire automatically / how does an agent read only relevant symbol lines instead of whole files / where do the code-analysis skills live for codex or gemini agents / scoped code reads without inflating context"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
---

# code-analysis-tooling

ai-maestro ships three CLIs as official dependencies (TRDD-ZFHY7UGU) so agents can read and
edit code by symbol/scope instead of pulling whole files into context, without any hook that
would re-bill the cached prefix on every tool call.

Three CLIs are official ai-maestro dependencies, installed by
`scripts/install-code-analysis-tooling.sh` (called from `install-messaging.sh`)
alongside the rest of the install:

- **tldr-code** (`tldr`/`tldr-daemon`/`tldr-mcp`) — read-only AST code-analysis
  CLI. A **deliberate, intentionally-invoked** instrument: agents call it to
  read only the relevant symbol/lines instead of whole files.
- **fastedit** — the AST-aware WRITE companion to tldr. Also **deliberate** —
  invoked explicitly for symbol-level edits; requires tldr on PATH first.
- **distill** — output-compression pipe. A **generic, non-discriminating**
  interceptor: wraps command output regardless of which tool produced it.

**Coexistence model:** distill wraps command output; tldr and fastedit are
invoked on purpose when an agent wants deliberate, scoped code analysis or
edits. **The tldr hooks stay UNWIRED** — a per-tool-call hook that injects into
the transcript retroactively mutates the cached prefix and re-bills the whole
prompt, so ai-maestro ships no read-interception hook at all.

See `~/.claude/rules/tldr-cli.md` and the `tldr-code` skill for the full
command reference.

**Cross-client variants (TRDD-ANYCPRTX):** ai-maestro drives agents on any CLI
coding-agent client, so the unified skill ships per-client source under
`scripts/code-analysis-skill/<client>/` — `claude`, `codex`, `gemini`,
`opencode`, `kiro` (adapted SKILL.md), plus hand-authored `github-copilot`
(`.github/copilot-instructions.md`) and `kilocode` (`.kilocode/rules/`).
`scripts/distribute-code-analysis-skill.sh` (run by the installer, fail-soft)
copies each variant into a detected client's global config dir; github-copilot +
kilocode are per-workspace, so their placement is printed rather than
auto-applied.

## See also

## Notes and lessons learned
