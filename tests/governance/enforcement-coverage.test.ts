/**
 * GOVERNANCE ENFORCEMENT COVERAGE — the ratchet.
 *
 * WHY THIS EXISTS
 * ---------------
 * A missing authorization guard does not produce an error. It produces a SUCCESS that should
 * never have happened. That single asymmetry is why this project's governance could be
 * comprehensively unenforced while every test, every scenario, and every day of real use looked
 * fine — and why 33 of 42 rules sat unaudited for months without anything going red.
 *
 * A rule document that nothing checks is a wish. This test turns `docs/GOVERNANCE-RULES.md` into
 * a FIXTURE: every sub-rule must declare, in `docs/GOVERNANCE-ENFORCEMENT-MAP.md`, what enforces
 * it and what proves it. The properties it buys, none of which existed before:
 *
 *   1. A NEW rule cannot be added without declaring its enforcement status. Write R43.1 and this
 *      test fails until someone says whether code enforces it and which test refuses the
 *      violation. Governance-by-prose stops being free.
 *   2. A guard citation cannot silently rot. Every ENFORCED row names `file:line`; if the file is
 *      deleted or shrinks past that line, this fails. (It cannot prove the line still CONTAINS the
 *      guard — only a human read can — but it catches the file being moved or gutted, which is how
 *      citations usually die.)
 *   3. Holes can only shrink. `UNAUDITED_RULES` and the known-hole counts are pinned. Closing a
 *      hole is a diff that lowers a number; introducing one turns the suite red. Drift becomes
 *      loud instead of invisible.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not prove a rule is CORRECTLY enforced — only that something claims to enforce it and
 * something claims to test it. The claim is verified by the adversarial suites (a test that
 * attempts the forbidden act and asserts the refusal); this file only guarantees such a claim
 * EXISTS for every rule. Coverage is not correctness. But zero coverage is guaranteed incorrectness,
 * and that is the state this test ends.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * A guard may carry a GATE QUALIFIER: `services/x.ts:120-140 (DeleteAgent::G03)`.
 *
 * WHY a name and not just the line range. A line number is a coordinate into a file that keeps
 * changing, so a citation decays every time code above it moves — which is how R17.17 came to be
 * cited at `server.mjs:1709-1742` while its guard sat at `1766-1799`, reading as coverage and
 * sending the reader to code that does something else. A gate LABEL moves with the code it labels.
 *
 * The pipeline prefix is not decoration: gate numbers are per-pipeline local and heavily reused —
 * `G01` is "Marketplace missing" in InstallElement, "Title valid" in ChangeTitle, "Plugin name
 * valid" in ChangePlugin and "Agent found" in DeleteAgent. A bare `G01` citation is ambiguous four
 * ways; `DeleteAgent::G01` is unique.
 */
const GATE_QUALIFIER = /\(([A-Za-z_][\w]*)::(G\d+[a-z]?|EXE|PG\d+)\)/g

const ROOT = resolve(__dirname, '../..')
const RULES_DOC = resolve(ROOT, 'docs/GOVERNANCE-RULES.md')
const MAP_DOC = resolve(ROOT, 'docs/GOVERNANCE-ENFORCEMENT-MAP.md')

/**
 * Top-level rules whose sub-rules have NOT yet been through an adversarial enforcement audit.
 *
 * THIS SET MAY ONLY SHRINK. It is the honest ledger of what we have not looked at. Removing a
 * number is a promise: every sub-rule of that rule now has a row in the enforcement map.
 */
const UNAUDITED_RULES = new Set<number>([
  // Empty: the 2026-07-14 adversarial audit covered all 42 rules (289 sub-rules).
  // A number here is a promise we have NOT looked; the audit removed the last of them.
])

/**
 * How many ENFORCED rules currently name a real guard but NO adversarial test.
 *
 * This is the honest first-pass reality: the audit cited guards far more often than it cited
 * a test that watches each guard refuse the violation. Requiring a test on EVERY enforced row
 * on day one would force ~100 genuinely-enforced rules to be mislabelled UNENFORCED — trading
 * one dishonesty (a guard nobody tests) for a worse one (claiming a real guard does not exist).
 *
 * So instead this is a RATCHET COUNTER: it MAY ONLY SHRINK. Add an adversarial test for an
 * enforced rule → lower this number. Add a NEW enforced-but-untested rule → the suite goes red
 * until you either write the test or lower nothing (you cannot). The pressure to prove every
 * guard is real and permanent, but it is applied as a monotone decrease, not a false cliff.
 *
 * Set from the 2026-07-14 audit: of 141 ENFORCED rules, 136 cited a real guard but no adversarial
 * test. The headless-parity fixes (commit 1f1a53f1) then added tests proving the team-update
 * manage-team gate (R3.6) and the strict-body / field-strip guard (R8.2) in the delegated headless
 * path, paying the debt down to 134 (7 ENFORCED rules now carry a refusal test). It may ONLY fall —
 * write a refusal test for an enforced rule, drop this number; the test prints the live count so
 * you always know the new floor.
 */
