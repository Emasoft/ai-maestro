# Governance Enforcement Map

**What this is.** A machine-checked index that pins, for every governance
sub-rule in [`docs/GOVERNANCE-RULES.md`](./GOVERNANCE-RULES.md), *what code
enforces it* and *what test proves it*. It is generated from the nine
governance-audit reports under `reports/governance-audit/` (a faithful
transcription of their per-sub-rule verdicts, not a re-audit) and is the
**source of truth** for the `tests/governance/enforcement-coverage.test.ts`
ratchet.

**How to read the Verdict column** (closed set):

| Verdict | Meaning |
|---|---|
| `ENFORCED` | The audit report concluded the rule is enforced **and** a real code guard `file:line` (verified to exist on disk) refuses the violation. The Test column names a drift-failing test when one exists, else `—` (enforced-but-untested — a guard with no test to hold it). |
| `UNENFORCED` | No guard refuses the violation — none exists, or the guard is partial/advisory with no refusal, or the rule's key clause has a proven hole (Guard = `—`). |
| `INVENTED` | The code enforces a policy the rule never states. |
| `CONTRADICTED` | The code contradicts the rule, or two rules contradict each other. |
| `RULING-NEEDED` | The rule and the shipped architecture cannot both stand; a USER must decide which wins. |
| `BEHAVIOURAL` | The rule binds an agent's conduct, not server code, so no code guard can enforce it (authorship, proactive memory, written-order intent, self-refusal). |

**Enforced-but-untested.** An `ENFORCED` row with Test = `—` has a real guard that
nothing pins against regression. These are the priority backlog for governance test
coverage, and their count is the ratchet `MAX_ENFORCED_WITHOUT_TEST` in
`tests/governance/enforcement-coverage.test.ts` — a number that may only fall.

**Read the count there, not here.** This paragraph used to carry its own tally
("only 5 rules have both a guard and a test"); four pinning batches later the real
figure was 75 and nobody noticed, because prose is not checked and the constant is.
Any standalone number written here would rot the same way, so this document
deliberately states none.

Row format is fixed so a regex parses each line:
`| Sub-rule | Verdict | Guard (file:line or —) | Test (path or —) |`

