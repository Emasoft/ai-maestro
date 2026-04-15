# TRDD-1222f06a-602a-4686-a6a7-f2e4428c673e — scenarios-autorunner rate-limit retry experiment

**TRDD ID:** `1222f06a-602a-4686-a6a7-f2e4428c673e`
**Filename:** `design/tasks/TRDD-1222f06a-602a-4686-a6a7-f2e4428c673e-scenarios-autorunner-rate-limit-retry.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Design locked — 4-component architecture captured, ready for §3 Step 2 smoke test
**Created:** 2026-04-14
**Last updated:** 2026-04-15 — §2 Option B rewritten to user's corrected 4-component design; Q1 resolved
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

### Option B — Three hooks + a background polling bot (user's corrected design, 2026-04-15)

A clean four-component state machine. Three Claude Code hooks and one background Python script that the hooks orchestrate. Nothing else — no `claude --continue`, no piped stdin, no outer wrapper, no `sleep` inside hooks themselves.

**Components:**

1. **Alert detector — `StopFailure` hook.**
   - Matcher: `rate_limit|authentication_failed|overloaded|billing_error`
   - Action: launches `write_alerts_bot.py` as a detached background process via `nohup ... &` (and/or `setsid`). The hook exits immediately. Its output and exit code are ignored by Claude (per docs) — that's fine, all we need is the side effect of starting the bot.
   - Singleton guard: before spawning, checks `/tmp/write_alerts_bot.pid`. If the file exists AND the PID is alive, skip spawning (another rate-limited turn already started the bot).
   - Stale-pidfile handling: if the pidfile exists but the PID is dead (crash/reboot/kill -9), remove the pidfile and proceed to spawn.

2. **Alert bot — `write_alerts_bot.py` (standalone Python process).**
   - Writes its own PID to `/tmp/write_alerts_bot.pid` on startup.
   - Loop forever:
     - Append a timestamped line to `<project-root>/resume_needed_alert.md`:
       `"there was a rate limit api error at 2026-04-15T02:15:00Z"`
     - `sleep 300` (configurable via `--interval`)
   - Dies only when killed by the alert stopper. **The bot IS the timer** — no external cron, launchd, or systemd needed.

3. **Alert reader — `FileChanged` hook.**
   - Matcher: `.*/resume_needed_alert\.md$`
   - Returns `additionalContext`:
     `"There was a rate limit api error at <ts> that stopped you. Now it is passed. Resume all tasks."`
   - If Claude is in a post-StopFailure idle state but still listening for file events, this is the injection point that wakes the session.

4. **Alert stopper — `Stop` hook (NOT `StopFailure`).**
   - Matcher: unconditional (fires on every successful turn end).
   - Reads `/tmp/write_alerts_bot.pid`, kills the PID if alive, removes the pidfile.
   - **Fast-path no-op:** if the pidfile doesn't exist OR the PID isn't alive, exits 0 immediately. 99.9% of Stop events take this path; the stopper adds zero cost to normal turn-end.
   - **Proof-of-life guarantee:** the ONLY way the bot dies is Claude successfully completing a turn. Strongest possible evidence that the wake worked — no false-positive kills.

**Flow under a rate-limit incident:**

```
Claude turn hits rate_limit → turn ends with API error
  ↓
Alert detector (StopFailure) fires
  ↓ launches (if not already running):
  ↓   nohup python write_alerts_bot.py \
  ↓     --file <proj>/resume_needed_alert.md \
  ↓     --pidfile /tmp/write_alerts_bot.pid \
  ↓     --interval 300 &
  ↓ (hook exits; bot detached; bot writes its PID)
  ↓
Bot tick 1 (t+0s): append timestamped line
  ↓ triggers FileChanged on <proj>/resume_needed_alert.md
  ↓
Alert reader returns additionalContext → Claude wakes, tries to resume
  ↓
   ├─ Rate limit still open → new rate_limit error → new StopFailure
   │  → detector sees singleton pidfile, skips respawn
   │  → wait for bot tick 2 (t+5min)
   │
   └─ Rate limit closed → Claude completes a turn → Stop hook fires
         ↓ stopper reads pidfile, kills bot, removes pidfile
         ↓ normal operation resumes
