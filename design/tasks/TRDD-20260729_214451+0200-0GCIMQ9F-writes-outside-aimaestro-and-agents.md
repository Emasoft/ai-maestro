---
trdd-id: 0GCIMQ9F
title: ai-maestro must write only inside ~/.aimaestro and ~/agents
column: todo
scope: project
created: 2026-07-29T21:44:51+0200
updated: 2026-07-30T13:04:00+0200
implementation-commits: [973de2fe]
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
npt: [OWO449MR]
eht: [KO4TQCJ0]
severity: critical
priority: 0
release-via: none
relevant-rules: [R20.20, R20.29, R20.30]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102]
---

# ai-maestro must write only inside ~/.aimaestro and ~/agents

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

**USER directive, verbatim (2026-07-29):** *"this is extremely dangerous, the only writings should
be into ~/.aimaestro and into ~/agents"*.

### 2026-07-30 — SHAPE A EXECUTED. 3 of the 4 remaining boxes closed; 2 items left, both named.

| item | state |
|---|---|
| `~/.claude/projects/` transcript purge | **REMOVED** — plus its residue probe, plus an inverted test asserting the absence |
| ratified `settings.json` carve-out | **pinned POSITIVELY** by key, with a downgrade check |
| the boundary as a governance rule | **R52** — `GOV-R52` in the spec first, then the catalog (v5.0.0 → 5.1.0) |
| `installed_plugins.json` | **SPLIT OUT → TRDD-OWO449MR** (NPT): Shape A needs DeleteAgent REORDERED, because a local CLI uninstall needs the folder that G09b deliberately deletes first |
| the 44→47 leaked `t-*.sqlite` | **still needs the USER's permission** (RULE 0). Cause is settled: our own suite writing the real state dir |

**SUPERSEDED — do NOT carry forward.** The inventory table below still lists the transcript purge as
*"UNRATIFIED — a DELETE of user transcripts"* and `installed_plugins.json` as *"the real violation"*
pending a Shape A/B choice. Both are decided: the purge is GONE, and the plugin-records write is a
KNOWN, SPLIT-OUT reorder with its own card. The table is kept as the audit that found them.

**One thing worth carrying, because it bounds what the gate can ever promise:** the purge — the
highest-risk write on this card — was **invisible to the detector**. It called `rm(claudeProjectsDir)`
through a local variable, and textual matching cannot see through a variable. It was found by
READING. A green `write-boundary` gate means "no violation of the shapes I can see".

### AMENDMENT — USER, 2026-07-30: the USER-SCOPED-ELEMENT exception

**Verbatim:** *"Change the rule to make an exception for user scoped elements. But very few user
scoped elements are allowed, almost all from the janitor, the wikimem system and the 3-pillar
system. some user scoped plugin can also save user scoped files outside of the project folder."*

**What this fixes.** The rule as first written binds a WRITER but reads like a claim about PATHS —
and the card's own open box asks for it to become a governance rule for the ecosystem. Promoted
verbatim it would have forbidden the **janitor** from writing `~/.claude/rules/`, the **wikimem**
system from writing `~/.claude/projects/<slug>/memory/`, and the **3-pillar** system from writing a
LOCAL-scope corpus at `~/.claude/projects/<slug>/design/` — i.e. it would have outlawed three
systems this project depends on, for doing the one thing user-scope means. The boundary is about
ai-maestro not annexing `~/.claude`; it was never about denying a user-scoped element its own state.

**The class, and why it is not a loophole.** A user-scoped element's state lives outside any project
folder BY DEFINITION, and the allowed set is SHORT and closed: the janitor, wikimem, the 3-pillar
system, plus a small number of user-scoped plugins keeping their own user-scoped files. Where
ai-maestro writes into one of those stores it is entering ANOTHER element's dir by design, not
widening its own footprint. Three things the class explicitly does NOT cover — each is the reading
that would turn it into a loophole:

1. **Installing or enabling anything at user scope stays the IRON prohibition**
   (`ai-maestro-never-installs-user-scope`); only the human may do that. The exception is about an
   element's own DATA, never about plugin installation.
2. **The write still owes the enforcer discipline** that earned the `settings.json` carve-out —
   named allowlist entry with a ratifying TRDD, atomic tmp+rename, fail-closed on a corrupt file,
   idempotent. "User-scoped" licenses the LOCATION, not sloppiness.
3. **Deleting the USER's own data is NOT in the class.** The `~/.claude/projects/<slug>/` transcript
   purge deletes chat history, not an element's state, and stays UNRATIFIED pending its own decision.

Recorded in `lib/write-boundary.ts` as the exception-class note on `ALLOWED_OUT_OF_ROOT_WRITES`.

### Two facts established while applying it (both by measurement, both corrections)