| Sub-rule | Verdict | Guard (file:line or —) | Test (path or —) |
|---|---|---|---|
| R1.1 | ENFORCED | lib/team-acl.ts:102 | — |
| R1.2 | ENFORCED | lib/group-registry.ts | — |
| R1.3 | ENFORCED | services/teams-service.ts:342-405 | tests/governance/r1-teams-service.test.ts |
| R1.4 | ENFORCED | services/teams-service.ts:279-283 | tests/governance/r1-teams-service.test.ts |
| R1.5 | ENFORCED | lib/team-registry.ts:427 | tests/governance/r1-r2-team-registry.test.ts |
| R1.6 | INVENTED | — | — |
| R2.1 | ENFORCED | lib/team-registry.ts:106-110 | tests/governance/r1-r2-team-registry.test.ts |
| R2.2 | ENFORCED | lib/team-registry.ts:107, components/teams/TeamCreationWizard.tsx:201 | — |
| R2.3 | ENFORCED | lib/team-registry.ts:107 | tests/governance/r1-r2-team-registry.test.ts |
| R3.1 | CONTRADICTED | — | — |
| R3.2 | ENFORCED | services/element-management-service.ts (ChangeTitle::G07) | tests/governance/r3-r9-team-governance.test.ts |
| R3.3 | ENFORCED | services/element-management-service.ts (ChangeTitle::G08) | tests/governance/r3-r9-team-governance.test.ts |
| R3.4 | ENFORCED | lib/team-registry.ts:131-138 | tests/governance/r3-r9-team-governance.test.ts |
| R3.5 | ENFORCED | services/governance-service.ts:66-83 | tests/governance/r3-r9-team-governance.test.ts |
| R3.6 | ENFORCED | lib/authorization.ts:321-326 | tests/unit/headless-router-auth-mirror.test.ts |
| R3.7 | ENFORCED | lib/communication-graph.ts:98, lib/communication-graph.ts:97 | tests/governance/r3-r9-team-governance.test.ts |
| R3.8 | CONTRADICTED | — | — |
| R3.9 | ENFORCED | lib/authorization.ts:285, lib/authorization.ts:527 | tests/governance/r3-r9-team-governance.test.ts |
| R3.10 | UNENFORCED | — | — |
| R3.11 | CONTRADICTED | — | — |
| R3.12 | ENFORCED | app/api/teams/[id]/route.ts:115, services/teams-service.ts:577 | tests/governance/r3-r9-team-governance.test.ts |
| R4.1 | ENFORCED | lib/team-registry.ts:158-176, services/element-management-service.ts:5110 | tests/governance/r4-team-composition.test.ts |
| R4.2 | ENFORCED | lib/group-registry.ts | tests/governance/r4-team-composition.test.ts |
| R4.3 | CONTRADICTED | — | — |
| R4.4 | ENFORCED | services/element-management-service.ts (ChangeTeam::G07) | tests/governance/r3-r9-team-governance.test.ts |
| R4.5 | UNENFORCED | — | — |
| R4.6 | ENFORCED | lib/team-registry.ts:142-145 | tests/governance/r4-team-composition.test.ts |
| R4.7 | ENFORCED | lib/team-registry.ts:148-154, services/element-management-service.ts:5056 | tests/governance/r4-team-composition.test.ts |
| R4.8 | ENFORCED | components/teams/TeamOverviewSection.tsx:33-34 | — |
| R4.9 | UNENFORCED | — | — |
| R5.1 | UNENFORCED | — | — |
| R5.2 | ENFORCED | app/api/governance/transfers/route.ts:97-99 | tests/governance/r5-transfer-governance.test.ts |
| R5.3 | ENFORCED | app/api/governance/transfers/[id]/resolve/route.ts:85-90 | tests/governance/r5-transfer-governance.test.ts |
| R5.4 | ENFORCED | app/api/governance/transfers/route.ts:149-151 | tests/governance/r5-transfer-governance.test.ts |
| R5.5 | ENFORCED | app/api/governance/transfers/route.ts:143-146, app/api/governance/transfers/[id]/resolve/route.ts:99-101 | tests/governance/r5-transfer-governance.test.ts |
| R5.6 | ENFORCED | app/api/governance/transfers/route.ts:124-126 | tests/governance/r5-transfer-governance.test.ts |
| R5.7 | ENFORCED | app/api/governance/transfers/[id]/resolve/route.ts:103-127 | tests/governance/r5-transfer-governance.test.ts |
| R5.8 | ENFORCED | app/api/governance/transfers/route.ts:160-164 | tests/governance/r5-transfer-governance.test.ts |
| R6.1 | ENFORCED | lib/communication-graph.ts:94-144 | tests/governance/r6-communication-graph.test.ts |
| R6.2 | ENFORCED | lib/communication-graph.ts:97 | tests/governance/r6-communication-graph.test.ts |
| R6.3 | ENFORCED | lib/communication-graph.ts:98 | tests/governance/r6-communication-graph.test.ts |
| R6.4 | ENFORCED | lib/communication-graph.ts:99 | tests/governance/r6-communication-graph.test.ts |
| R6.5 | ENFORCED | lib/communication-graph.ts:100-102 | tests/governance/r6-communication-graph.test.ts |
| R6.5a | ENFORCED | lib/communication-graph.ts:103 | tests/governance/r6-communication-graph.test.ts |
| R6.5b | ENFORCED | lib/communication-graph.ts:104 | tests/governance/r6-communication-graph.test.ts |
| R6.6 | ENFORCED | lib/communication-graph.ts:112, lib/communication-graph.ts:396-408 | tests/governance/r6-communication-graph.test.ts |
| R6.7 | ENFORCED | services/amp-service.ts:1294-1300 | tests/governance/r6-communication-graph.test.ts |
| R6.8 | ENFORCED | services/amp-service.ts:1286, services/amp-service.ts:1112-1124 | tests/governance/r6-communication-graph.test.ts |
| R6.9 | ENFORCED | lib/communication-graph.ts:322-327, services/amp-service.ts:797-802 | tests/governance/r6-communication-graph.test.ts |
| R6.10 | ENFORCED | lib/communication-graph.ts:442-491 | tests/governance/r6-communication-graph.test.ts |
| R6.11 | UNENFORCED | — | — |
| R6.12 | UNENFORCED | — | — |
| R6.13 | ENFORCED | lib/agent-registry.ts:312-332 | tests/governance/r6-communication-graph.test.ts |
| R6.14 | UNENFORCED | — | — |
| R7.1 | ENFORCED | components/sidebar/TeamListView.tsx:661, components/governance/PasswordDialog.tsx:334 | — |
| R7.2 | ENFORCED | hooks/useGovernance.ts:48 | tests/governance/r7-governance-loading-state.test.ts |
| R7.3 | ENFORCED | components/sidebar/TeamListView.tsx:636 | — |
| R7.4 | UNENFORCED | — | — |
| R7.5 | UNENFORCED | — | — |
| R7.6 | CONTRADICTED | — | — |
| R7.7 | ENFORCED | components/sidebar/TeamCard.tsx:71, lib/team-registry.ts:427 | tests/governance/r7-team-blocked-badge.test.tsx |
| R7.8 | ENFORCED | components/teams/TeamOverviewSection.tsx:37-42, components/governance/TitleAssignmentDialog.impl.tsx:274 | — |
| R7.9 | ENFORCED | hooks/useGovernance.ts:48 | tests/governance/r7-governance-loading-state.test.ts |
| R8.1 | ENFORCED | lib/team-registry.ts | tests/governance/r2-r8-team-registry-invariants.test.ts |
| R8.2 | ENFORCED | app/api/teams/[id]/route.ts:115, services/headless-router.ts:2936 | tests/unit/headless-router-auth-mirror.test.ts |
| R8.3 | ENFORCED | services/element-management-service.ts (DeleteTeam::G05) | tests/governance/r3-r9-team-governance.test.ts |
| R8.4 | ENFORCED | lib/authorization.ts:580-592 | tests/governance/r8-r10-r26-authorization-team-scope.test.ts |
| R9.1 | ENFORCED | services/teams-service.ts:279-282 | tests/governance/r3-r9-team-governance.test.ts |
| R9.2 | ENFORCED | services/element-management-service.ts (ChangeTitle::G10) | tests/governance/r3-r9-team-governance.test.ts |
| R9.3 | CONTRADICTED | — | — |
| R9.4 | ENFORCED | lib/team-registry.ts:472-501 | tests/governance/r3-r9-team-governance.test.ts |
| R9.5 | ENFORCED | services/agents-core-service.ts:2045-2054 | tests/governance/r3-r9-team-governance.test.ts |
| R9.6 | ENFORCED | services/element-management-service.ts (ChangeTitle::G13) | tests/governance/r3-r9-team-governance.test.ts |
| R9.7 | ENFORCED | lib/team-registry.ts:518-534 | tests/governance/r3-r9-team-governance.test.ts |
| R9.8 | ENFORCED | services/element-management-service.ts (DeleteAgent::G02) | tests/governance/r3-r9-team-governance.test.ts |
| R9.9 | ENFORCED | lib/startup-manager-gate.mjs:25-36, server.mjs:1749-1757 | tests/unit/startup-guards.test.ts |
| R9.10 | UNENFORCED | — | — |
| R9.11 | ENFORCED | services/teams-service.ts:285-291 | tests/governance/r3-r9-team-governance.test.ts |
| R9.12 | ENFORCED | services/agents-core-service.ts:417, app/api/agents/route.ts | tests/governance/r3-r9-team-governance.test.ts |
| R9.13 | ENFORCED | services/element-management-service.ts (ChangeTitle::G17) | tests/governance/r3-r9-team-governance.test.ts |
| R10.1 | ENFORCED | services/agents-core-service.ts:2029-2043 | tests/governance/r10-wake-gates.test.ts |
| R10.2 | CONTRADICTED | — | — |
| R10.3 | ENFORCED | lib/authorization.ts:530-541 | tests/governance/r8-r10-r26-authorization-team-scope.test.ts |
| R10.4 | CONTRADICTED | — | — |
| R10.5 | ENFORCED | services/agents-core-service.ts:2045-2054 | tests/governance/r10-wake-gates.test.ts |
| R10.6 | ENFORCED | app/api/sessions/[id]/restart/route.ts:73-82, services/headless-router.ts:1028-1036, services/headless-router.ts:956-959 | — |
| R10.7 | UNENFORCED | — | — |
| R11.1 | CONTRADICTED | — | — |
| R11.2 | ENFORCED | lib/ecosystem-constants.ts:330 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R11.3 | ENFORCED | lib/ecosystem-constants.ts:332 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R11.4 | ENFORCED | services/element-management-service.ts (ChangeTeam::G07) | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R11.5 | ENFORCED | services/element-management-service.ts (ChangeTeam::G04d) | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R11.6 | ENFORCED | components/agent-profile/RoleTab.tsx:63-74 | tests/governance/r11-role-plugin-n-to-1.test.tsx |
| R11.7 | CONTRADICTED | — | — |
| R11.8 | CONTRADICTED | — | — |
| R11.9 | CONTRADICTED | — | — |
| R11.10 | CONTRADICTED | — | — |
| R11.11 | ENFORCED | services/plugin-storage-service.ts:210-222 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R11.12 | CONTRADICTED | — | — |
| R12.1 | UNENFORCED | — | — |
| R12.2 | CONTRADICTED | — | — |
| R12.3 | ENFORCED | services/element-management-service.ts (ChangeTitle::G14d), services/element-management-service.ts (ChangeTitle::G15) | tests/governance/r19-maintainer-title.test.ts |
| R12.4 | INVENTED | — | — |
| R12.5 | CONTRADICTED | — | — |
| R12.6 | UNENFORCED | — | — |
| R13.1 | UNENFORCED | — | — |
| R13.2 | UNENFORCED | — | — |
| R13.3 | UNENFORCED | — | — |
| R13.4 | UNENFORCED | — | — |
| R13.5 | UNENFORCED | — | — |
| R13.6 | UNENFORCED | — | — |
| R13.7 | UNENFORCED | — | — |
| R13.8 | BEHAVIOURAL | — | — |
| R13.9 | UNENFORCED | — | — |
| R14.1 | CONTRADICTED | — | — |
| R14.2 | UNENFORCED | — | — |
| R14.3 | UNENFORCED | — | — |
| R14.4 | UNENFORCED | — | — |
| R14.5 | UNENFORCED | — | — |
| R14.6 | UNENFORCED | — | — |
| R15.1 | BEHAVIOURAL | — | — |
| R15.2 | BEHAVIOURAL | — | — |
| R15.3 | CONTRADICTED | — | — |
| R15.4 | CONTRADICTED | — | — |
| R15.5 | BEHAVIOURAL | — | — |
| R15.6 | BEHAVIOURAL | — | — |
| R15.7 | UNENFORCED | — | — |
| R16.1 | CONTRADICTED | — | — |
| R16.2 | UNENFORCED | — | — |
| R16.3 | UNENFORCED | — | — |
| R16.4 | UNENFORCED | — | — |
| R16.5 | CONTRADICTED | — | — |
| R16.6 | BEHAVIOURAL | — | — |
| R16.7 | CONTRADICTED | — | — |
| R17.1 | ENFORCED | lib/agent-invariants.ts:111-146, services/element-management-service.ts:8220-8252 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.2 | ENFORCED | services/element-management-service.ts (InstallElement::EXE) | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.3 | UNENFORCED | — | — |
| R17.4 | UNENFORCED | — | — |
| R17.5 | ENFORCED | services/agents-core-service.ts:2121-2137 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.6 | ENFORCED | services/element-management-service.ts (CreateAgent::G11) | tests/integration/createagent-g11-r17-core.test.ts |
| R17.7 | UNENFORCED | — | — |
| R17.8 | ENFORCED | services/element-management-service.ts (InstallElement::G08) | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.9 | ENFORCED | services/element-management-service.ts (InstallElement::PG01) | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.10 | UNENFORCED | — | — |
| R17.11 | CONTRADICTED | — | — |
| R17.12 | UNENFORCED | — | — |
| R17.13 | ENFORCED | services/plugin-storage-service.ts:182-266 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.14 | UNENFORCED | — | — |
| R17.15 | ENFORCED | services/element-management-service.ts (InstallElement::G08), services/element-management-service.ts (ChangePlugin::G01b) | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.16 | ENFORCED | components/agent-profile/PluginsTab.tsx:244-245 | tests/governance/r17-core-plugin-no-uninstall.test.tsx |
| R17.17 | ENFORCED | lib/startup-user-scope-guard.mjs:28-65, server.mjs:1771-1774 | tests/unit/startup-guards.test.ts |
| R17.18 | RULING-NEEDED | — | — |
| R17.18a | ENFORCED | services/agents-core-service.ts | — |
| R17.19 | ENFORCED | scripts/bump-version.sh:225-228 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.20 | ENFORCED | lib/startup-marketplaces.mjs:29-78, server.mjs:1794-1797 | tests/unit/startup-guards.test.ts |
| R17.21 | ENFORCED | services/agents-core-service.ts:2121-2137 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.22 | ENFORCED | services/agents-core-service.ts:1833-1866 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R17.23 | ENFORCED | services/agents-core-service.ts:2300-2303 | tests/governance/r17-r11-core-plugin-binding.test.ts |
| R18.1 | ENFORCED | services/element-management-service.ts (ChangeClient::G06) | tests/governance/r18-client-change-continuity.test.ts |
| R18.2 | ENFORCED | services/element-management-service.ts (ChangeClient::G05) | tests/governance/r18-client-change-continuity.test.ts |
| R18.3 | ENFORCED | services/element-management-service.ts (ChangeClient::G06) | tests/governance/r18-client-change-continuity.test.ts |
| R18.3b | CONTRADICTED | — | — |
| R18.3c | UNENFORCED | — | — |
| R18.3d | UNENFORCED | — | — |
| R18.4 | ENFORCED | services/element-management-service.ts (ChangeClient::G07), services/element-management-service.ts (ChangeClient::G08), services/element-management-service.ts (ChangeClient::G09) | tests/governance/r18-client-change-continuity.test.ts |
| R18.5 | ENFORCED | services/element-management-service.ts (ChangeClient::G05b) | tests/governance/r18-client-change-continuity.test.ts |
| R18.6 | CONTRADICTED | — | — |
| R18.7 | ENFORCED | services/element-management-service.ts (ChangeClient::G10) | tests/governance/r18-client-change-continuity.test.ts |
| R18.8 | ENFORCED | lib/converter/utils/warnings.ts:14-22, lib/converter/emitters/codex.ts:47-52, lib/converter/emitters/codex.ts:245-253 | tests/governance/r18-conversion-loss-report.test.ts |
| R18.9 | ENFORCED | services/element-management-service.ts:5517-5908 | tests/governance/r18-client-change-continuity.test.ts |
| R18.10 | ENFORCED | services/element-management-service.ts (ChangeClient::G09) | tests/governance/r18-client-change-continuity.test.ts |
| R19.1 | ENFORCED | services/element-management-service.ts (ChangeTitle::EXE) | tests/governance/r19-maintainer-title.test.ts |
| R19.2 | ENFORCED | services/element-management-service.ts:2328-2335, services/element-management-service.ts:2560-2575, services/element-management-service.ts:2711-2724, services/agents-core-service.ts:825-827 | tests/governance/r19-maintainer-title.test.ts |
| R19.3 | ENFORCED | services/element-management-service.ts:2336-2360, services/element-management-service.ts:2560-2575, services/element-management-service.ts:2711-2724 | tests/governance/r19-maintainer-title.test.ts |
| R19.4 | UNENFORCED | — | — |
| R19.5 | UNENFORCED | — | — |
| R19.6 | UNENFORCED | — | — |
| R19.7 | UNENFORCED | — | — |
| R19.8 | UNENFORCED | — | — |
| R19.9 | CONTRADICTED | — | — |
| R19.10 | ENFORCED | services/element-management-service.ts (ChangeTitle::G15), services/element-management-service.ts (ChangeTitle::G16) | tests/governance/r19-maintainer-title.test.ts |
| R19.11 | UNENFORCED | — | — |
| R20.1 | ENFORCED | lib/ecosystem-constants.ts:70-90 | tests/governance/r20-marketplace-governance.test.ts |
| R20.2 | ENFORCED | lib/agent-invariants.ts:110-150 | tests/governance/r20-marketplace-governance.test.ts |
| R20.3 | RULING-NEEDED | — | — |
| R20.4 | ENFORCED | lib/ecosystem-constants.ts:334-344 | tests/governance/r20-marketplace-governance.test.ts |
| R20.5 | ENFORCED | services/element-management-service.ts (ChangeTitle::G15), services/element-management-service.ts (ChangeTitle::G16) | tests/governance/r19-maintainer-title.test.ts |
| R20.6 | ENFORCED | services/element-management-service.ts:1791-1806, services/element-management-service.ts:7531-7570 | tests/governance/r20-marketplace-governance.test.ts |
| R20.7 | UNENFORCED | — | — |
| R20.8 | ENFORCED | services/plugin-storage-service.ts:166-170 | tests/governance/r20-marketplace-governance.test.ts |
| R20.9 | ENFORCED | services/plugin-storage-service.ts:166-170 | tests/governance/r20-marketplace-governance.test.ts |
| R20.10 | UNENFORCED | — | — |
| R20.11 | UNENFORCED | — | — |
| R20.12 | UNENFORCED | — | — |
| R20.13 | ENFORCED | services/element-management-service.ts (CreateAgent::G01b) | tests/governance/r20-marketplace-governance.test.ts |
| R20.14 | ENFORCED | lib/agent-directory.ts:338-341, lib/agent-directory.ts:206-211 | tests/governance/r20-marketplace-governance.test.ts |
| R20.15 | ENFORCED | lib/agent-auth.ts:110-116 | tests/governance/r20-marketplace-governance.test.ts |
| R20.16 | ENFORCED | lib/agent-auth.ts:125 | tests/governance/r20-marketplace-governance.test.ts |
| R20.17 | UNENFORCED | — | — |
| R20.18 | ENFORCED | lib/converter/marketplace-emitters.ts:101-144, lib/converter/marketplace-emitters.ts:180-245 | tests/governance/r20-marketplace-governance.test.ts |
| R20.19 | ENFORCED | lib/agent-invariants.ts:111-121 | tests/governance/r20-marketplace-governance.test.ts |
| R20.20 | ENFORCED | services/agent-local-config-service.ts:415 | tests/governance/r20-marketplace-governance.test.ts |
| R20.21 | CONTRADICTED | — | — |
| R20.22 | ENFORCED | services/plugin-storage-service.ts:166-170 | tests/governance/r20-marketplace-governance.test.ts |
| R20.23 | ENFORCED | services/plugin-storage-service.ts:185-224 | tests/governance/r20-marketplace-governance.test.ts |
| R20.24 | ENFORCED | services/plugin-storage-service.ts:207 | tests/governance/r20-marketplace-governance.test.ts |
| R20.25 | ENFORCED | services/plugin-storage-service.ts:227-230 | tests/governance/r20-marketplace-governance.test.ts |
| R20.26 | ENFORCED | services/plugin-storage-service.ts:199-203 | tests/governance/r20-marketplace-governance.test.ts |
| R20.27 | UNENFORCED | — | — |
| R20.28 | ENFORCED | install-messaging.sh:936-1110 | — |
| R20.29 | ENFORCED | services/element-management-service.ts:1712-1716 | tests/governance/r20-marketplace-governance.test.ts |
| R20.30 | ENFORCED | components/agent-profile/PluginsTab.tsx:116-153 | tests/governance/r20-marketplace-governance.test.ts |
| R20.31 | ENFORCED | services/element-management-service.ts:1834-1910 | tests/governance/r20-marketplace-governance.test.ts |
| R22.1 | BEHAVIOURAL | — | — |
| R22.2 | BEHAVIOURAL | — | — |
| R22.3 | BEHAVIOURAL | — | — |
| R22.4 | UNENFORCED | — | — |
| R22.5 | UNENFORCED | — | — |
| R23.1 | UNENFORCED | — | — |
| R23.2 | UNENFORCED | — | — |
| R23.3 | UNENFORCED | — | — |
| R23.4 | UNENFORCED | — | — |
| R23.5 | UNENFORCED | — | — |
| R23.6 | UNENFORCED | — | — |
| R23.7 | UNENFORCED | — | — |
| R23.8 | UNENFORCED | — | — |
| R24.1 | BEHAVIOURAL | — | — |
| R24.2 | BEHAVIOURAL | — | — |
| R24.3 | BEHAVIOURAL | — | — |
| R24.4 | CONTRADICTED | — | — |
| R24.5 | UNENFORCED | — | — |
| R24.6 | UNENFORCED | — | — |
| R25.1 | CONTRADICTED | — | — |
| R25.2 | ENFORCED | lib/trdd-doctor.ts:48 | tests/unit/trdd-doctor.test.ts |
| R26.1 | UNENFORCED | — | — |
| R26.2 | UNENFORCED | — | — |
| R26.3 | ENFORCED | lib/authorization.ts:290-300 | tests/governance/r8-r10-r26-authorization-team-scope.test.ts |
| R27.1 | CONTRADICTED | — | — |
| R27.2 | UNENFORCED | — | — |
| R27.3 | UNENFORCED | — | — |
| R28.1 | ENFORCED | lib/sudo-guard.ts:79-82 | tests/unit/sudo-guard-strict-agent-coverage.test.ts |
| R28.2 | UNENFORCED | — | — |
| R28.3 | UNENFORCED | — | — |
| R29.1 | CONTRADICTED | — | — |
| R29.2 | UNENFORCED | — | — |
| R29.3 | UNENFORCED | — | — |
| R30.1 | UNENFORCED | — | — |
| R30.2 | UNENFORCED | — | — |
| R30.3 | CONTRADICTED | — | — |
| R31.1 | UNENFORCED | — | — |
| R31.2 | UNENFORCED | — | — |
| R32.1 | ENFORCED | lib/sudo-guard.ts:86-88 | tests/governance/r32-agents-never-sudo.test.ts |
| R32.2 | ENFORCED | app/api/auth/sudo-password/route.ts:98-108, lib/sudo-guard.ts:86-88 | tests/governance/r32-agents-never-sudo.test.ts |
| R32.3 | UNENFORCED | — | — |
| R33.1 | ENFORCED | lib/portfolio-ledger.ts:148-211 | tests/unit/portfolio-ledger.test.ts |
| R34.1 | UNENFORCED | — | — |
| R34.2 | ENFORCED | app/api/agents/foreign-approvals/[id]/approve/route.ts:46-49 | tests/governance/r34-r35-foreign-approval.test.ts |
| R35.1 | UNENFORCED | — | — |
| R35.2 | ENFORCED | app/api/agents/foreign-approvals/[id]/approve/route.ts:46-49 | tests/governance/r34-r35-foreign-approval.test.ts |
| R36.1 | UNENFORCED | — | — |
| R36.2 | UNENFORCED | — | — |
| R37.1 | BEHAVIOURAL | — | — |
| R37.2 | ENFORCED | app/api/governance/maestro-delegate/route.ts:99-102, lib/user-registry.ts:212-218 | tests/governance/r37-maestro-delegate.test.ts |
| R37.3 | ENFORCED | app/api/governance/maestro-delegate/route.ts:129-167 | tests/governance/r37-maestro-delegate.test.ts |
| R37.4 | ENFORCED | app/api/governance/maestro-delegate/route.ts:75-80, app/api/governance/maestro-delegate/route.ts:139-144 | tests/governance/r37-maestro-delegate.test.ts |
| R38.1 | UNENFORCED | — | — |
| R38.2 | UNENFORCED | — | — |
| R38.3 | UNENFORCED | — | — |
| R39.1 | UNENFORCED | — | — |
| R39.2 | UNENFORCED | — | — |
| R39.3 | UNENFORCED | — | — |
| R39.4 | UNENFORCED | — | — |
| R39.5 | CONTRADICTED | lib/communication-graph.ts:361-373 — the branch grants `recipientIsOwnUser \|\| recipientIsActiveMaestro`, i.e. the pre-2026-07-22 shape; the CURRENT text grants own user + **the MANAGER** and says outright it obeys "not the MAESTRO *user*". Also UNREACHABLE — nothing in production builds an `assistantSender` block, so the branch always falls through to deny. Downgraded from ENFORCED by the TRDD-SPS63XHA ruling: a citation naming real, working code that enforces a SUPERSEDED rule is invisible to every instrument we have. | tests/unit/communication-graph-user-routing.test.ts (pins the drift + the no-producer fact) |
| R39.6 | ENFORCED | services/element-management-service.ts (DeleteAgent::G01b) | tests/services/element-management-assistant-title.test.ts |
| R39.7 | CONTRADICTED | lib/communication-graph.ts:113-118 — the empty `'assistant'` edge set is a CORRECT encoding of invisibility, but its own comment states the pre-2026-07-22 shape ("its own user + the active MAESTRO") and the relational branch it defers to is the R39.5 one downgraded above. The current text adds **the MANAGER** (R39.9) and any MANAGER-assigned collaborator on a shared repo (R39.10) as the exceptions to invisibility, and neither is encoded anywhere. Downgraded by the TRDD-SPS63XHA ruling. | tests/unit/communication-graph-user-routing.test.ts (pins the drift + the no-producer fact) |
| R39.8 | UNENFORCED | — | — |
| R39.9 | UNENFORCED | — | — |
| R39.10 | UNENFORCED | — | — |
| R40.1 | ENFORCED | services/element-management-service.ts:245-272, services/teams-service.ts:271-277 | — |
| R40.2 | INVENTED | — | — |
| R41.1 | ENFORCED | lib/trdd-authz.ts:105-131 | tests/unit/manage-trdd-authorization.test.ts |
| R41.2 | UNENFORCED | — | — |
| R41.3 | UNENFORCED | — | — |
| R41.4 | ENFORCED | lib/authorization.ts:428-433 | tests/unit/manage-trdd-authorization.test.ts |
| R41.5 | ENFORCED | lib/authorization.ts:425-427 | tests/unit/manage-trdd-authorization.test.ts |
| R41.6 | UNENFORCED | — | — |
| R42.1 | UNENFORCED | — | — |
| R42.2 | UNENFORCED | — | — |
| R42.3 | UNENFORCED | — | — |
| R42.4 | UNENFORCED | — | — |
| R42.5 | UNENFORCED | — | — |
| R42.6 | UNENFORCED | — | — |
| R42.7 | ENFORCED | `lib/fleet-restart-driver.ts:126-127`, `lib/fleet-restart-fanout.ts:40`, `server.mjs:1824-1825`, `server.mjs:1852-1853` | `tests/unit/fleet-restart-driver.test.ts` |
<!-- R43-R48: multi-host governance (GOVERNANCE-RULES v4.4.0, committed bf70bf47). Design-stage —
     these sub-rules are DECLARED but deliberately UNBUILT during the transition phase, so nothing
     enforces them yet (Guard = —). Not from a governance-audit report: the verdict is the honest
     present state (no code refuses the violation). Implementation is tracked by the cohort TRDDs
     OEG0V589 (R44) · W9FA6ACZ (R39/role-plugin) · QR9FSL3Q (R45) · HR8CES7H (R47) · 40CUZA1Z (R46)
     · PLOVIPZE (R48). When a rule's guard lands, flip its row to ENFORCED and cite the guard+test. -->
