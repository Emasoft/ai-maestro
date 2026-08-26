---
trdd-id: 9MZQ4T7E
title: A CLI script run by hand must prompt for the MAESTRO password
column: dev
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:05:00+0200
created: 2026-07-13T14:05:00+0200
updated: 2026-08-26T05:28:40+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: M
task-type: security
release-via: none
derived: false
npt: []
eht: []
blocked-by: []
relevant-rules: []
---

# TRDD-9MZQ4T7E — the script layer has no USER, so give it the only one there is

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-13

**MANDATED by the USER on 2026-07-13, born approved.** It closes the last half of
TRDD-D3RP7KQZ, which decided agent policy for the strict routes but left the
*human* path undecided. The USER, verbatim:

> the scripts if executed via cli by the user manually MUST require to enter the
> password of the MAESTRO USER, of course. other non MAESTRO users are not
> contemplated.

**NEXT ACTION:** enumerate the `~/.local/bin/aimaestro-*.sh` verbs that hit a
`strict` route (`security-registry.json` is the list — do not guess it), and give
that set a single shared prompt-for-MAESTRO-password step that exchanges the
password for a sudo token, exactly as the web UI's sudo modal already does.

## The gap

Two principals can drive the script layer, and only one of them is authenticated:

| caller | today |
|---|---|
| an **agent** | AID proof-of-possession → an AuthAction check. Decided, enforced. |
| the **human at a terminal** | *nothing* — the scripts have no USER auth path at all. |

So the strict routes are gated against agents and open to whoever is at the
keyboard. On a single-user box that is not an emergency, but it means the sudo
gate the web UI enforces is bypassable by dropping to the shell — the protection
is a property of the UI, not of the system.

## The decision, and why it is cheap

**There is exactly one human principal: MAESTRO.** Non-MAESTRO users are *not
contemplated* — that is the USER's ruling, and it is what makes this small. No
user model, no roles, no accounts table, no multi-tenant story, no delegation.
One principal, one secret, one prompt:

- A script that would hit a `strict` route prompts for the **MAESTRO governance
  password**, exchanges it for a one-shot sudo token, and proceeds.
- No password ⇒ the script **refuses**. Fail-closed, never a warn-and-continue: a
  bypassable gate is not a gate.
- The password is **read from a TTY prompt, never an argument, never an env var
  in the command line, never echoed** — the same invariant the scenario helpers
  now enforce (TRDD-E9BZ5P7S). A secret passed as `$1` ends up in shell history,
  in `ps`, and in a model's context.
- An **agent** caller is unaffected: it already authenticates by AID and must
  never possess the human's password. The two paths stay disjoint — which is the
  point of D3RP7KQZ's split, extended to the human side.

## Verification

- A strict-route script invoked with no TTY and no token exits non-zero and
  performs nothing.
- The password never appears in `history`, in `ps aux`, or in any argv.
- An agent-authenticated call is unchanged (no regression in the AID path).
- A wrong password is rejected and consumes no sudo token.

## Acceptance

- [x] The `~/.local/bin/aimaestro-*.sh` verbs that hit a `strict` route are enumerated from `security-registry.json` (not guessed) and each carries the shared MAESTRO-password prompt step — 14 call sites: teams create/edit(x2)/delete, session send/command (PATCH x2) + block-state(x2) + prompt/answer + queue, panel post, trdd edit/approve/refuse/promote/archive, agent probe. Gate: `maestro_sudo_ensure` in shell-helpers/common.sh + a documented family copy in agent-helper.sh (the agent module set does not source common.sh). Commit e1a8988d.
- [x] The password is read from a TTY prompt only (`read -rs < /dev/tty`), never argv/env, never echoed — stdin at every hop (`jq -Rn 'input'`, `curl -d @-`), the exact pattern the dev-login test pins argv-containment for.
- [x] A strict-route script invoked with no TTY and no token exits non-zero and performs nothing — T1/T5 in tests/unit/maestro-sudo-gate.test.ts assert the stub server received ZERO requests; neuters N1/N2 red exactly one test each (disjoint).
- [ ] A wrong password is rejected by the shared step and consumes no sudo token — TRUE BY THE EXCHANGE'S OWN CONTRACT (403 mints nothing; the step's empty-token branch refuses and performs nothing) but NOT DRIVEN: the prompt path needs a real pty and `script(1)` syntax diverges macOS/Linux. Open until a pty harness or an operator run.
- [ ] `history`, `ps aux`, and argv are checked and show no trace of the password after a real invocation — OPERATOR HALF (needs a real terminal + real server). The identical stdin-only pattern is argv-pinned by the dev-login test's curl shim; this box is the live confirmation.
- [x] An agent-authenticated (AID) call through the same scripts is unaffected — T3/T6: no sudo exchange occurs and the request carries the same Bearer, byte-identical path (the gate returns before touching anything when AID_AUTH is set).