**1. The 45 files in `~/.aimaestro/pillar-index/` are NOT user-scoped state — 44 are OUR OWN TEST
LEAKAGE.** Counted and identified 2026-07-30: 43 named `t-<hash12>.sqlite`, all exactly 65536 bytes,
mtimes only 2026-07-29 (36) and 2026-07-30 (9) — two days of test runs; 1 named
`pillar-0impact-xdmckp-…`; and exactly **1 legitimate** index, `ai-maestro-e916c2513721.sqlite`, for
this repo's own corpus. The `t-` slug decodes the cause: `corpusKeyFor` takes
`basename(dirname(realpath))`, so a corpus that IS a `mkdtemp` directory yields the basename of
`$TMPDIR`, which on macOS is `T`. `tests/unit/pillar-graph-cli.test.ts` and
`tests/unit/pillar-cli-exit-codes.test.ts` both reach `statePath('pillar-index')`, and **neither uses
`tests/helpers/fake-ecosystem-home.ts`** — so every run writes one index into the developer's REAL
`~/.aimaestro`. That is a 0-IMPACT violation in our own suite (a plugin's tests are the plugin's job),
not an artefact of the write boundary and not user-scoped state. The FOLDER is right: `3P-IDX-02`
requires the index outside the corpus, and `~/.aimaestro` is the ratified state root. Cleanup of the
44 needs USER permission (RULE 0 — untracked, outside the repo) and is asked separately.

**2. `lib/oauth-rotator/slots.ts` was writing outside both roots, recorded in NEITHER list.** It
writes `~/.claude/plugins/data/ai-maestro-janitor-…/oauth-rotator/` (`mkdirSync` +
`writeFileSync`/`renameSync` + `rmSync`, lines 295-329) through a local `p` from
`oauthRotatorDir()` — so the write-boundary detector's first-argument markers cannot see it, and it
was absent from both `ALLOWED_OUT_OF_ROOT_WRITES` and `KNOWN_INDIRECT_WRITERS`. The gate was green
while an unrecorded out-of-root write existed. It is LEGITIMATE and lands squarely in the new class
(the janitor owns that dir; OAuth custody is split across the two plugins by design, and only SLOTS
are written, never the live credential) — but *legitimate* and *written down* are different
properties and only the second is checkable. Added to `KNOWN_INDIRECT_WRITERS` with the pin updated,
which is the mechanism working: the list could not grow silently.

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

- 2026-07-30T12:25:00+0200 — **SHAPE A, ruled under the USER's delegation** *"i don't care of
  those details. you solve them."*

  **`installed_plugins.json` → delegate to the `claude plugin` CLI. No hand-edit.** Shape B
  would make us a SECOND WRITER over a file another tool owns, and every safeguard it proposes
  (allowlist, `.aim-bak`, fail-closed) is machinery for surviving that fact rather than for
  removing it. Two writers over one file is the same class as the two same-named
  `TITLE_PLUGIN_MAP`s and the two memgrep crates: they do not disagree on day one, they
  disagree on the day the other side changes its schema — and we would find out by corrupting
  a user's plugin registry. The CLI is the owner; ask the owner.

  **The `~/.claude/projects/` transcript purge → REMOVED, not ratified.** It is the highest-risk
  item on the card (a RECURSIVE DELETE of the user's own conversation history, outside our roots,
  unratified), and it is also **unnecessary**: Claude Code already owns transcript retention
  through its `cleanupPeriodDays` setting (default 30). A second deleter of someone else's data
  buys nothing and can only ever be the thing that deleted too much. Deleting the user's data is
  explicitly one of the three readings the user-scoped-element exception does NOT license.

  **The mandate binds the RUNTIME, not the INSTALLER — a refinement discovered by doing the
  work, not by reading the card.** Two hours before this ruling the USER ordered the pillar CLIs
  installed "where everyone can reach for them" (TRDD-217AYEOT), which wrote
  `~/.local/bin/trddgrep` and `~/.local/share/aimaestro/install-root` — a FOURTH out-of-root
  write site, ordered in the same breath as the boundary. So *"the only writings should be into
  `~/.aimaestro` and into `~/agents`"* is a constraint on what the **running server and its
  agents** do to a machine they share, not on a user-invoked installer placing a tool on PATH.
  Read the other way it forbids `install-messaging.sh` itself. The allowlist must therefore
  carry the installer class explicitly, or the next audit "fixes" the install by deleting it.

  Still NOT delegated, and deliberately left for the USER: the 44 leaked test indexes under
  `~/.aimaestro/pillar-index/`. They are untracked and outside the repo, so RULE 0 requires
  explicit permission per deletion — "you solve them" is not that permission. (They are also
  not a mystery any more: they are `t-*.sqlite`, i.e. OUR OWN test suite writing the
  developer's real state dir, named from `basename $TMPDIR`. Containing the two leaking tests
  is in scope and does not require deleting anything.)

