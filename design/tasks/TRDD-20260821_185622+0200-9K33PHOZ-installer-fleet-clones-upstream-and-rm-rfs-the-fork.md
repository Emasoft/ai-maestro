---
trdd-id: 9K33PHOZ
title: install.sh rm -rfs the live fork checkout in non-interactive mode and reclones from upstream
column: dev
created: 2026-08-21T18:56:22+0200
updated: 2026-08-21T19:52:44+0200
implementation-commits: [4d4b72c7, 8b7c7de5, e0e55244, 4a760eed]
current-owner: hub-orchestrator
created-by: hub-orchestrator
assignee: hub-orchestrator
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: false
approved: false
priority: 0
severity: critical
labels: [installer, git-safety, data-loss, fork, audit]
relevant-rules: []
npt: []
eht: []
blocked-by: []
---

# install.sh rm -rfs the live fork checkout in non-interactive mode and reclones from upstream

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-21

Owner directive 2026-08-21: *"the five installers that install the various parts are also
installing skills from the original repo instead of Emasoft, and the plugins, and the messaging …
read all the installers scripts, including the reinstall script."* This card is the result of
that audit. Sibling card `TRDD-0N792LL5` holds the `update-aimaestro.sh` half.

**⚠ SUPERSEDED — do NOT carry forward.** This block opened *"Nothing has been changed. No
installer was run beyond `install-agent-cli.sh`"*. True when written at 18:56; false from 19:0x,
after the owner ruled on findings 2 and 4 and told me to fix 1 *"safe in any case"*. Findings
1, 2, 4 and 6 are now LANDED (see NEXT ACTION). Nothing here has been deleted — the findings below
are the record of what was measured, and they describe the code **as it was**, which is why the
line numbers in FINDING 1's table no longer resolve: the guard added ~45 lines above them.

Audit surface: 12 installer/updater scripts + both ecosystem SSOTs. Per-file evidence in
`reports/installer-audit/` (three files, 2026-08-21 18:53-18:54).

### FINDING 1 (CRITICAL) — the destruction chain, traced line by line

`./install.sh -y` (or `--non-interactive`) run **from outside** an ai-maestro checkout deletes
this working tree. Every link verified by reading the file, not inferred:

| line | statement | on this machine |
|---|---|---|
| 44-45 / 53 | `--from-remote` or `-y`/`--non-interactive` ⇒ `NON_INTERACTIVE=true` | |
| 688-690 | non-interactive ⇒ `DIR_CHOICE=1`, no prompt | |
| 704 | `DIR_CHOICE=1` ⇒ `INSTALL_DIR="$HOME/ai-maestro"` | **= the live dev checkout** |
| 725 | enters the block when the dir exists **and** `IN_AI_MAESTRO=false` | |
| 728 | guard: `INSTALL_DIR == $HOME/*` | **PASSES** |
| 731 | guard: `package.json` contains `"name": "ai-maestro"` | **PASSES** |
| 734 | ⇒ `DELETE_DIR="y"` | |
| 747 | **`rm -rf "$INSTALL_DIR"`** | 385 unpushed commits destroyed |
| 756 | `git clone https://github.com/23blocks-OS/ai-maestro.git "$INSTALL_DIR"` | recloned from UPSTREAM |

**Both "safety" guards are what green-light the deletion.** They were written to stop the script
deleting a directory that is *not* an ai-maestro install; they cannot distinguish a stale install
from the live development checkout. There is **no git check of any kind** in the path — no
`git status`, no uncommitted-file check, no ahead-of-remote count.

Measured the same hour: `fork/main` and `fork/governance-rules` are each **385 commits BEHIND**
local HEAD and **0 ahead**, so the deleted work exists on no remote, and the reclone would come
from the repo the owner has directed us to ignore.

**Reachability, stated precisely so nobody over- or under-rates it.** The branch needs
`IN_AI_MAESTRO=false`, and that flag is set true by line 665-668 (`--from-remote`) or line 670
(cwd has a `package.json` matching `ai-maestro`). Therefore:

- `./install.sh` from **inside** the repo → **safe**, delete branch unreachable.
- `remote-install.sh` → delegates as `./install.sh --from-remote -y` (lines 1220, 1279) →
  **safe**, same reason.
