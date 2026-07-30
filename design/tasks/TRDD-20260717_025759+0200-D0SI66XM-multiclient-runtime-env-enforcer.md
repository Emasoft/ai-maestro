---
trdd-id: D0SI66XM
title: Multi-client runtime-behaviour settings enforcer (codex / gemini / opencode / kiro / kimi)
column: design
created: 2026-07-17T02:57:59+0200
updated: 2026-07-30T13:52:00+0200
current-owner: ai-maestro
assignee: ai-maestro
created-by: ai-maestro
task-type: feature
parent-trdd: QZL828OD
relevant-rules: [42, 20]
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T13:52:00+0200
implementation-commits: [26ed75dc]
blocked-by: []
npt: []
eht: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-30

**The INVESTIGATION is done for everything the repo can answer. It produced a bug fix
and a design finding that changes the build's shape, so the build has NOT started —
deliberately, not by omission.** `column: design`.

**D1 is no longer a blocker.** The card said restart-after-change "needs the R42
restart extension (D1), still unratified" — D1 was ratified today as **R42.7**
(TRDD-QZL828OD, `e4a4bedb`). That dependency is lifted.

### Finding 1 — the launchable client set, authoritatively (investigation step 1)

`lib/client-capabilities.ts` is the ONE authority. `SUPPORTED_CLIENTS =
['claude', 'codex', 'gemini', 'opencode', 'kiro']` — tmux-launchable. Also:

- **`kimi` is NOT a supported client.** The USER named it in the origin directive, but
  nothing in this repo drives it: no `ClientType` member, no capabilities entry, no
  adapter, no converter provider. **Enforcing settings for a client we cannot launch
  would be enforcing nothing**, so kimi is OUT OF SCOPE until it is added as a client.
  That is a correction to this card's own title and needs saying rather than quietly
  dropping.
- **`aider`** is in `ClientType` but out of `SUPPORTED_CLIENTS` and was **explicitly
  excluded by the USER** (recorded in TRDD-ANYCPRTX). Out of scope.
- **`github-copilot` / `kilocode`** are converter/skill TARGETS only, never launched.
  Out of scope.
- Every one of the 11 agents on this host runs `claude-code`. So the whole non-Claude
  half of this card is, today, about clients nobody is running — which is why the
  bug below was latent.

### Finding 2 — a REAL BUG, found and FIXED (`26ed75dc`)

`resolveRestartBin` carried its own client→binary ladder and had **drifted from the
authority**: `opencode` and `kiro` are both launchable and had **no branch**, so both
fell through to `return 'claude'` — a restart relaunched an opencode agent **as
Claude**, with that agent's own stored args. And `kiro`'s binary is **`kiro-cli`**, so
hand-adding the two missing branches (the obvious fix) would have got one wrong. Now
delegated to `getClientCapabilities().cli.binary`. The shadow-map footgun one layer
below the TITLE_PLUGIN_MAP episode. Latent (all agents are claude-code) but the R42.7
fan-out had just automated that path, so severity rose without the trigger moving.

### Finding 3 — investigation step 2 is UNANSWERABLE from the repo

**`configFile` in `client-capabilities.ts` is NOT the global settings file.** It is the
per-PROJECT instructions file: `CLAUDE.md`, `AGENTS.md` (opencode), `GEMINI.md`,
`config.toml` (codex), `.kiro/settings.json`. The only GLOBAL settings path the repo
knows is Claude's `~/.claude/settings.json` (`claude-adapter.ts`). So the global
config path + format for **codex / gemini / opencode / kiro** is genuinely unknown
here, and this card forbids guessing it ("VERIFY each from the client's own docs, do
not guess a path"). That research is the remaining input for the file-writing design.

### Finding 4 — there may be no need to write a foreign settings file at all

`ClientCliCommands` already carries **`envVars: Record<string, string>`** —
"environment variables to prepend to launch command" — and Claude's is
`{ CLAUDE_CODE_NO_FLICKER: '1' }`. That is a mechanism **we fully own**: it needs no
per-client path discovery, no TOML/JSON/YAML writer per client, no foreign-file
merge-without-clobber, and no user-scope carve-out per client, because we are not
writing anyone's config — we are setting the environment of a process we launch.

**This is a materially better shape than the card's A/B**, and it reframes the whole
task: for any runtime toggle a client reads from the ENVIRONMENT, the enforcer is a
per-client `envVars` entry plus the existing launch builder. Only toggles a client
reads **exclusively from its config file** need Finding 3's research. The Claude
enforcer stays as-is either way (its `env` object is Claude-specific and already live).

**NEXT ACTION — a design decision, before any research or code:** for each key in the
QZL828OD allowlist, determine whether the target client reads it from the environment
(→ `envVars`, cheap, ours) or only from its config file (→ needs Finding 3). Do that
for **codex and gemini first** — they are the two non-Claude clients with adapters and
real converter support, so they are where a second enforcer would actually be
exercised. `opencode`/`kiro` follow.

## ⏵ STATE — superseded 2026-07-17 entry (do NOT act on it)

**Origin:** USER directive (2026-07-17), alongside ratifying the Claude enforcer (TRDD-QZL828OD):
*"i also ask you to search the codex and kimi and opencode, etc. equivalent settings and make sure
they will be enforced on those cli clients global config/settings files too. but this other TRDD
can be delayed. only the one with claude must be done now."*

**This is the DELAYED companion to TRDD-QZL828OD.** The Claude `~/.claude/settings.json`
runtime-env enforcer is DONE and live (`lib/claude-settings-enforcer.ts`, wired in `server.mjs`,
commit `4c8b7cb8`). This TRDD generalises that same guarantee to EVERY other CLI client ai-maestro
drives, so the harness's required runtime behaviour holds no matter which client an agent runs.

**USER-mandated, delayed — NOT started.** `column: backburner`. Build only after the USER
greenlights it (they explicitly deferred it).

**NEXT ACTION:** the INVESTIGATION below (read-only). The Claude env keys do NOT transfer verbatim —
each client has its own runtime-behaviour surface, its own config file, and its own format. Map each
before writing any enforcer.

## Problem / Goal

ai-maestro drives agents on multiple CLI coding-agent clients (per CLAUDE.md: `claude`, `codex`,
`gemini`, `opencode`, `kiro`, + `kimi` newly named by the USER). Each has a GLOBAL config/settings
file with runtime-behaviour toggles (background tasks, subagent/fork behaviour, idle/AFK timeouts,
tool-search, the ask-user-question timeout — or the closest equivalent each client exposes). The
harness needs the SAME behavioural guarantees on every client, not just Claude.

The Claude enforcer (QZL828OD) is the reference implementation. This TRDD ports its GUARANTEE — a
fixed allowlist, set-if-missing-or-different, merge-never-replace, fail-closed, atomic write,
restore-on-drift watchdog — to each other client's config file and format.

## Investigation (read-only — DO THIS FIRST; do not assume)

For EACH client ai-maestro can drive, determine and record here:
1. **Which clients ai-maestro actually launches** — the authoritative list is the per-client
   adapters (`lib/client-plugin-adapters/`) + the converter registry (`lib/converter/registry.ts`)
   + `compatible-clients` usage. Enforce ONLY clients ai-maestro really drives.
2. **The global config file path + format** for each (e.g. Codex `~/.codex/config.toml` — TOML;
   Gemini `~/.gemini/…` — JSON; OpenCode, Kiro, Kimi — VERIFY each from the client's own docs, do
   not guess a path).
3. **The equivalent runtime-behaviour keys** (the analogue of `ENABLE_BACKGROUND_TASKS`,
   `CLAUDE_CODE_FORK_SUBAGENT`, `CLAUDE_AFK_*`, `askUserQuestionTimeout`, …). Some clients will have
   NO equivalent for a given key — record "no equivalent" explicitly rather than inventing one.
4. **Whether the write is a user-scope carve-out** the same way Claude's is (it will be — the same
   `feedback_ai_maestro_never_installs_user_scope` reasoning applies per-client: runtime behaviour,
   never plugin/element enablement). Amend that memory note's exception to cover each client added.

