# Pre-Rerun Semantic Audit: AI Maestro Test Scenarios (SCEN-001 to SCEN-024)

**Date:** 2026-04-19  
**Auditor:** Claude Code (READ-ONLY semantic analysis)  
**Scope:** All 24 UI test scenarios in `/Users/emanuelesabetta/ai-maestro/tests/scenarios/`  
**Primary Concern:** Risky or ambiguous phrasings in scenario steps that could cause unintended consequences during autonomous execution (esp. creation of agents outside ~/agents/<name>/, attachment to stale tmux sessions, fixture folder misdirection).

---

## Executive Summary

**AUDIT_DONE findings=3 clean=21/24**

Three scenarios contain semantic risks requiring clarification or additional verification steps. Twenty-one scenarios are clean — steps unambiguously create test agents with explicit `scen<NNN>-` prefixed names via the UI wizard or explicit API calls with protected workdir placement.

---

## Detailed Findings

### SCEN-001: Title Change & Agent Lifecycle — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-001_title-change-lifecycle.scen.md`

**Agent Creation:** S003 "Create a test agent named 'scen-test-title-agent'" explicitly fills the wizard with:
- Name: `scen-test-title-agent`
- Client: `claude`
- Title: `AUTONOMOUS`

**Risk Assessment:** ✅ CLEAN  
Steps unambiguously create agent via wizard with explicit name entry. No ambiguous selections or risky folder browsing. Workdir defaults to `~/agents/scen-test-title-agent/` per standard wizard behavior.

**Cleanup:** S035 deletion via Profile → Advanced → Danger Zone with type-confirmation of agent name. Explicit and safe.

---

### SCEN-002: Teams & Groups Lifecycle — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-002_teams-groups-agents.scen.md`

**Agent Creation:**  
- S008: Create "scen-test-agent-alpha" (claude, MEMBER, team scen-test-team)
- S011: Create "scen-test-agent-beta" (claude, MEMBER, team scen-test-team)

**Risk Assessment:** ✅ CLEAN  
Wizard steps are explicit. Agent names are prefixed with `scen-test-`. No risky folder selections. Team is created with safe name prefix.

---

### SCEN-003: Agent Creation Wizard — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-003_agent-creation-wizard.scen.md`

**Agent Creation:** S013-S018 step through wizard:
- Name: `scen003-wizard-test`
- Client: `claude`
- Team: `scen-test-team` (created in S004)
- Title: auto-resolved to `MEMBER` (requires team)
- Role-plugin: auto-resolved to `ai-maestro-member-agent` per R9.13

**Risk Assessment:** ✅ CLEAN  
Explicit wizard navigation. Role-plugin enforcement is automatic. No user selection ambiguity.

---

### SCEN-004: Haephestos Plugin Creation Helper — ⚠️ RISKY

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-004_haephestos-plugin-creation.scen.md`

**Agent Creation:**  
- S009: "Create an agent named `_aim-creation-helper`"
- S011: "Wake Haephestos" — tmux session name is `_aim-creation-helper`

**Risk Assessment:** ⚠️ RISKY  
**Issue:** The agent name `_aim-creation-helper` uses a non-standard `_aim-` prefix instead of the safe `scen<NNN>-` pattern. Historically, this agent's workdir was created at `~/ai-maestro/agents/` (inside the source tree) rather than `~/.aimaestro/agents/` or the proper `~/agents/` location. The prefix `_aim-` suggests potential collision with internal infrastructure agents.

**Specific Risky Steps:**
- **S009, line ~130:** `"Create an agent named '_aim-creation-helper'"` — Non-standard prefix; workdir placement unclear.
- **S011, line ~160:** `"Wake Haephestos"` creates tmux session `_aim-creation-helper` — Historical concern: session could attach to stale infrastructure session if workdir was not properly isolated.

**Recommendation:** Add explicit verification step after S009 to confirm `~/agents/_aim-creation-helper/` exists and is NOT `~/ai-maestro/agents/_aim-creation-helper/`. Additionally, S031 cleanup should explicitly check `ls -la ~/agents/_aim-creation-helper/` to verify proper location before deletion.

**Mitigating Factor:** S012 and S031 reference cleanup of `~/agents/haephestos/` workspace, suggesting the scenario author is aware of workdir concerns. However, the `_aim-` prefix is still non-standard.

---

### SCEN-005: MANAGER Gate & Team Lifecycle — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-005_manager-gate-team-lifecycle.scen.md`