| R43.1 | UNENFORCED | — | — |
| R43.2 | UNENFORCED | — | — |
| R43.3 | UNENFORCED | — | — |
| R43.4 | UNENFORCED | — | — |
| R44.1 | UNENFORCED | — | — |
| R44.2 | UNENFORCED | — | — |
| R44.3 | UNENFORCED | — | — |
| R44.4 | UNENFORCED | — | — |
| R44.5 | UNENFORCED | — | — |
| R45.1 | UNENFORCED | — | — |
| R45.2 | UNENFORCED | — | — |
| R46.1 | UNENFORCED | — | — |
| R46.2 | UNENFORCED | — | — |
| R46.3 | UNENFORCED | — | — |
| R47.1 | UNENFORCED | — | — |
| R47.2 | UNENFORCED | — | — |
| R48.1 | UNENFORCED | — | — |
| R48.2 | UNENFORCED | — | — |
| R48.3 | UNENFORCED | — | — |
| R48.4 | UNENFORCED | — | — |
| R49.1 | BEHAVIOURAL | — | — |
| R49.2 | BEHAVIOURAL | — | — |
| R49.3 | BEHAVIOURAL | — | — |
| R49.4 | BEHAVIOURAL | — | — |
| R49.5 | BEHAVIOURAL | — | — |
| R49.6 | BEHAVIOURAL | — | — |

