---
trdd-id: OOCL7ABZ
title: Consolidated agent-config endpoint with teams, normalized github repo, docker detection, tasks, AID
column: complete
created: 2026-07-09T10:27:08+0200
updated: 2026-07-09T15:58:00+0200
implementation-commits: [04676a37]
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
effort: M
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: [TRDD-280DF70U]
relevant-rules: []
labels: [agent-config, teams, github, docker, tasks, api]
test-requirements: [unit, integration]
review-requirements: [human-review]
impacts: []
external-refs: []
---

# TRDD-OOCL7ABZ — Consolidated agent-config endpoint

Give governance agents ONE endpoint that returns an agent's full operating context —
base config, resolved team membership, a normalized GitHub repo identity, whether the
agent's repo uses Docker, its pending tasks, and its AID public key — instead of
requiring five separate lookups (some of which don't exist yet).

## What exists today

- `GET /api/agents/[id]` (`app/api/agents/[id]/route.ts:12-37` →
  `agents-core-service.ts:635` `getAgentById`) returns the full `Agent` record,
  including the launch string (`program`/`programArgs`, `types/agent.ts:207,210`),
  `governanceTitle`, `workingDirectory`, `hooks`, `githubRepo` (`agent.ts:274`,
  MAINTAINER-only field), and `deployment.cloud` (agent-as-container,
  `agent.ts:293-315`).
- Team membership: only a boolean `isAgentInAnyTeam` exists
  (`team-registry.ts:539`) plus the forward lookup `GET /api/teams/[id]`. There is
  **no reverse lookup** (agent → the team object(s) it belongs to).
- GitHub for non-MAINTAINER agents: `GET /api/agents/[id]/repos`
  (`app/api/agents/[id]/repos/route.ts`) scans the workdir up to 3 levels deep for
  `.git` directories and returns `{path, name, remote, branch, dirty}` per repo found
  — but `remote` is the raw git remote string, not normalized to `owner/repo`, and the
  scan is not filtered to GitHub remotes specifically.
- Docker-for-repo detection: **missing**. Only agent-as-container
  (`deployment.cloud`) and host-level docker-availability checks exist; nothing
  checks whether an agent's own repo/workdir has a `docker-compose.yml` or
  `Dockerfile`.
- Agent → tasks reverse lookup: **missing**. Task lookups today are team-scoped only
  (`GET /api/teams/[id]/tasks`); there's no "give me every pending task assigned to
  this agent across all its teams" endpoint.
- AID public key: not on the `Agent` record at all. It lives on disk at
  `~/.aimaestro/agents/<id>/keys/` and must be read from there via `lib/aid-*.ts`.

## What to build

1. NEW `GET /api/agents/[id]/full` (or extend the existing `GET /api/agents/[id]`
   route with an `?include=teams,repos,docker,tasks,aid` query param) that returns:
   base agent config + resolved team object(s) (via a new reverse-lookup helper) +
   repos with a NORMALIZED `githubRepo` field (parsed `owner/repo` from the git
   remote) + a new `repoDocker` field (does the workdir/repo contain
   `docker-compose.yml`/`.yaml` or a `Dockerfile`) + pending tasks (reusing the
   agent→tasks reverse lookup being added in TRDD-KJQZEYXW / D5) + the AID
   fingerprint/public key (read from the agent's keys directory).
2. `getTeamsForAgent(agentId)` — a new reverse-lookup helper in
   `lib/team-registry.ts` that scans `teams.json` for teams whose `agentIds` (or
   equivalent membership field) include this agent, returning the resolved team
   objects (not just a boolean).
3. `lib/repo-docker-detect.ts` — a new helper that, given a repo/workdir path,
   checks for `docker-compose.yml`, `docker-compose.yaml`, or `Dockerfile` and
   returns a boolean (plus which file(s) matched, for diagnostics).
4. Normalize the existing repo scan: parse the raw git `remote` into `owner/repo`
   when it points at github.com (both SSH and HTTPS remote forms), wiring the
   existing `agents-repos-service.ts` `listRepos` function into the new consolidated
   route rather than duplicating the scan.
5. Read the AID public key/fingerprint via `lib/aid-*.ts` helpers, keyed on the
   agent's `~/.aimaestro/agents/<id>/keys/` directory.

## Files to touch

- NEW `lib/repo-docker-detect.ts`.
- edit `lib/team-registry.ts` — add `getTeamsForAgent(agentId)`.
- edit `app/api/agents/[id]/route.ts` (or NEW
  `app/api/agents/[id]/full/route.ts`) — the consolidated response shape.
- reuse `services/agents-repos-service.ts` (`listRepos`) — wire it into the new
  route instead of re-scanning.
- reuse `lib/aid-*.ts` — for reading the agent's public key/fingerprint.

## Tests

- Reverse team lookup: an agent that is a member of team X returns team X's full
  object (not just `true`) from `getTeamsForAgent`.
- Docker detection returns `true` on a fixture repo containing
  `docker-compose.yml`, and `false` on a fixture repo without any Docker files.
- GitHub remote normalization: both an SSH remote
  (`git@github.com:owner/repo.git`) and an HTTPS remote
  (`https://github.com/owner/repo.git`) normalize to the same `owner/repo` string;
  a non-GitHub remote is not misreported as a GitHub repo.
- AID pubkey/fingerprint is present in the consolidated response for an agent with
  keys on disk, and absent/null for one without.
- MAINTAINER vs non-MAINTAINER: the consolidated endpoint returns the normalized
  `githubRepo` for a non-MAINTAINER agent via the repos scan (not only the
  MAINTAINER-only `agent.githubRepo` field).

## Approval log