```

- **Pros:**
  - **Self-healing retry loop.** The 5-minute cadence IS the backoff — no exponential formula, no math. Failed wakes just wait for the next tick.
  - **Proof-of-life shutdown.** Bot can only die via a successful Claude turn. Zero false-positive kills.
  - **Four orthogonal components**, each with exactly one job. Each is independently testable (see §3 Step 2).
  - **Rate-limit window handled for free** by the polling cadence.
  - **No `claude --continue`**, no piped stdin, no `expect`/pseudo-TTY, no outer wrapper. Entirely inside Claude Code's hook system.
  - **Preserves in-session state** — the live session, MCP connections, dev-browser daemons, everything stays alive through the rate-limit window. Option A restarts everything from disk.
- **Cons:**
  - Depends on four unproven behaviors (see §6 Q2-Q5): FileChanged firing in post-StopFailure idle state, FileChanged supporting `additionalContext` return, `nohup`+`disown` surviving hook exit on macOS, and Stop hook firing reliably on every successful turn end.
  - Singleton pidfile logic needs careful stale-PID handling and parallel-race protection (Q7).
  - Protects subagents only until Q6 is resolved (parent-level StopFailure doesn't fire on subagent errors).
- **Effort:** ~1 day (write the 4 components, run the §3 Step 2 smoke test in 4 isolated sub-tests, debug).
- **Risk:** Medium. Four unknowns are structurally un-designable without running the experiment. If any single one is NO, this design fails and Option A becomes permanent primary.

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

**Updated 2026-04-15:** The rewrite TRDD-f79f6047 will ship Option A (outer wrapper loop) as the primary rate-limit resilience mechanism because it's the most robust and has no unknowns. But Option B (the 4-component design from §2) is **still worth testing independently** because if it works, it's a strictly better pattern: it preserves in-session state rather than restarting the entire Claude Code process, keeping all live context, open MCP connections, and any dev-browser daemons alive through the rate-limit window. Option A restarts everything from disk state.

The experiment order below is REVISED: all three options must be evaluated, not just "A as fallback for B".

### Step 1 — Option A baseline (ships in v0.2.0)

Build the outer wrapper loop first because it's the safety net and the explicit deliverable for the v2 plugin rewrite (TRDD-f79f6047 Section 4.5). Required for overnight batches shipping before the FileChanged experiment concludes.

- `scripts/run-overnight.sh` — `while true; claude --continue; [[ $? -eq 0 ]] && break; sleep 300; done`
- Test by deliberately killing Claude mid-batch and verifying the wrapper restarts it
- Verify it survives a real rate_limit using a synthetic test (see Step 2.3 below)

### Step 2 — Option B MANDATORY independent experiment (runs in parallel with Step 1, not after)

The user explicitly wants this tested because it's the only pattern that keeps the main session alive through a rate-limit window. Cannot be skipped just because Option A ships first. Time-box: 2 days.

The 4-component design (§2 Option B) has **four unknowns** that must be verified independently before integration. Each sub-step tests exactly one component. Do NOT combine components until each passes on its own.

**2.1 — FileChanged basics: does it fire on idle sessions AND does it support `additionalContext`?**

This tests the **alert reader** (Stop component 3) in isolation. No bot, no detector, no stopper — just: does Claude wake up when a file changes, and can a hook return `additionalContext` from the FileChanged event?

Create a minimal test hook in a throwaway plugin at `/tmp/filechanged-test/hooks/hooks.json`:

```json
{
  "hooks": {
    "FileChanged": [{
      "matcher": ".*/resume_needed_alert\\.md$",
      "hooks": [{
        "type": "command",
        "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"FileChanged\",\"additionalContext\":\"EXTERNAL WAKE: the file you were watching changed. Print the string ALERT_READER_OK in the chat and stop.\"}}'"
      }]
    }]
  }
}
```

Procedure:
1. Start a Claude Code session with the throwaway plugin loaded.
2. Give Claude one trivial turn ("say hello") so it reaches the idle prompt.
3. From another terminal: `echo "line1" >> /tmp/resume_needed_alert.md`
4. Observe whether Claude wakes and prints `ALERT_READER_OK`.

Observation matrix:

| Result | Verdict | Next step |
|--------|---------|-----------|
| Claude wakes AND prints `ALERT_READER_OK` | **PASS.** FileChanged fires on idle + supports `additionalContext` | Proceed to 2.2 |
| Claude wakes but ignores the injected text | PARTIAL. FileChanged fires but `additionalContext` is dropped — design must use a different injection mechanism (e.g., the hook appends to a scratch file Claude is told to read on wake) | Proceed to 2.2 with revised reader |
| Claude does not wake at all on file change | FAIL at 2.1. Option B is dead — FileChanged cannot be the alert reader. Document as "Option B blocked on FileChanged idle-wake semantics", fall back to Option A permanently | Abort Option B |

**2.2 — nohup survival: does a background process launched from StopFailure outlive the turn?**

This tests the **alert detector** (§2 component 1) — specifically that `nohup python write_alerts_bot.py &` from inside a StopFailure hook genuinely detaches the bot from Claude Code's process group, so it keeps running after the hook exits, the turn ends, and Claude goes idle.

Procedure:
1. Write a stub `write_alerts_bot.py` that loops `echo "tick $(date)" >> /tmp/bot-heartbeat.log; sleep 5` forever.
2. Add a `StopFailure` hook with matcher `rate_limit|authentication_failed|overloaded` that runs:
   ```bash
   nohup python /tmp/write_alerts_bot.py > /tmp/bot.out 2>&1 &
   echo $! > /tmp/write_alerts_bot.pid
   disown $! 2>/dev/null || true
   ```
3. Induce a synthetic rate_limit using the technique in 2.3.
4. Wait 60 seconds after the Claude turn has fully exited.
5. Check `/tmp/bot-heartbeat.log` — is it still growing? Is the PID still alive (`kill -0 $(cat /tmp/write_alerts_bot.pid)`)?

Observation matrix:

| Result | Verdict | Next step |
|--------|---------|-----------|
| PID alive, log growing after 60s | **PASS.** nohup+disown correctly detaches from Claude's process group | Proceed to 2.3 |
| PID dies when turn ends | FAIL. Try alternate detachment: `setsid nohup python ...`, or wrap in `at now`, or `launchctl submit` on macOS | Retry 2.2 with alternative |
| PID alive but log empty | The bot starts but can't write. Check CWD resolution inside the hook context — hooks may run in a different directory than the project root | Fix and retry |

**Notes on `nohup` portability:** macOS's `bash` handles `nohup ... &` differently from Linux (process group inheritance rules differ). `disown` is the bash-specific incantation that removes the job from the parent's job table; without it the process can still be SIGHUP'd. On POSIX-strict shells, use `(setsid command &) &` as a belt-and-braces alternative. Document whichever pattern works on macOS 14+ since that's the target.

**2.3 — Stop hook as alert stopper: does Stop fire on successful turn end, and does the fast-path no-op add no cost?**

This tests the **alert stopper** (§2 component 4). The Stop hook must:
1. Fire reliably on every successful turn end (not StopFailure).
2. Be a cheap no-op when `/tmp/write_alerts_bot.pid` doesn't exist.
3. Kill the bot PID and remove the pidfile when the pidfile IS present.
4. Not double-kill or crash if the PID is already dead (stale pidfile).

Procedure:
1. Register a minimal Stop hook that runs `stop_alerts_bot.sh`:
   ```bash
   #!/usr/bin/env bash
   PIDFILE=/tmp/write_alerts_bot.pid
   [ -f "$PIDFILE" ] || exit 0                          # fast-path no-op
   PID=$(cat "$PIDFILE" 2>/dev/null)
   [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && kill "$PID" 2>/dev/null
   rm -f "$PIDFILE"
   exit 0
   ```
2. Three sub-tests:
   - **2.3a** — no pidfile exists. Complete a normal turn. Verify Stop hook runs and exits 0 immediately (measure wall-clock; should be <100ms).
   - **2.3b** — bot is running from 2.2. Complete a normal turn. Verify the PID is killed and the pidfile is gone.
   - **2.3c** — stale pidfile: `echo 99999 > /tmp/write_alerts_bot.pid` (nonexistent PID). Complete a normal turn. Verify the stopper handles the stale PID gracefully (no crash, pidfile removed).
3. Observe tmux pane output of the Claude session to confirm Stop hook exit codes don't leak error messages into the chat.

Observation matrix:

| Sub-test | Pass condition |
|----------|---------------|
| 2.3a (no pidfile) | Stop hook exits 0, no process started, <100ms wall time |
| 2.3b (bot running) | Bot PID dead after turn end, pidfile removed |
| 2.3c (stale pidfile) | No error shown to Claude, pidfile removed, no crash |

**2.4 — Full 4-component integration**

Only after 2.1, 2.2, and 2.3 each PASS independently, wire them together using the real files from §5:

1. Start a scenarios-autorunner batch (or any long Claude session).
2. Flip the mock Anthropic server (from 2.5 below) to rate-limit mode mid-turn.
3. Observe the cascade:
   - StopFailure (detector) fires → spawns `write_alerts_bot.py` in background → writes pidfile
   - Bot tick 1 (t+0s): appends first line to `resume_needed_alert.md` → FileChanged (reader) fires → returns `additionalContext` → Claude reads "there was a rate limit api error… resume" → attempts to continue
   - If rate limit still open: Claude's retry hits another rate_limit → new StopFailure fires → detector sees the singleton pidfile and skips respawn → Claude idles → wait for bot tick 2 at t+5min
   - Eventually rate limit closes: Claude successfully completes a turn → Stop (stopper) fires → kills bot, removes pidfile
4. Measure: how many bot ticks happened before success? Did the bot kill itself cleanly? Did the scenario resume from the correct step?

Acceptance:
- The scenario completes correctly.
- `/tmp/write_alerts_bot.pid` does not exist at end.
- The bot process is not in the process table at end.
- `resume_needed_alert.md` contains N timestamped lines, where N matches the observed retry attempts.

**2.5 — Synthetic rate_limit for testing**

There's no official way to induce a rate_limit from the client side. The simplest reliable path is a mock Anthropic server in Python (≈30 lines) that returns `{"type":"error","error":{"type":"rate_limit_error","message":"..."}}` on every request. Point Claude Code at it via `ANTHROPIC_API_URL=http://localhost:NNNN`. The mock needs a toggle (file-based or HTTP POST) so the test harness can flip it between "pass-through" and "rate-limit-mode" mid-run.

This mock is used by 2.2, 2.3, and 2.4.

**Exit criteria for the whole of Step 2:**

| Outcome | Action |
|---------|--------|
| 2.1 PASS + 2.2 PASS + 2.3 PASS + 2.4 PASS | Option B becomes the primary mechanism in v0.3.0. Option A stays as the fallback for when Claude Code itself crashes (nothing Option B can do about that). |
| 2.1 FAIL (FileChanged idle-wake broken) | Option B is permanently blocked. Ship Option A only. Document the failure and re-test Option B only if Claude Code's hook semantics change. |
| 2.2 FAIL on all detachment variants | Option B is blocked by macOS process-group semantics. Fall back to a launchd-based alert bot instead. Reassess effort — may push Option B to a later sprint. |
| 2.3 FAIL (Stop hook unreliable or expensive) | Swap the stopper for a periodic self-healthcheck inside `write_alerts_bot.py` itself (e.g., bot checks Claude's idle state every tick and self-terminates when it sees proof-of-life). More complex but still workable. |
| 2.4 FAIL after all components individually pass | Integration bug — most likely a race between bot-tick and FileChanged hook. Debug with more verbose logging. |

### Step 3 — Option C sanity check

Run the Anthropic docs-assistant's `claude --continue` piped-stdin pattern as a quick one-liner test, NOT as a primary design:

```bash
echo "retry" | claude --session-id <id> --continue
```

- If it accepts piped stdin on subscription tier → document as a debugging aid
- If it rejects → confirm the docs-assistant's caveat was correct, move on

Time-box: 30 min. Not a serious candidate for primary mechanism.

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

### New — Option B (4-component design)

- `<project-root>/resume_needed_alert.md` — the alert log file. Bot appends one timestamped line per tick. Watched by the FileChanged (alert reader) hook. Git-ignored. The file is created on-demand by the bot — it does not need to exist before the first StopFailure.
- `.claude/hooks/scripts/write_alerts_bot.py` — the background polling bot. Standalone Python script (no dependencies beyond stdlib). CLI flags:
  - `--file <path>` — the alert file to append to (default: `$CLAUDE_PROJECT_DIR/resume_needed_alert.md`)
  - `--pidfile <path>` — the singleton pidfile (default: `/tmp/write_alerts_bot.pid`)
  - `--interval <seconds>` — tick interval (default: 300)
  - `--message <tmpl>` — line template, supports `{ts}` placeholder (default: `"there was a rate limit api error at {ts}"`)
  On startup: writes its PID to the pidfile. Loop: append line, sleep interval. Dies only when killed by the stopper.
- `.claude/hooks/scripts/start_alerts_bot.sh` — the detector helper. Called by the StopFailure hook. Handles singleton-pidfile logic: checks if pidfile exists and PID is alive; if yes, exits 0 (bot already running); if no or stale, launches `nohup python write_alerts_bot.py &` (with `disown` on bash, fallback to `setsid` otherwise). This script isolates the detachment incantation so 2.2 can iterate on it without editing `hooks.json`.
- `.claude/hooks/scripts/stop_alerts_bot.sh` — the stopper helper. Called by the Stop hook. Fast-path no-op if pidfile absent. Kills PID, removes pidfile, handles stale-PID case gracefully.

### New — Option A (outer wrapper fallback)

- `scripts/run-overnight.sh` — outer `while true; claude --continue; [[ $? -eq 0 ]] && break; sleep 300; done` wrapper. Option A baseline per §3 Step 1.

### Scenarios-autorunner plugin (v0.2.0) — `hooks/hooks.json` edits

Add three hooks to the plugin's `hooks/hooks.json`:

1. **Alert detector** — `StopFailure` with matcher `rate_limit|authentication_failed|overloaded|billing_error`, command `.claude/hooks/scripts/start_alerts_bot.sh`.
2. **Alert reader** — `FileChanged` with matcher `.*/resume_needed_alert\.md$`, command returns `additionalContext` via JSON: `{"hookSpecificOutput":{"hookEventName":"FileChanged","additionalContext":"There was a rate limit api error at <ts> that stopped you. Now it is passed. Resume all tasks."}}`. The `<ts>` substitution is done by a tiny shell script that reads the last line of the alert file.
3. **Alert stopper** — `Stop` (unconditional matcher), command `.claude/hooks/scripts/stop_alerts_bot.sh`.

Also add a reference doc `references/rate-limit-resilience.md` documenting the 4-component mechanism for end users.

### Tests

- New smoke scenario `SCEN-BENCH-RATELIMIT.scen.md` (NOT part of the normal batch) that synthetically triggers a rate_limit via the mock Anthropic server from §3 Step 2.5 so the retry mechanism can be exercised on demand.
- Unit test for `write_alerts_bot.py`: start bot, verify pidfile, verify one tick, SIGTERM, verify clean exit.
- Integration test for `start_alerts_bot.sh`: second invocation while first bot is running → must be a no-op.

## 6. Open questions

### Resolved

1. **Does `StopFailure` fire on rate-limit-class API errors (rate_limit, authentication_failed, overloaded)?** — **RESOLVED 2026-04-15** (user confirmation). User tested empirically and reports: *"the question 1 was already tested by me.. StopFailure is still executed after a rate limit."* Good: the alert detector (component 1) has a working trigger.

### Open (must resolve before implementation — these are the exit gates for §3 Step 2)

2. **Q2 — Does `FileChanged` fire while Claude is in the post-StopFailure idle state?** Tested in §3 Step 2.1. The docs I fetched on 2026-04-14 list the `FileChanged` event as existing but don't describe its behavior when the session is idle vs. actively in a turn. If FileChanged only fires mid-turn, the alert reader (component 3) has no wake signal and Option B is dead.

3. **Q3 — Does `FileChanged` support returning `additionalContext` to wake a turn?** Tested in §3 Step 2.1. The official hooks docs as of 2026-04-14 document `additionalContext` only for `SessionStart`, `UserPromptSubmit`, and `PreToolUse`. If `FileChanged` cannot return `additionalContext`, Option B needs a different injection mechanism — e.g., the hook runs a script that `touch`es a scratch file Claude has been told (via the session's initial prompt) to `Read` on any wake.

4. **Q4 — Does `nohup python ... &` from inside a `StopFailure` hook survive turn end on macOS 14+?** Tested in §3 Step 2.2. Historically bash's `nohup` + `disown` is reliable on macOS, but hooks run in a restricted process context and the behavior under Claude Code's own process-group shutdown is undocumented. If the bot dies with the parent, the alert bot (component 2) never ticks and Option B is dead. Fallbacks: `setsid`, `launchctl submit`, `at now`.

5. **Q5 — Does the `Stop` hook fire reliably on every successful turn end?** Tested in §3 Step 2.3. The stopper (component 4) MUST be called on every successful turn so the bot can be killed. If Stop is unreliable (fires only sometimes, or fires only on specific event types), the bot will keep ticking forever and pollute `resume_needed_alert.md` indefinitely.

### Open (don't block Step 2 but need an answer before v0.3.0 ships)

6. **Q6 — Does the orchestrator's main-session `StopFailure` fire on subagent spawn errors, or only on the main session's own API errors?** The 2026-04-14 overnight batch provided empirical evidence: when 8 parallel subagents died to rate_limit, **the subagent-level `StopFailure` fired** (we saw the breadcrumb in `tests/scenarios/state/rate-limit-breadcrumb.json`), but **the orchestrator/parent-level `StopFailure` did NOT fire** — the parent Claude saw the subagent's error as a normal Task tool result and kept running. This means parent-side retry needs a different mechanism:
   - Option: the orchestrator inspects Task tool results for rate-limit error patterns and triggers its OWN alert bot.
   - Option: parent-side rate limit handling is deferred to Option A only (the outer wrapper catches it when the whole orchestrator dies).
   Until this is resolved, Option B protects subagents only.

7. **Q7 — Can multiple StopFailure hooks run simultaneously without racing on the singleton pidfile?** In a parallel-subagent run (like the 2026-04-14 batch), 8 subagents may each trigger StopFailure within milliseconds of each other. The singleton check in `start_alerts_bot.sh` uses "pidfile exists + kill -0 succeeds → already running, skip", but if 8 invocations race:
   - invocation A reads "no pidfile", starts to launch bot
   - invocation B reads "no pidfile" before A writes one, also starts to launch bot
   - now there are two bots writing to the same alert file, and the stopper only kills one PID
   **Mitigation:** use `mkdir /tmp/write_alerts_bot.lockdir` as a file-system atomic lock (mkdir is atomic on POSIX). Only the mkdir-winner launches the bot. Must be tested under parallel load.

8. **Q8 — What is the correct bot tick interval?** The user's design specifies 5 minutes. This is a reasonable default for the Pro rate-limit window (unofficially ~5-minute cycles), but different rate-limit types (auth failure, billing, overloaded) may have different recovery windows. Should the interval be adaptive? Probably not — the proof-of-life shutdown means that over-polling is harmless (next success just ends the bot earlier), so a fixed 5-minute interval is good enough. **Log the actual retry timing in production** to confirm the 5-minute assumption.

### Not relevant to Option B (left open as reference)

9. **Does `claude --continue` accept piped stdin on the subscription tier?** Relevant only to Option C. The Anthropic docs assistant was uncertain. Test with a one-liner before relying on it. Option B does NOT use `claude --continue`.

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
