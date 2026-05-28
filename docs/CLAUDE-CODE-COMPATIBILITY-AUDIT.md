# Claude Code 2.1.113 - 2.1.154 Compatibility Audit

**Audited:** 2026-05-07 (2.1.113–2.1.132), extended 2026-05-28 (2.1.133–2.1.154)
**Branch:** `governance-rules`
**Server version:** v0.29.x

This file enumerates every entry in the Claude Code 2.1.113-2.1.154
changelog that COULD have affected AI Maestro, the audit verdict for
each, and the action (or non-action) we took.

The first pass (2.1.113–2.1.132) was triggered by a request to "apply
all necessary updates to the code of the fork (both branches)" after the
user noticed some plugins were reading stale governance rules / API
surface from the fork. The second pass (2.1.133–2.1.154) was triggered
by the **Opus 4.8 GA on 2026-05-28** (Claude Code 2.1.154) and a request
to align the code with the latest changelogs. Branch-alignment is handled
separately; this doc is the per-changelog-entry record.

**The only code change in the 2.1.133–2.1.154 range** is the cross-client
model-mapping rework for Opus 4.8 (commit on `governance-rules`,
`lib/converter/rewrite/model.ts` + `tests/unit/converter-model-mapping.test.ts`);
everything else is AWARENESS / OUT-OF-REPO / N/A. See the per-entry table
for 2.1.154.

## Verdict legend

- **APPLIED**     — code change landed in this repo
- **OUT-OF-REPO** — change required, but in a separate repo
                    (`Emasoft/ai-maestro-plugin`, role-plugins)
- **AWARENESS**   — opt-in feature we may use later; no action needed now
- **N/A**         — doesn't apply to AI Maestro (terminal cosmetics, IDE
                    integration, OAuth refinements not on our path)

## Per-entry verdicts

### 2.1.154 — May 28, 2026

| Change | Verdict | Notes |
|---|---|---|
| **Opus 4.8 GA** (defaults to high effort, `/effort xhigh`) | **APPLIED** | Cross-client model mapping reworked to family-based normalization so `claude-opus-4-8`, the 1M variant `claude-opus-4-8[1m]`, and future ids map correctly. Before this an Opus 4.8 agent → Codex emitted the literal invalid `claude-opus-4-8`. `lib/converter/rewrite/model.ts` + new test |
| Lean system prompt now default (all except Haiku/Sonnet/Opus ≤ 4.7) | AWARENESS | Agents on Opus 4.8 automatically get the lean prompt — smaller per-turn context. No code change; informs agent context-budget assumptions |
| Dynamic workflows (orchestrate tens–hundreds of agents) | AWARENESS | Conceptually overlaps the scenario-batch orchestration; could power future batch runs. Deferred |
| Fixed subagents in background sessions bypassing the worktree-isolation guard | **AWARENESS — security relevant** | Claude Code now closes a worktree-escape path at the runtime level — the exact class our `.claude/rules/prevent-subagents-to-write-outside.md` + project write-guard hook defend against. Our guard stays (belt-and-braces) |
| `defaultEnabled: false` in `plugin.json` / marketplace entry | OUT-OF-REPO | Grepped THIS repo: zero refs. Role-plugins + `ai-maestro-plugin` could declare it to ship disabled-by-default; our marketplace parsers don't read it yet. Tracked in follow-up |
| Stdio MCP subprocesses get `CLAUDE_CODE_SESSION_ID` + `CLAUDECODE=1` | AWARENESS | If we ever ship a stdio MCP server it can read these; none today |
| auto-mode classifier: better bulk-exfiltration detection | AWARENESS — security relevant | Affects agents run in auto mode; net safety gain, no code change |
| Deprecated `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` (removed 06/01) | N/A | Grepped this repo: not used anywhere |
| Fast mode on Opus 4.8 (2× rate / 2.5× speed); `/effort` label rename; `/simplify` cleanup-only; `claude agents` shell-session flags; many CLI fixes | N/A | Pricing / CLI UX / terminal runtime |

### 2.1.153 — May 28, 2026

