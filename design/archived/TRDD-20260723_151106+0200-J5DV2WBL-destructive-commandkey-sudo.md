---
trdd-id: J5DV2WBL
title: Enforce AgentCommand.destructive so a curated commandKey cannot wipe an agent context without sudo
column: complete
created: 2026-07-23T15:11:06+0200
updated: 2026-07-23T15:11:06+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-23T15:11:06+0200
derived: false
npt: []
eht: []
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
implementation-commits: [4d7eed7e]
external-refs: [Emasoft/ai-maestro#54, Emasoft/ai-maestro#78]
relevant-rules: [R32, R42]
labels: [security, sudo, agent-commands]
---

# Enforce `AgentCommand.destructive` — a curated `commandKey` could wipe an agent context without sudo

## Problem

`TRDD-ED9A4VVY` (commit `8a198248`) closed #54's inversion by splitting
`PATCH /api/agents/[id]/session` **by payload**:

- arbitrary `command` → `requireSudoToken`
- curated `commandKey` → **exempt**, on the stated grounds that "the allowlist is
  the security boundary"

That exemption is sound only if every key on the allowlist is **bounded and
reversible** — which is the real membership test, *not* "is it a slash command".

**`clear` fails it.** `/clear` wipes the agent's conversation context
irreversibly. That is a strictly worse outcome than `DELETE …/session`, which
**is** strict: a killed session can be woken; a wiped context cannot be
recovered. So a caller holding only a session cookie could destroy any agent's
context with no second factor — through the branch designed to be the safe one.

## Root cause

`AgentCommand.destructive` already existed and was already set on `clear`. It had
**zero consumers** across `lib/`, `app/`, `services/`, `components/`. Nothing read
it.

Two things kept it invisible:

1. **Dead metadata that reads like a safeguard.** A declared `destructive: true`
   looks like a control; it was a comment with a type annotation.
2. **A test that pinned the declaration instead of the behaviour.**
   `agent-commands.test.ts::marks context-wiping commands destructive` asserted
   the flag was *set* — permanently green while nothing enforced it. The grep
   that mattered was for **consumers**, not for the flag.

## Fix

The curated branch gates on `allowed.destructive` with the same
`requireSudoToken` call the arbitrary path uses. Non-destructive keys stay exempt,
so chat keystrokes and the curated controls (`compact`, `reload-plugins`,
`janitor-*`) are unaffected.

The twin `POST /api/agents/[id]/queue` was checked: it gates **before** parsing
the payload, so it is uniformly strict — no equivalent hole.

## Verification

`tests/unit/destructive-command-key-sudo.test.ts` locks the **behaviour**:
the guard exists inside the `commandKey` branch keyed on `destructive`; the route
is registry-strict (so `requireSudoToken` is not a no-op); and — the
forward-looking case — **any command whose description calls itself irreversible
must carry the flag**, so the next `/clear`-like key cannot quietly ride the
exempt branch.

Proven **non-vacuous** by neutering the guard and observing the failure, then
restoring. tsc clean; 228 files / 3266 tests green.

## Notes and lessons learned

[^1]: [id:ATOM-6PQD-3HNV, status:valid, keywords:"dead_metadata_reads_as_safeguard declared_flag_zero_consumers destructive_never_enforced", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT treat a declared safety field as a control, BECAUSE `AgentCommand.destructive`
  was set on `clear` and read by nothing — an unenforced flag is a comment that
  looks like a gate, and it made an irreversible context wipe appear guarded. DO
  grep for the field's CONSUMERS, not its definition, before relying on it.

[^2]: [id:ATOM-8XKF-5RTM, status:valid, keywords:"test_pins_declaration_not_behaviour green_test_hides_unenforced_invariant", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT assert that a safety flag is SET and call it covered, BECAUSE that test
  stays green forever while the flag goes unenforced — it pins the declaration and
  leaves the behaviour free. DO assert the BEHAVIOUR the flag is supposed to
  cause, and prove the test non-vacuous by breaking the code and watching it fail.

[^3]: [id:ATOM-2WNH-7JQC, status:valid, keywords:"ruled_from_own_stale_issue_body did_not_reread_code confident_stale_source", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT rule from an issue body you wrote weeks ago, BECAUSE #54's premise
  ("absent from security-registry.json") had been false since `8a198248` and the
  fix already matched the ruling — a stale issue body is not a weak source, it is
  a CONFIDENT one, which is worse. DO re-read the current code before ruling,
  especially on an issue you filed yourself.

[^4]: [id:ATOM-1VGB-4ZDP, status:valid, keywords:"allowlist_membership_test bounded_and_reversible not_is_it_a_slash_command", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT define an allowlist by SHAPE ("it's a slash command"), BECAUSE shape says
  nothing about blast radius and `/clear` is shaped exactly like `/compact` while
  being irreversible. DO define membership by the property that makes the exemption
  sound — "is this command's worst outcome bounded and reversible" — and state it
  where the next maintainer adding a key will read it.
