---
trdd-id: d77a7d6e-4888-443e-81a1-bee94e67e3af
title: Secure auto-restore of active AI Maestro agents after unclean shutdown
status: superseded
created: 2026-05-21T17:08:44+0200
updated: 2026-05-22T11:19:12+0200
superseded-by: [TRDD-a1019073]
---

# TRDD-d77a7d6e — Secure auto-restore of active AI Maestro agents after unclean shutdown

**Filename:** `design/tasks/TRDD-20260521_170844+0200-d77a7d6e-secure-auto-restore.md`
**Tracked in:** this repo (`design/tasks/` is git-tracked)

## 1. Problem

On 2026-05-19 23:08:58 the host suffered an unclean reboot (likely brief
mains blackout, no UPS). Every active Claude Code agent that had been
running in tmux died. Investigation confirmed:

- The Mac's `autorestart=1` setting brings the hardware back up.
- pm2's `LaunchAgent` brings the AI Maestro server back up.
- `tmux-continuum` brings tmux session *containers* back up (but with empty
  shell prompts — the agent processes inside are NOT relaunched because
  `@resurrect-processes` is not configured, and even if it were, plain
  process-restart would not go through `wakeAgent` Gate 0).
- **Nothing currently restores the live set of active agents to their
  pre-blackout state.** The agent registry's `status` field is stale (some
  agents marked "active" haven't reported in 6+ weeks); no continuous
  live-state snapshot is written anywhere; no boot-time restore script
  exists.

User directive: after any unclean shutdown, AI Maestro MUST automatically
restore exactly the set of agents that were running at the moment of the
crash. The clients (Claude Code, Codex, etc.) must be relaunched inside
their tmux sessions; the janitor heartbeat then takes over to make each
agent resume its work.

Additional hard requirement from the user: **assume a malicious actor has
already injected a script into the dotfiles**. The restore flow must NOT
become a trojan that automatically re-arms the attacker on every boot.
Integrity of every file the restore touches must be verified against
known-good hashes stored outside the dotfile tree, in a hardware-backed
secure enclave where available.

## 2. Goals

1. **Auto-restore the pre-crash live set** — after `pm2` brings the
   server up, every agent that was online at crash time gets relaunched
   via the existing `POST /api/agents/[id]/wake` pipeline (Gate 0 honoured).
2. **Hardware-backed key custody** — no AID private keys ever sit on disk
   in cleartext. macOS Keychain (Secure Enclave where the SoC supports
   it) is the only persistence layer for cryptographic material.
3. **Tamper-evident restore** — every file the restore reads OR executes
   is verified against a baseline hash stored in Keychain BEFORE any
   action is taken. Any mismatch aborts the restore and emits a loud
   incident record. The attacker who modified a dotfile cannot piggy-back
   the restore.
4. **Bootstrap once, baseline forever** — initial install asks the user
   to confirm a known-good state. From that moment on, ONLY the AI
   Maestro server itself can roll baselines forward, and only through
   pipelines that already produce signed-ledger entries. Direct dotfile
   edits NEVER update the baseline.
5. **Graceful refusal under attack** — if integrity fails, the system
   exits cleanly with a recoverable error message. It MUST NOT attempt
   to "self-heal" or rewrite anything before the human confirms the
   state.

## 3. Non-goals

- Defending against attacks that already have the user's login password
  / Apple ID (those have full Keychain access by construction).
- Defending against kernel-level rootkits (out of scope — different
  threat model).
- Cross-host restore (each host restores its own local agents only;
  remote-host coordination is a separate TRDD).
- Saving agent conversation memory itself — Claude Code's `--continue`
  flag and the janitor heartbeat handle that. This TRDD restores the
  set of processes, not the dialog state inside each one.
- Replacing tmux-continuum. tmux-continuum stays for non-AI-Maestro
  tmux sessions the user may run; this TRDD owns the AI Maestro
  agent restoration path specifically.

## 4. Threat model

The system's adversary owns ALL writable dotfiles in `$HOME`. They can:

- T1. Edit `~/.aimaestro/agents/registry.json` (redirect wake to a
  malicious workdir, change `program`, plant a fake agent, etc.)
- T2. Edit `~/.aimaestro/governance.json` (downgrade titles, weaken
  permission gates)