| Change | Verdict | Notes |
|---|---|---|
| Subagent (Agent tool) frontmatter MCP servers now honor `--strict-mcp-config`, `--bare`, managed MCP policy | OUT-OF-REPO | Affects role-plugin subagents that declare `mcpServers`; verify in the plugin repos |
| `skipLfs` for `github`/`git` marketplace sources | AWARENESS | Our marketplaces aren't LFS-backed |
| Custom API gateway could receive the user's Anthropic OAuth credential (fixed) | N/A | We don't run a gateway |
| `/model` saves selection as default (press `s` for session-only); npm/doctor/agents fixes | N/A | CLI UX |

### 2.1.152 — May 27, 2026

| Change | Verdict | Notes |
|---|---|---|
| Skills & slash commands can set `disallowed-tools` in frontmatter | OUT-OF-REPO | `ai-maestro-plugin` skills could lock down tool surface per-skill; opt-in |
| `MessageDisplay` hook event (transform/hide assistant text) | OUT-OF-REPO | New `ai-maestro-hook.cjs` capability in the plugin repo |
| `/reload-skills` + `SessionStart` `reloadSkills:true` | AWARENESS | `install-messaging.sh` could trigger same-session skill reload after install; deferred |
| `claude plugin marketplace remove --scope` symmetry | AWARENESS | Our R20 lifecycle already passes `--scope` on install; remove is now symmetric |
| Auto mode no longer requires opt-in consent | AWARENESS — security relevant | Agents may enter auto mode without the prior consent gate; our docs keep `--dangerously-skip-permissions` user-only |
| `--fallback-model` on model-not-found; `SessionStart sessionTitle`; many fixes | N/A | CLI runtime |

### 2.1.150 — May 23, 2026

| Change | Verdict | Notes |
|---|---|---|
| Internal infrastructure only | N/A | No user-facing surface |

### 2.1.149 — May 22, 2026

| Change | Verdict | Notes |
|---|---|---|
| Sandbox write allowlist in git worktrees covered the whole main repo root (fixed → only shared `.git`) | AWARENESS — security relevant | Same worktree-escape class as our write-guard rule; Claude Code tightened it at runtime. Our guard stays |
| PowerShell built-in `cd` permission bypass (fixed) | AWARENESS — security relevant | Windows agent hosts; net safety gain |
| `/usage` breakdown; GFM checkboxes; `allowAllClaudeAiMcps`; `find` vnode fix | N/A | CLI / enterprise / OS |

### 2.1.148 — May 22, 2026

| Change | Verdict | Notes |
|---|---|---|
| Bash tool exit-code-127 regression (fixed) | N/A | CLI regression fix; no AI Maestro surface |

### 2.1.147 — May 21, 2026

| Change | Verdict | Notes |
|---|---|---|
| Plugin agents declaring multiple `Agent(...)` types in `tools:` frontmatter dropped all but the last (fixed) | OUT-OF-REPO | Role-plugins / `ai-maestro-plugin` agents that declare several `Agent(...)` types now keep them all; re-verify |
| `/simplify` renamed to `/code-review`; `CLAUDE_CODE_SUBAGENT_MODEL` applies to teammate processes | AWARENESS | Dev tooling / subagent model override; not in our pipeline |
| Enterprise login restriction enforcement; pinned background sessions; many fixes | N/A | CLI / enterprise |

### 2.1.145 — May 19, 2026

| Change | Verdict | Notes |
|---|---|---|
| `context: fork` skill could infinitely re-invoke itself (fixed) | AWARENESS | Our `run-scenario-test` / `scenario-runner` use `context: fork` — this fix directly benefits our forked-agent flow |
| Bare-variable-assignment permission bypass in Bash (fixed) | AWARENESS — security relevant | Tightens what agents can auto-run |
| `claude agents --json`; Stop/SubagentStop hook input adds `background_tasks`, `session_crons` | AWARENESS | The hook fields could enrich `ai-maestro-hook.cjs`; `--json` could complement tmux session discovery |
| `/plugin` pre-install component view; OTEL parenting; status-line PR info | N/A | CLI / telemetry |

### 2.1.144 — May 19, 2026

| Change | Verdict | Notes |
|---|---|---|
| Skill tool failing with permission error in headless mode (fixed) | AWARENESS | Our headless scenario runs invoke skills; this fix is relevant |
| Plugins enabled only by a project's `.claude/settings.json` show actionable `claude plugin install` hint | AWARENESS | Aligns with our per-agent local-scope install model |
| `/resume` for background sessions; "extra usage"→"usage credits"; many scroll/Windows fixes | N/A | CLI UX |

### 2.1.143 — May 15, 2026