## Notes on individual rows

- **R49.1-R49.6 (BEHAVIOURAL)** — the refusal protocol binds what an approver
  WRITES when it declines a proposal: name the precise defect, state the bar for
  acceptance, invite a re-proposal, stay in the thread. No code surface can judge
  whether prose named a *concrete* defect rather than "insufficiently secure" —
  that is the whole substance of the rule, and it is a judgment. R49.3 binds the
  proposer symmetrically (a defect-less refusal does not authorize destroying the
  dependent work), which is equally unjudgeable by a guard.

  **R49.6 is the closest to mechanizable, and is still BEHAVIOURAL — honestly.**
  It requires the refusal *and its named defect* to be recorded on the governing
  GitHub issue and/or the TRDD `## Approval log`. A guard could check that a
  `column: refused` TRDD carries an approval-log line at all; it cannot check that
  the line names a defect, and it cannot see the GitHub-issue channel R49.4 makes
  co-equal (a plugin session ↔ MANAGER has no AMP thread, so the cross-repo issue
  IS the channel). A presence-only check would turn "the refusal explained itself"
  into "a line exists" — passing a bare "denied", which is the exact failure R49
  exists to stop. A guard that green-lights the violation is worse than no guard,
  so this row stays BEHAVIOURAL rather than claiming a hole a checkbox could fill.

