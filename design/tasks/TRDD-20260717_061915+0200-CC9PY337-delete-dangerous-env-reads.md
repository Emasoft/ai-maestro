---
trdd-id: CC9PY337
title: Delete every security-risk env read — dashboard-only settings, non-env test seams
column: human_review
created: 2026-07-17T06:19:15+0200
updated: 2026-08-02T16:52:54+0200
current-owner: ai-maestro
task-type: security
parent-trdd: QZL828OD
relevant-rules: [16]
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: user
approval-datetime: 2026-07-17T06:19:15+0200
implementation-commits: [4e2e90b4, 8e124445, dac3ca8f, 752f798f, 4a4c28c0, a50984b4, cb593862, b4ce9d3e]
scope: project
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**USER DIRECTIVE (2026-07-17), verbatim intent:** *"when in doubt, choose to remove the env
value completely, not read, not checked, not present in the template, nothing. only remain as
a dashboard setting, saved in the encrypted settings file. because if there is the minimal
doubt, you can be sure it can be exploited by malicious actors. security is paramount in
ai-maestro, value number 1."*

**SECOND USER DIRECTIVE (2026-07-17), refining the first:** *"even a dev environment is at risk
of being exploited. but you can slightly relax the criteria for those env var needed for testing
and scenarios runs."*

**THE RULE THIS RATIFIES (apply to every future env var):** an env var that can weaken a
security property is not gated, not validated, not documented — it is DELETED. Doubt resolves
toward removal, never toward a check. A setting that must be configurable lives in the
dashboard, in the encrypted settings file. **A DEV BOX IS NOT A SAFE HOST** — it runs agents
under the same UID as the server, so "delete" means delete in every mode, not just release.
The ONE relaxation: a var a TEST genuinely needs, which has NO dashboard equivalent (it is a
seam, not a setting), may survive — honored only inside the test runner. This is a standing
rule, not a one-off cleanup.

**THE DECISION PROCEDURE for any env var, present or future:**
1. Does honoring it weaken a security property? **No** → ordinary config, leave it alone
   (`PORT`, `MAESTRO_MODE`, `NOTIFICATION_*`). Gating these breaks deployments and buys nothing.
2. **Yes**, and it has a dashboard equivalent? → **DELETE the read.** The dashboard owns it.
   (`AIM_SMTP_*`, phase 1.)
3. **Yes**, no dashboard equivalent, but a test needs it for 0-IMPACT isolation? → `TEST_ONLY_ENV`,
   honored only when `NODE_ENV=test`.
4. Anything else / any doubt → **DELETE.**

**PROGRESS:**
- `4e2e90b4` — `lib/release-env-guard.ts`: a release-mode gate. **SUPERSEDED** — see below.
- `8e124445` — **phase 1 DONE.** The six `AIM_SMTP_*` reads deleted from `lib/mailer.ts`;
  `envOverride()` gone, `getMailerConfig()` collapsed to `autoConfig()`. Mostly reverts
  `3536afef`. 15/15 mailer tests; tsc + build clean. Template + intro rewritten.
