---
trdd-id: ZFHY7UGU
title: Make tldr-code + fastedit + lean-ctx + distill official ai-maestro dependencies
column: todo
created: 2026-06-30T20:37:03+0200
updated: 2026-06-30T20:37:03+0200
current-owner: main
assignee: main
priority: 3
severity: MEDIUM
effort: L
labels: [tooling, dependencies, install, code-analysis]
task-type: infra
parent-trdd: null
npt: []
eht: [TRDD-ANYCPRTX]
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [lint]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [install-script, dependencies, config-schema]
external-refs: ["github.com/parcadei/tldr-code"]
---

# TRDD-ZFHY7UGU — Make tldr-code + fastedit + lean-ctx + distill official ai-maestro dependencies

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-06-30

- **Status:** PLAN authored (column `todo`). Awaiting USER greenlight to implement
  (USER chose "plan first via TRDDs" on 2026-06-30).
- **Origin:** USER intends to make **distill + lean-ctx + tldr-code + fastedit**
  official ai-maestro deps "installed along the other dependencies", conflict-free
  with the app + agents. This session (2026-06-30) prototyped all FOUR at USER
  scope — see "Durable artifacts" — so the integration target is proven.
- **fastedit (4th tool, the WRITE companion to read-only tldr):** install
  `uv tool install 'fastedits[mlx,mcp]'` — **REQUIRES tldr on PATH first** (it uses
  tldr-code internally) — then `fastedit pull --model mlx-8bit` (~3 GB local 1.7B
  merge model). Verified installable this session (CLI at `~/.local/bin/fastedit`
  + `fastedit-mcp` + `fastedit-hook`; allowlist `fastedit` in lean-ctx). On
  Homebrew Python use `uv tool` NOT `pip` (PEP 668). 74% of edits are
  deterministic (0 tokens); the model handles the rest. Folded into the unified
  `tldr-code` skill this session.
- **NEXT ACTION:** determine the install methods of **lean-ctx** and **distill**
  (tldr is known: cargo/`tldr-cli --features semantic`, or a prebuilt GitHub-release
  binary). Read how they were installed on this machine, THEN read
  `install-messaging.sh` to find the insertion point.
- **Load-bearing facts / gotchas:**
  - tldr install (verified this session): `cargo install --path crates/tldr-cli
    --features semantic` (Rust); or prebuilt `tldr-<triple>.gz` from
    github.com/parcadei/tldr-code/releases → `~/.local/bin/tldr`. Binaries: `tldr`,
    `tldr-daemon`, `tldr-mcp`.
  - **THE KEY CONFLICT:** lean-ctx enforces a shell ALLOWLIST. Out of the box it
    blocked `tldr`, `claude`, `node`, `python3 -c` until `lean-ctx allow <cmd>`.
    If ai-maestro adopts lean-ctx as a dep, the installer MUST seed the allowlist
    with EVERY ai-maestro CLI agents rely on (`tldr`/`tldr-daemon`/`tldr-mcp`,
    `aimaestro-agent.sh`, `amp-*.sh`, `aid-*.sh`, `claude`, `node`, `uv`, `git`,
    `which`, …) or agent shells break. Allowlist config: `~/.config/lean-ctx/config.toml`.
  - lean-ctx also blocks `$(...)` command-substitution and heredoc-piped
    interpreters — agent scripts that use those will be blocked. Audit needed.
  - distill is a manual output-compression pipe (`cmd | distill "<prompt>"`),
    not a hook — low conflict surface, but it must be on PATH for agents.
  - Coexistence model (ratified this session): lean-ctx + distill are GENERIC,
    non-discriminating interceptors (wrap every tool call); tldr is a DELIBERATE,
    intentionally-invoked instrument. The three coexist. tldr hooks stay UNWIRED.
- **SUPERSEDED — do NOT carry forward:** none yet.
- **Durable artifacts to read before acting:**
  - `~/.claude/skills/tldr-code/SKILL.md` (+ `references/`) — the authored skill.
  - `~/.claude/rules/tldr-cli.md` — the user-scope rule (the coexistence model).
  - `~/.claude/_archive/tldr-pre-migration-20260630/` — full backup of the pre-migration state.
  - `~/.config/lean-ctx/config.toml` — the live allowlist (already seeded with tldr/claude/node/uv/git/…).

## Goal

distill + lean-ctx + tldr-code are installed automatically as part of an
ai-maestro install (alongside the existing deps), available on PATH to every
agent regardless of client, and **provably non-conflicting** with the app's own
script layer and the agent tmux sessions.

## Plan (phased — implement only after USER greenlight)

### Phase A — determine install methods (BLOCKS the rest)
- tldr-code: prefer the **prebuilt release binary** (no Rust toolchain required on
  user machines) → download `tldr-<triple>.gz`, install to `~/.local/bin/`.
  Fallback: `cargo install tldr-cli --features semantic` when cargo is present.
- lean-ctx: DETERMINE (read the machine's install — npm? cargo? brew? a binary?).
- distill: DETERMINE (read the machine's install).
- Record exact, reproducible install commands per platform (macOS, linux).

### Phase B — wire into the ai-maestro installer
- Add a "code-analysis tooling" step to `install-messaging.sh` (or a dedicated
  `install-tooling.sh` it calls). Install the 3 tools; verify each on PATH.
- Seed the lean-ctx allowlist with the full ai-maestro CLI set (see gotcha above)
  via `lean-ctx allow …` so the app's scripts + tldr are never blocked.
- Add the tools to `docs/REQUIREMENTS.md` prereqs and `ecosystem-config.sh` /
  `lib/ecosystem-constants.ts` if they belong there.

### Phase C — conflict-proofing (the deliverable's hard part)
- Audit ai-maestro's CLI scripts for patterns lean-ctx blocks (`$(...)`,
  heredoc-to-interpreter) and either allowlist-exempt or refactor.
- Confirm the lean-ctx hooks (`lean-ctx-redirect/rewrite`, `spyglass-collect`) do
  not break agent tmux panes (`agent-shell-guard.sh` interplay).
- Keep the tldr hooks UNWIRED (per the Phase-1 decision); document that the
  `tldr-read-enforcer` must never be wired alongside lean-ctx.

### Phase D — docs
- Update `docs/REQUIREMENTS.md`, `README.md`, and ai-maestro `CLAUDE.md` to list
  the 3 tools, their install, and the coexistence/allowlist note.

## Open questions (resolve at impl time)
- lean-ctx + distill exact install method + version pinning.
- Bundle a prebuilt tldr binary vs require cargo? (prefer prebuilt.)
- Exhaustive list of ai-maestro CLIs that MUST be lean-ctx-allowlisted.
- Do lean-ctx / distill exist for non-Claude clients, or are they Claude-only?
  (affects EHT TRDD-ANYCPRTX cross-client guidance.)

## Acceptance
- A fresh ai-maestro install yields working `tldr` (+semantic), `lean-ctx`,
  `distill` on PATH; ai-maestro's own scripts are NOT blocked by lean-ctx; agents
  can invoke tldr intentionally; docs updated. Commit-only, NO push (ai-maestro is
  the app, not a plugin — USER-gated).