- **R25.2 (ENFORCED, tested)** — only the vocab-equality half is test-enforced:
  `tests/unit/trdd-doctor.test.ts` pins `DEFAULT_STATUSES` (the 17 columns) equal
  to the TRDD-doctor's `VALID_COLUMNS`, and `tests/unit/kanban-index.test.ts` pins
  `KANBAN_INDEX_COLUMNS ⊇ DEFAULT_STATUSES`. The 1:1-with-team-config half
  (`types/team.ts DEFAULT_KANBAN_COLUMNS`) is not pinned by any test.
- **R28.1 (ENFORCED, tested)** — `tests/unit/sudo-guard-strict-agent-coverage.test.ts`
  asserts every strict route authenticates the AID first, but probes with a MANAGER
  caller only, so it proves *declared*, not *correctly declared per title*.
- **R41.1 / R41.4 / R41.5 (ENFORCED, tested)** — `tests/unit/manage-trdd-authorization.test.ts`
  refuses under-tier and self approvals. Caveat (audit H-04): the `manage-trdd`
  guard reads TRDD frontmatter that the unrestricted `PATCH /api/trdd/[id]` can
  rewrite, so the guard is only as trustworthy as that write path.
- **R32.1 / R32.2 (ENFORCED)** — enforced for the core "agents never sudo-gated"
  mechanism; the derived portfolio no-op (R28.2 check 3) and the missing headless
  sudo layer (R32.3) are booked as their own UNENFORCED rows.
