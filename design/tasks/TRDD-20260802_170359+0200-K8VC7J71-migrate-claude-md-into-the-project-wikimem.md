---
trdd-id: K8VC7J71
title: Migrate CLAUDE.md into the project wikimem — topic pages wikipedia-style, leave only build and overview
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-02T17:03:59+0200
updated: 2026-08-02T17:03:59+0200
current-owner: ai-maestro
created-by: user
assignee: ai-maestro
task-type: docs
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-02T17:03:59+0200
severity: high
effort: large
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [wikimem, claude-md, context-cost, docs]
---

# Migrate CLAUDE.md into the project wikimem — topic pages wikipedia-style, leave only build and overview

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

**USER MANDATE, 2026-08-02T17:0x, verbatim:**

> *"stop using the local claude.md to store informations that should go in the wikimem. you bloath
> the claude.md and also invalidate the cache every time you change the file. use the wikimem.
> migrate the info from the claude.md to the wikimem. create topic pages project scoped and
> published globally for each topic and subtopic, wikipedia style. leave in the claude.md only the
> basic instructions to build, install, test, branch, push, etc. the project, and a general
> overview."*

**Born approved** — a USER mandate at the tier its own floor names. No approval request was sent.

**MEASURED 2026-08-02 (re-derive; do not trust these later):**
- `CLAUDE.md` — **2186 lines, 138 256 bytes, 27 top-level `##` sections.**
- Project wikimem `.claude/project/memory/` — **29 files** already, actively used.
- **There is NO `<project>-overview.md`**: `memgrep overview .claude/project/memory` errors with
  *"Seed one with /janitor-memory-bootstrap"*. So the wiki has pages and no front door.
- `memgrep 0.1.0` at `~/.cargo/bin/memgrep`.

**THE COST ARGUMENT, which is the USER's and is exact.** `CLAUDE.md` is injected into the cached
prefix of EVERY turn of EVERY session in this project, so its size is paid as
`bytes × turns × sessions`. And an EDIT is worse than the size: it invalidates the cached prefix, so
the next request re-writes the whole prompt at 1.25×. I edited it twice today (both edits correct in
CONTENT — two false "not true yet" claims), which is exactly the pattern the USER is stopping: a
file whose content is knowledge-shaped will keep attracting knowledge-shaped edits.

**THE TARGET SHAPE:**
- `CLAUDE.md` keeps ONLY: a general project overview, and the operational instructions —
  build / install / test / branch / push / version-bump / server modes / the Node-22 wrapper /
  the "a restart does not rebuild" warning. Everything a contributor needs to OPERATE the repo.
- Everything else becomes **PROJECT-scope wikimem pages** under `.claude/project/memory/`
  (git-tracked and PUSHED — which is what "published globally" means here), one page per topic AND
  per subtopic, wikipedia-style: hub pages carrying `globs:`, aspect pages that radiate an
  `## Applies to` list, component pages that carry `## Governed by` back up. **The LINK LAW: every
  link is bidirectional** — wire both ends in the same edit.
- A `<project>-overview.md` front door must exist so `memgrep overview` works, and `MEMORY.md`
  keeps its ONE line pointing at it.

**THE SCOPE GATE (per `memory-scope-routing.md`) — apply per page, not once.** PROJECT memory is
PUSHED, so ask of every page: *"would this be TRUE and USEFUL for a stranger who clones this repo on
a DIFFERENT machine?"* Most of CLAUDE.md passes (architecture, governance, protocols). The parts
that do NOT — anything naming `/Users/emanuelesabetta/…`, this host's install state, "on THIS
machine" — go LOCAL (`~/.claude/projects/<slug>/memory/`), cross-linked. **UNSURE → LOCAL.**

**NEXT ACTION (in order):**
1. Seed the front door (`/janitor-memory-bootstrap`, or author `<project>-overview.md` by hand) —
   without it `memgrep overview` errors and the wiki has no entry point.
2. Inventory the 27 sections → a topic/subtopic map, deciding for each: KEEP in CLAUDE.md (build/
   operate), MIGRATE to a PROJECT page, MIGRATE to LOCAL, or FOLD INTO an existing page (29 already
   exist — check before minting a duplicate).
3. Migrate in BATCHES, parallel sub-agents, ≤5 sections each. **Author via memgrep write verbs**
   (`new-page`/`add-atom`/`add-lesson`), never hand-authored wikimem markdown, then
   `memgrep validate` + `memgrep lint` after every edit.
