---
trdd-id: 903b7a20-bddf-4368-9295-4a9a984270e9
title: Overnight fleet-readiness campaign — govern-compliance + script-skill align + install-security + scenarios before the governance PR
column: dev
created: 2026-06-20T23:15:18+0200
updated: 2026-07-08T10:50:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 0
severity: HIGH
task-type: audit
release-via: none
test-requirements: [unit, typecheck, e2e, dev-browser-headless]
audit-requirements: [security-scan, adversarial-scan]
review-requirements: [human-review]
relevant-rules: []
labels: [overnight, fleet-readiness, governance, security, scripts, scenarios]
---

# TRDD-903b7a20 — Overnight fleet-readiness campaign

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-06-20

**▶ UPDATE 2026-07-08T11:40 (USER approved the hybrid fleet plan — pre-fleet blockers B1..B5 + first probe results):**
USER approved: source repo stays OUTSIDE the harness; plugin projects become fleet agents
(MAINTAINER/AUTONOMOUS, no teams); cross-boundary channel = GitHub. Blockers before any import:

- **B1 — import system incomplete.** DECISION (recommended, executing for the pilot): **Path C
  — fresh `git clone` of each plugin repo into `~/agents/<plugin>-dev/`**, NOT folder import.
  This sidesteps all 6 import defects (unique naming, dotfile copy, absolute-path rewrite,
  jsonl /resume migration, git-root autodetect, .claude-root ambiguity) AND needs no hook/UI
  change. Durable knowledge must live in each repo (TRDDs + git-tracked PROJECT wikimem), not
  in the old session jsonl. Path A (finish folder-import) and Path B (in-place import +
  relax the ~/agents confinement to $HOME) stay DEFERRED backlog candidates — B is a
  governance-invariant change (weakens the delete-folder safety net) → proposal-tier if pursued.
- **B2 — maintainer plugin not plugin-root-ready.** It was designed to clone targets into
  subfolders/containers; as a fleet agent its OWN workdir root == the plugin repo root (own
  publish.py + workflows). Risk: local-scoped ai-maestro plugin artifacts polluting the repo /
  the publish. PLAN: dry-run FIRST with a dummy/cloned plugin repo as a disposable agent,
  inventory every artifact created in-root, verify .gitignore/publish exclusion, then update
  the maintainer main-agent (its own repo, via issue/its own session), then real imports.
- **B3 — fleet readiness unknown** — the B2 dry-run pilot IS the test.
- **B4 — MANAGER (AMAMA) 3-pillars currency** — background audit agent dispatched 2026-07-08
  (17-column vocab, folder lifecycle + batch-approval semantics, TRDD v2 ids/approval-tier,
  old-vs-DEP rule filename refs, comm-graph v3, R9.13). Report lands in reports/amama-audit/.
- **B5 — janitor token burn (biggest risk).** Preliminary measurement 2026-07-08
  (token_report --attribution): NO runaway — fleet 5h = 29.1M weighted (~97k/min TOTAL across
  80 projects); top consumer = the janitor's own DEV project (13.3M/5h, 46% — its Claude doing
  the reduction work, not heartbeat overhead); ai-maestro = 1.4M/5h. DEFINITIVE test = pilot
  checkpoint 1: one imported agent left IDLE 1-2h with janitor armed, its project tokens must
  stay ~0. The "move janitor essentials into the core plugin" idea = existing TRDD-OZZB3DJA
  (janitor-to-server-migration) — defer, coordinate from inside once the fleet is up.
- **Coordination channel:** keep GitHub; open ONE pinned "fleet-coordination" issue as the
  mailbox this session polls cheaply. An AMP liaison identity for the source-repo session
  (identity without managed-agent status) = future TRDD candidate, post-PR.

**Fleet dev-folder map (USER: real plugin dev folders live under `~/Code/`; the CORRECT project
root — often a SUBFOLDER of a container dir — is the one encoded in the `~/.claude/projects/`
slug, i.e. the folder Claude Code actually ran in, holding `.claude/`).** Decoded 2026-07-08:

| Plugin | Local project root (from slug) |
|---|---|
| core `ai-maestro-plugin` | `~/Code/AI-MAESTRO-PLUGIN/ai-maestro-plugin/` (subfolder) |
| marketplace `ai-maestro-plugins` | `~/Code/AI-MAESTRO-PLUGINS-MARKETPLACE/ai-maestro-plugins/` (subfolder) |
| janitor | `~/Code/AI-MAESTRO-JANITOR/ai-maestro-janitor/` (subfolder) |
| maintainer | `~/Code/AI-MAESTRO-MAINTAINER-AGENT/ai-maestro-maintainer-agent/` (subfolder) |
| autonomous | `~/Code/AI-MAESTRO-AUTONOMOUS-AGENT/ai-maestro-autonomous-agent/` (subfolder) |
| AMAMA (manager) | `~/Code/EMASOFT-ASSISTANT-MANAGER/ai-maestro-assistant-manager-agent/` (container root is NOT a git repo) |
| chief-of-staff | `~/Code/EMASOFT-CHIEF-OF-STAFF/ai-maestro-chief-of-staff/` — DUAL container: sibling `emasoft-chief-of-staff/` is the OTHER marketplace's variant, independent git, do not touch |
| architect | `~/Code/EMASOFT-ARCHITECT-AGENT/ai-maestro-architect-agent/` |
| orchestrator | `~/Code/EMASOFT-ORCHESTRATOR-AGENT/ai-maestro-orchestrator-agent/` |
| integrator | `~/Code/EMASOFT-INTEGRATOR-AGENT/ai-maestro-integrator-agent/` |
| programmer | `~/Code/EMASOFT-PROGRAMMER-AGENT/ai-maestro-programmer-agent/` |
| webdesign | `~/Code/AI-MAESTRO-WEBDESIGN-AGENT/` |
| code-auditor | `~/Code/EMASOFT-CODE-AUDITOR-AGENT/code-auditor-agent/` — BOTH root and subfolder slugs exist (the ambiguity case) |
| CPV | `~/Code/CLAUDE-PLUGIN-VALIDATION/` (+ `claude-plugins-validation` subfolder slug via worktree) |
| PSS | `~/Code/PERFECT-SKILL-SUGGESTER/perfect-skill-suggester/` (subfolder) |
| llm-externalizer | `~/Code/llm-externalizer/` |
| visual-communicator | `~/Code/visual-comunicator/` (note folder typo) |
| web-scenario-tester | **NO `~/Code/` slug found** — locate before G3 (may live elsewhere or under an unexpected name) |

**Two-marketplace disambiguation (USER, 2026-07-08 — MANDATORY before touching any plugin).**
A PARALLEL plugin family exists; resolve every plugin name + repo against the two live
marketplace manifests, never guess from a container folder name. Authoritative name→repo
tables extracted 2026-07-08 from both `.claude-plugin/marketplace.json` on GitHub:

`Emasoft/ai-maestro-plugins` — the FLEET marketplace (pick THESE for all fleet work):

