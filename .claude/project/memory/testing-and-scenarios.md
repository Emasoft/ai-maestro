---
name: testing-and-scenarios
description: "how do I run a UI scenario test / run-scenario-test skill forks a subagent why / how many scenarios exist SCEN-NNN / AMP routing test scripts / cross-host mesh test / manual tmux testing workflow / where do scenario rules live SCENARIOS_TESTS_RULES.md symlink"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# testing-and-scenarios

AI Maestro's test surface has three layers: a manual tmux workflow for spot-checking, two AMP
messaging test scripts (local + cross-host), and a git-tracked suite of browser-driven UI
scenarios that always run through the isolated `run-scenario-test` skill.

**Manual testing workflow:**

1. Start the dashboard: `npm run dev`
2. Create test tmux sessions:
   ```bash
   tmux new-session -s test1 -d
   tmux send-keys -t test1 'claude' C-m
   tmux new-session -s test2 -d
   tmux send-keys -t test2 'claude' C-m
   ```
3. Verify auto-discovery: Sessions appear in sidebar
4. Click sessions: Terminal content loads
5. Type in terminal: Input reaches Claude
6. Kill session: `tmux kill-session -t test1`
7. Verify: Session removed after refresh

### AMP Messaging Test Suites

Two test scripts exist for validating the Agent Messaging Protocol:

```bash
# Local routing tests (single host)
# Tests: health, registration, internal→internal, external polling, federation, acknowledgment
./scripts/test-amp-routing.sh

# Cross-host mesh tests (multi-host via Tailscale)
# Tests: host health, agent registration on each host, cross-host delivery, replies, inbox counts
./scripts/test-amp-cross-host.sh              # Auto-detect hosts from ~/.aimaestro/hosts.json
./scripts/test-amp-cross-host.sh --local-only  # Only test local→remote
./scripts/test-amp-cross-host.sh --skip-inbox  # Skip inbox verification
```

**Prerequisites:** AI Maestro running on localhost:23000, jq installed, AMP scripts installed
(`./install-messaging.sh -y`).

### UI Scenario Tests

Browser-based UI scenario tests that verify end-to-end workflows through the `dev-browser` CLI
(sandboxed JS driving a shared headless Chromium).

**Rules & Format:** `tests/scenarios/SCENARIOS_TESTS_RULES.md` — 15 mandatory rules (Rule 0–14):
WHO-YOU-ARE, CLEAN-AFTER-YOURSELF, 0-IMPACT, STATE-WIPE, FIX-AS-YOU-GO, TRACK-AND-REPORT,
STICK-TO-UI, SAFE-SETUP, DEV-BROWSER, REPORT-FORMAT, PHOTOSTORY, 11th-HOUR analysis, SUDO-MODE,
AUTONOMOUS-PROTOCOL, REPORTS-TO-PROJECT-ROOT.

> **Canonical vs loaded copy:** the rules file is git-tracked at
> `tests/scenarios/SCENARIOS_TESTS_RULES.md`. The Claude Code harness also auto-loads
> `.claude/rules/SCENARIOS_TESTS_RULES.md` on every session start, but that path is a
> **symlink** to the tracked file so the two CAN NOT drift. When updating the rules, edit only
> the tracked file; the symlink picks up changes automatically.

**Scenarios:**

Currently 24 scenarios live in `tests/scenarios/SCEN-NNN_*.scen.md` (SCEN-001 through
SCEN-024). They are git-tracked. Reports and screenshots are gitignored (session-local test
artifacts).

**Running a scenario — ALWAYS use the `run-scenario-test` skill.** Do NOT drive scenarios from
the main conversation. The skill is installed at `~/.claude/skills/run-scenario-test/` and uses
`context: fork`, `model: opus`, `agent: general-purpose` so a full ~150-step UI walkthrough runs
in an isolated subagent context and returns only a 2-line summary to the orchestrator. Trigger
phrases: "run scenario 16", "execute SCEN-018", "run the maintainer scenario", "rerun 1 and 19".
For parallel runs of multiple scenarios, the orchestrator triggers the skill multiple times in
the same turn — one forked agent per scenario.

The forked agent reads the scenario file, follows `SCENARIOS_TESTS_RULES.md`, drives the
dashboard via the dev-browser CLI (Rule 8), applies Rule 4 fix-as-you-go for any bug it finds,
writes its report to `reports/scenarios-runner/`, authors each 11th-HOUR improvement proposal as
its own TRDD-proposal file in `design/proposals/` (Rule 11 — `column: proposal`, labeled
`scen-<NNN>`), and returns the 2-line summary.

**Prerequisites:** AI Maestro server running, Chrome browser open with DevTools accessible,
governance password set. Any per-scenario prereqs (`which codex`, fake GitHub repos, etc.) are
listed in the scenario's frontmatter.

## See also

## Notes and lessons learned