- `install.sh -y` from **anywhere else** — `$HOME`, a downloaded copy, a pasted quick-start
  line → **destroys the tree.** This is the ordinary shape of a "fresh install" command.

### FINDING 2 (MAJOR) — the app repo is upstream in the SSOT itself

`lib/ecosystem-constants.ts:362` and its shell mirror both set
`AI_MAESTRO_REPO = https://github.com/23blocks-OS/ai-maestro`. Every other constant is correct
(`MARKETPLACE_REPO` :36, `AMP_PLUGIN_REPO` :260, `AID_PLUGIN_REPO` :267, `AGENTLENS_REPO` :387
are all `Emasoft`). And `install.sh:756` does not read the constant at all — it hardcodes the
same URL, so fixing the SSOT alone would NOT fix the clone.

`scripts/remote-install.sh:49` carries the same upstream default for `REPO_URL`, with a comment
(43-47) explaining the flip to the fork waits until `governance-rules` is merged and pushed —
which is a coherent position, and is exactly why the fork is 385 behind.

### FINDING 3 (MAJOR) — no installer guards unpushed work

Neither `install.sh`, `remote-install.sh`, nor `update-aimaestro.sh` checks whether the local
tree holds commits the target remote lacks. `remote-install.sh`'s only protection is a
**semver-string** downgrade guard (~line 1168) comparing package versions — it cannot see commits.

### FINDING 4 (MINOR) — `GATEWAYS_REPO` is hardcoded upstream with no override

`install.sh:860` and `scripts/remote-install.sh:228` both hardcode
`https://github.com/23blocks-OS/aimaestro-gateways.git`, and unlike `REPO_URL` there is no flag
or env var to redirect it. **No `Emasoft` fork of that repo is known to exist**, so this is a
decision for the owner (fork it, or accept upstream for gateways), not a mechanical rename.

### FINDING 5 (MINOR) — four SSOT constants have zero consumers

`AMP_PLUGIN_NAME`, `AMP_PLUGIN_REPO`, `AID_PLUGIN_NAME`, `AID_PLUGIN_REPO` are defined in both
SSOTs and consumed **nowhere**: the only shell file naming them is `scripts/ecosystem-config.sh`
itself, and the only TS file is `lib/ecosystem-constants.ts` itself. So no installer installs the
AMP messaging plugin or the Agent Identity plugin from those repos — whatever installs them, it
is not reading these constants. Worth resolving before anyone "fixes" the constants and expects
behaviour to change.

### FINDING 6 (MINOR) — a false comment about the messaging plugin

`install.sh:767-768` runs `git submodule update --init --recursive` under the comment
*"Initialize git submodules (AMP messaging plugin, etc.)"*. There is **no `.gitmodules`** in the
tree and `git submodule status` is empty, so the step is a no-op and the comment names a
mechanism that does not exist. It is the kind of comment that sends the next reader hunting for
a submodule-sourced messaging plugin.

### FINDING 7 (MINOR) — `install-agent-cli.sh` is misnamed

It installs the whole shell-CLI layer — `aimaestro-teams.sh`, `aimaestro-governance.sh`,
`aimaestro-hook.sh`, `aimaestro-panel.sh` and the agent CLI's 6 modules — not just the agent CLI.
Owner reaction on being shown what it does: *"the name is not clear."* A rename touches its
callers in `remote-install.sh` and `update-aimaestro.sh`.

### WHAT THE AUDIT REFUTES — skills, plugins and messaging are NOT upstream-sourced

The owner's stated premise was that the installers pull skills, plugins and messaging from the
original repo. Measured, they do not:

- **Marketplace/plugins** resolve through `MARKETPLACE_REPO=Emasoft/ai-maestro-plugins`;
  `install-messaging.sh:877` does `claude plugin marketplace add "$MARKETPLACE_REPO"` and `:886`
  `claude plugin install "$PLUGIN_NAME"` where `PLUGIN_NAME` is `MAIN_PLUGIN_NAME` (`:866`).
- **`install-messaging.sh:868-871` actively REMOVES** the deprecated `23blocks-OS/ai-maestro-plugins`
  marketplace. That is correct migration behaviour, not a defect.
- **Skills are not installed standalone at all any more** — `install-agent-cli.sh:409-410` records
  their removal; they ship bundled inside `ai-maestro-plugin`, hence inherit the Emasoft marketplace.