| name | repo |
|---|---|
| ai-maestro-plugin | Emasoft/ai-maestro-plugin |
| ai-maestro-assistant-manager-agent | Emasoft/ai-maestro-assistant-manager-agent |
| ai-maestro-chief-of-staff | Emasoft/ai-maestro-chief-of-staff |
| ai-maestro-architect-agent | Emasoft/ai-maestro-architect-agent |
| ai-maestro-orchestrator-agent | Emasoft/ai-maestro-orchestrator-agent |
| ai-maestro-integrator-agent | Emasoft/ai-maestro-integrator-agent |
| ai-maestro-programmer-agent | Emasoft/ai-maestro-programmer-agent |
| ai-maestro-maintainer-agent | Emasoft/ai-maestro-maintainer-agent |
| ai-maestro-autonomous-agent | Emasoft/ai-maestro-autonomous-agent |
| ai-maestro-janitor | Emasoft/ai-maestro-janitor |
| ai-maestro-visual-communicator-plugin | Emasoft/ai-maestro-visual-communicator-plugin |

`Emasoft/emasoft-plugins` — the general marketplace: true EXTERNALS (correct to use) plus six
`emasoft-*` role-plugin PARALLEL VARIANTS (NEVER for fleet work):

| name | repo | class |
|---|---|---|
| perfect-skill-suggester | Emasoft/perfect-skill-suggester | external |
| claude-plugins-validation | Emasoft/claude-plugins-validation | external |
| llm-externalizer | Emasoft/llm-externalizer-plugin | external (repo name ≠ plugin name) |
| token-reporter | Emasoft/token-reporter-plugin | external (repo name ≠ plugin name) |
| code-auditor-agent | Emasoft/code-auditor-agent | external |
| claude-plugins-management | Emasoft/claude-plugins-management | external |
| rechecker-plugin | Emasoft/rechecker-plugin | external |
| claude-menu-system | Emasoft/claude-menu-system | external |
| emasoft-chat-history | Emasoft/emasoft-chat-history | external |
| no-install-linters-expert | Emasoft/no-install-linters-expert | external |
| emasoft-universal-clipboard | Emasoft/emasoft-universal-clipboard | external |
| emasoft-assistant-manager-agent | Emasoft/emasoft-assistant-manager-agent | PARALLEL VARIANT — avoid |
| emasoft-chief-of-staff | Emasoft/emasoft-chief-of-staff | PARALLEL VARIANT — avoid |
| emasoft-architect-agent | Emasoft/emasoft-architect-agent | PARALLEL VARIANT — avoid |
| emasoft-orchestrator-agent | Emasoft/emasoft-orchestrator-agent | PARALLEL VARIANT — avoid |
| emasoft-integrator-agent | Emasoft/emasoft-integrator-agent | PARALLEL VARIANT — avoid |
| emasoft-programmer-agent | Emasoft/emasoft-programmer-agent | PARALLEL VARIANT — avoid |

Gaps vs the gate list: NEITHER marketplace lists a web-scenario-tester (G3) or the webdesign
plugin (G8) — both still need publish + registration (webdesign belongs in ai-maestro-plugins).

