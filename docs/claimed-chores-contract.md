# Claimed-chore alignment contract — server-side mirror (rev 8)

**This is the SERVER repo's mirror of the janitor's §9 table** (canonical prose:
`ai-maestro-janitor` `design/ARCHITECTURE.md` §9, rev 8; negotiation thread: ai-maestro#126,
TRDD-6CRC9SQQ). The table is prose FOR the negotiation — **code reads the code**: chore names +
cadences live in the janitor's `harness_backend.GLOBAL_CHORES`; the absorbed set in
`harness_backend.SERVER_ABSORBED_TASKS` (server twin: `lib/janitor-chore-stamp.ts`); the bound
formula in the janitor's `claimed_chore_watch.stale_bound_s`.

Ratified server-side 2026-08-18 under the USER's direct delegation to the hub session
(TRDD-BRRJK57P Approval log).

## The table (rev 8, plus the #274 settlement)

| chore | completion stamp | janitor cadence | default bound `max(3×c, c+600)` |
|---|---|---|---|
| `oauth-rotator-tick` | `~/.claude/janitor-control/oauth-rotator-tick.last-run.ts` | 60 s | 660 s |
| `oauth-rotator-supervisor` | `~/.claude/janitor-control/oauth-rotator-supervisor.last-run.ts` | 600 s | 1 800 s |
| `marketplace-refresh` | `~/.claude/janitor-control/marketplace-refresh.last-run.ts` | 3 600 s | 10 800 s |
| `user-plugins-update` | `~/.claude/janitor-control/user-plugins-update.last-run.ts` | 3 600 s | 10 800 s |
| `version-update` | `~/.claude/janitor-control/version-update.last-run.ts` | 21 600 s | 64 800 s |
| `github-config-audit` | `~/.claude/janitor-control/github-config-audit.last-run.ts` | server executes at 14 400 s (4 h) | **64 800 s — the janitor roster default stands.** The server's 14 400 s declaration is BELOW it and widen-only IGNORES a narrowing by design (janitor e630a35c §9.4 note); a faster bound is a janitor-default change to REQUEST, not a declaration to write. *(Corrected 2026-08-18 — the first version of this row recorded the declaration as effective.)* |

## §9.2 executor-declared bounds — accepted

The server, as executor of a claimed chore, declares its OWN staleness bound in
`~/.claude/janitor-control/claim-bounds.json` (`{"<chore>": <bound_s>}`), refreshed by whichever
side executes. Watchdog semantics: **widen-only** (a declared bound replaces the default only when
larger), **fail-open** (file absent/unparseable ⇒ defaults stand). This kills the measured
false-wedged class where a bound was derived from the NON-executor's cadence.

## §9.4 settlements (server side)

- **`github-config-audit` (janitor#274): it JOINS `SERVER_ABSORBED_TASKS` and this table.**
  Measured, not asserted: the server has executed it since 2026-08-05 (USER go-ahead, 4 h cadence —
  `lib/janitor-chore-stamp.ts:51,:65`; port: `lib/github-config-audit.ts`), and the stamp
  `github-config-audit.last-run.ts` was refreshed today (2026-08-18 15:44, epoch 1787060644). The
  janitor's §9.4 line "class-4, no server equivalent" is stale on its side — reclassify there.
- **TRDD-FXPV7L4D** (marketplace refresh, one-exit-code claim): agreed — the stamp MUST mean "the
  work product is actually current"; that card's fix lands server-side before the stamp is trusted.
- **TRDD-PE54D95Q** (auto-update cadence control): agreed — once cadence control exists, its chosen
  cadence is exactly what the server declares via `claim-bounds.json`.

## What stays true (restated so this mirror cannot be read as reopening it)

Alarm-only: the janitor NEVER un-yields a stale claimed chore. Unknown chore ⇒ skipped. A claimed
chore with no stamp ever is itself a finding (`no-evidence`).
