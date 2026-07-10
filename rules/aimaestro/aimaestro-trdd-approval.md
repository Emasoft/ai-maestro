<!-- ai-maestro:installed-dep-rule -->

# ai-maestro overlay — TRDD approval tiers, transition authority, and baseline-ruleset governance

> **DEP overlay — installed by the ai-maestro server** into each
> registered agent workdir's `.claude/rules/`. It EXPANDS the IND base
> rules (`trdd-design-tasks.md`, `prrd-design-rules.md`,
> `universal-kanban.md` — shipped globally by the ai-maestro-janitor
> and assumed present); the base content is NOT restated here. If you
> are reading this, the project is an ai-maestro agent workdir and the
> multi-agent governance below applies.

**Scope:** This overlay governs (A) **who must approve** a TRDD before
it may be executed (the tiers), (B) **which governance TITLE may
trigger each column transition**, and (C) the standard GitHub-ruleset
baseline every AI Maestro repo carries. It applies to **every** AI
Maestro agent in **every** project — MANAGER, ORCHESTRATOR, ARCHITECT,
INTEGRATOR, MEMBER, CHIEF-OF-STAFF, AUTONOMOUS, MAINTAINER, and any
specialist agent.

It is a **unifying layer** over the IND base rules and the sibling
overlays — it does not replace them:
- IND `trdd-design-tasks.md` — the TRDD file format, the v2 `column:`
  pipeline, NPT/EHT, the STATE block, and the
  proposals/tasks/archived/refused folder lifecycle + protocols.
- IND `prrd-design-rules.md` — the PRRD format and GOLDEN/SILVER model.
- DEP `aimaestro-manager-approval-defaults.md` — the EXEMPT vs
  NON-EXEMPT operation lists and the approval-request flow.
- DEP `aimaestro-prrd-governance.md` — the PRRD per-title authority
  matrix and COS-routed proposal queue.

When this rule and one of those agree, follow either. When this rule
adds a constraint (approval tier, transition authority,
baseline-deviation gate), this rule governs.

---

## TRDD lifecycle with tiers — at a glance

```text
        ┌───────────────────────────────────────────────────────────────┐
        │  design/  ⇅  GitHub repo  =  SOLE SOURCE OF TRUTH              │
        │  every clone PULLS before acting and PUSHES after each change   │
        └───────────────────────────────────────────────────────────────┘

  idea / request
       │
       │  Tier 0 (own scope · NPT/EHT) ── author directly as `planned` ──┐
       │                                                                 │
       ▼   needs approval                                                ▼
 ┌───────────────────┐   approve                                ┌────────────────────────┐
 │ design/proposals/ │   (T1 COS · T2 MANAGER · T3 USER)         │  design/tasks/         │
 │  column: proposal │ ───────────────────────────────────────▶ │  = OPEN WORK           │
 │   (PENDING)       │                                          │                        │
 └───────────────────┘                                          │  planned→todo→dispatch │
       │                                                        │  →dev→testing→ai_review│
       │ refuse  (NEVER approved)                               │  →human_review         │
       ▼                                                        │  →complete→publish|deploy
 ┌───────────────────┐                                          │                        │
 │ design/refused/   │                                          │  • blocked  (lists its │
 │  column: refused  │                                          │    blocked-by:)        │
 └───────────────────┘                                          │  • failed → RETRY      │
                                                                │    (stays OPEN, never  │
                                                                │     archived)          │
                                                                └───────────┬────────────┘
                                                                            │ terminal-DONE
                                                                            │ (was approved)
                                                                            ▼
                                                          ┌──────────────────────────────┐
                                                          │  design/archived/            │
                                                          │  completed · cancelled ·     │
                                                          │  superseded                  │
                                                          └──────────────────────────────┘

  OPEN TRDD  = any file in design/tasks/  (INCLUDING `blocked` and `failed`).
  refused/   = proposals NEVER approved.   archived/ = ONCE-approved, now terminal.
  `failed` is OPEN and retryable — fix the cause (often via other TRDDs), retry;
  it is NEVER moved to archived. Giving up on a failed TRDD = cancel → archived.
```

---

