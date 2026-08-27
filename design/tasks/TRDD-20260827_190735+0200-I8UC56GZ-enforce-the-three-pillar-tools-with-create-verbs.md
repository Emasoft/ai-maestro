---
trdd-id: I8UC56GZ
title: The 3-pillars tools have no create verb and no lint-on-write, so G12.1 cannot yet be obeyed
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-27T19:07:35+0200
updated: 2026-08-27T19:07:35+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-27T19:07:35+0200
priority: 0
severity: major
effort: M
release-via: none
labels: [governance, three-pillars, tooling]
npt: []
eht: []
blocked-by: []
relevant-rules: [12]
---

# The 3-pillars tools have no create verb and no lint-on-write

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-27T19:07:35+0200

**USER mandate 2026-08-27T19:07:35+0200, verbatim intent:** *"the trddgrep tool MUST lint every TRDD file when it
access it, and automatically detect and fix the errors autofixable, and report those non
autofixable … even better: the `trddgrep new <params>` command to create a new TRDD should have
created the TRDD file already with all the right fields … ENFORCE via skills and rules the use of
the trddgrep tool (along with prrdgrep and specgrep) … add this to the golden rules of the
3-pillars system."*

**The rule half is DONE: `PRRD G12.1` (added 2026-08-27T19:07:35+0200 via `prrdgrep edit`, lint clean).** This card
is the TOOLING half, without which G12.1 mandates something the tools cannot do.

### Measured 2026-08-27T19:07:35+0200

| claim | reality |
|---|---|
| `trddgrep new` | **does not exist.** Verbs are: board · next · why · unblocks · roots · show · search · lint · validate · fix · edit · env · index-verify. No create/new/add/init |
| `prrdgrep` create verb | **does not exist** (show · search · edit · lint · env) |
| `specgrep` create verb | **does not exist** — verbs READ from `specgrep help`, not grep-counted: show · search · edit · lint · env. No create under any name (`new`/`init`/`scaffold`/`mint`) |
| lint on access/update | `prrdgrep edit` states its gate enforces the lint predicates pre-write; `trddgrep edit` is lock+CAS-guarded but **no post-write lint is documented** |
| enforcement rule before today | **none.** The only "never hand-author, use the write verbs" text in the whole rules corpus was `markdown-memory-recall.md:142`, for **memgrep**. The memory system had this discipline; 3-pillars had the linters and no mandate |

**Evidence this is not theoretical:** every malformed card in this corpus was hand-written. On
2026-08-27 this session hand-authored TRDD-GFX57106 with a `cat > file <<EOF`, then tried twice to
insert frontmatter with a python regex anchored on a `created-by:` line the card did not have —
both inserts **failed silently**, the card claimed a park it did not carry, and `trddgrep validate`
reading its usual 5 ERRORs was consistent with the fields being ABSENT, so running it confirmed
nothing. A create verb would have written `created-by:` in the first place; a lint-on-write would
have refused the no-op.

**BOOTSTRAP NOTE, stated rather than hidden:** this card itself is hand-authored, because the verb
it asks for does not exist. It is the LAST card that may be, and box 1 is what makes that true.

## Acceptance

- [ ] `trddgrep new --title … --column … --task-type …` creates a card with EVERY mandatory field
      populated (including `assignee`/`created-by`, whose absence is today's `META-MISSING`), a
      minted collision-checked id, both timestamps, and the correct zone folder — then lints it and
      refuses to leave a file that would not pass `validate`
- [ ] Same for `prrdgrep` (a rule) and `specgrep` (a clause/spec), or a recorded reason why the
      shape differs
- [ ] Every write path (`new`, `edit`, `fix`) lints AFTER the write and reports non-autofixable
      findings on stderr; a write that would leave the file invalid is refused, not warned about
- [ ] A neuter recorded for each: break the post-write lint, confirm exactly one named test reds
- [ ] The three tools' `help` states the mandate and points at `PRRD G12.1`
- [ ] `META-MISSING` reaches 0 on the corpus, or each remaining case is explained in place

### The model is `memgrep` — match its surface, not just its linter (USER, 2026-08-27)

*"take example from the memgrep tool from the janitor. it handles all: creating, updating,
recalling, migrating, merging, splitting, etc. For TRDD the trddgrep must also handle the
transition from the proposal folder to the tasks folder and finally the archived folder
automatically."*

memgrep's verbs, measured: `new-page` · `add-atom` · `add-lesson` · `edit` · `migrate` · `lint` ·
`validate` · `recall` · `find` · `overview` · `atom` · `links` · `index` · `reindex`. trddgrep has
only the QUERY + `lint`/`validate`/`fix`/`edit` half; every verb that CREATES or MOVES is missing.

- [ ] **`trddgrep move <id> <column>` performs the column edit AND the zone `git mv` as ONE
      operation.** This is the sharpest case: a transition today is two hand steps — edit
      `column:`, then `git mv` between `design/proposals|tasks|archived|refused` — and doing one
      without the other is how a card ends terminal-in-the-open-zone (this session shipped exactly
      that defect once already, and its own linter caught it). The verb picks the zone from the
      target column, bumps `updated:`, appends the `## Approval log` line where the transition
      requires one, and refuses a transition the column state machine forbids
- [ ] **`split` / `supersede` / `merge`** — the derived-TRDD operations, which today are pure
      hand-authoring: creating NPT/EHT children with `parent-trdd:` + the parent's `npt:`/`eht:`
      back-pointers written on BOTH ends (the depth-1 invariant the D4 watchdog checks), and
      `supersede` writing `superseded-by:` + archiving as itself
- [ ] **`migrate`** — the on-next-touch field migrations the rules already mandate
      (`approval-tier:` → `min-approval-requirement:`, v1 `status:` → `column:`), applied by the
      tool instead of by each agent remembering
- [ ] **Structured field updates** (`set`, `add-box`, `check-box`, `append-state`) so an agent
      never regex-patches frontmatter — the failure that produced TWO silent no-ops on
      TRDD-GFX57106 this session
- [ ] **The TRDD pre-write gate is a NO-OP today — make it real.** `pillarPreWriteCheck` early-
      returns `() => {}` for any kind that is not `per-line` (`lib/pillar/edit-guard.ts:181`;
      `lintPillarLines` likewise at `:373`), and TRDD is `mode: 'per-document'`
      (`lib/pillar/kinds.ts:127`) while prrd and spec are `per-line` (`:162`, `:196`). So
      `trddgrep edit` gives the lock + CAS staleness guard and NO field validation: it writes
      `column: banana` without complaint. `PRRD G12.1` carries a measured caveat saying so until
      this box is done
- [ ] **`fix` (the autofixer) is never invoked automatically by any write path** — the USER's
      directive is "detect AND fix the autofixable"; today `fix` is a verb a human remembers to
      run. Wire it into the write paths, or record why not

## Approval log

- 2026-08-27T19:07:35+0200 — MANDATE issued by the USER (min-approval-requirement: none; issuer authority >= approver).
  Pre-approved: no approval request was sent. The USER also set `PRRD G12.1` the same minute.
