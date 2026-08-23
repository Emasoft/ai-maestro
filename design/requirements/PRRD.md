---
prrd: ai-maestro
project-id: ai-maestro
created: 2026-08-23T16:10:00+0200
updated: 2026-08-23T16:10:00+0200
maintainer: ai-maestro
status: normative
---

# PRRD — ai-maestro Project Requirements & Rules Document

This is the project's constitution. Every agent that authors a TRDD, writes code, produces
an artifact, or proposes a design decision in this project MUST read it first and adhere to
it. It overrides any general convention an agent would otherwise apply.

**Two tiers.** 🥇 **GOLDEN** — set by the USER, immutable to everyone else including the
MANAGER. 🥈 **SILVER** — MANAGER-mutable. Rule identity is `<letter><number>.<version>`;
the NUMBER is the stable identity and is never reused, the LETTER is the current tier, the
VERSION is an edit counter. Cite as `PRRD G2.1` — the space is what makes it greppable.

**Relationship to the spec.** `design/specs/3-pillars-spec.md` is the testable CONFORMANCE
contract; this PRRD is the AUTHORITY that ratifies it. Where a golden rule here and the
spec disagree, the golden rule is what must be amended into the spec — never the reverse.

---

## 🥇 GOLDEN rules

- **G1.1** — Every agent that writes to GitHub (issue, issue comment, PR, PR comment, PR
  review, discussion, release note) MUST begin the body with a one-line self-identification
  of which agent/role/plugin authored it, because all AI Maestro agents share the single
  human-owner GitHub identity. The line carries NO `@`: a template is copied out of its code
  span into a real comment, where an `@` linkifies and PAGES a live account. Name the owner
  in plain words. Commit messages SHOULD carry an `Agent: <plugin-slug>` trailer.

- **G2.1** — The ratified kanban column vocabulary is EXACTLY the following ordered list,
  these spellings, no others. The order below IS the happy-path lifecycle order. Every
  consumer — the UI boards, GitHub-Project mirrors, `amp-kanban-*.sh`, role-plugins,
  `types/task.ts`, `types/team.ts`, `lib/kanban-field-authority.ts`, trddgrep, trdd-doctor —
  aligns TO this list, never the reverse. USER-ratified 2026-08-23; only the USER may change
  it.

  ```text
  backburner
  approval
  design
  design_ai_review
  design_human_review
  todo
  verify_assumptions
  plan
  dispatch
  dev
  testing
  ai_review
  human_review
  complete
  publish
  published
  deploy
  live
  live_auditing
  blocked
  failed
  superseded
  ```

  **19 lifecycle + 3 exception = 22 columns.** The USER's directive spelled the five new
  columns with hyphens (`design-ai-review`, `design-human-review`, `verify-assumption`); the
  ENUM IDENTIFIERS are snake_case above because all three pre-existing multi-word columns
  (`ai_review`, `human_review`, `live_auditing`) are snake_case, and a mixed enum invites
  typos that no type-checker can catch. The hyphenated forms are the human-readable names and
  MAY appear in prose; the snake_case forms are the only legal `column:` VALUES.

- **G3.1** — **BACKBURNER**: TRDD not yet approved.

- **G4.1** — **APPROVAL**: the TRDD is sent to the CHIEF-OF-STAFF or to the MANAGER
  (depending on the approval level requirements) and waits for approval.

- **G5.1** — **DESIGN**: the TRDD is expanded with detailed design and specifications by the
  DESIGNER agent (if inside a team) or by the agent implementer itself if outside of a team.
  No new files are needed — there is NO separate design-document file; the same TRDD file is
  used to write the design specs. The TRDD file MUST contain both the original body plus the
  implementation design text, with a clear divider that trddgrep can use to grep only the
  implementation-design elements of the body. An additional filter is needed to specify to
  grep the design-body, and four additional fields MUST be added to the frontmatter:
  `design-included: "true|false"`, `design-approved: "true|false"`, and the date of first
  design and the date of last design changes (every time it is resent to the design column
  for changes because it failed the design review), i.e. `first-design-draft: "<DATETIME>"`
  and `last-design-revision: "<DATETIME>"`. The same approval requirements hold for the
  design review if the DESIGNER (or the implementer agent when outside a team) finds design
  choices affecting the PRRD golden or silver rules, and it MUST ask permission of the
  MANAGER or the CHIEF-OF-STAFF to decide whether to include such a change or not.

