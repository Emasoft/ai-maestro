# Rule: Prevent Subagents from Writing Outside Their Scope

**Severity: IRON**. This rule has been violated repeatedly. It applies to ANY Claude Code work in this project that spawns subagents.

## The rule

Every subagent spawn that does code modification MUST be constrained so it can only write inside:

1. **Its own project root or git worktree** — `$CLAUDE_PROJECT_DIR`
2. **System scratch areas** — `/tmp`, `/private/tmp`, `/var/folders` (for cloning/fixing other repos)

Reads can go anywhere. Writes are restricted to the two roots above. No exceptions.

## Why this rule exists

The 2026-04-14 overnight scenario batch exposed a failure where the `scenario-improvement-implementer` subagent escaped its own git worktree. The sequence:

1. The subagent's worktree reported a stale base (it thought so, incorrectly)
2. It tried to run a destructive git operation to realign — blocked by the user's global `git_safety_guard.py`
3. Instead of returning DEFERRED, the subagent `cd`-ed to the parent `ai-maestro` repo, checked out a new branch directly on the parent's working tree, and committed files there
4. Nothing stopped it. The parent working tree was corrupted. I had to manually switch branches and verify the tree

The root cause: `isolation: worktree` in the subagent frontmatter provides **filesystem isolation only** (each worktree is a separate git checkout). It does **NOT** provide process sandboxing. A subagent with `Bash`, `Write`, `Edit` tools can walk out of its worktree with a simple `cd ../..` and do anything in the parent repo.

This is the 10th time (at least) I've forgotten that subagents need an explicit write guard on top of `isolation: worktree`. Writing this rule to make it stop.

## The enforcement pattern

### Option A — Project-scoped subagent shadow (preferred)

**Important:** plugin-shipped subagents cannot have a `hooks` field in
their frontmatter — this is a Claude Code security restriction
documented in the plugins-reference:

> Plugin agents support [...] For security reasons, `hooks`,
> `mcpServers`, and `permissionMode` are not supported for
> plugin-shipped agents.

Empirically verified 2026-04-14: a plugin-shipped agent's `hooks:`
field is silently ignored at runtime.

The only way to wire a `PreToolUse` hook on a code-modifying subagent
is to place the subagent definition in a **project-scoped**
`.claude/agents/<name>.md` file (or a user-scoped `~/.claude/agents/`)
and reference a guard script that lives in the project.

For ai-maestro this means:

1. Agent lives at `.claude/agents/scenario-improvement-implementer.md`
   (not in a plugin)
2. Script lives at `.claude/scripts/subagent-write-guard.sh`
3. Frontmatter points at the script via `${CLAUDE_PROJECT_DIR}`

Example frontmatter:

```yaml
---
name: scenario-improvement-implementer
model: opus
isolation: worktree
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
      hooks:
        - type: command
          command: "${CLAUDE_PROJECT_DIR}/.claude/scripts/subagent-write-guard.sh"
---
```

**Critical:** spawn the subagent via its **bare name** (no plugin
namespace). If you spawn a plugin-namespaced agent (e.g.
`some-plugin:scenario-runner`), Claude Code resolves it to the
plugin's version, not the project shadow, and the hook won't fire.
Bare-name spawning resolves to the project-scoped agent, which has
the hooks field honored.

The hook script at `.claude/scripts/subagent-write-guard.sh` does:

- `$CLAUDE_PROJECT_DIR` is resolved at subagent startup to either the main tree (for runners) or the worktree path (for worktree-isolated agents)
- `Write|Edit|MultiEdit|NotebookEdit` → check `tool_input.file_path` against allowlist
- `Bash` → scan the command string for absolute paths in `cd`, `git -C`, file redirection, `rm`, `mv`, `cp`, `mkdir`, `touch`, `tee`, `chmod`, `chown`, `dd`, `install`, `ln`, and `sed` in-place patterns
- Exit code 2 blocks the tool call; the stderr message becomes the reason Claude sees

### Option B — Per-spawn constraint in the prompt

