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

- [ ] `<project>-overview.md` exists and `memgrep overview` prints it
- [ ] a per-section destination table (all 27 sections) is recorded IN this card before any deletion
- [ ] every destination page exists and validates BEFORE its section leaves `CLAUDE.md`
- [ ] `memgrep validate` + `memgrep lint` clean over `.claude/project/memory/`
- [ ] no PROJECT page carries an absolute `$HOME` path, a hostname, or a username
- [ ] `CLAUDE.md` holds only the overview + build/install/test/branch/push operating instructions
- [ ] `MEMORY.md` keeps its ONE line pointing at the overview