- **G6.1** — **DESIGN-AI-REVIEW**: the TRDD design body is reviewed by the CHIEF-OF-STAFF or
  by the MANAGER. If the reviewer finds design choices that affect the PRRD golden or silver
  rules, it follows the approval-requirement level of the TRDD. HUMAN review can be done by
  the MANAGER in case the user explicitly gives the MANAGER permission to act on the user's
  behalf in the user's absence. The same approval requirements and procedures of the normal
  review hold for the design review if the reviewer finds out that some design changes are
  affecting the PRRD silver or golden rules, and in that case a new permission request MUST
  be made to the CHIEF-OF-STAFF or to the MANAGER for the change to be evaluated and approved
  or rejected. As usual, LOCAL TRDDs have the lowest (`none`) approval-level requirement — the
  agent itself can review and approve it, handling the whole orchestration, since a local TRDD
  does not affect git-tracked files and the changes remain local — and even the design review
  is made by itself autonomously.

- **G7.1** — **DESIGN-HUMAN-REVIEW**: the human is asked to review the TRDD. If the TRDD
  includes a UI design (web, TUI or native) a visual artifact MUST be generated to let the
  HUMAN evaluate the design mockup and add comments/annotations to the elements to make
  changes that will be recorded. This artifact-creation procedure is usually delegated to the
  MANAGER agent, responsible for all interactions with the human, or to the ASSISTANT for
  ordinary non-MAESTRO USERS. No human design review is needed when the approval level is
  `none`, and the column is skipped.

- **G8.1** — **VERIFY ASSUMPTIONS**: verify every piece of information reported in the TRDD.
  Assume nothing as true. If you cannot check facts directly, create tests to verify the
  claims. Pass only after all information and assumptions in the TRDD have been verified as
  true.

- **G9.1** — **PLAN**: plan the implementation of the TRDD executing the exact planning steps
  from the Claude Code `plan mode`, except that it MUST be executed in non-interactive mode.
  Instead of consulting the user as in the original plan-mode, make all choices autonomously
  and base decisions on verified facts or tests. The plan MUST be detailed, optimized to
  consume as little amount of tokens as possible without compromising quality, and MUST
  include rigorous TDD implementation procedures, breaking down macro steps into micro
  actionable steps, and strict quality gates for each micro-step. Identify all parallelizable
  micro-steps and redesign the plan workflow sequence so that their execution can be sped up
  via the spawning of parallel subagents acting on different files. Evaluate the opportunity
  of using the scripted dynamic workflows of Claude Code to execute the parallelized
  micro-steps (using fork agents sharing the same context to save tokens by avoiding
  rewriting the cache). Pass only if the whole implementation plan for the TRDD has been
  written down as a complete plan file.

- **G10.1** — **DEV**: the dev column remains the same, except for the addition of the
  enforcing of the plan steps defined in the `plan` column. The plan steps MUST be executed
  and their execution verified as instructed by the original `plan mode` prompt of Claude
  Code, so they persist across sessions.

---

## 🥈 SILVER rules

(none yet — the MANAGER may add, revise, delete or promote silver rules without USER
approval; every other agent proposes.)

---

## Amendment log

- 2026-08-23T16:10:00+0200 — PRRD created. G1.1 seeded from the IND recommended baseline.
  G2.1–G10.1 ratified by the USER verbatim (two consecutive directives, 2026-08-23),
  amending the kanban vocabulary from 17 to 22 columns. Recorded under TRDD-UNTF690M.
