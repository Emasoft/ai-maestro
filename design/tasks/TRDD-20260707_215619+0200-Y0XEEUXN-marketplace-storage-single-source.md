---
trdd-id: Y0XEEUXN
title: Give the marketplace-storage layer one owner for manifest read + settings registration
column: todo
created: 2026-07-07T21:56:19+0200
updated: 2026-08-29T21:58:02+0200
current-owner: ai-maestro-hub-session
assignee: ai-maestro-hub-session
created-by: code-review
priority: 2
severity: LOW
effort: M
labels: [code-review, review-batch-20260707, reuse, altitude, tech-debt]
task-type: refactor
min-approval-requirement: none
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports/code-review/20260707_175225+0200-finder-CLEAN.json"]
---

# TRDD-Y0XEEUXN — Give the marketplace-storage layer one owner for manifest read + settings registration

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-29

**Part 1 is DONE for the READ helper only. Two of this card's premises were wrong; read
them before doing the rest, because one of them makes the obvious next step a mistake.**

- **DONE:** `readRoleClientMarketplacePlugins` and `readCustomClientMarketplacePlugins`
  are now ONE `readClientMarketplacePlugins(marketplaceDir)`. **The bodies were confirmed
  identical the RIGHT way, on the second attempt.** The first `diff` compared two
  hand-picked line RANGES of different lengths (32 vs 35), and its own output showed the
  role extract had overrun the function end — so it was comparing a body against a body
  plus six lines of the next function, and could not have detected a difference in a
  region it never aligned. Since the role copy was then DELETED, that mattered. Re-done
  brace-delimited (`sed -n '/^async function X/,/^}/p'`) against the PRE-MERGE blob, where
  both copies still exist, headers and path lines dropped: the only difference is ONE
  COMMENT line. Zero executable difference; the deletion took nothing with it. All four call sites already bound
  `marketplaceDir` on the preceding line, so the parameter cost nothing. All six functions
  had no caller outside this file. (Evidenced for the ROLE trio by a repo-wide grep; the
  CUSTOM trio was never searched — a third asymmetric-needle slip this session. The claim
  still holds indirectly: none carried `export`, and `tsc` would fail an unresolved import.
  Stated at that strength rather than as a measurement.)
- **PREMISE WRONG #1 — the `ensure`/`update` halves are NOT near-identical, and merging
  them the way this card describes would change behaviour.** Beyond the name and path they
  differ on `claude`: the ROLE pair early-returns (`if (targetClient === 'claude') return`)
  because role-plugin-service owns Claude's manifest, while the CUSTOM pair falls through
  and performs a LOCKED settings.json read-modify-write to register the marketplace with
  the Claude CLI (TRDD-RYFP030K). A shared helper would need flags for skip-claude,
  register-claude, the manifest name and the log prefix — four parameters to save ~40
  lines, which is worse than the duplication. **Recommend: dedup the read (done) and leave
  `ensure`/`update` alone**, or reduce the scope of this card to part 2.
- **PREMISE WRONG #2 — "exercise the full plugin-conversion test path" describes a path
  that does not exist.** MEASURED: stubbing the merged reader to `return []`
  unconditionally left all 24 tests of the four conversion suites GREEN
  (`change-client-matrix`, `install-element-codex-adapter`, `createagent-g08-cross-client`,
  `marketplace-supported`). Precisely: no conversion test OBSERVES this function's return
  value — a test that called it and ignored the result would also stay green, so this is
  "uncovered", not provably "unreached". Either way "24/24 still pass" after the refactor
  was a VACUOUS confirmation. `tests/unit/client-marketplace-manifest-read.test.ts` now covers
  it directly — 6 tests including both manifest shapes (Claude `source` string vs Codex
  `source` object), the both-present precedence, the no-manifest case, and malformed
  entries. Two neuters attributed: stubbing the reader reds 5 of 6; breaking only the Codex
  object decode reds exactly the Codex test.
- The helper is `export`ed for that test and has no production caller outside the module;
  the comment above it says so.