| Change | Verdict | Notes |
|---|---|---|
| Plugin dependency enforcement: `disable` refuses if depended-on, `enable` force-enables transitive deps | OUT-OF-REPO / AWARENESS | If role-plugins declare dependencies, our `ChangePlugin` enable/disable semantics interact with this. Verify the R20 lifecycle still behaves when CLI refuses a disable |
| Stop hooks that block repeatedly now capped at 8 blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) | AWARENESS | Our janitor heartbeat uses CronCreate, not Stop-hook blocking — unaffected. Any future Stop hook we ship must respect the cap |
| Worktree cleanup no longer falls back to `rm -rf` when `git worktree remove` fails | AWARENESS — security relevant | Aligns with our safe-delete philosophy; protects gitignored/in-progress files in scenario worktrees |
| `worktree.bgIsolation: "none"`; PowerShell `-ExecutionPolicy Bypass`; many fixes | N/A | CLI / Windows |

### 2.1.142 — May 14, 2026

| Change | Verdict | Notes |
|---|---|---|
| Plugins with a root-level `SKILL.md` (no `skills/` subdir) now surfaced as a skill | AWARENESS | Our skills live in `skills/<name>/SKILL.md` (subdir form) — unaffected, but confirms the parsing rule |
| Fast mode → Opus 4.7 default (`CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE`) | N/A | Superseded by 2.1.154 Opus 4.8; env var not in repo |
| `MCP_TOOL_TIMEOUT` now raises remote HTTP/SSE per-request timeout | AWARENESS | Relevant only if we add slow remote MCP tools |
| `claude agents` flags; background-session sleep/wake fixes | N/A | CLI |

### 2.1.141 — May 13, 2026

| Change | Verdict | Notes |
|---|---|---|
| `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` (clone plugin sources over HTTPS, not SSH) | AWARENESS | Useful on agent hosts without a GitHub SSH key; our `claude plugin marketplace add` defaults to SSH |
| `terminalSequence` hook output field (desktop notifications / titles / bell) | OUT-OF-REPO | `ai-maestro-hook.cjs` could emit notifications without a controlling terminal |
| Plugin MCP `.mcp.json` config-var + malformed-entry fixes | OUT-OF-REPO | Affects `ai-maestro-plugin` MCP declarations |
| `ANTHROPIC_WORKSPACE_ID`; `claude agents --cwd`; many UI fixes | N/A | CLI / federation |

### 2.1.140 — May 12, 2026

| Change | Verdict | Notes |
|---|---|---|
| Plugins warn when a default component folder is ignored because `plugin.json` sets the matching key | OUT-OF-REPO | Re-validate `ai-maestro-plugin` + role-plugin manifests don't shadow default folders |
| `Agent` tool `subagent_type` now case/separator-insensitive | AWARENESS | Our spawns use exact names; more lenient matching is harmless |
| Settings hot-reload symlink fix; `/goal` hook-disable fix | N/A | CLI |

### 2.1.139 — May 11, 2026

| Change | Verdict | Notes |
|---|---|---|
| Stdio MCP servers get `CLAUDE_PROJECT_DIR`; plugin configs can reference `${CLAUDE_PROJECT_DIR}` in commands | AWARENESS | Our plugin hook commands already use `${CLAUDE_PROJECT_DIR}`; now parity for MCP commands too |
| Hook `args: string[]` exec form (no shell, no quoting) + `continueOnBlock` for PostToolUse | OUT-OF-REPO | `ai-maestro-hook.cjs` could adopt exec-form to avoid path-quoting bugs |
| Compaction prompt now preserves sensitive user instructions | AWARENESS — security relevant | Better retention of governance constraints across compaction |
| `Skill(name *)` wildcard permission prefix match; agent view (`claude agents`) preview; `/goal` | AWARENESS | Agent-view overlaps the dashboard concept; informational |

### 2.1.138 / 2.1.137 — May 9, 2026

| Change | Verdict | Notes |
|---|---|---|
| Internal fixes / VS Code Windows activation fix | N/A | IDE / internal |

### 2.1.136 — May 8, 2026