4. Rewrite `CLAUDE.md` LAST, once every destination page exists — so no interval leaves the
   knowledge in neither place.

**DO NOT:**
- Delete a section from `CLAUDE.md` before its destination page exists and validates. The migration
  must never pass through a state where the knowledge is gone from both.
- Summarize. This is a MOVE, not a précis: the reason CLAUDE.md is 138 KB is that the content is
  dense and load-bearing, and a lossy migration destroys what the file was for.
- Mint a page for a topic one of the existing 29 already owns — fold into it and link.
- Put a machine-private path into a PROJECT page (it is pushed to GitHub).

## ⚠ REFINED BY THE USER, 2026-08-02 — the target shape of CLAUDE.md is now EXACT

The original directive said *"leave in the claude.md only the basic instructions to build, install,
test, branch, push, etc. the project, and a general overview."* The USER then narrowed it to a
**five-item contract**, verbatim:

> - concise description of the project
> - github repo url (and url of all connected projects, i.e. plugins, marketplaces, etc.)
> - the basic build/compile/test/publish instructions
> - the project map generated by the janitor
> - the index of all the wikimem pages ordered by topic and only the project-scoped ones

**This SUPERSEDES the KEEP column of the destination table below** — that column was my inference
from the first directive and is now over-broad. Consequences, each a change from what the table
says:

| item | where it comes from | what changes |
|---|---|---|
| 1. description | §1 Project Overview | trimmed to a paragraph; the version/phase list migrates |
| 2. **repo URLs** | §18 GitHub Repos Architecture | **only the URL list stays** — the 3-repo *architecture* prose and the 8 role-plugin repo table migrate to `github-repos-architecture` |
| 3. build/compile/test/publish | §2, §6, §7, §22, §23 (commands only) | Node-22 wrapper, `bump-version.sh`, the pre-PR checklist, `yarn dev\|start\|headless`, `yarn test` |
| 4. **project map** | **NEW — not a CLAUDE.md section today** | `~/.claude/plugins/cache/…/ai-maestro-janitor/<v>/scripts/repomap_generate.py` writes a FENCED block into CLAUDE.md and has `--check` / `--stdout` / `--remove`. Skills `janitor-auto-repomap-on\|off` keep it fresh. This REPLACES §28 *Key Files to Understand* — a hand-maintained file list is a snapshot that goes stale silently; a generated one cannot. |
| 5. **wikimem index by topic** | **NEW** | replaces §24 *Documentation References*. **PROJECT-scoped pages only** — LOCAL and USER pages are machine-private/global and must not be advertised in a pushed file. |

Everything not in those five items migrates. The KEEP verdicts below for §12 (runtime install tree),
§21 (env vars), §8 (release & marketing) and §11 (file structure) are therefore **cancelled** — they
all migrate in full.

## Findings the migration turned up (fix during the final pass, not silently in transit)

**0. The `memory-scope-leak` detector's 3 PROJECT-page findings are all FALSE POSITIVES** — checked
each match by hand rather than acting on the count, because the prescribed remedy is *demote to
LOCAL*, i.e. it would have moved correct public content out of the shared store:

| page | matched | why it is not a leak |
|---|---|---|
| `custom-server-and-websocket-pty` | `agentId@hostId` | the product's own multi-host addressing FORMAT (why `@` and `.` are in the tmux session-name charset) — a placeholder, not a host |
| `agent-title-role-persona` | `Emasoft` | the PUBLIC GitHub org that owns the marketplace. The USER's refinement above *requires* those URLs in CLAUDE.md, so this is the opposite of private |
| `agent-launch-preconditions` | `settings.local`, `hostname` | a product FILENAME (`settings.local.json`) and the bare English word |

`grep -rln "/Users/emanuelesabetta" .claude/project/memory/` returns **nothing** — no PROJECT page
carries an absolute home path. The detector matches an `@`-shaped token and the substring `.local`,
neither of which distinguishes a host from a format string or a filename.



