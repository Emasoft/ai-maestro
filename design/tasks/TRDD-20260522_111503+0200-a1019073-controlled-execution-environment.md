---
trdd-id: a1019073-a2b8-4dda-9ba0-e668a77b9ccc
title: Controlled execution environment for AI Maestro agents — UID separation, host sandboxing, supply-chain controls
status: not-started
created: 2026-05-22T11:15:03+0200
updated: 2026-05-22T23:17:43+0200
---

# TRDD-a1019073 — Controlled execution environment for AI Maestro agents

**Filename:** `design/tasks/TRDD-20260522_111503+0200-a1019073-controlled-execution-environment.md`
**Tracked in:** this repo (`design/tasks/` is git-tracked)

> **Scope note (read first):** this is **future work**, deliberately NOT the
> current PR. The current PR ships only the *functional* auto-restart of the
> AI Maestro server + its agents after a reboot (no security hardening) — see
> the separate implementation task and the interim bridge in §11. This TRDD
> captures the security architecture that the keychain approach (TRDD-d77a7d6e,
> now superseded) was reaching for, re-grounded on what the 2026-05-21/22
> empirical tests actually proved is possible.

## 1. Why this TRDD exists (history)

TRDD-d77a7d6e set out to make agent auto-restore *secure* by storing AID
keys + config/binary integrity baselines in the macOS Keychain (Secure
Enclave where available), verifying integrity before every boot, and
exiting on any mismatch. The user's directive was absolute: *"do not ask,
just ALWAYS CHOOSE THE MOST SECURE AND HARDENED OPTION. Security is the
most important feature of ai-maestro."* and *"assume a malicious actor
already injected a script in the dotfiles."*

Before implementing, we ran four empirical test cycles (the user
explicitly approved the Touch ID prompts and renewed their Apple developer
profile so the strongest signing path could be tried). The cycles
**disproved the keychain pillar**. The negative result is the single most
important input to this TRDD, so it is recorded inline below (the raw
reports live under `reports/secure-restore/` which is gitignored, so they
are NOT in git — this section is the durable record).

A second, equally important input arrived in the 2026-05-22 design
discussion: the realization that **the world-shared `/tmp` directory and
the human-user-owned toolchain are poisoning seams that bridge straight
under the UID wall** (§2.3, §3). These reshaped the architecture from
"separate UID" into "separate UID **with a dedicated, immutable toolchain
and no shared temp**."

## 2. Empirical findings (the proof that reshaped the design)

Hardware: Apple M4 Pro, macOS 24.6.0 (Sequoia). Signing cert: Developer ID
Application (Team P2V8DD7FNW). All test keys cleaned up + verified absent.

| ID | Finding | Verdict |
|----|---------|---------|
| F1 | ad-hoc (`codesign -s -`) CDHash is stable across rebuilds | ✓ |
| F2 | `add-generic-password -T` auto-trusts the `security` CLI | broken-by-default |
| F3 | strict ACL still doesn't block the `security` CLI (generic-pw path) | broken |
| F4 | ad-hoc binary cannot use Secure Enclave | confirmed |
| F5 | Developer ID signing is not scriptable (Touch ID gate) | confirmed |
| F6 | unavoidable dev-vs-prod security delta | confirmed |
| F7 | partition list NOT enforced on EC keys for same-UID caller | broken |
| F8 | `codesign --verify --deep --strict` catches binary tamper | ✓ WORKS |
| F9 | `file(1)` Mach-O detection works for the integrity walk | ✓ WORKS |
| F10 | helper-binary architecture: ANY same-UID process can invoke the helper | broken (proxy-use) |
| F11 | `set-key-partition-list` needs the login password (headless-hostile) | confirmed |
| F12 | this Mac has FileVault ON + auto-login OFF | confirmed — and it's a *feature* |
| F16 | Developer ID signing works with user approval | ✓ |
| F17 | Developer-ID-signed key NOT protected from ad-hoc attacker | **broken (DESIGN-BREAKING)** |
| F18b | explicit restrictive `SecAccessCreate` (only-creator trusted-app list) NOT enforced | broken |
| F19 | Secure Enclave needs `com.apple.application-identifier` entitlement → needs a provisioning profile a plain Developer-ID CLI binary can't have | confirmed |

### 2.1 The two decisive conclusions