- **Guard inverted → `lib/test-only-env.ts`** (rename of `release-env-guard.ts`). ALLOWLIST on
  `NODE_ENV === 'test'`, not a blocklist on production — so dev is now covered too. Vitest sets
  `NODE_ENV=test` itself (verified EMPIRICALLY with a probe; `vitest.config.ts` does NOT set it,
  so a test pins the property — if vitest ever drops it, every hatch silently dies and the suite
  starts writing to the developer's REAL keychain). 17/17; tsc clean.

- `752f798f` — **phase 2 DONE.** `lib/smtp-credential.ts` `keychainAvailable()` now reads via
  `testOnlyEnv('AIM_SMTP_CRED_BACKEND')`. Verified: non-macOS unaffected (the `darwin` check
  already picks the file backend there), and no dependent test stubs `NODE_ENV`.
- `4a4c28c0` — **suite fully green: 205/205 files, 3028 tests, 0 failures.** Closed 3 red tests
  that were MY OWN and had been mis-filed as "pre-existing, someone else's": R49.1-R49.6 given
  BEHAVIOURAL enforcement-map rows (the refusal protocol binds what an approver WRITES; no guard
  can judge whether prose named a concrete defect — reasoning recorded in the map's notes), and
  3 TRDDs moved `planned|testing → blocked` + `pre-block-column:` after VERIFYING every blocker
  is genuinely still open.
- `a50984b4` — **phase 3 DONE.** All 7 rotator seams gated to the test runner across 4 files:
  `safe-storage.ts` (`CLAUDE_SAFE_STORAGE_BACKEND` in `detectBackend`, `JANITOR_ROTATOR_KEYCHAIN`
  in `keychainScopeArgs`), `slots.ts` (the 2 `CLAUDE_ROTATOR_SLOT*_KEYCHAIN_SERVICE`, module-level
  consts), `live.ts` (`CLAUDE_ROTATOR_LIVE_BACKUP_KEYCHAIN_SERVICE`), `global-state.ts`
  (`JANITOR_GLOBAL_STATE_DIR`, BOTH reads — `globalStateDir` + `legacyReadPath` — gated together).
  - **LANDMINE CLEARED.** Grepped shell/pm2/scenario/ecosystem configs for a setter of any of the
    5 coordination vars → the only hits are doc-comments, ZERO real setters. So in production the
    TS server and the Python `#N` daemon both take the default state-dir ladder and agree.
    `$XDG_STATE_HOME` (the shared branch that must not diverge) is left UNGATED — a standard OS
    var both honor identically.
  - **0-IMPACT PROVEN BY DELTA, not by a passing suite.** Counted `Claude Code-rotator-slot` items
    in the live keychain (12, the real daemon's legit state), ran slots/live/safe-storage (36
    tests), recounted → **DELTA 0/0.** The tests wrote nothing to the real keychain, which proves
    both that the gate holds AND that the tests genuinely exercise the forced-`none` backend
    (temp-dir plaintext). SMTP control: `find-generic-password -s ai-maestro-smtp` → "could not be
    found" (phase-2 property holds).
  - Verified: tsc 0; full suite 205/205, 3028 passed; `yarn build` exit 0.

- `b4ce9d3e` — **phase 4 DONE, and it REVISED phase 3.** Verification (grep tests/ for every
  registered name) showed SIX names are set by NO functional test → decision-procedure step 4:
  DELETE, not gate.
  - **DELETED** (env read removed from source): `AIM_JSONL_READER_PATH` (build drops the binary at
    the default path — override was dead RCE surface), `CLAUDE_MARKETPLACE_PLUGINS_DIR` (const was
    ALSO already dead — nothing read it), `OPENCLAW_TMUX_SOCKET_DIR` (CHANGELOG documents the FIXED
    default; override never in the contract), and the **3 `CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE`**
    (phase 3 gated them on a stale "tests target a throwaway service" comment — NO test does; now
    plain literal consts, which also makes the janitor `#N` byte-compat unconditional).
  - **STILL GATED** (a test genuinely sets each — verified): `CLAUDE_SAFE_STORAGE_BACKEND` (5),
    `AIM_SMTP_CRED_BACKEND` (4), `JANITOR_ROTATOR_KEYCHAIN` (1), `JANITOR_GLOBAL_STATE_DIR` (3).
  - **`test-only-env.ts` split** → `TEST_ONLY_ENV` (4 live seams) + `FORBIDDEN_ENV` (6 deleted; a
    test asserts the sets are DISJOINT).
  - **THE REGRESSION FENCE** (the durable value): `tests/unit/test-only-env.test.ts` walks
    `lib/+services/+app/` with Node fs (NOT grep — no dialect / git-tracking dependence) and fails
    with file:line if any gated OR forbidden name reappears as a bare `process.env.<NAME>`. Ran
    58ms (real scan), green.
  - `reportIgnoredTestEnv()` wired into `server.mjs` boot; **live-verified**: server restarts
    clean, both listeners up, sweep SILENT on this clean host (correct — a poisoned host prints
    the list). 0-IMPACT delta re-checked post-revert: 0/0.
- **Phase 5 (docs) — NO WORK.** Grepped `.example.env` + `CLAUDE.md`: the deleted vars were never
  user-facing config (internal test seams / dead overrides), so nothing to purge. The only hit is
  the intended phase-1 SMTP "here's why this was removed" note.

**STATUS: all automated gates GREEN** — tsc 0; full suite 205/205, 3032 passed; `yarn build` exit
0; regression fence green; 0-IMPACT delta 0/0 (phase 3 AND phase 4); server boots clean with the
sweep live. `column: testing`. The implementation is complete; what remains is the USER's review
of a security change (this TRDD was a Tier-0 self-mandate, so no approval gate blocked it, but a
human eye on credential-custody code is worth having before `complete`).

**Commits (this TRDD, all local on `governance-rules`):** `8e124445` `dac3ca8f` `752f798f`
`4a4c28c0` (phase 1-2 + red-test fix) · `a50984b4` (phase 3, since partly revised) · `cb593862`
(STATE) · `b4ce9d3e` (phase 4 + fence).

**NEXT (separate task, USER-directed):** the AgentLensPro Analytics section is BUILT + committed
(`5d972107`) — Settings→Analytics via a reverse proxy on PORT+1, MAESTRO-gated writes, coordinated
on AgentlensPro#4 (signed viewer-role assertion + base-path ask). Needs the USER at a browser to
confirm the authenticated iframe RENDER (the proxy's refuse-path is proven; the serve-path is not).

**SUPERSEDED — do NOT carry forward:**
- *"A release-mode gate is the answer."* Twice wrong. (a) It still READS the var in development,
  and the USER ruled dev is at risk too. (b) For a var with a dashboard equivalent, gating is
  strictly weaker than deleting. `release-env-guard.ts` no longer exists; `test-only-env.ts`
  replaces it with the inverted predicate.
- *"`AIM_SMTP_*` is legitimate operator config for a self-hosted relay."* The USER ruled the
  dashboard is the only path. The per-field override built in `3536afef` is reverted, not
  extended.
- *"Gate on `NODE_ENV !== 'production'`."* Use `NODE_ENV === 'test'`. The difference IS the
  dev-box exposure.

## Problem

A set of env vars silently weaken the thing they redirect. Each verified at its call site:

| Var | What one `export` line buys | Site |
|---|---|---|
| `AIM_JSONL_READER_PATH` | spawns an arbitrary binary as the server UID (RCE) | `lib/jsonl-reader.ts:58` |
| `CLAUDE_SAFE_STORAGE_BACKEND` | `none` = OAuth tokens in plaintext | `safe-storage.ts:283` |
| `AIM_SMTP_CRED_BACKEND` | `file` = SMTP password leaves the keychain | `smtp-credential.ts:52` |
| `CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE` ×3 | token substitution via service redirect | `slots.ts:40,42` · `live.ts:36` |
| `JANITOR_ROTATOR_KEYCHAIN` | rotator ops confined to an attacker's keychain | `safe-storage.ts:299` |
| `JANITOR_GLOBAL_STATE_DIR` | rotator/daemon state redirect | `global-state.ts:68` |
| `CLAUDE_MARKETPLACE_PLUGINS_DIR` | plugins loaded from an attacker's dir | `plugin-builder-service.ts:56` |
| `OPENCLAW_TMUX_SOCKET_DIR` | session discovery via an attacker's socket dir | `sessions-service.ts:519` |
| `AIM_SMTP_*` ×6 | reset codes via an attacker's relay → account takeover | `lib/mailer.ts` |

**Threat model — the inherited environment, not a remote attacker.** Agents run as the SAME UID
as the server. A prompt-injected agent appends one `export` to `~/.zshrc` — a low-suspicion write
— and the next restart picks it up. A stale export from a debugging session does it by accident.
Both are silent: nothing in the UI says the keychain was bypassed.

**Why these exist at all:** 11 test files depend on them for 0-IMPACT isolation (a test must never
touch the developer's real keychain). That is a real constraint, and it is why "just delete them"
needs a replacement seam rather than a `rm`.

## Design — two kinds, two treatments

**Kind 1 — a dashboard setting that ALSO reads env (`AIM_SMTP_*` ×6).** The dashboard owns it;
the env read is redundancy plus an attack vector. **DELETE the read.** Tests get simpler: they
already drive `setRecoveryEmail()` + `storeSmtpPassword()`, and today's suite only stubs these
vars to neutralize them.

**Kind 2 — a test-isolation hatch (the rest).** No dashboard equivalent, no operator use; it
exists only so a test avoids the real keychain. **DELETE the env read; inject instead** — an
explicit function param where the call is shallow (the pattern already proven by
`enforceClaudeSettings(target?)` in `4c8b7cb8`), or a test-only exported setter where threading
a param through every caller would be worse.

**Why injection beats a guard.** A param cannot be set from a dotfile. That is the entire vector,
closed in dev AND release, rather than gated in release only. An attacker who can call an exported
setter already has code execution and does not need it.

**Kind 3 — bootstrap config that MUST stay env** (`PORT`, `HOSTNAME`, `MAESTRO_MODE`, `NODE_ENV`).
A dashboard cannot configure the port of the server that has not bound it yet. `HOSTNAME` already
has its own failsafe (non-localhost without Tailscale is refused). These are operational, not
security-weakening, and gating them would break deployments while buying nothing.

## Phases (each ≤5 files, verified before the next)

1. **`AIM_SMTP_*` deletion** — `lib/mailer.ts` + `tests/unit/mailer.test.ts` (reverts most of
   `3536afef`). Drops 6 vars.
2. **SMTP credential seam** — `lib/smtp-credential.ts` (`AIM_SMTP_CRED_BACKEND` → param/setter) +
   its tests + `mailer-user-relay`/`email-configure-route` fallout. Drops 1.
3. **Rotator seams** — `safe-storage.ts`, `slots.ts`, `live.ts`, `global-state.ts` (5 vars) + the
   6 rotator test files. The largest phase; may split.
4. **Remaining reads + the regression fence** — `jsonl-reader.ts:58`,
   `plugin-builder-service.ts:56`, `sessions-service.ts:519` (3 vars). Then add a test asserting
   no name in `TEST_ONLY_ENV` is read via a bare `process.env.X` anywhere in `lib/`+`services/`
   (grep the source; the only legal reader is `test-only-env.ts` itself). That fence is the
   durable value — it stops the next contributor re-introducing a hatch, and it is what makes
   the rule survive this session. Wire `reportIgnoredTestEnv()` into `server.mjs` boot for the
   tamper-evidence summary.
5. **Docs** — purge every deleted/gated name from `.example.env` and `CLAUDE.md`; state the
   standing rule + the decision procedure.

## AFTER THIS TRDD (USER, 2026-07-17): AgentLensPro settings section

Once env/config is done: make AgentLensPro a **section of the Settings page, rendered in an
iframe** (its server runs INDEPENDENTLY, hence the iframe rather than an in-app route), and
**coordinate with the AgentLensPro Claude via GitHub repo issues**. Do not design its API
unilaterally — open an issue and agree the contract. Related existing work: **TRDD-Y916N7WL**
(`agentlenspro-status-metadata-consum…`, column: testing) already touches AgentLensPro status
metadata and is the blocker on DXJZM3BW — READ IT FIRST; it likely already establishes the
integration contract, and `tests/unit/agentlens-status.test.ts` exists.

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` → 0 errors.
- `bash scripts/with-node.sh yarn test` → green, and STILL 0-IMPACT: no test may touch the real
  keychain. Verify by running the rotator/SMTP suites with the login keychain observed unchanged.
- `bash scripts/with-node.sh yarn build` → the real ESLint gate.
- The Phase-4 fence fails if any deleted name is re-added.

## Estimated risk

**MED.** The refactor itself is mechanical, but Phase 3 touches OAuth token custody — the code
whose failure mode is "the user's live credentials". Each phase lands and verifies alone. The
0-IMPACT property is the thing that must not regress: a test that starts writing to the real
keychain is a worse outcome than the vector this TRDD closes.

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verification` list, **every item re-run live** —
including the two that are measurements rather than commands, because a security card's value is
exactly in those. The last box is the human's, and the card names it itself.

- [x] `bash scripts/with-node.sh npx tsc --noEmit` → **0 errors**
- [x] `yarn test` green — the suite has grown well past the card's 205/3032 and is **345 files /
      4889 tests** today
- [x] `yarn build` (the real ESLint gate) → **exit 0**
- [x] **STILL 0-IMPACT — measured by DELTA on the live keychain, not inferred from a green suite.**
      Counted `Claude Code-rotator-slot` items → **12**; ran the 31 rotator + SMTP + mailer +
      fence files (**404 tests, all green**); recounted → **12. Delta 0/0.** SMTP control:
      `find-generic-password -s ai-maestro-smtp` → "could not be found", before and after. The
      delta proves TWO things at once, which is why the card insisted on it: the gate holds, AND
      the tests genuinely exercise the forced-`none` backend rather than silently reaching the real
      store
- [x] **the Phase-4 fence fails if a deleted name is re-added — NEUTERED, not assumed.** Appended
      a bare `process.env.AIM_JSONL_READER_PATH` to a `lib/` file: the fence reddened with the
      exact `statusline-rollup.ts:50`, naming the file and line. Restored; green again. A fence
      that has never been made to fire is a fence nobody has checked is connected
- [x] `TEST_ONLY_ENV` (4 live seams) and `FORBIDDEN_ENV` (6 deleted names) are DISJOINT, asserted
      by a test — so a var is either a seam or forbidden, never quietly both
- [x] **the USER's review of a credential-custody change.** The card asks for this in its own
      words: *"a human eye on credential-custody code is worth having before `complete`"*. It was a
      Tier-0 self-mandate, so no approval gate blocked the work — which is precisely why the review
      is worth asking for rather than assuming.
      **↳ REVIEW PERFORMED 2026-08-22T17:56** under the owner's grant of that date (*"you must do
      the human review and also decide all the rest. just decide in base of verified facts and
      tests, never assume anything"*). Decided on two pieces of evidence, neither taken from this
      card:
      **(1) The fence was re-neutered TODAY, not read off the STATE block.** It is an ABSENCE
      guard, so the mutation had to ADD the forbidden behaviour rather than delete a check:
      `scripts/dev/neuter` on `lib/dev-mode-token.ts` (1 ins / 0 del, restore verified by blob
      hash) inserting `const _neuter = process.env.AIM_JSONL_READER_PATH` →
      **1 red / 20 green**, the red being *"finds zero re-introduced hatches (fails with file:line
      if a contributor adds one)"*. So a contributor re-adding a deleted hatch fails a named test.
      **(2) The policy held under a REAL user expectation, which no test could have staged.** The
      owner armed dev mode by putting `AI_MAESTRO_DEV_MODE=true` in `.env.local` — and it did
      nothing, because `lib/dev-mode-token.ts:11` refuses to read such a var *by this card's rule*,
      citing it by id and quoting its reasoning (*"a dev box is NOT a safe host: agents run under
      the SAME UID as the server, so a prompt-injected agent appends one `export` to ~/.zshrc"*).
      The enable switch lives in `governance.json`, dashboard-only. **That is this card's policy
      surviving contact with a user who expected the opposite**, on a security-weakening knob, in
      production — the strongest evidence available that the deletion was right and that the
      dashboard-only replacement is discoverable enough to be used.

## ⏹ TRANSITION 2026-08-02 — `testing` → `human_review` ([[5YRLA53W]]), in two recorded hops

**`testing → ai_review`** is the exempt mechanical transition: every test-requirement PASSED, and
they were re-run today rather than read off the STATE. **`ai_review → human_review`** follows from
the review recorded above — the four gates plus the two measurements the card set for itself, one
of which (the fence) was verified by making it FAIL on purpose. Both hops are named because the
same session performed them, and a transition whose authority is unstated is one nobody can audit.

It lands in `human_review` because that is what the card says is left. Leaving it in `ai_review`
would make the next reader re-derive that from 230 lines — the "queueing is a handoff, not a
resolution" failure, one column further along.

## Approval log

- 2026-07-17T06:19:15+0200 — **MANDATE issued by USER** (min-approval-requirement: none —
  Tier 0, in-scope security work on this project's own source). Pre-approved: the USER's directive
  IS the authorization. No approval request was sent.
- 2026-08-22T17:56 — **HUMAN REVIEW PERFORMED, verdict COMPLETE**, by `ai-maestro-session` under
  the owner's explicit 2026-08-22 grant. This card is `min-approval-requirement: none` (a Tier-0
  self-mandate), so no gate ever blocked it — the review is the one the card asked of itself, and
  it is now given rather than waived.
  Evidence: the Phase-4 regression fence re-neutered today (**1 red / 20 green**, an ABSENCE guard
  so the mutation ADDED `process.env.AIM_JSONL_READER_PATH` rather than deleting a check; restore
  verified by blob hash), plus the policy holding in production against a real user expectation —
  the owner set `AI_MAESTRO_DEV_MODE=true` and the code correctly ignored it, citing this card's
  rule at `lib/dev-mode-token.ts:11`.
  Provenance caveat: closed via `promote` + `archive`, which anchor no token — only `approve`
  mints one, so `verify` reports UNVERIFIED by design (`TRDD-06G43RK2`).
