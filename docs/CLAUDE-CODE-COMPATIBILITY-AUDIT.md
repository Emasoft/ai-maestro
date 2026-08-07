# Claude Code 2.1.113 - 2.1.224 Compatibility Audit

**Audited:** 2026-05-07 (2.1.113–2.1.132), extended 2026-05-28 (2.1.133–2.1.154), extended 2026-06-16 (2.1.156–2.1.178), extended 2026-06-24 (2.1.179–2.1.187), extended 2026-07-08 (2.1.190–2.1.204), extended 2026-07-14 (2.1.205–2.1.209), extended 2026-08-04 (2.1.210–2.1.221), extended 2026-08-07 (2.1.222–2.1.224)
**Branch:** `governance-rules`
**Server version:** v0.29.x

This file enumerates every entry in the Claude Code 2.1.113-2.1.221
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

### 2.1.222–2.1.224 — August 7, 2026 (eighth pass)

`claude --version` reports **2.1.224**, so nothing in this range is speculative: every entry had
already changed underneath the repo before the pass began. The theme is that two of the three most
useful findings were NOT the changelog entries themselves — one was a defect the *check for* an
entry exposed in code committed the same morning, and one was a previous pass's row that a
**removal** in 2.1.224 quietly falsified. A changelog is a list of second-hand reports; the value is
in what measuring them turns up.

One item here was already audited and is not re-listed: agent names containing `:` (2.1.218, row in
the seventh pass). Re-checked anyway and extended — the original measured the 5 project agents, this
pass adds `~/agents` and the registry, both still 0. Our own validators
(`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` in element-management G00, `/^[a-zA-Z0-9_-]+$/` in the docker and
skills services) are strictly stricter than CC's rule, so it is satisfied by construction.