// 2026-07-26: batch 1 of TRDD-H4Y9F25J pinned 17 more (R11.2/3/4/5/11 + R17.1/2/5/6/8/9/13/15/19/
// 21/22/23) in tests/governance/r17-r11-core-plugin-binding.test.ts — 134 → 117. R17.17 and R17.20
// were NOT pinned and are deliberately still counted: both guards are real, but they sit inline in
// server.mjs's `startServer`, which binds sockets on import, so there is no seam to call. Counting
// them as debt is the honest record — extracting the seam is the work that clears them
// (TRDD-L42SKUBW).
//
// 2026-07-26: batch 2 pinned 16 more (R3.2/3/4/5/7/9/12 + R9.1/2/4/5/6/7/8/11/12) in
// tests/governance/r3-r9-team-governance.test.ts — 117 → 101. R9.9 is the batch's one non-pin, and
// it is the SAME defect as R17.17/R17.20: the guard is real (server.mjs:1750-1764) but lives inside
// the `server.listen` callback of the un-exported startServer() IIFE. Three rules now blocked on one
// missing seam is no longer a coincidence — it is a structural property of server.mjs, and
// TRDD-L42SKUBW is where it gets fixed.
//
// One nuance worth keeping, because it will recur: R9.12's "guard" is an ABSENCE (`listAgents`
// filters on `!a.deletedAt` and nothing else), so "delete the guard → the test fails" has nothing to
// delete. It is pinned in the inverse direction — ADD the forbidden governance filter and the test
// fails — and was proven that way. An absence-invariant is still pinnable; it just needs the proof
// run backwards, and saying so beats quietly counting it as though it were an ordinary guard.
// 2026-07-26: batch 3 pinned all 13 of R6 (the communication graph) in
// tests/governance/r6-communication-graph.test.ts — 101 → 88. Two caveats recorded rather than
// glossed: R6.8 is pinned at LAYER 1 only (its layers 2/3 are prompt-level, in the role-plugin
// repos, with no server surface), and R6.10 is pinned at the contract the code ACTUALLY has —
// any truthy `inReplyToMessageId` unlocks a reply-only edge — not the stronger one its rule text
// aspires to. Writing the stronger test and then "fixing" production to match would have been a
// governance change smuggled in by a test batch; it is filed as TRDD-VLBVO0ZP instead.
// 2026-07-26: batch 4 pinned 22 of R20's 23 in tests/governance/r20-marketplace-governance.test.ts
// — 88 → 66. R20.28 is the one non-pin and the reason is honest: its guard is in a SHELL script
// (install-messaging.sh), where a vitest assertion could only grep the file's text. Pinning text is
// not pinning behaviour, so it stays counted rather than being cleared by a test that reads a
// string.
// 2026-07-27: batch 5 pinned all 7 of R5 (transfers) in
// tests/governance/r5-transfer-governance.test.ts — 66 → 59. First batch whose guards are ROUTE
// HANDLERS rather than a gate-labelled pipeline: there is no `ops` trace to assert, so the tests
// drive the real exported POST with a real NextRequest and fake only the stores beneath the guard.
// Two things that batch made explicit and are worth carrying forward: the create route returns 400
// from five different guards, so a status-only assertion would pass on the WRONG refusal — every
// case pins a fragment of its guard's own message; and R5.5 turned out to have TWO enforcement
// sites (create-time and a re-check on the approval path), which the map now cites separately.
// 2026-07-27: batch 6 pinned 7 of R18's 8 in
// tests/governance/r18-client-change-continuity.test.ts — 59 → 52. R18.8 is the one non-pin: its
// "emits a loss report" half lives in the converter's warning collector and its "proceeds anyway"
// half is the ABSENCE of an abort, so a test would assert that nothing happened — which passes on a
// pipeline that does nothing at all. It stays counted.
// The batch also corrected all 8 R18 citations (every one was wrong or too coarse) and audited the
// 22 gate qualifiers added in c5173e59, of which 7 were wrong. Deriving a gate NAME from a line
// RANGE is unsound when the ranges are themselves ~1/3 wrong — it turns a visibly vague citation
// into an authoritative-looking false one. See TRDD-W8NA7ROZ.
// 2026-07-29: batch 3 pinned R32.1 + R32.2 in tests/governance/r32-agents-never-sudo.test.ts —
// 42 → 40. Both guards were read against the CURRENT rule text before pinning; the sibling R39.5/
// R39.7 rows failed that same check (guards encode the pre-2026-07-22 shape) and were filed as
// TRDD-SPS63XHA instead, since a test written against a superseded guard passes and certifies it.
// 2026-07-29: batch 4 pinned R37.2/R37.3/R37.4 in tests/governance/r37-maestro-delegate.test.ts —
// 40 → 37. Chosen as the tightest single-FILE cluster left (all three guards live in
// app/api/governance/maestro-delegate/route.ts), which is the batching rule the plan settled on:
// one agent holds one file's mocking context instead of twenty rules' worth.
// 2026-07-29: batch 5 pinned R10.1 + R10.5 in tests/governance/r10-wake-gates.test.ts — 37 → 35.
// Both citations were WRONG in the same way R10.3's was: they named `wakeAgent`'s return-type
// declaration, ~26 lines above the gates. That is the citation defect the ratchet structurally
// cannot see — the range exists and holds real code — so only reading it finds it.
// 2026-07-30: TRDD-L42SKUBW pinned R9.9 + R17.17 + R17.20 in tests/unit/startup-guards.test.ts —
// 35 → 32. These three were unpinnable for ONE STRUCTURAL reason, not for lack of effort: all three
// guards sat inline in `server.mjs::startServer`, whose import side effect is a LISTENING SERVER, so
// no test could call them. Extracting each into an importable `.mjs` seam (precedent
// lib/session-validate-server.mjs) is what made them observable — the count did not fall because
// tests were written, it fell because the code became testable. The map rows now cite the seam AND
// the server.mjs call site, so an extracted-but-unwired guard is caught too.
// 2026-07-30: TRDD-SPS63XHA's ruling DOWNGRADED R39.5 + R39.7 from ENFORCED to CONTRADICTED — 32 → 30.
// This one did not fall by pinning anything: both rows cited real, working code that enforces the
// PRE-2026-07-22 rule text, and a test written against such a guard PASSES and thereby CERTIFIES the
// divergence. So the honest move was to stop claiming enforcement, not to write a green test. That is
// the defect this counter structurally cannot see — the guard exists, runs, and is wrong — and the
// only reason it was caught is that the re-citation campaign reads each cited range against the rule's
// CURRENT text. Re-upgrading them is TRDD-HW72YBZW's job, in the commit that builds the real channel.
// 2026-07-30: R19.1 + R19.3 pinned in tests/governance/r19-maintainer-title.test.ts — 30 → 28.
// It fell by pinning, two rules and two counts, with no downgrade in the mix. R19.2 moved in the
// same commit and is deliberately NOT part of the drop: it was recorded UNENFORCED over a LIVE
// guard, so upgrading it ADDED an ENFORCED row that arrived with its test already written — net
// zero here. That mis-verdict is the mirror image of the R39.5/R39.7 defect above (there the row
// claimed MORE than the code did; here it claimed LESS) and it is the one this counter is
// structurally blindest to, because a row claiming nothing is never audited. Both were found the
// same way: reading the cited range against the rule's CURRENT text instead of trusting a verdict.
// 2026-07-30: R19.10 pinned in the same file — 28 → 27. Its row cited `lib/ecosystem-constants.ts:331`,
// ONE line of the TITLE_PLUGIN_MAP const table, and a citation like that is worth less than none: a
// test written against a table stays green after every guard that READS the table is deleted, so the
// row would have reported a pin it never had. The row now cites the two gates that ACT on the binding
// (ChangeTitle G15 resolves title → plugin, G16 installs it) and the test drives the real pipeline with
// plugin sync ON, asserting the argv that reaches `claude plugin install`. Both neuters redden it, and
// they redden DIFFERENT halves — disabling G16 fails one test, mis-resolving G15 fails both — which is
// why the row cites both gates rather than whichever one was convenient.
// 2026-07-30: R20.5 pinned by the SAME tests — 27 → 26. It cites the same two gates, so once G15/G16
// were driven it became a free pin; the trap was that "free" invites pinning only the easy CLAUSE.
// R20.5 has two: the default auto-installs on grant, UNLESS the caller explicitly picked a different
// COMPATIBLE plugin. ChangeTitle has no option for that pick — the way an earlier pick SURVIVES a
// grant is G15's keep-branch, cited by nothing and driven by nothing. It is now pinned too, with the
// DEFAULT listed first in the compatible set, because with the standing pick first the else-branch
// selects the same plugin anyway and the test would stay green over a deleted guard. Its own neuter
// reddens exactly it. The row's line ranges were also stale (3089-3160 / 3162-3210, ~74 lines adrift);
// the gate-qualifier check cannot see that, since it verifies the LABEL exists, never the range.
// 2026-07-30: R12.3 pinned in the same file — 26 → 25, and its row was INTERNALLY INCONSISTENT:
// the range `3149-3152` sits squarely inside G14d while the qualifier said `ChangeTitle::G15`. The
// qualifier check passed regardless, because it proves the LABEL exists somewhere in the pipeline.
// The ops trace settled which was right, after two wrong guesses from reading: on a title CHANGE the
// enforcer is G14d — it uninstalls EVERY enabled role-plugin incompatible with the new title, leaving
// G15 nothing to swap. G15's swap branch is still load-bearing on the path G14d declines (an agent
// with NO old title carrying a stale plugin), so both are cited and each has its own test and neuter.
// Note the two gates are partly REDUNDANT: neutering either leaves the end state correct, and only
// the path-specific assertion reddens. That is a property worth stating rather than hiding behind a
// single end-state assertion that would survive losing one defender.
// 2026-07-30: R8.3 pinned in tests/governance/r3-r9-team-governance.test.ts — 25 → 24. DeleteTeam's
// G05 rejects the pending governance requests that named the team being deleted, so the risk is not
// "does the loop run" but "does it reject only what it should": a blunter guard that rejected every
// pending request, or every request of any status, satisfies the rule's own case perfectly. The
// fixture therefore carries four records, one per branch — a pending transfer for THIS team, a
// pending non-transfer for THIS team (the `else` arm, counted separately), a pending transfer for
// ANOTHER team, and an already-approved transfer for this one. The last two are the whole test; the
// first two would pass against a guard with no filters at all. Both neuters confirm it: dropping
// `if (!involvesTeam) continue` and dropping `if (req.status !== 'pending') continue` each redden it.
// Nothing is mocked — `governance-request-registry` resolves its file through `getStateDir()`, which
// this fixture already redirects, so the real registry writes a real file inside the fake home and
// the effect is read back off disk rather than off a spy.
// 2026-07-30: R4.4 pinned in the same file — 24 → 23. Its guard is ONE expression,
// `(desired.role || 'member')`, so the risk is not that it fails but that a test of it is vacuous:
// joining without a role and asserting MEMBER passes equally well against a guard that IGNORES
// desired.role and hardcodes 'member' — a different and wrong rule. The explicit-role case is
// therefore not a second scenario but the vacuity control, and the neuter shows they are
// independent: changing the default to 'autonomous' reddens the default case and leaves the control
// green. R4.4's second clause (the programmer plugin) is deliberately NOT re-asserted here — it is
// ChangeTitle's G15/G16 chain, already pinned with its own neuters in r19-maintainer-title.test.ts,
// and re-proving it through ChangeTeam would mean growing a plugin-resolution fixture to produce a
// weaker copy of an existing pin.
//
// Take this number from THIS test's own failure message, never from a hand-written grep. Mine said
// 27 because `R[0-9]+\.[0-9]+` does not match the lettered sub-rule `R17.18a`, and a count from the
// wrong pattern reads as a clean win — I was one commit from locking in a number my own awk had
// invented.
// 2026-07-30: 23 -> 21. R34.2 + R35.2 pinned by tests/governance/r34-r35-foreign-approval.test.ts.
// One file pins two rules because they share ONE guard (route.ts:46-49) — and each rule's THIRD
// clause (the signed-ledger write) sits at an UNCITED site further down the handler, so it is the
// half a citation-shaped audit structurally cannot see. Proven by a COMPLEMENTARY neuter pair:
// the two gates run in order, so a refusal test that withheld both credentials would pass with
// either gate deleted. Each test lets the OTHER gate pass, and each neuter reddens exactly one
// test (drop enforceMaestro -> only the R35.2 test; drop requireSudoToken -> only the R34.2 test).
// 2026-07-30: 21 -> 19. R7.2 + R7.9 pinned by tests/governance/r7-governance-loading-state.test.ts
// — the FIRST rules here pinned by rendering a component/hook, which the 2026-07-30 STATE ruling
// unblocked (a presentation rule's only possible enforcement point IS the client, so `.tsx` is
// correct and complete; the "a client check is no check" principle governs AUTHORIZATION).
// R7.9's guard is ONE expression (`useState(true)`), so its first version was VACUOUS and the
// neuter caught it: `result.current` is read AFTER effects flush, and the hook's effect sets
// loading=true itself, so the assertion passed with the initial value INVERTED. It now samples
// DURING render. Paired with a vacuity control (loading must reach false), because a lone
// "loading === true" assertion also passes against a hardcoded constant.
// 2026-07-30: 19 -> 18. R8.1 pinned by tests/governance/r2-r8-team-registry-invariants.test.ts.
// R8.1 is ALL-quantified ("ALL write operations use withLock"), so one mutator pins an instance,
// not the rule — it needs a MECHANISM half (drive a real mutator, prove the lock is taken at
// runtime) AND a COVERAGE half (no write site escapes it, which is what catches the sixth mutator
// added next year). Proven by neutering deleteTeam, which the mechanism half never drives: only
// COVERAGE reddened, naming deleteTeam by line.
//
// R2.2 is deliberately NOT counted despite living in the same test file. It has TWO clauses —
// server 409 AND a client-side inline error before POST — and only the server half is pinned.
// Its Guard column now cites BOTH sites (it previously cited one), so the gap is visible instead
// of being laundered into a "tested" row by a test that covers half the rule.
// 2026-07-30: 18 -> 16. R1.3 + R1.4 pinned by tests/governance/r1-teams-service.test.ts — one
// file, one guard-bearing function (`createNewTeam`), two rules of DIFFERENT SHAPES, and reading
// them the same way was the trap. R1.4 is a MUST enforced as a refusal (400 with no MANAGER), so a
// refusal test fits. R1.3 is a SHOULD enforced by AUTO-CREATION, not by refusing a COS-less create
// — a refusal test there would assert a behaviour the rule never claims and would break the
// one-field create dialog if anyone "fixed" the code to match it. Its honest assertion is the
// post-condition: the persisted team ends up carrying a COS. THREE neuters, because one certifies
// only the half it reaches: delete the manager check -> only the R1.4 test; never auto-create ->
// the R1.3 test (+ the containment test, which checks the auto-COS mkdir landed in the FAKE home);
// auto-create UNCONDITIONALLY -> only the "keeps an explicitly supplied COS" test.
// 2026-07-30: 16 -> 15. R7.7 pinned by tests/governance/r7-team-blocked-badge.test.tsx. Its two
// clauses live in two files — the BADGE in `TeamCard.tsx:71`, the CONDITION (`team.blocked`) in
// `lib/team-registry.ts:427`'s blockAllTeams, which is R1.5's already-pinned guard — so the row now
// cites both and this test drives the display half. Neuters: render the badge unconditionally ->
// only the healthy-team test; delete the badge -> only the blocked-team test.
//
// THREE citations were found ROTTED while scoping this batch, and a rotted citation is worse than
// a missing one: it names real working code, so nothing reddens and the row reads as enforced at a
// place it is not. R7.1 cited `TeamListView.tsx:94` (a `useState` for a cascade flag — the
// submitting guard had MOVED into PasswordDialog) and R7.3 cited `:192` (the middle of a comment
// block). Both re-cited to their real sites; both stay UNTESTED, because R7.1 is ALL-quantified
// ("ALL mutating buttons") and pinning one button would launder an instance into a rule. R7.8's
// row cited one of its TWO display sites — the second (`TitleAssignmentDialog.impl.tsx:274`,
// `resolveAgentName`) was invisible to every instrument; now cited, still untested because that
// resolver is an inline useCallback with no seam to drive short of rendering the whole dialog.
// 2026-07-30: 15 -> 14. R17.16 pinned by tests/governance/r17-core-plugin-no-uninstall.test.tsx.
// Two clauses ("MUST NOT show the X" + "MUST show a core label") decided by ONE ternary, so both
// have to be asserted: the label alone passes against a UI showing the label AND keeping the X,
// which is exactly what the rule forbids. The ORDINARY-plugin case is the third leg, and the
// neuter pair is what proves it earns its place — dropping the core branch reddens the two
// core-plugin tests; making it unconditional reddens ONLY the ordinary-plugin one (a read-only
// Plugins section, a louder bug than the one R17.16 prevents, that the first neuter cannot see).
// 2026-07-30: 14 -> 13. R11.6 pinned by tests/governance/r11-role-plugin-n-to-1.test.tsx. "Shows a
// dropdown when 2+ plugins are compatible" is only meaningful against its complement — a UI that
// ALWAYS showed the dropdown satisfies it while offering a choice of one — so the single-plugin
// lock is asserted too. The first neuter here was WRONG and reddened nothing: I mutated
// `hasMultipleOptions`, but the render is `isSingleLocked ? … : hasMultipleOptions ? …`, so the
// single-plugin case never reaches the expression the rule's text points at. A neuter that changes
// nothing is a finding about the TEST; the real pair is `isSingleLocked = false` (locked test only)
// and `hasMultipleOptions = false` (dropdown test + positive control).
// 2026-07-30: 13 -> 12. R33.1 needed NO new test — `tests/unit/portfolio-ledger.test.ts:115`
// already had a `describe('reconstructPortfoliosFromLedger (R33)')` that wipes the disk mirror so
// reconstruct is the only writer, then asserts all four replayed statuses (active / consumed /
// revoked / expired), `uses_remaining`, and the per-token `ledger_seq` re-anchoring. Neuter-proven:
// skipping the consume branch reddens exactly that test. The row's Test column was empty, which is
// the OPPOSITE failure to a rotted Guard — it understates coverage, inflates the ratchet, and makes
// the campaign look further from done than it is. Before writing a test for a remaining row, grep
// the test tree for the guard's exported symbol first.
// 2026-07-30: 12 -> 11. R18.8 pinned by tests/governance/r18-conversion-loss-report.test.ts. The
// already-tested sweep ran first and came back NEGATIVE for all three candidates, which is what
// made the shape of this test obvious. R1.1: all five hits `vi.mock` `checkTeamAccess` to return
// `{allowed:true}` — mocking the guard to prove the guard, so every one survives its deletion.
// R18.8: the only `WarningCollector` hit pins a model REWRITE (a mappable id with a note), while
// R18.8 governs the UNMAPPABLE case; and the row's second citation named `ChangeMetadata`, a rotted
// range with nothing to do with conversion — re-cited to the warn-and-continue path in the emitter.
// Two clauses that fail in OPPOSITE directions (silently dropping the feature vs aborting the
// conversion), so both are driven, and clause (b) is quantified over target clients — the coverage
// leg walks the emitter REGISTRY so a new client cannot ship an abort-on-loss path invisibly.
// Neuter pair: removing the loss-report call reddens ONLY clause (a); throwing on the unmappable
// field reddens the two proceed tests, coverage included — which is also what proves that loop
// reaches a real emitter rather than iterating vacuously.
// 2026-07-30: 11 -> 10. R1.1 pinned by tests/governance/r1-team-acl.test.ts — the row the sweep
// had just proven UNPINNED, which is what made it the obvious next one. R1.1 is definitional
// ("teams have isolated messaging, ACL, governance titles, and a COS") and three of those clauses
// own their own rows (R1.3/R1.4, R6, R9), so the ACL is the clause this row's guard carries. The
// load-bearing word is ISOLATED, so every membership assertion is a PAIR — allowed on the agent's
// own team, DENIED on another — because a guard returning `allowed` unconditionally satisfies "a
// member can reach their team" while violating the rule entirely. The two deliberate crossings
// (MANAGER everywhere; ORCHESTRATOR its own team only) are asserted so "isolated" is precise
// rather than approximate. Re-cited from the bare `:102` to the whole ladder `:54-103`, which is
// what the test actually drives. Neuter pair: making step 6 return `allowed:true` reds the
// outsider test and all three isolation pairs and NOTHING else; deleting the anonymous deny
// (LIB2-CRIT-02, where omitting a header once bought MANAGER-equivalent access) reds ONLY the two
// anonymous tests — and reds them on the REASON, because the request still ends at step 6 with
// `allowed:false` for the wrong stated cause. A test asserting only `allowed === false` stays
// green through that neuter, which is exactly why every assertion here pins the reason string.
// 2026-07-30: 10 -> 9. R40.1 pinned by tests/governance/r40-foreign-user-creation.test.ts. The rule
// is quantified over creation surfaces ("EVERY agent or team creation"), and it has ALREADY been
// half-enforced once: `create_team` sat in R40_RESTRICTABLE_COMMANDS while the guard was wired into
// CreateAgent ONLY, until the M3 fix of the 2026-06-19 audit. That is the exact failure one surface
// cannot see, so this is MECHANISM + COVERAGE — and the row now cites the CreateAgent G00f block
// too, since an enforcement site nothing cites is how the first half went missing. The mechanism
// half includes the FAIL-CLOSED branch: "a glitch must not silently grant a foreign user create
// rights" is a claim about a catch block, the kind that rots unobserved. Three neuters, because the
// surfaces must be provably independent: making the guard return null reds the 5 refusal tests and
// both coverage tests (the 5 allow/positive-control tests stay green); deleting G00f reds ONLY the
// CreateAgent test — the M3 regression reproduced exactly; deleting the create_team gate reds ONLY
// the createNewTeam test. Either single neuter alone would leave one surface free to lose its gate
// silently, which is the whole content of the word EVERY.
// 2026-07-30: 9 -> 8. R17.18a pinned by tests/governance/r17-no-auto-register.test.ts. This rule is
// ENFORCED BY AN ABSENCE — the discovery loop collects strangers into an array and simply never
// calls the registry writer — so there is no `if` to delete and the neuter has to ADD the forbidden
// behaviour instead of removing a guard. The assertions are post-conditions of NON-ACTION (the
// registry, the agent-workdir root and the AMP home are unchanged after a poll that saw a
// stranger), which is exactly the shape that passes VACUOUSLY against a discovery that found
// nothing — so the first test proves the poll ran and discriminated (stranger surfaced, known
// matched) in the same call the absences are measured from. Neuter: write the stranger into
// registry.json inside the collection loop → the two registry-absence tests red while the SURFACING
// test stays green, which is the discrimination that matters (the rule is "show them WITHOUT
// adopting them", and a neuter reddening both could not tell those apart). The workdir/AMP test
// stays green under that mutation too, correctly — it guards a different absence and would need its
// own; it is a second claim in the rule's text, not a duplicate of the first.
// 2026-07-30: 8 -> 7. R10.6 pinned by tests/governance/r10-restart-manager-gate-parity.test.ts. A
// PARITY claim across THREE sites: `wakeAgent` is one service function, but restart's gate is
// duplicated into a Next route handler and two headless handlers, and duplication is the shape that
// drifts — headless [id]/restart was authenticate-only until the 2026-07-14 audit, so full mode
// 403'd a restart headless allowed. All three are driven with ONE fixture and must answer the same
// status and the SAME message; agreement is the assertion, not merely refusal. THREE neuters, each
// reddening ONLY its own site plus the agreement test (which reads all three by construction) —
// that independence is what proves the sites do not share an implementation, which is the entire
// reason R10.6 exists as a rule. The wake half stays where it is (r3-r9-team-governance.test.ts's
// R9.5 block drives the real wakeAgent); together they are R10.6. This row was unpinned because the
// headless parity file's header CLAIMED the gate was "covered there by the governance suite" —
// measured false: `grep -rln "Cannot restart team agent" tests/` returned nothing. A comment
// asserting coverage is not coverage, and it is worse than silence because it stops the next reader
// looking.
// 2026-07-30: 7 -> 6. R1.2 pinned by tests/governance/r1-groups-are-lightweight.test.ts. The
// WIDEST absence in the map — its Guard column is a bare `lib/group-registry.ts` with no line,
// because there is no `if` to cite: the rule is that a whole class of machinery (COS agent, task
// board, governance fields) is never built for a group. So the neuters ADD the forbidden behaviour
// (R17.18a's shape), and each of the three — write a `cos-<name>` agent row, write a
// `tasks-<id>.json` board, put `chiefOfStaffId` on the record — reds ONLY its own absence. The
// contrast is what makes each one mean something, and all three were verified first-hand in the
// TEAM path: teams-service.ts:356 builds `cos-${teamSlug}`, task-registry.ts:66 names every team's
// board, types/team.ts carries the five governance fields types/group.ts does not. The fan-out test
// is not decoration: four absences about a subsystem that does nothing would pass vacuously, so a
// real broadcast reaching every subscriber runs through the same real registry the absences are
// measured from. The sweep was NEGATIVE a fifth time, in a shape already catalogued: three of the
// four group hits in the test tree MOCK the registry, and the fourth (r4-team-composition) reads
// its SOURCE to assert no subscriber ceiling — a different rule about the same file.
// 2026-07-30: 6 -> 5. R7.3 pinned by tests/governance/r7-no-silent-failures.test.tsx. The cited
// :636 is only the DISPLAY, and on its own it proves nothing — a component that renders `error`
// faithfully while three of its four failure paths never SET it satisfies that line and violates
// the rule, whose quantifier is "ALL failures". So this is MECHANISM + COVERAGE, and the row now
// cites all THREE sites (:636 display, :521 the setError seam, :277 the list banner) — a rule
// cited at one of its sites leaves the others invisible, because the citation they lack names
// real working code and nothing reddens. The failure paths were enumerated from the source: a
// server rejection, an unparseable body (the `.catch` fallback at :245), a thrown request, a
// client-side refusal, and a failed list load. The middle two are the classic silent-failure
// shapes and are the reason the rule exists. THREE neuters: deleting :636 reds the four
// dialog tests, no-op-ing :521 reds only the SERVER trio (the client-validation test stays
// green — that is what proves the two setError sites are distinct guards rather than one
// counted twice), deleting :277 reds only the list test. Neuter B is the load-bearing one:
// with A alone the file would look like five assertions about a single `&&`. Sweep NEGATIVE a
// sixth time: TeamListView is named in exactly one test file, and only in its HEADER COMMENT,
// as one of five callers of the shared PasswordDialog — which the create flow does not use.
// 2026-07-30: 5 -> 3. R4.8 + R7.8 pinned together by
// tests/governance/r4-r7-team-overview-display.test.tsx — two PRESENTATION rules whose guards sit
// four lines apart in TeamOverviewSection, so one render drives both. R4.8 is a PARTITION (:33-34
// splits the fleet into members and non-members) and needs BOTH halves: a roster-only test passes
// against a picker offering everyone, and a picker-only test passes against an empty roster.
// R7.8's second clause is the one a test would skip — "resolve the UUID" is easy with a resolvable
// COS; "NEVER show raw UUIDs" is about the branch where resolution FAILS, which is where a
// regression actually lands. Four neuters, each reddening exactly one test, so no neuter crosses
// between the two rules — that independence is what makes these two rows and not one counted twice.
// TWO of the four found bugs IN THE TEST, not in the code: (1) neuter A reddened NOTHING at first
// because `queryByRole('button', {name: /^bob$/i})` can never match — each picker entry renders an
// avatar initial, so the accessible name is "B Bob"; the assertion read as a guard and was vacuous.
// (2) neuter C reddened an R4.8 test too, because the roster had pinned the COS name to exactly 2
// occurrences (banner + row) — a coupling between two rows meant to be independent; the roster now
// asserts a floor and the both-places claim moved into R7.8, whose own word is "everywhere".
const MAX_ENFORCED_WITHOUT_TEST = 3

