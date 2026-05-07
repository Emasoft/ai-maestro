# Claude Code 2.1.113 - 2.1.132 Compatibility Audit

**Audited:** 2026-05-07
**Branch:** `feature/phase6-jsonl-rebase-test` (fast-forwards to `governance-rules`)
**Server version:** v0.29.x

This file enumerates every entry in the Claude Code 2.1.113-2.1.132
changelog that COULD have affected AI Maestro, the audit verdict for
each, and the action (or non-action) we took.

The audit was triggered by a request to "apply all necessary updates
to the code of the fork (both branches)" after the user noticed some
plugins were reading stale governance rules / API surface from the
fork. Branch-alignment is handled separately (Phase F of the same
work batch); this doc is the per-changelog-entry record.

## Verdict legend

- **APPLIED**     — code change landed in this repo
- **OUT-OF-REPO** — change required, but in a separate repo
                    (`Emasoft/ai-maestro-plugin`, role-plugins)
- **AWARENESS**   — opt-in feature we may use later; no action needed now
- **N/A**         — doesn't apply to AI Maestro (terminal cosmetics, IDE
                    integration, OAuth refinements not on our path)

## Per-entry verdicts

### 2.1.132 — May 6, 2026

| Change | Verdict | Notes |
|---|---|---|
| `CLAUDE_CODE_SESSION_ID` Bash env var | AWARENESS | Our hooks already correlate via the JSONL session id derived from the file path; no scripts need changing |
| `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` | N/A | Terminal renderer; we don't ship terminal config |
| Various input/render fixes | N/A | CLI-only |

### 2.1.131 — May 6, 2026

| Change | Verdict | Notes |
|---|---|---|
| VS Code activation fix | N/A | IDE plugin, not us |
| Mantle endpoint x-api-key | N/A | Anthropic gateway, not us |

### 2.1.129 — May 6, 2026

| Change | Verdict | Notes |
|---|---|---|
| `--plugin-url <url>` flag | AWARENESS | Could let scenario-runner load plugins from a tarball without going through the marketplace flow; deferred |
| `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` | N/A | Homebrew/WinGet auto-update; AI Maestro is yarn-installed |
| Plugin manifests: `themes` and `monitors` should move under `experimental:` | OUT-OF-REPO | Audited every `plugin.json` in this repo: ZERO matches at top level. The advisory applies to plugins in `Emasoft/ai-maestro-plugin` and the role-plugin repos — those need a separate sweep |
| Gateway `/v1/models` opt-in via env var | N/A | We don't run a gateway |
| `skillOverrides` setting now works | AWARENESS | We don't currently set this |

### 2.1.128 — May 4, 2026

| Change | Verdict | Notes |
|---|---|---|
| MCP `workspace` is a reserved server name | OUT-OF-REPO | Audited this repo: ZERO MCP server configs use `workspace` as a name. Role-plugins / ai-maestro-plugin should be re-audited if they ship MCP configs |
| `EnterWorktree` creates from local HEAD | AWARENESS | Affects scenario-improvement-implementer subagents; documented in `tests/scenarios/SCENARIOS_TESTS_RULES.md` |
| Subprocesses no longer inherit `OTEL_*` env vars | AWARENESS | Means our `bash` tool calls won't accidentally export OTLP endpoints; safe-by-default |

### 2.1.126 — May 1, 2026

| Change | Verdict | Notes |
|---|---|---|
| `claude project purge [path]` | AWARENESS | Could nuke our agent's `~/.claude/projects/` data — document in operations guide as "do not run on agent project dirs" |
| `--dangerously-skip-permissions` now bypasses `.claude/`, `.git/`, `.vscode/`, shell config | **AWARENESS — security implication** | Our docs already mark `--dangerously-skip-permissions` as user-only; agent role-plugins MUST NOT pass this flag. No code change needed since we never enabled it for agents |

### 2.1.122 — April 28, 2026

| Change | Verdict | Notes |
|---|---|---|
| `ANTHROPIC_BEDROCK_SERVICE_TIER` env var | N/A | Bedrock-specific |
| `--from-pr` accepts GitHub Enterprise/GitLab/Bitbucket URLs | AWARENESS | Future scenario `/branch` flows could use this |

### 2.1.121 — April 28, 2026

| Change | Verdict | Notes |
|---|---|---|
| `alwaysLoad: true` MCP option | AWARENESS | Could mark our MCP tools as always-loaded if tool-search latency ever bothers us |
| `claude plugin prune` | AWARENESS | We have our own R20 plugin lifecycle; no action |
| `PostToolUse` hooks: `hookSpecificOutput.updatedToolOutput` for all tools (was MCP-only) | OUT-OF-REPO | Could improve our `ai-maestro-hook.cjs` in the ai-maestro-plugin repo to inject corrections without re-prompting |
| `--dangerously-skip-permissions` still skips writes to `.claude/skills`/`.claude/agents`/`.claude/commands` | AWARENESS | Same as 2.1.126; security boundary unchanged for our agents |

### 2.1.120 — April 28, 2026

