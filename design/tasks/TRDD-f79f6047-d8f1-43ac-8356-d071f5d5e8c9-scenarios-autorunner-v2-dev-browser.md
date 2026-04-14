# TRDD-f79f6047-d8f1-43ac-8356-d071f5d5e8c9 — scenarios-autorunner v2 with dev-browser integration

**TRDD ID:** `f79f6047-d8f1-43ac-8356-d071f5d5e8c9`
**Filename:** `design/tasks/TRDD-f79f6047-d8f1-43ac-8356-d071f5d5e8c9-scenarios-autorunner-v2-dev-browser.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started — spec for plugin rewrite after the 2026-04-14 overnight batch + improvements review
**Created:** 2026-04-14
**Owner:** TBD
**Priority:** P0 (current plugin has 5 critical architectural flaws exposed by the overnight run)
**Related:** TRDD-1222f06a-... (rate-limit retry) — this rewrite is the delivery vehicle for that fix too

---

## 1. Problem statement

The 2026-04-14 overnight batch of 22 scenarios exposed five architectural flaws in `scenarios-autorunner` v0.1.2 that make it unreliable for unattended overnight runs:

### Flaw 1 — Chrome-fork explosion

Every `scenarios-autorunner:scenario-runner` subagent I spawn is a forked Claude Code context. Forks load MCP tools independently: each fork triggers a new `chrome-devtools-mcp` process which spawns its OWN private headless Chromium. Over 22 scenarios, the batch left **45 orphan `chrome-devtools-mcp` node watchdog processes** plus however many transient Chromium processes, totaling ~4 GB of lingering memory. The user's Mac was close to an OOM event by morning.

**User's expectation was:** "one long scenario" reusing ONE Chromium across all 22 runs. We delivered: 22 separate Chromium instances, accumulated as orphans.

### Flaw 2 — Browser extension dependency fragility

Prior to this morning's `/reload-plugins`, the overnight scenarios drove the UI through the `claude-in-chrome` browser extension (not chrome-devtools-mcp). That stack requires:
- Chrome.app running
- The Claude browser extension installed and connected to claude.ai
- One-click manual "Connect to Claude Code" authorization

When Chrome.app closed at some point during the night (cause unknown — probably macOS memory pressure from the 45 orphan processes + open Chromium instances), the extension disconnected. All 4 remaining scenarios (SCEN-019..022) were blocked this morning until the user clicked Connect again.

**Overnight unattended runs cannot depend on an interactive extension connect flow.**

### Flaw 3 — Phase 0/CLEANUP redundancy across subagent forks

Per scenario, Phase 0 SAFE-SETUP does: commit state, STATE-WIPE backup, yarn build, pm2 restart, kill orphans, login, baseline screenshot. Phase CLEANUP does similar in reverse. Running this 22 times wastes ~55 min of wall-clock time (yarn build alone is ~1 min × 22 = 22 min wasted). We band-aided this with a master setup/cleanup script wrapping the batch, but each scenario's Phase 0/CLEANUP still runs inside the runner subagent's context anyway unless explicitly told to skip (which we did via an override in the spawn prompt — brittle).

The proper architecture: Phase 0/CLEANUP are MASTER concerns, run once per batch, and scenarios start from "logged in, clean state" without redoing master work.

### Flaw 4 — No rate-limit self-healing

When a runner hit a 401 `authentication_failed` mid-run (SCEN-018), the subagent died and the parent (me) had no automated retry. I had to detect the error manually, wait, retry. TRDD-1222f06a covers the design for this but the v2 rewrite is the delivery vehicle.

### Flaw 5 — No screenshot provenance

Rule 10 stored screenshots as `SCEN-NNN/S<NNN>-<desc>.png` — no timestamp. Multiple runs of the same scenario overwrote each other. We fixed Rule 10 today (timestamped dir + filename + JPEG format) but the plugin bundled copy of the rules file is stale. The rewrite must ship the new convention.

## 2. Proposed solution: incorporate `dev-browser` as the browser backend

[`SawyerHood/dev-browser`](https://github.com/SawyerHood/dev-browser) is a standalone CLI browser automation tool with properties that directly address our flaws:

| Need | dev-browser capability |
|------|----------------------|
| Persistent browser across forks | **"Navigate once, interact across multiple scripts"** — explicit feature. One Chromium, many scripts. |
| No extension dependency | Playwright-based, launches its own Chromium — no browser extension required |
| Fast + cheap | Benchmarks: **3m 53s / $0.88** vs Claude Chrome Extension's 12m 54s / $2.81 — **3.2× faster, 3.2× cheaper** |
| Sandboxed execution | Scripts run in **QuickJS WASM sandbox**, no host access — safer for AI-driven code |
| Auto-connect or fresh | `--connect` to existing Chrome OR spawn headless instance, flexible |
| File I/O safety | Restricted to `~/.dev-browser/tmp/` — prevents test scripts from escaping the sandbox |

## 3. Architecture (v2 target)

```
┌─────────────────────────────────────────────────────────────┐
│  Main Claude Code session (orchestrator)                     │
│                                                                │
│  1. Invokes /run-scenarios-batch 1-22 --improve              │
│  2. Skill master setup:                                       │
│     - git commit state                                        │
│     - STATE-WIPE backup                                       │
│     - yarn build + pm2 restart                                │
│     - Launch dev-browser daemon: `dev-browser daemon start` │
│       (one Chromium, persistent, socket at /tmp/dev-browser.sock) │
│     - Login once, save session cookie to dev-browser state   │
│  3. For each scenario n in 1..22:                            │
│     Agent(subagent_type: scenario-runner, prompt: SCEN-n)    │
│       - subagent connects to running dev-browser daemon      │
│         via `dev-browser exec --socket /tmp/dev-browser.sock` │
│       - subagent runs ONLY phases 1..N-1 (no Phase 0/CLEANUP)│
│       - subagent's scripts are QuickJS JS blobs, not CDP     │
│       - shares ONE Chromium, ONE logged-in session           │
│       - 2-line summary back to orchestrator                  │
│  4. Master cleanup:                                          │
│     - Run cleanup script (kills scen* agents, tmux, restores state) │
│     - `dev-browser daemon stop` (kills Chromium cleanly)     │
│     - Compress screenshots PNG→JPEG 97% via existing script  │
│  5. P0 PR creation (unchanged from v1)                       │
│                                                                │
└─────────────────────────────────────────────────────────────┘
```

## 4. Rewrite tasks (incorporate dev-browser + customize)

### 4.1 Vendor `dev-browser` as a plugin dependency

- Add `dev-browser` as an `npm install -g` requirement documented in the plugin's `install.sh` or `scripts/install-dev-browser.sh`
- Expose `dev-browser install` as a one-time setup step (installs Playwright + Chromium)
- Fallback: if `npm install -g` fails (no permissions), install to `~/.local/lib/node_modules`

### 4.2 Master daemon lifecycle

New plugin-bundled script `hooks/scripts/dev-browser-daemon.sh`:
- `start` — spawn `dev-browser` in daemon mode with a deterministic socket path (`$CLAUDE_PROJECT_DIR/tests/scenarios/state/dev-browser.sock`)
- `stop` — send clean shutdown signal, wait for Chromium to exit, kill if stuck after 10s
- `status` — check if daemon is alive, return the socket path
- `health` — verify the daemon responds to a trivial script (`browser.getPage("main")`)

Invoked by `run-scenarios-batch` skill in master setup and cleanup phases.

### 4.3 Runner subagent — switch from MCP tools to CLI scripts

The runner's tool loading changes from:

```
ToolSearch select:mcp__plugin_chromedev-tools_cdt__*
```

to running JavaScript scripts via Bash:

```bash
dev-browser exec --socket $SOCK <<'EOF'
const page = await browser.getPage("main");
await page.goto("http://localhost:23000/");
const title = await page.title();
console.log(JSON.stringify({ title }));
EOF
```

The runner agent's prompt template is updated to say "use dev-browser CLI scripts for all UI actions, not MCP tools". Each scenario step becomes a QuickJS script that the runner pipes to `dev-browser exec`.

**Complication:** the current scenario files (`SCEN-NNN_*.scen.md`) say `required_tools: mcp__chrome-devtools__*`. The v2 scenarios must switch to a new schema or allow both tool types.

**Proposed fix:** Rule 8 CHROME-TOOL is updated in `references/SCENARIOS_TESTS_RULES.md` to say "the canonical browser automation stack for this plugin is dev-browser. Scenarios declare the required tool family in their frontmatter as `browser_stack: dev-browser` (default) or `browser_stack: chrome-devtools-mcp` (legacy)". Existing scenarios are backward-compatible.

### 4.4 Customization for AI Maestro UI testing

Our scenarios need several helpers that dev-browser doesn't provide out-of-the-box. Add them as QuickJS helper functions in a bundled file `references/dev-browser-aim-helpers.js`:

- **`aimLogin(password)`** — navigates to `/`, fills governance password, clicks Sign In, waits for dashboard
- **`aimSudoModal(password)`** — detects the sudo modal when a destructive operation triggers it, fills the password, confirms
- **`aimTakeScreenshot(stepId, runId, desc)`** — generates the Rule 10 path `screenshots/SCEN-<NNN>_<RUN_ID>/S<NNN>_<RUN_ID>_<desc>.jpg`, calls `page.screenshot({ type: 'jpeg', quality: 97, path: ... })`
- **`aimCreateAgent(opts)`** — walks the agent creation wizard with a preset config
- **`aimDeleteAgent(agentId, password)`** — Profile → Danger Zone → sudo modal → confirm
- **`aimWaitForIdle(agentId, timeoutMs)`** — polls the agent's terminal status (via HTTP API, not UI) until Claude is in `idle_prompt` state
- **`aimAssertNoAgentFolderLeak(testPrefix)`** — sanity check that no `scen<NNN>-*` agent folder was created outside `~/agents/`

These helpers are pre-loaded into every `dev-browser exec` script so scenarios can just say `await aimLogin(PASSWORD)` instead of reimplementing the same login sequence.

### 4.5 Rate-limit self-healing (TRDD-1222f06a integration)

Per TRDD-1222f06a option A: add an outer wrapper script that restarts the orchestrator on exit code != 0. For v2, this becomes:

```bash
# scripts/run-overnight.sh — the user runs this instead of typing /run-scenarios-batch
while true; do
  claude --continue <<'EOF'