**(a) macOS login-keychain ACLs do not protect a key from a same-UID
process.** macOS treats "code running as you" as "you." The post-10.12
partition list gates only `apple-tool:`-style cross-tool access, not
arbitrary same-UID binaries. There is NO login-keychain configuration —
not partition lists (F7), not `SecAccessCreate` restrictive trusted-app
lists (F18b), not Developer-ID-signed key creators (F17) — that stops a
user-UID attacker from *using* a stored key. The data-protection
(iOS-style) keychain WOULD enforce, but it needs `keychain-access-groups`
+ `application-identifier` entitlements, i.e. a real App ID + provisioning
profile — unavailable to a plain CLI binary (F19).

**(b) Even a fully-working Secure Enclave would not secure our use case.**
SE protects against key *extraction*. Our threat is *proxy-use*: a
malicious dotfile script invokes our own legitimate, SE-entitled helper
binary, the enclave signs (the caller is authorized), and the attacker
captures stdout (F10). SE never leaks the key, but the attack succeeds.
The only SE config that stops proxy-use is `.userPresence` /
`.biometryCurrentSet` (Touch ID per signature) — which kills headless
boot, the whole point of auto-restore.

### 2.2 The unbreakable tension (true on every platform, not just macOS)

> **Headless** = signatures produced with NO human gate ⇒ a malicious
> same-UID process can elicit the same signatures.
> **Secure** (against a same-UID attacker) = a human gate per sensitive op
> ⇒ by definition NOT headless.

No keychain, enclave, or signing scheme dissolves this within a single UID.
The symmetry is only broken by *changing the UID* (kernel-enforced file
permissions between distinct users) or by a *human/hardware presence gate*
(not headless). This is the pivot that produced the architecture below.

### 2.3 The 2026-05-22 filesystem-seam findings (new — the second pivot)

These were verified live on the dev Mac during the design discussion. They
are the proof that "separate UID" alone is NOT sufficient — two paths
bridge straight under the UID wall.

| ID | Finding | Verdict |
|----|---------|---------|
| F20 | `/tmp` → `/private/tmp` is `drwxrwxrwt root wheel` — **world-writable** (sticky bit), shared by every UID on the host | ✓ VERIFIED — shared seam |
| F21 | macOS per-user `$TMPDIR` (`/var/folders/<xx>/…/T`) is `drwx------ <user>` — mode 700, per-UID isolated. Yet the directory-guard hook **allows** the world-writable `/tmp` and **blocks** the per-UID `/var/folders` — exactly backwards | ✓ VERIFIED — allowlist inverted |
| F22 | the agent toolchain (`git`, `node`, `python3`, `uv`, `yarn`) resolves under `/opt/homebrew/Cellar/…`; `/opt/homebrew/bin` is `drwxrwxr-x <user>:admin` — **writable by the human UID** | ✓ VERIFIED — toolchain poisonable |
| F23 | the `claude` binary itself resolves under `~/.local/share/claude/versions/…` — inside the **human user's home** (human-owned, human-writable) | ✓ VERIFIED — the AI client binary is itself a poisoning target |

#### 2.3.1 What F20–F23 prove

1. **`/tmp` is a TOCTOU / supply-chain injection seam.** It is the one
   location both the human UID (and any other non-root UID, and any
   user-space malware) and the future `aimaestro` UID can write. An
   attacker monitoring `/tmp` can inject code into anything an agent stages
   there (a cloned repo, an unpacked installer) in the window between
   creation and use. The poisoned artifact then flows **back into** the
   AI Maestro trust boundary — e.g. the agent pushes the cloned plugin to
   GitHub, it auto-updates, and it runs as a **user-scope** plugin across
   *every* agent. The UID wall is never breached; `/tmp` tunnels under it.
2. **The toolchain is a fatter seam than `/tmp`.** Even with `/tmp` closed,
   the agent still *executes* `git`, `node`, `claude` from human-writable
   prefixes (F22, F23). User-space malware that owns `/opt/homebrew/Cellar`
   or `~/.local/share/claude` can overwrite those binaries directly; the
   next `git push` or `claude` invocation runs attacker code in the agent
   context. **A separate UID that still borrows the human's Homebrew /
   `~/.local` toolchain is isolation theatre.**
3. **The directory-guard allowlist is inverted (F21).** It permits the
   dangerous world-writable path and forbids the safe per-UID one. Under the
   isolated model this must flip: forbid `/tmp`, redirect temp into the
   ai-maestro space.

## 3. Threat-model evolution