## Approval log

- 2026-07-13T14:05:00+0200 — **MANDATE issued by the USER** (min-approval-requirement:
  manager; issuer authority ≥ required approver). Pre-approved: no approval request
  was sent. Born in `design/tasks/`, per the mandate rule.

## ⏵ STATE UPDATE — 2026-08-26 (hub session)

Built and DEPLOYED. `maestro_sudo_ensure` (common.sh + documented family copy in
agent-helper.sh) fronts all 14 strict call sites; commits e1a8988d + 87459c47 + the TTY
open-probe fix. Deployed via install-agent-cli.sh + the glob-mirror cp for session/trdd
(cmp-identical), and verified BY EFFECT through the bare PATH command:
`aimaestro-teams.sh delete <uuid>` with no TTY/token/AID → exit 1, clean strict refusal,
zero requests sent. Tests: tests/unit/maestro-sudo-gate.test.ts 6/6; neuters N1 (1 red/5
green, exactly T1) and N2 (1 red/46 green, exactly T5) — disjoint.

**Open, honestly:** the wrong-password box and the history/ps/argv sweep box — both need a
real pty/terminal (macOS/Linux `script(1)` divergence documented in the test header). The
gate's fail-closed OUTCOME for those paths is already pinned; what is unproven is the
prompt-path behavior under a live terminal. NEXT ACTION: an operator run at a real
terminal (wrong password once, then `history`/`ps aux` sweep), or a pty harness card.

**Commit-message erratum:** `d45df031` contains the three FIXTURE fixes (pre-minted sudo token
in the trdd/teams verb harnesses) but wears the earlier feat commit's message — a stale
/tmp/commit-msg.txt survived a failed `git add` (index.lock) and the retry reused it. The real
gate implementation is `e1a8988d`; the full triage text intended for d45df031: 3 red files were
the gate working (fixtures now pre-mint), 4 are the load-timeout flake class (green isolated),
5 pre-existing (continuity-cli-restart-self, headless-handler-auth-ledger,
build-script-manifest, trdd-doctor, specs-in-sync). Already pushed, so documented here
rather than rewritten.

**Correction (review fork, 2026-08-26):** the original "proven by stash A/B" was VACUOUS —
the gate commits were already committed, so `git stash push -- scripts/` stashed nothing and
both arms measured the SAME tree (the pop then resurrected a checkout-guard auto-backup of
an old neuter, which was the mystery common.sh delta). Re-proven properly in a worktree at
`e1a8988d^` (pre-gate): the SAME 5 files / SAME 6 tests fail there (continuity x2, headless
ledger x1, manifest --check x1, trdd-doctor corpus x1, specs-in-sync x1) — genuinely
pre-existing. Also settled by the same review — and by the COMPILE SITE, not the doc comment
(second fork's demand): `compilePattern` at lib/security-registry.ts:62-68 escapes regex
metachars, expands `[param]` to the single-segment class `[^/]+` (:67), and anchors the
whole pattern `^...$` (:68) — so a subpath can never prefix-match a shorter template. The
portfolio-subpath and kanban-tasks non-strict rulings are therefore proven by code;
amp-kanban-edit PUTs /api/teams/[id]/tasks/[taskId], which matches no strict template.