**1. CLAUDE.md contradicts itself about the WebSocket lifecycle.** `### 3. WebSocket Lifecycle vs
React Lifecycle` (L1783 + L1786) asserts *"Empty deps with tab architecture — WebSocket persists
across visibility changes"* and *"WebSocket connections are no longer recreated on agent switch"*.
§10.4 (UI-CRIT-01, corrected 2026-05-04) refutes exactly that: only the active agent is mounted, so
a switch UNMOUNTS `TerminalView`, runs its cleanup, and CLOSES the socket. The surviving text is the
**never-shipped** mount-all design — the same drift UI-CRIT-01 was filed for, left behind in a
second place when the first was corrected. Verified live at `CLAUDE.md:1773-1786`; W1 preserved it
verbatim and flagged it rather than silently correcting, which is the right call in transit — a
worker that "fixes" its source is indistinguishable from one that invents. **Resolution:** correct
it ON `custom-server-and-websocket-pty`, naming the correction the way §10.4 names its own, so the
false claim does not simply get a new home. A doc asserting a behaviour the code does not have is
worse than one that omits it, because the reader stops looking.

## The destination table — ALL 28 sections, decided before any deletion

Line numbers are from `CLAUDE.md` @ `a4529af4`; re-derive with `grep -n '^## ' CLAUDE.md`.

**The 29 existing pages are SYMPTOM-indexed lessons** (component/aspect, `description:` = the
symptom a future session will search with). CLAUDE.md's content is a different KIND — reference
architecture, "how this is built". So most rows mint NEW `reference`-type pages; only a few fold
into an existing lesson page. Both kinds live in the same store and cross-link.

| # | § (line) | verdict | destination |
|---|---|---|---|
| 1 | Project Overview (5) | **KEEP** | the "general overview" the USER asked to keep |
| 2 | Development Commands (15) | **KEEP** | build/install/test — incl. the Node-22 wrapper and *"a restart does not rebuild"*. The pillar-CLI exit-code trichotomy folds into [[pillar-tooling-scale-and-index]] |
| 3 | Code-analysis tooling (129) | MIGRATE | `code-analysis-tooling` (tldr/fastedit/distill + the cross-client skill variants) |
| 4 | Governance rules IND+DEP (162) | MIGRATE | `governance-rules-layering` — links [[three-pillars-conformance-spec]], [[governance-enforcement-ratchet]] |
| 5 | Agent-workdir invariants (224) | MIGRATE | `agent-workdir-invariants` — links [[agent-launch-preconditions]] |
| 6 | Version Management (264) | **KEEP** | `bump-version.sh` is release mechanics |
| 7 | Pre-PR Checklist (288) | **KEEP** | branch/push |
| 8 | Release & Marketing (303) | SPLIT | PR protocol → KEEP; the X/Medium templates + `marketing/` → `release-and-marketing` |
| 9 | Agent Terminology TITLE/ROLE/PERSONA (358) | MIGRATE | `agent-title-role-persona` — the core vocabulary; links [[three-role-initial-test-not-a-title-restrict]] |
| 10 | Architecture: Critical Design Patterns (388) | MIGRATE ×N | **370 lines, 10 numbered patterns** → a `server-architecture` HUB + component pages: `custom-server-and-websocket-pty`, `agent-first-architecture`, `single-active-agent-rendering`, `session-control-5-state-model`, `manager-gated-team-governance`, `team-meeting-and-kanban` |
| 11 | File Structure Conventions (760) | MIGRATE | `repo-file-structure` |
| 12 | Runtime Install Tree (847) | MIGRATE | `runtime-install-tree` — **scope-check every path**: the tree itself is machine-AGNOSTIC (`~/.aimaestro`, `~/agents`), so PROJECT; any `/Users/…` example is genericized |
| 13 | Agent Messaging Protocol (999) | MIGRATE ×N | `amp-messaging` HUB + `amp-communication-graph` (the adjacency matrix + its 3 enforcement layers) |
| 14 | Plugin Abstraction Principle (1199) | MIGRATE | `plugin-abstraction-and-script-layer` — the decoupling invariant; links [[agent-control-monitor-api]], [[agent-claims-the-api-was-never-delivered]] |
| 15 | Plugin Architecture two worlds (1292) | MIGRATE ×N | `plugin-architecture` HUB + `role-plugins`, `editing-role-plugins` — folds into [[marketplace-manifest-format]], [[marketplace-plugin-registration]] |
| 16 | Groups Feature (1513) | MIGRATE | `groups-feature` — links [[team-creation]] |
| 17 | Ecosystem Constants (1551) | MIGRATE | `ecosystem-constants` |
| 18 | GitHub Repos Architecture (1571) | MIGRATE | `github-repos-architecture` |
| 19 | Critical Implementation Details (1616) | MIGRATE | `terminal-rendering-and-pty` (xterm config, `convertEol`, alt-screen) |
| 20 | Common Gotchas (1724) | MIGRATE | fold per-gotcha into the pages that own them; the API-nesting one → `agent-first-architecture` |
| 21 | Environment Variables (1813) | SPLIT | the `.example.env` pointer → KEEP; the **phantom-knob** lesson → `env-vars-documented-but-unread`, linked from [[env-var-security-delete-not-gate]] |
| 22 | Server Modes (1862) | **KEEP** | `yarn dev` / `yarn headless` is how you RUN it |
| 23 | Testing the Application (1894) | SPLIT | the commands → KEEP; AMP test suites + the 24 UI scenarios → `scenario-and-amp-testing`, linked from [[token-optimization]] |
| 24 | Documentation References (2037) | **KEEP** | a short pointer list, already link-only |
| 25 | Cross-Client Conversion (2049) | MIGRATE | `cross-client-conversion` (acplugin/crucible/Hookbridge, the model map, the Universal IR) |
| 26 | Roadmap Context (2119) | MIGRATE | fold into the overview page |
| 27 | What NOT to Do (2130) | MIGRATE | fold each bullet into the page that owns its subject — a free-floating don't-list is unfindable by symptom |
| 28 | Key Files to Understand (2144) | MIGRATE | fold into `server-architecture` HUB's `globs:` + reading order |