## Project identity + canonical TRDD citation

**Every AI Maestro project has a unique `project-id`** — a stable,
**repo-independent** identifier. A project may span **more than one**
GitHub repo, so a repo URL is NOT a reliable project key. The
`project-id` is registered with AI Maestro and recorded in the project's
PRRD frontmatter (`project-id:`); it is what scopes a cross-project TRDD
search to exactly one project.

**Canonical TRDD citation** (what `findtrdd` resolves):

| Form | Meaning |
|---|---|
| `TRDD-<id8>` | **canonical** — `<id8>` is the TRDD's 8-char UPPERCASE base36 id (`A-Z`+`0-9`, no UUID). Collision-free in practice (create-time check), so this ALONE uniquely identifies ONE TRDD in the whole database. |
| `#<id8>` | casual short form (chat / commit messages) |
| `<project-id>:TRDD-<id8>` | **project-scoped** — tells `findtrdd --project <project-id>` to look only inside that project (faster, explicit locality for multi-project queries) |

`findtrdd` accepts the bare id (global lookup — always resolves to
exactly one TRDD because the id is unique; matched case-insensitively) OR
a `--project <project-id>` scope (single-project lookup). The `TRDD-<id8>`
citation stays greppable: `grep -rin "TRDD-K3QX9P2W" .` finds every reference.

To **know all TRDDs in all open projects**, the MANAGER iterates the
registered `project-id`s and reads each project's `design/` from its
**GitHub SSOT** (the canonical copy), never a possibly-stale local clone.

---

## Part A — Folders and protocols: defined in the IND base

The two-folder model (`design/proposals/` vs `design/tasks/`), the
terminal folders (`design/archived/`, `design/refused/`), the OPEN-TRDD
definition, failed-is-retryable, and the creation / promotion / refusal
/ archival / batch-approval protocols are all defined in the IND base
`trdd-design-tasks.md` (its "Folder lifecycle" section). This overlay
ADDS the multi-agent specifics:

- The approver named in those protocols is the authority Part B
  requires — T1 COS · T2 MANAGER · T3 USER — and approval-log lines
  record the tier: `- <ISO> — APPROVED by <approver> (tier <N>). …`.
- Proposals carry **`approval-tier: N`** in frontmatter (Tier 1/2/3 by
  definition — a Tier-0 task is authored directly in `design/tasks/`).
- The **`amama-proposal-approvals`** skill (MANAGER plugin) is the
  batch listing/decision tool, and `amama_proposal_approvals.py
  archive --state <completed|cancelled|superseded>` operationalizes
  archival.
- **Grandfathering:** TRDDs already in `design/tasks/` before this
  rule existed are treated as `planned`; do not move them back.

---
## Part B — Approval classification: who must approve before `planned`

**THE DEFAULT IS TIER 0 (agent-independent).** An agent escalates to a
higher tier **only** when a trigger in that tier fires. **When unsure
which tier applies, escalate one tier — conservative beats sorry.**

### Tier 0 — Agent-independent — DEFAULT, no approval
Author directly in `design/tasks/` as `planned`. Permitted when **all**
hold:
- The task is a **DERIVED TASK** (NPT/EHT of a task the agent already
  owns) **or** an independent task **fully inside the agent's own
  assignment scope**.
- It does **not** deviate from any standard baseline (GitHub rulesets
  per Part C, canonical pipeline, lint/test gates, …).
- It does **not** touch another team's or another project's source
  tree, public API, releases, or production.
- It does **not** change governance (PRRD rules, approval rules,
  personas, baselines) and incurs no cost/risk beyond the agent's
  mandate.
- It is reversible and local.

This is exactly the **EXEMPT** set in
`aimaestro-manager-approval-defaults.md` (mechanical column transitions, TRDD
intake/authoring, within-team coordination, read-only queries, runtime
evidence logging, applying the ratified baseline as-is).

### Tier 1 — CHIEF-OF-STAFF approval — team-internal coordination
Required when the task:
- affects **other members of the same team**, reprioritizes team work,
  or creates team-internal dependencies; or
- is proposed by a team-internal agent (ORCH/ARCH/INT/MEMBER) and
  reaches **beyond its own slice but stays inside the team**.

