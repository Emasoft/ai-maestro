---
trdd-id: 0GCIMQ9F
title: ai-maestro must write only inside ~/.aimaestro and ~/agents
column: todo
scope: project
created: 2026-07-29T21:44:51+0200
updated: 2026-07-29T21:44:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-29T21:44:00+0200
derived: false
npt: []
eht: []
severity: critical
priority: 0
release-via: none
relevant-rules: [R20.20, R20.29, R20.30]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102]
---

# ai-maestro must write only inside ~/.aimaestro and ~/agents

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**USER directive, verbatim (2026-07-29):** *"this is extremely dangerous, the only writings should
be into ~/.aimaestro and into ~/agents"*.

**Measured inventory — every write/delete this repo performs OUTSIDE those two roots.** Produced
by grepping the write verbs in `lib/ services/ app/ server.mjs` and filtering to `~/.claude`
targets that are NOT an agent workdir; each row read at its call site, not inferred:

| target | site | status |
|---|---|---|
| `~/.claude/settings.json` | `services/plugin-storage-service.ts`, `services/role-plugin-service.ts`, `lib/claude-settings-enforcer.ts` | **RATIFIED** — narrow carve-out, 2026-07-17 |
| `~/.claude/plugins/installed_plugins.json` | `services/element-management-service.ts` | **UNRATIFIED — the real violation** |
| `~/.claude/plugins/` (mkdir) | `services/element-management-service.ts` | incidental to the above |
| `~/.claude/projects/<workdir-slug>/` (**rm -rf**) | `DeleteAgent` history purge | **UNRATIFIED — a DELETE of user transcripts** |

Agent-workdir writes (`<workdir>/.claude/…`) are NOT in scope — those are inside `~/agents`.

**The ratified one is genuinely ratified**, and must not be "fixed" away by a future audit. USER,
2026-07-17 (TRDD-QZL828OD D2): *"it is a narrow exception, but it is important. ai-maestro cannot
function without those settings."* It is implemented with the discipline that earns an exception —
`lib/claude-settings-enforcer.ts`: fixed allowlist, merge-never-replace, fail-closed on a corrupt
file, atomic tmp+rename with an `.aim-bak`, idempotent, restore-on-drift. The carve-out is recorded
in the IRON-guard memory `ai-maestro-user-scope-install-prohibition` with a `[^1]` guardrail lesson
for exactly that reason.

**The unratified one had none of that discipline, and it broke the IRON rule.** Until commit
`c08e8303` (TRDD-FHBGF0WG, ~20 min before this card), `uninstallPluginLocally` did
`delete pluginsMap[pluginKey]` on `installed_plugins.json`. That key holds an ARRAY of per-install
records spanning **both `local` and `user` scope** — 73 of them for `ai-maestro-plugin` on this
host. So a LOCAL uninstall for ONE agent **deleted the user-scope record**, i.e. an ai-maestro
pipeline mutated user scope on every `ChangeTitle` that swapped a role-plugin. The memory
`ai-maestro-never-installs-user-scope` says *"AI Maestro MUST NEVER perform an install/enable
operation at user scope. The ONLY path to user-scope plugin/element installation is the human."*
That is the rule the old code was breaking — the R20.30 framing I filed it under first is the
narrower reading.

**NEXT ACTION:** decide between the two shapes below (this is the USER's call, and the reason this
card is `min-approval-requirement: user` rather than a self-mandate), then implement.

**Load-bearing distinction — do NOT collapse these two:**

- **Invoking the client's own CLI** (`claude plugin install|uninstall … --scope local`) makes the
  CLI write ITS OWN store. That is correct and unavoidable: R20.29 says a plugin is installed via
  the client's own protocol, and there is no other way to install one. This is not a violation and
  must not be removed.
- **Us reaching into `~/.claude/` and hand-editing its JSON** is the thing we control, and it is
  what produced the damage. The file we hand-edited most aggressively is precisely the one whose
  schema we had misread.

**Load-bearing facts / gotchas**

- `claude plugin uninstall <name> <mkt> --scope local` ALREADY removes the record correctly. Our
  hand-edit was added as a "defence in depth" safeguard (`element-management-service.ts:1687-1688`,
  *"Claude CLI has historically been flaky about settings.local.json cleanup"*) — note the comment
  justifies a **settings.local.json** safeguard, and the installed_plugins.json delete was carried
  along beside it without its own justification.
