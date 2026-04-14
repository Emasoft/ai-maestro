# TRDD-1222f06a-602a-4686-a6a7-f2e4428c673e — scenarios-autorunner rate-limit retry experiment

**TRDD ID:** `1222f06a-602a-4686-a6a7-f2e4428c673e`
**Filename:** `design/tasks/TRDD-1222f06a-602a-4686-a6a7-f2e4428c673e-scenarios-autorunner-rate-limit-retry.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started — experiment to be designed, implemented, and verified
**Created:** 2026-04-14
**Owner:** TBD
**Priority:** P0 (blocks reliable unattended overnight batches)

---

## 1. Problem statement

Unattended overnight scenario batches (via `scenarios-autorunner:run-scenarios-batch`) break when ANY subagent — or the orchestrator itself — hits an Anthropic Pro-subscription rate-limit window. Concretely, the 2026-04-13/14 overnight batch experienced a `401 Invalid authentication credentials` inside the SCEN-018 runner subagent after ~7 minutes / 84 tool calls. The subagent returned the error text to the parent as its "result", and because the orchestrator (me) had NO rate-limit retry logic, it would have either silently skipped SCEN-018 or (if lucky) been asked by the human to re-spawn it.

This is catastrophic for any all-night run: a single 5-minute rate-limit burst can cascade into 22 × 25-min scenarios × some-fraction all failing back-to-back, killing the entire batch.

The goal of this experiment is to make the `scenarios-autorunner` plugin **self-healing under rate limits**, so that:

1. When a runner subagent hits `rate_limit` / `authentication_failed` / `overloaded`, the plugin detects it without any human intervention.
2. The plugin sleeps for a tunable backoff window (start at 5 min, exponential up to 30 min, cap at 2 hours).
3. After the sleep, the plugin RESUMES the same scenario from the orchestrator's current batch position — not from the top of the batch.
4. The orchestrator's own stops (when IT hits the rate limit as the parent) are similarly handled.
5. The whole system works under a Pro Max 20× subscription (no API credits, no `claude -p`).
6. Repeated failures are bounded: after N consecutive rate-limit retries fail, the batch records `[STUCK]` for the current scenario and advances to the next one.

**Why existing mechanisms don't work (verified 2026-04-14):**

| Mechanism | Verdict | Reason |
|-----------|---------|--------|
| `StopFailure` hook return value | ❌ | Docs explicitly: "Output and exit code are ignored." Cannot block / inject context / trigger retry. |
| `Stop` hook `{"decision":"block"}` | ❌ | Stop and StopFailure are mutually exclusive — Stop doesn't fire on API errors. |
| `PostToolUseFailure` on Task/Agent tool | ❓ | Undocumented whether it fires when the Agent tool's subagent returns an error in its result string (vs a hard spawn failure). |
| `/loop` bundled skill | ❌ | Sessions-scoped, 7-day expiry, Claude sometimes stops its own loops. User has already tried this and reports it was unreliable. |
| `CronCreate` scheduled task | ❌ | Session-scoped, stopped loops problem, fires only while Claude is idle AND alive. |
| Inline `sleep 300` in parent turn | ⚠️ partial | Works for parent-side retry when parent is still alive, but if parent itself was hit by rate limit, the inline sleep never runs. |
| `claude --continue` piped stdin from `StopFailure` hook | ❓ untested | Official docs assistant's recommendation. Linchpin: does piped stdin bypass the Pro-Max-vs-API-credits gate? Docs assistant flagged "test whether piped stdin works with --continue". |

## 2. Design options

Three candidate architectures, from simplest to most robust:

### Option A — Outer wrapper loop (`bash while true`)

```bash
# run-overnight.sh
while true; do
  claude <start-the-orchestrator-command>
  EXIT_CODE=$?
  [ $EXIT_CODE -eq 0 ] && break
  echo "Claude exited $EXIT_CODE, sleeping 120s..."
  sleep 120
done
```

- **Pros:** Dead simple. No hooks. Pro Max subscription works (the new `claude` invocation uses the subscription).
- **Cons:** Every resume starts a fresh Claude Code session without the in-progress tool results from the old session. The conductor must be written so that it reads `tests/scenarios/state/batch-progress.log` on startup and skips already-done scenarios. Works only if the orchestrator is designed to be resumable from disk state.
- **Effort:** ~2 hours (write wrapper + make conductor resumable).
- **Risk:** Low. The outer loop is independent of Claude's hook system.

### Option B — FileChanged + StopFailure `nohup` bridge (user's idea)

```
rate_limit hits inside subagent S
  ↓
S's context registers StopFailure
  ↓