## Acceptance

- [x] USER picks Shape A (delegate to the CLI) or Shape B (ratified carve-out with enforcer discipline) — SHAPE A, ruled 2026-07-30 under the USER's delegation; see the Approval log for why a second writer over another tool's file is the class of bug the safeguards would only have helped us survive
- [ ] `installed_plugins.json` mutation matches the chosen shape → **SPLIT OUT as TRDD-OWO449MR
      (NPT), not done here.** Shape A means "ask the CLI", and local-scope uninstall is
      `claude plugin uninstall … --scope local --cwd <dir>` — it needs the workdir to EXIST, while
      G09b deliberately runs AFTER the folder is deleted precisely so the records are already false
      and the gate needs no compensation (R51). Executing Shape A here is therefore a REORDER of
      DeleteAgent, the most irreversible pipeline in the system, with a live compensation question.
      Improvising that at the tail of this card would have hidden a HIGH-risk design decision inside
      a card whose other Shape-A items were deletions.
- [x] A boundary test pins the complete set of out-of-root writes to an allowlist, each carrying its ratifying TRDD id — `lib/write-boundary.ts` + `tests/unit/write-boundary.test.ts` (`973de2fe`); MEASURED set is 5 sites (3 ratified, 2 labelled UNRATIFIED)
- [x] The boundary test is non-vacuous (asserts the scanned count) and fails on a seeded new violation — asserts `scanned > 400` and `writeCallSites > 100`, plus a per-marker-class non-zero check; end-to-end neuter recorded (a real `writeFile(join(HOME, '.claude', …))` appended to `services/groups-service.ts` reddens the allowlist test naming that exact site)
- [x] The ratified `settings.json` carve-out is asserted as EXPECTED so a future audit cannot delete it
      — a POSITIVE per-key assertion in `tests/unit/write-boundary.test.ts`, plus a check that none of
      the three has been quietly downgraded to `UNRATIFIED`. The pre-existing set-equality test could
      not do this job: delete the site AND its entry together and it stays green, so it cannot tell
      "removed on purpose" from "never existed". Neuter recorded: downgrading one entry's
      `ratifiedBy` to UNRATIFIED reddens this test by name (and the UNRATIFIED-inventory test with it).
- [x] The `~/.claude/projects/` transcript purge is explicitly ratified or removed — **REMOVED**
      (`services/element-management-service.ts`, DeleteAgent G09). Two derived consequences handled
      rather than absorbed: the `transcript-dir` residue probe is GONE from `lib/agent-teardown.ts`
      (a surviving transcript dir is now POLICY, and a probe would have marked every hard delete
      incomplete forever), and its test is INVERTED to assert the absence by name so a future audit
      cannot restore the purge without reddening a test that says why. The transcript-inheritance
      cost is tracked as **TRDD-KO4TQCJ0**, not left in a code comment.
- [x] The boundary is recorded as a governance rule, not only as a memory note — **R52**, authored in
      `design/specs/governance-spec.md` as `GOV-R52` FIRST (spec-version 2.1.0 → 2.2.0) because the
      2026-07-22 authority inversion makes the spec the source of truth and `docs/GOVERNANCE-RULES.md`
      its emanation (v5.0.0 → 5.1.0). Carries the **USER-SCOPED-ELEMENT exception as R52.3** with the
      three readings it does NOT license, and **R52.2** records that the mandate binds the RUNTIME and
      not a user-invoked installer — without which it would forbid `install-messaging.sh`, which the
      same USER ordered in the same period (TRDD-217AYEOT). Part II row + tally updated from the
      coverage script's own output (51 → 52), because the coverage test derives Part II independently
      and caught the missing row.
- [x] The user-scoped-element exception class is recorded where the boundary is ENFORCED, not only in
      prose — the class note on `ALLOWED_OUT_OF_ROOT_WRITES` in `lib/write-boundary.ts`, naming the
      closed set (janitor · wikimem · 3-pillars · a few user-scoped plugins) and the three readings it
      does NOT license (user-scope install, undisciplined writes, deleting the user's own data)
- [x] `lib/oauth-rotator/slots.ts` — the out-of-root write the detector cannot see and nobody had
      recorded — is in `KNOWN_INDIRECT_WRITERS` with its class, and the test pin updated with it
- [ ] The 44 leaked test indexes in `~/.aimaestro/pillar-index/` are removed **after USER permission**
      (RULE 0: untracked, outside the repo) and the two leaking tests are contained via
      `tests/helpers/fake-ecosystem-home.ts` so the leak cannot recur
