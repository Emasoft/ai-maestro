---
trdd-id: 95IKXQI6
title: Parameterize install/update scripts with a custom git repo+branch and a version-downgrade guard
column: testing
created: 2026-07-21T20:51:42+0200
updated: 2026-07-21T21:00:00+0200
current-owner: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-21T20:51:42+0200
relevant-rules: []
labels: [installer, updater, remote-install, decoupling, destructive-safety]
release-via: none
---

# Parameterize install/update scripts with a custom git repo+branch and a version-downgrade guard

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-21

**USER mandate (verbatim intent):** *"update the install and update scripts (remote or not)
to accept a custom git repo as parameter, to use instead of the official one. then you can
install/update from any branch you need. but watch out for installing a previous version on a
new version by error. and, btw, the updater and the installer does not install or update the
plugins from ai-maestro-plugins marketplace — that is a job done by ai-maestro itself when
creating a new agent or by the janitor when armed."*

**Two scripts, both installers of the SCRIPT LAYER (never marketplace plugins):**
- `scripts/remote-install.sh` — the `curl|bash` remote installer/updater of the whole app.
- `install-messaging.sh` — the local installer of the `~/.local/bin` frozen scripts.

**Deliverables (this TRDD):**
1. `--repo <owner/repo|url>` + `--branch <b>` on BOTH (env `AIMAESTRO_REPO`/`AIMAESTRO_BRANCH`
   on the remote one). Shorthand `owner/repo` → `https://github.com/owner/repo.git`.
2. **remote-install.sh default `REPO_URL` fixed** `23blocks-OS/ai-maestro` → `Emasoft/ai-maestro`
   (canonical per CLAUDE.md "GitHub Repos Architecture"; kills the destructive-upstream default
   the USER warned about twice).
3. **Version-downgrade guard** on remote-install.sh UPDATE path: fetch the target branch, read
   its `package.json` version, REFUSE if the installed version is strictly newer, unless
   `--allow-downgrade`. `_version_gt` via `sort -V`.
4. remote-install.sh update pull is **branch-aware** (was hardcoded `git pull origin main`) —
   pulls the explicitly-requested `--branch`, else the currently-checked-out branch; re-points
   `origin` only when `--repo` is explicitly passed.
5. install-messaging.sh `--repo/--branch` = **opt-in** clone-to-temp then install scripts from
   there; with NEITHER flag it does ZERO network I/O and uses its own checked-out tree (already
   "the current branch") — preserving the destructive-safety property.

**Deliberately NOT done (with reasons):**
- No downgrade guard in install-messaging.sh: it installs **versionless** shell files to
  `~/.local/bin` from a source the user explicitly named; there is no clean "installed script
  version" to compare, and coupling it to the app-install location (`~/ai-maestro/version.json`)
  is fragile. The version guard belongs to the one script that manages the versioned app.
- No touching of the marketplace-plugin path (install-messaging.sh option 2/3 skill install):
  per the USER clarification that is NOT the script-installer's job; agent plugins are
  ai-maestro's (on create) / the janitor's (when armed). Left unchanged.
- Gateways repo (`GATEWAYS_REPO`, separate `23blocks-OS/aimaestro-gateways`) left as-is —
  out of scope; the USER's concern is the main app source.

**VERIFIED (2026-07-21):** both scripts `bash -n` clean; `_normalize_repo_url` (shorthand→URL,
`.git` idempotent, URL/ssh passthrough) and `_version_gt` (refuses 0.57.10>0.57.3 numeric
downgrade, allows equal/upgrade) unit-tested in isolation and correct; no NEW shellcheck issues
(remaining info items are pre-existing, outside the edited regions).

**DEFERRED — live end-to-end install/update run.** Not exercised here: running the installer
requires a clean TARGET machine, and running it against `~/ai-maestro` (the live dev tree) is
unsafe — the new guard would correctly REFUSE a main-over-governance-rules downgrade, but the
update path's `git stash`/`pull` would still touch the dev branch. The human exercises the
custom-source path on a real target (`bash scripts/remote-install.sh --repo Emasoft/ai-maestro
--branch governance-rules`, or `bash install-messaging.sh --repo Emasoft/ai-maestro --branch
governance-rules`). This is why column=testing, not complete.

## Verification
- `bash -n scripts/remote-install.sh && bash -n install-messaging.sh` → 0 errors. ✓
- `_normalize_repo_url` / `_version_gt` isolated logic tests → all cases correct. ✓
- `--repo`/`--branch`/`--allow-downgrade` in remote-install `show_help`; `--repo`/`--branch` in
  install-messaging `-h`. ✓
- Live install/update against a clean target → DEFERRED to the human (see above).

## Approval log
- 2026-07-21T20:51:42+0200 — MANDATE (Tier-0, self, in-scope infra). No approval request sent.
