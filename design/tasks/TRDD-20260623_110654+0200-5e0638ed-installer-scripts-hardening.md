---
trdd-id: 5e0638ed-511b-4234-8f1c-7c95c9ddbc14
title: Harden the ai-maestro installer + CLI scripts — shellcheck-found real bugs + fail-fast cleanup
column: complete
created: 2026-06-23T11:06:54+0200
updated: 2026-06-23T12:19:05+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 3
severity: MEDIUM
effort: M
labels: [installer, scripts, shell, hardening, shellcheck]
task-type: bugfix
parent-trdd: null
relevant-rules: []
release-via: none
delivery: pull-request
target-branch: main
feature-branch: governance-rules
test-requirements: [lint]
audit-requirements: []
review-requirements: [human-review]
impacts: [install-script]
runtime-targets: [macos, linux]
---

# Harden the ai-maestro installer + CLI scripts

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-06-23

User directive (2026-06-23, while the SCEN batch runs in background): "continue
working on the ai-maestro installer and scripts." Approach per `/go-on-yourself`:
evaluate on FACTS (shellcheck), fix real bugs, no bloat, commit (NO push — ai-maestro
is not a plugin), write this TRDD.

**FACTUAL SCAN:** `shellcheck 0.11.0 --severity=warning` over `install-messaging.sh`
+ all 63 `scripts/*.sh` → **0 error-severity**, 96 warnings. Codes: SC2034×51 (mostly
false-positive "unused" in the sourced `ecosystem-config.sh`), SC2155×39 (fail-fast:
`local x=$(cmd)` masks `cmd`'s exit code), SC2154×2 (undefined var — REAL bugs),
SC2115×1 (unguarded `rm -rf` — REAL), SC2088×1 (false-positive: tilde in a display
string), SC1090×2 (dynamic source — false positive).

### Phase 1 — THREE REAL BUGS (this commit)
1. **`scripts/amp-delete.sh:156` (SC2115)** — `rm -rf "${AMP_ATTACHMENTS_DIR}/${MESSAGE_ID}"`.
   The line-155 guard `[ -d "${...}/${...}" ]` does NOT protect both-empty: `[ -d "/" ]`
   is TRUE → `rm -rf /`. Even one-empty wipes all attachments. FIX: fail-fast guards
   `"${AMP_ATTACHMENTS_DIR:?}/${MESSAGE_ID:?}"` (errors out instead of deleting `/`).
2. **`scripts/remote-install.sh:1188` (SC2154)** — `echo "AIMAESTRO_API=${api_url}"` but
   `api_url` is never assigned → a FRESH `.env` (no existing key) gets `AIMAESTRO_API=`
   (empty), breaking the agent's server connection. The sibling `if` branch (line 1186)
   correctly writes `http://127.0.0.1:${PORT}`. FIX: match it.
3. **`scripts/remote-install.sh:1351` (SC2154)** — `s|{{INSTALL_DIR}}|${safe_dir_repl}|`
   but `safe_dir_repl` is never assigned → the agent's seeded `CLAUDE.md` gets
   `{{INSTALL_DIR}}` blanked. Sibling escapes `safe_version`/`safe_gateways` (1348/1349)
   but lines 1352/1355 then use the RAW vars, leaving those two assigned-but-unused.
   FIX: add `safe_dir_repl=$(printf '%s' "$INSTALL_DIR" | sed <escape>)`; wire
   `safe_version` into line 1352 (defensive escaping, consistent); drop the dead
   `safe_gateways` (gateways are intentionally not escaped per the 1353-54 comment).

### Phase 2 — fail-fast + scan hygiene (next commit, after Phase 1 verified)
- **SC2155×39** (amp-helper.sh 21, amp-security.sh 10, aid-token/aid-maestro-token 2+2,
  migrate-r20 2, test-amp-* 2): split `local x=$(cmd)` → `local x; x=$(cmd)` so a failing
  `cmd` propagates (fail-fast). Mechanical; do per-file, re-shellcheck each.
- **SC2034×51** in `ecosystem-config.sh` (24): it's a CONSTANTS file meant to be SOURCED,
  so "unused" is expected. Resolve with a single top-of-file `# shellcheck disable=SC2034`
  (NOT export — these are config values, not env). Verify other SC2034 sites individually.
- **SC2088** (install-messaging.sh:666): false positive (display string `~/.local/bin`);
  leave as-is or add an inline `# shellcheck disable=SC2088`.

### PROGRESS (2026-06-23T12:07)
- **Phase 1 DONE** — 3 real bugs committed: `9415e1f2` (amp-delete SC2115 rm-rf guard,
  remote-install api_url SC2154), `e3ce0e0d` (remote-install safe_dir_repl + resolved guard),
  `1c49b1cd` (ecosystem-config SC2034 file-wide disable).
- **Phase 2 SC2155 (39/39) DONE** — `1a4a8bcf` amp-security (10), `d59ad1e4` test-amp-routing/
  cross-host (2 + 2 dead-param), `d403321c` aid-token/aid-maestro-token/migrate-r20 (6 + QUIET
  orphan; migrate-r20's pipefail grep got `|| true`), `ad20ff53` amp-helper (21 + AMP_LOCAL_DOMAIN
  remove + ADDR_SCOPE disable). Method per site: clean split where the cmd can't legit-fail
  (fail-fast); split + `|| true` for registration/config jq reads whose missing/partial case is
  a deliberate skip under set -euo pipefail.
- **BONUS BUG FIX** `d68802a1` — amp-helper upload_attachment Step 3 never checked the confirm
  HTTP status (parallel Step 2 does); surfaced by SC2034 on confirm_http/confirm_result. Added
  the status guard, removed the unused body capture.
- **Phase 2 SC2034 tail (14) + SC1090 (2) + SC2088 (1)** — DELEGATED to a background spark agent
  (write-guarded, no-commit) with a per-site classification: false-positives (AMP_ADDRESS read by
  7 sourcing scripts; GREEN/YELLOW/CYAN palette; SC1090 dynamic-source; SC2088 display-string) →
  inline disable; plugin_key dead → remove; extracted-but-unused (att_id/thread_id/status/amp-init
  dirs) → remove if truly dead; **latent unimplemented flags** (`--check`/`--include-data`/
  `--include-folder` parsed but never honored) → disable+TODO + flag as findings (NOT implemented —
  out of scope). Review its diff + `bash -n`/shellcheck, then commit by name.

### COMPLETE (2026-06-23T12:19)
Phase 2 DONE — spark's 17-finding tail reviewed + independently re-verified (bash -n +
shellcheck 0) and committed `8fba8730`. **Whole target set (install-messaging.sh + scripts/*.sh)
is now 0 `shellcheck --severity=warning` findings (was 96 at start).** att_id removal verified safe
(download_attachment takes the full att_json + extracts .id itself); amp-init.sh inbox/sent
re-derivations removed (ensure_amp_dirs builds them from AMP_MESSAGES_DIR) + block comment corrected.

**FOLLOW-UP FINDINGS (for a future TRDD — deliberately NOT done here):**
1. Latent unimplemented CLI flags (advertised but no-op): `agent-commands.sh --include-data` &
   `--include-folder` (cmd_export), `setup-tailscale.sh --check` (CHECK_ONLY). Decide per flag:
   implement or remove. Marked with `# TODO(TRDD-5e0638ed)` disables in-code.
2. Info/style items left out-of-scope (below --severity=warning): SC2086, SC2001, SC2012, SC2015,
   SC2016, SC2129, SC2162, SC2181, SC2329, SC1091. A `--severity=info` pass could address these.

**NEXT ACTION:** none — TRDD complete. 9 code commits (9415e1f2 e3ce0e0d 1c49b1cd 1a4a8bcf
d59ad1e4 d403321c d68802a1 ad20ff53 8fba8730). Human-review = USER reviewing the commits when back.
NO push (ai-maestro is not a plugin).

**GIT SAFETY:** the SCEN-001 scenario-runner is live on the same branch; it stages
app files by name and won't touch these shell scripts (disjoint file set). Commit my
fixes by explicit name only; never `git add -A`. Sequence commits so they don't race
the runner's git access (commit in a clean window or accept index-lock serialization).

## Acceptance criteria
- shellcheck (severity=warning) on the 3 fixed files shows the SC2115 + both SC2154
  findings GONE.
- No behavior regression: amp-delete still deletes a real message+attachments; a fresh
  `remote-install` writes a correct non-empty `AIMAESTRO_API=` and a fully-substituted
  agent `CLAUDE.md` (`{{INSTALL_DIR}}` replaced with the real install dir).
- Phase 2: total shellcheck warning count drops from 96 toward ~0 (false positives
  suppressed with documented directives, not blanket).

## Why
The installer + CLI scripts are the ai-maestro distribution surface (install-messaging.sh
copies them to `~/.local/bin/`). A blanked `AIMAESTRO_API`/`{{INSTALL_DIR}}` silently
breaks fresh remote installs; an unguarded `rm -rf` is a latent catastrophe. These are
exactly the "shortcomings" `/go-on-yourself` asks to find and fix on real evidence.