| Change | Verdict | Notes |
|---|---|---|
| Windows: PowerShell fallback when Git Bash absent | N/A | Cross-platform agent support documented; no AI Maestro change |
| `${CLAUDE_EFFORT}` in skills | OUT-OF-REPO | We don't currently template effort into skills; could add to ai-maestro-plugin skills if we want effort-aware behavior |
| `claude ultrareview [target]` | AWARENESS | New subcommand, not part of our test pipeline |

### 2.1.119 — April 23, 2026

| Change | Verdict | Notes |
|---|---|---|
| `--print` mode honors agent's `tools:`/`disallowedTools:` frontmatter | OUT-OF-REPO | Affects how role-plugin agents behave under `claude -p`; verify role-plugin frontmatters declare tools correctly |
| `--agent <name>` honors `permissionMode` | OUT-OF-REPO | Same as above |
| `PostToolUse`/`PostToolUseFailure` hook input includes `duration_ms` | AWARENESS | Could be logged by `ai-maestro-hook.cjs` if we ever care |
| `prUrlTemplate` setting | AWARENESS | We could point footer PR badges at a custom code-review URL |

### 2.1.118 — April 23, 2026

| Change | Verdict | Notes |
|---|---|---|
| Vim visual mode (`v` / `V`) | N/A | Editor mode |
| `/cost` and `/stats` merged into `/usage` | AWARENESS | If our docs mention `/cost` or `/stats` as user actions, update to `/usage`; quick grep shows we don't |
| Hooks can invoke MCP tools directly via `type: "mcp_tool"` | OUT-OF-REPO | New capability; could simplify our hook authoring in ai-maestro-plugin |
| `DISABLE_UPDATES` (stricter than `DISABLE_AUTOUPDATER`) | AWARENESS | Useful for production deployments where the update binary path is read-only |

### 2.1.117 — April 22, 2026

| Change | Verdict | Notes |
|---|---|---|
| `CLAUDE_CODE_FORK_SUBAGENT=1` works on external builds | AWARENESS | Already used by our `scenario-runner` skill |
| Agent frontmatter `mcpServers` honored for main-thread `--agent` sessions | OUT-OF-REPO | Role-plugin main-agent .md files COULD now declare per-agent MCP servers; requires repo-by-repo update |
| Native build replaces Glob/Grep with embedded `bfs`/`ugrep` | AWARENESS | Faster file searches; transparent to AI Maestro |

### 2.1.116 — April 20, 2026

| Change | Verdict | Notes |
|---|---|---|
| Faster `/resume` on large sessions | N/A | CLI-only |

### 2.1.114 / 2.1.113 — April 17/18, 2026

| Change | Verdict | Notes |
|---|---|---|
| Native binary spawn via per-platform optional dep | N/A | Transparent to AI Maestro |
| `sandbox.network.deniedDomains` setting | AWARENESS | We could harden agent sessions by deny-listing exfiltration targets |
| `Bash(rm:*)` allow rules: macOS dangerous-path matching includes `/private/{etc,var,tmp,home}` | AWARENESS | Better default safety; aligns with our agent permission model |
| `find -exec`/`-delete` no longer auto-approved by `Bash(find:*)` | AWARENESS | Same security tightening |

## Repo-by-repo follow-up

These items are tracked here so the next update sweep can address them
in the right repo:

### `Emasoft/ai-maestro-plugin` (the core plugin)

- [ ] Audit `hooks/*.cjs` for `PostToolUse` opportunities to use the
      new `hookSpecificOutput.updatedToolOutput` for non-MCP tools
      (2.1.121) — would let our hooks correct tool output without
      re-prompting.
- [ ] Consider adopting `type: "mcp_tool"` hook payloads (2.1.118)
      to simplify scripts that currently shell out.
- [ ] Validate the plugin's `.claude-plugin/plugin.json` doesn't have
      `themes` or `monitors` at the top level (2.1.129).

### Role-plugin repos (8 of them, see CLAUDE.md "Editing Role-Plugins")

- [ ] Audit each plugin's `.claude-plugin/plugin.json` for top-level
      `themes` / `monitors` (2.1.129).
- [ ] Audit each main-agent `.md` frontmatter for `tools:` /
      `disallowedTools:` / `permissionMode` declarations — these now
      take effect under `claude --agent` and headless `-p` mode (2.1.119).
- [ ] Verify no MCP server is named `workspace` (2.1.128).

### `Emasoft/ai-maestro` (THIS REPO) — verdict

ZERO server-side code changes required for 2.1.113-2.1.132. Verified
by:

```bash
# Plugin manifests with themes/monitors at top level
find . -name "plugin.json" -not -path "*/node_modules/*" \
  -not -path "*/_dev/*" -not -path "*/.next*/*" \
  -not -path "*/scripts_dev/*" \
  -not -path "*/tests/scenarios/state-backups/*" \
  | xargs grep -l '"themes"\|"monitors"' 2>/dev/null
# → no output

# MCP server name "workspace"
grep -rn '"workspace"\|workspace:' --include="*.json" --include="*.ts" \
  --include="*.mjs" 2>/dev/null | grep -i mcp
# → no output

# --print mode usage that depends on agent frontmatter
grep -rn "claude.*--print\|claude.*-p " services/ lib/ scripts/
# → no agent-frontmatter-sensitive callers
```

The compatibility surface this repo exposes (the API endpoints, the
governance docs, the role-plugin SKILL files) is unchanged by the
client-side changelog.