- **PREMISE WRONG #3 — part 2 (the pipeline move) is smaller than this card says; the CARD'S
  OWN TITLE ("one owner") is much bigger.** The route makes 5 pipeline calls
  (`route.ts:1235,1294,1540,1589,1693`) but WRITES `extraKnownMarketplaces` at two,
  1552 and 1604, both immediately after a `CreateMarketplace`; 1320 and 1684 are reads,
  opened rather than inferred. So the pipeline move is two stamps into ONE branch
  (`ChangeMarketplace`'s `add`) — the old NEXT ACTION's "5 route handlers plus 3 pipelines"
  was a CALL-SITE tally standing in for a WRITE-SITE tally.
- **THE CENSUS, repo-wide — this corrects a file-scoped claim two earlier revisions of this
  bullet made.** `git grep -nE '\.extraKnownMarketplaces[[:space:]]*=' -- '*.ts' '*.mjs'
  ':!design' ':!tests'` → **SEVEN** assign-back sites, not two. Two are the route stamps
  (1552, 1604); two are the pipeline's own G05 run + undo (service:5938, 5958); and **three
  were never counted at all**:
  - `plugin-storage-service.ts:939` — registers the per-client CUSTOM marketplace,
  - `role-plugin-service.ts:720` — registers the ROLE marketplace,
  - `role-plugin-service.ts:1101` — deletes three deprecated marketplace names.

  Each of the three writes `~/.claude/settings.json` DIRECTLY, via its own
  `updateJson(USER_GLOBAL_SETTINGS, …)` — that much is read and settled. What is NOT checked
  is who CALLS them, so "none goes through any pipeline" is not yet earned as a claim about
  callers, and part 3's scope depends on it: if `role-plugin-service:719` is reached from an
  AIO pipeline, part 3 is a different job than this card implies. `plugin-storage-service.ts:927-929`
  says the collision out loud in its own comment: it locks
  because role-plugin-service "registers a DIFFERENT marketplace into the SAME
  `extraKnownMarketplaces` object".
- **AND THE ASSIGN-BACK CENSUS IS ITSELF A FLOOR — a SIXTH writer does not use that idiom.**
  The needle above matches `settings.extraKnownMarketplaces = ekm` only. `auto-update-service.ts`
  never writes that way: it emits `SettingsOp` keyPath ops applied inside one locked
  `editSettings` — `{op:'set', keyPath:['extraKnownMarketplaces', name, 'autoUpdate'], value:true}`
  at 524, and at **542** `{op:'set', keyPath:['extraKnownMarketplaces', name], value:{source, autoUpdate:true}}`,
  which writes a WHOLE ENTRY INCLUDING ITS `source` — a full registration by any measure.
  **State the unit, because three units give three numbers:** 7 write SITES (route 2 +
  plugin-storage 1 + role-plugin 2 + auto-update 2), 4 MODULES, and **6 distinct LOCKED
  WRITES** — auto-update's two op kinds land in ONE `editSettings`. Six is the meaningful
  figure and "locked writes" is the unit; "six writers" was 5 sites plus 1 module. And the
  scope, since every earlier count omitted its own: this is closed over files that spell the
  key LITERALLY, in `.ts`/`.mjs`. A writer reaching it through an imported constant would sit
  outside all 10 files and outside this number.
- **The reconciliation nobody has costed, and it is the real obstacle to "one owner".** Those
  542 ops are fed by `readRegistryMarketplaces()` (:574-588) — VERIFIED by reading it: it
  parses `~/.claude/plugins/known_marketplaces.json`, returns `[name, source|null]` pairs,
  and FAILS OPEN (`catch → []`). A SECOND store, holding entries settings.json lacks.
  **It passes `source` through VERBATIM** — `value: {source, autoUpdate: true}` never inspects
  or normalises it — so whatever the harness writes lands in `extraKnownMarketplaces`
  unconstrained. That is the mechanism behind the tolerant reader: `marketplaceAddArg`
  scavenges keys because this path admits shapes this repo does not author.
- **CADENCE: 4-HOURLY, and an earlier revision of this bullet said 3 because it trusted a
  comment over the constant.** `ABSORBED_DUTY_INTERVAL_MS = 4 * 60 * 60 * 1000` (:116,
  annotated "USER directive 2026-08-07: 3h -> 4h"), while the prose at :464 still says the
  lane "ticks every 3 h" — stale, not updated with the constant. The timer fires at
  `ABSORBED_DUTY_POLL_MS = 15 * 60 * 1000` (:136) and each fire gates on a persisted stamp,
  so 15 min is the POLL and 4 h is the CADENCE. Recording the stale comment here because the
  next reader will hit it too. Chain, with ONE link inferred rather than seen — the
  `runAbsorbedDutyTick` → `runAbsorbedDutyTickBody` hop is name-adjacency, never a call I
  read, so this is not "traced end-to-end" as a draft claimed. Cadence is decorative to every
  argument here anyway: a second store is an obstacle at any period.
  `startAbsorbedDutyScheduler` → `setInterval(runAbsorbedDutyPoll, POLL_MS)` (:259-263) →
  `runAbsorbedDutyTickSafely` (:290) → `runAbsorbedDutyTick` → `runAbsorbedDutyTickBody`
  (:657) → `ensureMarketplaceAutoUpdate` (:667), which is the function holding the 542 write;
  `absorbedDutyIsOverdue` (:305-311) is the 4 h gate, anchored on `lastAbsorbedRunAt`.
- The lane's own comment calls
  `extraKnownMarketplaces` "the AUTHORITATIVE record of where a marketplace comes from"
  (auto-update-service.ts:459) while its BOUNDARY note (470-475) says the registry is
  deliberately out of scope for the gate. Consequence for this card: the discriminant
  vocabulary is NOT enumerable from the route's two values plus the services' `'directory'` —
  whatever the registry supplies flows in through 542. An encoder for part 2 must therefore
  agree with a vocabulary it does not control.
- **`settings-gate.ts:223` is the policy layer, not a writer** — it matches keyPath length 2
  with `k[0] === 'extraKnownMarketplaces'` to authorize exactly these writes. The remaining
  hits are reads (`global-plugins/route.ts:75`, `global-elements/route.ts:542`) or prose
  (`write-boundary.ts:277`, `claude-settings-enforcer.ts:11`). All six files examined, so
  the census is closed over every code file that NAMES THE KEY LITERALLY in `.ts`/`.mjs` —
  which is the honest scope, not "closed".
- **The one competing prior measurement, reconciled rather than left hanging.**
  `docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md:58` says this repo "reads AND writes the canonical
  key by name through raw `settings.json` parsing at **16 files**", which reads as a
  contradiction of any single-digit count. It is not: `git grep -l` gives **10** code files
  and **16** including tests, and the audit's figure counts READ sites and test files too.
  Six WRITERS and sixteen FILES are answers to different questions.
- **The asymmetry is the actual argument for part 2.** `DeleteMarketplace` ALREADY owns the
  entry — VERIFIED by reading `element-management-service.ts:5900-5975`, not inferred from
  grep proximity as an earlier revision of this bullet did: `{ id: 'G05', what: 'Remove the
  marketplace from extraKnownMarketplaces in settings.json', run, undo }` is a real gate
  descriptor, and 5947-5958 sits under its `undo:` key, restoring `ekmEntry` snapshotted at
  5789. So the pipeline layer removes, and compensates for, an entry it never adds.
- **The route comment survives, and my two attempts to break it were both overstatements.**
  `route.ts:1598-1600` says stamping is "the route's stamping concern, not the pipeline's;
  the pipeline stays source-agnostic". Revision 1 of this bullet said that "cannot hold";
  revision 2 said the pipeline "already DECODES the settings.json source vocabulary" because
  `marketplaceAddArg` (service:5688-5696) probes `['repo','url','path']` on `entry.source`
  to build G04's undo argument. Both too strong, and the detail I offered as proof argues
  the other way: that function loops three KEY NAMES and returns the first non-empty string,
  never reading the `source.source` discriminant. Handling a `url` key the route never
  stamps is the tell — tolerant key-scavenging is what you write when you do NOT own the
  shape. **The conclusion is what survives, and it is enough:** part 2 makes the pipeline
  CHOOSE the discriminant, and `source.source` is read by nothing in the pipeline today.
  **NO TYPE IS ENFORCED AT ANY EKM WRITE SITE, and an earlier revision of this bullet claimed
  one was.**
  That revision cited `PluginSource` (types/marketplace.ts:97-102) and `MarketplaceSource`
  (:143-147), both `source: 'github' | 'url' | 'local'`, and concluded production "writes a
  value the type forbids". WRONG — I matched a type that mentions the right values instead of
  checking what it governs. Measured: `MarketplaceSource` is used at :124 and :231 (a
  `Marketplace` carrying `id`/`installLocation`/`owner`, and a summary with
  `pluginCount`/`skillCount`); `PluginSource` at :77 (a `Plugin` carrying `marketplace: string`).
  Those are AI Maestro's OWN domain model. An `extraKnownMarketplaces` entry is
  `{source: {...}, autoUpdate: true}` — a wrapper with an `autoUpdate` field none of them
  declares — and `git grep` finds **zero** ekm values annotated with either type: twelve
  inline casts, ten of them bare `Record<string, unknown>`. So `'directory'` violates nothing.
  The store belongs to Claude Code. **Stated at exactly that width:** the twelve casts are
  dispositive for the WRITE PATH — no type is enforced at any ekm write in this repo — and
  that is all the card needs. Whether some type somewhere describes the shape is neither
  established nor relevant: a type over Claude Code's own file could not make `'directory'` a
  violation *here*. (The previous revision over-claimed these types' JURISDICTION; a draft of
  this one over-claimed their NON-EXISTENCE, from the same evidence. Same error, opposite
  sign.)
- **The OTHER store IS typed locally, and its union is narrower still.**
  `lib/marketplace-skills.ts:57-64` declares `KnownMarketplace` — `{source: {source:
  'github' | 'url', repo?, url?}, installLocation, lastUpdated?}` — and
  `getKnownMarketplaces()` (:70) reads `known_marketplaces.json` (`KNOWN_MARKETPLACES_FILE`,
  :41). So the registry that feeds ekm through auto-update:542 has a declared TWO-value union
  containing neither `'local'` nor `'directory'`, no `autoUpdate` field, and an
  `installLocation` the ekm entry lacks. It types the registry, not ekm — the retraction above
  stands — but it means the path-based values this card's part 3 must rule on are undeclared
  in BOTH stores.
- **The stored vocabulary, by PROVENANCE rather than by authority.** Written to ekm in
  production: `'github'`, `'local'` (route.ts:1604/1551), `'directory'` (plugin-storage:938,
  role-plugin:719). Tolerated by the reader: `'git'`/`'url'`, seen in
  `marketplace-auto-update.test.ts:41` and `migrate-r20-marketplace-sources.test.ts:161`, plus
  whatever the registry feeds through auto-update:542 unnormalised. A test asserting a shape is
  evidence the code must TOLERATE it, not that this repo writes it.
- **Scope of the literal censuses, stated so the numbers stop reading as totals.** The
  single-line needle structurally cannot see a nested literal broken across lines by the
  formatter, and that blind spot is REAL, not hypothetical:
  `lib/converter/marketplace-emitters.ts:168` is exactly such a case. Two honest limits on
  that, though: its value (`'local'`) was already in the set, so no count moved; and it is a
  MANIFEST emitter, not an ekm write — so it demonstrates the needle's blind spot in a
  DIFFERENT census than the one this card depends on. **Do NOT write "every ekm site found is
  single-line" as reassurance** — a draft of this bullet did. It is true BY CONSTRUCTION, since
  both needles that found those sites require single-line spelling, so it carries zero
  information; it is the same vacuous shape as this card's "24/24 conversion tests still pass"
  and its pre-probe "0 validate rows". The honest form: both instruments share a spelling
  assumption, so neither can bound what the other missed. With no type enforced at the write
  sites, this scope caveat is load-bearing, not decorative.
- **SPLIT THE COST BY PART, because merging the two overstates part 2.** An encoder for
  **part 2** chooses between **TWO** values — `'github'` and `'local'` are the only ones
  `CreateMarketplace` can produce from its `{repo}|{path}` input, and both are declared. That
  is a mechanical mapping with no judgement in it. An earlier revision said "three values
  wide" and used the merged figure to size part 2 — wrong on both axes.
- **PART 3 LOOKS LIKE A SEMANTIC DECISION RATHER THAN A REFACTOR — stated at the strength the
  evidence supports, which is less than an earlier revision claimed.** MEASURED: two
  discriminants are written for path-carrying marketplaces by different modules — `'local'` at
  route.ts:1551, `'directory'` at plugin-storage:938 and role-plugin:719. A single owner has to
  emit ONE of them, so it must choose. **NOT MEASURED: that they MEAN the same thing.** Both
  carry a path; that is all that was checked. A deliberate distinction is plausible — `'local'`
  comes from `handleAddMarketplaceFromPath`, a user pointing at one marketplace directory,
  while `'directory'` is AI Maestro registering its OWN generated dir, and both AI-Maestro-owned
  writers chose it independently, which is weak evidence of intent rather than drift. An earlier
  revision also argued `'local'` "has the type on its side"; that tiebreaker is GONE with the
  type (see above), so if anything the ruling is harder — there is no declared authority to
  appeal to, and canonicalising the wrong way would be a behaviour change, not a cleanup.
  **What survives as a decision input:** part 2 is a two-value mechanical mapping over values
  `CreateMarketplace` already receives; part 3 opens by answering a question nobody has asked
  the CLI yet, and then either migrates stored user state on every host or tolerates both
  spellings forever.
- **FEASIBILITY: no new parameter is needed.** `CreateMarketplace` already takes
  `source: { repo: string } | { path: string }` (service:5416-5421) — precisely the two
  shapes the route stamps (`{source:'github',repo}` / `{source:'local',path}`). The
  pipeline can derive the entry from what it is already given.
- **THE COST, stated because it is the reason to ask first — and it is BIGGER than "one more
  gate".** `add` today has ONE mutating gate with nothing abortable after it, which is
  exactly why it carries no compensation. Adding the stamp puts something abortable AFTER
  the CLI registration, so the bill is not just the new gate's own undo: the EXISTING
  registration gate acquires an un-register compensation it does not have today. The
  two-store window already exists — it straddles the route/pipeline boundary, where nothing
  can compensate it — so part 2 relocates the window somewhere it can be closed, and pays
  for the closing. `marketplaceAddArg` is the mirror already written for the remove side;
  the add side would need its `remove` counterpart. Same design surface as the owner-gated
  trade in TRDD-DQ6XN2VP.
  INFERENCE FROM MEASURED TEXT, not itself measured — the distinction matters because an
  earlier revision asserted it from a recalled lesson and a later one called it measured.
  What is measured is the PREMISE, quoted from service:5760-5767: "`add` and `update` each
  have exactly ONE mutating gate with nothing abortable after it, so any `undo` written for
  them would be unreachable code that READS as a guarantee". The CONCLUSION — that G03
  acquires an un-register compensation — follows in one step: a second abortable gate makes
  G03's undo reachable, and the same comment invokes `runGateSequence`'s refuse-to-start
  check for exactly that reason on `update`. `marketplace remove` is an honest compensation,
  which `update` has none of. Short and safe, but an inference.

**NEXT ACTION.** Part 2 is a SMALL, well-scoped change (2 route write-sites → 1 pipeline
branch, no new parameter), but it adds a gate + compensation to an all-in-one pipeline,
which is TRDD-DQ6XN2VP's open owner-gated surface. Blocked on the owner: implement it here,
or fold it into that card's trade. Not started.

## Problem

Two related duplications in the marketplace-storage / marketplace-route layer:

1. **Duplicate client-marketplace helpers** — `readRoleClientMarketplacePlugins`
   / `ensureRoleClientMarketplace` / `updateRoleClientMarketplaceManifest`
   (`services/plugin-storage-service.ts`, TRDD-YFCNYVYB) are ~85 lines that
   are near byte-for-byte copies of the pre-existing `readCustom*` /
   `ensureCustom*` / `updateCustom*` trio, differing only in the
   marketplace-name string (bare `LOCAL_MARKETPLACE_NAME` vs
   `${CUSTOM_MARKETPLACE_NAME}-${targetClient}`) and the path helper
   (`getRoleMarketplacePathForClient` vs `getCustomMarketplacePathForClient`).

2. **Scattered settings.json registration** —
   `app/api/settings/marketplaces/route.ts`'s `handleAddMarketplaceFromPath`,
   `handleInstall`, `handleUninstall`, `handleDeleteMarketplace`,
   `handleUpdateMarketplace` each independently patch
   `extraKnownMarketplaces` in settings.json after calling their pipeline
   function, because `CreateMarketplace`/`DeleteMarketplace`/`UpdateMarketplace`
   don't own their own settings.json registration end-to-end.

## Root cause

Both stem from the same gap: the marketplace-storage layer never centralized
(a) the per-client manifest read/seed/write logic, nor (b) the settings.json
`extraKnownMarketplaces` mutation. So a manifest-parsing edge-case fix (e.g. the
Claude-string-vs-Codex-object `source` field) must be applied to both the role
and custom trios, and a marketplace-source-shape change must be hunted across
5 raw-write call sites. The file's own comments already document this pattern
producing orphaned-key bugs (BUG-MKTNAME-001, SCEN-019 BUG-002/BUG-003).

## Proposed fix

1. Factor the manifest read/seed/write trio into ONE parameterized helper set
   taking `(container, marketplaceName)` — `readClientMarketplacePlugins`,
   `ensureClientMarketplace`, `updateClientMarketplaceManifest` — and have the
   role and custom call sites pass their respective name/path. Delete the
   duplicated trio.
2. Move `extraKnownMarketplaces` registration INTO the
   `CreateMarketplace`/`DeleteMarketplace`/`UpdateMarketplace` pipeline
   functions so each owns its settings.json write end-to-end; the route
   handlers stop patching settings.json below the pipeline call. One place then
   knows the `{ source: 'local'|'github', path|repo }` shape.

## Verification

- One manifest helper, one registration owner; a source-shape change is a
  single edit. `npx vitest run` green; existing marketplace-route tests +
  SCEN-019 still pass.

## Estimated risk

MED. `plugin-storage-service` conversion helpers and the settings.json
registration are used by every plugin install/convert flow; behavior must be
preserved exactly (the role trio keeps the bare `LOCAL_MARKETPLACE_NAME`, the
custom trio keeps the `-<client>` suffix — the shared helper must not
homogenize them). Land as its own PR with the full plugin-conversion test path
exercised.

## Acceptance

- [x] The two manifest READ helpers are one function; the duplicate is deleted and every call site repointed. Bodies confirmed byte-identical by `diff` before merging, so the merge is a rename plus a parameter the callers already had.
- [x] The merged reader has direct behavioural coverage — both manifest shapes, precedence, absence, malformed entries — with two attributed neuters proving it non-vacuous.
- [x] `yarn tsc --noEmit` exit 0; the five relevant suites 30/30 (24 pre-existing at their recorded baseline + 6 new).
- [ ] ~~Factor the `ensure`/`update` trios into one parameterized helper set.~~ **DECLINED as specified** — measured, they differ on `claude` handling, not just on a name string; see STATE. Reopen only with a design that keeps the two behaviours distinct.
- [x] Part 2: `extraKnownMarketplaces` registration moved into `ChangeMarketplace`'s `add` branch as G03b, with a compensation, and `route.ts` no longer stamps settings.json below the `CreateMarketplace` calls. **DONE** — full suite green (504 files / 6617 tests); four new tests in `change-marketplace-rollback.test.ts`, two neuters attributed (G03's undo → the deregister test; the discriminant encoder → both happy paths). (`remove` already owns the entry at service:5923-5946 with an undo, so Delete needs nothing; Update never writes it.)
- [ ] Part 3 (NEW, and the part that actually answers this card's title): the three non-pipeline writers — `plugin-storage-service.ts:939`, `role-plugin-service.ts:720`, `role-plugin-service.ts:1101` — write `extraKnownMarketplaces` directly, through no pipeline at all. Part 2 gives the key ONE owner only for marketplaces created via `CreateMarketplace`; these three are why "one owner" is still false afterwards. **NOT STARTED** — scope unknown, not yet costed.

## Approval log

- 2026-08-20T22:20:37+0200 — classified min-approval-requirement: none (was UNSET) and re-filed design/proposals/ → design/tasks/ as column: planned. Floor is none: deduplicating ~85 near-byte-identical marketplace-storage helpers and giving the settings.json registration one owner is an in-scope, reversible refactor of this project's own source, with zero D3 floor signals. A Tier-0 task does not belong in the proposals folder. Nothing was approved here; a Tier-0 card has no approver.
