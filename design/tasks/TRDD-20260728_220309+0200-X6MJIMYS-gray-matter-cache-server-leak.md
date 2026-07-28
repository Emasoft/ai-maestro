---
trdd-id: X6MJIMYS
title: gray-matter caches every parsed file forever, leaking in the long-lived server
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-28T22:03:09+0200
updated: 2026-07-28T22:03:09+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-28T22:03:09+0200
priority: 1
severity: major
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
implementation-commits: []
external-refs: []
---

# gray-matter caches every parsed file forever, leaking in the long-lived server

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-28

**RESOLVED.** All four production call sites now pass `NO_MATTER_CACHE`
(`lib/gray-matter-nocache.ts`), and `tests/unit/gray-matter-nocache.test.ts` fails on a fifth.

## The defect

`gray-matter@4.0.3` keeps a **module-level cache keyed by each file's full text** and stores the
parsed file including its `orig`:

```js
const cached = matter.cache[file.content]
if (!options) {
  if (cached) { /* …return it… */ }
  // only cache if there are no options passed.
  matter.cache[file.content] = file
}
                                    // index.js:35-47
```

Nothing evicts it. So a process's memory tracks **total bytes ever parsed**, regardless of what
the caller keeps.

In a CLI that is a bounded cost. In the **long-lived AI Maestro server** it is an **unbounded
leak**, because the corpora it parses are unbounded — every `SKILL.md` of every marketplace it
browses, every element of every plugin it converts. Verified reachable from the server, not
assumed: `lib/marketplace-skills.ts` ← `services/marketplace-service.ts` /
`agents-skills-service.ts` / `agents-transfer-service.ts`; `lib/converter/utils/frontmatter.ts` ←
the whole converter chain ← `services/plugin-storage-service.ts` (ChangeClient);
`services/plugin-builder-service.ts` (its own scan).

## How it was found

While fixing the pillar linter's memory at 10⁵ (TRDD-BQC8NQSW, `commit fc53ce99`), where the same
cache turned a lint into an OOM crash. Fixing the reader was the card's scope; grepping for OTHER
`matter(` call sites was not — and it turned up **three more in subsystems that had nothing to do
with that card**, none of which any measurement was pointed at. The card's fix would have shipped
with the server leak untouched.

## The fix

One owner: `lib/gray-matter-nocache.ts` exports `NO_MATTER_CACHE`. gray-matter skips the cache
whenever ANY options object is passed, and `defaults()` is `Object.assign({}, options)`, so `{}` is
behaviourally identical to passing nothing. It changes no parsing; it only declines to leak.

**A behavioural test could not have covered this**, because it can only exercise the call sites
someone remembered — exactly the set already correct. So the guard is SOURCE-LEVEL: it scans every
tracked file that imports gray-matter and fails on a one-argument call, naming file:line.

## The lesson this cost

**The first version of that guard pinned nothing, and its positive control hid it.** The scan used
the git pathspec `lib/**/*.ts`, whose `**/` requires a directory: it matched **71 nested files and
zero top-level ones**, so it was blind to `lib/marketplace-skills.ts` — one of the three files the
test exists to protect. The neuter run caught it (reverting that call site left the suite green).
The positive control did NOT, because it asserted the list contained `lib/pillar/store.ts` — a
*nested* path, which is precisely what the broken glob still matched.

**A positive control must be chosen to falsify the failure you fear, not merely to prove the list
is non-empty.** The control now asserts both a nested and a top-level path.

## Acceptance

- [x] Every production `matter()` call site passes options — 4 sites: `lib/pillar/store.ts`,
      `lib/marketplace-skills.ts`, `lib/converter/utils/frontmatter.ts`,
      `services/plugin-builder-service.ts`
- [x] A guard fails on a fifth — NEUTER-VERIFIED: reverting `marketplace-skills.ts` fails the
      named test with `lib/marketplace-skills.ts:166  const parsed = matter(content)`
      (1 failed / 4 passed), and passes again when restored
- [x] The guard cannot pass vacuously — its own control asserts >200 scanned files including a
      nested AND a top-level path, and a regex control proves the pattern catches the defective
      form while ignoring `matter.stringify(...)`
- [x] The constant is falsy-proof — gray-matter branches on `if (!options)`, so a `null`/`undefined`
      would silently restore the cache; a test asserts it is a truthy object
- [x] tsc clean; full suite 258 files / 3870 passed / 2 skipped

## Not done here, deliberately

No issue filed upstream on `gray-matter`. It is not the user's repository, and the standing rule
is to wait for the user's permission before filing on third-party projects. Worth raising: the
package is effectively unmaintained (4.0.3), and the cache is on by default with no documented
opt-out beyond "pass any options object".

## Approval log

- 2026-07-28T22:03:09+0200 — SELF-MANDATE (min-approval-requirement: none). A Tier-0 bugfix
  inside the assignee's own scope, found while working TRDD-BQC8NQSW. No approval request sent.