/** Verdicts a map row may carry. */
const VERDICTS = [
  'ENFORCED', // a guard refuses the violation; file:line cited, adversarial test named
  'UNENFORCED', // the rule says X and nothing refuses not-X — a hole
  'INVENTED', // the code enforces a policy the rule never states — needs a ruling
  'CONTRADICTED', // the code does the opposite of the rule, or two rules conflict
  'RULING-NEEDED', // the rule is silent where the code must choose; a human must decide
  'BEHAVIOURAL', // binds an agent's conduct, not the server; no code surface can enforce it
] as const
type Verdict = (typeof VERDICTS)[number]

interface MapRow {
  subRule: string
  verdict: Verdict
  guard: string
  test: string
}

/** Sub-rule ids declared in the governance document, e.g. "R10.3", "R29.1a". */
function parseSubRules(): string[] {
  const doc = readFileSync(RULES_DOC, 'utf8')
  const ids = new Set<string>()
  for (const line of doc.split('\n')) {
    // Rule tables are `| R10.1 | <text> | <source> |`
    const m = /^\|\s*(R\d+\.\d+[a-z]?)\s*\|/.exec(line)
    if (m) ids.add(m[1])
  }
  return [...ids]
}

/** Rows of the enforcement map: `| R10.1 | ENFORCED | file.ts:526 | tests/foo.test.ts |`. */
function parseMap(): MapRow[] {
  if (!existsSync(MAP_DOC)) return []
  const doc = readFileSync(MAP_DOC, 'utf8')
  const rows: MapRow[] = []
  for (const line of doc.split('\n')) {
    const m = /^\|\s*(R\d+\.\d+[a-z]?)\s*\|\s*([A-Z-]+)\s*\|([^|]*)\|([^|]*)\|/.exec(line)
    if (!m) continue
    rows.push({
      subRule: m[1],
      verdict: m[2].trim() as Verdict,
      guard: m[3].trim().replace(/`/g, ''),
      test: m[4].trim().replace(/`/g, ''),
    })
  }
  return rows
}

