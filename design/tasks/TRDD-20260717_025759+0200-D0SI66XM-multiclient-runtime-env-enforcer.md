---
trdd-id: D0SI66XM
title: Multi-client runtime-behaviour settings enforcer (codex / gemini / opencode / kiro / kimi)
column: backburner
created: 2026-07-17T02:57:59+0200
updated: 2026-07-17T02:57:59+0200
current-owner: ai-maestro
task-type: feature
parent-trdd: QZL828OD
relevant-rules: [42, 20]
scope: project
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

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

## Approval log
- 2026-07-17 — Authored (USER-mandated, delayed) as the multi-client companion to TRDD-QZL828OD.
  USER explicitly deferred the build ("this other TRDD can be delayed"). Awaiting a USER go-ahead
  to start the investigation phase.