Pilot consequence (amends B1 Path C — REVISED per USER 2026-07-08: most local plugin projects
are AHEAD of their GitHub origins, pushes held back by pending fixes): fleet agents must NOT
clone from GitHub (stale for most plugins). Instead **clone from the LOCAL dev repo path**
(`git clone ~/Code/<container>/<ai-maestro-plugin-subfolder>/ ~/agents/<plugin>-dev/`) then
re-point origin to the GitHub URL — committed-but-unpushed work carries over automatically,
and no premature push is forced. Per-plugin pre-clone check reduces to: DIRTY uncommitted
files in the dev folder must be committed there (by that project's own session) before the
clone, else that work is left behind. B4 audit agent updated mid-flight to audit the LOCAL
AMAMA copy as primary and diff it vs the GitHub clone.

**G8 probe (major find):** the webdesign role plugin ALREADY EXISTS locally at
`~/Code/AI-MAESTRO-WEBDESIGN-AGENT/` — plugin name `ai-maestro-webdesign` (v0.1.0), main agent
`ai-maestro-webdesign-main-agent.md`, CPV cleared to publishable (commit 40010b0, PR #123),
dormant since 2026-06-21. MISSING for G8: (1) NO `.agent.toml` (quad-identity #3 → not yet a
valid role plugin; needs compatible-titles [MEMBER] + compatible-clients), (2) NO git remote →
no GitHub repo, (3) not in the Emasoft/ai-maestro-plugins marketplace. Naming decision needed
by ITS project (not ours): main-agent name forces plugin name `ai-maestro-webdesign`, while the
role-plugin convention is `…-agent` — either rename the quad or keep `ai-maestro-webdesign`.

**▶ UPDATE 2026-07-08T10:50 (USER expanded the PR gate — this checklist is now the campaign's authoritative scope):**
The USER ruled the governance PR to main PREMATURE. It is gated on ALL of the following
(initial status from 2026-07-08 read-only probes; update in place as each gate is verified):

- **G1 — plugin fleet ready** (umbrella; G2..G11 are its concrete gates)
- **G2 — 3-pillars system (TRDD/PRRD/kanban) working across role plugins + GitHub** — DEP overlay shipped (TRDD-DE9757LJ); WAITING on janitor#73 (IND global rules) + orch#27 (kanban script rewire)
- **G3 — web-scenario-tester plugin published + working + token-frugal** — NOT in the remote marketplace (probe 2026-07-08); plugin work = TRDD-f181a4ae, token restructure = TRDD-74ZS7P9U
- **G4 — HTML side panel in each agent terminal correctly displays agent-pushed content** (visual-communicator surface)
- **G5 — all Agent Profile tabs working for each agent**
- **G6 — global (user-scope) extension install via Settings works flawlessly**
- **G7 — API ↔ external plugins (pss, cpv, llm-externalizer, visual-communication, web-scenario-tester, …) working + tested**
- **G8 — NEW role plugin `ai-maestro-webdesign-agent` published + working as MEMBER + valid, up-to-date `.agent.toml` (quad-identity)** — repo `Emasoft/ai-maestro-webdesign-agent` NOT FOUND and not in the marketplace (probe 2026-07-08) → creation/publish pending
- **G9 — janitor heartbeat token burn bounded** (no repeat of the earlier per-heartbeat burn)
- **G10 — all ai-maestro plugin skills/scripts/API in sync + up to date**
- **G11 — agent-status monitoring updated to the latest Anthropic Claude Code changes**
- **DEFERRED by USER: codex + all other non-Claude clients wait for now** (QXRWQ232 stays deferred)

Probe evidence 2026-07-08: remote marketplace (`Emasoft/ai-maestro-plugins`) lists the 8 role
plugins + `ai-maestro-plugin` + `ai-maestro-janitor` + `ai-maestro-visual-communicator-plugin`
— NO web-scenario-tester, NO webdesign-agent. TRDD-RYJD3R9E (incorporate pending TRDDs into
the governance PR) remains the PR-assembly task and now depends on this gate list.

**▶ UPDATE 2026-06-23T10:30 (QUOTA BACK — directive B DONE, directive A piloting):**
- **WEEKLY QUOTA RESET** — a probe agent returned PROBE_OK (210k tokens) at 10:19. Remaining
  risk is only TRANSIENT server RL on agent BURSTS; mitigated by low-concurrency ramped pools
  + rate-limit-as-returned-string backoff (the proven `feedback_workflow_rate_limit_in_script`
  pattern).
- **Directive B COMPLETE** — pooled scan/revise Workflow (`scenario-governance-revision-wf`,
  cap-3 scan/cap-2 revise, RL-backoff, schema-less) scanned all 27: 21 already compliant,
  1 flagged-no-edit (SCEN-008), **5 revised + COMMITTED `88eceef7`**: SCEN-001/002/006/007
  (D3 role-less — AUTONOMOUS revert now SWAPS in `ai-maestro-autonomous-agent`, NOT role-less,
  per R9.13/ChangeTitle G1+G15/16/G17); SCEN-011 (D1 — MANAGER routes the design task through
  the COS, R6 v3; R15.6 exemption kept distinct from R6 routing). Each diff verified (minimal,
  structure/numbering preserved, rules cited). Confirmed: no scenario cites R6/R22/R38/R39.
- **Directive A STARTING** — piloting SCEN-001 via the self-contained `scenario-runner` agent
  (BARE name; runs its OWN setup-SCEN-NNN.sh + cleanup-SCEN-NNN.sh; has the IRON write-guard
  hook), spawned in BACKGROUND (resumable, one-at-a-time → no burst RL). On each completion:
  commit any fix-as-you-go changes on `governance-rules` (NO worktree/PR/push) + append
  SCENARIO_DONE to batch-progress.log + spawn the next pending. Prereqs verified: server UP
  (401=auth-required), dev-browser daemon UP (0 browsers), pm2 ai-maestro online.
  NEXT ACTION: await SCEN-001 verdict → if clean, continue the batch one runner at a time.

**▶ UPDATE 2026-06-23 (USER DIRECTIVES — Phase D scenarios; weekly-limit-interrupted):**
USER (2026-06-22/23) gave two directives: **(A)** leave memory-split/consolidate/etc.
passes to the janitor daemon — do NOT run them myself; **priority = the ai-maestro
server + running the scenarios.** **(B)** "since certain governance rules changed,
revise ALL scenario files" — the 27 `tests/scenarios/SCEN-*.scen.md` were written
against older governance; update them to current `docs/GOVERNANCE-RULES.md` **v4.0.2
(R1-R40)** — esp. R6 v3 (MANAGER can't bypass COS), the comm-graph (R38/R39 user-user
forbidden + ASSISTANT-panel), R21 AIO, R22 authorship self-id, R23 frozen-CLI, R20.30/31
install scope, R6.11-R6.14 canonical agent-id — THEN run them. So: **revise (B) → run (A).**
- **SCEN-001:** ran (160 tool-uses) but the **WEEKLY USAGE LIMIT** killed it pre-commit;
  per Rule 6 the RUN is invalidated (re-run fresh after revision). Its 2 fix-as-you-go
  governance-UI bug fixes were independently valid, **tsc-verified (0 errors), COMMITTED
  `5285e722`**: BUG-001 `useGovernance.ts` raw fetch→`sudoFetch` on the strict team PUT;
  BUG-002 `TitleAssignmentDialog.impl.tsx` architect/integrator/orchestrator→member goes
  directly to `setGovernanceTitle('member')` (the old clearGovernanceTitle()→AUTONOMOUS
  tripped R3 Gate 9b). Tree CLEAN after the commit.
- **WEEKLY-LIMIT REALITY:** repeated hits this campaign (reset shifted Jun 23 5pm→10am;
  API returned after a ~22.5h gap). **Agent bursts re-trigger it** (a 38-agent audit
  Workflow + even a trivial probe RL'd). **RL-SAFE rule: pace, never burst** — probe
  (`general-purpose`, "reply PROBE_OK") before any heavy scenario-runner; one scenario at
  a time; resume from `tests/scenarios/state/batch-progress.log` (window started
  2026-06-22, 0 done yet). Ultracode audit `wf_23f696c3-21d` is parked (33/34 slices RL'd).
- **PLAN for B:** (1) build the governance-change spec from `docs/API-CHANGES.md` +
  GOVERNANCE-RULES.md v4.0.2; (2) map each scenario's governance assertions → revise the
  affected ones to current rules (paced; small agent batches only when the API proves
  stable — NEVER a 27-agent burst); (3) run the batch (A). NEXT ACTION: scope the
  governance delta, then revise scenarios.

**▶ UPDATE 2026-06-21T17:40 (DELEGATED GOVERNANCE SECURITY AUDIT — fixes committed):**
User mandate: "delegate, do not act directly; launch many opus agents (or an ultracode
workflow) to examine the governance API + scripts in depth (esp. skill→script coverage),
verify correct API usage, fix all shortcomings as-you-go incl. pre-existing, leave no hole;
update docs + memories + help screens; then push, then resume." Ran a 3-phase ultracode
`Workflow` (coverage → 10 disjoint find-and-fix spark agents → adversarial verify). First
run's fix phase was wiped by a transient server rate-limit (all 10 agents returned null →
0 changes); re-ran with a rate-limit-resilient pool (concurrency 4, staggered ramp,
retry-on-null backoff) — that run landed **24 fixes / 17 flags across 19 files**.
**VERIFIED BY ME (not blind-trusted):** `tsc --noEmit` = 0 errors; full suite **1867
passed / 0 failed**; adversarial-verify `verifyConcerns: []`; I read the 4 highest-risk
diffs myself (CRITICAL teams PUT RBAC, HIGH approve IDOR, HIGH teams POST sysowner-class,
HIGH webauthn enforceSystemOwner+sudo-binding) — all grounded, all strictly tightening,
all with WHY comments. **Committed `e54e2de4`** on `governance-rules`. Docs updated:
`docs/API-CHANGES.md` §13 (the authz/IDOR/sudo table) — R23 frozen-CLI rule confirmed
already present+correct in GOVERNANCE-RULES.md by the audit. Coverage finding (grounded):
skill→script coverage 100% clean (17/17 verbs hit real endpoints, correct methods);
gov-gates (element-management-service) audited clean (R9.13 / ~/agents confinement /
manager-block / no-IDOR all verified, 0 edits). **NEXT:** write the wikimem memory →
push `governance-rules` to fork → post findings to MANAGER #35 → resume pending.
Flagged-not-fixed (correct, out-of-scope): #37 `.cjs` 6 direct /api calls (gated tier-2,
proposal c94c60e9); `consumeOwnerSudoToken` DRY dup (canonical = shared lib + strict-reg).
**Audit follow-up FIXED `7f3878fc`:** the flagged kanban-config write-RBAC gap — verified
real (any MEMBER could rewrite a team's kanban column config incl. per-column move-permission
roles; only `checkTeamAccess` gated it) — closed in `services/teams-service.ts::setKanbanConfig`
mirroring the kanban/items POST gate (service layer → covers FULL + headless, no drift), +5
hermetic tests (full suite 1872 pass, tsc clean). Per-slice evidence:
`reports/governance-examination/` (gitignored). **SUPERSEDES** the 16:46 "HEAD 90c4ca52 /
32 commits" head — HEAD is now `7f3878fc` (fixes `e54e2de4` + docs `aac11266` + kanban
`7f3878fc`); still NO PR (user-gated).

**▶ UPDATE 2026-06-21T16:46 (USER AWAKE — pushed to fork on request):** User read the
open issues and asked to "ensure all fixes are done, then push to the github fork"
(**push only — explicitly NO PR yet**). Done: (1) closed **#45 item 4** — the 4th
decoupling verb (governance-status) was a confirm-question, not a hard gap; `whoami`
already wraps `GET /api/governance` (hasManager), so added an explicit `status` alias
(`90c4ca52`, additive/frozen-CLI-safe, aliases cmd_whoami — one source of truth).
(2) `yarn build` ✓ (52.6s, tsc clean). (3) **PUSHED** `governance-rules` →
`fork/governance-rules`: HEAD now **`90c4ca52`**, **32 commits**, 0 unpushed.
**SUPERSEDES every line below** that says "NOT pushed" / "28 commits" / "HEAD
6e1eeb57" — the branch IS pushed to the fork; NO PR opened (user-gated). The other 16
open fork issues remain gated / other-repo (MANAGER coordination, Haephestos,
governance-owner rule-text, AMP protocol) — out of this branch's scope.

**Mandate (user, 2026-06-20 ~23:00, going to sleep, explicit autonomous authorization):**
Keep working + coordinating with the janitor-plugin Claude and MANAGER-plugin Claude
via GitHub issues. Ready the ai-maestro API + plugin fleet for the final activation
test before the governance PR. Use the memory system. Do NOT stop until: (1) all
ai-maestro functions obey the governance rules, (2) all scripts align with the
plugins' skills/needs, (3) all install procedures are secure/updated/aligned. Launch
MULTIPLE ultracode workflows to verify the TRDD implementations + all pending tasks.
Run scenario tests with dev-browser; make the UI flawless + agents
controllable/configurable per governance. Improve what needs improving. Decide from
real tests, grounded in facts. PRIORITIZE SECURITY. Notify issues to the janitor via GitHub.

**Ground truth (verified 2026-06-20 23:15):**
- Branch `governance-rules`, clean, `fork/governance-rules` in sync. HEAD `6e1eeb57`.
- Governance constitution = `docs/GOVERNANCE-RULES.md` (R1–R40, 1401 lines). **No PRRD** (this project predates the PRRD convention; GOVERNANCE-RULES.md IS the rule source).
- `design/tasks/`: 20 TRDDs (8 `status: not-started`, 1 completed, 1 superseded, 10 no-status/older-format). `design/proposals/`: 4 — ALL tier-2, ALL security/alignment. `design/archived/`: 4. (`design/requirements`, `design/refused` DO NOT EXIST — an earlier `64/64` count was a glob artifact.)
- The 4 proposals (the security spine): (a) AID PoP nonce-bound vs timestamp-window; (b) route CLI plugin/skill/local-message mutations through server API (decoupling); (c) bind sudo tokens to op+subject, authenticate-before-consume; (d) script SSOT + code-signing readiness, dedupe AMP tree, route hook through intermediary.
- Open fork issues (16): #45 decoupling CLI verbs, #44 plugin publish→CPV canonical, #43 kanban DONE, #42 core handshake blocked, #41 webdesign role conformance, #40 kanban pillar (CLI half DONE this session), #39 assistant-role plugin, #37 frozen-CLI-decoupling+memory rule, #35 MANAGER↔ai-maestro sync, #34 wire memory recall into run loop, #33 R22 self-ID, #32 plugins write state outside workdir, #27 AMP approval messages, #5/#4/#3 Haephestos.
- Server UP (`/api/sessions` → 401 = AID-auth-gated, running). 27 scenarios. `dev-browser` CLI present.

**SCOPE BOUNDARY (load-bearing):** ai-maestro (THIS repo) = fix directly. The plugin
fleet (ai-maestro-plugin, 8 role-plugins, janitor, MANAGER, CPV, …) = OTHER repos →
**file/Update GitHub issues, NEVER edit their source** (cross-project rule). Live
AID-authed kanban round-trip = agent-only (owner session gets 401) — coordinate, can't do solo.

**NEXT ACTION (current — see the detailed `## NEXT ACTION` at the bottom):**
Phase A (verify) + B (synthesize) + E (MANAGER coordination #35) DONE. **8 fixes LANDED
+ committed on `governance-rules`, NOT pushed; full suite 1866/0:** `a11d1bfb`
sessions-browser auth+traversal, `d53b03d9` ChangeFolder ~/agents confine, `5512e9cb`
kanban TRDD-v2 field-drop, `41697ca5` #45 teams CLI verbs, `32816842` #45 presence verb,
`98cdd3bd` **#5 ChangeTitle G17 R9.13**, `66168dc1` **#3 server.mjs cookie deep-validate
(security)**, `76fb1684` **#6 registerAgent R9.13 roleMissing**. ✅ COND-1 GOVERNANCE
COMPLETE (all 4 identified gaps fixed: sessions-browser auth, ChangeFolder confine,
ChangeTitle R9.13, registerAgent R9.13). ✅ **BRANCH BUILDS CLEAN — `yarn build` ✓**
(`2de768a5` fixed a PRE-EXISTING build-blocker: a stale eslint-disable for the now-
unloaded `@typescript-eslint/no-var-requires` in lib/portfolio-*.ts — unrelated to the
campaign, but it blocked the PR; tsc+vitest stayed green so it was invisible without
`yarn build`). ✅ **INDEPENDENT VERIFICATION COMPLETE (ultracode workflow, 8 skeptic
agents — one per fix — per the "launch ultracode workflows to verify" mandate):** 7
CONFIRMED (6 NONE + 1 NIT) + 1 MAJOR. The MAJOR was on #5 ChangeTitle G17 — the first
fix covered only 2 of G17's 4 zero-active exits; the `>1` and MISMATCH reinstall-fail
exits could still leave a titled agent role-less → FIXED `99a79ba0` (one unconditional
post-block re-scan covers all 4 exits) + re-verified. The NIT (#3 `.mjs` cookie
extractor diverged from the canonical one on a leading-whitespace cookie,
false-negative-only/unreachable) → FIXED `c798768e` for byte-for-byte parity. **ALL 8
FIXES NOW VERIFIED-CLEAN.** 28 commits on `governance-rules`, NOT pushed; `yarn build`
✓ (49.71s), full suite **1867/0**, tsc 0. Per-fix verdicts in
`reports/verify-governance-fixes/`. ✅ SECURITY-SPINE CROSS-CHECKED (4 tier-2
proposals all valid + pending MANAGER approval; #a6d93b9c is highest-impact). ✅ COND-3
GROUNDED (CLI drift audit: 20/63 deployed CLIs lag the repo — incl. aid-init SH-MAJOR-04,
amp-send MF-023, #45 verbs → `reports/cli-deployment-audit/`; FIX = USER runs
`install-messaging.sh -y`, agent barred since it writes outside the project tree). ✅ LOCAL
wikimem repaired (3 pages schema-migrated; ~60 backlog drains via the heartbeat repair
cadence). NEXT — all remaining items need the USER or are gated: Phase D scenarios
(dev-browser UI — risky unattended: live-server restart + real-agent spawning + quota),
#3b bearer-downstream (now SPECCED → `TRDD-f1d89143`, backburner; implementation
security-gated on review), #37 decoupling (gated on MANAGER #35), the user's version
bump + push approval. **The autonomous-SAFE campaign work is substantially COMPLETE +
independently verified; the branch is PR-ready modulo the version bump.**

**Load-bearing facts / gotchas:**
- Every GitHub write self-identifies (R22): `_Posted by the Claude developing **ai-maestro** (via the shared @Emasoft gh auth)._`
- Never `git add -A` — stage by name. Commit fixes with WHY + `TRDD-903b7a20`.
- Memory edits in MAIN context (store outside repo; subagents can't reach it).
- Workflow fix-agents: `isolation: worktree` + explicit write-scope constraint (project root + /tmp only).
- Reports → gitignored `reports/`. Service `[janitor-heartbeat]` markers between phases.

**Durable artifacts to read before acting:**
- `docs/GOVERNANCE-RULES.md` (R1–R40), `design/proposals/*.md` (the 4 security proposals).
- Memory: `project_aid_security_plan`, `governance-r26-r40-security-model`, `project-governance-rules-pr` (LOCAL), fleet hubs (USER).
- `reports/overnight-verify/` (this campaign's findings, once Phase A lands).

## Plan

- **Phase A** — read-only verification ultracode sweep (governance / scripts / installs / TRDDs) → findings reports.
- **Phase B** — synthesize: prioritized fix list (security first); split ai-maestro-fixable vs plugin-fleet.
- **Phase C** — implement ai-maestro fixes (worktree-isolated agents), each build+test verified, committed.
- **Phase D** — scenario tests via dev-browser (UI flawless + agent controllability/configurability per governance).
- **Phase E** — file/update GitHub issues for plugin-fleet items + notify the janitor.

## Progress log

- 2026-06-20T23:15 — TRDD created. Ground truth established. Launching Phase A.
- 2026-06-20T23:20 — Phase A attempt 1 (workflow wouwfvhf7, 10 finders fanned out at once) FAILED: all 10 hit the transient server rate-limit instantly ("not your usage limit"), ~386s throttle, zero findings. LESSON: never launch the full fan-out at once — the corpus-distillation rule's exact trap. RL cleared ~23:26.
- 2026-06-20T23:27 — Phase A attempt 2 (workflow w655g51l5) relaunched RESILIENT: hand-rolled pool, concurrency 3, ramped spawn 15s, exponential backoff that re-enqueues on rate-limit, schemaless agents writing reports/overnight-verify/<dim>.{md,findings.json}. Only 3 agents hit the API at once. Running in background.
- **`/go-on-yourself` directive folded in (2026-06-20 ~23:18): DO NOT PUSH (commit only, await approval); TRDD per change; SERENA for symbol edits; update docs/readme/help per change; TDD; no bloat / modularize / reuse; prefer integrating alternatives over deleting; nothing outside project + /tmp; never relax security or quality gates.**
- 2026-06-21T00:10 — Phase A COMPLETE (w655g51l5): the resilient pool rode the throttle, all 10 dims produced findings → `reports/overnight-verify/`. ~93 findings, ~10 hot. Biggest hot clusters: scripts-skill-align (4), gov-element-mgmt (2), trdd-classify-pending (2), + gov-auth-sudo-aid (1), gov-decoupling (1). (3 transient RL failures were retried to success — the backoff worked.)
- 2026-06-21T03:05 — **BUILD-BLOCKER FIX LANDED — commit `2de768a5`, NOT pushed (TRDD-2ed177f4).** Deployability check: ran `yarn build` to verify the 8 campaign fixes are deployable → the build was ALREADY BROKEN (pre-existing; none of the 21 campaign commits touched the files): `next build`→eslint errored "Definition for rule '@typescript-eslint/no-var-requires' was not found" in lib/portfolio-check.ts + lib/portfolio-issue-guard.ts. The @typescript-eslint plugin is no longer loaded by next/core-web-vitals (dep drift) → every `eslint-disable` naming one of its rules is now a BUILD error. Empirically confirmed the modern `no-require-imports` is ALSO "not found" → removed the stale disables (the rule isn't active, so the lazy sync `require()` isn't flagged). **yarn build now SUCCEEDS (49.78s).** GUARDRAIL: tsc + vitest do NOT run `next lint`, so only `yarn build` catches this class — run it after dep updates / in CI. Branch is now deployable + PR-ready (modulo the user's version bump).
- 2026-06-21T02:50 — **VERIFICATION CYCLE COMPLETE + 2 follow-up fixes LANDED (NOT pushed).** Ran the mandated ultracode verification workflow (8 adversarial skeptic agents, ramped/rate-limit-resilient pool, one per fix) → 7 CONFIRMED (6 NONE + 1 NIT) + 1 MAJOR. MAJOR on #5 ChangeTitle G17: the first fix covered only 2 of 4 zero-active exits; the `>1` and MISMATCH reinstall-fail branches could still leave a titled agent role-less → FIXED `99a79ba0` (ONE unconditional post-block re-scan covers all 4 exits + a with-settings test) + re-verified (suite 1867/0). NIT on #3 .mjs cookie extractor (diverged from the canonical extractor on a leading-whitespace cookie, false-negative-only/unreachable) → FIXED `c798768e` (regex parity + 2 tests). All 8 fixes now verified-clean; `yarn build` re-confirmed ✓ (49.71s); tsc 0. Per-fix verdicts in `reports/verify-governance-fixes/`. Then captured 2 LOCAL wikimem notes per the memorize-nudge (R9.13 enforcement map → `element-management-pipelines.md`; full-mode .mjs cookie auth → `backend.md`).
- 2026-06-21T02:55 — **SECURITY-SPINE CROSS-CHECK (the 4 tier-2 proposals vs tonight's 8 fixes).** Grounded read of all 4 `design/proposals/`: #a6d93b9c (route agent-plugin/agent-skill/amp-send MUTATIONS through the API — closes 3 governance-bypass surfaces; HIGH, prio 2), #c94c60e9 (script SSOT + signing-readiness: dedupe the AMP byte-fork, route hook→CLI [== the gated #37/#35], collapse helpers; HIGH, prio 2), #bb344037 (sudo token bind-to-op+subject, auth-before-consume, clamp+quota; MEDIUM, prio 2), #15ff13ae (AID PoP nonce-bound vs timestamp-window; MEDIUM, prio 3). FINDING: NONE invalidated, NONE fully addressed by tonight's fixes; tonight's #45 CLI verbs are DIRECTIONALLY CONSISTENT with #a6d93b9c/#c94c60e9 (verbs added to the CANONICAL scripts via the CLI/API intermediary — no new bypass, no new fork). All 4 remain valid + pending MANAGER approval (tier-2). RECOMMENDATION (user/MANAGER): **#a6d93b9c is the highest-impact pending security work** (real governance bypasses on the 3 mutation surfaces); #45 already demonstrated the decoupling pattern it needs. (These stay PROPOSALS — implementing a tier-2 is gated on MANAGER approval, and the mandate says do-not-push/await-approval.)
- 2026-06-21T03:07 — **COND-3 GROUNDED (CLI deployment drift audit, read-only sha256 compare).** Compared the installer's full deploy set — top-level `scripts/*.sh` (its two globs) — against `~/.local/bin/`: **43 aligned, 17 STALE, 3 MISSING (20 drifted of 63).** The PROCEDURE (install-messaging.sh) is correct; the DEPLOYED ARTIFACTS lag because the repo scripts advanced (security + #45 work) without a redeploy. Security-critical stale: `aid-init.sh` (SH-MAJOR-04), `amp-send.sh` (MF-023); #45-verb stale: `aimaestro-teams.sh`, `agent-commands.sh`; +13 more (aid-helper/token, aimaestro-agent, amp-helper/inbox/init/read/register/reply, bump-version, ecosystem-config, remote-install, start-with-ssh). 3 never-deployed: build-jsonl-reader, migrate-r20-disk-layout, setup-tailscale. Evidence: `reports/cli-deployment-audit/20260621_030659+0200-cli-drift.md`. **USER ACTION (the one remaining cond-3 step): `cd ~/ai-maestro && ./install-messaging.sh -y`** — re-aligns all 20. The agent CANNOT run it: it writes to `~/.local/bin` (OUTSIDE the project tree, which the mandate forbids). So cond-3 is now grounded with exact evidence; alignment is a single user redeploy. (Chose a one-time grounded audit over building a permanent `--verify` tool — "write only what is strictly necessary": the drift is a one-shot redeploy fix, not an ongoing need that warrants new installer code.)
- 2026-06-21T02:55 — **GOVERNANCE FIX #6 LANDED — commit `76fb1684`, NOT pushed (TRDD-47effd69, R9.13). COND-1 GOVERNANCE NOW COMPLETE (4/4 gaps).** registerAgent's system-owner register-from-session path created a role-less agent via raw createAgent (bypassing the role-installing CreateAgent AIO); the wake-route R9.13 gate checks `agent.roleMissing` but registerAgent left it UNSET → role-less agent could wake (silent R9.13 violation). The grounding REFINED the original "install plugins" design: the created agent's workdir does NOT exist at register time (createAgent makes it on first wake), so plugin install is impossible there → the correct fix is to FLAG `roleMissing:true` (mirroring G17/PG04/corePluginMissing) so the EXISTING wake gate blocks it until a role is assigned. Scoped to the new-agent path (.catch-guarded so a flag failure can't orphan the agent id); link + cloud paths untouched. TDD 2 cases (RED-verified) + a bug autopsy (the fix broke an existing test because its updateAgent mock returned undefined not a Promise → fixed the MOCK to match production-async, not the code). tsc clean + **full suite 1866/0** (+2 tests). API-CHANGES §12.
- 2026-06-21T02:45 — **SECURITY FIX #3 LANDED — commit `66168dc1`, NOT pushed (TRDD-ba9d6df2).** server.mjs full-mode auth gate (the inline /api/internal/pty-sessions handler + the pre-handshake `wsHasCredential` for /term//status//v1/ws//companion-ws) did a PRESENCE-ONLY `aim_session` cookie regex → a forged cookie from a Tailscale peer/local process passed (real bypass past the IP filter; full-mode counterpart of a11d1bfb). FIX: new `lib/session-validate-server.mjs` (a .mjs server.mjs CAN import) reads the SHARED in-memory store `globalThis.__aiMaestroSessionsMap` (same Node process via app.prepare()) and validates sha256(token)+expiry, mirroring validateSession; wired into both gates; session-auth.ts UNTOUCHED. SCOPE (by design): cookie deep-validated; BEARER stays a non-consuming presence check — deep-validating aim_tk_ ONE-SHOT AID tokens at the pre-handshake gate would consume them before the real downstream consumer (a bug), so deep bearer validation is a documented DERIVED downstream follow-up. TDD RED→GREEN: tests/unit/session-validate-server.test.ts (6 cases incl. forged-token rejection). node --check clean (both .mjs) + tsc clean + **full suite 1864/0** (+1 file, +6 tests). API-CHANGES §11.
- 2026-06-21T02:30 — **GOVERNANCE FIX #5 LANDED — commit `98cdd3bd`, NOT pushed (TRDD-51ed3b0b, R9.13).** ChangeTitle G17 now enforces R9.13. G14 persists title BEFORE G16 installs the role-plugin; G16 only WARNs on install failure; the old G17 `else` reported "consistent (0 role-plugin(s))" → a titled-but-role-less agent (R9.13 violation, undetected, success=true). FIX: a G17 recovery closure (retry install once → if still 0, `roleMissing=true` + hibernate + `hibernate_role_missing` ledger, mirroring PG04; calls `installPluginLocally` DIRECTLY so PG04→ChangeTitle→G17 can't recurse). Scoped follow-up noted IN-CODE: consolidate G17+PG04 recovery into a shared helper after PG04 characterization tests. TDD RED→GREEN: new assistant-title case driving ChangeTitle WITHOUT `skipPluginSync` (the existing deep tests all skip-sync → WHY this gap was never caught) + a test-infra fix (the `getClientCapabilities` mock returned `{plugins}` but the code checks `caps.rolePlugins`). tsc clean + affected set 133/0 + **full unit suite 1858/0** (+1 new test). API-CHANGES §10.
- 2026-06-21T00:45 — **SECURITY FIX #1 LANDED — commit `a11d1bfb`, NOT pushed.** sessions-browser auth-bypass + path-traversal SSOT. Implemented TRDD-9e1e4b29 (presence-only `hasSessionCookie` let a forged `aim_session` read any agent's transcript → now validates via `hasValidSession`→`validateSession`; 401 on forged/absent; login round-trip verified, no legit-user lockout) + TRDD-5df6f7da (`confineToProjectsStore` triplication → single shared export; **DISCOVERED + fixed a headless-mode `?path=` traversal hole that had NO guard**). 9 Next routes + headless (8 gates + 3 confine) + service. Full loop honored: `tsc` clean + full unit suite **1851 passed / 0 failed** + docs (API-CHANGES §7) + both TRDDs → completed. Method note: did it in-main-tree (not parallel fix-agents) — security transparency + tonight's throttle + the concurrent finder reads made single-writer atomic edits the right call.
- **RESOLVED (`66168dc1`, TRDD-ba9d6df2): `server.mjs` `hasCredential()` (L609/L1036) presence-only `aim_session` → now deep-validated via new `lib/session-validate-server.mjs` reading the SHARED `globalThis.__aiMaestroSessionsMap` (.mjs can't import the TS validator, but shares the global). Bearer stays presence-check by design (one-shot AID tokens must not be consumed at the pre-handshake gate); deep bearer validation = documented downstream DERIVED follow-up.**
- 2026-06-21T01:50 — **FIX #4 LANDED — commit `41697ca5`, NOT pushed (TRDD-fb75c4d1, #45).** scripts-align: added FROZEN CLI verbs `aimaestro-teams.sh tasks <id>` (GET /api/teams/<id>/tasks) + `reassign-cos <id> <uuid> --password P` (POST chief-of-staff) — additive, mirroring cmd_add_agent/cmd_kanban_config; v1.1.0→v1.2.0. Verified: bash -n clean, --version/help/arg-validation correct, LIVE WIRING proven (`tasks <uuid>`→"HTTP 401 auth_required" = reached the real endpoint). Functional 200 round-trip is agent-only. The 3rd #45 verb `presence` (in aimaestro-agent.sh — delegates to agent-*.sh modules) DEFERRED. Deployed ~/.local/bin needs install-messaging.sh re-run (outside-project deploy, flagged).
- 2026-06-21T02:05 — **#45 COMPLETE — `presence` verb LANDED, commit `32816842`, NOT pushed.** Added `cmd_presence` to agent-commands.sh (mirroring cmd_show's `get_api_base`+`_build_auth_args`+`curl`) + dispatch/help/header in aimaestro-agent.sh. Verified: `bash -n` clean both files; direct `cmd_presence` invoke (sourcing the modules, bypassing main's `check_api_running` pre-gate) returns `auth_required` FROM `/api/users/me/presence` (wiring proven). Confirmed NOT a regression from `a11d1bfb` (`check_api_running` probes `/api/sessions`, which my sessions-browser-only fix never touched). **All 3 #45 frozen CLI verbs now done.**
- 2026-06-21T02:15 — **CONDITION 3 (install-security) GROUNDED WITH FACTS (read-only diff, no writes).** Deployed `~/.local/bin` vs repo `scripts/`: **5 of 6 checked DRIFTED.** Two are SECURITY-relevant: `aid-init.sh` (repo 249L vs deployed 197L — **SH-MAJOR-04 UUID-keyed-identity fix NOT deployed**) and `amp-send.sh` (same 829L but content differs — **likely MF-023 path-traversal fix NOT deployed**). Also `aimaestro-teams.sh`/`agent-commands.sh` deployed copies have 0 of tonight's #45 verbs. Only `aimaestro-hook.sh` IN SYNC. **→ USER ACTION REQUIRED: run `install-messaging.sh -y` to redeploy** (writes to ~/.local/bin = outside-project, so I cannot run it). NEXT-SESSION in-project follow-up: add an `install-messaging.sh --verify` drift-check mode (read-only, testable) + optional self-heal so deployed CLIs can't silently lag security fixes.
- 2026-06-21T01:30 — **Full unit suite re-run after all 3 fixes: 106 files, 1857 passed / 0 failed (2 pre-existing skips).** Zero regressions.
- 2026-06-21T01:35 — **PHASE E (coordination) — posted fleet-readiness status to MANAGER on issue #35** (https://github.com/Emasoft/ai-maestro/issues/35#issuecomment-4760203607). Reported: the 3 fixes (SHAs); answered the MANAGER's Q1/Q2 (sync state); flagged that fix #3 (`5512e9cb`) advances their **keystone #1** (parentTask/npt/eht/supersedes linkage now carried end-to-end → epic→child tree data model in place; attachments+due-dates+first-class `epic` type still open); verified-evidence for #37 decoupling (.cjs 6 direct /api calls, aimaestro-hook.sh ready, pending proposal c94c60e9); #45 verbs still missing; deployed-CLI drift (unconfirmed, will diff). Offered the MANAGER a choice: (a) extend Task model for rest of #1, (b) land #37 .cjs rewrite, (c) build #45 verbs. R22 self-ID applied.
- 2026-06-21T00:35 — **FIX #3 LANDED — commit `5512e9cb`, NOT pushed (TRDD-67f8b9bd).** Kanban TRDD-v2 field-drop (fix-queue #9). The Next.js POST tasks route validated the 8 TRDD-v2 fields but never spread them into createTeamTask — pure FULL-vs-headless drift (headless already forwarded them). Spread the 8 end-to-end fields (severity/effort/parentTask/npt/eht/supersedes/relevantRules/releaseVia) matching headless. TDD RED-then-GREEN: `tests/unit/api-team-tasks-trddv2-fields.test.ts` 2/2; tsc clean; docs API-CHANGES §9. Serves the kanban pillar (#40/#2). 6 further fields (reviewResult/supersededBy/implementationCommits/lastTestResult/publishedVersion/liveSince) accepted-but-not-carried in BOTH modes → uniform follow-up (not a drift).
- 2026-06-21T00:25 — **SECURITY FIX #2 LANDED — commit `d53b03d9`, NOT pushed (TRDD-35af6b13).** ChangeFolder `~/agents/` confinement (fix-queue #2). G01b gate (before the existsSync probe) rejects any workingDirectory outside `~/agents/`, mirroring CreateAgent G03-ENFORCE + DeleteAgent G09 — closes the workdir-write escape (the PATCH route already documented this as the intended-but-missing "Gate 3"). TDD: `tests/integration/change-folder-confinement.test.ts` 4/4 (real ChangeFolder, isSystemOwner ctx); `tsc` clean; docs API-CHANGES §8. Authority-gated → MEDIUM, but defense-in-depth on the load-bearing "every agent under ~/agents/" invariant.

## Phase B synthesis — confirmed fix-queue (2026-06-21T00:55; from reports/overnight-verify/, 98 findings/10 hot)
Each item below: CONFIRM against current code before fixing (workflow findings are LLM-judgment). Order = security → governance → scripts-align → kanban → decoupling.

**ai-maestro-fixable (Phase C), priority order:**
1. ✅ DONE a11d1bfb — TRDD-9e1e4b29 sessions-browser auth+traversal.
2. ✅ DONE d53b03d9 — ChangeFolder `~/agents/` confinement (TRDD-35af6b13, workdir-write escape).
3. ✅ DONE `66168dc1` (2026-06-21, TRDD-ba9d6df2) — SECURITY — `server.mjs hasCredential()` (L609/L1036) presence-only `aim_session` → cookie deep-validated via new `lib/session-validate-server.mjs` reading the shared globalThis Map. Bearer presence-check kept by design (one-shot AID consumption hazard); deep bearer validation = downstream DERIVED follow-up.
4. SECURITY (MEDIUM, deeper) — AID PoP replay (TRDD-15ff13ae, token reuse in 300s window); `POST /api/v1/federation/deliver` bypasses comm-graph+team-isolation.
5. ✅ DONE `98cdd3bd` (2026-06-21, TRDD-51ed3b0b) — GOV — ChangeTitle Gate14-before-Gate16: role-plugin install failure leaves title set + no role (R9.13). **VERIFIED + designed (2026-06-21):** G14 writes+verifies title; G16 (`element-management-service.ts:2724`) CATCHES install failure → WARN → continues; G17's final `else` (line 2805) reports "consistent" even for 0 role-plugins when a title requires one → ChangeTitle returns SUCCESS with a titled, role-less agent (R9.13 violation, undetected). FIX DESIGN: extract a shared helper `enforceRoleMissingHibernate(agentId, authContext, ops, tag)` from PG04's terminal recovery (lines 1168-1195: updateAgent roleMissing:true + hibernateAgent + `<tag>-hibernate-role-missing` ledger op — parameterize tag+source to PRESERVE PG04's exact `PG04:` log strings so existing tests pass); refactor PG04 to call it (tag='PG04'); at G17 detect `targetPluginName && activeRolePlugins.length === 0` → one direct `installPluginLocally(...).catch` reinstall → re-scan → if still 0 call the helper (tag='G17') + set a result flag (do NOT call ChangeTitle from G17 → infinite recursion). TDD: mock installPluginLocally to throw → assert roleMissing+hibernate. HIGH-blast-radius (ChangeTitle 23 gates) → do in fresh context, run FULL change-title/change-plugin suite + tsc. **DEFERRED tonight (compaction risk on the governance core).**
6. ✅ DONE `76fb1684` (2026-06-21, TRDD-47effd69 — ACTUAL fix: flag `roleMissing` [register-time plugin install is impossible, no workdir yet], NOT the "install plugins" design below) — GOV — `registerAgent` uses raw createAgent primitive, bypasses CreateAgent AIO (R21/R9.13/R17). `services/agents-core-service.ts:1048,1125-1135`. **INVESTIGATED (2026-06-21) — confirmed REAL:** the `body.sessionName && !body.id` path (line 1125, **system-owner-only**, the register-agent-from-session flow) creates a FULL local agent (program/model/workdir/session) via raw `createAgent`, so the new agent has NO role-plugin (R9.13) + NO core plugin (R17). NUANCE: registerAgent LINKS an existing tmux session (`linkSession`), so it canNOT naively re-route through the full CreateAgent AIO (which provisions a FRESH workdir/session). FIX DESIGN: after the raw `createAgent`, enforce R9.13/R17 in place — install the default role-plugin for the inferred title + the core `ai-maestro-plugin` (mirror CreateAgent's role/core gates; on install failure set roleMissing+hibernate like the new G17). TDD: register a new session-agent → assert it has a role-plugin + core plugin. DEFERRED — careful fix on the external-facing registration path; fresh context.
7. GOV — ChangeClient R18.4 partial-plugin-state on install-time failure.
8. ✅ DONE (FULL) — all 3 #45 frozen CLI verbs: teams `tasks` + `reassign-cos` (41697ca5) + agent `presence` (32816842), TRDD-fb75c4d1. Verified (bash -n + live-wiring-to-endpoint; functional round-trip agent-only). Deployed `~/.local/bin` copies need `install-messaging.sh` re-run (outside-project deploy step — flagged, not run).
9. ✅ DONE 5512e9cb — Kanban Next.js tasks route forwards the 8 end-to-end TRDD-v2 fields (TRDD-67f8b9bd; was FULL-vs-headless drift). REMAINDER: 6 fields (reviewResult/supersededBy/implementationCommits/lastTestResult/publishedVersion/liveSince) accepted-but-not-carried in BOTH modes — extend CreateTaskParams+createTeamTask+ghProject for those. Plus per-column move-permission inert (#2) still open.
10. CONTEXT-PARSER — TRDD-3339cc45 silent-drop regression re-armed.
11. DECOUPLING — create `scripts/aimaestro-hook.sh` (ai-maestro side) so the plugin's `ai-maestro-hook.cjs` can shim through it (#37). The .cjs rewrite itself is plugin-fleet.

**Deploy/note (NOT an in-project edit — flag for USER):** deployed `~/.local/bin` CLI is drifted/security-regressed (aid-init.sh SH-MAJOR-04 UUID-keyed-dir fix missing; helper divergence). Re-run `install-messaging.sh`. Consider adding installer hash/self-heal (in-project).

**Plugin-fleet (Phase E — GitHub issues, NEVER edit their repos):** `ai-maestro-hook.cjs` direct-/api rewrite (#37, after aimaestro-hook.sh lands); whether agent-plugin.sh/agent-skill.sh/amp-send.sh local-FS installs are intended (gov-auth-sudo-aid TRDD-a6d93b9c).

**Design-column (defer, multi-phase):** TRDD-a1019073 controlled-exec-env; TRDD-1ee4a3c1 portable agents; TRDD-c7a81642 boot auto-hibernate scan.

## NEXT ACTION
**DONE tonight (4 fixes, all committed on `governance-rules`, NOT pushed; full suite 1857/0):**
`a11d1bfb` sessions-browser auth+traversal · `d53b03d9` ChangeFolder ~/agents confine ·
`5512e9cb` kanban TRDD-v2 field-drop · `41697ca5` #45 teams CLI verbs. Phase A (verify) +
B (synthesize) + E (MANAGER coordination #35) complete.

**REMAINING (pick up in fresh context — designs/evidence captured above):**
- BOUNDED/mechanical: #45 `presence` verb (aimaestro-agent.sh modules); kanban 6-field remainder (extend CreateTaskParams+createTeamTask+ghProject); #2 kanban per-column move-permission (investigate the inert check).
- ✅ #5 ChangeTitle R9.13 DONE (`98cdd3bd`, TRDD-51ed3b0b). ✅ #3 server.mjs cookie deep-validate DONE (`66168dc1`, TRDD-ba9d6df2). ✅ #6 registerAgent R9.13 DONE (`76fb1684`, TRDD-47effd69 — flag roleMissing; the investigation showed register-time plugin install is impossible [no workdir], so the wake-gate flag is the correct enforcement). **COND-1 GOVERNANCE COMPLETE (4/4 identified gaps).**
- SECURITY MEDIUM (deeper): AID PoP replay (TRDD-15ff13ae); `/api/v1/federation/deliver` comm-graph bypass.
- DECOUPLING #37: .cjs→aimaestro-hook.sh rewrite — VERIFIED ready (intermediary has activity/notify/check-messages); gated behind pending proposal c94c60e9 (tier-2) — MANAGER asked on #35, await steer OR land it.
- Phase D: scenario tests via dev-browser (UI flawless + agent controllability) — via the run-scenario-test skill (forked agent).
- DEPLOY (USER action): re-run install-messaging.sh (deployed CLI drift: aid-init.sh SH-MAJOR-04 + the new teams verbs); add installer self-heal.
- #44 (plugin repo): core ai-maestro-plugin publish-pipeline → CPV canonical.

Recommend next: **Phase D scenarios** (dev-browser UI validation — explicitly user-requested; validates the governance/security fixes end-to-end), OR the lower-priority residuals (#3b bearer-downstream deep-validation, #37 decoupling [gated on MANAGER #35], install-messaging --verify drift mode). Service `[janitor-heartbeat]` markers between items.