| Change (version) | Verdict | Notes |
|---|---|---|
| **Long (>200 char) project paths no longer resolve into another project's session directory** (2.1.224) | **APPLIED — to a different bug the check exposed** | The entry itself is a **no-op for us, twice over**: `decodeProjectCwds()` never un-mangles the slug (it reads the transcript's own `cwd`), so the whole class is unreachable by construction; and the longest name in the live corpus is **132 chars** of 97 dirs, so no path is near the threshold. But measuring for it found a real defect in `lib/settings-watch-targets.ts`, committed hours earlier: a **worktree session's transcripts are filed under the PARENT project's directory**, so one dir maps to a SET of cwds — and `found.add(cwd); break` kept only the first, making coverage depend on **filename sort order**. Measured: 1 of 97 dirs already spans two (this repo's root + `.claude/worktrees/vibrant-cohen-0cbd79`). For a ledger required to record EVERY settings change, arbitrary coverage is the defect. Fixed **7cb954c9**, pinned + neuter-proven **60d7578b** (mutation = restore the `break` → 1 red / 14 green, restore verified by blob hash). Cost of reading every top-level transcript instead of one: **182 files, 53.9 MB** capped (10.4 MB at 64 KiB; 97.8% of transcripts carry `cwd` within 64 KiB). A deliberate NON-change is recorded in the module: descending into `<session>/subagents/` exposes **40** further cwds (all worktrees), of which **3** survive and **0** carry a settings file, at **11 565** extra reads per re-scan — and that zero is *not* structural, since this repo tracks `.claude/settings.json`, so the docstring names `git worktree list --porcelain` as the cheap exact route if worktree settings are ever wanted. |
| **`CLAUDE_CODE_DISABLE_1M_CONTEXT` now holds EVERY natively-1M model to 200K** via auto-compaction, not a fixed list (2.1.223) | **HAZARD DOCUMENTED — deliberately NOT implemented** | This breaks a premise `lib/context-limits.ts` rests on: **a model id no longer fully determines the window.** With the var set, `claude-opus-5` really runs at 200K while `contextLimitForModel` answers 1,000,000 — a 5x OVER-report, the exact failure the `claude-opus-4*` heuristic was deleted for, arriving through a new door. **Measured NOT live:** unset in every shell env, both `~/.claude/settings*.json`, all `~/agents/*` workdir settings, the whole repo, and the pm2 env. Left unimplemented because the obvious fix is wrong twice — `process.env` inside the resolver reads the **server's** environment, not the **agent's**, and `services/sessions-browser/local-context-breakdown.ts` calls it from the **browser**, where there is no `process.env` at all. The only sound signal is the agent's own spawn env, which the server knows per-agent and would have to thread through, and which must then be mirrored into `rust-tools/aim-jsonl-reader/src/context.rs` per that file's sync obligation. Recorded in the module (**63508763**) rather than guessed at in code. |
| **Auto-compact keeps sessions on UNRECOGNIZED model ids within the assumed window** (2.1.223) | **ALREADY-ALIGNED — a guess became an agreement** | Our 200K fallback for an unknown id used to be our own conservative choice; it is now the behaviour CC actually enforces (escape hatch: `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`). So the default must never be relaxed to let an unknown id "optimistically" inherit 1M. The changelog does not state the assumed window numerically — that it equals 200K is INFERRED from the default, so treat the number as unconfirmed even though the direction is not. |
| **Removed the 200-subagent-per-session spawn cap** (2.1.224) | **CORRECTION to the seventh pass** | The seventh-pass row below recorded that cap as present (2.1.211/2.1.212/2.1.219 added it). 2.1.224 removed it; concurrency (20) and depth (3) limits still apply. Annotated in place rather than rewritten, so the correction is legible. No in-repo text asserted the cap (`MAX_SUBAGENTS` = 0 hits), so nothing else goes stale. |
| **Trust dialogs now name the repository root the grant covers** (2.1.222) | **N/A — measured against the shipped binary** | `services/agents-core-service.ts` auto-accepts the R17 trust prompt by matching pane text on `'Yes, I trust this folder'` / `'trust this folder'`, with a fuzzy fallback that WARNS when it fires. Both exact strings are still present in the 2.1.224 binary (`~/.local/share/claude/versions/2.1.224`, 2 occurrences each; positive control `claude` = 2854 proves the grep reaches the binary — a compiled target needs `grep -a`, and a bare grep would have reported a false absence). 2.1.222 appended the repo root to the dialog without disturbing the phrase we key on, so the exact path still hits and the fuzzy fallback stays dormant. |
| **Plugin install records no longer corrupt when one plugin is installed in multiple projects** (2.1.224) | **BENEFIT INHERITED — records measured sane** | We are the extreme case for this bug: `~/.claude/plugins/installed_plugins.json` holds **92** records, **7** installed in more than one project, and `ai-maestro-plugin@ai-maestro-plugins` in **74**. Measured today: no malformed records, no duplicate keys — so the fix is a benefit inherited, not a repair owed. Worth re-checking after any mass agent-provisioning run. |
| **Worktree isolation now applies to file edits and Bash in EVERY session type** (2.1.222) | **AWARENESS — strengthens a defence we keep anyway** | `.claude/rules/prevent-subagents-to-write-outside.md` already records the 2.1.216 `git -C` closure and states explicitly that the project write-guard STAYS. The reasoning is unchanged by this broader fix: our guard also blocks a plain `Write`/`Edit` at an absolute outside path and redirection via `rm`/`mv`/`cp`/`tee`/`sed -i`, none of which platform isolation addresses — and a defence removed the moment one of its routes is closed elsewhere is a defence enforced by a tool version we do not pin. |
| **Cross-session `SendMessage` + `ListAgents`** — CC sessions can message each other across machines (2.1.224) | **AWARENESS — a candidate TRANSPORT, never a replacement for AMP** | The loudest architectural entry in the range and the easiest to misread. AMP exists to carry **governance** — the R6 communication graph, governance titles, COS as the sole entry point into a team. The native tool carries none of that: it is an unrouted pipe between sessions. It is a plausible transport *under* AMP; it is not an alternative to it, and "delete AMP, use SendMessage" mistakes the graph for the pipe. Related settings `crossSessionInbound` / `dialogExpiry` gate inbound delivery into a bypassed-permissions session. Census: 0 in-repo references (the 39 `SendMessage` hits are our own AMP layer — same word, different system). |
| **`archive` plugin source** — install from a zip over HTTPS, no git or npm, optional SHA-256 pinning (2.1.224) | **AWARENESS — real opportunity, not adopted here** | A genuine alternative to the git-tag install path that the `plugin-install-no-git-tag-satisfying` memory page documents as fragile, and SHA-256 pinning is a supply-chain improvement over a moving tag. Not adopted in this pass: our marketplace is git-based end to end, so switching source type is a marketplace-FORMAT decision with its own blast radius, not a compatibility fix. 0 in-repo references. |
| **Owner wildcards `"owner/*"` in `strictKnownMarketplaces` / `blockedMarketplaces`** (2.1.223) | **AWARENESS — opportunity that fits our shape exactly** | We publish 8+ role-plugin repos plus the core plugin under a single GitHub org, which is precisely what an owner wildcard was built for. We set neither setting today (0 hits each), so adopting it is a new policy decision rather than a migration. |
| **Gateway model discovery now finds provider-prefixed ids** (`vertex_ai/claude-*`, `bedrock/anthropic.claude-*`) (2.1.223) | **N/A — already handled by construction** | `contextLimitForModel` matches by SUBSTRING (the `[1m]` tag, and `/(?:sonnet\|opus)-5(?![0-9])/`), never by exact id, so a provider prefix cannot defeat it: `vertex_ai/claude-opus-5` still resolves to 1M. This is a case where the substring design — chosen for a different reason — happens to absorb a change for free. |
| **`/review` is now an alias of `/code-review`**; ultraplan removed (2.1.222/2.1.223) | **N/A — measured** | `ultraplan` 0 in-repo references, so its removal costs nothing. `ultrareview` has 1 (deprecated in favour of `/code-review ultra`, which is user-triggered and billed). Control: `ai-maestro` 1029 hits, proving the sweep reached the tree. |

### 2.1.210–2.1.221 — August 4, 2026 (seventh pass)

CLI verified at **2.1.221**. Triggered by a USER directive to align the codebase to the
2.1.206→2.1.221 changelog. **2.1.206–2.1.209 were already covered by the sixth pass**, so the
genuinely new delta is 2.1.210–2.1.221 and this pass does not re-litigate them.

**Headline: two APPLIED fixes, both silent-until-looked-for, and one open gap.** The section-A
permission/hook items are all clean by measurement. The two real breaks were in the classes this
card predicted would be worst — a default that changed under committed config (`context: fork`
now backgrounds) and a model that changed under a committed rule (`claude-opus-5`). Neither
failed loudly; both under-delivered silently. The open gap is that the subagent write-guard's
*wiring* is still unproven behaviourally, and the guard itself **fails open**.

| Change (version) | Verdict | Notes |
|---|---|---|
| **`skills` with `context: fork` now run in the BACKGROUND by default**; opt out with `background: false` (2.1.218) | **APPLIED** | `services/role-plugin-service.ts` embeds `aim-governance-rules` and `aim-agent-operations` as template literals and `injectAiMaestroSkills` writes both into **every generated role-plugin**. Both carried `context: fork`; backgrounded, such a skill returns only an agent handle and its text arrives later as a task notification — so an agent invoking one got **no governance rules in the turn that asked**, and no error. Both now pin `background: false` (the changelog's own opt-out; `context: fork` stays, since forking is what keeps a multi-kilobyte reference out of the main context). Pinned by `tests/unit/role-plugin-injected-skills.test.ts` — measured beforehand, **nothing** in `tests/` referenced either constant or either skill name. **How it was nearly missed:** an earlier sweep of this same range measured `context: fork` and concluded "TRDD prose and a memory page only, no skill frontmatter in this repo." That was the wrong POPULATION, not a bad grep — these frontmatters live inside TS template literals, so no search over `.md` skill files could reach them. Four already-generated role-plugins under `~/agents/role-plugins/` still carry the old form; `injectAiMaestroSkills` is idempotent, so re-running it refreshes them. |
| **`claude-opus-5` is the default Opus, natively 1M context** (2.1.219) | **APPLIED** | `contextLimitForModel('claude-opus-5')` measured **200000** before the fix — a 5x UNDER-report of free space. The native-1M family match was written when Sonnet 5 was the only such model (`/sonnet-5(?![0-9])/`), so the bare id fell through to the 200K default. `claude-opus-5[1m]` resolved correctly via the tag, and the tagged form is the common one in real JSONL — which is exactly what kept the gap invisible. Now `/(?:sonnet\|opus)-5(?![0-9])/`, landed in **both** halves (`lib/context-limits.ts` and its `MUST match` mirror `rust-tools/aim-jsonl-reader/src/context.rs`) with an assertion on each side. The `(?![0-9])` boundary is load-bearing — add a family, never relax the guard, or a future `claude-opus-50` inherits a window it does not have. Knowledge captured in the `model-context-window-classification` PROJECT memory page. |
| **Agent-frontmatter `hooks:` now require the agent file's folder to have accepted workspace trust** (2.1.218) | **PARTIALLY VERIFIED — and it surfaced a FAIL-OPEN in our own guard** | Precondition satisfied: this project carries `hasTrustDialogAccepted: true` in `~/.claude.json` (control: 139 projects carry the key), and 4 of 5 project agents declare frontmatter `hooks:`. Driving `.claude/scripts/subagent-write-guard.sh` directly proves it DISCRIMINATES — an outside path with `CLAUDE_PROJECT_DIR` set exits 2 BLOCKED, an inside path exits 0. **But with `CLAUDE_PROJECT_DIR` UNSET it exits 0 and prints `WARN: CLAUDE_PROJECT_DIR not set, allowing tool call` (script lines 68-72)** — the guard allows every write when it cannot resolve the project root. **Still unproven:** that CC actually INVOKES the hook and still PASSES `CLAUDE_PROJECT_DIR`. That needs a real agent spawn, which is not taken unprompted; it is the one open item of this pass. A guard that went inert is indistinguishable from a guard that allowed the write, which is precisely why a config read is not an answer here. |
| **`isolation: 'worktree'` subagents can no longer redirect git at the main checkout via `git -C` / `--git-dir`** (2.1.216) | **AWARENESS — favourable; the project guard STAYS** | This closes, at the platform level, the exact escape recorded in `.claude/rules/prevent-subagents-to-write-outside.md` §History (2026-04-14: an implementer `cd`-ed out of its worktree and committed on the parent tree). A platform fix is not a reason to drop a defence: the project rule and its `PreToolUse` guard remain, and the rule now carries a dated note saying so. The guard also covers cases CC's fix does not — plain `Write`/`Edit` at an absolute outside path, and redirection via `rm`/`mv`/`cp`/`tee`. |
| **`Write(path)` / `NotebookEdit(path)` / `Glob(path)` permission rules now warn at startup** — use `Edit(path)` / `Read(path)` (2.1.210) | **N/A — measured** | **Zero** occurrences of each form in `.claude/settings.json`. Positive control for the probe: `Bash(` matches **61** rules in the same file, so the search was looking at the right place. |
| **A single-segment `dir/**` in a hook `if:` now matches only `<cwd>/dir`, not any depth** (2.1.214) | **N/A — measured** | **Zero** hooks in `.claude/settings.json` carry an `if:` condition at all, so there is no matcher whose meaning could have changed. |
| **`Edit(src/**)`-style allow rules no longer auto-approve nested directories anywhere in the tree** (2.1.214) | **N/A — measured** | **Zero** `Edit(` rules exist in `.claude/settings.json`. |
| **Workflow saves and scheduled tasks no longer follow a symlink at `.claude`** (2.1.216) | **N/A — measured** | `.claude` here is a real directory, not a symlink. |
| **Task tool `mode:` parameter DEPRECATED and ignored; subagents inherit the parent's permission mode** (2.1.212) | **N/A — measured** | **Zero** `mode:` keys in `.claude/agents/*.md` and zero at any `Agent(` call site, so nothing in this repo was relying on the parameter that stopped being read. |
| **Agent names containing `:` are now REJECTED** (`:` is reserved for plugin namespacing) (2.1.218) | **N/A — measured** | **0 of 5** project agent names contain `:`. Note the interaction with `prevent-subagents-to-write-outside.md`: that rule already requires spawning the write-guarded agents by their **bare** name, because a plugin-namespaced name resolves to the plugin's copy whose frontmatter `hooks:` are ignored. |
| **Subagents may nest to depth 3 by default** (was 1); `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` restores the old behaviour. **Concurrent cap 20** (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), **per-session spawn cap 200** (2.1.211/2.1.212/2.1.219) | **AWARENESS — nothing in this repo to restate** | The flat-fan-out assumption these caps interact with is documented **only** in the user-global `~/.claude/CLAUDE.md`, not in any file this repo owns, so there is no in-repo text made stale by the change. Relevant to `run-scenarios-batch` and the parallel-worker/parallel-tester flow if either ever fans out near 20 concurrent; neither does today. **⚠ SUPERSEDED IN PART (2026-08-07, eighth pass): 2.1.224 REMOVED the per-session 200-subagent spawn cap** — "long-running sessions no longer refuse new agents". The depth-3 and concurrency-20 limits above still stand. Annotated rather than rewritten so the correction stays legible; a row that silently changed would leave no trace that the cap ever existed. |
| **`DirectoryAdded` hook · `workflowSizeGuideline` · `EndConversation` tool · `sandbox.filesystem.disabled` · `sandbox.network.strictAllowlist` · `mode: "mask"` credential files · plugins accepting `"."` as a `skills` path · `/fork` as a background session with `/subtask` as the in-session form** (2.1.210–2.1.221) | **DECLINED — no consumer** | Each was probed for a consumer in this repo; for every one the only hits were the TRDD card's own prose naming it as a candidate, plus (for `--add-dir`) `.claude/chat_history/` transcripts. `.claude/settings.json` has exactly four top-level keys — `permissions`, `hooks`, `spinnerTipsEnabled`, `$schema` — so there is no `sandbox`, no credential-file, and no `workflowSizeGuideline` surface here to configure. **A capability is not adopted because it exists**; each is re-evaluated when something in this repo needs it. |
| **`claude plugin validate` now warns on marketplace-name issues** (2.1.210–2.1.221) | **N/A — measured empirically, and it found an unrelated live bug** | This repo has three exit-code-sensitive consumers: `app/api/settings/marketplaces/route.ts:1598` (via `execSync`, which throws on non-zero) and `scripts/agent-plugin.sh:763,942` (direct `if` branches). The question was whether a new WARNING flips the exit code, turning a healthy plugin into a reported failure. **It does not** — measured against a cached plugin that emits two warnings: `✔ Validation passed with warnings`, **exit 0**. The same probe against `~/agents/role-plugins` exited **1** on a real defect unrelated to this range: `scripts/migrate-r20-disk-layout.sh:396` writes a marketplace source without the required `./` prefix, and one bad entry fails the whole manifest. Filed as **TRDD-DP2HI2MP**, not fixed here. |
| Everything else in 2.1.210–2.1.221 — terminal/IDE surfaces, `/usage`, Remote Control, provider and Windows fixes | **N/A** | Surfaces AI Maestro does not sit on. |

### 2.1.205–2.1.209 — July 14, 2026 (sixth pass)

CLI now at **2.1.209**. **Headline: no hard break, and no code change required.**
The range contains exactly **one** change that can hard-break a consumer — the
2.1.207 rejection of `${user_config.*}` in shell-form plugin hook/monitor/
`headersHelper` commands — and it is **verified clean** both in this repo and
across the AI Maestro plugin fleet. Every other entry is N/A, AWARENESS, or was
already handled by an earlier pass. Verdicts below are grounded by reading the
code, not by trusting a prior TRDD.

| Change (version) | Verdict | Notes |
|---|---|---|
| **`${user_config.*}` in shell-form plugin hook / monitor / `headersHelper` commands is now REJECTED** (shell-injection fix) (2.1.207) | **N/A — verified, in-repo AND fleet-wide** | The only `user_config` hits in this repo are field names in `lib/converter/universal-ir.ts` (the IR models user-config as a plugin *component type*); **no emitter interpolates `${user_config.*}` into a hook command**, and our own project `SessionStart` hook uses `${CLAUDE_PROJECT_DIR}`, which is unaffected. Fleet check: no `ai-maestro-plugins` plugin uses the rejected form — they already read the SAFE `$CLAUDE_PLUGIN_OPTION_<KEY>` env vars. (CPV independently ships a `[RC-USERCFG-SHELL-INJECT]` CRITICAL validator for this rule, so a regression would be caught at publish.) Nothing to migrate. |
| **`pluginConfigs` no longer read from project-level `.claude/settings.json`** (2.1.207) | **N/A** | Zero `pluginConfigs` hits. The workdir seeder writes plugin **enablement** (`enabledPlugins` in `.claude/settings.local.json`), never plugin **option values**, so no seeded config silently stops being honored. |
| **Auto mode no longer reads `autoMode` from `.claude/settings.local.json`** (repo-resident) (2.1.207) | **N/A** | Zero `autoMode` hits in code. `lib/workdir-gitignore-seed.ts` / the settings seeder never write it. |
| **The Agent tool now hard-errors when a subagent's `tools:` list resolves to nothing**, naming the unrecognized entries (2.1.208) | **VERIFIED-OK** | Both project agents carrying an explicit list resolve fully: `scenario-runner` (`Bash, Read, Write, Edit, Glob, Grep, Skill`) and `screenshot-interpreter` (`Read, Glob`); the other three omit `tools:` and inherit. A future typo now fails loudly instead of silently launching a tool-less agent — a net win for our fleet. |
| **Sonnet 5 is the DEFAULT model** (2.1.197) · Bedrock/Vertex/Claude-on-AWS default to Opus 4.8 (2.1.207) | **ALREADY-APPLIED (verified in code)** | Agents launch without pinning `--model` (Haephestos is the exception: `--model sonnet`), so the fleet default moved to Sonnet 5. The real downstream risk was **context-window under-reporting**, and it is already closed: `lib/context-limits.ts` resolves the bare, untagged id `claude-sonnet-5` to 1M via `NATIVE_1M_FAMILY_RE = /sonnet-5(?![0-9])/` (TRDD-CS51MFIX), with a non-digit boundary so `claude-sonnet-50` stays 200K. Cross-client mapping (`lib/converter/rewrite/model.ts`) is family-based, so new Claude versions need no table edit. |
| **Catastrophic removals (`rm -rf ~`) hidden inside `$(…)` / backticks / `<(…)` now prompt even under `--dangerously-skip-permissions` and auto mode** (2.1.208) | **AWARENESS — favourable** | AI Maestro launches agents with `bypassPermissions`, so the obfuscated form previously slipped a guard the plain form caught. CC now closes that gap for us at no cost; it reinforces (does not replace) `agent-shell-guard.sh`. |
| **Background-task notifications now explicitly state that no human input occurred**, preventing fabricated in-transcript approvals from being acted on (2.1.205) | **AWARENESS — corroborates our governance** | The harness now asserts at runtime what R42 / the AMP comm-graph already assume: an agent's message is never the USER's approval. Nothing to change; useful when auditing approval provenance. |
| `EnterWorktree` now confirms before entering a worktree **outside** `.claude/worktrees/` (2.1.206) | **AWARENESS** | Our worktree-isolated agents (`isolation: worktree`) create *inside* `.claude/worktrees/` and are unaffected; only a hand-driven `EnterWorktree` at an external path will prompt. |
| Per-server `request_timeout_ms` in `.mcp.json` / `--mcp-config` is now honored (was capped at the 60 s default in fresh sessions) (2.1.206) | **AWARENESS — opportunity** | `app/api/settings/mcp-discover/route.ts` writes a temp `.mcp.json`; a slow MCP discovery can now raise its own timeout instead of dying at 60 s. |
| Memory/perf: transcript size down up to **79x** (superseded file-history backups pruned), MCP stdio stderr capped, LSP docs LRU-bounded, edit cache bounded, permission-rule matchers cached (2.1.208); context-usage indicator no longer re-analyzes the whole transcript per turn (2.1.203) | **AWARENESS** | We read `~/.claude/projects/*.jsonl` (subconscious, token accounting, session browser). Pruning shrinks transcripts but changes **no record schema we consume**. Strictly favourable for our readers. |
| Everything else in 2.1.205–2.1.209 — screen-reader mode, `vimInsertModeRemaps`, `CLAUDE_CODE_PROCESS_WRAPPER`, `/doctor` checkup, agent-view UX, `/model` picker, `/usage`, Remote Control, Bedrock/SSO, Windows fixes | **N/A** | Terminal / IDE / provider surfaces AI Maestro does not sit on. |

### 2.1.190–2.1.204 — July 8, 2026 (fifth pass)

Triggered by the fleet-readiness campaign's "monitoring current with CC changes"
gate (TRDD-903b7a20; CLI now at **2.1.204** — 2.1.188/189 have no public
changelog entries). Full per-entry evidence: the gitignored audit report
`reports/cc-compat-audit/20260708_193122+0200-cc-2.1.133-204-audit.md`.
**Headline: no hard break** — every hook-relevant change in the range is
additive (hook events are consumed by NAME and none were renamed; no CC version
pin exists; `--permission-mode` is only ever passed as
`bypassPermissions`/`acceptEdits`, so the 2.1.200 `default`→`manual` rename is
a non-issue). **One APPLIED fix** came out of the pass:

| Change (version) | Verdict | Notes |
|---|---|---|
| **Subagents now run in the background by default** (2.1.198); `/exit` warns about running background agents (confirmed by the 2.1.203 fix note) | **APPLIED** | Broke the "`idle_prompt` ⟹ no subagents ⟹ safe to `/exit`" premise behind Stop/Restart. Fixed in TRDD-O8NCNRWO Phase 1 (`lib/session-safe-state.ts` + 409 `subagents_running` gate on stop/restart + abandon-dialog probe in the restart poll). Hook-side counter bug filed as `ai-maestro-plugin#17`; UI awareness = Phase 2 |
| Transient 429s auto-retried with backoff; `CLAUDE_CODE_RETRY_WATCHDOG` default retries raised (2.1.199) | AWARENESS | The hook's `rate_limited` StopFailure classification stays correct — it just fires less often (only on true window exhaustion) |
| New `Notification` subtypes `agent_needs_input` / `agent_completed` for `claude agents` background sessions (2.1.198) | AWARENESS | The hook's Notification switch ignores them; they never fire for ai-maestro's tmux-interactive agents. Adopt only if ai-maestro ever manages `claude agents` sessions |
| Hook matchers: comma-separated matchers fixed (2.1.191), hyphenated identifiers now exact-match (2.1.195) | OUT-OF-REPO | ai-maestro's hook matches EVENT names in `ai-maestro-plugin`'s `hooks.json` — unaffected; role-plugin repos should verify their own matchers |
| `SessionStart`/`Setup`/`SubagentStart` hooks: exit-2 stderr now surfaces in the transcript (2.1.199); hook events stream during SessionStart in headless sessions (2.1.204) | AWARENESS | The ai-maestro hook always exits 0; the 2.1.204 fix improves remote-worker reliability in our favor |
| Claude Sonnet 5 GA with native 1M context (2.1.197) | N/A | The cross-client model map is family-keyed (`lib/converter/rewrite/model.ts`) and already covers the `sonnet` family + round-trip tests |
| Project-scoped plugins now load correctly from git worktrees (2.1.200); skill re-invocation no longer duplicates instructions (2.1.202); `/plugin` enable/disable fixed when plugin.json name ≠ marketplace entry name (2.1.195) | N/A | Upstream fixes in ai-maestro's favor (worktree implementer, fourfold-identity rule already enforces name==entry) |
| Committed `.mcp.json` servers now require explicit approval in untrusted workspaces (2.1.196); external plugins enabled via project settings require install consent (2.1.195) | AWARENESS | Consent tightening; ai-maestro installs through the CLI script layer, which primes consent. Role-plugins shipping MCP servers get a pending-approval state on first trust |
| `AskUserQuestion` no longer auto-continues by default (2.1.200) | AWARENESS | Agents may idle longer on questions; the hook still reports `idle_prompt` correctly |
| Marketplace `renames` maps auto-followed (2.1.193); background-agent draft-PR autonomy, `/dataviz`, workflow OTel attributes (2.1.198–2.1.202) | AWARENESS | Nothing consumes these yet; candidates for future TRDDs |

**Net:** monitoring/session-control is CURRENT with 2.1.204 **after** the
TRDD-O8NCNRWO gate landed. Open follow-ups from the pass: O8NCNRWO Phase 2
(UI subagent awareness) and the hook counter fix (`ai-maestro-plugin#17`).

### 2.1.179–2.1.187 — June 24, 2026 (fourth pass)

Triggered by the TRDD-TBGGUA2V **P4** "install/extensions API ↔ latest Claude
changelog + Anthropic specs" mandate (CLI now at **2.1.187**). **No code change**
in this range — every entry is AWARENESS / N/A for AI Maestro's install/extension
API surface. The install/marketplace/plugin endpoints (`role-plugins/install`,
`settings/marketplaces`, `install-skills`, `local-plugins`,
`creation-helper/publish-plugin`) are unaffected.

| Change (version) | Verdict | Notes |
|---|---|---|
| Skill frontmatter keys now accept kebab/snake/camelCase; malformed `SKILL.md` YAML loads the body with empty metadata instead of failing (2.1.186) | AWARENESS | Upstream is now MORE LENIENT on READ. AI Maestro's converter/emitters still EMIT canonical kebab-case frontmatter — being stricter than the lenient reader is safe, so no change. (Helps if we ever PARSE third-party skills.) |
| Model-deprecation / auto-update warning now also covers models set in AGENT FRONTMATTER (2.1.183) | AWARENESS | Already handled: the cross-client model mapping emits FAMILY ALIASES (opus/sonnet/haiku) that auto-resolve to the current model, so emitted agent frontmatter never carries a deprecated pinned id |
| `claude mcp login <name>` / `logout <name>` CLI for MCP auth, with `--no-browser` stdin (2.1.186) | AWARENESS | New non-interactive MCP-auth surface. The dashboard's ChangeMCP / mcp-discovery don't manage MCP auth today; a future "authenticate this MCP server" control could shell out via the CLI script layer (per the decoupling invariant). Deferred — worth a future TRDD |
| `Agent(type)` deny / `Agent(x,y)` allowed-types now enforced for NAMED subagent spawns (2.1.186); background subagents surface permission prompts in the main session (2.1.186) | AWARENESS | Permission semantics for subagent spawning; role-plugins may tighten their `Agent(...)` rules (plugin-side). No dashboard install-API impact |
| Auto-mode blocks destructive git / `terraform\|pulumi\|cdk destroy` unless asked (2.1.183); scheduled-task & webhook deliveries classify as task notifications, can't approve actions in auto mode (2.1.183) | AWARENESS | Agent runtime-safety; complements the project's own git_safety_guard. No dashboard code path |
| `sandbox.credentials` (2.1.187), `sandbox.allowAppleEvents` (2.1.181), org-configured model restrictions in the picker (2.1.187), bundled Bun → 1.4 (2.1.181), `CLAUDE_CLIENT_PRESENCE_FILE` (2.1.181) | N/A | Sandbox / runtime / managed-settings features; not on the AI Maestro install/extension path |
| `!` bash commands auto-trigger a response unless `respondToBashCommands:false` (2.1.186); `StructuredOutput` no-infinite-recall + 5-attempt abort (2.1.186/2.1.187); remote-MCP idle-timeout (2.1.187); numerous TUI / remote / VSCode / startup fixes (2.1.181–2.1.187) | N/A | Terminal / SDK / IDE / startup behavior; no AI Maestro code depends on these |

**Net:** the install/extensions API is CURRENT with Claude Code 2.1.187 — no
update required. The one item worth a future TRDD (an enhancement, not a gap) is
surfacing `claude mcp login/logout` as an MCP-auth control in the dashboard, via
the CLI script layer per the Plugin Abstraction decoupling invariant.

### 2.1.156–2.1.178 — June 16, 2026 (third pass)

Triggered by a fleet-readiness request to align with the latest Claude
Code changelog. **The only code change in this range** is the cross-client
model-mapping extension for **Fable 5** (`claude-fable-5`), GA'd in
2.1.170: `lib/converter/rewrite/model.ts` + tests (commit `04585f34` on
`governance-rules`). Everything else is AWARENESS / OUT-OF-REPO / N/A.

| Change (version) | Verdict | Notes |
|---|---|---|
| **Fable 5 release (2.1.170)** + Fable 5 name normalization (2.1.173) | **APPLIED** | New top-tier Claude line outside the opus/sonnet/haiku families. `claudeFamily()` returned null → `mapModel` passed the literal `claude-fable-5` through to Codex/Gemini (an invalid target id — the Opus-4.8 passthrough-bug class). Added a `fable` family → flagship tier (`gpt-5.5` / `gemini-2-pro`). Family-keyed, so future `claude-fable-6` and the `[1m]` variant need no edit. +6 tests (26 pass) |
| SessionStart hook `reloadSkills: true` + `sessionTitle` (2.1.152) / `post-session` hook (2.1.169) | AWARENESS | The dashboard's element-change restart queue could use `reloadSkills` for a lighter refresh than a full relaunch; `post-session` could drive cleanup. Opt-in enhancements; the core hook lives in `ai-maestro-plugin` (out-of-repo). Deferred |
| Plugins in `.claude/skills` auto-load; `claude plugin init`; `/plugin` search (2.1.157/2.1.172) | AWARENESS | Additive plugin-CLI surface; the dashboard's `claude plugin install/uninstall/marketplace` calls are unchanged |
| Plugin dependency enforcement / `dependencyResolution` (2.1.143/2.1.151), `requiredMinimum/MaximumVersion` (2.1.163), `disableBundledSkills` (2.1.169) | OUT-OF-REPO | Role-plugins + `ai-maestro-plugin` could declare deps / version floors / disabled-by-default in their manifests. Tracked for the MANAGER (plugin-side); our marketplace parsers don't read these yet |
| `disallowed-tools` hook frontmatter REMOVED (2.1.163); `disallowed-tools` for Skills/slash commands (2.1.152) | OUT-OF-REPO | Affects plugin agents/skills, not the dashboard. `ai-maestro-hook.cjs` is a `.cjs` (no frontmatter) — unaffected. Verify in plugin repos |
| Sub-agents spawn sub-agents, 5 levels (2.1.172/2.1.178); `Tool(param:value)` permission rules; nested skill dirs `<dir>:<name>` (2.1.178) | AWARENESS | Runtime/permission features; no AI Maestro code path depends on the old nesting limit |
| `availableModels`/`enforceAvailableModels` (2.1.175/2.1.176), `fallbackModel` (2.1.166), glob deny rules (2.1.166), `--safe-mode` (2.1.169) | AWARENESS | Managed-settings / model-policy features; the dashboard doesn't centrally manage agent model policy |
| stdio MCP `CLAUDE_CODE_SESSION_ID`/`CLAUDECODE=1` (2.1.161/2.1.163), `--strict-mcp-config` enforcement (2.1.169) | AWARENESS | We ship no stdio MCP server today |
| Everything else (terminal/clipboard/tmux cosmetics, IDE sync, Bedrock/Vertex/Foundry, telemetry labels, model pickers, vim mode, CJK IME) | N/A | Runtime / terminal / enterprise-auth — off AI Maestro's path |

> **Branch note:** this third pass landed on `governance-rules`. `main`
> alignment is handled separately (same as prior passes).

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