- T3. Edit `~/.aimaestro/teams/teams.json` (add agents to teams they
  shouldn't be on, change COS assignments)
- T4. Edit `~/.aimaestro/runtime-snapshot.json` (the new file
  introduced here) — make the boot script wake attacker-controlled
  agents AND skip ones the user actually had running
- T5. Replace `~/Library/LaunchAgents/com.emasoft.aimaestro-restore.plist`
  (point the LaunchAgent at the attacker's binary)
- T6. Replace `~/agents/<persona>/.claude/settings.local.json` or
  `<plugin>/agents/*.md` (prompt injection — every agent that wakes
  silently runs the attacker's instructions)
- T7. Replace the restore script itself
- T8. Edit `~/.tmux.conf` (tmux session restore runs attacker code in
  every restored pane before the AI Maestro restore script even starts)
- T9. Edit `~/.zshrc` / `~/.bash_profile` (every shell tmux spawns runs
  attacker code)

The adversary CANNOT:

- Read or write the macOS Keychain without the user's login password
  AND a deliberate prompt (we configure ACLs to require the specific
  process identity, not just login auth)
- Modify code-signed system binaries (`security`, `tmux`, `node`, etc.)
- Modify the kernel
- Defeat Touch ID / Secure Enclave attestation on M-series Macs

The defense rests on **two independent layers**:

**Layer 1 — Keychain access is bound to code-signed binary identity,
not user identity.** Every Keychain item we create has an ACL of the
form `{ allowed_apps: [code_signature(ai-maestro-server-launcher),
code_signature(aimaestro-secure-restore-binary)] }`. macOS's Keychain
Services enforces this at the kernel boundary: a malicious shell
script in `~/.zshrc` or `~/.tmux.conf` that tries to call
`security find-generic-password ...` is rejected with `errSecAuthFailed`
because its process identity does not match either allowed code
signature. The attacker cannot even READ the baseline hashes, let
alone the AID private key. macOS does NOT prompt the user — the call
fails outright.

**Layer 2 — every file we read OR execute during restore is
hash-verified against Keychain-stored baselines before use.** If
Keychain says the file should have hash H_known and the file on disk
has hash H_now and H_known ≠ H_now, the restore refuses.

Layer 1 is the primary defense. Layer 2 is defense-in-depth in case
the attacker finds a way to invoke the legitimate ai-maestro-server
binary in a context that bypasses normal pipelines (e.g. by feeding
it crafted input on stdin). Together, the attacker has no path that
both (a) accesses Keychain material and (b) modifies a file without
the modification being detected before any restore action.

**Critical UX consequence**: the human user is prompted by macOS for
Touch ID / login password ONCE during install (bootstrap §6.1) and
ONCE per legitimate config edit outside the server (reseal §6.5).
During an unattended overnight reboot, the user is NOT present
(typically remote), so Touch ID prompts during boot would deadlock
the restore. The ACL is configured so the two allowed binaries can
read and sign WITHOUT any user prompt — once user trust is granted
at install, it persists across all subsequent boots until the user
explicitly revokes it (via Keychain Access.app or by reinstalling).

## 5. Architecture

```
              Mac boot
                 │
                 ▼
       pm2 LaunchAgent fires
                 │
                 ▼  (pm2 resurrect runs ai-maestro server)
       ai-maestro server up
                 │
                 ▼
      NEW: com.emasoft.aimaestro-restore LaunchAgent fires
      (RunAtLoad=true, delay until server /api/health responds)
                 │
                 ▼
      ┌──────────────────────────────────────────────┐
      │  scripts/aimaestro-secure-restore.sh         │
      │  (self-verifies its own hash first thing)    │
      ├──────────────────────────────────────────────┤
      │  STEP A: Self-attestation                    │
      │    - shasum -a 256 of $0                     │
      │    - compare to Keychain "restore-script-h"  │
      │    - MISMATCH → exit 2, alert via osascript  │
      ├──────────────────────────────────────────────┤
      │  STEP B: Verify config-file baseline         │
      │    For each file in baseline-manifest:       │
      │      hash_now = shasum -a 256 file           │
      │      hash_known = keychain.get(file-path)    │
      │      if mismatch → exit 3 + alert            │
      │    Files checked:                            │
      │      registry.json, governance.json,         │
      │      teams.json, hosts.json,                 │
      │      ~/Library/LaunchAgents/com.emasoft.*    │
      │      every persona's settings.local.json     │
      │      .tmux.conf, .zshrc (host-injection)     │
      ├──────────────────────────────────────────────┤
      │  STEP C: Verify runtime-snapshot             │
      │    - Read ~/.aimaestro/runtime-snapshot.json │
      │    - Verify Ed25519 signature (signing key   │
      │      in Keychain; only server can write)     │
      │    - Verify capturedAt < 24h ago             │
      │    - SIGNATURE INVALID OR STALE → exit 4     │
      ├──────────────────────────────────────────────┤
      │  STEP D: Sign wake-request challenges        │
      │    - For each agentId in snapshot:           │
      │      - Build challenge (timestamp + agentId) │
      │      - Sign with system-AID private key via  │
      │        Keychain `security` CLI               │
      │      - POST to /api/agents/<id>/wake with    │
      │        signed bearer in Authorization header │
      ├──────────────────────────────────────────────┤
      │  STEP E: Report                              │
      │    - Write structured incident log to        │
      │      $MAIN_ROOT/reports/secure-restore/      │
      │    - osascript notification on any failure   │
      └──────────────────────────────────────────────┘
                 │
                 ▼
      Wake API in server applies wakeAgent() Gate 0
      (governance, role-plugin, team-block checks)
                 │
                 ▼
      tmux sessions are (re-)created with claude --agent <persona>
                 │
                 ▼
      Per-agent janitor heartbeat fires → tells each
      Claude Code to resume its work
```

### 5.1 New components

| Component | Type | Location | Owner | Code-signed? |
|---|---|---|---|---|
| System-AID keypair | Ed25519 in macOS Keychain (Secure Enclave on M-series) | Keychain item `ai-maestro.system-aid` | Bootstrap binary + Restore binary | n/a |
| Baseline-signing keypair | Ed25519 in macOS Keychain | Keychain item `ai-maestro.baseline-signer` | Server launcher binary only | n/a |
| Baseline manifest | JSON in Keychain (signed by baseline-signer) | Keychain item `ai-maestro.baseline-manifest` | Server launcher binary only | n/a |
| Runtime snapshot writer | TS module loaded by server | New `lib/runtime-snapshot.ts` | Server | n/a |
| Runtime snapshot file | Signed JSON | `~/.aimaestro/runtime-snapshot.json` (sig embedded) | Server writes, restore binary reads | n/a |
| **Server launcher** (NEW) | Native Swift binary | `bin/ai-maestro-launcher` | Wraps `node server.mjs`, holds Keychain identity | **YES — ad-hoc signed during install, registered with Keychain ACL** |
| **Secure restore binary** (NEW) | Native Swift binary | `bin/aimaestro-secure-restore` | Replaces the original "bash script" plan — needs a stable code-signed identity for Keychain ACL | **YES — ad-hoc signed during install** |
| **Baseline helper** (NEW) | Native Swift binary | `bin/ai-maestro-keychain-helper` | Small shim the server invokes for every Keychain read/write/sign — keeps the Keychain ACL surface narrow | **YES — ad-hoc signed during install** |
| Bootstrap binary | Native Swift binary | `bin/ai-maestro-secure-restore-init` | Interactive setup tool — the only context where Touch ID is prompted | **YES — ad-hoc signed during install** |
| Restore LaunchAgent | plist | `~/Library/LaunchAgents/com.emasoft.aimaestro-restore.plist` | launchd | n/a |
| Boot-token route | Next.js API | `app/api/internal/wake-by-system-aid/route.ts` | Server | n/a |
| Incident log | Markdown | `reports/secure-restore/<ts>-incident.md` | Restore binary | n/a |

**Why native binaries instead of shell scripts**: macOS Keychain ACL
enforcement uses `SecCodeRequirement` to verify the calling process's
code signature against the ACL's allowed list. Shell scripts are
plain text — their "process identity" at the kernel level is the
interpreter (`/bin/bash`, `/bin/zsh`, `/opt/homebrew/bin/node`), which
is shared by every other script on the system. Path-based trust is
defeated by symlink swaps and binary-name aliasing. Only Mach-O
binaries with stable signatures (even ad-hoc signatures generated at
install time via `codesign --sign -`) give Keychain a reliable
identity to lock against. We pay the cost of ~4 small Swift binaries
(< 200 lines each) and get an attacker-proof ACL boundary.

### 5.2 Why a *separate* system-AID instead of reusing the maestro user session

Option B (reuse maestro user session) was rejected because:
- Session cookies expire and would foot-gun the restore at exactly the
  wrong time.
- Replay risk if `~/.aimaestro/governance-tokens/` is leaked.
- The session is bound to the human user identity; using it for a
  daemon-initiated action breaks the agent-identity audit trail.

The system-AID is a dedicated, never-rotated-without-user-approval
identity whose ONLY permission is "wake the agents listed in a
signed runtime-snapshot." It cannot create agents, change titles,
delete teams, or do anything else.

### 5.3 Keychain ACL design (the linchpin)

The ENTIRE security model collapses if a malicious shell script
running under the user's UID can read the AID private key. macOS
Keychain ACLs are the mechanism that prevents this. Below is the
explicit ACL for each Keychain item — every entry, every flag.

#### Item `ai-maestro.system-aid` (the private key that signs wake challenges)

```
Access control:
  partition_list:
    - apple:                                  # disallow system tools
    - teamid:Z9YT9CK6BL                       # ad-hoc dev identity
  allowed_applications:
    - /opt/aimaestro/bin/ai-maestro-keychain-helper  (cdhash=A...)
    - /opt/aimaestro/bin/aimaestro-secure-restore    (cdhash=B...)
  prompt_user_for_access: NO  (after one-time bootstrap)
  authenticate_before_use: NO
```

The `allowed_applications` list pins the hash of the Mach-O binary
itself. If an attacker overwrites `aimaestro-secure-restore` with
their own code, the `cdhash` no longer matches and Keychain rejects
the access — `errSecAuthFailed`. macOS does NOT prompt; the call
fails outright. The legitimate restore binary, signed at install
time, is the only thing in the universe that can read this key.

#### Item `ai-maestro.baseline-signer` (the key that signs the baseline manifest)

```
Access control:
  allowed_applications:
    - /opt/aimaestro/bin/ai-maestro-keychain-helper  (cdhash=A...)
    # NOTE: secure-restore is NOT in this list. It does not sign;
    # it only VERIFIES (which needs the public key, not the private one).
  prompt_user_for_access: NO
```

Only the server-side keychain helper can sign baseline updates. The
boot-time restore binary can read the manifest (signed envelope is
readable) and verify the signature against the public key (which is
embedded in the binary at compile time), but it cannot forge a new
signed manifest.

#### Item `ai-maestro.baseline-manifest` (signed JSON blob with file hashes)

```
Access control:
  allowed_applications:
    - /opt/aimaestro/bin/ai-maestro-keychain-helper  (read+write)
    - /opt/aimaestro/bin/aimaestro-secure-restore    (read-only — verify against pub key)
  prompt_user_for_access: NO
```

#### How an attacker scenario fails at the ACL layer

```
Attacker injects into ~/.zshrc:
    echo 'security find-generic-password -s ai-maestro.system-aid -w' >> ~/.zshrc

User opens a new shell. The injected line runs:
    /usr/bin/security find-generic-password -s ai-maestro.system-aid -w

→ kernel checks the calling process (zsh, then /usr/bin/security).
→ neither is in the Keychain item's allowed_applications list.
→ macOS Keychain returns errSecAuthFailed (-25293).
→ no prompt is shown, no key is leaked.
→ the attacker's loot is exactly: 0 bytes.

The user is not even disturbed. The malicious script silently
fails. The integrity baseline detects the modified .zshrc on the
next boot (or live, via the file-watcher M2 ships) and alerts.
```

#### Setting ACL programmatically without Touch ID prompts at boot

The standard `security` CLI prompts the user before any restricted
operation. To make boot-time operations non-interactive, we use
`security set-key-partition-list` during bootstrap to seed the
partition list with the binary's code requirement. From that point
on, the binary can read/write/sign without prompts. Bootstrap is the
ONE TIME the user sees prompts (Touch ID for both the keypair
generation and the partition-list seeding). After bootstrap, the
system is fully autonomous.

Confirmed by: Apple Developer documentation on `security
set-key-partition-list` and the `kSecUseAuthenticationUI` flag set
to `kSecUseAuthenticationUIFail`. Final implementation in M1 will
validate this empirically in M1-DERIVED before committing the API.

## 6. Flows

### 6.1 Bootstrap (one-time, user runs interactively — Touch ID happens HERE and only HERE)

**User-facing contract**: this is the ONLY time the user will see a
Touch ID prompt for the secure-restore subsystem. From the moment
bootstrap completes, every subsequent boot — including unattended
overnight reboots when the user is remote — proceeds without any
prompt. The user grants trust once; the system enforces it forever
after (until the user revokes it via Keychain Access.app or
reinstalls).

1. User runs `npm run secure-restore:init` from inside `~/ai-maestro/`.
   This invokes the code-signed bootstrap binary at
   `/opt/aimaestro/bin/ai-maestro-secure-restore-init`.
2. Bootstrap binary first sanity-checks its OWN code signature against
   a known-good hash baked into the binary at build time. If a
   tamperer has replaced the bootstrap binary, this check fails before
   any Keychain operation is attempted.
3. Bootstrap presents the current set of files it will baseline, asks
   the user to confirm each is in a known-good state (or "skip" — but
   skipping a file means restore will refuse to run if that file later
   matters). Shows the SHA-256 of each file so the user can
   cross-check against a known-good source if paranoid.
4. **One Touch ID prompt #1** (or login password if Touch ID
   unavailable): `"AI Maestro wants to create a new key in your
   keychain. Allow?"` — for system-AID keypair generation.
5. **One Touch ID prompt #2**: `"AI Maestro wants to create a new key
   in your keychain. Allow?"` — for baseline-signer keypair generation.
6. **One Touch ID prompt #3**: `"AI Maestro wants to allow these
   applications to use this key without asking: ai-maestro-launcher,
   ai-maestro-keychain-helper, aimaestro-secure-restore"` — this is
   the `set-key-partition-list` operation that grants headless future
   access. Critical: this is the prompt the user MUST approve for the
   system to function unattended.
7. Bootstrap generates and seals everything: keypairs in
   Keychain (with ACLs as defined in §5.3), initial baseline manifest
   (each file → sha256 + size + mtime + perms + owner), entire
   manifest signed by baseline-signer.
8. Installs the LaunchAgent plist (the plist's own SHA-256 is also
   baselined BEFORE the install).
9. Registers the system-AID with the AI Maestro server via the
   existing AID-register API, marking it `role=system-restore` with a
   single capability `wake-from-snapshot`.
10. Prints to the user: a one-page summary of every Keychain item
    created, every file baselined, and how to revoke via Keychain
    Access.app if they ever want to undo this.

**Total user interactions**: 3 biometric prompts (one chained
sequence of ~10 seconds). Zero further prompts for the lifetime of
the install.

### 6.2 Steady state (every 30 seconds while server is up)

`server.mjs` runs a background task `writeRuntimeSnapshot()`:
1. Discover live tmux sessions whose names match agent registry entries.
2. Build `{ capturedAt: ISO, hostId: ..., activeAgents: [...] }`.
3. Sign with baseline-signer key via Keychain.
4. Atomic write to `~/.aimaestro/runtime-snapshot.json` (write to
   `.tmp`, rename).

`server.mjs` also updates the baseline manifest whenever it writes a
file through its own pipelines (e.g. CreateAgent → registry.json
write → automatically updates Keychain hash for registry.json).
**Direct file edits NEVER update the manifest** — that's the trap.

### 6.3 Normal boot (no compromise)

Step A through E execute. All hashes match. All wake calls succeed.
Incident log records `result: PASS, restored=N`.

### 6.4 Hash mismatch boot (real or false alarm)

Restore script:
1. Exits non-zero immediately at first mismatch.
2. Writes `reports/secure-restore/<ts>-incident.md` listing:
   - Which file failed integrity check
   - Expected hash vs actual hash
   - File metadata (mtime, size, owner, perms)
   - SHA-256 of the file's first 256 bytes (for the human to compare)
3. Emits a macOS Notification via `osascript -e 'display notification'`
   with severity "alert."
4. Refuses to wake ANY agent. The blast radius is zero new processes
   spawned.
5. Provides the user with one (1) recovery command:
   `npm run secure-restore:reseal` which interactively re-baselines
   AFTER showing the user a unified diff between the current files
   and the last-known-good snapshot.

### 6.5 Re-baseline (user-approved drift)

When the user legitimately edits a config file outside the server's
pipelines (rare, but happens — e.g. fixing a typo in
`governance.json`):
1. User runs `npm run secure-restore:reseal`.
2. Script shows the diff between current files and stored baseline.
3. User confirms via Touch ID for each changed file.
4. Baseline manifest is updated and re-signed.

### 6.6 Attacker scenarios (how the design defeats each Tn)

| Threat | Why it fails |
|---|---|
| T1-T3 (config edits) | Hash mismatch at STEP B → exit 3, no wake |
| T4 (snapshot edit) | Snapshot signature invalid at STEP C → exit 4 |
| T5 (LaunchAgent plist edit) | Plist is in baseline manifest → STEP B fails |
| T6 (per-persona config injection) | Each persona's `settings.local.json` is in baseline → STEP B fails |
| T7 (restore script edit) | STEP A self-attest fails → exit 2 |
| T8 (`.tmux.conf` injection) | `.tmux.conf` is in baseline → STEP B fails |
| T9 (`.zshrc` injection) | `.zshrc` is in baseline → STEP B fails |

The attacker can ONLY succeed by either (a) compromising the user's
login password to manipulate Keychain, or (b) modifying a file that
is NOT in the baseline manifest. Counter to (b): the bootstrap and
re-baseline flows present the user with the full file list and any
file the user added to the system since last reseal will be flagged
"unknown — add to baseline? [y/N]".

## 7. Implementation milestones

Each milestone is its own commit, validated independently.

| # | Milestone | Files touched | Verification |
|---|---|---|---|
| M1 | Keychain helper library | `lib/secure-enclave.ts` (new) + tests | unit test: roundtrip read/write of a test secret |
| M2 | Runtime-snapshot writer | `lib/runtime-snapshot.ts` (new), `server.mjs` (add periodic task) | Watch `~/.aimaestro/runtime-snapshot.json` get written and signed |
| M3 | Boot-token route | `app/api/internal/wake-by-system-aid/route.ts` (new) | curl against the route with a bad signature → 401; with a good signature → wake fires |
| M4 | Bootstrap script | `scripts/secure-restore-init.sh` (new) + `package.json` script | Run it on a clean test profile, verify Keychain entries appear |
| M5 | Secure restore script | `scripts/aimaestro-secure-restore.sh` (new) | Mock a hash mismatch — confirm exit 3 + incident log + notification |
| M6 | Reseal flow | `scripts/secure-restore-reseal.sh` (new) | Edit a file, run reseal, confirm baseline updates |
| M7 | LaunchAgent plist + installer | `assets/com.emasoft.aimaestro-restore.plist.template` + installer | `launchctl list` shows it loaded; manual reboot of a test VM restores agents |
| M8 | Server-side baseline updates | Hook every file write in `services/element-management-service.ts` and friends to update the baseline | Create an agent → verify Keychain hash updates for registry.json |
| M9 | Documentation + recovery runbook | `docs/SECURE-RESTORE.md` (new) | Reviewed |
| M10 | End-to-end test on a VM | Use a macOS test VM, force unclean shutdown, verify all agents return | Logged session screenshots |

## 8. Open questions (resolve before M1)

1. **Secure Enclave vs login keychain**:
   - ACL-by-CDHash behavior: **CONFIRMED 2026-05-21** by user's Apple
     developer note. macOS Keychain ACLs are tied to the calling
     binary's cryptographic CDHash + Team ID + signing certificate.
     "Always Allow" grants persistent headless access. Tampered binary
     → CDHash changes → access auto-revoked. This is the linchpin of
     §5.3 and it is real, documented, and stable.
   - Secure Enclave storage specifically (`kSecAttrTokenIDSecureEnclave`
     for Ed25519 keys on M-series): the `security` CLI may NOT support
     that flag for non-RSA/EC P-256 algorithms. M1-DERIVED still owes
     us an empirical answer on this; if the CLI is insufficient, we
     call `SecKeyCreateRandomKey` from inside the Swift binaries
     directly (which we're building anyway per §5.1). The Keychain ACL
     mechanism works the same way regardless of which storage tier
     the private key lives in (Secure Enclave hardware vs login
     keychain file).
2. **Touch ID for boot-time signing**: RESOLVED 2026-05-21 per user
   directive — the user explicitly approves headless access for the
   ai-maestro binaries ONCE at install time via the `set-key-partition-list`
   prompt (§6.1 step 6). After that, the code-signed binaries listed in
   the ACL access the Keychain without any prompt, enabling unattended
   reboots from a remote user. M1-DERIVED empirically validates this
   path before M1 commits to the API.
3. **What if Keychain itself is unavailable** (e.g. user hasn't logged
   in yet because they're remote SSH)? Restore should still refuse
   to do anything — better safe than sorry.
4. **How to baseline `.next/` build artifacts**: the build directory
   is regenerated on every `yarn build`. We baseline AFTER each
   successful build by hooking the build script.

## 9. Out of scope (for later TRDDs)

- Network-attached devices (iPad / iPhone) restoring their AID
  similarly.
- Cross-host recovery (one host's snapshot waking agents on a peer
  host).
- Replacing the existing AID protocol entirely (this TRDD extends it
  with a system-restore role, not replaces it).
- Hardware-backed PIN / Touch ID for every UI mutation (different
  TRDD — that's a usability layer).

## 10. Risk and rollback

If M5 ships and turns out to be too strict (hash mismatches blocking
legitimate boots), the rollback is to disable the LaunchAgent:
```
launchctl unload ~/Library/LaunchAgents/com.emasoft.aimaestro-restore.plist
rm ~/Library/LaunchAgents/com.emasoft.aimaestro-restore.plist
```
No data is lost — agents go back to being woken manually as today.
The Keychain entries remain (idempotent if the LaunchAgent is
re-installed later).

## 11. Cross-references

- Threat model is informed by `~/.claude/rules/browser-ui-test-techniques.md`
  (similar defense-in-depth posture) and the discussion in this
  session's chat history starting at the 2026-05-19 unclean reboot.
- AID protocol surface: `lib/aid-token.ts`, `scripts/aid-*.sh`.
- Existing ledger and security primitives: `lib/signed-ledger.ts`,
  `lib/security-config.ts`, `lib/ledger-startup.ts`.
- Janitor heartbeat that picks up after restore: plugin
  `ai-maestro-janitor` v0.5.0.
- Apple Developer Code Signing documentation (referenced by user
  2026-05-21) — confirms ACL-by-CDHash mechanism behind §5.3.

## 12. Cross-platform considerations (research-only — separate TRDDs to implement)

CLAUDE.md scopes AI Maestro to macOS today (`Platform: macOS 12.0+`).
This TRDD's milestones M1–M10 are macOS-only. The user has indicated
that Linux and Windows builds will eventually need equivalent secure
auto-restore subsystems. The notes below are a first-pass map of the
problem space so a future TRDD author has a starting point — they are
NOT an implementation plan and NOT part of M1–M10.

### 12.1 The two properties any platform port MUST preserve

1. **Headless future access**: after a one-time user-interactive
   bootstrap, the boot-time restore runs without any prompt.
2. **Binary-identity-bound access**: a script that's not on the
   allowlist cannot read the secret material, even running as the
   same UID. Knowledge of UID + login credentials is not sufficient.

If either property is missing, the design's security claims do not
hold on that platform and the user should be told so explicitly.

### 12.2 Linux candidate primitives

| Primitive | What it gives us | Caveats |
|---|---|---|
| **TPM 2.0 + `systemd-creds`** | Hardware-backed encryption, key sealed to PCR state, decryptable headless at boot by root systemd unit | Requires TPM2 in hardware (modern x86 + most ARM SBCs); requires systemd; PCR-binding may fragility-fail across kernel upgrades |
| **Linux kernel keyring (`keyutils`)** | Process-bound, session-bound, or user-bound keyrings; kernel-enforced access control | NOT binary-identity-bound by default — needs to be combined with AppArmor/SELinux to pin the calling binary |
| **AppArmor / SELinux policy** | Pins which binary can call into the keyring or systemd-creds; analogous to macOS code signing for ACL purposes | Distro-specific (AppArmor: Ubuntu/Debian/SUSE; SELinux: RHEL/Fedora) — would need both paths |
| **gnome-keyring / KWallet via Secret Service D-Bus** | Familiar to desktop users | Tied to interactive session, often unavailable in headless boot; not binary-identity-bound |
| **IMA/EVM** | Kernel-level file integrity attestation — could replace our SHA-256 baseline manifest with kernel-attested measurements | Requires signed policy at boot, complex setup; would be a powerful upgrade to the integrity layer if we ever do it |

**Likely Linux design sketch**: TPM2-sealed `systemd-creds` for both
private keys and baseline manifest; AppArmor (or SELinux on RHEL
family) profile that allows ONLY specific paths to access the
credential; the boot-time restore lives as a `systemd` unit
(`aimaestro-secure-restore.service`) ordered `After=
ai-maestro.service` (the pm2 equivalent on Linux would be a
systemd unit for the server too).

### 12.3 Windows candidate primitives

| Primitive | What it gives us | Caveats |
|---|---|---|
| **CNG + TPM-backed key (`MS_PLATFORM_CRYPTO_PROVIDER`)** | Hardware-backed Ed25519/ECDSA key storage | Older Windows or non-TPM hardware falls back to software protection |
| **Windows Credential Manager + DPAPI** | Built-in secret storage | DPAPI is bound to USER credentials, NOT binary identity — insufficient by itself |
| **Authenticode signing** | Binary identity (analogue of macOS code signing) | Requires a code-signing certificate; ad-hoc signing is not really a Windows concept the way it is on macOS |
| **WDAC (Windows Defender Application Control)** | OS-enforced policy: only signed binaries with specific publisher/hash may run AND access credentials | The most stringent option; requires Enterprise/Pro |
| **Windows Service** | Headless boot-time execution analogue of macOS LaunchAgent / Linux systemd unit | Service identity (LocalSystem / NetworkService / custom) is its own access control axis |

**Likely Windows design sketch**: Authenticode-signed binaries
(real cert, not ad-hoc); CNG key in TPM via the platform crypto
provider; ACL on the Credential Manager item that pins on the
binary's Authenticode hash (via WDAC); the restore binary registers
as a Windows Service set to start `Automatic (Delayed Start)` so it
fires after the ai-maestro server service.

### 12.4 What ports CAN'T avoid

Even with the cleanest port, both Linux and Windows variants require:

- An equivalent of `set-key-partition-list` — the "user grants
  headless future access" UX step. On Linux this is the user
  approving the systemd-creds enrollment; on Windows it's the
  Authenticode + WDAC policy signing step plus a UAC consent.
- An equivalent of the M5 self-attesting boot driver, written in
  whatever native language fits the platform's signing story (Rust
  / Go on Linux; Rust / C# on Windows). Same logic, different binary.
- An equivalent of the M8 server-side baseline-updates audit — the
  full inventory of code paths that write baselined files. The
  server is the same Node.js codebase, so M8's audit applies as-is.

### 12.5 What this TRDD recommends for the cross-platform future

When a Linux or Windows port becomes a real goal:
1. Author a follow-on TRDD (`secure-auto-restore-linux` or
   `secure-auto-restore-windows`) that picks specific primitives
   from §12.2 / §12.3 and writes platform-specific M1–M10.
2. Reuse the AID protocol design (lib/aid-token.ts) unchanged — it
   is platform-agnostic.
3. Reuse the `lib/runtime-snapshot.ts` writer unchanged — it depends
   only on a `keychain-helper`-shaped subprocess interface, so the
   platform port supplies the helper.
4. Treat the macOS implementation as the reference behavior — the
   Linux/Windows ports must produce the same observable security
   guarantees (§12.1) even if the underlying primitives differ.

## 13. Pending design extensions (captured 2026-05-21 from chat; to be expanded post-M1-DERIVED)

The following design extensions were directed by the user and will be
folded in fully once M1-DERIVED has produced empirical Keychain
behavior data (some design choices below depend on what M1-DERIVED
finds — e.g. whether `security` CLI supports EC keys in Secure
Enclave determines part of the Swift binary surface).

1. **Dual-mode macOS signing**:
   - **Dev mode** (current default): binaries ad-hoc signed (`codesign
     --sign -`). CDHash changes on every rebuild → Keychain
     auto-revokes ACL → user MUST be present to re-authorize after
     every update.
   - **Prod mode** (flag-flipped later): binaries signed with Apple
     Developer ID certificate (Team ID `Z9YT9CK6BL` — user has Xcode
     credentials configured). CDHash still changes per build but
     Team ID + signing cert match → Keychain treats it as legitimate
     update from same developer → no prompt → headless updates.
   - Both code paths MUST be implemented from day 1. The install
     script detects which mode is active and reports accordingly.
   - Update flow §6.7 (TBD) will document both modes side by side.

2. **Concrete Linux design** (per user directive "find the most
   secure solution"): TPM2-sealed `systemd-creds` for private keys
   and baseline manifest; AppArmor profile (Ubuntu/Debian/SUSE) or
   SELinux policy (RHEL/Fedora) pinning the binary identity; the
   boot-time restore as a `systemd` unit with `After=
   ai-maestro.service`. To be detailed in TRDD
   `secure-auto-restore-linux`.

3. **Concrete Windows design** (per user directive): Authenticode-
   signed binaries (self-signed cert in dev → real EV cert in prod),
   CNG keys via `MS_PLATFORM_CRYPTO_PROVIDER` (TPM-backed), ACL on
   Credential Manager item bound to Authenticode hash; Windows
   Service set to `Automatic (Delayed Start)`. To be detailed in
   TRDD `secure-auto-restore-windows`.

4. **Tailscale auto-install on all 3 platforms**:
   - macOS: `brew install --cask tailscale` with fallback to `.pkg`
     installer download. One-time `tailscale up` browser-OAuth.
   - Linux: official `curl -fsSL https://tailscale.com/install.sh |
     sh` (with HTTPS+SHA verification overlay we add). One-time
     `tailscale up` browser-OAuth.
   - Windows: MSI installer download with publisher cert
     verification. One-time `tailscale up` browser-OAuth.
   - Tailscale becomes a HARD precondition for AI Maestro install on
     all platforms (per CLAUDE.md "Tailscale is required for any
     remote access" — extended now to "for any install at all").
   - The Tailscale install step is part of the bootstrap binary,
     runs BEFORE Keychain operations, exits the bootstrap with
     remediation instructions if Tailscale install fails.

Implementation milestones M11 (dual-mode signing) and M12 (Tailscale
auto-install) will be added to §7 after M1-DERIVED empirical results
inform the exact API surface.

## 14. Foolproof signing pipeline (Option C, locked 2026-05-21)

Per user directive 2026-05-21: signing must be **fully automated** and
**verified on every push**. It must be **impossible** to publish a
release that contains unsigned binaries or signed-by-wrong-identity
binaries. The procedure must be foolproof from the developer's
keystroke to the installer script the end user runs.

### 14.1 The four-layer enforcement chain

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 1 — pre-push git hook (.githooks/pre-push)                 │
│                                                                  │
│   - blocks pushes that contain ANY committed binary artefact     │
│     (binaries must be CI-built, never committed to source)       │
│   - blocks modifications to .github/workflows/build-and-sign.yml │
│     unless the workflow's SHA-256 is updated AND the diff is     │
│     reviewed (workflow == trust root for CI signing)             │
│   - branch policy: feature/* pushes are unrestricted; pushes to  │
│     main require ALL Swift sources to exist + workflow integrity │
│   - installed via core.hooksPath = .githooks (project-scoped,    │
│     committed; not user-scoped)                                  │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 2 — GitHub Actions: .github/workflows/build-and-sign.yml   │
│                                                                  │
│   - runs on every push to main, every PR targeting main, every   │
│     release tag                                                  │
│   - imports Developer ID Application cert from CI secret         │
│     (DEVELOPER_ID_CERT_P12_BASE64 + DEVELOPER_ID_CERT_PASSWORD)  │
│   - builds each Swift binary (swift build -c release)            │
│   - signs each binary with the Developer ID cert + entitlements  │
│   - verifies each signature (codesign --verify --deep --strict)  │
│   - asserts TeamIdentifier=P2V8DD7FNW on every binary            │
│   - on push/PR: uploads artifacts for review                     │
│   - on release tag: produces signed tarball, attaches to release │
│   - if ANY step fails, the workflow fails and the merge / release│
│     is blocked                                                   │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 3 — release tarball with manifest                          │
│                                                                  │
│   aimaestro-binaries-vX.Y.Z.tgz                                  │
│       bin/                                                       │
│         ai-maestro-launcher                                      │
│         ai-maestro-keychain-helper                               │
│         aimaestro-secure-restore                                 │
│         ai-maestro-secure-restore-init                           │
│         ai-maestro-secure-restore-reseal                         │
│       MANIFEST.json   (lists every binary's CDHash + Team ID,    │
│                        signed by CI workflow at release time)    │
│                                                                  │
│   Tarball SHA-256 is published in the GitHub release's body and  │
│   available via the GitHub API. The installer cross-checks the   │
│   downloaded tarball's hash against the API response.            │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 4 — installer script (install.sh, run by end user)         │
│                                                                  │
│   Strict order; ANY failure aborts the entire install:           │
│                                                                  │
│   1. Detect platform: macOS → continue; Linux/Windows → route to │
│      platform-specific installer (separate TRDDs)                │
│   2. Resolve release version (env var, CLI arg, or "latest" via  │
│      GitHub Releases API)                                        │
│   3. Download tarball over HTTPS from github.com/Emasoft/        │
│      ai-maestro/releases/download/<version>/aimaestro-           │
│      binaries-<version>.tgz                                      │
│   4. Fetch the published SHA-256 from the GitHub Releases API    │
│      (NOT from the user's downloaded copy — out-of-band)         │
│   5. Compute actual SHA-256 of downloaded tarball; abort if      │
│      mismatch                                                    │
│   6. Extract to a temp dir (never directly to /opt/aimaestro)    │
│   7. For each of the 5 binaries:                                 │
│        codesign --verify --deep --strict <binary>                │
│        codesign --display --verbose=4 <binary> | grep            │
│          TeamIdentifier=P2V8DD7FNW                               │
│      If EITHER fails → abort with explicit error + cleanup       │
│   8. Cross-check binary CDHashes against MANIFEST.json (also     │
│      verifies the manifest itself wasn't tampered)               │
│   9. ONLY NOW move binaries into /opt/aimaestro/bin (atomic)     │
│  10. Hand off to ai-maestro-secure-restore-init for bootstrap    │
└──────────────────────────────────────────────────────────────────┘
```

### 14.2 Branch policy — enforced by GitHub branch protection AND the pre-push hook

| Branch | Push policy | CI behavior | Release-eligible |
|---|---|---|---|
| `main` | Protected — only via PR + review + green CI | Builds + signs + verifies; blocks merge on any failure | No (only tags create releases) |
| `release/v*` | Same as main + maintainer-only | Same as main + auto-creates release candidate | Yes (release-candidate tags) |
| `feature/*` | Anyone — no signing checks (dev velocity) | Builds + verifies sources compile, but does NOT release | No |
| Tags `v*.*.*` | Only via release branch | Triggers release workflow: build + sign + tarball + publish | Yes |

GitHub branch-protection rules (config-as-code via `.github/branch-
protection.yml` or equivalent):
- Require PR review (1+ approver)
- Require status check `build-and-sign / sign-and-verify` to pass
- Forbid force-pushes
- Forbid deletion
- Require linear history (no merge commits sneaking in unsigned
  changes)

### 14.3 Secrets that must exist in the CI environment

| Secret | What | Stored as |
|---|---|---|
| `DEVELOPER_ID_CERT_P12_BASE64` | Developer ID Application cert + private key, .p12 file, base64-encoded | GitHub Actions repository secret |
| `DEVELOPER_ID_CERT_PASSWORD` | Password to unlock the .p12 | GitHub Actions repository secret |
| `APPLE_ID` (for notarization, if needed) | The user's Apple ID email | GitHub Actions repository secret |
| `APPLE_ID_APP_PASSWORD` (for notarization, if needed) | App-specific password | GitHub Actions repository secret |

Setup is a one-time activity documented in `docs/SIGNING-SETUP.md`
(produced by M14). The .p12 is exported from the user's local
Keychain Access.app with the private key included, then base64-
encoded for the GitHub Actions secret input. The Developer ID cert
expires every 5 years; renewal is documented in M9 runbook.

### 14.4 Why pushing a binary breaks the chain (and how the hook catches it)

If a developer (legitimate or compromised) tries to commit a
pre-built binary:

```
$ codesign --sign - bin/keychain-helper   # ad-hoc sign locally for testing
$ git add bin/keychain-helper
$ git commit -m "fix something"
$ git push                                  # pre-push hook runs
ERROR: compiled binaries detected in push.
       bin/keychain-helper is a Mach-O binary, not a source file.
       Binaries are produced by CI, never committed.
       To remove: git rm --cached bin/keychain-helper
push aborted.
```

The hook scans the entire push diff with `file(1)` for Mach-O magic
bytes. No exceptions — even an ad-hoc-signed test binary would block
the push.

For developer convenience: a `make local-build` target produces
ad-hoc-signed binaries in `.local/bin/` (gitignored), where they can
be tested without ever being eligible for commit.

### 14.5 Why an attacker who compromises the workflow can't release evil binaries

Attacker tries to push a modified `.github/workflows/build-and-sign.yml`
that signs a malicious binary as the trusted Team ID:

```
$ vim .github/workflows/build-and-sign.yml   # inject evil step
$ git add .github/workflows/build-and-sign.yml
$ git commit -m "ci tweak"
$ git push
ERROR: build-and-sign workflow has been modified.
       Expected SHA-256: a1b2c3...
       Actual SHA-256:   ff44dd...
       This is a security-critical file.
       If the change is legitimate, run:
         shasum -a 256 .github/workflows/build-and-sign.yml > \
           .github/workflows/build-and-sign.sha256
       AND get an explicit review of the workflow change.
push aborted.
```

The hook stores the workflow's expected SHA-256 in a sibling
`build-and-sign.sha256` file. Both files must change in lockstep,
and the diff is reviewed at PR time. This is defense-in-depth in
case branch protection rules are bypassed.

### 14.6 Why a user can never accidentally install an unsigned binary

The installer script:
- Refuses to install if `codesign --verify` returns non-zero on ANY
  binary
- Refuses to install if `TeamIdentifier` is not exactly
  `P2V8DD7FNW`
- Refuses to install if the MANIFEST.json's listed CDHashes don't
  match the actual binaries
- Cleans up the temp extract dir on any failure (no half-installed
  state)
- Exits with a clear, actionable error message naming which binary
  failed which check

A developer who forgot to sign locally → CI fails → no release tag
gets created → no tarball ever exists. The installer literally
cannot find an unsigned release to install.

### 14.7 Dev velocity is preserved

For local iteration, developers use `make local-build` which:
- Compiles all Swift sources with `swift build`
- Ad-hoc-signs the binaries (`codesign --sign -`)
- Places them in `.local/bin/` (gitignored)
- The local LaunchAgent (installed by `make local-install`) points
  at `.local/bin/`, not `/opt/aimaestro/bin/`
- A separate test fixture stamps the Keychain partition list to
  trust the local ad-hoc CDHash, with a CLEAR WARNING that this is
  dev-only and security guarantees are WEAKER

The dev and prod paths never cross. The only way a binary gets into
`/opt/aimaestro/bin/` is via the installer (Layer 4), and the only
way the installer accepts a binary is if Layer 2's CI workflow
produced it with the right Team ID.