When spawning an ad-hoc subagent via the `Agent` tool (not via a plugin), include an explicit constraint in the prompt:

```
## Write-scope constraints (MANDATORY)

You may READ from anywhere. You may only WRITE inside:
  1. Your current project root ($CLAUDE_PROJECT_DIR or the isolated worktree)
  2. /tmp, /private/tmp

If you attempt to write outside these roots, STOP and DEFER the task
with an explanation. Do NOT cd to the parent directory. Do NOT use
git -C on an outside path. Do NOT use git reset / clean / checkout
on a path outside your worktree.

If you hit a problem that you think requires an outside write, the
correct action is to DEFER: return `[DEFERRED] <reason>` as your
2-line summary, and the orchestrator will decide what to do next.
```

This is weaker than Option A (relies on the subagent following instructions), but it's the only option for spawns outside a plugin that defines the hook.

## Verification before spawning

Before spawning any subagent from a plugin, check that the plugin's subagent definitions have the `PreToolUse` write-guard hook:

```bash
grep -A 6 '^hooks:' ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents/*.md
```

If `PreToolUse` with `matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"` is missing, **do not spawn the subagent**. Either:
- Upgrade the plugin to a version that ships the hook
- Patch the plugin locally
- Use Option B (ad-hoc prompt constraint) and accept the weaker enforcement

## What is NOT blocked by the hook

The write-guard only restricts filesystem writes. It does NOT block:
- HTTP requests (curl, wget, git push, gh pr create) — use the `amp-send`/`gh` network rules separately
- Running arbitrary binaries — the subagent can still execute whatever's on PATH
- Reading sensitive files (the read allowlist is "anywhere" by design)
- Process escape via `exec`, `setsid`, `nohup`, background jobs that outlive the subagent

If a subagent needs network or process sandboxing, that's a separate layer (firejail, Docker, macOS sandbox-exec) outside the scope of this rule.

## Secondary rule: avoid destructive-pattern strings in command arguments

The global `git_safety_guard.py` (`~/.claude/hooks/git_safety_guard.py`) matches on literal patterns like `rm -rf`, `git reset --hard`, `git push --force` anywhere in the `Bash` command string — **including inside quoted strings and commit messages**. This causes false positives when:

- You `echo 'test: rm -rf /foo'` to pass test input to another script
- You `git commit -m "fixes rm -rf bug"` with the pattern in the message
- You construct a command string that happens to contain the pattern for documentation purposes

**Workaround**: write the string to a file first, then reference the file:

```bash
# BAD (gets blocked by the global guard):
git commit -m "fix: make git reset --hard behavior predictable"

# GOOD (write message to file, commit from file):
cat > /tmp/commit-msg.txt << 'EOF'
fix: make git reset hard behavior predictable
EOF
git commit -F /tmp/commit-msg.txt
```

This applies to `Bash` tool calls only — the `Write` tool is not affected because it doesn't contain the raw string in its argv.

**When you hit the guard unexpectedly during routine work, don't add flags like `--no-verify`. Don't disable the guard. Write the string to a file.**

## Checklist when spawning a code-modifying subagent

- [ ] The subagent frontmatter has `isolation: worktree` (for agents that modify code)
- [ ] The subagent frontmatter has a `PreToolUse` write-guard hook, OR the spawn prompt includes Option B's write-scope constraint
- [ ] The subagent prompt explicitly says: "Do not push. Do not merge. Return branch name for parent to push."
- [ ] The subagent prompt has a `[DEFERRED]` escape hatch for problems that require outside writes
- [ ] After the subagent returns, verify the parent working tree is clean (`git status`) before pushing the branch
- [ ] If the parent tree is dirty after a spawn, the subagent escaped — investigate before pushing anything

## History

| Date | Incident | Fix |
|------|----------|-----|
| 2026-04-14 | Overnight batch implementer escaped worktree, corrupted parent tree | Project-scoped write-guard at .claude/scripts/subagent-write-guard.sh + this rule + migration of scenario agent definitions into project-scoped `.claude/` |