- **R33.1 (ENFORCED)** — the ledger-recovery machinery runs at boot for the
  portfolio store; the AID-recovery half is inert while `enforceAidAssociation` is
  off (booked under R34.1).
- **R17.18 / R20.3 (RULING-NEEDED)** — each rule forbids exactly the enforcement the
  shipped architecture implements (the `startAgentInvariantsWatchdog` periodic
  mutation loop, TRDD-VYQ8N4KR); rule and code cannot both be right.
- **R29.1 (CONTRADICTED)** and **R29.3 (UNENFORCED)** are composites: the audit split
  each into `a`/`b` sub-findings (R29.1a ENFORCED + R29.1b rule-vs-rule contradiction;
  R29.3a UNENFORCED create-authority + R29.3b ENFORCED delete). The composite verdict
  takes the dominant, more conservative finding.
- **R23.1 / R23.2 / R23.6 (UNENFORCED here)** — a real guard exists but only inside an
  external role-plugin repo (`ai-maestro-programmer-agent`), not in this tree, so no
  in-repo guard can be cited. Fleet-wide the rule is unenforced.
- **R42.1–R42.6, R22.4–R22.5, R23.3–R23.4** were not covered by any audit report;
  they are recorded `UNENFORCED | — | —` (no evidence of enforcement), never assumed.

