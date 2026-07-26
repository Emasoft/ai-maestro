---
trdd-id: L42SKUBW
title: Extract the two R17 startup guards from server.mjs into importable seams
scope: project
project-id: ai-maestro
column: todo
created: 2026-07-26T08:33:17+0200
updated: 2026-07-26T08:33:17+0200
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
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

Batch 1 of TRDD-H4Y9F25J pinned 17 of 22 rules. **R17.17 and R17.20 could not be pinned** — not
because their guards are missing (both are real and correct), but because they sit INLINE in
`server.mjs`'s `startServer`, which binds sockets on import. A test cannot call them without
starting a server. They are still counted in `MAX_ENFORCED_WITHOUT_TEST` (117), which is the honest
record: an unobservable guard is one refactor away from silently not existing.

This TRDD extracts both into importable modules so batch-1's two leftovers can be pinned.

NEXT ACTION: extract R17.17 first — it is a pure function wearing I/O, so its seam is trivial and it
carries the more valuable regression (see the SCEN-012 note below).

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

- [ ] `lib/startup-user-scope-guard.mjs` exists; `server.mjs` calls it; behaviour identical
- [ ] `lib/startup-marketplaces.mjs` exists; `server.mjs` calls it; behaviour identical
- [ ] Tests for both, each proven to FAIL when its guard is neutered
- [ ] The SCEN-012 boundary-match regression is pinned by name
- [ ] `node --check` clean on every touched `.mjs`; tsc clean; full suite green
- [ ] Server restarts and both R17 startup log lines still appear
- [ ] Map Test column filled for R17.17 + R17.20; `MAX_ENFORCED_WITHOUT_TEST` 117 → 115
- [ ] The R17.17 rule-text mismatch (`settings.local.json` → `settings.json`) is routed as a
      governance edit, not fixed here

## Approval log

- 2026-07-26T08:33:17+0200 — MANDATE (self, min-approval-requirement: none). In-scope dev work
  derived from TRDD-H4Y9F25J batch 1; no governance surface touched, so it is born approved.