Resume the overnight batch from tests/scenarios/state/overnight-progress.log
EOF
  [ $? -eq 0 ] && break
  echo "Claude exited non-zero, sleeping 300s then retrying..."
  sleep 300
done
```

The outer loop survives any rate-limit-induced Claude Code exit. When Claude restarts, it reads the progress log, skips already-done scenarios, and continues.

### 4.6 Screenshot convention enforcement

Update the plugin's bundled `references/SCENARIOS_TESTS_RULES.md` Rule 10 to match the new convention we just committed in the project copy (timestamped dir + file, JPEG 97%). Run `publish.py --patch` to release v0.2.0.

### 4.7 MCP-readiness preflight in master setup

Add a sanity check to `setup-overnight-batch.sh`: verify the dev-browser daemon responds to a trivial script before declaring setup complete. Fail fast with a clear error message if it doesn't, pointing the user at the specific broken component.

## 5. Experiment plan

1. **Spike: run SCEN-001 via dev-browser CLI manually** to validate the QuickJS helpers work for our login flow. Identify any surface missing from the API.
2. **Rewrite the runner subagent prompt** to use dev-browser scripts, keep everything else the same. Run SCEN-001..005 (a subset) to verify the end-to-end flow.
3. **Add the AI Maestro helpers** and re-run SCEN-001..005 using the helpers. Compare timing: target 30% faster than the chrome-devtools-mcp v1.2 baseline.
4. **Daemon mode** — launch the daemon once before a 5-scenario batch, verify all 5 run against the same Chromium without orphan accumulation. `ps | grep chrome-devtools-mcp` should return 0 after each batch.
5. **Rate-limit outer wrapper** — simulate a rate-limit mid-batch, verify the wrapper restarts Claude and the batch resumes.
6. **Full batch** — run SCEN-001..022 unattended. Success criteria: 22 pass/partial/stuck results, 1 Chromium at peak, 0 orphan processes after cleanup, ≤300 MB memory footprint at peak.

## 6. Acceptance criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| 1 | 22 scenarios share ONE Chromium | `ps \| grep chromium \| wc -l` stays at 1 during batch |
| 2 | Zero orphan chrome-devtools-mcp processes after master cleanup | `pkill -f chrome-devtools-mcp` finds nothing |
| 3 | Full batch completes in ≤ 4 hours wall-clock | Timestamps in progress log |
| 4 | Rate-limit injection causes wrapper restart, batch resumes | Synthetic `--force-rate-limit` script |
| 5 | No extension dependency | Batch runs with no Google Chrome.app, no browser extension |
| 6 | Screenshots saved to `SCEN-<NNN>_<RUN_ID>/S<NNN>_<RUN_ID>_<desc>.jpg` | Glob + regex check after batch |
| 7 | Each scenario's Phase 0/CLEANUP run ZERO times (master handles it once) | Scenario runner prompt instructs skip + no duplicate build/backup actions |
| 8 | Memory footprint at peak ≤ 500 MB for the test infrastructure | `vm_stat` samples during batch |

## 7. Open questions

1. **QuickJS API coverage** — does dev-browser's QuickJS sandbox support enough Playwright API for our helpers? `page.click`, `page.fill`, `page.waitForSelector`, `page.screenshot`, `page.evaluate` must all work. Need to verify before committing to the design.
2. **Login session persistence** — can the master-setup login cookie survive across `dev-browser exec` script invocations? Or does each script start with a fresh context? The "Persistent pages" feature suggests yes, but needs verification.
3. **Screenshot path writeable from sandbox** — dev-browser restricts file I/O to `~/.dev-browser/tmp/`. The Rule 10 convention wants screenshots in `tests/scenarios/screenshots/`. Workaround: screenshots go to `~/.dev-browser/tmp/SCEN-<NNN>_<RUN_ID>/...`, and the runner subagent copies them to the scenario dir via Bash (outside the sandbox).
4. **Dev-browser daemon stability** — running a Chromium for 8 hours continuous across 22 scenarios — does it leak memory? Does the daemon recover from page crashes?
5. **Backward compatibility** — existing scenarios (`SCEN-001..022`) reference `mcp__chrome-devtools__*` in their `required_tools`. Do we rewrite them or introduce a browser_stack field?
6. **Plugin cache vs git-tracked source** — the rewrite lives in the `scenarios-autorunner` GitHub repo. But the bundled `references/SCENARIOS_TESTS_RULES.md` is currently stale. Need to publish v0.2.0 via `publish.py` with the rewrite.

## 8. Files to create / modify

### scenarios-autorunner plugin (v0.2.0 target)

- `scripts/install-dev-browser.sh` — new: installs dev-browser + Playwright chromium on demand
- `hooks/scripts/dev-browser-daemon.sh` — new: lifecycle management (start/stop/status/health)
- `references/dev-browser-aim-helpers.js` — new: QuickJS helper library for AI Maestro scenarios
- `references/SCENARIOS_TESTS_RULES.md` — update: Rule 8 CHROME-TOOL → point at dev-browser, Rule 10 → timestamped convention (match the project copy we committed today)
- `agents/scenario-runner.md` — update: "use dev-browser exec, not CDP MCP tools"
- `skills/run-scenarios-batch/SKILL.md` — update: master setup calls dev-browser daemon start, master cleanup calls daemon stop
- `scripts/run-overnight.sh` — new: outer wrapper loop for rate-limit resilience (per TRDD-1222f06a)

### ai-maestro project

- `scripts/run-overnight.sh` — wrapper convenience script for the user (one-liner to launch a batch)
- `tests/scenarios/scenarios-autorunner.config.json` — optional config for daemon socket path, custom helper include paths, etc.

## 9. Not in scope

- Rewriting the 22 existing scenario files — they stay as-is, backward compatibility via the `browser_stack` frontmatter field
- Changing the report format (Rule 9) — current REPORT-FORMAT stays
- Mobile device emulation changes — `page.setViewport` already works in Playwright
- Multi-browser testing (Firefox, Safari) — dev-browser is Playwright-based so this is trivial later but not needed now
- Claude Code plugin packaging format changes — stay within the current `.claude-plugin/plugin.json` + `.mcp.json` conventions (the daemon runs outside the MCP boundary)

## 9a. MANDATORY CONSTRAINT: Cleanup must go through the UI (Rule 6)

**Added 2026-04-14 after the v1.2 batch's master cleanup was caught violating Rule 6.**

The v1.2 plugin's `fixture_delete_agents_by_prefix` function in `fixture-helpers.sh` attempted to delete test agents via direct `/api/agents` DELETE calls. After SEC-PHASE-1c auth hardening, those calls are correctly rejected by the sudo-mode gate — which means **the cleanup script's API bypass was an accidental security hole that never actually worked in production**. The 2026-04-14 batch left 63 orphan scen* agents in the registry because of this.

Rule 6 STICK-TO-UI is NOT just for scenario test steps. It applies to EVERY operation the scenarios-autorunner plugin performs against the system under test, including cleanup. The v2 rewrite MUST:

1. **Remove all direct `/api/*` DELETE calls** from `fixture-helpers.sh` and any other plugin script. The only HTTP calls allowed in fixture scripts are to external systems (GitHub for fixture repos, etc.), never to the system-under-test's API.

2. **All test artifact cleanup happens via UI**: the master cleanup spawns a dedicated `scenarios-autorunner:cleanup-runner` subagent (new agent type in v2) that drives the dashboard through the same UI flow a real user would use: navigate to each test agent → Profile → Advanced → Danger Zone → Delete Agent → enter sudo password → confirm. This subagent uses dev-browser + aim-helpers.js + the same `aimDeleteAgent` helper the scenarios use.

3. **The dashboard's "bulk delete" or "select all scen*" functionality is a candidate for implementation** if manual per-agent UI deletion is too slow. If implemented, the cleanup-runner uses the bulk delete flow instead of iterating. But bulk delete ALSO goes through the UI and the same sudo authentication, never directly.

4. **Document the ban on direct API cleanup in `references/SCENARIOS_TESTS_RULES.md` Rule 6 itself** so future contributors don't reintroduce the pattern. Add a concrete example of what NOT to do (the old `fixture_delete_agents_by_prefix`) and what TO do (spawn a cleanup-runner).

The failure mode here is important: a cleanup script bypassing UI auth would have been a latent security vulnerability — if an attacker could write to `tests/scenarios/scripts/` (e.g., via a malicious PR), they could have scripted arbitrary agent deletion without the sudo gate. The auth failure in v1.2 was actually the security system working correctly. The cleanup "failure" in v1.2 was a surface symptom of a deeper architecture violation that had been latent since the cleanup script was first written.

## 10. References

- [`SawyerHood/dev-browser`](https://github.com/SawyerHood/dev-browser) — the upstream tool
- [`https://dobrowser.io`](https://dobrowser.io) — commercial parent (Do Browser)
- [`design/tasks/TRDD-1222f06a-...rate-limit-retry.md`](./TRDD-1222f06a-602a-4686-a6a7-f2e4428c673e-scenarios-autorunner-rate-limit-retry.md) — the rate-limit retry experiment that this rewrite delivers
- 2026-04-14 overnight batch post-mortem — `docs_dev/2026-04-14-handoff-scenarios-resume.md`
- Current plugin source — `https://github.com/Emasoft/scenarios-autorunner` v0.1.2
- Current CDT MCP plugin — `kriscard/chromedev-tools` v0.1.0 (used as fallback in v1.2)

## 11. Estimated effort

- **Phase 1 (spike):** 2 days — validate QuickJS API coverage + login helper
- **Phase 2 (helpers):** 2 days — write the aim-helpers.js library
- **Phase 3 (daemon wiring):** 1 day — script + hook + preflight
- **Phase 4 (runner rewrite):** 2 days — update agent prompt + test subset
- **Phase 5 (full test):** 1 day — run 22 scenarios unattended
- **Phase 6 (publish):** 0.5 day — `publish.py --minor`, verify CI green, update marketplace
- **Total:** ~8-9 days