## Approach (build — AFTER investigation + USER go-ahead)

Generalise, do not copy-paste 5 enforcers. Two candidate shapes (pick after investigation):
- **A — one enforcer, per-client descriptor:** a `lib/client-settings-enforcer.ts` taking a
  descriptor `{ client, configPath, format: 'json'|'toml', required: {...} }`. One merge/atomic/
  fail-closed/watchdog core; per-client descriptors supply path+format+allowlist. Reuse a TOML
  read/write only where a client needs it (Codex).
- **B — per-client adapter modules** behind a common interface, if the formats diverge too much to
  share a core.

In both: the Claude enforcer stays as-is (its `env`-object shape is Claude-specific); this is the
sibling for the others. The boot-enforce + restore-on-drift watchdog wire into `server.mjs`
alongside the Claude one.

**Restart-after-change** is the SAME open dependency as QZL828OD: it needs the R42 restart
extension (D1), still unratified. Until then the enforcer writes+restores; new sessions pick the
keys up at launch.

## Verification (design)
- Per client: unit tests (0-IMPACT, temp dir) for add-if-missing / update-if-different /
  never-clobber-unrelated / restore-on-drift / fail-closed-on-corrupt, in that client's format.
- tsc + `yarn test` + `yarn build` clean.
- The memory carve-out note lists every client the enforcer touches.

## ✔ Acceptance

- [x] Investigation step 1 — the launchable client set, from the authority; `kimi`,
      `aider`, `github-copilot`, `kilocode` ruled OUT with reasons
- [x] A bug found and fixed en route (`26ed75dc`) with a recorded neuter run
- [x] Investigation step 3 — the runtime-key surface: `envVars` exists and is
      launch-time, NOT settings-file; recorded as a candidate design
- [ ] Investigation step 2 — global config path + format per client. **Blocked on
      each client's own docs**; this card forbids guessing. Do codex + gemini first.
- [ ] Per-key decision: environment-read (→ `envVars`) vs config-file-only (→ writer)
- [ ] Build the chosen shape; per-client 0-IMPACT tests; amend the user-scope
      carve-out memory note with every client the enforcer ends up touching
- [ ] tsc + `yarn test` + `yarn build` clean

## Approval log
- 2026-07-30T13:52:00+0200 — **Investigation phase EXECUTED**; build deliberately NOT
  started, because it produced a design finding (Finding 4) that changes the shape and
  an unanswerable input (Finding 3) that this card forbids guessing at. `mandate: true`
  / `mandated-by: self` at `min-approval-requirement: none`: the investigation is
  read-only and in-scope, so it is a self-mandate. The USER's 2026-07-30 delegation
  ("I need all 14 pending tasks completed today!!!") is the go-ahead the 2026-07-17
  entry was waiting for — but a go-ahead is not a licence to guess four third-party
  config schemas, and shipping an enforcer aimed at a client we cannot launch (`kimi`)
  would be motion, not progress. What is genuinely done is recorded; what is not is
  named.
- 2026-07-17 — Authored (USER-mandated, delayed) as the multi-client companion to TRDD-QZL828OD.
  USER explicitly deferred the build ("this other TRDD can be delayed"). Awaiting a USER go-ahead
  to start the investigation phase.
