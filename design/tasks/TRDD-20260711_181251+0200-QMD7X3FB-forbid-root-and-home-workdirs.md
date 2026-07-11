---
trdd-id: QMD7X3FB
title: Forbid / and $HOME as an agent working directory — enforce at the single writer
column: dev
created: 2026-07-11T18:12:51+0200
updated: 2026-07-11T18:12:51+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 0
severity: HIGH
effort: M
labels: [security, workdir-policy, agent-registry, one-writer, migration-readiness]
task-type: security
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
test-requirements: [unit, integration, typecheck]
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T18:10:00+0200
implementation-commits: [ce0a69ff]
external-refs: ["design/tasks/TRDD-20260711_131006+0200-WLWHVMKT-external-workdir-adoption.md", "design/tasks/TRDD-20260703_000000+0200-a1019073-controlled-execution-environment.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**USER DIRECTIVE: "forbid any agent to have / or home as working directory."** Done —
and the investigation found that the reason one already had `/` was worse than a missing
check. Gates: `tsc` 0 · vitest **163/163 files** · `yarn build` OK.

## What was actually wrong

`/` and `$HOME` were *already* in the policy's forbidden set. And yet the registry
contained a live agent — `default` — whose `workingDirectory` is `/`. Both facts are
true, so the check was not on the path that writes.

Three findings, each worse than the last:

**1. The creation gate had ZERO production callers.** TRDD-WLWHVMKT created
`lib/agent-workdir-policy.ts` as "the ONE authority" to end the five-copies problem, and
exported `checkAdoptableWorkdir` for creation. Nothing ever called it. `CreateAgent` still
hand-rolled its own `BLOCKED_TREE`/`BLOCKED_EXACT`; `ChangeFolder`'s comment still says it
"mirrors CreateAgent G03-ENFORCE" — a third copy. The authority was built and never wired
in, so the duplication it was written to remove survived it.[^1]

**2. The real writer validated nothing.** `lib/agent-registry.ts::createAgent` is the
low-level primitive that EVERY service funnels through — the AIO `CreateAgent`,
`sessions-service`, `amp-service`, `teams-service`, the creation helper, the docker
service. It did not check the working directory at all. The AIO's G03 gates guarded ONE of
those paths; the others wrote whatever they were handed.

**3. The default was the worst directory available.**

```ts
workingDirectory: request.workingDirectory || process.cwd(),   // ← the bug
```

`process.cwd()` is the **ai-maestro install tree** — the one directory an agent must never
own, because an agent there rebuilds and restarts the server managing it. And it is not
even a fixed directory: it is wherever the server process happens to be standing. This
host's pm2 God daemon ran with cwd `/`. **That is exactly how `default` came to own the
entire filesystem** — not a hand-edit, not a legacy import: a fallback, doing what
fallbacks do.[^2]

**4. `/` was refused while `""` granted something worse.**
`checkAuthorizedAgentWorkdir` began with `if (cwd.length === 0) return { ok: true }` —
"tmux inherits the server's cwd". The server's cwd is the install tree. So the policy
refused the named forbidden directory and handed out a worse one through the unnamed
case. A test asserted this as correct ("preserved behaviour"), which is how it survived.[^3]

## The fix — enforce at the ONE writer

- **`lib/workdir-path-policy.ts` (new)** — the PURE path policy, zero imports.
  `lib/agent-workdir-policy.ts` reads the registry, so `lib/agent-registry.ts` could not
  import it (a cycle) — which is precisely why the policy had never reached the writer.
  Splitting the pure half breaks the cycle. There is exactly ONE copy of the
  forbidden-directory rules; both the authority and the registry consume it.
- **`createAgent` now refuses** a forbidden workdir (throws, naming the reason), and an
  ABSENT workdir defaults to the canonical `~/agents/<name>` — **never** `process.cwd()`.
  An explicit bad value fails fast; absence gets a safe default. No silent correction of
  an explicit request: the caller asked for something forbidden and must learn that.
- **`updateAgent` and `updateAgentWorkingDirectory` refuse it too.** A policy enforced on
  one of three writers is not enforced — otherwise "create clean, then relocate to `/`" is
  a two-call bypass.
- **The empty-workdir hole is closed**: absence is a refusal, never a fallback.

Forbidden, with the reason each one is: `/` (owns the filesystem) · `$HOME` (owns every
project and dotfile the user has) · Desktop/Documents/Downloads/Library (a whole user-data
root) · the ai-maestro install tree (recursion) · anything outside `$HOME` · empty. Still
permitted, because they are the point: `~/agents/<name>` and an adopted `~/Code/<project>`
(TRDD-57EBNB72's MAINTAINER case — a policy that forbids the feature it guards is a
regression, and a test says so).

## The existing violator — surfaced, not silently rewritten

`default` (offline, no title, workdir `/`) is left ALONE. Nothing can enter the registry in
that state any more, so it is the last of its kind — but it is the user's data, and quietly
rewriting an agent's working directory is not ours to do. Instead it is **inert and named**:
every enforcement path already skips it (no rules seeded, no session, no boot-restore), and
the server now says so at boot, loudly, with the remediation. Visible beats tidy.

## Verification

- `tests/unit/workdir-path-policy.test.ts` — the forbidden set (root, `$HOME`, via `~`, via
  `..` traversal, the user-data roots, the install tree, outside `$HOME`, empty) and the
  permitted set (`~/agents/<name>`, an adopted `~/Code/<project>`).
- `tests/agent-registry.test.ts` — the choke point itself refuses `/`, `$HOME`, and outside
  `$HOME`; an absent workdir defaults to `~/agents/<name>` and **not** `process.cwd()`;
  relocating an existing agent to a forbidden directory is refused.
- `tests/lib/agent-workdir-policy.test.ts` — the empty-cwd assertion is INVERTED (it used
  to pin the bypass).
- Three registry-test fixtures used `/tmp/work`, `/tmp/session`, `/original` — all outside
  `$HOME` and thus always forbidden. They only passed because the writer checked nothing.

## Honest limit

Unchanged from TRDD-WLWHVMKT: on a shared UID this is **authorization**, not containment. A
same-uid agent can `chdir` and write anywhere the kernel allows; the workdir policy is the
system agreeing with itself about which directory it handed an agent. Real containment is
TRDD-a1019073 / container agents.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] Creating "the one authority" and not wiring the call
  sites to it leaves you strictly worse off than before: the duplicated checks are all still
  there, PLUS a new module that everyone now believes is enforcing something. Dead code that
  *looks* like a guard is more dangerous than no guard, because it ends the search. A
  consolidation is not done when the new module exists; it is done when the old copies are
  GONE. Grep for callers before believing an authority is authoritative.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] `x || process.cwd()` is not a default, it is a
  lottery. The value it produces depends on where an unrelated process was launched from —
  here, a pm2 daemon started at `/`, which handed an agent the whole filesystem. Any
  fallback whose result is "whatever the ambient environment happened to be" should be a
  hard error instead: the caller either knows the directory or has no business creating the
  thing. This is the fail-fast rule with a concrete corpse.

[^3]: [ocd:2026-07-11 lmd:2026-07-11] The empty/absent case is where policies go to die. `/`
  was refused by name while `""` silently resolved to something worse — and a test asserted
  that as "preserved behaviour", which converted the hole into a requirement. When you
  enumerate forbidden values, the absent value is one of them: decide explicitly whether
  absence means refuse or means a named safe default, and never let it mean "inherit
  whatever is lying around".
