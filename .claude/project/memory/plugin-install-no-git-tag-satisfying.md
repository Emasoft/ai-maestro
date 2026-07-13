---
name: plugin-install-no-git-tag-satisfying
description: "a plugin install fails with 'has no git tag satisfying >=X <Y' even though the tags exist — role-plugins refuse to install, ChangeTitle G16 warns, agents end up with no ROLE"
ocd: 2026-07-13
lmd: 2026-07-13
metadata:
  node_type: memory
  type: project
  tier: component
---

^plugin-dep-versioned-deps-are-unresolvable [desc: claude_code_cannot_resolve_any_versioned_plugin_dependency_and_reports_no_git_tag_satisfying, keywords: has no git tag satisfying, plugin install fails dependency, role plugin will not install, ChangeTitle G16 failed to install, agent has no role plugin, ocd: 2026-07-13, lmd: 2026-07-13]
**Claude Code (verified on 2.1.207) cannot resolve ANY *versioned* plugin dependency.**
It reports `Dependency "<dep>" has no git tag satisfying <range>` while the tags exist
and `git ls-remote --tags` lists them. Proven by isolating the dependency's version spec
as the only variable:

| `dependencies` entry | result |
|---|---|
| `{"name":"dep"}` — **no version** | ✅ installs, and still **auto-installs** the dependency |
| `"version"` = exact · `>=` · `^` · `~` | ✘ `no git tag satisfying …` — every time |

Ruled out (each fails identically): `v`-prefixed **and** bare tags; lightweight **and**
annotated+GitHub-released tags; marketplace source `{"source":"url"}` **and**
`{"source":"github"}` (`{"source":"git"}` is rejected as an unsupported source type);
`https://` **and** `file://` transports.

**The constraint set is the UNION over every INSTALLED dependent.** So a plugin that
declares no version pin *still* fails, inheriting the range from other installed
plugins — and installing the dependency by itself fails too. One straggler with a pin
keeps everything down; the repair must land on all dependents at once.

**Workaround (the only one that works):** declare the dependency WITHOUT a version —
`"dependencies": [{"name": "ai-maestro-plugin"}]`. Restore the pin only after the
upstream resolver is fixed.

^plugin-dep-fleet-impact-role-plugins [desc: why_this_one_cli_bug_stops_every_agent_from_getting_a_role, keywords: no agent can get a role, CreateAgent fails role plugin, R9.13 rejects agent with zero role plugins, fleet cannot stand up, ocd: 2026-07-13, lmd: 2026-07-13]
All 8 ai-maestro role-plugins pinned `^2.x` on `ai-maestro-plugin`, so **every
role-plugin install failed**. `ChangeTitle` (Gates 15-16) and `CreateAgent` install the
role-plugin, and R9.13 hard-rejects an agent with zero role-plugins — so this single
upstream bug is what stopped the MANAGER/MAINTAINER fleet from standing up. The
server had been logging `G16: WARN — Failed to install …` since at least 2026-07-11.

Tracked as TRDD-JT3U4ZVM; the fix was filed as an issue on each of the 8 plugin repos
(cross-project rule: never edit another project's tree — file an issue or a PR).

Dropping the pin is safe: it never held anything (the constraint has been *failing
closed* since the feature shipped, so no install ever succeeded with it), and ai-maestro
independently guarantees the core plugin at runtime via the R17 `core-plugin` invariant
in `lib/agent-invariants.ts`, which installs it on every wake.

## Notes and lessons learned

[^1]: [ocd:2026-07-13 lmd:2026-07-13] The first two hypotheses were both wrong and both
  *plausible*: (a) "the tags are `v`-prefixed and the resolver wants bare semver" — a
  bare tag on the same commit failed identically; (b) "the marketplace declares
  `source: url`, and tag lookup only works for a `github` source" — the `github` source
  failed identically against the real repo with a satisfiable range. What actually found
  it was reducing to a synthetic two-plugin marketplace in `/tmp` where the dependency's
  version spec was the ONLY variable. Lesson: when a resolver claims a resource does not
  exist and you can see it exists, do not keep guessing which attribute of the resource
  it dislikes — build the smallest case where you can flip one attribute at a time.