| Change | Verdict | Notes |
|---|---|---|
| `settings.autoMode.hard_deny` (unconditional auto-mode block rules) | AWARENESS — security relevant | We could hard-deny destructive actions for agents running in auto mode |
| A `skills` key in `plugin.json` hiding the default `skills/` dir (now errors) | OUT-OF-REPO | Re-validate `ai-maestro-plugin` manifest doesn't set a `skills` key that shadows the folder |
| MCP servers disappearing after `/clear` (fixed); many render/layout fixes | N/A | CLI |

### 2.1.133 — May 7, 2026

| Change | Verdict | Notes |
|---|---|---|
| **`worktree.baseRef` setting (`fresh` \| `head`); default is now `fresh`** — `--worktree`, `EnterWorktree`, and agent-isolation worktrees branch from `origin/<default>` instead of local `HEAD` | **AWARENESS — relevant** | Directly affects our worktree-isolated `scenario-improvement-implementer`. Grepped: we don't set `baseRef`, so we inherit `fresh` (branch from `origin/<default>`). If a scenario fix needs unpushed local commits as its base, set `worktree.baseRef: "head"`. No code change; behavioral inheritance to document in operations |
| Hooks receive `effort.level` / `$CLAUDE_EFFORT` | AWARENESS | `ai-maestro-hook.cjs` could log or branch on effort |
| `sandbox.bwrapPath`/`socatPath`; `parentSettingsBehavior`; many fixes | N/A | Linux sandbox / enterprise |

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
- [ ] Re-validate `plugin.json` doesn't set a `skills` key that shadows the
      default `skills/` folder (now an error, 2.1.136) and that no other
      manifest key shadows a default component folder (2.1.140 warns).
- [ ] Evaluate the new hook capabilities for `ai-maestro-hook.cjs`:
      `MessageDisplay` event (2.1.152), `terminalSequence` output for
      desktop notifications (2.1.141), and `args: string[]` exec-form +
      `continueOnBlock` for PostToolUse (2.1.139).
- [ ] Consider `disallowed-tools` in skill/command frontmatter to lock the
      tool surface per element (2.1.152).
- [ ] Consider `defaultEnabled: false` for any opt-in plugin/skill so it
      installs disabled until the user enables it (2.1.154).

### Role-plugin repos (8 of them, see CLAUDE.md "Editing Role-Plugins")

- [ ] Audit each plugin's `.claude-plugin/plugin.json` for top-level
      `themes` / `monitors` (2.1.129).
- [ ] Audit each main-agent `.md` frontmatter for `tools:` /
      `disallowedTools:` / `permissionMode` declarations — these now
      take effect under `claude --agent` and headless `-p` mode (2.1.119).
- [ ] Verify no MCP server is named `workspace` (2.1.128).
- [ ] Re-verify each main-agent `.md` keeps ALL declared `Agent(...)` types
      in `tools:` — the drop-all-but-last bug is fixed (2.1.147), but confirm
      the intended set is present.
- [ ] Consider `defaultEnabled` per role-plugin marketplace entry (2.1.154);
      role-plugins are title-gated, so disabled-by-default may suit some.

### `Emasoft/ai-maestro` (THIS REPO) — verdict

**2.1.113–2.1.132:** ZERO server-side code changes required.

**2.1.133–2.1.154:** EXACTLY ONE code change — the cross-client model-mapping
rework (`lib/converter/rewrite/model.ts` + `tests/unit/converter-model-mapping.test.ts`)
for Opus 4.8 (family normalization + `[1m]` handling) and the gpt-5.5 Codex
frontier refresh + `codexTier` fallback. Everything else in the range is
AWARENESS / OUT-OF-REPO / N/A.

Verified by:

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

# worktree.baseRef (2.1.133 default flipped to `fresh`) — do we pin it?
git grep -nE "baseRef|worktree\.base" -- . ':(exclude)*.lock'
# → no output: we inherit `fresh` (branch from origin/<default>) for
#   worktree-isolated agents. Set worktree.baseRef: "head" only if a
#   scenario fix needs unpushed local commits as its base.

# defaultEnabled (2.1.154) — does our plugin/marketplace tooling read it?
git grep -nE "defaultEnabled" -- '*.ts' '*.tsx' '*.mjs' '*.json'
# → no output: additive Claude Code feature; adoption is optional (tracked
#   in the follow-up section above), not a break.
```

The compatibility surface this repo exposes (the API endpoints, the
governance docs, the role-plugin SKILL files) is otherwise unchanged by the
client-side changelog. The model-mapping change is internal to the
cross-client converter and ships with full unit-test coverage.