**Agent Creation:**  
- S007: Create "scen-r12-test-manager" (claude, MANAGER, standalone)
- S008-S011: Create "scen-r12-test-architect", "scen-r12-test-orchestrator", "scen-r12-test-integrator", "scen-r12-test-member" in team

**Risk Assessment:** ✅ CLEAN  
Explicit `scen-r12-test-` prefix. Wizard steps are clear. Team and agent creation follow standard safe flow.

---

### SCEN-006: MANAGER Gate with Codex Client — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-006_manager-gate-codex-client.scen.md`

**Agent Creation:**  
- S011: Create "scen006-manager" (claude, MANAGER)
- S018: Create "scen006-codex-member" (codex, MEMBER, team)

**Risk Assessment:** ✅ CLEAN  
Explicit names, client selection is clear (codex client is named explicitly). No ambiguous steps.

---

### SCEN-007: MANAGER Gate with Mixed Clients — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-007_manager-gate-mixed-clients.scen.md`

**Agent Creation:**  
- S008: Create "scen7-manager" (claude, MANAGER)
- S013: Create "scen7-claude-member" (claude, MEMBER, team)
- S014: Create "scen7-codex-member" (codex, MEMBER, team)

**Risk Assessment:** ✅ CLEAN  
Explicit names and client selection. No folder browsing or risky selections.

---

### SCEN-008: MANAGER Gate with No-Plugin Client (Gemini) — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-008_manager-gate-no-plugin-client.scen.md`

**Agent Creation:**  
- S011: Create "scen8-gemini-agent" (gemini, ORCHESTRATOR, team)
- S015: Change title from ORCHESTRATOR to ORCHESTRATOR (verify idempotent)

**Risk Assessment:** ✅ CLEAN  
Explicit names. Gemini client selection is clear. No ambiguous steps.

---

### SCEN-009: MANAGER-Driven Team Creation — ⚠️ RISKY

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-009_manager-driven-team-creation.scen.md`

**Agent Creation & Task Delegation:**  
- S006: Create "scen9-mgr-test" (claude, MANAGER, standalone)
- S011: **Embed a long task instruction to MANAGER agent:**
  ```
  "Create a team called 'jsonl-viewer-swift' with 5 agents (COS, ARCHITECT, 
  ORCHESTRATOR, INTEGRATOR, MEMBER). Do NOT use the password directly in 
  code or logs; extract it from the environment."
  ```

**Risk Assessment:** ⚠️ RISKY  
**Issue:** The task instruction in S011 is complex and embedded in natural language. The instruction specifies team name and roles but does NOT explicitly state where agents should be created. An autonomous runner executing this step could:
1. Misinterpret the embedded instruction (e.g., delegate to a different agent, create agents in wrong location)
2. The MANAGER agent's autonomous creation logic might not enforce `~/agents/scen9-*` naming if the instruction doesn't explicitly mandate it
3. Password handling ("do NOT use directly") is a guidance note, not a programmatic constraint

**Specific Risky Steps:**
- **S011, line ~155:** Long embedded task instruction lacks explicit workdir guarantee. Text says "Create a team called..." but does not say "Create agents under ~/agents/<name>/".

**Mitigating Factor:** S017 explicitly states "Verify all agents have working directories under ~/agents/" — the scenario author IS aware of the workdir risk and includes a verification step. This is good, but the risk still exists in S011 (the instruction could lead to failure in S017 if MANAGER's autonomous creation doesn't constrain workdir).

**Recommendation:** Clarify S011 task instruction to explicitly state: "Create a team called 'jsonl-viewer-swift' with 5 agents, ensuring all agents are created under ~/agents/ with names prefixed 'scen9-' (e.g., scen9-jsonl-cos, scen9-jsonl-architect, etc.)". This removes ambiguity about agent naming and workdir placement.

---

### SCEN-010: R12 Partial Team Detection — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-010_r12-partial-team-detection.scen.md`

