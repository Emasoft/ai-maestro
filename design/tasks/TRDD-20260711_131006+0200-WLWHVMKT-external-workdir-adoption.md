---
trdd-id: WLWHVMKT
title: External workdir adoption is broken — one authority for agent-workdir policy
column: dev
created: 2026-07-11T13:10:06+0200
updated: 2026-07-11T13:10:06+0200
current-owner: ai-maestro-dev
assignee: ai-maestro-dev
priority: 0
severity: CRITICAL
effort: L
labels: [security, workdir, adoption, readiness, migration-blocker]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
min-approval-requirement: user
mandate: true
mandated-by: user
created-by: ai-maestro-dev
approved: true
approval-judge: maestro
approval-datetime: 2026-07-11T13:10:06+0200
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, integration]
audit-requirements: [security-scan]
review-requirements: [human-review]
runtime-targets: [macos]
impacts: [public-api, config-schema]
attempts: 0
test-failures: 0
last-test-result: not-run
last-test-at: null
implementation-commits: []
external-refs: ["https://github.com/Emasoft/ai-maestro-maintainer-agent/issues/27"]
---

# External workdir adoption is broken — one authority for agent-workdir policy

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**Current state.** Diagnosed in full (evidence:
`reports/workdir-adoption/20260711_124924+0200-agents-dir-constraints.md`).
Design agreed. Implementation NOT started.

**The finding.** Adopting an existing repo under `~/Code/<project>` as an agent's
working directory — which the owner requires in order to migrate all plugin
development into ai-maestro — **does not work today**, and worse, it *appears* to.

The `~/agents/`-only invariant is enforced at **four independent, unsynchronized
points**. `allowExternalFolder` (TRDD-57EBNB72) widened exactly one of them:

| Point | File | Today |
|---|---|---|
| CreateAgent G03 gates | `services/element-management-service.ts:6919-7077` | **accepts** `~/Code/foo` (MAINTAINER is in `NON_TEAM_TITLES`, so not force-pathed; G03-CLAMP keeps the flag because the path is under `$HOME`) |
| Session start | `lib/agent-runtime.ts::validateCwd` (55-66), called from `TmuxRuntime.createSession` (241) | **HARD THROW** — no title exemption, no flag. THE root blocker. |
| Boot restore | `services/boot-restore-service.ts:102-113` | **skips** the agent on server restart |
| Folder browse | `app/api/agents/browse-dir/route.ts:28-31` | **403** (`ALLOWED_PREFIXES = [~/agents, ~/.claude]`) |
| Change folder | `ChangeFolder` G01b, `element-management-service.ts:5013-5033` | confines to `~/agents/` **unconditionally** (no flag exists on this pipeline) |

Net effect: **the registry write succeeds but the agent can never run.**
`CreateAgent` even swallows the throw (`element-management-service.ts:7343-7362`)
and returns success — the user gets a created agent, no session, and no visible
error. A later Wake surfaces an opaque `500 Failed to create tmux session`.

**Why no test caught it.** Every test of the feature placed its "external" fixture
*inside* `~/agents/`: TRDD-VT6SSI0T cloned to `~/agents/dummy-fleet-pilot/`, and
SCEN-028's fixture is `~/agents/scen028-import-fixture`. `SCENARIOS_TESTS_RULES.md`
Rule 0 *requires* fixtures under `~/agents/`, which makes it structurally impossible
to regression-test the very case this TRDD is about. The feature had zero coverage
of its own headline behaviour — a test that cannot fail.

**NEXT ACTION.** Implement the policy module + rewire the 4 call sites (below),
TDD, with a fixture that genuinely lives OUTSIDE `~/agents/`.

**Load-bearing facts / gotchas.**
- Already workdir-agnostic; do NOT touch: `lib/agent-shell-guard.ts` (reads
  `$AGENT_WORK_DIR` dynamically), `lib/agent-rules-seed.ts`,
  `lib/workdir-gitignore-seed.ts`, `app/api/agents/folders/route.ts` (wizard picker,
  `$HOME`-scoped, already returns `githubRepo`).