**Network security** (inside §10) → `network-security-tailscale-bind` — it is a distinct subject
(the `::` bind + `isAllowedSource`, the trusted-peer header, the console-presence census) and is
already cited by [[governance-password-invalidation]].

## Problem

`CLAUDE.md` has become the project's knowledge base. It is 2186 lines in the file that is loaded
into every turn of every session, so the whole corpus is re-billed continuously, and every
correction to it invalidates the prompt cache. The wikimem exists for exactly this content and is
already in use (29 pages), but it has no front door and CLAUDE.md kept growing instead.

## Proposed fix

The target shape above: CLAUDE.md becomes an operating manual with an overview; the knowledge moves
into a navigable PROJECT-scope wiki with a working entry point.

## Verification

- `memgrep overview .claude/project/memory` prints a real front door instead of erroring.
- `memgrep validate` + `memgrep lint` clean over the project store (no unquoted descriptions, no
  body-less lessons, no dangling one-way links).
- Every migrated topic is reachable from the overview in ≤2 hops.
- `CLAUDE.md` is reduced to overview + operating instructions, and every section removed from it is
  findable via `memgrep recall` on a symptom a future session would actually search with.
- No PROJECT page contains an absolute `$HOME` path, a hostname, or a username.
- Nothing is lost: for each removed section, the destination page is named in this card.

## Estimated risk

**MED.** The content is load-bearing and the failure mode is silent — knowledge that is neither in
CLAUDE.md nor findable in the wiki is knowledge nobody knows is missing. Mitigated by ordering
(destination first, deletion last) and by the per-section destination table this card must carry.

## Approval log

- 2026-08-02T17:03:59+0200 — **MANDATE issued by the USER** (min-approval-requirement: user; the
  issuer IS the tier authority). Pre-approved; no approval request was sent. Verbatim directive in
  the STATE block.

## Acceptance

- [x] `<project>-overview.md` exists and `memgrep overview` prints it — seeded via
  `memgrep new-page --tier hub`, `bb94f839`. Before this the store had grown to 29 pages with no
  entry point at all, so `overview` ERRORED — the state that makes a reader fall back to CLAUDE.md.
- [x] a per-section destination table (**28**, not 27 — `grep -n '^## '` counts 28) is recorded IN
  this card before any deletion, `bb94f839`
- [ ] every destination page exists and validates BEFORE its section leaves `CLAUDE.md`
- [ ] `memgrep validate` + `memgrep lint` clean over `.claude/project/memory/`
- [ ] no PROJECT page carries an absolute `$HOME` path, a hostname, or a username
- [ ] `CLAUDE.md` holds only the overview + build/install/test/branch/push operating instructions
- [ ] `MEMORY.md` keeps its ONE line pointing at the overview
