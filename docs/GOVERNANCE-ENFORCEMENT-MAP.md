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

**Enforced-but-untested.** Most `ENFORCED` rows have a real guard but no test
(Test = `—`): the guard is single-path code that nothing pins against regression.
A separate ratchet counter tracks these; they are the priority backlog for
governance test coverage. Only 5 rules have BOTH a guard and a drift-failing test
(R25.2, R28.1, R41.1, R41.4, R41.5).

Row format is fixed so a regex parses each line:
`| Sub-rule | Verdict | Guard (file:line or —) | Test (path or —) |`

| Sub-rule | Verdict | Guard (file:line or —) | Test (path or —) |
|---|---|---|---|
| R1.1 | ENFORCED | lib/team-acl.ts:102 | — |
| R1.2 | ENFORCED | lib/group-registry.ts | — |
| R1.3 | ENFORCED | services/teams-service.ts:344-404 | — |
| R1.4 | ENFORCED | services/teams-service.ts:279-282 | — |
| R1.5 | ENFORCED | lib/team-registry.ts:427 | — |
| R1.6 | INVENTED | — | — |
| R2.1 | ENFORCED | lib/team-registry.ts:106-110 | — |
| R2.2 | ENFORCED | lib/team-registry.ts:107 | — |
| R2.3 | ENFORCED | lib/team-registry.ts:107 | — |
| R3.1 | CONTRADICTED | — | — |
| R3.2 | ENFORCED | services/element-management-service.ts:2249-2256 | — |
| R3.3 | ENFORCED | services/element-management-service.ts:2304-2309 | — |
| R3.4 | ENFORCED | lib/team-registry.ts:133-138 | — |
| R3.5 | ENFORCED | services/governance-service.ts:66-83 | — |
| R3.6 | ENFORCED | lib/authorization.ts:321-326 | tests/unit/headless-router-auth-mirror.test.ts |
| R3.7 | ENFORCED | lib/communication-graph.ts:98 | — |
| R3.8 | CONTRADICTED | — | — |
| R3.9 | ENFORCED | lib/authorization.ts:285 | — |
| R3.10 | UNENFORCED | — | — |
| R3.11 | CONTRADICTED | — | — |
| R3.12 | ENFORCED | app/api/teams/[id]/route.ts:115 | — |
| R4.1 | ENFORCED | lib/team-registry.ts:158-176 | — |
| R4.2 | ENFORCED | lib/group-registry.ts | — |
| R4.3 | CONTRADICTED | — | — |
| R4.4 | ENFORCED | services/element-management-service.ts:4956 | — |
| R4.5 | UNENFORCED | — | — |
| R4.6 | ENFORCED | lib/team-registry.ts:142-145 | — |
| R4.7 | ENFORCED | lib/team-registry.ts:148-154 | — |
| R4.8 | ENFORCED | components/teams/TeamOverviewSection.tsx:33-34 | — |
| R4.9 | UNENFORCED | — | — |
| R5.1 | UNENFORCED | — | — |
| R5.2 | ENFORCED | app/api/governance/transfers/route.ts:97-99 | — |
| R5.3 | ENFORCED | app/api/governance/transfers/[id]/resolve/route.ts:85-90 | — |
| R5.4 | ENFORCED | app/api/governance/transfers/route.ts:149-151 | — |
| R5.5 | ENFORCED | app/api/governance/transfers/route.ts:143-146 | — |
| R5.6 | ENFORCED | app/api/governance/transfers/route.ts:124-126 | — |
| R5.7 | ENFORCED | app/api/governance/transfers/[id]/resolve/route.ts:103-127 | — |
| R5.8 | ENFORCED | app/api/governance/transfers/route.ts:160-164 | — |
| R6.1 | ENFORCED | lib/communication-graph.ts:94-144 | — |
| R6.2 | ENFORCED | lib/communication-graph.ts:97 | — |
| R6.3 | ENFORCED | lib/communication-graph.ts:98 | — |
| R6.4 | ENFORCED | lib/communication-graph.ts:99 | — |
| R6.5 | ENFORCED | lib/communication-graph.ts:100-102 | — |
| R6.5a | ENFORCED | lib/communication-graph.ts:103 | — |
| R6.5b | ENFORCED | lib/communication-graph.ts:104 | — |
| R6.6 | ENFORCED | lib/communication-graph.ts:112 | — |
| R6.7 | ENFORCED | services/amp-service.ts:1294-1300 | — |
| R6.8 | ENFORCED | services/amp-service.ts:1286 | — |
| R6.9 | ENFORCED | services/amp-service.ts:797-802 | — |
| R6.10 | ENFORCED | lib/communication-graph.ts:442-491 | — |
| R6.11 | UNENFORCED | — | — |
| R6.12 | UNENFORCED | — | — |
| R6.13 | ENFORCED | lib/agent-registry.ts:316-325 | — |
| R6.14 | UNENFORCED | — | — |
| R7.1 | ENFORCED | components/sidebar/TeamListView.tsx:94 | — |
| R7.2 | ENFORCED | hooks/useGovernance.ts:48 | — |
| R7.3 | ENFORCED | components/sidebar/TeamListView.tsx:192 | — |
| R7.4 | UNENFORCED | — | — |
| R7.5 | UNENFORCED | — | — |
| R7.6 | CONTRADICTED | — | — |
| R7.7 | ENFORCED | components/sidebar/TeamCard.tsx:71 | — |
| R7.8 | ENFORCED | components/teams/TeamOverviewSection.tsx | — |
| R7.9 | ENFORCED | hooks/useGovernance.ts:48 | — |
| R8.1 | ENFORCED | lib/team-registry.ts:306 | — |
| R8.2 | ENFORCED | app/api/teams/[id]/route.ts:115, services/headless-router.ts:2936 | tests/unit/headless-router-auth-mirror.test.ts |
| R8.3 | ENFORCED | services/element-management-service.ts:6183-6205 | — |
| R8.4 | ENFORCED | lib/authorization.ts:580-592 | — |
| R9.1 | ENFORCED | services/teams-service.ts:279-282 | — |
| R9.2 | ENFORCED | services/element-management-service.ts:2419-2431 | — |
| R9.3 | CONTRADICTED | — | — |
| R9.4 | ENFORCED | lib/team-registry.ts:451-501 | — |
| R9.5 | ENFORCED | services/agents-core-service.ts:2019-2028 | — |
| R9.6 | ENFORCED | services/element-management-service.ts:2497-2515 | — |
| R9.7 | ENFORCED | lib/team-registry.ts:518-534 | — |
| R9.8 | ENFORCED | services/element-management-service.ts:6392-6415 | — |
| R9.9 | ENFORCED | server.mjs:1693-1699 | — |
| R9.10 | UNENFORCED | — | — |
| R9.11 | ENFORCED | services/teams-service.ts:284-290 | — |
| R9.12 | ENFORCED | app/api/agents/route.ts | — |
| R9.13 | CONTRADICTED | — | — |
| R10.1 | ENFORCED | services/agents-core-service.ts:2003-2017 | — |
| R10.2 | CONTRADICTED | — | — |
| R10.3 | ENFORCED | lib/authorization.ts:456-466 | — |
| R10.4 | CONTRADICTED | — | — |
| R10.5 | ENFORCED | services/agents-core-service.ts:2019-2028 | — |
| R10.6 | ENFORCED | app/api/sessions/[id]/restart/route.ts:97-107, services/headless-router.ts:919 | — |
| R10.7 | UNENFORCED | — | — |
| R11.1 | CONTRADICTED | — | — |
| R11.2 | ENFORCED | lib/ecosystem-constants.ts:330 | — |
| R11.3 | ENFORCED | lib/ecosystem-constants.ts:332 | — |
| R11.4 | ENFORCED | services/element-management-service.ts:4952-4956 | — |
| R11.5 | ENFORCED | services/element-management-service.ts:4897-4902 | — |
| R11.6 | ENFORCED | components/agent-profile/RoleTab.tsx:63-74 | — |
| R11.7 | CONTRADICTED | — | — |
| R11.8 | CONTRADICTED | — | — |
| R11.9 | CONTRADICTED | — | — |
| R11.10 | CONTRADICTED | — | — |
| R11.11 | ENFORCED | services/plugin-storage-service.ts:210-222 | — |
| R11.12 | CONTRADICTED | — | — |
| R12.1 | UNENFORCED | — | — |
| R12.2 | CONTRADICTED | — | — |
| R12.3 | ENFORCED | services/element-management-service.ts:2296-2314 | — |
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
| R17.1 | ENFORCED | services/element-management-service.ts:7530-7551 | — |
| R17.2 | ENFORCED | services/element-management-service.ts:1531-1533 | — |
| R17.3 | UNENFORCED | — | — |
| R17.4 | UNENFORCED | — | — |
| R17.5 | ENFORCED | services/agents-core-service.ts:2121-2137 | — |
| R17.6 | ENFORCED | services/element-management-service.ts:7522-7551 | — |
| R17.7 | UNENFORCED | — | — |
| R17.8 | ENFORCED | services/element-management-service.ts:724-729 | — |
| R17.9 | ENFORCED | services/element-management-service.ts:1193-1194 | — |
| R17.10 | UNENFORCED | — | — |
| R17.11 | CONTRADICTED | — | — |
| R17.12 | UNENFORCED | — | — |
| R17.13 | ENFORCED | services/plugin-storage-service.ts:182-266 | — |
| R17.14 | UNENFORCED | — | — |
| R17.15 | ENFORCED | services/element-management-service.ts:714-722 | — |
| R17.16 | ENFORCED | components/agent-profile/PluginsTab.tsx:244-245 | — |
| R17.17 | ENFORCED | server.mjs:1709-1742 | — |
| R17.18 | RULING-NEEDED | — | — |
| R17.18a | ENFORCED | services/agents-core-service.ts | — |
| R17.19 | ENFORCED | scripts/bump-version.sh:225-228 | — |
| R17.20 | ENFORCED | server.mjs:1777-1793 | — |
| R17.21 | ENFORCED | services/agents-core-service.ts:2121-2137 | — |
| R17.22 | ENFORCED | services/agents-core-service.ts:1833-1866 | — |
| R17.23 | ENFORCED | services/agents-core-service.ts:2300-2303 | — |
| R18.1 | ENFORCED | services/element-management-service.ts:5638-5684 | — |
| R18.2 | ENFORCED | services/element-management-service.ts:5530-5565 | — |
| R18.3 | ENFORCED | services/element-management-service.ts:5603-5636 | — |
| R18.3b | CONTRADICTED | — | — |
| R18.3c | UNENFORCED | — | — |
| R18.3d | UNENFORCED | — | — |
| R18.4 | UNENFORCED | — | — |
| R18.5 | ENFORCED | services/element-management-service.ts:5556-5563 | — |
| R18.6 | CONTRADICTED | — | — |
| R18.7 | ENFORCED | services/element-management-service.ts:5847-5849 | — |
| R18.8 | ENFORCED | services/element-management-service.ts:5475-5866 | — |
| R18.9 | ENFORCED | services/element-management-service.ts:5475-5866 | — |
| R18.10 | ENFORCED | services/element-management-service.ts:5840 | — |
| R19.1 | ENFORCED | services/element-management-service.ts:2385 | — |
| R19.2 | UNENFORCED | — | — |
| R19.3 | ENFORCED | services/element-management-service.ts:2400-2411 | — |
| R19.4 | UNENFORCED | — | — |
| R19.5 | UNENFORCED | — | — |
| R19.6 | UNENFORCED | — | — |
| R19.7 | UNENFORCED | — | — |
| R19.8 | UNENFORCED | — | — |
| R19.9 | CONTRADICTED | — | — |
| R19.10 | ENFORCED | lib/ecosystem-constants.ts:331 | — |
| R19.11 | UNENFORCED | — | — |
| R20.1 | ENFORCED | lib/ecosystem-constants.ts:151-190 | — |
| R20.2 | ENFORCED | services/element-management-service.ts:7530-7551 | — |
| R20.3 | RULING-NEEDED | — | — |
| R20.4 | ENFORCED | lib/ecosystem-constants.ts:324-334 | — |
| R20.5 | ENFORCED | services/element-management-service.ts:1722-1778 | — |
| R20.6 | ENFORCED | services/element-management-service.ts:7419-7468 | — |
| R20.7 | UNENFORCED | — | — |
| R20.8 | ENFORCED | services/plugin-storage-service.ts:166-170 | — |
| R20.9 | ENFORCED | services/plugin-storage-service.ts:166-170 | — |
| R20.10 | UNENFORCED | — | — |
| R20.11 | UNENFORCED | — | — |
| R20.12 | UNENFORCED | — | — |
| R20.13 | ENFORCED | services/element-management-service.ts:6849 | — |
| R20.14 | ENFORCED | lib/agent-directory.ts | — |
| R20.15 | ENFORCED | lib/agent-auth.ts | — |
| R20.16 | ENFORCED | lib/agent-auth.ts | — |
| R20.17 | UNENFORCED | — | — |
| R20.18 | ENFORCED | lib/converter/marketplace-emitters.ts | — |
| R20.19 | ENFORCED | lib/agent-invariants.ts:111-121 | — |
| R20.20 | ENFORCED | services/agent-local-config-service.ts | — |
| R20.21 | CONTRADICTED | — | — |
| R20.22 | ENFORCED | services/plugin-storage-service.ts:166-170 | — |
| R20.23 | ENFORCED | services/plugin-storage-service.ts:185-224 | — |
| R20.24 | ENFORCED | services/plugin-storage-service.ts:207 | — |
| R20.25 | ENFORCED | services/plugin-storage-service.ts:227-230 | — |
| R20.26 | ENFORCED | services/plugin-storage-service.ts:199-203 | — |
| R20.27 | UNENFORCED | — | — |
| R20.28 | ENFORCED | install-messaging.sh:856-869 | — |
| R20.29 | ENFORCED | services/element-management-service.ts:1531-1533 | — |
| R20.30 | ENFORCED | components/agent-profile/PluginsTab.tsx:116-153 | — |
| R20.31 | ENFORCED | services/plugin-storage-service.ts:426-460 | — |
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
| R26.3 | ENFORCED | lib/authorization.ts:290-300 | — |
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
| R32.1 | ENFORCED | lib/sudo-guard.ts:86-88 | — |
| R32.2 | ENFORCED | lib/sudo-guard.ts:91-136 | — |
| R32.3 | UNENFORCED | — | — |
| R33.1 | ENFORCED | lib/portfolio-ledger.ts:149-214 | — |
| R34.1 | UNENFORCED | — | — |
| R34.2 | ENFORCED | app/api/agents/foreign-approvals/[id]/approve/route.ts:46-49 | — |
| R35.1 | UNENFORCED | — | — |
| R35.2 | ENFORCED | app/api/agents/foreign-approvals/[id]/approve/route.ts:46-49 | — |
| R36.1 | UNENFORCED | — | — |
| R36.2 | UNENFORCED | — | — |
| R37.1 | BEHAVIOURAL | — | — |
| R37.2 | ENFORCED | app/api/governance/maestro-delegate/route.ts:99-102 | — |
| R37.3 | ENFORCED | app/api/governance/maestro-delegate/route.ts:129-167 | — |
| R37.4 | ENFORCED | app/api/governance/maestro-delegate/route.ts:75-80 | — |
| R38.1 | UNENFORCED | — | — |
| R38.2 | UNENFORCED | — | — |
| R38.3 | UNENFORCED | — | — |
| R39.1 | UNENFORCED | — | — |
| R39.2 | UNENFORCED | — | — |
| R39.3 | UNENFORCED | — | — |
| R39.4 | UNENFORCED | — | — |
| R39.5 | ENFORCED | lib/communication-graph.ts:363-371 | — |
| R39.6 | ENFORCED | services/element-management-service.ts:6381-6385 | — |
| R39.7 | ENFORCED | lib/communication-graph.ts:113-118 | — |
| R39.8 | UNENFORCED | — | — |
| R39.9 | UNENFORCED | — | — |
| R39.10 | UNENFORCED | — | — |
| R40.1 | ENFORCED | services/element-management-service.ts:244-271 | — |
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