Per R6 v3, **COS is the sole entry point into a team** — the proposal
routes through the team's CHIEF-OF-STAFF. COS may approve and promote
(`proposal → planned`, move the file) **without** escalating, UNLESS a
Tier-2/3 trigger also fires — then COS forwards to MANAGER.

### Tier 2 — MANAGER approval — cross-team / governance / release / baseline-deviation
Required when the task:
- **deviates from a standard baseline, or adds/loosens/removes a rule
  relative to the baseline** — e.g. a special GitHub-ruleset exception,
  an extra branch rule, a new bypass actor, a downgraded required check
  (see Part C); or
- crosses **team or project** boundaries; or
- enters the **release pipeline** (publish/deploy to production) — the
  NON-EXEMPT release transitions; or
- changes a **SILVER PRRD rule**, a persona, or other governance; or
- is **architectural / first-of-kind / high-blast-radius**.

These are the **NON-EXEMPT** operations in
`aimaestro-manager-approval-defaults.md`, minus the USER-only items. The agent
files the TRDD in `design/proposals/` and routes an approval request to
MANAGER (team-internal agents via their COS). MANAGER approves →
promotes → moves to `design/tasks/`.

### Tier 3 — USER approval — golden / highest-stakes / owner-facing
Required when the task:
- changes a **GOLDEN PRRD rule**, or promotes/demotes a rule between
  golden and silver; or
- is anything **MANAGER itself cannot authorize** (the USER-only items
  in `aimaestro-manager-approval-defaults.md` §X — golden edits, promote/demote);
  or
- is **irreversible, public-facing at the owner-identity level, or
  otherwise highest-stakes** (first production deploy of a new service,
  a breaking public-API change, anything touching shared credentials /
  the owner GitHub identity).

MANAGER escalates to USER and relays the decision back down the chain.

### Routing summary
- Team-internal agents (ORCH/ARCH/INT/MEMBER) route **all** proposals
  through their **COS** (R6 v3). COS handles Tier 1; forwards Tier 2/3
  to MANAGER.
- AUTONOMOUS and MAINTAINER propose **directly to MANAGER**
  (governance-layer peers).
- MANAGER handles Tier 2; forwards Tier 3 to USER.
- USER is the only approver for Tier 3.

### The receiver's duty — a missing Derived TRDD must be reported (USER, 2026-07-10)

The IND base makes derived TRDDs (NPT/EHT) **mandatory companions** of every
TRDD: no change exists in isolation, and the D-TRDDs are the platelets that close
the holes the change opens. In the multi-agent system that duty does not end with
the author.

**Any agent that receives an assigned TRDD and judges a Derived TRDD to be
missing MUST report it to the sender immediately** — before, or at latest while,
starting the work. This is not optional and it is not deferred to review. A
receiver who executes a TRDD whose EHTs are absent lands the change and leaves
the wound open.

The receiver may go further and **author the missing D-TRDD itself, as a
proposal** in `design/proposals/` (`column: proposal`, `parent-trdd:` the
assigned TRDD, `labels: [derived, …]`). It is a NEW TRDD, not an edit of the
assigned one, so it needs no owner-approval round-trip — only an approver:

| Scope of the missing D-TRDD | Approver |
|---|---|
| Confined to the receiver's own slice; a derived NPT/EHT it will execute itself | none — Tier 0, author directly in `design/tasks/` as `planned` |
| Affects other members of the same team | **CHIEF-OF-STAFF** (Tier 1) |
| Within the ORCHESTRATOR's dispatch scope (re-prioritisation, re-assignment) | **ORCHESTRATOR** |
| Crosses a team, a project, the release surface, or a baseline | **MANAGER** (Tier 2) |

These are the tiers of Part B, not a new authority. The USER's phrasing —
"approved by the MANAGER or the CHIEF-OF-STAFF or the ORCHESTRATOR" — names the
three approvers the existing ladder already provides; which one applies is
decided by the scope of the hole, exactly as for any other proposal.

