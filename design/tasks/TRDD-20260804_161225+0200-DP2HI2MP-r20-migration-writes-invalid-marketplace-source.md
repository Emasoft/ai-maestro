---
trdd-id: DP2HI2MP
title: The R20 disk-layout migration writes a marketplace source path that claude plugin validate rejects
column: todo
created: 2026-08-04T16:12:25+0200
updated: 2026-08-04T16:12:25+0200
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: bugfix
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: governance-rules
approval-datetime: 2026-08-04T16:12:25+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 1
severity: high
effort: small
release-via: none
labels: [marketplace, migration, role-plugins]
---

# The R20 disk-layout migration writes a marketplace source path that claude plugin validate rejects

## Problem

`scripts/migrate-r20-disk-layout.sh:396` writes a plugin's marketplace source as

```python
p['source'] = 'roles-marketplace/' + base
```

with **no leading `./`**. Claude Code rejects that form, and because a manifest is validated as a
whole, ONE bad entry fails the ENTIRE marketplace — every plugin registered in it becomes
uninstallable, not just the one with the malformed path.

Measured on this machine 2026-08-04 (read-only, `claude plugin validate`, CC 2.1.221):

```text
$ claude plugin validate ~/agents/role-plugins        # exit 1
Validating marketplace manifest: …/agents/role-plugins/.claude-plugin/marketplace.json
✘ Found 1 error:
  ❯ plugins.5.source: Invalid input
✘ Validation failed
```

Entry 5 is the only one written by the migration; the other five carry the correct prefix:

```text
[0] backend-infra-engineer            "./roles-marketplace/backend-infra-engineer"
[1] backend-infrastructure-engineer   "./roles-marketplace/backend-infrastructure-engineer"
[2] code-reviewer-agent               "./roles-marketplace/code-reviewer-agent"
[3] genny-bot                         "./roles-marketplace/genny-bot"
[4] luckas-bot                        "./roles-marketplace/luckas-bot"
[5] scenario-test-agent               "roles-marketplace/scenario-test-agent"   ← no ./
```

Every OTHER writer in this repo emits the `./` form, which is what makes the migration the odd
one out rather than the convention ambiguous:

- `services/plugin-storage-service.ts:962` and `:1071` — `` relativePath: `./${pluginName}` ``
- `lib/marketplace-skills.ts:398` — `` source: `./${entry.name}` ``
- `lib/converter/utils/plugin.ts:58` — `` p.source || p.path || `./${p.name}` ``

## Root cause

One missing two-character prefix, plus a guard written against a shape the same block does not
produce. Three distinct defects live in that one `python3 -c` heredoc:

1. **Line 396 omits `./`** — the error above. This is the whole user-visible failure.
2. **Line 395's guard contradicts line 396's write.** The skip test is
   `if '/roles-marketplace/' not in src`, but the value written back is `roles-marketplace/<base>`,
   which has no `/` before `roles-marketplace`. So a SECOND migration run re-matches the same
   entries, sets `changed = True`, and rewrites the file — reporting "Updated source paths" on a
   manifest it did not meaningfully change. `basename` keeps the value stable so it converges, but
   the run is not idempotent in its effect on the file or in what it tells the operator. Emitting
   `./roles-marketplace/<base>` fixes BOTH defects at once: the guard's substring then matches and
   a second run correctly skips.
3. **`2>/dev/null || warn` discards the reason.** A JSON parse error, a permission error and a
   full disk all surface as the same generic warn line, so an operator sees "Could not update
   marketplace manifest" with nothing to act on.

Adjacent, worth fixing in the same pass: the rewrite is a plain `open(..., 'w')` + `json.dump`,
so a crash mid-write leaves a TRUNCATED marketplace manifest — the file whose corruption makes
every plugin in it uninstallable. Write to a temp file in the same directory and `os.replace`.

## Proposed fix

In `scripts/migrate-r20-disk-layout.sh`:

- emit `'./roles-marketplace/' + base`;
- keep the guard as-is (it becomes correct once the written value carries the prefix), and add a
  short comment naming WHY the `./` is load-bearing, so the next edit does not drop it again;
- surface python's stderr in the `warn` instead of discarding it;
- make the rewrite atomic (temp file in the same dir + `os.replace`).

Then repair the one live manifest. **It is outside this repo and outside git** — do NOT hand-edit
it as part of the fix; re-run the corrected migration (or leave it, since all six entries there
belong to scenario litter) and record which was done.

## Verification

- `claude plugin validate ~/agents/role-plugins` → exit 0 after the manifest is regenerated.
- A test over the migration's rewrite: seed a manifest with a prefix-less source, run the block,
  assert the result validates AND that a second run reports no change. The second-run assertion
  is the one that pins defect 2 — a test that only checks the written value passes with the
  contradictory guard still in place.
- Positive control for that test: seed an ALREADY-correct manifest and assert the first run
  reports no change, so "no change" is not simply what the block always says.

## Estimated risk

**LOW to fix, HIGH if left.** The edit is two characters plus error plumbing. Left alone, any host
that ran the R20 migration has a local role-plugin marketplace that fails validation wholesale,
and the symptom a user sees is the unrelated-looking "plugin not found in marketplace" — see the
`marketplace-manifest-format` memory page, which documents that symptom for a different malformed
source shape.

## Approval log

- 2026-08-04T16:12:25+0200 — MANDATE (self). Tier 0: a bugfix confined to this repo's own script,
  no baseline deviation, no cross-team or release surface. No approval request was sent.

## Acceptance

- [ ] `scripts/migrate-r20-disk-layout.sh` emits `./roles-marketplace/<base>`
- [ ] the second-run-is-a-no-op behaviour is pinned by a test, with a positive control
- [ ] python's stderr reaches the operator instead of `/dev/null`
- [ ] the manifest rewrite is atomic (temp + `os.replace`)
- [ ] `claude plugin validate ~/agents/role-plugins` exits 0, OR the card records why the live
      manifest was deliberately left alone
