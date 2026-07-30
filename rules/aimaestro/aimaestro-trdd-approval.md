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

**Scope discriminators — the per-TRDD frontmatter field that binds a TRDD to
exactly ONE of the three kanbans.** A kanban is a QUERY over the corpus
(`aimaestro-kanban-multiagent.md`), and a TRDD's `scope:` plus one discriminator
field decide which board it lands on:

| scope | discriminator field | rule |
|---|---|---|
| `project` | **`project-id:`** (required) + optional **`repo:`** (which of the project's N repos this card touches) | binds to the project/team board; MUST carry `project-id` |
| `user` | **`host-id:`** (or implicit from the host store) | binds to the host-wide global board; MUST NOT carry `project-id` |
| `local` | the existing **`created-by`** (== `assignee`) | binds to the authoring agent's own board; MUST NOT carry `project-id` |

`scope: user` (the third scope, alongside the IND base's `project | local`) and the
`project-id:` / `host-id:` / `repo:` field definitions are a proposed addition to the
IND base `trdd-design-tasks.md`, **coordinated with the ai-maestro-janitor** (never
edited into the shipped `~/.claude/rules/` copy here). Until they ship, project-scoped
TRDDs already carry `project-id` per this overlay; user/local scope keep to their
existing discriminators.

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
  name it: `- <ISO> — APPROVED by <approver> (min-approval-requirement:
  <title>). …`.
- Proposals carry **`min-approval-requirement: <title>`** in frontmatter
  (`orchestrator`/`chief-of-staff`/`manager`/`user` by definition — a
  `none` task is authored directly in `design/tasks/`).
- The **`amama-approval-workflows`** skill (MANAGER plugin; its script
  is `amama_proposal_approvals.py`) is the batch listing/decision tool,
  and `amama_proposal_approvals.py archive --state
  <completed|cancelled|superseded>` operationalizes archival. (Corrected
  2026-07-16, ai-maestro#65 B2 — this rule previously named a skill
  `amama-proposal-approvals` that AMAMA never shipped; the rule follows
  the published reality rather than forcing a breaking skill rename.)
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

### Mandate TRDDs — a command from above is already approved (USER, 2026-07-10)

**The set of agents who may CREATE a TRDD as a mandate is exactly the set who
would be required to APPROVE it.** Approval is therefore not an event that
happens *to* a TRDD; it is a property of the author's authority relative to the
TRDD's tier. A proposal exists **only** when the author's authority is BELOW the
tier the TRDD requires.

The agent authority ladder:

```
MEMBER · ARCHITECT · INTEGRATOR   (no approval authority)
   <  ORCHESTRATOR      (its own team's dispatch scope)
   <  CHIEF-OF-STAFF    (team-internal coordination — sole entry point, R6 v3)
   <  MANAGER           (cross-team, governance, release, baseline deviation)
   <  USER              (not an agent; above the whole ladder)
```

| Tier | `min-approval-requirement:` | May issue it as a MANDATE |
|---|---|---|
| **0** | `none` | **any agent** — a self-mandate: sender and receiver are the same |
| **1** | `orchestrator` or `chief-of-staff` | ORCHESTRATOR\*, COS, MANAGER |
| **2** | `manager` | MANAGER |
| **3** | `user` | **USER only** |

\* ORCHESTRATOR may mandate only the dispatch subset of Tier 1 (assignment,
priority, sequencing inside its own team). Anything else Tier-1 is the COS's.

**A mandate is born approved.** It is authored directly in `design/tasks/` with
`column: planned` (or straight to `dispatch`/`dev` when assigned) — never in
`design/proposals/`. It carries:

```yaml
min-approval-requirement: manager   # the TITLE that must approve (the objective floor, §D3)
mandate: true                       # authority(mandated-by) >= authority(min-approval-requirement)
mandated-by: manager                # the TITLE whose authority pre-approves it ('self' at `none`)
derived: true                       # this TRDD is an NPT or EHT of another
derived-kind: eht                   # npt | eht — which kind, without reading the parent
```

and an `## Approval log` line recording that no round-trip occurred:

```
- <ISO> — MANDATE issued by MANAGER <agent-name> (min-approval-requirement: manager).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
```

**These are attributes, not machinery.** The whole model above is five frontmatter
fields. The TRDD *is* its frontmatter: the kanban reads `column:`, governance reads
`min-approval-requirement:` + `mandate:`, the dependency graph reads
`npt:`/`eht:`/`blocked-by:`. One file, three pillars, no side tables, no registry to
keep in sync. Every query in this rule is a `grep` — `grep -l "^mandate: true"`,
`grep -l "^derived: true"`, `grep -lE "^min-approval-requirement: (manager|user)"` —
which is what makes the §D4 watchdog cheap enough to run on an idle heartbeat instead
of at every creation.

**The invariant a watchdog can check:** `mandate: true` requires
`authority(mandated-by) >= authority(min-approval-requirement)` — one comparison on
the one authority ladder above. A mandate that fails it is void; see §D4.

#### `min-approval-requirement:` supersedes `approval-tier: N` (USER, 2026-07-10)

The tier NUMBER was an indirection: reading `approval-tier: 2` required this rule's
D3 table to learn it meant "MANAGER". Naming the title directly removes the decode
step and makes the mandate invariant a single comparison on a single ladder. It also
says something the number could not: tier 1 admits **two** approvers, and
`orchestrator` (dispatch scope) is a strictly weaker requirement than
`chief-of-staff`. Values are lowercase-kebab governance titles, matching
`agent.governanceTitle`: `none | orchestrator | chief-of-staff | manager | user`.

`approval-tier:` is **deprecated**, decode-only, and never written on a new TRDD.
Legacy files are migrated **on next touch** (the same incremental policy the IND base
uses for v1 `status:` → v2 `column:`), never in a mass rewrite: `0 → none`,
`1 → chief-of-staff` (or `orchestrator` where the TRDD is dispatch-scoped),
`2 → manager`, `3 → user`. A file carries exactly one of the two fields.

#### The approval record — who judged it, and when (USER, 2026-07-10)

A TRDD that has been **approved or refused** carries the judgment, not just its
consequence:

```yaml
approved: true                      # true | false | rejected
approval-judge: amama-manager       # WHO decided (an agent name, or the maestro)
approval-datetime: 2026-07-10T03:19:24+0200
min-approval-requirement: manager   # WHO WAS REQUIRED to decide (the D3 floor)
```

`approval-judge` and `approval-datetime` are new information: no other field records
who signed off or when, and without them an `## Approval log` line is the only
evidence — prose, not greppable. `min-approval-requirement` is the floor from §D3;
its values are the authority ladder in lowercase kebab, matching
`agent.governanceTitle`: `user | manager | chief-of-staff | orchestrator | none`.
**`user` is the canonical top-rung spelling** — it is what R41.4 fixes
(`none(0) < … < user(4)`), what the §D3 floor table computes, and what the server's
`manage-trdd` enum enforces. `maestro` (an earlier spelling of the same human-owner
rung in this section) is a deprecated READ-alias: accept it when reading a legacy
card and normalize to `user`; never write it. (Ruled 2026-07-16 — ai-maestro#65 B1 /
#66 Q4: the ladder must have ONE canonical spelling or
`authority(mandated-by) >= authority(min-approval-requirement)` silently
mis-evaluates on the highest-stakes rung. The USER also wrote this field as
`approval-requirement`; the `min-` prefix is kept because §D3 and §D4 compare
against it as a *floor*, not as a fixed requirement.)

`approved:` is DENORMALIZED, on the same terms as `derived:` — it buys a one-pass
query (`grep -l "^approved: rejected"`) and it owes an invariant:

```
approved: true       ⟺  column ∉ {proposal, refused, superseded}   (it reached design/tasks/)
approved: rejected   ⟺  column == refused                          (a judge declined it)
approved: false      ⟺  column ∈ {proposal, superseded}            (pending, or overtaken)
approval-judge / approval-datetime  present ⟺ approved ∈ {true, rejected}
```

A **mandate** is approved the moment it is written, so `approval-judge` is its
issuer and `approval-datetime` its `created:`. A **superseded** proposal is archived
with `approved: false` and **no judge**: nobody declined it, a newer TRDD overtook
it. Recording it as `rejected` would attribute a decision to someone who never made
one.

**Declined, and why** — `status: superseded|valid` and `archived: yes|no` from the
same directive are not fields, because both restate what `column:` and the file's
folder already say. The rule below is the general form of that judgment.

> **CORRECTED 2026-07-30 (USER ruling).** This passage previously added *"`status:`
> was the v1 field that `column:` replaced; reintroducing it with a new meaning would
> make every legacy file ambiguous."* **That is wrong.** `status:` is NOT a retired
> duplicate of `column:` — it carries a DIFFERENT aspect, by requirement, and the
> pillar specs already use it that way (`design/specs/*.md` each carry
> `status: normative`). What v1 did was spell the PIPELINE STATE in `status:`; v2
> moved that one aspect to `column:`. So the ambiguity to guard against is a **column
> VALUE sitting in `status:`**, never the field's existence.
>
> The distinction is load-bearing, not pedantic: `lib/trdd-doctor.ts` keyed its rule
> on the field NAME and marked it `autofixable`, so `yarn trdd:fix` DELETED a
> `status:` beside a column and REWROTE a column-less one into `column: <mapped>`
> with `?? 'todo'` swallowing every value it did not recognise. A tool that destroys
> a legitimate field, in the one place a tool must not guess. Now `STATUS-HOLDS-
> COLUMN-VALUE`, keyed on `isPipelineStateValue(value)`.

#### The field set — what is a field, and what is derived from one

A frontmatter field earns its place by carrying information no other field carries.
A field that restates another is a second source of truth waiting to disagree with
the first, and the D4 watchdog then has to arbitrate between two things that were
supposed to be one thing. So:

| Attribute | How it is expressed |
|---|---|
| `mandate` / `mandated-by` | **fields** — nothing else records who pre-approved |
| `derived` / `derived-kind` | **fields** — a denormalized back-pointer; see the invariant below |
| `min-approval-requirement` | **field** — the objective floor; nothing else records it |
| `created-by` | **field** — authorship, set once. Not `current-owner` (write-lock) and not `assignee` (executor); those change hands, authorship does not |
| `approved` / `approval-judge` / `approval-datetime` | **fields** — the judgment. `approved` is denormalized (see the invariant above); the judge and the datetime are recorded nowhere else |
| *proposal?* | **derived**: `column == proposal` (and the file sits in `design/proposals/`) |
| *archived?* | **derived**: the file's folder. And a *superseded?* flag would restate `column == superseded` |
| `status` | **a FIELD, and NOT this one** — it carries a different aspect (the specs use `status: normative`), so it is neither derived from `column:` nor a duplicate of it. What v1 kept here was the PIPELINE STATE, which v2 moved to `column:`; a column VALUE in `status:` is therefore the defect (`STATUS-HOLDS-COLUMN-VALUE`), not the field. Corrected 2026-07-30 by USER ruling — see the note above for the data-loss bug the old wording licensed |
| *the flock (list of D-TRDDs)* | **derived**: `npt: ∪ eht:` — already listed, and split by KIND, which the union would throw away. NPT gates the parent's `dev`; EHT gates its `complete`; a flat `derived-trdd:` list could not express that difference |

**`derived:` is DENORMALIZED, and denormalized fields drift.** A TRDD is derived
precisely when its id appears in some parent's `npt:` or `eht:`. The flag repeats
that fact so a child can be recognised without scanning every parent — the same
reason `parent-trdd:` exists. It buys a one-pass query and it owes an invariant:

```
derived: true      ⟺  this trdd-id appears in exactly one parent's npt: or eht:
derived-kind: npt  ⟺  it appears in that parent's npt:
derived-kind: eht  ⟺  it appears in that parent's eht:
parent-trdd:       ==  that parent
```

The §D4 watchdog checks it with two greps and no LLM. A `derived: true` with no
parent claiming it is an **orphan platelet** — it will never gate anyone's
`complete`, which is the one thing a platelet exists to do. A parent whose `eht:`
names a TRDD that does not declare `derived: true` is the same bug seen from the
other end. Both are repaired by writing the missing half, never by deleting the
half that is there.

#### A derived TRDD has no derived TRDDs — the depth is exactly 1 (USER, 2026-07-10)

**A D-TRDD may not spawn D-TRDDs of its own.** It either contains every change it
needs, or it is *accompanied* by further D-TRDDs — **siblings under the same
parent**, never children of itself.

```
derived: true   ⇒   npt: []   and   eht: []
no TRDD may name a `derived: true` TRDD as its `parent-trdd:`
```

Two greps, no LLM: a `derived: true` file with a non-empty `npt:`/`eht:`, or a
`parent-trdd:` pointing at a derived file, is a violation.

**This is what stops the platelet count from being unbounded.** Without it, each
patch's own side effects spawn patches, those spawn patches, and the parent's
`complete` gate — *all EHTs terminal* — recurses forever over a tree nobody can
enumerate. At depth 1 the flock is a **finite, enumerated set** written on the
parent, so "is the closure closed?" is a single read of one file.

**Sibling ordering is `blocked-by:`, never `npt:`.** The two edges look alike and
are not: `npt:`/`eht:` are **derivation** edges (this TRDD spawned that one) and
they alone establish parenthood; `blocked-by:` is a **runtime** edge (this TRDD
cannot proceed until that one resolves) and it establishes nothing. When D-TRDD *A*
must wait on its sibling *B*, that goes in `A.blocked-by`, and `B` stays exactly
where it already is — in the parent's `npt:`/`eht:`. Putting `B` in `A.npt:` would
give `B` two parents, silently break the invariant above, and re-introduce the depth
the rule exists to forbid. (This is not hypothetical: TRDD-WNZ72SFO carried
`npt: [TRDD-QC8R79G5]` for its sibling until this rule caught it.)

**A derived TRDD is still gated by its own effects — through `blocked-by:`.** When
derived TRDD *B* opens a hole, the platelet *C* that closes it is registered in the
**parent's** `eht:` (because `B.eht` must stay empty), and *B* lists *C* in
`B.blocked-by`. *B* then cannot reach `complete` while *C* is open, exactly as if
*C* were its child. The gate is unchanged; only the field carrying it moves. The
**parent** owns the derivation (who spawned whom); each **member** owns its own
ordering (who waits on whom); no edge crosses a generation.

#### A parent is COMPLETE only when its whole flock is — else it is BLOCKED (USER, 2026-07-10)

**A TRDD with any derived TRDD still under development is not complete. It is
BLOCKED.** Not "complete with follow-ups", not "complete pending EHTs" — the kanban
column says `blocked`, and `blocked-by:` names every open child.

```
column: complete   requires  every id in (npt: ∪ eht:) sits in a terminal column
                             (complete | published | live | superseded)
otherwise          column: blocked
                   blocked-by: [the open children]
                   pre-block-column: <where it was>
```

The parent's own tests going green is not completion. Completion is the parent's
change **plus the holes it opened being closed** — that is what the platelets are
for, and a parent that ships without them has done net damage. So the gate lives on
the parent, and the only honest column for "my work is done, my flock is not" is
`blocked`: it is blocked, on itself.

Depth-1 (above) is what makes this gate **decidable**: the flock is the finite list
written on the parent, so evaluating the gate is one file read plus one `column:`
grep per child — never a tree walk of unbounded depth. The two rules are one design;
neither works without the other.

#### Consequences, stated because each one is a rule someone will otherwise get wrong

- **Every TRDD created by a MANAGER is a mandate — with exactly one exception.**
  No *agent* outranks the MANAGER, so at tiers 0-2 a MANAGER never proposes; it
  commands. The exception is **Tier 3, the USER-reserved set**: golden PRRD rules,
  promote/demote between golden and silver, and the irreversible / owner-facing
  operations. There the MANAGER is a **proposer**, not an approver, and this is
  not a convention — `prrd-edit.py` refuses a MANAGER golden edit with
  `403 — golden rules are user-only`, enforced by `caller_is_manager()` in
  `prrd_lib.py`. "The MANAGER has no one above him" is true of the agent fleet and
  false of the USER, who is not an agent.
- **Every Tier-0 TRDD is a self-mandate.** A task requiring no approval is
  approved the moment it is written, because the author is both sender and
  receiver. This is why derived NPT/EHT work never queues: it is mandated by the
  agent that owns it.
- **A COS-authored Tier-2 TRDD is a proposal, not a mandate.** Authority is per
  tier, not per title. Being an approver *somewhere* does not make you an approver
  *everywhere*.
- **A mandate is still a TRDD.** It obeys the derived-TRDD rule (it ships its
  NPTs/EHTs), the receiver may still report a missing D-TRDD, and its tier is
  still subject to the objective floor. Pre-approved means "no approval request
  was needed", not "unreviewable".
- **No agent may mandate above its own rank.** An agent that sets `mandate: true`
  on a TRDD whose floor exceeds its authority has not approved anything; it has
  forged an approval. §D4 detects and reverses this.

#### A mandate usually arrives with a flock (USER, 2026-07-10)

A mandate rarely travels alone. The issuing authority sends it **together with its
derived TRDDs** — the NPTs it depends on and the EHTs that close the holes it
opens — and those children are themselves **mandate-derived-TRDDs**, pre-approved
by the same issuer. This is the derived-TRDD rule and the mandate rule meeting: an
authority that commands a change also commands the platelets that keep the change
from bleeding.

Each child's mandate is judged on **its own** tier floor, not the parent's. A
MANAGER issuing a flock mandates every child whose floor is ≤ 2; a child whose
content reaches the USER-reserved set (Tier 3) is a **proposal even from the
MANAGER**, and the flock ships with one member still awaiting the USER. Authority
does not flow down a parent link; it is re-evaluated per TRDD.

**The flock does not foreclose the receiver.** However complete the mandate looks,
a receiver that judges a derived TRDD to be missing **may still propose one** —
and must still report the gap to the sender (see the receiver's duty below). A
command from above carries authority, not omniscience: the issuer decided *what*
must change, the receiver is the one standing where it will break. Approval of the
receiver's D-TRDD follows the ordinary rule — a self-mandate when the hole lies
inside the receiver's own slice, a proposal to the required approver when it
reaches past it. It does **not** automatically route back to the mandate's issuer
merely because the issuer outranks the receiver; the *hole's* tier decides, not the
parent's.

### Routing summary
- The routing below applies **only when the author's authority is below the
  TRDD's tier**. An author at or above the tier issues a MANDATE and routes
  nothing (see above).
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

| Scope of the missing D-TRDD | Required approver |
|---|---|
| Confined to the receiver's own slice; a derived NPT/EHT it will execute itself | none — Tier 0, a **self-mandate**: author directly in `design/tasks/` as `planned` |
| Affects other members of the same team | **CHIEF-OF-STAFF** (Tier 1) |
| Within the ORCHESTRATOR's dispatch scope (re-prioritisation, re-assignment) | **ORCHESTRATOR** |
| Crosses a team, a project, the release surface, or a baseline | **MANAGER** (Tier 2) |

These are the tiers of Part B, not a new authority. The USER's phrasing —
"approved by the MANAGER or the CHIEF-OF-STAFF or the ORCHESTRATOR" — names the
three approvers the existing ladder already provides; which one applies is
decided by the scope of the hole, exactly as for any other proposal.

**And the mandate rule applies to the D-TRDD too.** The receiver files a
*proposal* only when the hole's tier exceeds its own authority. A MEMBER noticing
a missing EHT inside its own slice issues it as a self-mandate and gets on with
it. A COS noticing a missing team-wide EHT issues it as a mandate — it is the
Tier-1 approver. Only when the hole reaches past the receiver's rank does the
notification become a request rather than a command.

**Report the gap even when you also file the proposal.** The proposal closes the
hole; the report tells the sender that their TRDD shipped incomplete, which is
the only way the next one ships complete. Route the notification the same way any
message routes — through the comm graph (a team-internal agent replies to its
COS, never around it).

**Do not manufacture platelets.** Before reporting a missing D-TRDD, name the
downstream surface and read it. A derived TRDD invented to look thorough dilutes
the real ones and misstates the blast radius; a verified non-effect is recorded,
not filed.

### The refusal protocol — an approver is a GUIDE, not a GATE (USER, 2026-07-16, ai-maestro#71)

The tiers above say WHO may approve a proposal; this says what happens when an
approver says **no**. It is the refusal half of the same APPROVAL protocol
(GOVERNANCE-RULES **R49**, canonical). A refusal is the **START** of the work on a
proposal, not the end: a bare "denied" is a failure of the approver's role **even
when the ruling is perfectly correct**, because the proposer cannot read the
approver's mind — it hears "no", concludes the capability is forbidden, and tears
out the work that depended on it.

**Every refusal an approver issues (MANAGER at Tier 2, COS/ORCHESTRATOR at Tier 1,
and the receiver-authored proposals above) MUST carry all three, or it is
malpractice, not caution:**

1. **The precise defect** — the exact command / input path / abuse / rule.
   "Insufficiently secure" is not a finding; "`--exec` takes an unsanitized string a
   malicious agent can pass to a shell" is. If you cannot name it, you do not
   understand your own objection well enough to have refused yet.
2. **The bar for acceptance** — what would make it approvable.
3. **An explicit invitation to re-propose** — and, when the design cannot be saved,
   a push toward the goal by another route. **Refuse the implementation; never
   refuse the need.** A correct "no" that ends with the need abandoned is a *failed*
   refusal — measure a refusal by what the proposer does NEXT.

**The from-DRAFT corollary (binds the PROPOSER — including a MEMBER, a MAINTAINER, a
plugin/consumer Claude, and YOU when your own proposal is refused).** A refusal that
names no defect does **NOT** authorize stripping, deleting, or rewriting the
dependent or derived work — the need it addresses **stands until a defect is
named**. This corollary attaches the moment a proposal is **DRAFTED**, not when it
is refused: never pre-concede destruction in the ask itself ("implement X, or I
strip X from the skill"), which hands the approver the cheap exit. If a refusal's
scope is unclear, **ASK before destroying anything** — RULE-0 discipline pointed at
capabilities. The correct move on a refusal is: extract the defect, HARDEN the
proposal with an explicit abuse-prevention contract (server-side authorization,
field allowlist, no-secret-through-a-model, non-self-assignable), and RE-PROPOSE.

**The MESSAGE is the channel; the tool is the paperwork.** The approver *persuades
and guides* via inter-agent MESSAGES (per the R6 graph — agent↔MANAGER,
COS↔MANAGER, agent↔ORCHESTRATOR), carrying the arguments and explanations, and
stays in the thread through the revision rounds. The mechanical tool-approval —
`column: refused`, the `## Approval log` line, an API `refuse` reason — only
**records** the outcome; a decision that exists only in the file record was never
communicated. Two, three, five message-and-reply rounds per proposal is the process
working. **Where no AMP thread exists** between two parties (a plugin session ↔ the
MANAGER), the **cross-repo GitHub issue IS the message channel** and carries the
same duties — arguments, follow-ups, revision rounds — not a form filed once. Either
way, the refusal **and its named defect** land on that channel (the governing GitHub
issue and/or the TRDD `## Approval log`) so the proposer has a written bar to clear.

**Why (the incident this came from).** The `ai-maestro` hub Claude correctly denied
most of a set of scripts an `ai-maestro-plugin` skill needed, on security grounds —
and the plugin Claude, hearing "no", began **deleting its own working skills** to
strip the dependent features. The USER caught it by chance, named *where* the
security was lacking, and a hardened re-proposal was then approved. A correct refusal
and a destructive one look identical in the log, which is why the duty attaches to
every refusal.

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

### The dispatch precondition — never dispatch against an unsatisfiable NPT (TRDD-BYCN5PB7)

**Before moving a TRDD to `dev` (i.e. handing a worker its build order), the
dispatcher MUST ensure the BASE that worker branches from already satisfies
every NPT that worker's TRDD declares.**

Binds **every** dispatching agent — MANAGER, CHIEF-OF-STAFF, ORCHESTRATOR —
not one persona. Concretely:

- Land the requirements/spec on `main` (or on a base branch that is merged
  **before** dispatch), **then** hand the worker its TRDD.
- If the requirements are staged in a PR, **merge that PR — or otherwise make
  the base satisfy the NPT — BEFORE** telling the worker to build.
- **Never** dispatch a worker whose declared NPT is satisfied only by an
  unmerged PR, an unpushed branch, or any base it does not branch from.

**Why this is a rule and not advice.** Violating it produces a deadlock in
which *nobody is wrong and nothing moves*: the worker reads its STATE-block NPT
gate, correctly refuses to build because the prerequisite is genuinely absent
from its base, and flags the dispatcher — while the dispatcher believes the
work was delivered. Observed live in the SCEN-031 re-run: requirements sat in
an unmerged PR#4 while `main` held only "Initial commit", the AUTONOMOUS dev
correctly held at the NPT gate, and the run stalled short of a release. A
worker refusing here is behaving **correctly**; the defect is upstream, in the
dispatch.

The general form, worth stating because it outlives this instance: **do not
declare a prerequisite you then leave unmet on the base you dispatch against.**
An NPT is a promise to the worker, and the dispatcher owns keeping it.

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

The agent sets its own `min-approval-requirement:` so it never waits on a
human to *classify*. That speed is bought with an explicit anti-gaming
contract:

- An agent that **deliberately under-classifies** a TRDD (declares
  `none` on a sensitive change, to dodge the queue) commits a
  **governance violation** — worse than the wait it avoided. The agent's local
  judgment is NOT a substitute for the MANAGER's: only the MANAGER has
  the cross-project, user-priority, whole-picture view.
- Because the high tiers are defined by **objective, greppable signals**
  (below), misclassification is **mechanically detectable** — so it is
  caught, just not instantly.

### D3. The objective floor (mechanical, not subjective)

A TRDD's **minimum** `min-approval-requirement:` is computed from what it
actually touches — signals a script can check, so the watchdog needs no
subjective call:

| Objective signal in the TRDD's content / proposed diff | Floor |
|---|---|
| GOLDEN PRRD rule edit · shared credentials / owner identity · irreversible destructive op · first production deploy of a new service · breaking public-API change | **`user`** |
| `.github/` workflows or rulesets · baseline-ruleset deviation · another project's source (cross-repo) · SILVER PRRD / persona / governance file · `release-via: publish\|deploy` to production | **`manager`** |
| affects other members of the same team / cross-member coordination | **`chief-of-staff`** (or `orchestrator` when purely dispatch-scoped) |
| everything else (in-scope dev, NPT/EHT, docs, local refactor) | **`none`** |

Keep the floors **narrow and objective** — approval is required *rarely*,
only for truly sensitive, detectable categories. The narrower and more
objective they are, the less incentive to cheat and the more reliably the
watchdog detects under-classification.

### D4. The classification watchdog (lazy, not per-creation)

A **TRDD approval watchdog** runs **periodically on idle** (janitor
heartbeat cadence / MANAGER idle sweep) — **never** on every creation:

1. For each TRDD in `design/tasks/` + `design/proposals/`, compute the
   D3 objective floor from its content + proposed diff.
2. Compare the **declared** `min-approval-requirement:` to the floor:
   - **declared ≥ floor** → fine.
   - **declared < floor (UNDER-CLASSIFIED)** → for an *unambiguous*
     objective signal, **auto-correct**: raise
     `min-approval-requirement:` to the floor, and if it was already in
     `design/tasks/` as `planned`, **move it back to
     `design/proposals/`** (un-authorize it) and stop any dependent
     execution; log it in the TRDD `## Approval log` and the watchdog
     report. For an *ambiguous* case, **flag** it for the MANAGER queue
     rather than auto-moving.
3. **For each `mandate: true`, verify the mandate was the issuer's to
   issue:** `authority(mandated-by) >= authority(min-approval-requirement)`,
   using the corrected floor from step 2, not the declared value. A mandate
   that fails this test was never an approval — it is a **forged** one.
   Revoke it (`mandate: false`), move the TRDD back to
   `design/proposals/`, halt dependent execution, and record the
   revocation in the `## Approval log` naming the issuer. This is the
   check that keeps the ladder from being decorative: without it,
   `mandate: true` is self-certified, and an under-classified floor plus a
   self-issued mandate is a complete bypass of the approval system by an
   agent that never sent a single request.
4. **Check the two platelet invariants, both pure grep, no LLM:**
   - `derived: true` ⇔ exactly one parent names it in `npt:`/`eht:`, with
     the matching `derived-kind:` and `parent-trdd:` (repair the missing
     half — never delete the half that is there);
   - `derived: true` ⇒ `npt: []` and `eht: []`, and no `parent-trdd:`
     points at a derived TRDD (depth is exactly 1).
5. **Check the completion gate:** a TRDD in a terminal-DONE column whose
   `npt:`/`eht:` names a non-terminal child is a **false completion** —
   move it to `blocked` with `blocked-by:` naming the open children, and
   flag it. See the completion rule below.
5b. **Check the field + checklist discipline (USER ruling 2026-07-24, pure
   grep, no LLM).** The three fields are MANDATORY and NOT substitutable —
   `blocked-by` records what gates a TRDD, `column` its pipeline position,
   `assignee` its owner; none stands in for another, and all are kept
   current at every edit:
   - **Fields present + consistent:** `assignee` is set; `blocked-by` is
     non-empty ⟺ `column: blocked`; `column` ∈ the ratified 17-column enum.
     A `column: blocked` with empty `blocked-by`, or a non-empty `blocked-by`
     with `column ≠ blocked`, is drift → flag.
   - **Checklist-gated completion (the hard gate):** a TRDD may sit in a
     terminal column `column ∈ {complete, published, live}` ONLY when every
     `- [ ]` box in its bottom checklist is `- [x]`. A terminal column with
     ANY unchecked box is a **false completion** → move it back to its
     `pre-block-column:` (or `dev`) and flag. A fully-checked checklist in a
     non-terminal column is simply not-yet-advanced (not a violation).
     This gate is INDEPENDENT of, and additional to, the NPT/EHT gate in
     step 5: BOTH must pass for a TRDD to be `complete`/`published`/`live`.
6. **Check the approval record:** `approved:` agrees with `column:` per the
   invariant above; `approval-judge`/`approval-datetime` are present exactly
   when `approved ∈ {true, rejected}`; and the judge's authority is at or
   above `min-approval-requirement`. A `superseded` TRDD carries no judge.
7. **Check supersede authority:** for every `T_old.superseded-by: [T_new]`,
   the editor who set it must be `T_new.created-by`. Only the author of the
   replacement may declare that it replaces something. Flag any other hand.
4. The watchdog writes a report the MANAGER drains at leisure; it does
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
  min-requirement: manager     # raise each match's min-approval-requirement to >= manager
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
   expensive check — raise their `min-approval-requirement:` to the rule's `min-requirement`, enforce
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
