---
trdd-id: RCL2HC9Y
title: Decide by live test whether the claude CLI can install from a directory marketplace
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: completed
created: 2026-07-30T20:35:07+0200
updated: 2026-07-30T21:58:42+0200
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
implementation-commits: [c898fa90, c0ebd710, 6396ace2]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30 22:10

**DONE.** The spike ran, the branch is collapsed, and the collapse turned out to be COMPLIANCE
work rather than the cleanup this card was scoped as.

1. **The CLI resolves a directory marketplace fine.** The branch's comment was STALE.
2. **`--cwd` is not a `claude` option, and passing it fails OPEN.** The CLI prints
   `error: unknown option '--cwd'` and **exits 0**, so `promisify(execFile)` resolves and the
   adapter returns `{success:true}` having run nothing. **Every local-scope install and uninstall
   through `claudeAdapter` had been a silent no-op** — including the `G08c` gate OWO449MR shipped
   hours earlier. Fixed in `c898fa90`: the directory is now the SPAWN cwd, which is what
   `--scope local` actually keys off.

### THE FINDING THIS CARD DID NOT EXPECT — the branch VIOLATED R20.29, and R20.29's own test held it there

`docs/GOVERNANCE-RULES.md:881` (R20.29, verdict **Explicit**) enumerates the four possible
plugin SOURCES — "(a) a GitHub URL, (b) a local folder, **(c) one of the 3 AI Maestro local
marketplaces**, or (d) a remote marketplace" — and says of ALL FOUR that "the install step
**ALWAYS invokes the client's own protocol** to write into the client's target state". Case (c)
is NAMED. The `isLocalOnlyMarketplace` branch took the one path the rule forbids, for the exact
case the rule names.

**Both enforcement-map columns were green over it:**

| column | what it said | what was true |
|---|---|---|
| Guard | `element-management-service.ts:1712-1716` | rotted onto retry-backoff code |
| Test | `tests/governance/r20-marketplace-governance.test.ts` | its case (c) test was titled *"routes a LOCAL-container source away from the CLI"* and asserted `expect(claude call).toBeUndefined()` — it **certified the violation under the rule's own name** |

**The generalisable lesson: reading a rule's CITATION is not reading the RULE.** The routing
decision the map pointed at was real, deliberate, working code, so a test written against it
passes and looks exactly like coverage. Recorded in the map's `## Notes on individual rows`.

**It was also worse than the CLI in the way that matters.** The hand-written path wrote the
`enabledPlugins` key WITHOUT fetching the plugin into `~/.claude/plugins/cache/`, so Claude
Code's resolver had a name it could not resolve — the silently role-less agent of SCEN-031,
manufactured on purpose. The uninstall half was asymmetric the other way: it removed the key and
left the CLI's cache entry and registry row behind.

### THE NEUTER PAIR — and what it caught

| neuter | red |
|---|---|
| A — restore the install-side short-circuit | **6**, all install-side |
| B — restore the uninstall-side settings-only path | **0.** Exit 0, 4395 passed over a fully reverted half |

The uninstall collapse was shipping **unpinned**: every existing uninstall case passes a REMOTE
marketplace, which took the CLI path before and after, and nothing ever passed a local one.
Neuter A alone would have certified the file while half of it was decorative — which is the
whole reason to run a complementary PAIR rather than one neuter. `6396ace2` adds the missing
case; re-running neuter B against it now reddens EXACTLY it (1 failed | 14 passed), a red set
disjoint from A's.

Nothing further is owed on this card.

## Evidence — the live runs, verbatim (this section IS the deliverable)

**The probe that found the bigger bug.** A nonexistent plugin, so nothing could mutate:

```
$ claude plugin uninstall no-such-plugin@no-such-marketplace --scope local --cwd /tmp/... -y
error: unknown option '--cwd'
--- exit: 0 ---

$ claude plugin uninstall no-such-plugin@no-such-marketplace --scope local -y     # control
✘ Failed to uninstall plugin "...": Plugin "..." not found in installed plugins
```

The control reaches the real code path; the `--cwd` form never runs the command at all. `--cwd`
appears in **no** help output — not `claude --help`, not `claude plugin --help`, not
`plugin install --help`, not `plugin uninstall --help`.

**The spike proper**, from inside a throwaway dir (`--scope local` keys off the process cwd):

```
$ cd /tmp/aim-spike.MgfqFF
$ claude plugin install backend-infra-engineer@ai-maestro-local-roles-marketplace --scope local
Installing plugin "backend-infra-engineer@ai-maestro-local-roles-marketplace"...
✔ Successfully installed plugin: backend-infra-engineer@ai-maestro-local-roles-marketplace (scope: local)

$ cat .claude/settings.local.json
{ "enabledPlugins": { "backend-infra-engineer@ai-maestro-local-roles-marketplace": true } }

$ find ~/.claude/plugins/cache/ai-maestro-local-roles-marketplace -maxdepth 2
.../ai-maestro-local-roles-marketplace/backend-infra-engineer/1.0.0
```

That cache path is the shape this card called "a shape ai-maestro's code cannot produce" — now
explained: the CLI produces it, exactly like this. The mystery seventh row was a real CLI install.

**The row it wrote, beside the hand-forged one, same plugin key** — the cleanest possible statement
of what OWO449MR was about:

```json
{ "scope":"local", "projectPath":"/Users/…/agents/jhonny-bot",
  "installPath":"/Users/…/agents/role-plugins/plugins/backend-infra-engineer" },   ← ours, forged, path never existed
{ "scope":"local", "projectPath":"/private/tmp/aim-spike.MgfqFF",
  "installPath":"/Users/…/.claude/plugins/cache/ai-maestro-local-roles-marketplace/backend-infra-engineer/1.0.0" }   ← the CLI's
```

**Cleanup, through the owning CLI** (`uninstall … --scope local -y` from the same cwd) removed the
CLI's row and left the forged one untouched. That is this card's second first-hand confirmation of
OWO449MR's STATE note: an orphan row the CLI does not believe in **cannot** be retracted by
`claude plugin uninstall`, so it is residue only the USER can authorise removing.

## Why the bug survived — and the guard that now stops it

Nothing tested the argv. The only test driving this path (`deleteagent-g08c-plugin-uninstall`) uses
a **fake adapter** and asserts `targetDir` and `scope` at the adapter BOUNDARY — the right altitude
for the gate's ordering, and structurally incapable of seeing that the real adapter turns those two
values into an invalid command line. OWO449MR's own STATE block flagged this as caveat 1. The
caveat was correct and the thing it warned about was already true.

`tests/lib/claude-adapter-cli-argv.test.ts` (14 tests) now asserts the two halves separately,
because the bug is exactly a swap between them: the directory must be in the SPAWN OPTIONS and must
NOT be in the arguments. Complementary neuters, disjoint red sets: restoring `--cwd` on install
reds 4 (all install-side), on uninstall reds 3 (all uninstall-side).

**Not filed upstream:** `claude` exiting 0 on an unknown option is arguably a CLI bug, but that
repo is not the user's — needs their say-so before an issue.

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
- 2026-07-30T21:58:42+0200 — COMPLETED by ai-maestro. Branch collapsed on both sides
  (`c0ebd710`), uninstall half pinned after a neuter proved it unpinned (`6396ace2`), R20.29's map
  row re-cited off a rotted line range onto `(CreateAgent::G08)` with the finding recorded in the
  map's Notes. `bash scripts/with-node.sh yarn test` → 4396 passed | 2 skipped; `yarn build` → exit
  0; `tsc --noEmit` → clean; the enforcement ratchet → 10 passed. Unblocks `OWO449MR`.