- **`update-aimaestro.sh:244-245` and `update-messaging.sh:65-66`** use the SSOT defaults.

**The mechanism that makes the owner's read true anyway, and is the thing worth fixing:** the
*application tree* is cloned and pulled from upstream, and that tree carries `scripts/`,
`.claude/`, and every CLI. So anything sourced from the installed tree is upstream's, even though
the plugin layer is ours.

### Clean, no action needed (verified)

`install-agent-cli.sh` and `scripts/install-pillar-tooling.sh` (local checkout, zero network) ·
`scripts/setup-local-marketplaces.sh` (local directory marketplaces) ·
`scripts/install-agentlens.sh` (npm `agentlenspro`) ·
`scripts/install-code-analysis-tooling.sh` (third-party `parcadei/tldr-code` releases +
`@samuelfaj/distill` — legitimately external) · `scripts/install-boot-persistence.sh` (pm2 only).

### NEXT ACTION — five of seven landed; the two that remain are owner decisions

Owner rulings received 2026-08-21 and applied: **FINDING 2** — *"push and merge to main"*, done
(394 commits on `Emasoft/ai-maestro`, `main` fast-forwarded to `4a760eed`, `0.29.0`, CI green, 0
unpushed); **FINDING 4** — *"accept upstream for now, it should be configurable anyway"*, done;
**FINDING 1** — *"find a better solution that is safe in any case, it should be configurable
anyway"*, done and pinned by tests.

Landed: `4d4b72c7` (guard + both repo sources configurable), `8b7c7de5` (finding 6),
`e0e55244` (the guard's test), `4a760eed` (the merge).

**Still open, and each needs a ruling rather than work:**

1. **FINDING 5** — the four constants (`AMP_PLUGIN_NAME/REPO`, `AID_PLUGIN_NAME/REPO`) have zero
   consumers, and re-measuring found no hardcoded literal standing in for them either: quoted
   `'claude-plugin'` / `'agent-identity'` appear **nowhere** in `app/`, `services/` or `lib/`
   outside the two SSOT files, and repo-wide only in docs and memory. So **nothing installs the
   AMP messaging plugin or the Agent Identity plugin.** Deleting the constants and wiring them up
   are opposite fixes — the first says the capability was abandoned, the second says it was never
   finished — and choosing wrongly is worse than leaving it measured.
2. **FINDING 7** — the rename. The owner said *"the name is not clear"*, which is a judgement, not
   yet an instruction; it touches callers in `remote-install.sh` and `update-aimaestro.sh`.

## Acceptance

- [x] `install.sh` refuses to delete any directory that is a git work tree with uncommitted
      changes or with commits absent from its push remote — naming the count, exiting non-zero.
      `tests/unit/install-delete-guard.test.ts`, 7 cases; four neuters measured, each reddening a
      distinct set (kill the porcelain branch → 2, the rev-list branch → 1, the `.env.local`
      branch → 1, `exit 1` at the top → 6). The fifth neuter anyone would reach for, `return 1`,
      is recorded in the file as measuring the WRONG thing: the guard refuses with `exit`, so
      `return` falls through to the harness's success path and leaves both PERMITs green
- [x] The non-interactive auto-delete cannot select a path that is the caller's own checkout —
      satisfied in substance rather than by path-matching: selection is unchanged, and the guard
      makes selecting it harmless, which is the property that was actually wanted. Two PERMIT
      cases pin that a clean stale install is still replaceable, so this is not "refuse everything"
- [x] `install.sh` acquires the app from the SSOT constant rather than a hardcoded URL, so the
      repo is changed in one place — `AIMAESTRO_REPO` env → `AI_MAESTRO_REPO` → literal
- [x] FINDING 4 resolved by an owner ruling recorded in this card, and applied to both call sites
      (`install.sh`, `scripts/remote-install.sh`) via `AIMAESTRO_GATEWAYS_REPO`
- [ ] FINDING 5 resolved: the four constants are either consumed or deleted — **owner ruling**
- [x] FINDING 6: the false submodule comment is corrected or the no-op step removed — corrected,
      step kept so a future submodule needs no installer change (`8b7c7de5`)
- [ ] FINDING 7: rename decided; if taken, all callers updated in the same commit — **owner ruling**

## Approval log