---

# Part II — R51.9 gate-shape coverage

**A different question from the one above.** Part I asks *is this rule enforced?* R51.9 asks
*is it enforced **as a gate**, inside the all-in-one pipeline?* Those come apart, and the gap
between them is a real class of bug rather than a bookkeeping detail:

> A rule enforced at a **route** holds for callers of that route. A rule enforced at a **gate**
> holds for every path to that mutation — which, under R50, is the only path there is.

So a rule can be `ENFORCED` in Part I and still fail R51.9. That is not double-counting: it says
the check sits outside the pipeline, where a second caller of the same service function — a
post-gate cascade, an internal call, a future endpoint — does not pass through it.

R51.9: *"For each governance rule there is a gate. A rule with no gate is a rule the system does
not actually enforce — it is documentation, and the state it forbids will occur."*

## How this table is produced

`scripts/aio-gate-coverage.py` (re-run it; do not hand-edit the verdicts). For each rule it
greps enforcement code (`services/`, `lib/`, `app/api/`, `server.mjs`) versus docs/tests/design,
and asks whether any enforcement-code citation sits within 40 lines of a gate label
(`ops.push('G##' | 'EXE' | 'PG##')`).

**The table below is checked against the code on every test run.**
`python3 scripts/aio-gate-coverage.py --check` re-derives the verdicts and fails on any
disagreement with this table — including the tally line — and
`tests/governance/enforcement-coverage.test.ts` runs it. Until 2026-07-26 it did not: the
script never opened this file, so the table was a hand-copied snapshot of an analysis that
could not see it, and a change in gate coverage would have left this page reading as accurate
indefinitely. Editing a verdict here without a matching change in code now turns the suite red.

**What that check does and does not buy.** It proves the table is FRESH, not that a verdict is
RIGHT: `GATED` still rests on the ±40-line proximity heuristic above, which is evidence a gate
is nearby, never that it is the correct check. And it says nothing about Part I — those
`file:line` guard citations are checked only for existence and in-range bounds by the same test
(a moved guard inside a file that is still long enough passes). Neither the script nor any test
verifies that a cited line still CONTAINS the guard it names; only a human read does.

| Verdict | Meaning |
|---|---|
| `GATED` | cited inside a pipeline, in a gate's neighbourhood — the strongest evidence a script can give that a gate enforces it |
| `ENFORCED` | cited in enforcement code but not at a gate — a route guard, a middleware, a lib invariant. Real enforcement, wrong shape for R51.9 |
| `DOC-ONLY` | cited only in docs/rules/tests/design. Nothing enforces it at runtime |
| `UNMAPPED` | not cited outside `GOVERNANCE-RULES.md` itself |

**This is a worklist, not a certificate.** A script cannot judge whether a gate checks *what the
rule says* — only that one plausibly exists. Every non-`GATED` row is a candidate hole; every
`GATED` row still needs a human to confirm the gate is the right check.

## Coverage as of 2026-07-26

**GATED 22 · ENFORCED 15 · DOC-ONLY 15 · UNMAPPED 0 · total 52.**

