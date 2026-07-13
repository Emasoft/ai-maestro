---
trdd-id: JT3U4ZVM
title: fleet blocker — every role-plugin install fails because Claude Code cannot resolve a VERSIONED plugin dependency
column: dev
created: 2026-07-13T06:15:10+0200
updated: 2026-07-13T06:15:10+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 0
severity: CRITICAL
effort: S
labels: [fleet-blocker, plugins, claude-code-upstream, role-plugins]
task-type: bugfix
scope: project
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T06:15:10+0200
created-by: ai-maestro-dev-session
derived: false
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: cross-repo-issues
target-branch: governance-rules
test-requirements: [manual]
audit-requirements: []
review-requirements: []
impacts: [agent-lifecycle, role-plugins, fleet]
attempts: 0
implementation-commits: []
external-refs: ["cc-version:2.1.207", "gh:Emasoft/ai-maestro-architect-agent#25", "gh:Emasoft/ai-maestro-assistant-manager-agent#25", "gh:Emasoft/ai-maestro-chief-of-staff#25", "gh:Emasoft/ai-maestro-orchestrator-agent#28", "gh:Emasoft/ai-maestro-integrator-agent#22", "gh:Emasoft/ai-maestro-programmer-agent#26", "gh:Emasoft/ai-maestro-maintainer-agent#28", "gh:Emasoft/ai-maestro-autonomous-agent#13"]
---

# TRDD-JT3U4ZVM — Versioned plugin dependencies are unresolvable, and they brick the whole fleet

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-13

- **State:** ROOT CAUSE PROVEN (empirically, 2026-07-13). The fix lands in OTHER repos
  (the 8 role-plugin repos) → delivered as cross-repo ISSUES, not commits here.
- **The one-liner:** Claude Code **2.1.207 cannot resolve ANY versioned plugin
  dependency** — it reports `has no git tag satisfying <range>` no matter what tags
  exist. All 8 role-plugins declare `dependencies: [{name: ai-maestro-plugin, version:
  ^2.x}]`, so **every role-plugin install fails**, and with it CreateAgent / ChangeTitle
  (R9.13 requires exactly one ROLE per agent). This — not the harness — is what stops
  the fleet from standing up.
- **DONE:** the fix issue is filed on all 8 role-plugin repos (see `external-refs`) —
  drop the `version` field from the dependency entry, keep `{"name":
  "ai-maestro-plugin"}`, publish.
