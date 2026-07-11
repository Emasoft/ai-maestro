---
trdd-id: IXUV1XHD
title: CreateAgent returned 201 for agents that can never be woken
column: complete
created: 2026-07-11T16:23:04+0200
updated: 2026-07-11T16:23:04+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 0
severity: CRITICAL
effort: M
labels: [r9.13, role-plugins, create-agent, migration-readiness, observability]
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, typecheck, e2e]
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T16:20:00+0200
implementation-commits: [ce635c14]
external-refs: ["design/tasks/TRDD-20260711_154259+0200-YOS36TZI-session-state-has-no-writer.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**Three code defects fixed and verified live. One MACHINE problem remains, and it is
the USER's call — see "The environment problem" below.**

`POST /api/agents` returned **201** for an agent whose role-plugin failed to install.
The agent was flagged `roleMissing`, hibernated, and then answered **409
role_plugin_required** on every wake, forever. R9.13 says the pipeline must HARD
REJECT a zero-role-plugin state; it did neither that nor an auto-install.

Verified after the fix, under the very condition that triggers it: `POST /api/agents`
now answers **400** and names the cause verbatim —

> role-plugin is mandatory (R9.13) — the agent's role-plugin could not be installed,
> so no agent was created. Cause: G16: WARN — Failed to install
> "ai-maestro-autonomous-agent": … Failed to clone repository: … **Could not resolve
> host: github.com**

— and the half-created agent is rolled back (tombstoned, per the never-hard-delete
governance). Gates: `tsc` 0 · vitest **159/159** · `yarn build` OK.

## The three code defects

**1. A degraded gate was invisible.** Every AIO pipeline records per-gate outcomes in
an `ops` array and returns it; the route handlers print none of it. So a WARN — "the
role-plugin failed to install" — produced a 201 and *total server-side silence*. The
only symptom was an agent that mysteriously refused to wake days later. `logDegradedOps`
now prints any WARN/FAIL/DENIED/VIOLATION/MISMATCH op from ChangeTitle and CreateAgent.
**This is what made the other two findable at all** — the root cause had been sitting in
an unread array for months.

**2. R9.13 was detected but not enforced (G07c, new).** ChangeTitle's G17 *does* catch
the violation: it sets `roleMissing=true` and hibernates. But it returns **success**, so
CreateAgent happily continued and returned 201. CreateAgent now re-reads the agent after
title assignment and, if `roleMissing` is set, rolls back and fails with the real reason.
A transient network failure must not mint a permanently broken agent.

**3. G08's Claude branch could only ever throw (and would install to the wrong dir).**
It called `createPersona({ personaName: desired.label || name })`:
- `label` is a DISPLAY name, auto-assigned **capitalized** ("Nadia", "Aurelia").
  `createPersona` validates against `/^[a-z0-9-]+$/` and **throws** on anything else —
  so for the default label this branch *always* threw, and the throw was swallowed into
  the WARN op nobody printed.
- `createPersona` installs into `~/agents/<personaName>/` — a directory derived from the
  LABEL, **not the agent's working directory**. For an adopted external workdir (a
  MAINTAINER on `~/Code/<project>`, the whole point of TRDD-WLWHVMKT) it would have
  created a bogus `~/agents/<label>/` and installed the role-plugin *there*, leaving the
  real workdir empty.
It now installs into `workDir` via `installPluginLocally` — the same primitive
ChangeTitle G16 uses.

**The test pinned the bug.** `createagent-g08-cross-client.test.ts` asserted
`createPersona({ personaName: 'Claude Persona' })` — a string with capitals AND a space,
which the real function rejects outright. The mock accepted what production refuses, so a
test asserting the exact broken call passed for as long as it existed. Its `fs/promises`
mock also lacked `rename`, so the atomic settings write silently degraded to a WARN —
a second mock gap hiding a second install failure.

## The environment problem — SOLVED: a stale pm2 daemon (and my first two theories were WRONG)

The install failed with `Could not resolve host: github.com`. Two theories, both
FALSIFIED by experiment, and recorded because each looked convincing:

1. *"The server inherited a network-sandboxed env from a Claude Code session"* — killed
   by a pm2-spawned `dns.lookup` probe that resolved github.com fine, and by running
   `git ls-remote` under the server's **full 179-var env**, which also worked.
2. *"It's a transient blip; just retry"* (the USER's hypothesis, and the right instinct)
   — killed by measurement: with the new backoff the server made **8 spaced attempts
   over 57 s** and every one failed identically. Not transient.

**Actual cause: the long-lived pm2 God daemon** (pid 11195, ppid 1, restart_time
1,857,042). Every process it forked failed DNS *in git/curl* while node's own resolver
worked — and `pm2 restart` cannot fix it, because the app is re-forked from that same
daemon. Recycling the daemon does:

```bash
pm2 kill && cd ~/ai-maestro && pm2 start ecosystem.config.js && pm2 save
```

After that, `POST /api/agents` → **201** with the role-plugin present in
`.claude/settings.local.json`. The lesson is in the footnote.

## The retry that should have been there all along

A marketplace install CLONES from GitHub — a network call — and it was attempted
**exactly once**. Combined with the new hard reject, a single blip would have DESTROYED
the agent rather than costing it seconds. `installPluginLocally` now retries with
exponential backoff + jitter (4 attempts, ~2s/6s/18s, `AIM_PLUGIN_INSTALL_ATTEMPTS` /
`AIM_PLUGIN_INSTALL_BASE_DELAY_MS` to tune or disable), and only on *transient-looking*
errors: a wrong plugin name or an auth failure fails fast rather than burning the full
backoff to be told the same thing. 6 new tests.

## Verification

- Unit: the corrected G08 test asserts the plugin lands in the agent's **workdir** and
  that the label is never used as a path or persona slug. 159/159 files pass.
- E2E (live, DNS still broken): `POST /api/agents` → **400** + the verbatim cause; the
  registry entry is a tombstone, not a live half-agent.
- Still to verify once DNS is repaired: the same call returns **201** with the
  role-plugin present in `.claude/settings.local.json`.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] The root cause was legible in an `ops` array the
  whole time, and nothing printed it. A pipeline that reports per-gate outcomes only in
  its return value — to callers that discard it — has no error reporting at all; it has
  the *appearance* of it. Fix the observability first and the bug hunt collapses from
  hours of deduction to one log line. Corollary: a WARN that does not change the
  operation's outcome is not a warning, it is a silent failure with extra steps.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] I asserted "environmental, not transient" from a
  plausible env var (CLAUDE_CODE_CHILD_SESSION) without ever testing whether the failure
  repeated — and I shipped a hard reject with NO retry, which makes a genuine blip
  *destroy* the agent. The USER's "why didn't you retry?" was the correct challenge to
  both. The retry is right regardless of cause (a one-shot network call is a bug), and
  the measurement it enabled — 8 attempts, 57 s, identical failure — is what finally
  ruled transience OUT and pointed at the daemon. Lesson: when you catch yourself
  explaining a failure instead of reproducing it, you are guessing. Retry first, measure,
  then theorize.

[^3]: [ocd:2026-07-11 lmd:2026-07-11] `pm2 restart` re-forks the app from the SAME God
  daemon, so it inherits whatever is wrong with that daemon — a daemon that had been
  alive for 1.8M restarts. If a long-lived pm2 app misbehaves in a way that its code
  cannot explain, recycle the DAEMON (`pm2 kill`), not the app. `--update-env` does not
  help either: it re-reads the env from the *current* shell, which for an agent IS a
  Claude session.