**Report the gap even when you also file the proposal.** The proposal closes the
hole; the report tells the sender that their TRDD shipped incomplete, which is
the only way the next one ships complete. Route the notification the same way any
message routes — through the comm graph (a team-internal agent replies to its
COS, never around it).

**Do not manufacture platelets.** Before reporting a missing D-TRDD, name the
downstream surface and read it. A derived TRDD invented to look thorough dilutes
the real ones and misstates the blast radius; a verified non-effect is recorded,
not filed.

---

## Part B2 — Column-transition authority (extends the IND transition table)

The IND base defines each transition's side effects. In the
multi-agent system, WHO may trigger each transition:

| Transition | Who can trigger | Multi-agent side effects |
|---|---|---|
| `backburner → todo` | MANAGER | none |
| `todo → design` | ORCHESTRATOR | assigns ARCHITECT via AMP |
| `design → dispatch` | ARCHITECT | may 1→N split / N→1 group |
| `dispatch → dev` | ORCHESTRATOR | sets `assignee:` |
| `dev → testing` | assignee | — |
| `testing → ai_review` / `testing → dev` | test runner | — |
| `ai_review → human_review` | AI reviewer | escalation relayed to USER per R6 |
| `ai_review|human_review → complete` | reviewer | — |
| `complete → publish|deploy` | INTEGRATOR | spawns RELEASER / DEPLOYER subagent |
| `publish → published` | RELEASER (via INTEGRATOR) | — |
| `deploy → live` | DEPLOYER (via INTEGRATOR) | — |
| `live → live_auditing` (soak) | INTEGRATOR | — |
| `<any working> → blocked` / back | owner | — |
| `<any> → failed` | MANAGER or USER | permanent-abandon decision |
| `<any> → superseded` | ARCHITECT (during split) | — |

Which of these transitions are EXEMPT from MANAGER approval vs
NON-EXEMPT is defined in `aimaestro-manager-approval-defaults.md`.
---

## Part D — Asynchronous enforcement: self-classify fast, audit lazily

Approval must **never** be a bottleneck and **never** force a synchronous
interrupt. An agent is busy and often steered by the USER; the MANAGER
serves ALL agents and ALL projects on its host; a COS serves one team.
None of them can stop to review every TRDD the instant it is created.
The model below keeps agents at full speed while still catching the
under-classification an efficiency-oriented agent is tempted to do.

### D1. Never block; enqueue and drain on idle

- **Tier 0** → author in `design/tasks/` as `planned` and **proceed
  immediately**. No wait, ever. This is the overwhelming majority of work
  (all derived NPT/EHT and in-scope tasks). Agents are *expected* to
  create as many Tier-0 derived TRDDs as the work needs.
- **Tier 1/2/3** → author in `design/proposals/`, then **keep working on
  other things**. The agent does NOT spin-wait on the approver. The
  proposal sits in a **queue** the approver drains when not busy with
  more urgent matters (the janitor heartbeat is a natural idle cadence).
  Time is never a constraint — a proposal may wait minutes or days; the
  agent picks it up once approved.
- The approver processes the queue **by priority** (sensitive/urgent
  first), not in creation order, and **never** as a per-creation
  interrupt.

### D2. Self-classify for speed — but it is AUDITED, not trusted

The agent sets its own `approval-tier:` so it never waits on a human to
*classify*. That speed is bought with an explicit anti-gaming contract:

- An agent that **deliberately under-classifies** a TRDD (flags a
  sensitive change Tier 0 to dodge the queue) commits a **governance
  violation** — worse than the wait it avoided. The agent's local
  judgment is NOT a substitute for the MANAGER's: only the MANAGER has
  the cross-project, user-priority, whole-picture view.
- Because the high tiers are defined by **objective, greppable signals**
  (below), misclassification is **mechanically detectable** — so it is
  caught, just not instantly.

### D3. The objective tier-floor (mechanical, not subjective)

A TRDD's **minimum** tier is computed from what it actually touches —
signals a script can check, so the watchdog needs no subjective call:

| Objective signal in the TRDD's content / proposed diff | Tier floor |
|---|---|
| GOLDEN PRRD rule edit · shared credentials / owner identity · irreversible destructive op · first production deploy of a new service · breaking public-API change | **3 (USER)** |
| `.github/` workflows or rulesets · baseline-ruleset deviation · another project's source (cross-repo) · SILVER PRRD / persona / governance file · `release-via: publish\|deploy` to production | **2 (MANAGER)** |
| affects other members of the same team / cross-member coordination | **1 (COS)** |
| everything else (in-scope dev, NPT/EHT, docs, local refactor) | **0** |

Keep the floors **narrow and objective** — approval is required *rarely*,
only for truly sensitive, detectable categories. The narrower and more
objective they are, the less incentive to cheat and the more reliably the
watchdog detects under-classification.

### D4. The classification watchdog (lazy, not per-creation)

A **TRDD approval watchdog** runs **periodically on idle** (janitor
heartbeat cadence / MANAGER idle sweep) — **never** on every creation:

1. For each TRDD in `design/tasks/` + `design/proposals/`, compute the
   D3 objective floor from its content + proposed diff.
2. Compare the **declared** `approval-tier:` to the floor:
   - **declared ≥ floor** → fine.
   - **declared < floor (UNDER-CLASSIFIED)** → for an *unambiguous*
     objective signal, **auto-correct**: raise `approval-tier:` to the
     floor, and if it was already in `design/tasks/` as `planned`, **move
     it back to `design/proposals/`** (un-authorize it) and stop any
     dependent execution; log it in the TRDD `## Approval log` and the
     watchdog report. For an *ambiguous* case, **flag** it for the
     MANAGER queue rather than auto-moving.
3. The watchdog writes a report the MANAGER drains at leisure; it does
   not interrupt anyone.

This is the safety net that makes D2 trustworthy: agents go fast by
self-classifying, and the (rare) sensitive TRDD that was mis-flagged is
caught asynchronously and corrected — without forcing the MANAGER to
review every TRDD the moment it is born.

### D5. The two levers, used together

The USER posed "watchdog **or** relax the classifiers" — the answer is
**both**, because they reinforce each other:

- **Relax + objectify** (D3): make approval rare and its triggers
  mechanical → fewer chances and less incentive to cheat, and cheating
  becomes detectable.
- **Watchdog** (D4): audit the now-rare high-tier classifications
  lazily → catch the residual under-classification without per-creation
  review.

Relaxing alone trusts agents too much on the sensitive few; a watchdog
alone over-burdens detection on a too-large surface. Together: agents
are free, sensitive work is still gated, and no one is interrupted.

### D6. Emergency enforcement (MANAGER can raise the bar instantly)

The lazy default (D4) is wrong for an active threat. When something
urgent appears — a security threat, a discovered vulnerability/CVE, a
deprecated/forbidden API — the MANAGER can declare a **temporary
emergency rule** that **raises** the required approval for a *matching
category* of TRDDs, effective **immediately** and **proactively** (the
watchdog enforces it in real time for that category, not on the idle
sweep). From the moment it is declared, any TRDD touching the emergency
area MUST be submitted for approval and can **never be self-approved**,
until the MANAGER lifts it.

**Shape of an emergency rule** (git-tracked SSOT —
`design/requirements/emergency-rules.yaml` — and/or the AI Maestro
server registry):

```yaml
- id: cve-2026-xxxx-libfoo
  declared: 2026-06-05T19:00:00+0200
  declared-by: MANAGER
  reason: "CVE-2026-XXXX in libfoo — every TRDD touching libfoo is MANAGER-gated"
  match:                       # CHEAP, script-only predicates (the narrowing)
    paths:    ["**/libfoo/**"]
    keywords: ["libfoo", "CVE-2026-XXXX"]
    deps:     ["libfoo"]
  min-tier: 2                  # raise matches to >= Tier 2
  no-self-approve: true
  mode: realtime              # proactive for THIS category only
  expires: 2026-06-12T19:00:00+0200   # TTL — see below
  status: active              # active | expired | lifted
```

