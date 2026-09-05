---
trdd-id: 4O8YRCBL
title: Fleet audit — publish.py template erases changelog history and reuses stale tags on recovery
column: todo
created: 2026-08-25T23:00:30+0200
updated: 2026-09-05T18:38:03+0200
current-owner: ai-maestro-e5
created-by: ai-maestro-e5
assignee: ai-maestro-e5
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: self
scope: project
project-id: ai-maestro
labels: [fleet, publish-pipeline, audit]
external-refs: [claude-plugins-validation#216]
---

# Fleet audit — publish.py template erases changelog history and reuses stale tags on recovery

## Problem — two independent template defects, both measured in live repos 2026-08-25

1. **Changelog erasure** (web-scenario-tester, verified in their repo): the shared publish.py
   template runs `git-cliff --unreleased -o CHANGELOG.md`, which REPLACES the whole file with
   only the unreleased section — every prior release's history is destroyed on each publish
   (had already eaten their 0.1.1/0.1.2 sections). Fix shipped in their v0.1.4: `--prepend`
   instead of `-o`, history restored.
2. **Stale-tag recovery** (orchestrator, filed as claude-plugins-validation#216): publish.py's
   interrupted-publish recovery reuses a stale LOCAL tag, so a released tag can EXCLUDE the fix
   that unblocked the retry.

Both are TEMPLATE bugs: any fleet repo sharing the publish.py canonical pipeline may carry
them. The hub repo itself has no publish.py (verified) — this is a coordination audit, not a
hub code change.

## Task

- Sweep the fleet repos' `scripts/publish.py` for `git-cliff` invocations using `-o`/`--output`
  on CHANGELOG.md; list carriers.
- For each carrier: check whether the changelog has ALREADY lost sections (compare against
  GitHub releases list — releases that exist with no changelog section are the symptom).
- Route the fix per how-to-fix-other-projects: the canonical template's owner (CPV canonical
  pipeline) gets the upstream issue; per-repo sessions get a ping with the exact `--prepend`
  diff. #216 already covers the stale-tag half upstream — cross-cite, don't duplicate.

## Acceptance

- [x] Carrier list produced (repo → git-cliff invocation shape), with the sweep command recorded.
- [ ] Upstream issue filed (or an existing one cited) on the template owner for the erasure bug;
      #216 cross-referenced for the recovery bug.
- [ ] Each live carrier's session pinged with the finding + fix shape (their repo, their edit).

## Approval log

- 2026-09-05T18:37:56+0200 — BOX 1 DONE (read-only sweep by a lean-worker, GitHub Contents API, default branches; report reports/lean-worker/20260905_183426+0200-4O8YRCBL-carrier-sweep.md). Sweep command: for each ecosystem repo (lib/ecosystem-constants.ts set + CPV, janitor, ai-maestro-plugin, claude-plugin, agent-identity, AgentlensPro) "gh api repos/<owner>/<repo>/contents/scripts/publish.py --jq .content | base64 -d" then "grep -n -E \"-o\"|--output|--prepend"; 404s confirmed by "gh api search/code?q=filename:publish.py+repo:<r>". RESULT: 17 repos, 0 unreadable. FIVE REPLACE carriers still on "--bump --unreleased --tag vX -o CHANGELOG.md" with the identical wrong docstring: ai-maestro-architect-agent (L926-931), ai-maestro-assistant-manager-agent (L903-911), ai-maestro-chief-of-staff (L926-934), ai-maestro-maintainer-agent (L1685), ai-maestro-orchestrator-agent (L1687-1707). SEVEN fixed: autonomous, programmer (drop --unreleased), ai-maestro-plugin (--prepend), integrator (--prepend), janitor (drop --unreleased; its docstring calls --prepend the wrong fix), claude-plugins-validation — the TEMPLATE OWNER, already fixed (canon v5.3.0 per CPV#204 / ai-maestro#62), assistant-role (plus a section-count guard). FIVE with no publish.py: ai-maestro, ai-maestro-plugins, claude-plugin, agent-identity, AgentlensPro. Box 2: the upstream issue already exists (CPV#204 / ai-maestro#62) — citing it here; the #216 cross-reference comment and box 3 (pinging five carriers) are GitHub writes and wait for the owner. Stale-tag half not swept (out of box-1 scope; #216).
