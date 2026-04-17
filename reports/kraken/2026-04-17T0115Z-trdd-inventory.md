# TRDD Inventory — design/tasks/ — 2026-04-17

> **Migration note:** Two TRDDs below (TRDD-1222f06a and TRDD-f79f6047) were originally scoped against the `scenarios-autorunner` plugin. That plugin is obsolete — its deliverables (scenario runner, improvement implementer, skills, hooks, scripts, rules) now live directly in the project under `.claude/` (project-scoped and git-tracked). The TRDDs are kept as historical design records; wherever they reference the plugin, read it as the project's `.claude/` scenario definitions.

**Generated:** 2026-04-17
**Source branch:** `fork/feature/team-governance` (materialized at head)
**Total TRDDs:** 5
**Total lines:** 2,765

**Status breakdown:**
- Not started: 1
- In progress / partial: 1 (TRDD-a58a02c4 — MAINTAINER shipped but spec still says "Not started")
- Experiment complete / superseded: 1 (TRDD-1222f06a)
- Ready-to-implement (design frozen, code pending): 2 (TRDD-d9a5cd03, TRDD-f79f6047)

---

## Inventory table

| UUID (first 8) | Title | Status line | Lines | Created | Referenced by commits | Stale? |
|----------------|-------|-------------|-------|---------|-----------------------|--------|
| 1222f06a | scenarios-autorunner rate-limit retry experiment | EXPERIMENT COMPLETE 2026-04-15 (disproven) | 539 | 2026-04-14 | 7 commits (2837d2b1 add, 7ebf1419 snapshot, 17238b45 revert, dbb8b5ad, 2c495ee3, a6c1019d, 4d6ea4b4, 28fc2d65) | NO — status line is accurate |
| 5eae0b65 | VPN-wide Global Human Chatroom | Not started | 414 | 2026-04-11 | 1 commit (1df99124 add only) | NO — consistent; no R21 yet in docs/GOVERNANCE-RULES.md |
| a58a02c4 | MAINTAINER governance title + webhook pipeline | Not started | 293 | 2026-04-10 | 10+ commits (561856bc add, ad53db45, 17727a66, 7dd472f7, 7604812c, 30a66b15, 4264c21b, 8b70e86a, ee77ac8f, 13847a30) | **YES — CRITICAL STALENESS: status says "Not started. Spec-only" but R19 is fully shipped in code + docs/GOVERNANCE-RULES.md** |
| d9a5cd03 | MAINTAINER PR Review Lifecycle (SCEN-018 v2) | Not started — awaiting user approval | 1,242 | 2026-04-15 | 5 commits (1f096b89 add, 14cfd8f8, 768e510f, e7cca8c4, dd095af1 rewrite SCEN-018) | **YES — PARTIAL: SCEN-018 v2 shipped (commit dd095af1) but TRDD still reads "awaiting approval"** |
| f79f6047 | scenarios-autorunner v2 with dev-browser integration | Not started — spec | 277 | 2026-04-14 | 6 commits (ec717337 add, 4d6ea4b4 rule 13, 252e06f8 helpers, 7c0c8a3f helpers PR#141, 8c5c27bd, 28fc2d65) | **YES — PARTIAL: Rule 8 DEV-BROWSER and Rule 13 AUTONOMOUS-PROTOCOL both shipped; helpers added. Remaining gap: scenarios themselves still list `mcp__chrome-devtools__*` in `required_tools` (see SCENARIOS_TESTS_RULES audit)** |

---

## Individual TRDD entries

### TRDD-1222f06a — scenarios-autorunner rate-limit retry experiment

- **Status:** `EXPERIMENT COMPLETE 2026-04-15` — explicitly marked as disproven and superseded by the 3-component cron architecture described in §9.
- **Path:** `design/tasks/TRDD-1222f06a-602a-4686-a6a7-f2e4428c673e-scenarios-autorunner-rate-limit-retry.md`
- **Size:** 539 lines
- **Created:** 2026-04-14
- **Referenced by commits:**
  - `2837d2b1` — initial add
  - `2c495ee3` — §2 Option B rewrite (4-component design)
  - `dbb8b5ad` — FileChanged experiment made mandatory
  - `7ebf1419` — experiment snapshot before revert
  - `17238b45` — revert: FileChanged+bot design disproven
  - `4d6ea4b4`, `28fc2d65` — Rule 13 AUTONOMOUS-PROTOCOL lifted findings into SCENARIOS_TESTS_RULES.md
  - `a6c1019d` — tombstone direct-API cleanup (related)
- **Summary:** Experiment to make overnight scenario batches self-healing under Anthropic Pro rate limits. Started 2026-04-14 with three candidate designs (outer wrapper, 4-component FileChanged+bot, claude --continue piped stdin). §9 (2026-04-15) empirically disproved Option B (FileChanged/bot) because the Claude Code process stays alive through rate limits — only the current turn ends. The proven architecture is 3 components: passive account switcher + durable `CronCreate` + idempotent state file. This architecture was lifted verbatim into `tests/scenarios/SCENARIOS_TESTS_RULES.md` Rule 13 (AUTONOMOUS-PROTOCOL) in commit 4d6ea4b4.
- **Staleness flag:** NONE — the status line explicitly marks it complete and §9 is the canonical record. The TRDD is retained as historical forensics; the solution has been integrated into the rules.

### TRDD-5eae0b65 — VPN-wide Global Human Chatroom

- **Status:** Not started
- **Path:** `design/tasks/TRDD-5eae0b65-117c-43d4-94da-a4293340c8c7-vpn-global-chatroom.md`
- **Size:** 414 lines
- **Created:** 2026-04-11
- **Referenced by commits:**
  - `1df99124` — initial add (only)
- **Summary:** Full design for a VPN-wide chatroom triggered when the user selects their own human card. Mesh-replicated append-only log at `~/.aimaestro/vpn-chat/messages.jsonl.gz`, infinite scrollback, per-host humans.json directory (`~/.aimaestro/humans.json`), WebSocket push at `/ws/vpn-chat`, mention/quote/shout/block features. Phase A-E roadmap. Proposes a new R21 governance rule block (Human Messaging, R21.1-R21.7). Estimated 10-14 days.
- **Staleness flag:** NONE. Cross-checked `docs/GOVERNANCE-RULES.md` — the file contains R19 and R20 only; there is no R21 section. No `~/.aimaestro/humans.json` code paths, no `/api/v1/mesh/chat*` routes, no `/ws/vpn-chat` handler. Status line matches reality.
- **Open questions in spec:** 6 items (mid-history join scrollback, rate limiting, offline mentions, moderation, compression format, message IDs ULID vs UUIDv4). All still open — nothing implemented.

### TRDD-a58a02c4 — MAINTAINER governance title + GitHub webhook pipeline

- **Status:** `Not started. Spec-only. Added to the backlog on 2026-04-10` **(STALE — see below)**
- **Path:** `design/tasks/TRDD-a58a02c4-721d-453b-99c9-95964a33f72f-maintainer-title.md`
- **Size:** 293 lines
- **Created:** 2026-04-10
- **Referenced by commits (10+):**
  - `561856bc` — initial spec add
  - `ad53db45` — feat: R19 MAINTAINER governance title — types, comm graph, secrets, gates
  - `17727a66` — docs(maintainer): plumb MAINTAINER role-plugin through enumerations
  - `7dd472f7` — refactor: MAINTAINER switches from webhook to gh polling (R19.4-R19.6)
  - `7604812c` — feat(ui): expose MAINTAINER title + githubRepo input (SCEN-018 P0-1..P0-5)
  - `30a66b15` — fix(api): pass authContext + githubRepo in CreateAgent callers (SCEN-018)
  - `4264c21b` — fix(R19-maintainer): gate 9a uniqueness + title resolver + route wiring
  - `8b70e86a` — tests: add SCEN-018..022 — MAINTAINER lifecycle + marketplace/plugin/scope/manager coverage
  - `ee77ac8f` — fix(governance): DeleteTeam must not strip standalone titles (includes MAINTAINER)
  - `13847a30` — feat(governance): add G14c role-plugin uninstall on title release
- **Summary:** Original R19 design introducing the MAINTAINER title. Spec described HMAC-SHA256-verified webhooks with `~/.aimaestro/maintainer-secrets.json`. Plan included new `ai-maestro-maintainer-agent` role-plugin, webhook listener on localhost port, HMAC verify endpoint `POST /api/maintainer/verify-signature`, ChangeTitle pipeline gates, comm graph update, and SCEN-018 + SCEN-019 scenarios.
- **Staleness flag:** **STALE — status line claims "Not started" but MAINTAINER has been fully shipped:**
  - `docs/GOVERNANCE-RULES.md` R19.1-R19.11 are all published (verified: `grep "^## R19" docs/GOVERNANCE-RULES.md` returns line 664).
  - `docs/GOVERNANCE-RULES.md` R3.1 has been updated to "Eight governance titles" including MAINTAINER (line 263).
  - `docs/GOVERNANCE-RULES.md` invariant #18 (MAINTAINER-repo-uniqueness) is present (line 765).
  - `lib/ecosystem-constants.ts` `ROLE_PLUGIN_MAINTAINER` shipped.
  - `ai-maestro-maintainer-agent` role-plugin exists in the `Emasoft/ai-maestro-plugins` marketplace (referenced at line 60 of GOVERNANCE-RULES.md).
  - SCEN-018, SCEN-019, SCEN-022 all exist (SCEN-018 was further rewritten to v2 by TRDD-d9a5cd03 commit dd095af1).
  - One significant design change vs the original TRDD: **the webhook + HMAC approach was scrapped in favour of `gh issue list` polling every 5 min** (commit `7dd472f7`, reflected in current R19.4-R19.6). This is a meaningful architectural change that the TRDD file does not reflect.
- **Suggested action:** mark the TRDD **Done (with pivot note)** — document that (a) the title is live as R19 and (b) R19.4-R19.6 replace the webhook design with `gh` polling. Keep the file as historical record.

### TRDD-d9a5cd03 — MAINTAINER PR Review Lifecycle (SCEN-018 v2)

- **Status:** `Not started — awaiting user approval of the design below`
- **Path:** `design/tasks/TRDD-d9a5cd03-b930-48ac-ae38-b77a6d36a7df-maintainer-pr-review-lifecycle.md`
- **Size:** 1,242 lines (largest TRDD)
- **Created:** 2026-04-15
- **Referenced by commits (5):**
  - `1f096b89` — initial add
  - `14cfd8f8` — refine SCEN-018 v2 — parallel two-path design
  - `768e510f` — SCEN-018 v2 add §12 comm-graph verification
  - `e7cca8c4` — SCEN-018 v2 §14 two-layer enforcement + §15 final decisions
  - `dd095af1` — **feat(scenarios): rewrite SCEN-018 to v2 — full MAINTAINER PR review lifecycle (#144)** ← this implements the TRDD
- **Summary:** Promotes MAINTAINER from "committer" to "PR reviewer" role. Introduces dual-path SCEN-018 v2 design: (a) CONTRIBUTOR (AUTONOMOUS agent) opens bug issue + contribution proposal PR, (b) MAINTAINER alpha uses the direct `maintainer-fix` path, (c) MAINTAINER beta uses the new `maintainer-review` skill (review PR → post comments → request changes on round 1 due to seeded flaw → re-review → approve → merge → release). MANAGER monitors both and intervenes if an agent slacks. §14 articulates the "two-layer enforcement" model (GitHub branch rulesets are for human contributors only; agent governance enforced via role-plugin persona + MANAGER AMP oversight). §15 finalizes 7 design decisions. §16 amendment notes R9.13 makes the role-plugin mandatory for AUTONOMOUS contributor.
- **Staleness flag:** **PARTIAL STALE.** The TRDD still says "awaiting user approval" but commit `dd095af1` already ships the SCEN-018 v2 rewrite. Verified: `tests/scenarios/SCEN-018_maintainer-lifecycle.scen.md` exists at version `"2.0"` with the dual-path design described in the TRDD. The `ai-maestro-maintainer-agent` v2 plugin work (new `maintainer-review` skill, branch ruleset enforcement logic) is referenced in the plugin repo but this main repo only holds the scenario + supporting fixtures.
- **Suggested action:** update the TRDD's Status to **"In progress — scenario file shipped, plugin v2 rewrite ongoing upstream"** OR close to **"Done for ai-maestro repo; plugin v2.0.0 is tracked in `Emasoft/ai-maestro-maintainer-agent`"**.

### TRDD-f79f6047 — scenarios-autorunner v2 with dev-browser integration

- **Status:** `Not started — spec for plugin rewrite after the 2026-04-14 overnight batch`
- **Path:** `design/tasks/TRDD-f79f6047-d8f1-43ac-8356-d071f5d5e8c9-scenarios-autorunner-v2-dev-browser.md`
- **Size:** 277 lines
- **Created:** 2026-04-14
- **Referenced by commits (6):**
  - `ec717337` — initial add
  - `4d6ea4b4` — docs(scenarios): switch to dev-browser + autonomous-protocol Rule 13
  - `252e06f8` — feat(scenarios): add aim-helpers.sh dev-browser helpers
  - `7c0c8a3f` — feat(scenarios): dev-browser AIM helpers library for scenarios-autorunner v2 (#141)
  - `8c5c27bd` — docs(scenarios): trim Rule 8 + scenario-runner — defer dev-browser API to loaded skill
  - `28fc2d65` — docs(scenarios): Rule 13 AUTONOMOUS-PROTOCOL + phase separation cross-refs
- **Summary:** Rewrite plan for the `scenarios-autorunner` plugin addressing 5 architectural flaws observed in the 2026-04-14 overnight batch: (1) chrome-fork explosion (45 orphan MCP processes, ~4 GB), (2) browser extension fragility, (3) Phase 0/CLEANUP redundancy across forks, (4) no rate-limit self-healing, (5) no screenshot provenance. Proposed solution: adopt `SawyerHood/dev-browser` as the browser backend — one persistent Chromium, QuickJS WASM sandbox, Playwright-based, no extension dependency. §4.5 supersedes TRDD-1222f06a's Option B with the 3-component cron architecture. §4.6 enforces the new screenshot convention. §9a bans direct API cleanup (Rule 6 applies to plugin scripts too).
- **Staleness flag:** **PARTIAL STALE.** Significant portions are shipped in the ai-maestro project repo:
  - Rule 8 DEV-BROWSER is the canonical Rule 8 in `SCENARIOS_TESTS_RULES.md` (line 185).
  - Rule 13 AUTONOMOUS-PROTOCOL is the canonical Rule 13 (line 674+).
  - `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` exists.
  - BUT scenarios still use `mcp__chrome-devtools__*` in `required_tools` (verified in SCEN-001, SCEN-014, SCEN-018, SCEN-024). This is a backward-compat / migration debt explicitly flagged in TRDD §4.3 Open Question 5: "Do we rewrite them or introduce a browser_stack field?"
  - The upstream `scenarios-autorunner` plugin has been retired — its deliverables were absorbed into the project's `.claude/` scenario definitions (agents, skills, scripts, rules, all project-scoped and git-tracked).
- **Suggested action:** update TRDD status to **"In progress — rules + helpers shipped; scenario `required_tools` migration + plugin v2.0.0 pending"** and add a section summarizing what landed vs what remains.

---

## Stale TRDDs — cleanup queue

| # | TRDD | Current status | Proposed action | Reason |
|---|------|----------------|-----------------|--------|
| 1 | TRDD-a58a02c4 (MAINTAINER) | "Not started. Spec-only" | **Update to "Done (with pivot)"** and add a 5-line "What actually shipped" section pointing to R19.1-R19.11 in GOVERNANCE-RULES.md and noting the webhook→gh-polling pivot (commit 7dd472f7). | Status has been false since 2026-04-10 — MAINTAINER fully shipped in ~10 commits. |
| 2 | TRDD-d9a5cd03 (SCEN-018 v2) | "Not started — awaiting user approval" | **Update to "In progress — scenario shipped; plugin v2 upstream"** | SCEN-018 v2 already landed as commit dd095af1 (2026-04-15); TRDD was updated with §14, §15, §16 but the top-line status wasn't bumped. |
| 3 | TRDD-f79f6047 (scenarios-autorunner v2) | "Not started — spec" | **Update to "In progress — rules + helpers shipped; scenario migration + plugin v2 pending"** | Rule 8, Rule 13, and `aim-helpers.sh` are already in place; the scenarios' `required_tools` migration + plugin v2.0.0 release remain. |
| 4 | TRDD-1222f06a (rate-limit experiment) | "EXPERIMENT COMPLETE 2026-04-15" (accurate) | **No change.** Keep as historical forensics. | Status is accurate. Kept intentionally as the record of the 4-component design that was empirically disproven. |
| 5 | TRDD-5eae0b65 (VPN chatroom) | "Not started" (accurate) | **No change.** | Nothing implemented; accurately reflects reality. |

---

## Cross-reference integrity checks

- `design/tasks/` directory: **exists and is git-tracked** on `fork/feature/team-governance`. All 5 TRDD files are present with the required header (ID, Filename, Tracked in).
- `docs/GOVERNANCE-RULES.md` R19 block: **verified present** at line 664 (R19.1 through R19.11 + invariant #18 at line 765).
- `docs/GOVERNANCE-RULES.md` R21 (VPN chatroom proposal): **verified absent** — only R20 exists as the top-numbered section.
- `tests/scenarios/NEXT_SCEN_NUMBER`: contains `24`, matching the 22 existing scenarios (SCEN-001..022) + SCEN-023 (R17 audit) + SCEN-024 (DeleteTeam revert COS). SCEN-017 is NOT unused (it has a file: `SCEN-017_r17-ui-disable-protection.scen.md`), contradicting a comment in the CLAUDE.md which says "SCEN-017 unused" — this is a separate CLAUDE.md inaccuracy, not a TRDD issue.