StopFailure hook (plugin-scoped, matcher: rate_limit|authentication_failed|overloaded|billing_error)
  ↓
Hook spawns: nohup bash -c 'sleep 300 && touch tests/scenarios/state/rate-limit-wake-trigger.md' &
  ↓ (hook exits immediately — nohup process lives on)
5 minutes pass in detached process
  ↓
nohup process appends a line to trigger file:
  "there was a rate limit api error at 2026-04-14T04:53:26Z — now it is passed. Resume all tasks."
  ↓
Claude Code FileChanged hook fires on the watched file
  ↓
FileChanged hook (plugin-scoped, matcher: path containing rate-limit-wake-trigger.md)
returns: { "hookSpecificOutput": { "hookEventName": "FileChanged", "additionalContext": "<contents of trigger file>" } }
  ↓
Claude session sees the injected context and resumes the last scenario / batch position
```

- **Pros:** Pure plugin-level implementation. Doesn't depend on the orchestrator being written to be resumable from disk (the injected context tells Claude "retry from where you were"). Uses only hooks already documented in Claude Code.
- **Cons:** **Untested.** It's not documented whether `FileChanged` fires when the session is in the post-StopFailure idle state. It's also unclear whether `FileChanged` events support `additionalContext` injection the same way `SessionStart` / `UserPromptSubmit` / `PreToolUse` do.
- **Effort:** ~4 hours (write hooks, test incrementally, debug).
- **Risk:** Medium. The experiment may reveal that `FileChanged` doesn't wake an idle-after-StopFailure session, in which case we fall back to Option A or Option C.

### Option C — `claude --continue` piped stdin (Anthropic docs-assistant pattern)

```bash
#!/usr/bin/env bash
# retry-on-ratelimit.sh (spawned by StopFailure hook via nohup)
SESSION_ID="$1"
ERROR="$2"
[[ "$ERROR" != *"rate_limit"* ]] && [[ "$ERROR" != *"overloaded"* ]] && exit 0

nohup bash -c '
  sleep 300
  echo "The previous attempt failed due to rate limiting. Please continue where you left off." \
    | claude --session-id "$1" --continue 2>>/tmp/claude-retry.log
' _ "$SESSION_ID" &>/dev/null &
exit 0
```

- **Pros:** This is the official docs-assistant's recommendation, so somebody at Anthropic thinks it works. It uses `claude --continue` which draws from the subscription (not API credits), bypassing the Pro-vs-API gate.
- **Cons:** **The docs-assistant flagged this as untested** — they said "Test whether piped stdin works with `--continue` — this is the linchpin. If `claude` rejects piped input without `-p`, you'd need to explore `expect` or a pseudo-TTY wrapper like `script -c` to fake an interactive session." So the entire mechanism may turn out to not work at all.
- **Effort:** ~3 hours if it works, ~6 hours if it doesn't and we fall back to `expect`.
- **Risk:** Medium. The piped-stdin question is the linchpin.

## 3. Recommended experiment plan

**Step 1 — Baseline (option A, outer wrapper):** build it first because it's the cheapest and the fallback for everything else. This gives us a KNOWN-GOOD safety net even if B and C fail.

**Step 2 — Option B (FileChanged bridge):** the user's preferred approach. Build the minimum viable version: 2 hooks + 1 nohup script + 1 trigger file. Test it in isolation by:

1. Starting a scenarios-autorunner batch.
2. Synthetically triggering a rate_limit from a scripted SCEN-BENCH-RATELIMIT that does `curl -v https://api.anthropic.com/v1/messages -H 'X-Bench-Force-Ratelimit: 1'` (or similar mock).
3. Verifying the `StopFailure` hook fires.
4. Verifying the `nohup` process sleeps for 60s (shortened for the test).
5. Verifying the trigger file is touched.
6. Verifying `FileChanged` fires AND the session resumes.

If all 6 steps pass → option B is the primary mechanism. Ship it as `scenarios-autorunner` v0.2.0.

**Step 3 — Option C fallback:** only if option B turns out to not fire FileChanged on post-StopFailure idle. If so, test the piped-stdin path, and if THAT fails, fall back to option A.

## 4. Acceptance criteria

The experiment is "done" when all of these are true on a full 22-scenario batch:

| # | Criterion | Measurement |
|---|-----------|-------------|
| 1 | A synthetic rate_limit during any scenario's runner triggers automatic retry | Manual injection via a mock endpoint; see `SCEN-BENCH-RATELIMIT` |
| 2 | The retry happens within 5-10 min (not immediately, not after an hour) | `tests/scenarios/state/overnight-progress.log` timestamps |
| 3 | After a successful retry, the batch continues with the NEXT scenario (not repeating the rest) | Progress log shows exactly one `[RETRY]` line between the original failure and the success |
| 4 | N=5 consecutive retry failures cause the batch to mark that scenario `[STUCK]` and advance | Progress log shows `[RETRY x5]` followed by `[STUCK]` and the next scenario starting |
| 5 | An orchestrator-level rate limit is also handled (not just runner-level) | Inject a rate_limit on the parent's turn; verify the whole orchestrator resumes |
| 6 | No API credits are consumed (Pro Max only) | Check `gh api user --jq .plan` + Anthropic dashboard shows 0 API credit usage during the test |
| 7 | The whole mechanism works with 0 human intervention for 12 hours straight | Full overnight batch completes; no human typed anything after "go" |

## 5. Files to create / modify

### New

- `tests/scenarios/state/rate-limit-wake-trigger.md` — empty stub, gitignored
- `scripts/retry-on-ratelimit.sh` (or equivalent inside `~/.claude/plugins/cache/emasoft-plugins/scenarios-autorunner/<v>/hooks/scripts/`) — the nohup bridge
- `scripts/scenarios-autorunner-wrapper.sh` — option A outer loop (fallback)

### Scenarios-autorunner plugin (v0.2.0)

- Edit `hooks/hooks.json` to add:
  - A `StopFailure` hook with matcher `rate_limit|authentication_failed|overloaded` that invokes `retry-on-ratelimit.sh`
  - A `FileChanged` hook watching the trigger file, returning `additionalContext` with the trigger file's contents
- New reference doc `references/rate-limit-resilience.md` documenting the mechanism for users

### Tests

- New smoke scenario `SCEN-BENCH-RATELIMIT.scen.md` (NOT part of the normal batch) that synthetically triggers a rate_limit so the retry mechanism can be exercised on demand. This may require a mock Anthropic endpoint.

## 6. Open questions (must resolve before implementation)

1. **Does `FileChanged` fire when Claude is in the post-StopFailure idle state?** No clear answer in the docs. Verifying this is experiment #1.
2. **Does `FileChanged` support `additionalContext` return?** The hooks docs I fetched listed `additionalContext` only for `SessionStart`, `UserPromptSubmit`, `PreToolUse`. `FileChanged` may not support it — in which case we'd need a different injection mechanism.
3. **Does `claude --continue` accept piped stdin on the subscription tier?** Anthropic docs assistant was uncertain. Test with a one-liner before relying on it.
4. **What is the correct backoff curve?** 5 min is a guess. Anthropic's Pro rate-limit window resets are not publicly documented. Start at 5 min, double on every failure up to 30 min, cap at 2 hours. Log the actual retry timing.
5. **Does the orchestrator's main-session `StopFailure` fire on subagent spawn errors, or only on the main session's own API errors?** The SCEN-018 failure showed the subagent's `StopFailure` fired (the breadcrumb got written), but the PARENT's stop did NOT fire. So parent-side hooks would need a DIFFERENT trigger mechanism.
6. **Can multiple `StopFailure` hooks run simultaneously** (one for the runner, one for the orchestrator), or will they conflict on the same trigger file?

## 7. Related references

- Official docs consulted (2026-04-14):
  - https://code.claude.com/docs/en/hooks-guide.md
  - https://code.claude.com/docs/en/sub-agents.md
  - https://code.claude.com/docs/en/hooks.md
  - https://code.claude.com/docs/en/scheduled-tasks.md
- Anthropic docs-assistant conversation (2026-04-14): recommended the `claude --continue` piped-stdin pattern (option C above) but flagged its linchpin caveat.
- scenarios-autorunner v0.1.2 cache: `~/.claude/plugins/cache/emasoft-plugins/scenarios-autorunner/0.1.2/hooks/hooks.json` — shows the existing `Stop` + `StopFailure` hook shapes.
- `tests/scenarios/state/rate-limit-breadcrumb.json` from the 2026-04-13 overnight batch — proves the existing `StopFailure` hook fires but cannot block/retry.
- `docs_dev/2026-04-13-handoff-scenarios-autorunner-overnight-test.md` — the overnight batch design assumptions, now partially invalidated by the discovery that `StopFailure` output is ignored.

## 8. Not in scope for this TRDD

- Rewriting the whole scenarios-autorunner conductor to be stateless-resumable. Option A requires some of this, but a full stateless redesign is a separate TRDD.
- Changing Anthropic's Pro rate-limit behavior (out of our control).
- Handling non-rate-limit errors (billing, invalid_request, server_error) — those are tracked separately.
- Implementing Option C's `expect`/pseudo-TTY fallback — deferred until after Option B is proven not to work.
