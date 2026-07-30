---
trdd-id: L42SKUBW
title: Extract the two R17 startup guards from server.mjs into importable seams
scope: project
project-id: ai-maestro
column: completed
created: 2026-07-26T08:33:17+0200
updated: 2026-07-30T12:50:46+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-26T08:33:17+0200
derived: true
derived-kind: eht
parent-trdd: H4Y9F25J
relevant-rules: [R17, R51]
blocked-by: []
npt: []
eht: []
implementation-commits: [30fabeb7]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

**DONE.** Three guards extracted, three seams, 17 tests, three neuter runs, live restart verified.
`MAX_ENFORCED_WITHOUT_TEST` **35 → 32**.

| rule | seam | driven by |
|---|---|---|
| R17.17 | `lib/startup-user-scope-guard.mjs` (`stripUserScopeCorePlugin` pure + `disableCorePluginAtUserScope` shell) | 9 tests |
| R17.20 | `lib/startup-marketplaces.mjs` (`ensureMarketplacesRegistered`, DI) | 5 tests |
| R9.9 | `lib/startup-manager-gate.mjs` (`enforceStartupManagerGate`, DI) | 3 tests |

**THREE, not the two the title says.** R9.9 (the MANAGER gate) sat in the SAME 120 lines with the
identical defect — cited `server.mjs:1750-1764`, Test column `—` — so extracting it now cost one
extra 36-line module instead of a second refactor of the same region later. In-scope Tier-0 dev work
on the same seam; the title is left as authored rather than rewritten after the fact.

**SUPERSEDED — do NOT carry forward:** the ratchet figure in the original STATE block (117 → 115).
Four intervening batches had already paid it down; the real move was 35 → 32.

### Load-bearing facts

- **The `blockAllTeams` import must stay LAZY.** `lib/team-registry.ts` constructs a `SignedLedger`
  at module scope, so importing it eagerly would pull that construction forward on every healthy
  host — a behaviour change an extraction has no business making. It is passed as a thunk
  (`async () => (await import(...)).blockAllTeams()`), which is also why the test needs no mock.
- **DI, never module mocking.** `server.mjs` imports the AIOs *inside* the try block, so a
  module-level mock would have to intercept a dynamic import — the trap that made an earlier batch
  write real dirs under `~/agents/`.
- **0-IMPACT is by construction here**, not by mocking: `disableCorePluginAtUserScope` takes the
  home dir as a PARAMETER, so no test can reach the developer's `~/.claude/settings.json`.
- **The map citations name the seam AND the `server.mjs` call site.** An extracted-but-unwired guard
  is dead; two citations catch that, one does not.
- **The map's citation grammar is `file[:start[-end]]` + an optional `(Pipeline::Gnn)`.** A free-form
  parenthetical (`(enforceStartupManagerGate)`) or prose (`called from …`) is REJECTED by
  `enforcement-coverage.test.ts` — which is the check working, and cost one red run to learn.

### Live corroboration of the SCEN-012 regression

Read off THIS host during the verification restart: `~/.claude/settings.json` holds **2** keys whose
*marketplace* contains `ai-maestro-plugin` as a substring while their *plugin* part does not. The old
`k.includes(...)` match would have disabled one of those role-plugins on that very restart. The
regression is not hypothetical here; it is one boot away.

## Problem

Two guards, both verified present at these lines on 2026-07-26 (the enforcement map cited BOTH
wrongly before batch 1 corrected it — R17.20's old citation pointed at R17.17's code):

| Rule | Guard | What it does |
|---|---|---|
| R17.17 | `server.mjs:1774-1799` | reads `~/.claude/settings.json`, finds an `enabledPlugins` key whose plugin-part is exactly `ai-maestro-plugin`, and sets it `false` — the core plugin must be local-scope only |
| R17.20 | `server.mjs:1815-1869` | ensures the marketplaces are registered, via the `CreateMarketplace`/`UpdateMarketplace`/`DeleteMarketplace` AIOs with `{isSystemOwner: true}` |

Neither is reachable from a test. `server.mjs` is a 2387-line module whose import side-effect is a
listening server.

**The R17.17 guard carries a real, currently-unobserved regression fix.** Its comment records
SCEN-012: `k.includes('ai-maestro-plugin')` false-positive matched
`ai-maestro-autonomous-agent@ai-maestro-plugins`, because the MARKETPLACE name contains the PLUGIN
name as a substring — so the startup guard disabled an agent's role-plugin. The fix (split on `@`,
require an exact match on the plugin part) is exactly the kind of subtlety a well-meaning
"simplification" reverts. Nothing would catch that today.

**The R17.20 guard has an untested best-effort contract.** Every call is individually wrapped so an
"already registered" / "not found" exit at boot cannot block startup. That means a genuine failure
and a normal no-op are indistinguishable to the caller BY DESIGN — which is correct, and which also
means the only way to know the right calls are still being made is to observe them.

## Proposed fix

The precedent is `lib/session-validate-server.mjs` (TRDD-ba9d6df2): a `.mjs` module `server.mjs` can
import, with `tests/unit/session-validate-server.test.ts` covering it. Same shape twice.

**1. `lib/startup-user-scope-guard.mjs` (R17.17).** Split the guard into a PURE core and a thin I/O
shell, because the whole defect surface is in the core:

- `stripUserScopeCorePlugin(settings) → { changed: boolean, next: object }` — pure; no fs, no HOME.
- `disableCorePluginAtUserScope(homeDir) → boolean` — reads/writes `<home>/.claude/settings.json`,
  delegating the decision to the pure function.

`server.mjs` then calls the second. Tests target the FIRST for the interesting cases and the second
only for the read/write plumbing (against a tmp dir — never a real `$HOME`).

