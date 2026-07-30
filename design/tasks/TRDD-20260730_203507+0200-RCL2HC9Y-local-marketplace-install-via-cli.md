---
trdd-id: RCL2HC9Y
title: Decide by live test whether the claude CLI can install from a directory marketplace
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: todo
created: 2026-07-30T20:35:07+0200
updated: 2026-07-30T20:39:45+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: spike
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T20:35:07+0200
derived: true
derived-kind: eht
parent-trdd: 0GCIMQ9F
relevant-rules: [R20]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

TRDD-OWO449MR removed the hand-written `installed_plugins.json` row that `installPluginLocally`
appended on the LOCAL-ONLY marketplace branch. That branch still does NOT call the CLI, because its
comment claims the CLI cannot resolve a directory marketplace — and that claim is probably stale.

NEXT ACTION: run ONE live `claude plugin install <name> ai-maestro-local-roles-marketplace --scope
local --cwd <a throwaway dir>` and read the result. Everything else here follows from that one
observation, and nothing should be changed before it.

## Problem

`installPluginLocally` splits on `isLocalOnlyMarketplace`. For a GitHub marketplace it shells out to
`claude plugin install`; for `ai-maestro-local-roles-marketplace` /
`ai-maestro-local-custom-marketplace` it writes `settings.local.json` directly, on the stated
grounds that those plugins "cannot be resolved by Claude CLI's marketplace lookup".

**Evidence that the claim is stale** (all read first-hand on this host, 2026-07-30):

- Both local marketplaces ARE registered in `~/.claude/settings.json` `extraKnownMarketplaces` —
  and putting them there is the entire purpose of the one ratified out-of-root carve-out
  (`lib/write-boundary.ts`, TRDD-QZL828OD D2).
- `installed_plugins.json` carries **7** rows whose key ends `@ai-maestro-local-roles-marketplace`.
  Six have `installPath: ~/agents/role-plugins/plugins/<name>` — the hand-forged shape, from a
  constant that has since been deleted, naming a directory that does not exist and never has.
- The seventh carries
  `installPath: ~/.claude/plugins/cache/ai-maestro-local-roles-marketplace/backend-infrastructure-engineer/1.0.0`
  — the CLI's own cache layout, a shape ai-maestro's code cannot produce. Something installed a
  local-marketplace plugin THROUGH THE CLI at least once.

**Why it was not settled inside OWO449MR.** "Probably" is not a basis for changing how every
Haephestos-authored custom plugin installs. The evidence above is strong but circumstantial: the
cache directory for that marketplace does NOT currently exist (`find` → 0), so the seventh row may
be a survivor of a since-pruned install rather than proof of a working path today. Only a live run
settles it, and a live run is a deliberate act, not a side effect of a refactor.

## Proposed fix

1. Run the live install into a throwaway directory. Record the exit code, stderr, whether
   `~/.claude/plugins/cache/ai-maestro-local-roles-marketplace/<name>/` appears, and whether a row
   lands in `installed_plugins.json`.
2. **If it works** — collapse the branch: `installPluginLocally` and `uninstallPluginLocally` route
   every marketplace through the CLI, `isLocalOnlyMarketplace` disappears from both, and the stale
   comment goes with it. This also closes a real asymmetry OWO449MR left behind: a Haephestos custom
   is currently invisible to `installed_plugins.json`, so DeleteAgent's G08c finds no row for it and
   never uninstalls it — the workdir is deleted and `settings.local.json` goes with it, which is
   harmless today only because that file lives inside the workdir.
3. **If it does not work** — record the exact failure in this card and REPLACE the branch's comment
   with the observed reason, so the next reader inherits evidence instead of a claim. Then decide
   whether the local marketplaces should be registered differently.

Either way the card ends with the comment in the code being TRUE, which is the actual deliverable.

## Verification

- The live run's output is pasted into this card verbatim — a spike whose evidence lives only in a
  session transcript has not been done.
- If the branch collapses: `tests/unit/installed-plugins-records.test.ts` gains a case proving a
  local-marketplace install now goes through the CLI, and the "writes NO record" test is re-pointed
  rather than deleted (the property becomes "we still do not write it BY HAND").
- `yarn test` green; the write-boundary ratchet still shows an empty UNRATIFIED set.

## Estimated risk

LOW to investigate, MEDIUM to act on. The investigation is one command in a throwaway directory.
Acting on it changes the install path of every Haephestos-authored role-plugin, which is why it is
gated behind the observation rather than bundled into the refactor that surfaced it.

## Approval log

- 2026-07-30T20:35:07+0200 — MANDATE (self, min-approval-requirement: none). Split out of
  TRDD-OWO449MR: that card's job was to stop writing another tool's file, and it did. Whether we
  should additionally START ASKING that tool on a branch that currently asks nobody is a separate
  question with its own evidence requirement.
- 2026-07-30T20:39:45+0200 — Re-parented `OWO449MR` → `0GCIMQ9F`. The work that surfaced this hole
  is OWO449MR's, but OWO449MR is itself derived, and a derived TRDD may neither own an `eht:` nor be
  a `parent-trdd:` (depth-1). So this card is OWO449MR's SIBLING under their shared parent, and the
  ordering is carried by `OWO449MR.blocked-by: [RCL2HC9Y]` rather than by a parent link. Caught by
  `trddgrep validate` — two ERRORs on my own board, not by review.