const ruleNumberOf = (subRule: string): number => Number(/^R(\d+)\./.exec(subRule)![1])

describe('governance enforcement coverage — the ratchet', () => {
  const subRules = parseSubRules()
  const rows = parseMap()
  const mapped = new Map(rows.map(r => [r.subRule, r]))

  it('the governance document is parseable and non-trivial (guards the parser itself)', () => {
    // If a formatting change silently breaks the regex, every assertion below would pass
    // vacuously — a test that cannot fail. Pin the floor.
    expect(subRules.length).toBeGreaterThan(250)
  })

  it('every AUDITED sub-rule has an enforcement-map row', () => {
    const missing = subRules
      .filter(id => !UNAUDITED_RULES.has(ruleNumberOf(id)))
      .filter(id => !mapped.has(id))
    expect(
      missing,
      `These sub-rules are declared in GOVERNANCE-RULES.md but nothing says what enforces them.\n` +
        `Either add a row to docs/GOVERNANCE-ENFORCEMENT-MAP.md, or add the rule number to\n` +
        `UNAUDITED_RULES and be honest that we have not looked:\n  ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('the enforcement map has no stale rows (every row names a rule that still exists)', () => {
    const known = new Set(subRules)
    const stale = rows.map(r => r.subRule).filter(id => !known.has(id))
    expect(
      stale,
      `The map cites sub-rules that no longer exist in GOVERNANCE-RULES.md — a renumbering or a\n` +
        `deletion left the map behind: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('every row carries a known verdict', () => {
    const bad = rows.filter(r => !VERDICTS.includes(r.verdict))
    expect(bad.map(r => `${r.subRule}=${r.verdict}`)).toEqual([])
  })

  it('every ENFORCED row cites a guard file that exists (and, if a line is given, one that exists)', () => {
    // A guard may be cited as `file.ts:NNN` (finest — catches a line-shift) or as a bare
    // `file.ts` (a whole-module guard, where pinning one line would be invented precision).
    // Both are real; both must at least point at a file that EXISTS. That is what catches the
    // failure mode this assertion is for: an ENFORCED rule whose guard was deleted or moved,
    // silently turning the rule unenforced with nothing else to tell you.
    const broken: string[] = []
    for (const r of rows.filter(r => r.verdict === 'ENFORCED')) {
      // A guard may be a bare `file`, a `file:line`, or a `file:start-end` range (the common
      // citation form). A row may cite SEVERAL guards, comma-separated.
      //
      // Two bugs lived here until 2026-07-26, and both let real rot through silently:
      //   1. `r.guard.split(',')[0]` validated ONLY the first citation, so the second guard of
      //      every multi-guard row (e.g. R6.9's `services/amp-service.ts:797-802`) was never
      //      checked at all — it could point at a deleted file forever.
      //   2. the range end was matched by a NON-capturing `(?:-\d+)?`, i.e. discarded outright,
      //      so `foo.ts:10-99999` passed as long as line 10 existed.
      // Validate EVERY citation, and validate the END of a range as well as its start.
      // A `(Pipeline::Gnn)` gate qualifier is checked by its own test below, not here — strip it
      // so it is not mistaken for a file path.
      const cites = r.guard.replace(GATE_QUALIFIER, '').split(',')
      for (const cite of cites.map(s => s.trim()).filter(Boolean)) {
        const m = /^([^\s:]+?)(?::(\d+)(?:-(\d+))?)?$/.exec(cite)
        if (!m || !m[1] || !/[./]/.test(m[1])) {
          broken.push(`${r.subRule}: guard is not a file path ("${cite}")`)
          continue
        }
        const [, file, startStr, endStr] = m
        const abs = resolve(ROOT, file)
        if (!existsSync(abs)) {
          broken.push(`${r.subRule}: guard file is GONE — ${file}`)
          continue
        }
        if (!startStr) continue
        const lines = readFileSync(abs, 'utf8').split('\n').length
        if (Number(startStr) > lines) {
          broken.push(`${r.subRule}: ${file} has ${lines} lines, guard cited at :${startStr} (moved?)`)
          continue
        }
        if (endStr) {
          if (Number(endStr) > lines) {
            broken.push(`${r.subRule}: ${file} has ${lines} lines, guard range ends at :${endStr} (moved?)`)
          } else if (Number(endStr) < Number(startStr)) {
            broken.push(`${r.subRule}: ${file} cites an inverted range :${startStr}-${endStr}`)
          }
        }
      }
    }
    expect(
      broken,
      `An ENFORCED rule cites a guard that has moved or vanished. The rule is now unenforced and\n` +
        `nothing else would have told you:\n  ${broken.join('\n  ')}`,
    ).toEqual([])
  })

  it('every ENFORCED row names an adversarial test that exists', () => {
    const broken = rows
      .filter(r => r.verdict === 'ENFORCED')
      .filter(r => r.test && r.test !== '—')
      .filter(r => !existsSync(resolve(ROOT, r.test.split(':')[0])))
      .map(r => `${r.subRule} → ${r.test}`)
    expect(
      broken,
      `An ENFORCED rule names a proof that does not exist:\n  ${broken.join('\n  ')}`,
    ).toEqual([])
  })

  it('ENFORCED-without-a-test is a shrinking ratchet — it may never grow', () => {
    // The lesson of this codebase, applied as a monotone decrease rather than a false cliff.
    // A guard nobody tests is a guard nobody has watched refuse anything — but downgrading every
    // such row to UNENFORCED on day one would claim real guards do not exist. So we COUNT them
    // and forbid the count from rising: every new enforced rule must arrive with its test, and
    // the backlog can only be paid down.
    const unproven = rows
      .filter(r => r.verdict === 'ENFORCED')
      .filter(r => !r.test || r.test === '—')
      .map(r => r.subRule)
    expect(
      unproven.length,
      `${unproven.length} ENFORCED rules name a guard but no adversarial test. This may only\n` +
        `SHRINK. If it grew, an enforced rule was added without a test — write one. If it shrank,\n` +
        `lower MAX_ENFORCED_WITHOUT_TEST to ${unproven.length} to lock the gain in.\n` +
        `Untested-but-enforced rules:\n  ${unproven.join(', ')}`,
    ).toBeLessThanOrEqual(MAX_ENFORCED_WITHOUT_TEST)
  })

  it('every gate qualifier names a real gate inside that pipeline', () => {
    // The rot-proof half of a guard citation. `file:line` decays whenever code above it moves;
    // `(DeleteAgent::G02)` is a name the gate carries, so it travels with the code and this test
    // fails only when the gate genuinely stops existing — which is exactly when the rule stops
    // being enforced there.
    //
    // Deliberately NOT asserted: that the gate is the RIGHT check for the rule. No parser can
    // read intent. This proves the cited gate EXISTS in the cited pipeline; a human read is still
    // what establishes it enforces what the rule says.
    const broken: string[] = []
    const srcCache = new Map<string, string[]>()

    for (const r of rows.filter(r => r.verdict === 'ENFORCED')) {
      const quals = [...r.guard.matchAll(GATE_QUALIFIER)]
      if (quals.length === 0) continue

      // A qualifier belongs to the file cited beside it. Every qualified row today cites exactly
      // one file; if that ever stops being true this refuses rather than guessing which file.
      const files = r.guard
        .replace(GATE_QUALIFIER, '')
        .split(',')
        .map(s => s.trim().split(':')[0])
        .filter(Boolean)
      if (new Set(files).size !== 1) {
        broken.push(`${r.subRule}: a gate qualifier needs exactly one guard file, saw ${files.length}`)
        continue
      }
      const file = files[0]
      if (!srcCache.has(file)) {
        const abs = resolve(ROOT, file)
        srcCache.set(file, existsSync(abs) ? readFileSync(abs, 'utf8').split('\n') : [])
      }
      const src = srcCache.get(file)!
      if (src.length === 0) {
        broken.push(`${r.subRule}: gate qualifier cites ${file}, which does not exist`)
        continue
      }

      for (const [, pipeline, label] of quals) {
        // Walk the file tracking the enclosing exported function, then ask whether THIS pipeline
        // pushes THIS label. Scoping to the function is the whole point — labels repeat across
        // pipelines, so a file-wide grep would pass on another pipeline's gate of the same number.
        let current = ''
        let sawPipeline = false
        let found = false
        for (const line of src) {
          const fn = /^export (?:async )?function ([A-Za-z_][\w]*)/.exec(line)
          if (fn) current = fn[1]
          if (current !== pipeline) continue
          sawPipeline = true
          // A COMMENTED-OUT gate is a dead gate. Caught by mutation: commenting out DeleteAgent's
          // five G02 pushes left this test green, because a regex over raw text cannot tell code
          // from a comment — the precise false-green this map exists to end. Skip comment lines so
          // disabling a guard fails here instead of passing quietly.
          const code = line.trim()
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue
          // TWO gate FORMS, because a pipeline may be hand-rolled or run under the AIO transaction
          // runner, and a citation must survive the retrofit between them:
          //
          //   hand-rolled   ops.push(`G09: Updated program in registry`)
          //   AIO runner    { id: 'G09', what: '…', run: …, undo: … }   (lib/gate-transaction.ts)
          //
          // The runner emits the SAME `G09: …` ops string at runtime, so the citation stays true —
          // but a scraper that only knows the literal push cannot see it, and would report every
          // retrofitted gate as "gone". ChangeClient hit this the moment it became the runner's
          // first production caller (TRDD-B6NUEGMP); TRDD-DQ6XN2VP retrofits 25 more pipelines, so
          // recognising only one form would have broken every citation in the map as it lands.
          if (
            new RegExp(`ops\\.push\\(\\s*[\`'"]${label}\\b`).test(line) ||
            new RegExp(`\\bid:\\s*[\`'"]${label}[\`'"]`).test(line)
          ) {
            found = true
            break
          }
        }
        if (!sawPipeline) {
          broken.push(`${r.subRule}: ${file} has no exported function ${pipeline}() (renamed or moved?)`)
        } else if (!found) {
          broken.push(`${r.subRule}: ${pipeline}() no longer pushes a ${label} gate — the guard this row cites is gone`)
        }
      }
    }

    expect(broken, `Gate qualifiers that no longer resolve:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('a gate-qualified citation carries NO line range', () => {
    // Measured 2026-07-30, and the number is why this is a hard rule rather than advice: of the 31
    // gate-qualified citations in the map, 22 (71%) pointed at the wrong lines. Every single drift
    // was POSITIVE, +63 to +623 — not random rot but the mechanical consequence of code being
    // inserted above, which the range cannot survive and the label does not notice.
    //
    // A range beside a qualifier is strictly worse than no range. It is unmaintainable by hand
    // (R4.4's rotted THREE times: :4956 landed inside ChangeHook, then :5128-5137, then :5304-5320),
    // it is not what the reader should trust, and — the part that made this invisible for months —
    // the test above proves only that the LABEL exists in the pipeline, never that the cited RANGE
    // contains it. So a row could contradict itself (R12.3 cited 3149-3152, inside G14d, while its
    // qualifier said G15) and still read green.
    //
    // The qualifier is the durable half BECAUSE it is the checked half. Keeping a second,
    // unchecked coordinate beside it buys nothing and decays continuously, so the grammar drops it:
    //
    //   gate-backed guard      services/element-management-service.ts (ChangeTitle::G15)
    //   no gate label exists   lib/team-acl.ts:120-140
    //
    // The range stays legal for guards with no label surface (route handlers, lib/ helpers) — there
    // is nothing better for those. This forbids only the combination that rots.
    const RANGED_QUALIFIER =
      /([^\s,|]+):(\d+)(?:-(\d+))?\s*\(([A-Za-z_][\w]*)::(G\d+[a-z]?|EXE|PG\d+)\)/g
    const offenders: string[] = []

    for (const r of rows.filter(r => r.verdict === 'ENFORCED')) {
      for (const [, file, start, end, pipeline, label] of r.guard.matchAll(RANGED_QUALIFIER)) {
        offenders.push(
          `${r.subRule}: ${file}:${start}${end ? `-${end}` : ''} (${pipeline}::${label}) ` +
            `— drop ":${start}${end ? `-${end}` : ''}", the qualifier already locates the guard`,
        )
      }
    }

    expect(
      offenders,
      `A citation may carry a line range OR a gate qualifier, never both — the range rots and\n` +
        `nothing checks it, so it silently sends readers to unrelated code:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it("Part II's published gate coverage still matches what the code says", () => {
    // Part II is DERIVED from code — `scripts/aio-gate-coverage.py` greps the enforcement dirs and
    // asks whether each rule's citation sits at a gate label. But the table in the doc is a
    // hand-COPIED snapshot, and until now the script never opened the file it feeds: the two were
    // decoupled sources of truth, so a change in gate coverage could leave the doc reading as
    // accurate forever. `--check` re-derives and compares; this makes it run.
    //
    // A missing interpreter FAILS rather than skips. A check that silently does nothing is the
    // exact defect this whole map exists to end — it reads as green while measuring nothing.
    const res = spawnSync('python3', [resolve(ROOT, 'scripts/aio-gate-coverage.py'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(
      res.error ?? null,
      'python3 is required to verify the enforcement map (preinstalled on macOS and ubuntu-latest)',
    ).toBeNull()
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0)
  }, 60_000)
})