The original threat ("a script injected into the user's dotfiles poisons
the restore") was real but turned out to be the *narrow* case of a much
larger, more probable threat that this project uniquely creates:

**AI Maestro runs N autonomous coding agents that install arbitrary
dependencies (npm / pip / cargo / gems / apt) while working on real
projects.** Every one of those installs is an unvetted supply-chain
ingestion point running with full user privileges. Over a long unattended
batch, the probability that *some* agent pulls a compromised transitive
dependency and executes its install hook is not negligible — it is the
dominant risk. A poisoned dotfile is just one delivery mechanism; a
poisoned `postinstall` script is a far more likely one, and it runs the
moment the agent types `npm install`.

The user framed the key insight precisely:

> *"the user's home dir is an ocean of things coming from every direction…
> too big for controlling it all. … it is not that the problem disappears,
> but the job is at least easier since it is a controlled environment. we
> can block writings outside of the agent folder, we can install plugins
> only after remote security scans, we can monitor those processes, we can
> scan every dependency…"*

This is the **tractability thesis**: we cannot harden the user's entire
home directory (unbounded, shared with everything the human does), but we
CAN define a *bounded, controlled environment* for agents where the attack
surface is small enough to actually defend — confine writes, gate installs
behind scans, monitor every process, and keep an append-only ledger of
what happened. The goal is not "make compromise impossible" (unachievable)
but "make the controlled environment small enough that defense is
tractable, and detection reliable."

### 3.1 The enclosure principle (the user's 2026-05-22 refinement)

> *"The only way the ai-maestro user space makes sense is if we NEVER let
> the agents reading or writing from outside of it. So a temp folder inside
> the user space of ai-maestro is acceptable, but not one outside."*

Taken literally, "never read anything outside" is impossible — the agent
must read the dynamic linker, CA certs, `/bin/sh`, and its toolchain to
function at all. So the principle is scoped to the **threat = human-UID-
mutable + world-shared-mutable content**, and stated in enforceable form:

> **An agent's read / write / execute surface for any MUTABLE,
> non-root-owned content MUST be confined to the ai-maestro space (the
> `aimaestro` UID's home + the agent's own workdir + a temp folder INSIDE
> that space). The only things an agent may touch outside that space are
> root-owned, OS-protected, immutable files (the dynamic linker, system
> libraries, SIP-protected `/usr/bin`, CA roots) — because user-space
> malware cannot poison those either.**

Corollary: every binary the agent **executes** must be root-owned or
`aimaestro`-owned (the dedicated toolchain, §4.1.1), never a human-writable
Homebrew / `~/.local` / Scoop binary. And every temp file the agent writes
lands inside the ai-maestro space, never in world-shared `/tmp`.

## 4. Architecture

Four layers, foundation-first. Each layer is independently useful; later
layers assume earlier ones.

### 4.1 Foundation — Unix UID separation (the load-bearing decision)

Run agents under a **dedicated, unprivileged service user** (`aimaestro`,
or one service user per agent for stronger isolation) that is **distinct
from the human's login UID**. This is the ONLY mechanism the empirical
tests proved actually enforces a boundary on macOS without a human gate:
cross-UID file permissions are kernel-enforced; same-UID keychain/ACL
boundaries are not (§2.1a).

Consequences:

- The human's dotfiles, SSH keys, browser cookies, and `~/.aimaestro`
  secrets live under the human UID and are **unreadable** by the agent UID
  (mode-gated by the kernel). A dotfile-injection payload that lands in the
  *human's* dotfiles never executes in the agent context; one that lands in
  the *agent's* dotfiles is confined to the agent sandbox.
- AID keys, integrity baselines, and the ledger live under the
  `aimaestro` UID, `0700`, owned by `aimaestro:aimaestro`. The human UID
  (and therefore a human-side compromise) cannot read or forge them. This
  achieves what the keychain could not.
- The AI Maestro **server** runs as `aimaestro`; the **human** drives it
  only through the authenticated HTTP UI (already the model — see CLAUDE.md
  network section). No shared-filesystem trust between human and agents.
- **The human's home must NOT be readable by the `aimaestro` UID.** macOS
  home dirs are often mode `755`, so by default the agent UID *could* read
  the human's tree (and ingest poisoned content per §3.1). Provisioning
  must tighten the human home (or, more robustly, run the agent in a sandbox
  / container that simply does not mount it).

#### 4.1.1 Dedicated immutable toolchain (promoted from corollary to requirement after F22/F23)

Every binary the `aimaestro` user *executes* (node, tmux, claude, codex,
git, package managers, uv, yarn) MUST be owned by `root` or `aimaestro` and
**not writable by the human UID** — otherwise the human-side attacker swaps
an executable out from under the service user and re-crosses the boundary
(F22: Homebrew prefix is human-writable; F23: the `claude` binary lives in
the human home). This implies AI Maestro's runtime toolchain is **installed
separately** into a service-owned prefix (`/opt/aimaestro/toolchain/…` or a
container image layer) that the agent UID uses, with the agent environment's
`PATH` pointing **only** at it. Mixing in human-owned `~/.local/bin` /
`/opt/homebrew/bin` reopens the hole. The "claude installed inside the
ai-maestro space" the user has referred to is exactly this: a dedicated,
non-human-writable `claude` — it does not exist yet (today there is one
`claude`, in the human home, F23) and is a deliverable of this TRDD.

### 4.2 Host sandboxing (write confinement + temp redirect + egress control)

On top of UID separation, confine each agent further:

- **Write confinement** — an agent may write ONLY inside its own
  `~agents/<name>/` workdir (already a governance invariant, R-series) plus
  a temp folder **inside the ai-maestro space** (NOT world `/tmp`). Enforced
  at the OS layer, not just by prompt instructions:
  - **Linux**: AppArmor / seccomp profile per agent process; bind-mount the
    workdir rw, everything else ro or invisible. GPU passthrough WORKS on
    Linux (§5), so full sandboxing + GPU is achievable.
  - **macOS**: `sandbox-exec` profiles (deprecated but functional) or the
    App Sandbox; fine-grained per-path confinement is *awkward* on macOS and
    less expressive than AppArmor. UID separation carries most of the weight
    here; host write-confinement is best-effort.
- **Temp redirect (closes F20/F21)** — forbid all writes to world-shared
  `/tmp` + `/private/tmp` + `/var/tmp`; set `TMPDIR`/`TMP`/`TEMP` in the
  agent session env (the same `tmux new-session -e` mechanism that injects
  `AGENT_WORK_DIR`) to a folder inside the ai-maestro space
  (`<workdir>/.aimaestro-tmp/`, gitignored, for self-containment/portability,
  or a shared `~aimaestro/.aimaestro/tmp/`). The **janitor** purges it on a
  TTL / low-disk trigger (it already does this for `reports/screenshots/`
  and `.trashcan/`). A `PreToolUse` block alone is insufficient — a tool that
  hardcodes `/tmp` ignoring `TMPDIR` slips the heuristic — so the *real*
  enforcement is an OS-level **private `/tmp`** for the agent UID (Linux
  `PrivateTmp=true` / mount namespace; macOS `sandbox-exec` deny + per-UID
  `/var/folders`; Windows per-account `%TEMP%`, already isolated).
- **Egress filtering** — agents reach the network only through an allowlist
  (package registries, the model API, Tailscale peers). Blocks a poisoned
  dependency from phoning home / exfiltrating. Implementable via a per-UID
  pf/iptables/WFP rule set or an egress proxy the agent UID is forced through.

### 4.3 Supply-chain controls (the scan / confine / vet / monitor / ledger pipeline)

This is the layer that directly addresses the dominant threat (§3):

1. **Scan every dependency before install** — intercept the agent's package
   manager invocations; submit the resolved dependency set to a remote
   security scan (advisory DB + known-malicious-package list + install-hook
   heuristics) BEFORE allowing the install. Block on a hit.
2. **Confine the install** — installs run inside the sandbox (§4.2), so even
   a malicious `postinstall` hook can only write the agent workdir + the
   in-space temp and cannot read human secrets or escape the agent UID.
3. **Vet plugins / MCP servers** — install plugins only after a remote scan
   (mirrors the existing CPV validation gate; extend it to a security pass).
   Combined with §4.2 write-confinement, this closes the "clone in `/tmp` →
   poison → push back → user-scope plugin update → all agents" round-trip:
   the clone can only land inside the ai-maestro space (un-poisonable by the
   human UID), and the install gate scans before any enable. (AI Maestro
   also NEVER auto-installs at user scope — only the human via the Settings
   page can — which already narrows this vector.)
4. **Monitor processes** — a per-agent process monitor records the process
   tree, syscall-level anomalies (Linux), unexpected network attempts, and
   writes outside the workdir. Feeds the ledger.
5. **Append-only signed ledger** — every install, every plugin enable,
   every cross-boundary attempt is appended to a tamper-evident ledger.
   **Note: a signed ledger already exists** at `lib/signed-ledger.ts` — this
   layer extends it, it does NOT build a new one. (Verified present per the
   "investigate before changing" rule; do not re-implement.)

Detection over prevention is the honest stance: layers 1-4 raise the bar
and shrink the window; the ledger makes whatever does slip through
*auditable and attributable* rather than silent.

### 4.4 Containers — OPTIONAL, and only for non-GPU agents

Containers (Docker, per the existing design notes in
`docs_dev/2026-04-20-agent-execution-containers.md`, Model A bind-mount)
give the strongest isolation for agents that need NO GPU. But:

**GPU constraint (decisive):** Docker on macOS runs inside a Linux VM and
has **no GPU passthrough** — Metal/CoreML/MPS workloads are invisible to a
mac container. Any agent that must touch the GPU (local model inference,
ML project work, Metal builds) **cannot** run in a mac container and MUST
run host-side. Host-side execution is exactly where §4.1 UID separation is
the boundary. On Linux, GPU passthrough to containers works (nvidia
runtime), so Linux can use containers + GPU together.

Therefore containers are a *per-agent optional reinforcement*, not the
foundation:
- Non-GPU agent on any host → may run in a container for extra isolation.
- GPU agent on macOS → runs host-side under the `aimaestro` UID + sandbox.
- Any agent on Linux → container with GPU runtime is the strong default.

Because GPU agents force host-side execution anyway, **UID separation is
required regardless of whether containers are adopted** — which is why §4.1
is the foundation and §4.4 is optional.

## 5. Attack-vector × OS-defence matrix (the core security table)

Every row is an attack point (a folder, an event, or a capability); the
three columns are the per-OS defence. This is the canonical reference for
implementers — every milestone in §8 maps to one or more rows here.

| # | Attack point / vector | macOS defence | Linux defence | Windows defence |
|---|-----------------------|---------------|---------------|-----------------|
| A1 | **World-shared temp (`/tmp`) poisoning** — attacker injects into clones / unpacked installers an agent stages in `/tmp` (F20) | Forbid `/tmp`+`/private/tmp` writes; redirect `TMPDIR` → `<workdir>/.aimaestro-tmp/`; `sandbox-exec` deny `/tmp`; per-UID `/var/folders` is the safe fallback (F21) | `PrivateTmp=true` (systemd) or mount-namespace private `/tmp`; redirect `TMPDIR`; AppArmor deny world-temp | Largely absent by default — `%TEMP%` is per-account `%LOCALAPPDATA%\Temp`, ACL-isolated; still redirect temp into the `aimaestro` account profile; restrict `C:\Windows\Temp` |
| A2 | **Toolchain poisoning** — human-writable `git`/`node`/`claude` overwritten, then exec'd by the agent (F22, F23) | Dedicated toolchain in `/opt/aimaestro/toolchain` owned `root`/`aimaestro`, `PATH` points only there; NEVER exec `/opt/homebrew` or `~/.local` | Service-owned prefix or read-only bind-mounted toolchain in the container image; `PATH` scoped to it | Machine-wide install (`Program Files`, admin-only) or a dedicated-account toolchain; never per-user Scoop / `%APPDATA%\npm` |
| A3 | **Agent reads poisoned human-space content and acts on it** (§3.1) | Distinct `aimaestro` UID; tighten/strip read on the human home; `sandbox-exec` deny reads of human paths | Distinct UID + mount namespace; do NOT bind-mount the human home; AppArmor deny | NTFS ACLs deny the `aimaestro` account read on the human profile; under WSL2 do NOT mount `/mnt/c` |
| A4 | **Write escape / cross-agent contamination** — agent writes outside its workdir | `directory-guard.cjs` hook (defence-in-depth) + UID file perms + `sandbox-exec` path confinement (best-effort) | AppArmor/seccomp: bind-mount workdir rw, everything else ro/invisible; UID perms | NTFS ACLs (workdir writable, rest read-only for the account); container FS layer |
| A5 | **Dotfile-injection in the human space firing in agent context** (the original threat) | Distinct UID — human dotfiles never sourced in the agent shell; agent has its own `0700` dotfiles | Same — distinct UID, agent-owned rc files | Separate account profile; the agent account's own startup scripts only |
| A6 | **Same-UID key/secret use** (AID keys, ledger) — the keychain-disproven vector (F7/F17/F18b) | Keys under `aimaestro` UID `0700`, kernel-enforced (keychain ACL does NOT work same-UID) | Keys under `aimaestro` UID `0700` | DPAPI scoped per-account + NTFS ACL `aimaestro`-only |
| A7 | **Malicious dependency `postinstall` hook** (npm/pip/cargo supply chain — the dominant threat, §3) | Remote dependency scan gate BEFORE install + install runs in the sandbox (writes confined) + egress allowlist | Same + seccomp + nftables egress | Same scan gate + run install in a container / WSL2 + Windows Firewall egress allowlist |
| A8 | **Network exfiltration / phone-home by poisoned code** | `pf` per-UID egress allowlist or forced egress proxy | nftables/iptables per-UID `owner` match; egress proxy | Windows Firewall / WFP per-account rules; egress proxy |
| A9 | **Poisoned plugin pushed back to GitHub → user-scope update → all agents** (the round-trip, §2.3.1) | Clone confined to ai-maestro space (un-poisonable by human UID) + CPV security-scan gate before enable + no user-scope auto-install | Same logic; enforcement = container write-confinement + scan gate | Same logic; enforcement = ACL/container write-confinement + scan gate |
| A10 | **Unattended-reboot payload deployment** — attacker triggers a reboot to auto-deploy at boot | FileVault ON + auto-login OFF (F12) halts boot at the unlock prompt | LUKS full-disk encryption, no auto-unlock (or TPM-sealed with measured boot) | BitLocker, no auto-unlock (or TPM + PIN) |
| A11 | **Tamper of AI-Maestro-shipped native binaries** | `codesign --verify --deep --strict` at install (F8 — proven) | Detached signature verify (minisign / cosign / GPG) at install | Authenticode signature verify + WDAC allow-policy |

Reading the matrix: A1–A2 are the seams F20–F23 exposed (the second pivot);
A3–A6 are the UID-separation core; A7–A9 are the supply-chain pipeline (§4.3);
A10–A11 are the boot/integrity perimeter (§7).

## 6. Platform split (enforcement-backend summary)

| Concern | Linux | macOS | Windows |
|---------|-------|-------|---------|
| UID / account separation (kernel-enforced perms) | solid (UID) | solid (UID) | solid (account SID + NTFS ACL) |
| Fine-grained write confinement | AppArmor/seccomp — expressive | `sandbox-exec`/App Sandbox — awkward, best-effort | NTFS ACLs; container FS layer; WSL2 |
| Private temp (closes A1) | `PrivateTmp=true` / mount namespace | `sandbox-exec` deny + per-UID `/var/folders` | per-account `%TEMP%` already isolated (best of the three by default) |
| Dedicated immutable toolchain (closes A2) | service prefix or RO bind-mount in image | `/opt/aimaestro/toolchain`, `PATH`-scoped | machine-wide `Program Files` or account-owned prefix |
| Egress filtering | iptables/nftables per-uid | pf per-uid / egress proxy | Windows Firewall / WFP per-account |
| GPU + sandbox together | YES (nvidia container runtime, or host + seccomp) | host-side ONLY (no container GPU); rely on UID sep | WSL2 has GPU passthrough (WSLg/CUDA); Windows containers GPU is limited |
| Strong-isolation backend | container (nvidia runtime) | host UID + `sandbox-exec` (no container GPU) | **WSL2 (reuse the Linux model verbatim)** or Windows Container |
| Secret custody | keys under UID `0700` | keys under UID `0700` (SE unavailable to CLI binary, F19) | DPAPI per-account + NTFS ACL |

**Windows note (brought in scope 2026-05-22):** Windows is *easier* on the
biggest seam — there is no world-writable `/tmp` equivalent; `%TEMP%` is
per-account and ACL-isolated (A1 mostly free). It is *identical* on the
toolchain seam — per-user installs (Scoop, `winget --scope user`,
`%APPDATA%\npm`, per-user Git/Node/Claude) are human-writable and poisonable
exactly like Homebrew (A2). The cleanest Windows backend is **WSL2**: run
the agents inside a Linux VM and reuse the entire Linux model (namespaces,
private `/tmp`, dedicated toolchain, separate UID), keeping the Windows host
filesystem isolated by **not** exposing `/mnt/c` (disable drive automount).
The lightweight backend is a **separate local account + NTFS ACLs**.
**Windows Sandbox** is ephemeral (resets on close) → unsuitable for
persistent agents; mentioned only to reject it.

## 7. What the empirical work already proved WORKS (reuse, don't rebuild)

- **`codesign --verify --deep --strict` reliably detects binary tamper
  (F8).** Keep the code-signed-binary install pipeline for any NATIVE
  binaries we ship: the installer verifies the binary it lays down is the
  one we built. Scope it to "verify install integrity," NOT "protect
  secrets" (the keychain framing that failed). (Matrix row A11.)
- **FileVault ON + auto-login OFF (F12) already blocks unattended-reboot
  payload deployment for free** — a dotfile attacker cannot trigger a
  reboot to auto-deploy, because boot stops at the FileVault prompt. This
  also means *fully*-headless auto-restore on this Mac requires SOMETHING to
  unlock FileVault first (auto-login, stored recovery key, or remote
  unlock) — a tradeoff the auto-restart task must surface honestly. (Matrix
  row A10.)
- **Tailscale** is the network boundary and is already deployed (A8).
- **The directory-guard hook works and is already position-agnostic** — it
  confines to whatever `AGENT_WORK_DIR` points at, not a hardcoded
  `~/agents/`. It just needs (a) its allowlist flipped (forbid `/tmp`, A1)
  and (b) a registry-backed fallback anchor so it survives a tmux-continuum
  restore (see §11.2). It lives in the **`Emasoft/ai-maestro-plugin`** repo,
  so that change is a cross-repo issue/PR, not an edit in this repo.

## 8. Consequence: file import/export must go through the server (HTTP)

UID separation breaks the implicit "the agent and the human share a
filesystem" assumption. The human cannot simply drop a file into an agent's
workdir (different UID, kernel-blocked), and the agent cannot write into the
human's tree. **All file movement between the human and an agent must go
through the authenticated AI Maestro server over HTTP** (upload/download
endpoints the server, running as `aimaestro`, mediates). This is a feature,
not a bug — it makes every file crossing the boundary an auditable,
ledgerable event — but it is a real UX/architecture change the
implementation must account for (drag-drop into an agent, exporting an
agent's output, etc. all become server-mediated transfers). It also dovetails
with TRDD-1ee4a3c1 (portable self-contained agents): the per-workdir
`.aimaestro/` mirror + server-mediated transfer are the same import/export
pipeline viewed from two angles.

## 9. Milestones (future — not scheduled)

- M-A: Service-user provisioning in the installer (`aimaestro` UID, `0700`
  secret/ledger dirs, tighten human-home read perms). (A3, A5, A6)
- M-A2: **Dedicated immutable toolchain** — install node/git/claude/codex/uv
  into `/opt/aimaestro/toolchain` (root/`aimaestro`-owned), wire the agent
  `PATH` to it only. (A2)
- M-B: Server-mediated file import/export endpoints (replaces shared-FS
  assumption, §8).
- M-C: Linux host sandbox profiles (AppArmor/seccomp + private `/tmp` +
  egress allowlist). (A1, A4, A7, A8)
- M-D: macOS host sandbox (`sandbox-exec` best-effort + `/tmp` deny + temp
  redirect + egress proxy). (A1, A4, A8)
- M-D2: **Temp redirect + janitor purge** — `TMPDIR` → in-space temp, forbid
  world `/tmp`, register a janitor purge detector for the in-space temp. (A1)
- M-E: Dependency-scan interceptor for package managers (§4.3.1-2). (A7)
- M-F: Plugin/MCP security-scan gate (extends CPV, §4.3.3). (A9)
- M-G: Per-agent process monitor → existing `lib/signed-ledger.ts`
  (§4.3.4-5). (A7, A8)
- M-H: Optional container runner for non-GPU agents (Linux GPU-runtime
  default; mac non-GPU optional; Windows = WSL2 / Windows Container) — builds
  on `docs_dev/2026-04-20-agent-execution-containers.md` Model A. (A4)
- M-I: **Windows backend** — separate account + NTFS ACLs as the lightweight
  path; WSL2 (no `/mnt/c`) as the strong path. (A1–A11, Windows column)

## 10. Cross-repo derived tasks (this design spans 3 repos)

- **`ai-maestro` (this repo):** UID-aware wake/env (`TMPDIR` injection, A1);
  service-toolchain `PATH` wiring (A2); server-mediated import/export (§8);
  the interim `validateCwd` bridge (§11.1) and its lockstep tightening when
  isolation lands.
- **`Emasoft/ai-maestro-plugin`:** `directory-guard.cjs` — flip the allowlist
  (forbid `/tmp`, A1) and add a registry-backed fallback anchor so the guard
  survives a tmux-continuum restore (§11.2). File as an issue/PR there; do
  NOT edit the plugin from this repo (cross-project rule).
- **`ai-maestro-janitor`:** purge detector for the in-space temp folder (A1,
  M-D2).

## 11. Interim bridge (current PR) and its hard coupling to this TRDD

The current-version work needs external-workdir agents (e.g. imported
projects under `~/Code/…`) to be wakeable BEFORE the full isolation lands.
That interim bridge is implemented in `ai-maestro` and is **explicitly NOT a
security boundary**:

### 11.1 `validateCwd` allowlist bridge

- A registered-path allowlist (`~/.aimaestro/imported-workdirs.json`) that
  `validateCwd` (`lib/agent-runtime.ts`) and `boot-restore-service.ts`
  consult: accept a cwd under `~/agents/` **OR** explicitly registered. Paths
  are added only by an explicit import/registration action (never auto from a
  stale registry entry), validated to exist + be a directory + be user-owned,
  and obviously-dangerous roots (`/`, bare `$HOME`, `/etc`) are rejected even
  if listed.
- **Hard coupling:** this bridge is acceptable ONLY while AI Maestro shares
  the human UID (today). The moment §4.1 UID separation lands, the bridge
  MUST be tightened in lockstep — forbid `/tmp` (A1), redirect `TMPDIR`,
  install the dedicated toolchain (A2), and the OS-level private `/tmp` —
  or the isolation is defeated on day one. The bridge code MUST carry a loud
  comment referencing this TRDD so it is not mistaken for a permanent posture.

### 11.2 directory-guard restore-survival (cross-repo, ai-maestro-plugin)

`AGENT_WORK_DIR` is injected only by AI Maestro's wake path; a
tmux-continuum-restored session does not have it, so `directory-guard.cjs`
fail-closes and bricks the agent. Fix: a registry-backed fallback anchor
(session name → `~/.aimaestro/agents/registry.json` → `workingDirectory`) —
trusted (not agent-controllable) AND restore-surviving. Filed against the
plugin repo, not edited here.

## 12. Explicit non-goals / rejected approaches

- **Keychain/Secure-Enclave key custody for headless use** — empirically
  disproven (§2). Do not revisit without a provisioned, entitled, notarized
  `.app` restructuring AND a per-op human gate, which together defeat the
  headless requirement.
- **Helper-binary "only the helper can sign" pattern** — proxy-use (F10)
  makes it worthless within one UID.
- **Any scheme that keeps human and agents on the same UID and tries to
  cryptographically separate them** — the kernel does not enforce it; only
  a different UID does.
- **A separate UID that still shares the human's Homebrew / `~/.local`
  toolchain** — isolation theatre; the toolchain is the fatter seam (F22,
  F23, A2). The toolchain MUST be dedicated and non-human-writable.
- **Allowing world `/tmp` under the isolated model** — the inverted-allowlist
  state (F21) must be flipped, not preserved. The interim bridge (§11.1)
  keeps `/tmp` only pre-isolation and is coupled to tighten in lockstep.
- **A `PreToolUse` hook as the SOLE temp/read boundary** — it is
  defence-in-depth; a hardcoded-`/tmp` tool slips it. Real enforcement is
  OS-level (private `/tmp`, UID perms, sandbox profile).

## 13. References

- Superseded TRDD: `design/tasks/TRDD-20260521_170844+0200-d77a7d6e-secure-auto-restore.md`
  (keychain approach; `status: superseded`, `superseded-by: [this TRDD]`).
- Related TRDD: `design/tasks/TRDD-20260522_121411+0200-1ee4a3c1-portable-self-contained-agents.md`
  (portable self-contained agents — the per-workdir `.aimaestro/` mirror +
  import/export pipeline; shares the server-mediated-transfer consequence, §8).
- Empirical reports (gitignored, local only — findings inlined in §2):
  - `reports/secure-restore/20260521_173109+0200-m1-empirical.md` (F1-F6)
  - `reports/secure-restore/20260521_204908+0200-m1-cycle2.md` (F7-F12)
  - `reports/secure-restore/20260522_035457+0200-m1-cycle3.md` (F16-F19, verdict)
  - `reports/secure-restore/20260522_042347+0200-m1-cycle4-se-retry.md` (SE retry post-profile-renewal)
- F20-F23: verified live during the 2026-05-22 design discussion (perms of
  `/tmp` vs `/var/folders`; toolchain resolution under `/opt/homebrew` +
  `~/.local`). Inlined in §2.3.
- Container design notes (gitignored): `docs_dev/2026-04-20-agent-execution-containers.md`.
- Existing signed ledger: `lib/signed-ledger.ts` (do not rebuild).
- Directory guard (cross-repo): `Emasoft/ai-maestro-plugin` →
  `scripts/directory-guard.cjs` (allowlist flip + registry anchor, §11.2).