**2. `lib/startup-marketplaces.mjs` (R17.20).** `ensureMarketplacesRegistered(deps)` where `deps`
carries the three AIO functions and a `homedir`. `server.mjs` passes the real ones; the test passes
fakes and asserts the CALL SET and its best-effort semantics.

Dependency injection rather than module mocking is deliberate here: `server.mjs` imports the AIOs
lazily inside the try block, so a module-level mock would have to intercept a dynamic import — the
same class of trap that made batch 1 write real directories under `~/agents/` (`vi.mock('os')` does
not intercept a runtime `require('os')` inside a function body).

**3. Behaviour must not move.** This is an extraction, not a redesign: same order, same best-effort
wrapping, same log lines, same `settings.json` target. Any behaviour change found to be desirable is
a SEPARATE TRDD.

## The rule/code mismatch this surfaced (report, do not silently fix)

R17.17's text says the server must disable the plugin found in **`~/.claude/settings.local.json`**.
The code deliberately targets **`~/.claude/settings.json`**, and says why: `settings.local.json` is a
project-only override, so writing it at the user-home level is a silent no-op the Claude CLI never
reads (BUG-POLLUTION-001).

**The code is right and the rule text is wrong.** Left as written, the next reader "fixes" the code
to match the rule and re-introduces a guard that writes to a file nobody reads — a guard that logs
success and enforces nothing. Correcting a rule's text is a governance edit, not a refactor, so it is
recorded here and routed separately rather than folded into this change.

## Verification

- `bash scripts/with-node.sh node --check server.mjs` and `--check` each new `.mjs`.
- `bash scripts/with-node.sh npx tsc --noEmit` clean; full suite green.
- New tests, each proven by neutering its guard and observing the failure:
  - R17.17: an `enabledPlugins` map containing `ai-maestro-autonomous-agent@ai-maestro-plugins` and
    `ai-maestro-plugin@ai-maestro-plugins` → ONLY the second is disabled (the SCEN-012 regression);
    an already-`false` entry is left untouched (no pointless write); a missing file is a no-op.
  - R17.20: all five registrations attempted plus the stale-core delete; a throw from one does NOT
    prevent the rest (best-effort); the system-owner auth is passed on every call.
- `pm2 restart ai-maestro` then `curl -s -o /dev/null -w '%{http_code}' localhost:23000/api/sessions`
  → 401 (server up), and the startup log still prints both R17 lines.
- The enforcement map's Test column filled for R17.17 + R17.20, and
  `MAX_ENFORCED_WITHOUT_TEST` lowered by exactly 2 (117 → 115).

## Estimated risk

MED. The code is trivial; the RISK is that it runs at server startup, so a mistake is a server that
does not boot or a boot that silently stops enforcing R17. Mitigated by: extraction-only (no
behaviour change), `node --check` on every touched `.mjs`, and a real restart + startup-log check
before the commit — not just a green suite.

## Acceptance

- [x] `lib/startup-user-scope-guard.mjs` exists; `server.mjs:1771-1774` calls it; behaviour identical
- [x] `lib/startup-marketplaces.mjs` exists; `server.mjs:1794-1797` calls it; behaviour identical
- [x] `lib/startup-manager-gate.mjs` (R9.9) — the third guard in the same region, same defect
- [x] Tests for all three (17 in `tests/unit/startup-guards.test.ts`), each proven by a neuter run:
      substring match → only `SCEN-012 regression` reds (16/17 pass); per-call try/catch removed →
      only `BEST EFFORT: a THROW …` reds; `getManagerId()` inverted → exactly the 3 R9.9 tests red.
      Disjoint, and each names its test rather than reporting an exit code.
- [x] The SCEN-012 boundary-match regression is pinned by name — and corroborated live: 2 keys in
      this host's real `settings.json` have the false-positive shape TODAY
- [x] `node --check` clean on all 4 touched `.mjs`; tsc exit 0; suite 283 files / 4225 passed;
      `yarn build` exit 0 (warnings all pre-existing, in `components/`)
- [x] Server restarts (401 on `/api/sessions`) and the startup lines still appear — **with one
      correction to this box's own premise: only R17.20's line appears, and that is CORRECT.**
      R17.17 logs only when it WRITES, and the core plugin on this host is already `false`, so its
      silence is the no-pointless-write path. Verified by reading the real settings.json rather than
      inferring it from the absent line — an absent log and a broken guard look identical.
- [x] Map Test column filled for R17.17 + R17.20 **+ R9.9**; `MAX_ENFORCED_WITHOUT_TEST` **35 → 32**
      (the box's `117 → 115` was stale by four batches — see the STATE block's SUPERSEDED note)
- [x] The R17.17 rule-text mismatch (`settings.local.json` → `settings.json`) is routed as a
      governance edit, not fixed here → **TRDD-RAMCTTHD** (`design/proposals/`, `column: proposal`,
      `min-approval-requirement: manager`). Routed, not resolved: `docs/GOVERNANCE-RULES.md` is a
      governance file, so §D3's objective floor is MANAGER however small the diff.

## Approval log

- 2026-07-26T08:33:17+0200 — MANDATE (self, min-approval-requirement: none). In-scope dev work
  derived from TRDD-H4Y9F25J batch 1; no governance surface touched, so it is born approved.
- 2026-07-30T12:52:00+0200 — COMPLETED by ai-maestro. All 9 boxes checked; the R9.9 extension and
  the two boxes whose own text was wrong (the R17.17 log line, the stale ratchet figure) are recorded
  above rather than silently ticked. The rule-text mismatch left this card as TRDD-RAMCTTHD.
