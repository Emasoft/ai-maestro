---
trdd-id: B7G2R0SX
title: Harness-readiness acceptance criteria + un-gated verification pass (make the spec-first authority trustworthy)
column: design
created: 2026-07-22T20:59:43+0200
updated: 2026-07-22T21:10:00+0200
current-owner: session
task-type: audit
scope: project
project-id: ai-maestro
min-approval-requirement: none
relevant-rules: [41, 42]
eht: []
npt: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-22

**Origin.** After the governance-spec full-fidelity rewrite (TRDD-CJWC3JLU, complete), a standing
Stop-hook condition "make the ai-maestro harness ready" kept firing. "Ready" was undefined. The USER
selected "Define 'ready' criteria" (AskUserQuestion) but gave no criteria text and no confirmation is
arriving (unattended session). This TRDD is the DEFINITION the USER asked for, plus the SAFE, UN-GATED
subset of the resulting work that proceeds without further approval under the standing /go-on-yourself
mandate. **High-stakes / 🔒-gated items are NOT started here** — they stay as their own tier-appropriate
TRDDs and wait for the USER.

**The proposed "harness ready" bar (awaiting USER confirm/edit on the mutating items).** Status:
`✓`=verified · `~`=partial/by-design · `◻`=open · `?`=inferred-unverified · `🔒`=user-gated.

- **A · Governance-doc authority (spec-first inversion)**
  - `✓ A1` spec = complete authoritative source of truth (rewrite 0-miss ×6, conformance 14/14).
  - `~ A2` inversion propagated: catalog §0 ✓ + MANAGER #30 ✓; **in-repo DEP overlays `rules/aimaestro/*.md`
    = CLEAN** (verified 2026-07-22: zero stale "catalog is canonical / authoritative / source" claims).
    Remaining: the 8 cross-repo role-plugin personas — UNVERIFIED (need fetch; may be a non-gap if they only
    CITE rules rather than name the catalog THE source) + any correction is ISSUE/PR only + OUTWARD → USER go-ahead.
  - `✓ A3` conformance harness runs IN CI — `.github/workflows/ci.yml` runs `yarn test` (full vitest suite,
    incl. `governance-spec-conformance` + the 378 enforcement tests) on push **and** PR to main.
- **B · Rule enforcement ("all governance rules enforced")**
  - `✓ B1` **ENFORCEMENT VERIFIED (2026-07-22)** — the burned-lesson gap is test-enforced + passing:
    `sudo-guard-strict-agent-coverage.test.ts` **10/10** (every strict route DECLARED / owner-only / pending;
    unknown fails-CLOSED; R42 refuses cross-agent DRIVE, admits CONFIG; the 5 TRDD verbs deferred to
    `authorizeTrddVerb`); broader `sudo`+`authorization`+`portfolio` suite **378/378** green.
    `requireSudoToken`→`requireAidTitle` fails CLOSED on any undeclared strict route. No gap found.
  - `~ B2` R42 no-agent-drives-another — API-enforced; tmux hole = known honest limit (OS isolation
    TRDD-a1019073). Bar decision: accept the documented limit vs require isolation.
  - `~ B3` R41/R49 approval+refusal — server-authz + token-verify shipped; `OPERATIONS_REQUIRING_TOKEN` off
    by deliberate governance choice. Bar decision: keep off vs flip on (separate blast-radius decision).
- **C · Agent-workdir invariants ("agents safely rely on the harness")**
  - `✓ C1` agent-invariant registry + watchdog LIVE at boot — `server.mjs:1911-1962` runs a boot sweep over
    the fleet + `startAgentInvariantsWatchdog`.
  - `✓ C2` DEP rules seeded read-only + self-healing — `lib/agent-rules-seed.ts` (`ensureAgentRules`) +
    `lib/agent-invariants.ts` (dep-rules row: create·wake·periodic).
- **D/E · Fleet continuity + remote access** (separately-tracked program, NOT this TRDD): KCRMSNL7,
  CHN16JXZ, OC9ELGSO/#40, P7XKV3N9 (🔒), OAuth (🔒 R16), MAESTRO console-presence (🔒 R48).
- **F · No capability gaps** — coverage scan: every shipped route/skill/command/hook has a test.

**RECOMMENDED TIGHT BAR (un-gated, high-value):** A2 (propagation issues) + A3 (verify/wire CI + coverage) +
B1 (enforcement-verification) + C1/C2 (confirm watchdog + DEP self-heal live). D/E excluded.

**✅ UN-GATED VERIFICATION DONE (2026-07-22).** B1/A3/C1/C2 all VERIFIED GREEN — evidence
`reports/harness-readiness/20260722_210500+0200-b1-a3-c1-c2-verification.md`. **No enforcement gap found,
nothing needed fixing:** the strict-route/sudo/authorization layer is test-enforced (378 green) + fails
CLOSED, the conformance test is CI-gated on every PR to main, and the invariant watchdog + DEP self-heal are
boot-active. So the spec-first authority is not just documented — its enforcement + invariants are proven.

**NEXT ACTION (the one remaining un-gated item, but OUTWARD-FACING → needs USER go-ahead):** A2 — the
inversion has not reached the 8 role-plugin personas (separate Emasoft repos). First CHEAPLY check whether
the IN-REPO DEP overlays (`rules/aimaestro/*.md`) still call the catalog canonical (read-only, safe, do
now); then, for the cross-repo personas, filing correction ISSUES is the allowed method BUT creating issues
on other repos is an outward action — **confirm with the USER before filing.** All mutating/gated items
(B2/B3 decisions, conformance-test extension, the D/E fleet program) still await the USER's confirmation of
the bar.

**SUPERSEDED — do NOT carry forward:** none yet.

## Verify
Each un-gated item lands evidence in `reports/` and, where a real defect is found, a tier-appropriate fix
TRDD. The mutating items (CI wiring, any enforcement fix) do NOT auto-apply — they wait on the USER's
confirmation of the bar.