| Rule | Verdict | Where |
|---|---|---|
| R1 Teams and Groups | ENFORCED | `lib/ledger-startup.ts`, teams routes |
| R2 Team Name Rules | ENFORCED | `lib/team-registry.ts`, `lib/aid-ledger-authority.ts` |
| R3 Role Hierarchy | **GATED** | `element-management-service.ts` |
| R4 Agent Membership | **GATED** | `element-management-service.ts` |
| R5 Transfer Rules | ENFORCED | governance transfer routes |
| R6 Communication Graph | **GATED** | `send-message-service.ts` |
| R7 UI Robustness | **GATED** | `element-management-service.ts` |
| R8 Data Integrity | **GATED** | `element-management-service.ts` |
| R9 Manager Requirement | **GATED** | `element-management-service.ts` |
| R10 Agent Lifecycle | **GATED** | `element-management-service.ts` |
| R11 Title-Plugin Binding | **GATED** | `element-management-service.ts` |
| R12 Minimum Team Composition | **GATED** | `element-management-service.ts` |
| R13 Role Boundaries | DOC-ONLY | — (behavioural; binds agent conduct) |
| R14 Team Resilience | ENFORCED | `app/api/agents/[id]/route.ts` |
| R15 Written Orders | DOC-ONLY | — (behavioural) |
| R16 Password Never Shared | ENFORCED | continuity routes, `lib/agent-frame-reader.ts` |
| R17 Mandatory Core Plugin | **GATED** | `element-management-service.ts` |
| R18 Plugin Continuity on Client Change | **GATED** | `element-management-service.ts` |
| R19 MAINTAINER Title | **GATED** | `element-management-service.ts` |
| R20 Marketplace Governance | ENFORCED | groups/marketplace routes |
| R21 All-In-One Pipeline Architecture | **GATED** | `element-management-service.ts` |
| R22 GitHub Authorship | DOC-ONLY | — (behavioural) |
| R23 Plugin↔Server Decoupling | DOC-ONLY | — (guard lives in an external plugin repo; see Part I) |
| R24 Proactive Global Memory | DOC-ONLY | — (behavioural) |
| R25 Three-Pillars Task System | DOC-ONLY | — (partly pinned by `trdd-doctor`/`kanban-index` tests) |
| R26 Identity Immutability | **GATED** | `element-management-service.ts` |
| R27 Self-Install via Core-Plugin Skills | DOC-ONLY | — |
| R28 Three-Check API Authorization | **GATED** | `element-management-service.ts` |
| R29 MANAGER Lifecycle Authority | ENFORCED | teams routes |
| R30 COS Creation Requires a Mandate | ENFORCED | `lib/authorization.ts`, `lib/portfolio-issue-guard.ts` |
| R31 Incomplete-Team Freeze | ENFORCED | `lib/portfolio-check.ts` |
| R32 No Sudo Gates for Agents | ENFORCED | message + agent routes |
| R33 Signed-Ledger Recovery | ENFORCED | `aid-recover`, `v1/auth/token` |
| R34 Ledger Is Source of Truth | **GATED** | `element-management-service.ts` |
| R35 Foreign Agent/User Host Approval | ENFORCED | foreign-approval routes |
| R36 Users Have AIDs; One MAESTRO | **GATED** | `send-message-service.ts` |
| R37 MAESTRO + MAESTRO-DELEGATE | **GATED** | `send-message-service.ts` |
| R38 Non-MAESTRO User Restrictions | **GATED** | `send-message-service.ts` |
| R39 ASSISTANT Agent | **GATED** | `element-management-service.ts` |
| R40 Foreign-User Creation Approval | **GATED** | `element-management-service.ts` |
| R41 APPROVAL vs MANDATE | ENFORCED | `lib/trdd-approval-token.ts`, portfolio verify |
| R42 No Agent May Drive Another | ENFORCED | chat + continuity routes |
| R43 Multi-Host Governance Scope | DOC-ONLY | — |
| R44 Cross-Host Agent Migration | DOC-ONLY | — |
| R45 Teams Same-Host; Groups Span | DOC-ONLY | — |
| R46 Unified Cross-Host Sidebar | DOC-ONLY | — |
| R47 VPN-Unique User Names | DOC-ONLY | — |
| R48 MAESTRO Console-Presence | ENFORCED | `lib/peer-address.mjs` (`isConsolePeer`) |
| R49 The Refusal Protocol | DOC-ONLY | — (behavioural) |
| R50 One Operation, One AIO Function | DOC-ONLY | — but ratcheted by `tests/unit/all-in-one-single-path.test.ts` |
| R51 All-Or-Nothing Transaction | GATED | `lib/gate-transaction.ts`, `services/element-management-service.ts` (ChangeClient::G07-G09, the runner's first production caller) |
| R52 The Write Boundary | DOC-ONLY | no pipeline gate BY DESIGN — enforced by a source-scanning gate (`lib/write-boundary.ts` + `tests/unit/write-boundary.test.ts`), which is the right altitude for a rule about the tree's own write sites rather than about one operation |

## Reading the holes

Three distinct kinds, and they need different work — collapsing them into one "15 unenforced"
number is how a real hole hides behind a behavioural one:

1. **BEHAVIOURAL (R13, R15, R22, R24, R49, and most of R25).** These bind an *agent's conduct*,
   not server code. No gate can enforce "self-identify when posting to GitHub". They are
   enforced by the DEP rules seeded into every agent workdir and by review. Correctly DOC-ONLY;
   **not** a backlog item.
2. **ENFORCED-BUT-NOT-GATED (15 rules).** Real guards in the wrong shape. Each is a candidate to
   move into the pipeline as a gate during the TRDD-DQ6XN2VP retrofit — starting with the ones
   whose mutation has more than one caller. R32/R42 are the sharpest cases: both are cited
   heavily across routes (66 and 33 citations), which is a lot of surface to keep consistent by
   hand.
3. **GENUINELY MISSING (R27, R43–R47).** The multi-host rules R43–R47 are the largest cluster:
   the cross-host governance surface exists as design, and its enforcement is not yet written.

   R48 *was* in this list on the first run, wrongly. The console-presence gate has been
   implemented since TRDD-P7XKV3N9 (`lib/peer-address.mjs::isConsolePeer`) — it simply never
   named its rule, so the scan could not see it. **That was a citation defect, not an enforcement
   one**, and the fix was one comment line. Worth stating because it generalizes: this scan reads
   rule ids out of enforcement code, so **a guard that does not cite its rule is indistinguishable
   from a guard that does not exist**. When a row here looks wrong, check for a missing citation
   before writing a guard that is already there.

R50's own row is the instructive one: `DOC-ONLY` by citation, yet it has the strongest enforcement
in the repo — `tests/unit/all-in-one-single-path.test.ts` is a ratchet whose bypass list may only
shrink. A rule can be enforced by a *test* rather than a *guard*, and this script does not look
for that. Read the verdicts as evidence, never as a verdict on the system.