**Agent Creation:**  
- S011: Create "scen-r12-architect" (claude, ARCHITECT, team)
- S012: Create "scen-r12-member" (claude, MEMBER, team)

**Risk Assessment:** ✅ CLEAN  
Explicit names. Steps verify R12 enforcement (incomplete team detection). No risky selections.

---

### SCEN-011: R15 Written Orders Workflow — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-011_r15-written-orders-workflow.scen.md`

**Agent Creation:**  
- S006: Create "scen-r11-mgr" (claude, MANAGER)
- S008-S012: Create team "scen-r11-team" with agents "scen-r11-arch", "scen-r11-orch", "scen-r11-integ", "scen-r11-member"

**Risk Assessment:** ✅ CLEAN  
Explicit names and team. No ambiguous selections. R15 order verification steps are clear.

---

### SCEN-012: R17 Core Plugin Enforcement — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-012_r17-core-plugin-enforcement.scen.md`

**Agent Creation:**  
- S007: Create "scen012-r17-test" (claude, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit name. Core plugin protection verification (UI + API boundary) is systematic. No folder browsing or risky selections.

---

### SCEN-013: R17 Core Plugin with Codex — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-013_r17-core-plugin-codex.scen.md`

**Agent Creation:**  
- S007: Create "scen013-r17-codex-test" (codex, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit name, explicit client (codex). Same core plugin protection verification as SCEN-012, applied to Codex client. No risky steps.

---

### SCEN-014: MANAGER Team with Poem Translation (Mobile Viewport) — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-014_manager-poem-translation-mobile.scen.md`

**Agent Creation:**  
- S010: Create "scen14-manager" (claude, MANAGER)
- S012: Create "scen14-poet" (claude, title POET if available, else MEMBER)
- S013: Create "scen14-translator" (claude, title TRANSLATOR if available, else MEMBER)

**Risk Assessment:** ✅ CLEAN  
Explicit names (scen14- prefix). Mobile viewport emulation (S005) does not affect workdir behavior. No risky folder selections.

---

### SCEN-015: AMP End-to-End Messaging — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-015_amp-end-to-end-messaging.scen.md`

**Agent Creation:**  
- S008: Create "scen015-alice" (claude, AUTONOMOUS)
- S010: Create "scen015-bob" (claude, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit names (scen015- prefix). AMP messaging verification steps are clear. No risky workdir placement or folder selections.

---

### SCEN-016: R18 Client Change Plugin Continuity — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-016_r18-change-client-plugin-continuity.scen.md`

**Agent Creation:**  
- S007: Create "scen016-r18-test" (claude, AUTONOMOUS)
- S016: Change client from Claude to Codex

**Risk Assessment:** ✅ CLEAN  
Explicit name. Client change is explicit step-by-step. Plugin continuity verification is systematic. No risky selections.

---

### SCEN-017: R17 UI Disable Protection — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-017_r17-ui-disable-protection.scen.md`

**Agent Creation:**  
- S008: Create "scen017-ui-test" (claude, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit name. Settings → Plugins Explorer navigation steps are clear. No risky folder selections or ambiguous UI interactions.

---

### SCEN-018: MAINTAINER Title Lifecycle — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-018_maintainer-lifecycle.scen.md`

**Agent Creation:**  
- S008: Create "scen018-manager" (claude, MANAGER)
- S010: Create "scen018-maint-alpha" (claude, MAINTAINER)
- S012: Create "scen018-contrib-alpha" (claude, MEMBER)

**Risk Assessment:** ✅ CLEAN  
Explicit names (scen018- prefix). MAINTAINER title assignment and GitHub repo integration are explicit steps. No risky workdir placement.

---

### SCEN-019: Marketplace & Plugin Lifecycle — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-019_marketplace-and-plugin-lifecycle.scen.md`

**No Agent Creation:** Scenario focuses on Settings → Plugins → Marketplaces navigation and plugin registration/installation (no agent creation).

**Risk Assessment:** ✅ CLEAN  
No agent creation steps. Marketplace and plugin management steps are explicit. No risky folder selections.

---

### SCEN-020: Core Plugins Unchangeable — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-020_core-plugins-unchangeable.scen.md`

**Agent Creation:**  
- S004: Create "scen020-autonomous-test" (claude, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit name. Core plugin protection (UI + title-lock enforcement) verification is systematic. No ambiguous steps or risky selections.

---

### SCEN-021: User-Scope vs Local-Scope Isolation — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-021_user-local-scope-isolation.scen.md`

**Agent Creation:**  
- S003: Create "scen021-alpha" (claude, AUTONOMOUS)
- S004: Create "scen021-beta" (claude, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit names (scen021- prefix). Plugin scope isolation verification steps are clear and systematic. No risky selections or folder browsing.

---

### SCEN-022: MANAGER Autonomous Config Ops (CLI) — ⚠️ RISKY

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-022_manager-autonomous-config-ops.scen.md`

**Agent Creation:**  
- S004-S011: MANAGER creates agent "scen022-autobot" via `aimaestro-agent.sh` CLI script

**Risk Assessment:** ⚠️ RISKY  
**Issue:** The scenario invokes the `aimaestro-agent.sh` CLI script to create an agent programmatically (not via the UI wizard). While the CLI script is assumed to be safe, the scenario does not:
1. Show the exact invocation command (shell expansion, arguments, working directory context)
2. Capture and verify the output to confirm the agent was created at `~/agents/scen022-autobot/` (not some other location)
3. Verify that the CLI script respects workdir placement constraints

**Specific Risky Steps:**
- **S004-S011, lines ~90-155:** Embedded task instruction to MANAGER: "Create an agent named 'scen022-autobot' using aimaestro-agent.sh...". No explicit verification of CLI workdir behavior.
- **S011, line ~155:** "Expected failure: MANAGER cannot delete (Rule 12 sudo blocks agents)" — This verifies a failure case but does NOT verify the success case of creation workdir.

**Mitigating Factor:** The scenario name is "manager-autonomous-config-ops", which suggests the focus is on MANAGER's inability to perform deletion (Rule 12 sudo constraint), not on agent creation verification. However, the creation step (S004-S011) should still verify workdir.

**Recommendation:** Add explicit verification step after S011 success (before testing deletion failure in S011): 
- Confirm `ls -la ~/agents/scen022-autobot/` exists and contains `.claude/settings.local.json`
- Optionally, verify `curl /api/agents/scen022-autobot/info` returns the expected agent metadata

---

### SCEN-023: R17 Exhaustive Surface Audit — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-023_r17-exhaustive-surface-audit.scen.md`

**Agent Creation:**  
- S007: Create "scen023-r17-audit-01" (claude, AUTONOMOUS)

**Risk Assessment:** ✅ CLEAN  
Explicit name (scen023- prefix). Exhaustive core plugin protection testing (S009-S021 attempt removal/disable via every surface: UI buttons, API calls, settings toggles). No risky selections or ambiguous steps. API boundary tests are justified as Rule 6 exceptions with explicit state-verification reads.

---

### SCEN-024: Delete Team & Revert COS to AUTONOMOUS — CLEAN

**File:** `/Users/emanuelesabetta/ai-maestro/tests/scenarios/SCEN-024_delete-team-revert-cos.scen.md`

**Agent Creation:**  
- S008: Create "scen024-mgr-01" (claude, MANAGER)
- S010: Create "scen024-cos-01" (claude, MEMBER, team scen024-team)
- S011: Create "scen024-mbr-01" (claude, MEMBER, team scen024-team)
- S012: Promote "scen024-cos-01" to COS via Profile → Title assignment

**Risk Assessment:** ✅ CLEAN  
Explicit names (scen024- prefix). Team and agent creation via wizard is standard. Title assignment and deletion verification steps are clear. No risky selections or ambiguous workdir placement.

---

## Summary Table

| Scenario | Finding | Issue | Recommendation |
|----------|---------|-------|-----------------|
| SCEN-001 | ✅ CLEAN | None | No action |
| SCEN-002 | ✅ CLEAN | None | No action |
| SCEN-003 | ✅ CLEAN | None | No action |
| SCEN-004 | ⚠️ RISKY | Agent name `_aim-creation-helper` (non-standard prefix); historical workdir at ~/ai-maestro | Add explicit verification: `ls -la ~/agents/_aim-creation-helper/` after S009; verify NOT ~/ai-maestro/agents/ |
| SCEN-005 | ✅ CLEAN | None | No action |
| SCEN-006 | ✅ CLEAN | None | No action |
| SCEN-007 | ✅ CLEAN | None | No action |
| SCEN-008 | ✅ CLEAN | None | No action |
| SCEN-009 | ⚠️ RISKY | Long embedded task instruction (S011) lacks explicit workdir guarantee | Clarify S011 task: "Create agents under ~/agents/ with names prefixed 'scen9-'" |
| SCEN-010 | ✅ CLEAN | None | No action |
| SCEN-011 | ✅ CLEAN | None | No action |
| SCEN-012 | ✅ CLEAN | None | No action |
| SCEN-013 | ✅ CLEAN | None | No action |
| SCEN-014 | ✅ CLEAN | None | No action |
| SCEN-015 | ✅ CLEAN | None | No action |
| SCEN-016 | ✅ CLEAN | None | No action |
| SCEN-017 | ✅ CLEAN | None | No action |
| SCEN-018 | ✅ CLEAN | None | No action |
| SCEN-019 | ✅ CLEAN | None | No action |
| SCEN-020 | ✅ CLEAN | None | No action |
| SCEN-021 | ✅ CLEAN | None | No action |
| SCEN-022 | ⚠️ RISKY | CLI agent creation (S004-S011) lacks workdir verification | Add step after S011: Confirm `~/agents/scen022-autobot/` exists with proper structure |
| SCEN-023 | ✅ CLEAN | None | No action |
| SCEN-024 | ✅ CLEAN | None | No action |

---

## Risk Categories

### Category A: Non-Standard Agent Name Prefix (SCEN-004)
Agent `_aim-creation-helper` uses underscore prefix instead of safe `scen<NNN>-` pattern. Historical concern: workdir placement inside source tree. **Mitigation:** Add workdir verification step.

### Category B: Ambiguous Embedded Task Instruction (SCEN-009)
Long task instruction to MANAGER lacks explicit workdir constraint. **Mitigation:** Clarify instruction with explicit workdir naming scheme.

### Category C: CLI Invocation Workdir Unverified (SCEN-022)
Agent creation via `aimaestro-agent.sh` CLI script lacks explicit workdir verification. **Mitigation:** Add post-creation verification step.

---

## Conclusion

The audit identified **3 scenarios with semantic risks** (Categories A, B, C) out of 24. All risks are **mitigatable** with additional verification steps or instruction clarification — no scenarios were found to explicitly create agents outside `~/agents/` or attach to forbidden directories. The scenario suite is **safe to re-run** with the recommended clarifications applied to SCEN-004, SCEN-009, and SCEN-022.

**Confidence Level:** HIGH  
The risk assessment is based on careful semantic analysis of each scenario's step instructions, agent naming patterns, and workdir placement assumptions. No code execution or dynamic testing was performed (READ-ONLY audit). The findings should be validated by testing the three risky scenarios in isolation with workdir verification steps before full re-run.