**Token discipline (mandatory — the USER's constraint).** Real-time
scanning of *all* TRDDs would burn tokens. So an emergency rule is
enforced in two cheap stages, escalating cost only as the surface
shrinks:

1. **Script pre-filter (zero-LLM):** the `match` predicates are pure
   path-glob / keyword-grep / dependency checks. They run on every
   TRDD create/change and reduce the whole corpus to the **handful of
   suspects** that actually touch the emergency area. Heuristics give no
   certainty, but they shrink the investigation area massively — that is
   their job.
2. **LLM confirm only on the suspects:** the (few) matched TRDDs get the
   expensive check — raise their `approval-tier:` to `min-tier`, enforce
   `no-self-approve` (if a match was self-approved into `design/tasks/`,
   move it back to `design/proposals/` and halt dependent execution),
   and LLM-confirm ambiguous matches. The non-matches never cost a
   token.

**Auto-expiry so a forgotten emergency can't drain tokens.** Every
emergency rule carries `expires:`. The watchdog **auto-lifts** an
expired rule (back to the lazy default) and the MANAGER's idle sweep
**reminds** about any still-active emergency ("rule X active N days —
still needed?"). The MANAGER MUST lift it when the situation stabilizes;
the TTL is the backstop if they forget. Real-time enforcement only ever
applies to the narrow matched category, never the whole corpus.

---

## Part C — Standard baseline GitHub rulesets (the always-on floor)

Every AI Maestro repository carries a **standard baseline** of GitHub
branch rulesets: the ratified pair
**`baseline-history-protect`** (no-bypass: `deletion`,
`non_fast_forward`, `required_linear_history`) +
**`baseline-pr-and-checks`** (admin-bypass for `publish.py`:
`pull_request` 1-approval + `required_status_checks`). The canonical
definition lives in `aimaestro-manager-approval-defaults.md` §F.

**The ai-maestro-janitor automatically enforces this baseline.** If an
agent forgets to set it (or a repo drifts off it), the janitor
re-applies the ratified pair unprompted. Applying the baseline **as-is**
is a **Tier-0** operation — no approval needed; the janitor does it
without being asked.

**Any deviation is Tier 2 (MANAGER permission required BEFORE it is
applied):**
- adding a special exception or an extra rule not in the baseline,
- loosening, downgrading, or removing a baseline rule or check,
- adding or removing a bypass actor,
- switching enforcement from `active` to `evaluate`/`disabled`,
- any per-repo ruleset that differs from the ratified baseline.

No agent may unilaterally weaken, extend, or diverge from the baseline.
If a repo genuinely needs a non-baseline rule, the agent files a
**proposal** TRDD describing the exception and routes it to MANAGER
(team-internal via COS). MANAGER weighs it; if it touches a GOLDEN rule
or the shared identity, MANAGER forwards to USER (Tier 3).

---

## Why this exists

- **Autonomy without chaos.** Agents must plan and execute their own
  Tier-0 work continuously (DERIVED TASKS) — waiting on approval for
  every step would stall everything. The tiers draw the exact line
  between "just do it" and "ask first."
- **One clear escalation ladder.** Tier 0 → COS → MANAGER → USER maps
  directly onto the EXEMPT/NON-EXEMPT lists and the GOLDEN/SILVER split,
  so there is a single, greppable answer to "who signs off on this?"
- **Proposals are visible and revertible.** A `proposal` in
  `design/proposals/` is a tracked, reviewable request; promotion to
  `design/tasks/` via `git mv` records the decision in history.
- **The baseline is a floor, not a suggestion.** The janitor guarantees
  every repo has it; the MANAGER gate guarantees nobody quietly drills a
  hole in it.

## Anti-patterns

- Authoring a Tier-2/Tier-3 task directly in `design/tasks/` as
  `planned` to skip approval. The folder is determined by the tier, not
  by convenience.
- A team-internal agent routing a proposal straight to MANAGER instead
  of through its COS (violates R6 v3).
- "It's just a small ruleset tweak" applied without MANAGER sign-off —
  baseline deviations are Tier 2 regardless of size.
- Moving a grandfathered `design/tasks/` TRDD back into
  `design/proposals/`.
- Leaving an approved proposal in `design/proposals/` after approval —
  it MUST be `git mv`-ed to `design/tasks/` so the two folders stay an
  accurate index of "pending vs authorized".