- `DeleteAgent` G09 already **refuses** to delete a folder outside `~/agents/`
  (`element-management-service.ts:6547-6604`). For adoption that is the CORRECT
  behaviour (never destroy the user's real project) — keep it, but surface it in the
  UI instead of a silent `ops.push`.
- `importAgent` (`services/agents-transfer-service.ts:771`) preserves
  `workingDirectory` verbatim with **no** gate-checking at all — the opposite defect
  (un-gated). It must go through the same authority.

**SUPERSEDED — do NOT carry forward.**
- "`allowExternalFolder` makes external adoption work" (as `CLAUDE.md` currently
  implies). It only makes the *registry write* work.
- "Just widen `validateCwd` to `$HOME`." Rejected — see Security below.

## Security — read before changing `validateCwd`

`validateCwd`'s own comment (lines 45-54) frames the `~/agents/` confinement as a
**deliberate posture for the shared-UID era**, cross-referencing TRDD-a1019073
(controlled execution environment): *"When the dedicated `aimaestro` UID + host
sandbox land, this check must be tightened IN LOCKSTEP with the OS-level
enforcement… never relaxed to re-admit external workdirs without that
enforcement."*

The owner has explicitly mandated that agents adopt `~/Code/<project>` in place, so
the change is authorized. It will be implemented in the **least-weakening** form:

- **NOT** a blanket "any path under `$HOME`".
- A cwd is authorized iff it is under `~/agents/` **OR** it is (or is under) *that
  specific agent's* registry-recorded `workingDirectory` — a directory that already
  passed G03-CLAMP (`$HOME`-bounded), G03-SAFETY (blocked-tree list) and G03-OVERLAP
  (not owned by another agent).
- The **ai-maestro install directory stays hard-blocked** (`process.cwd()` is already
  in G03-SAFETY's `BLOCKED_TREE`). This is the owner's own recursion guard: the
  ai-maestro repo must never become an agent workdir.

This turns a hardcoded *path* check into an *authorization* check against the same
authority the creation gate used. It does not loosen the boundary; it makes the four
points agree on it.

**Residual risk, stated honestly.** Under a shared UID none of this is a hard
security boundary: `agent-shell-guard.sh` only overrides `cd`/`pushd`, so it never
prevented absolute-path writes (`> /elsewhere/file`, `python -c 'open(...)'`). That
was already true for `~/agents/` agents; adoption changes the *declared* workdir, not
the enforceable one. Real containment is TRDD-a1019073 / the container work (#D).
This TRDD must NOT be read as "external workdirs are now safe" — only as "the
system now agrees with itself about which directory an agent was authorized to use."

## Proposed fix

1. **`lib/agent-workdir-policy.ts` (new)** — the single authority.
   - `isAuthorizedAgentWorkdir(cwd, { agentWorkingDirectory }): boolean`
   - `assertAuthorizedAgentWorkdir(cwd, opts): void` (throws with a message that names
     the real reason, not an opaque 500).
   - Always allows under `~/agents/`. Allows the agent's own registered workdir.
     Always denies: outside `$HOME`, the blocked trees (`$HOME` itself, Desktop,
     Documents, Downloads, Library) and **the ai-maestro install dir**.
2. **`lib/agent-runtime.ts`** — `validateCwd` delegates to the policy; `createSession`
   accepts the authorized workdir from its caller (both callers already hold the
   agent: `services/sessions-service.ts:1037`, `services/agents-core-service.ts:2240`).
3. **`services/boot-restore-service.ts`** — restore any agent whose workdir the policy
   authorizes (not just `~/agents/`).
4. **`app/api/agents/browse-dir/route.ts`** — scope per-agent to
   `agent.workingDirectory` (the object-level auth check already does exactly this),
   instead of the static two-prefix allowlist.
5. **`ChangeFolder` G01b** — accept the same `allowExternalFolder` semantics as
   `CreateAgent`, routed through the policy.
6. **`importAgent`** — run the imported `workingDirectory` through the policy instead
   of trusting the manifest.
7. **Docs** — `CLAUDE.md` (the adoption section currently implies the feature works;
   the Agent-Terminology "only place a PERSONA may write" absolute), and
   `SCENARIOS_TESTS_RULES.md` Rule 0 (must permit an out-of-`~/agents/` fixture, or
   external adoption can never be scenario-tested).

## Verification

TDD. The tests must use a fixture **genuinely outside `~/agents/`** — that is the
exact coverage whose absence caused this bug:

- unit: policy allows `~/agents/x`; allows a registered external workdir; denies a
  *different* agent's external workdir; denies `$HOME`, Desktop, outside-`$HOME`,
  and the ai-maestro install dir.
- integration: create a MAINTAINER agent on a temp repo outside `~/agents/` (under
  `$HOME`), **start a session** (previously impossible), restart the server and
  confirm boot-restore brings it back, browse its tree.
- regression: an agent whose workdir is `~/agents/<name>` is unaffected.
- negative: creating an agent whose workdir is the ai-maestro install dir is REFUSED
  (recursion guard).
- Gates: `bash scripts/with-node.sh yarn test` + `tsc` + `next build` all green.

## Approval log

- 2026-07-11T13:10:06+0200 — MANDATE issued by USER (min-approval-requirement: user).
  The owner directed: *"the rules that fixed the worktrees only under ~/agents/ must
  be changed"* — an explicit instruction to change a security-relevant policy. Scope
  held to the least-weakening form (authorization check, not a blanket widening);
  residual risk recorded above. No approval request was sent — the mandate is the
  approval.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] The feature shipped, was documented in
  `CLAUDE.md`, had a live-verification EHT (TRDD-VT6SSI0T) and a UI scenario
  (SCEN-028) — and still never worked, because every test placed its "external"
  fixture *inside* `~/agents/`. The test suite's own Rule 0 mandated that. Lesson: a
  test whose fixture cannot violate the invariant under test is not a test of that
  invariant — it is a test that cannot fail. When a feature's headline claim is "X
  now works outside Y", the fixture MUST live outside Y or the coverage is theatre.
