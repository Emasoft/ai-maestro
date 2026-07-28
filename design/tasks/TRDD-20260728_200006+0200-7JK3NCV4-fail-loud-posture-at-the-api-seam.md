---
trdd-id: 7JK3NCV4
title: Choose the fail-loud posture once at the store API seam not per call site
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T20:00:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: npt
parent-trdd: L55IYKL4
priority: 0
severity: major
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: [Emasoft/ai-maestro#96]
---

# Choose the fail-loud posture once at the store API seam not per call site

## The problem

`lib/trdd-store.ts:112-114` turns every read failure into an empty corpus:

```ts
export function listTrddFiles(designDir: string, zone: TrddZone): string[] {
  const dir = path.join(designDir, zone)
  try { return fs.readdirSync(dir).filter(...).map(...) }
  catch { return [] }          // ← a missing zone and an unreadable zone are the same answer
}
```

Both CLIs then compound it — `path.join(process.cwd(), 'design')` with no existence check
(`greptrdd.mjs:53`, `trdd-doctor.mjs:23`), so `greptrdd validate` run from the wrong directory
prints zero rows and **exits 0**. Its own help calls `validate` "the WRITE GATE". A gate that passes
because it read nothing is the failure this whole parent exists to eliminate (ai-maestro#96 L2: *a
parser with a silent `continue` is a data-loss engine*).

## Why a decision is needed before the fix

Making `listTrddFiles` throw is not free. Verified blast radius:

- **Direct callers — 5 files, all internal**: `lib/trdd-doctor.ts`, `lib/kanban-index.ts`,
  `lib/trdd-graph.ts`, `scripts/greptrdd.mjs`, `scripts/trdd-doctor.mjs` (+ one test).
- **No `app/` route and no `services/` file calls it directly.** They go through the exported
  `searchTrdds` / `readTrdd` / `findTrdd`, which call it internally — **so a throw still reaches
  HTTP**.

That is the whole decision: a 500 on a transient permissions blip is a regression, and a silent `[]`
is the bug being fixed. The answer must be chosen once, in those exported functions, not sprinkled
across call sites — sprinkling is how `lib/kanban-index.ts:143` and `lib/trdd-doctor.ts:137-140`
came to disagree about identical input in the first place.

## The shape to decide

1. `ENOENT` on a **zone** is legal (a fresh project has no `refused/`) → empty, no error.
2. `ENOENT` on the **designDir itself** is fatal — it means "you are not where you think you are".
3. Any other errno (`EACCES`, `EIO`, `ELOOP`) is **never** an empty zone → surface it.
4. Route-facing exports (`searchTrdds`/`readTrdd`/`findTrdd`) decide whether that surfaces as a
   throw, a partial result carrying a diagnostic, or a typed error — one policy, stated once.
5. Exit codes for the CLIs: `0` clean · `1` findings · `2` **the check could not run**.

## Acceptance

- [ ] A one-paragraph posture is recorded and implemented in exactly one place per layer
- [ ] A non-ENOENT read failure cannot produce an empty result anywhere in the store
- [ ] `greptrdd validate` against a nonexistent corpus exits **2**, never 0
- [ ] The three API-level suites still pass unchanged: `api-team-tasks-trddv2-fields`,
      `headless-router-trdd-ordering`, `manage-trdd-authorization`
- [ ] Every new guard has a recorded neuter run (break it → the *named* test fails)

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