- Deleting the hand-edit outright is NOT free: `DeleteAgent`'s G09b runs when the workdir is being
  destroyed, and shelling out to the CLI per plugin with `cwd` pointed at a directory that is about
  to vanish (or has already vanished) is fragile. Whichever shape wins must answer that case.
- The `~/.claude/projects/` purge is a **delete of the user's chat transcripts**. It has real
  justification (SCEN-014 P0-002: re-creating an agent at the same path resurrects the previous
  agent's transcript; and the transcripts are a privacy surface that outlives the agent) and a
  careful guard (the slug must resolve under `~/.claude/projects/` and not equal the root). It is
  still a destructive write outside our roots and is unratified.

## Problem

ai-maestro treats `~/.claude/` as partly its own. Three files and one directory tree outside
`~/.aimaestro` and `~/agents` are written or deleted by this codebase. One has an explicit,
disciplined, USER-ratified carve-out. The other two grew without one — and the larger of them
carried a bug that destroyed 73 records at a time, including the user-scope row an IRON rule says
we must never touch.

## Root cause

There is no enforced boundary. Nothing in the codebase or the test suite asserts "ai-maestro writes
only under `~/.aimaestro` and `~/agents`, plus the ratified carve-out", so a new write outside those
roots is added the same way any other line of code is — and reviewed as a feature, not as a
boundary crossing.

## Proposed fix

**Decide the shape for `installed_plugins.json` (USER's call):**

- **Shape A — delegate, do not hand-edit.** Drop our writes entirely; let `claude plugin
  install|uninstall --scope local` be the only mutator. Cleanest against the directive. Must answer
  the `DeleteAgent` case (workdir vanishing) and accept a CLI spawn per plugin.
- **Shape B — bring it under the ratified-carve-out discipline.** Keep the record-scoped surgery
  landed in `c08e8303`, and add what the settings enforcer already has: an explicit allowlist of
  the mutations we permit, `.aim-bak` before write, fail-closed on a corrupt file, plus the ledger
  entries (already landed). Then ask the USER to ratify it as a second narrow exception, or refuse.

**Independently of which shape wins:**

1. **A boundary test that fails loudly** — enumerate write verbs whose target resolves outside
   `~/.aimaestro`/`~/agents`, and assert the set equals a pinned allowlist carrying the ratifying
   TRDD id for each entry. Same shape as `AGENT_STORES`' manifest pin, which caught this class of
   omission today the moment a store was added.
2. **Ratify or remove the `~/.claude/projects/` purge** — put the decision on the record either way.
3. **Record the boundary as a governance rule** so it is enforced rather than remembered.

## Verification

- The boundary test enumerates the real write sites (non-vacuity: assert the scanned count, so a
  broken scan cannot report "clean" by reading nothing) and fails when a new out-of-root write is
  added — proven by adding one in a fixture.
- The ratified `settings.json` carve-out is still present and still passes; a test asserts it is
  EXPECTED, so a future audit cannot delete it as a violation.
- Whichever shape wins: uninstalling a plugin for one agent leaves every other agent's record and
  the user-scope row intact (already pinned by `tests/unit/installed-plugins-records.test.ts`).

## Estimated risk

MEDIUM. Shape A changes a hot path (every ChangeTitle) to depend on a CLI spawn; Shape B keeps the
hand-edit and therefore keeps the exception. The boundary test itself is LOW risk and valuable under
either shape — it is what converts "we remember not to do this" into something that fails a build.

## Approval log

- 2026-07-29T21:44:00+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent. Verbatim:
  *"this is extremely dangerous, the only writings should be into ~/.aimaestro and into ~/agents"*.
  The choice between Shape A and Shape B is left to the USER and is the card's NEXT ACTION.

## Acceptance

- [ ] USER picks Shape A (delegate to the CLI) or Shape B (ratified carve-out with enforcer discipline)
- [ ] `installed_plugins.json` mutation matches the chosen shape
- [ ] A boundary test pins the complete set of out-of-root writes to an allowlist, each carrying its ratifying TRDD id
- [ ] The boundary test is non-vacuous (asserts the scanned count) and fails on a seeded new violation
- [ ] The ratified `settings.json` carve-out is asserted as EXPECTED so a future audit cannot delete it
- [ ] The `~/.claude/projects/` transcript purge is explicitly ratified or removed
- [ ] The boundary is recorded as a governance rule, not only as a memory note
