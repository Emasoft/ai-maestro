---
trdd-id: 9MZQ4T7E
title: A CLI script run by hand must prompt for the MAESTRO password
column: todo
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:05:00+0200
created: 2026-07-13T14:05:00+0200
updated: 2026-08-16T16:43:00+0200
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

- [ ] The `~/.local/bin/aimaestro-*.sh` verbs that hit a `strict` route are enumerated from `security-registry.json` (not guessed) and each carries the shared MAESTRO-password prompt step.
- [ ] The password is read from a TTY prompt only — never accepted as an argument or env var, never echoed.
- [ ] A strict-route script invoked with no TTY and no token exits non-zero and performs nothing (fail-closed).
- [ ] A wrong password is rejected by the shared step and consumes no sudo token.
- [ ] `history`, `ps aux`, and argv are checked and show no trace of the password after a real invocation.
- [ ] An agent-authenticated (AID) call through the same scripts is unaffected — no regression in the AID path.

## Approval log

- 2026-07-13T14:05:00+0200 — **MANDATE issued by the USER** (min-approval-requirement:
  manager; issuer authority ≥ required approver). Pre-approved: no approval request
  was sent. Born in `design/tasks/`, per the mandate rule.