- **NEXT ACTION:** wait for the 8 repos to publish, then
  `claude plugin marketplace update ai-maestro-plugins` and verify a real install
  (`claude plugin install ai-maestro-maintainer-agent@ai-maestro-plugins --scope local`
  in a scratch dir). Stale installed copies still contribute their old pins, so
  re-install/upgrade the role-plugins on this host afterwards. Remaining optional item:
  report the CLI bug upstream (needs USER approval — a public post to a third-party
  tracker under the owner's identity).

## Problem

`claude plugin install <role-plugin>@ai-maestro-plugins` fails for **every** role-plugin:

```
✘ Failed to install plugin "ai-maestro-maintainer-agent@ai-maestro-plugins":
  Dependency "ai-maestro-plugin@ai-maestro-plugins" has no git tag satisfying >=2.7.9 <3.0.0-0 >=2.7.0
```

`ai-maestro-plugin` has annotated tags `v2.7.0 … v2.8.0` AND matching GitHub releases.
`git ls-remote --tags` lists them. The resolver sees none of them.

## Root cause (proven, not inferred)

A synthetic two-plugin marketplace (local git repos, `/tmp`) isolates it. Consumer
declares a dependency on a provider whose repo carries the satisfying tag:

| dependency spec in the consumer's `plugin.json` | result |
|---|---|
| `{"name":"tagdep"}` — **no version** | ✅ installs, **and auto-installs the dependency** |
| `{"name":"tagdep","version":"1.0.0"}` (exact) | ✘ `no git tag satisfying 1.0.0` |
| `{"name":"tagdep","version":">=1.0.0"}` | ✘ `no git tag satisfying >=1.0.0` |
| `{"name":"tagdep","version":"^1.0.0"}` | ✘ `no git tag satisfying >=1.0.0 <2.0.0-0` |
| `{"name":"tagdep","version":"~1.0.0"}` | ✘ `no git tag satisfying >=1.0.0 <2.0.0-0` |

Every other variable was eliminated — each of these fails identically:

- tag naming: **`v1.0.0` and bare `1.0.0`** (both present on the same commit),
- tag kind: **lightweight** (synthetic) and **annotated + GitHub-released** (real repo),
- marketplace source type: **`{"source":"url","url":"…​.git"}`** (what we ship) and
  **`{"source":"github","repo":"owner/name"}`**; `{"source":"git",…}` is rejected
  outright as an unsupported source type on 2.1.207,
- transport: `https://github.com/…` and local `file://`.

Unconstrained installs work; the moment a *version* is attached to a dependency the
resolver enumerates git tags and finds **zero**. It is a Claude Code bug, not a
packaging error on our side.

**Why it poisons even a plugin that is innocent.** The constraint set is the UNION over
every *installed* dependent, so:
- `ai-maestro-autonomous-agent` declares its dependency with **no version** — yet it
  still fails, inheriting `>=2.7.0` from the other role-plugins already installed;
- installing the core plugin *by itself* fails for the same reason.

So the repair must be applied to **all 8 at once**; one straggler keeps the fleet down.

## Blast radius

| repo | version | declared dependency |
|---|---|---|
| ai-maestro-plugin (core) | 2.8.0 | — (none) |
| ai-maestro-architect-agent | 2.11.0 | `^2.7.0` |
| ai-maestro-assistant-manager-agent | 2.12.12 | `^2.6.0` |
| ai-maestro-chief-of-staff | 2.20.6 | `^2.6.0` |
| ai-maestro-orchestrator-agent | 1.9.3 | `^2.6.0` |
| ai-maestro-integrator-agent | 1.3.7 | `^2.7.0` |
| ai-maestro-programmer-agent | 1.4.4 | `^2.7.0` |
| ai-maestro-maintainer-agent | 1.7.9 | `^2.7.9` |
| ai-maestro-autonomous-agent | 1.5.3 | *(no version — still blocked by the union)* |

Downstream: `ChangeTitle` Gates 15-16 and `CreateAgent` install the role-plugin; R9.13
hard-rejects an agent with zero role-plugins. The server logs have been carrying
`G16: WARN — Failed to install "ai-maestro-architect-agent"` since at least 2026-07-11.

## Proposed fix

1. **In each of the 8 role-plugin repos** — drop the `version` field from the dependency
   entry, keeping the relationship:
   ```json
   "dependencies": [{ "name": "ai-maestro-plugin" }]
   ```
   Proven to install AND to auto-install the dependency. Publish via each repo's own
   `publish.py`.
2. **After all 8 publish:** `claude plugin marketplace update ai-maestro-plugins`, then
   verify with a real install. Stale installed copies still contribute their old pinned
   constraints, so re-install/upgrade the role-plugins on the host.
3. **Not a regression risk for the version floor:** the floor was never enforced anyway
   (the constraint has been *failing closed* since the feature shipped), and ai-maestro
   independently guarantees the core plugin via the R17 `core-plugin` invariant
   (`lib/agent-invariants.ts`), which installs it on every wake.
4. **Upstream (needs USER approval — public, third-party, owner identity):** report to
   the Claude Code tracker that versioned `dependencies` resolution finds no tags on
   2.1.207 for `url`/`github` sources, with the reproduction table above.

## Verification

- `claude plugin install ai-maestro-maintainer-agent@ai-maestro-plugins --scope local`
  succeeds in a scratch dir.
- Creating an agent with a MAINTAINER title through the dashboard reaches
  `G16: installed` instead of `G16: WARN — Failed to install`.

## Approval log

- 2026-07-13T06:15:10+0200 — **MANDATE** (Tier 0 authoring: an investigation TRDD in this
  repo's own design corpus; the code fix is delivered as issues on the plugin repos, per
  the cross-project rule). Root cause established empirically before authoring.

## Notes

The investigation is reproducible: `/tmp/aim-tagtest2` holds the two-plugin synthetic
marketplace used above (a dependency-free provider + a consumer whose `dependencies`
spec is the only variable).
