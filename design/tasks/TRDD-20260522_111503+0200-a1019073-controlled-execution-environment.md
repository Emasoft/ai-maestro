---
trdd-id: a1019073-a2b8-4dda-9ba0-e668a77b9ccc
title: Controlled execution environment for AI Maestro agents — UID separation, host sandboxing, supply-chain controls
status: not-started
created: 2026-05-22T11:15:03+0200
updated: 2026-05-22T11:15:03+0200
---

# TRDD-a1019073 — Controlled execution environment for AI Maestro agents

**Filename:** `design/tasks/TRDD-20260522_111503+0200-a1019073-controlled-execution-environment.md`
**Tracked in:** this repo (`design/tasks/` is git-tracked)

> **Scope note (read first):** this is **future work**, deliberately NOT the
> current PR. The current PR ships only the *functional* auto-restart of the
> AI Maestro server + its agents after a reboot (no security hardening) — see
> the separate implementation task. This TRDD captures the security
> architecture that the keychain approach (TRDD-d77a7d6e, now superseded)
> was reaching for, re-grounded on what the 2026-05-21/22 empirical tests
> actually proved is possible.

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

**Dependency-ownership corollary (important, easy to get wrong):** every
binary that the `aimaestro` user *executes* (node, tmux, claude, codex,
git, package managers) must be owned by `root` or `aimaestro`, NOT by the
human UID — otherwise the human-side attacker can swap an executable out
from under the service user and re-cross the boundary. This implies AI
Maestro's runtime toolchain is **installed twice / installed separately**:
once for the human (their normal dev tools) and once into a service-owned
prefix (`/opt/aimaestro/…` or `/usr/local/aimaestro/…`) that the agent UID
uses. The installer must lay down a service-owned toolchain and point the
agent environment's `PATH` at it. Mixing in human-owned `~/.local/bin`
binaries reopens the hole.

### 4.2 Host sandboxing (write confinement + egress control)

On top of UID separation, confine each agent further:

- **Write confinement** — an agent may write ONLY inside its own
  `~agents/<name>/` workdir (already a governance invariant, R-series) plus
  `/tmp`. Enforced at the OS layer, not just by prompt instructions:
  - **Linux**: AppArmor / seccomp profile per agent process; bind-mount the
    workdir rw, everything else ro or invisible. GPU passthrough WORKS on
    Linux (see §5), so full sandboxing + GPU is achievable.
  - **macOS**: `sandbox-exec` profiles (deprecated but functional) or the
    App Sandbox; fine-grained per-path confinement is *awkward* on macOS and
    less expressive than AppArmor. UID separation carries most of the weight
    here; host write-confinement is best-effort.
- **Egress filtering** — agents reach the network only through an allowlist
  (package registries, the model API, Tailscale peers). Blocks a poisoned
  dependency from phoning home / exfiltrating. Implementable via a per-UID
  pf/iptables rule set or an egress proxy the agent UID is forced through.

### 4.3 Supply-chain controls (the scan / confine / vet / monitor / ledger pipeline)

This is the layer that directly addresses the dominant threat (§3):

1. **Scan every dependency before install** — intercept the agent's package
   manager invocations; submit the resolved dependency set to a remote
   security scan (advisory DB + known-malicious-package list + install-hook
   heuristics) BEFORE allowing the install. Block on a hit.
2. **Confine the install** — installs run inside the sandbox (§4.2), so even
   a malicious `postinstall` hook can only write the agent workdir and
   cannot read human secrets or escape the agent UID.
3. **Vet plugins / MCP servers** — install plugins only after a remote scan
   (mirrors the existing CPV validation gate; extend it to a security pass).
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

## 5. Platform split (summary)

| Concern | Linux | macOS |
|---------|-------|-------|
| UID separation (kernel file perms) | solid | solid |
| Fine-grained write confinement | AppArmor/seccomp — expressive | `sandbox-exec`/App Sandbox — awkward, best-effort |
| Egress filtering | iptables/nftables per-uid | pf per-uid / egress proxy |
| GPU + sandbox together | YES (nvidia container runtime, or host + seccomp) | host-side ONLY (no container GPU); rely on UID sep |
| Containers for non-GPU agents | strong default | optional |
| Secure Enclave for keys | N/A (TPM equivalent varies) | unavailable to CLI binary (F19); UID sep replaces it |

Windows is out of scope for this TRDD (the auto-restore + service-user
model would map to a dedicated Windows service account + job objects +
WDAC, researched separately if/when Windows support is prioritized).

## 6. Consequence: file import/export must go through the server (HTTP)

UID separation breaks the implicit "the agent and the human share a
filesystem" assumption. The human cannot simply drop a file into an agent's
workdir (different UID, kernel-blocked), and the agent cannot write into the
human's tree. **All file movement between the human and an agent must go
through the authenticated AI Maestro server over HTTP** (upload/download
endpoints the server, running as `aimaestro`, mediates). This is a feature,
not a bug — it makes every file crossing the boundary an auditable,
ledgerable event — but it is a real UX/architecture change the
implementation must account for (drag-drop into an agent, exporting an
agent's output, etc. all become server-mediated transfers).

## 7. What the empirical work already proved WORKS (reuse, don't rebuild)

- **`codesign --verify --deep --strict` reliably detects binary tamper
  (F8).** Keep the code-signed-binary install pipeline for any NATIVE
  binaries we ship: the installer verifies the binary it lays down is the
  one we built. Scope it to "verify install integrity," NOT "protect
  secrets" (the keychain framing that failed).
- **FileVault ON + auto-login OFF (F12) already blocks unattended-reboot
  payload deployment for free** — a dotfile attacker cannot trigger a
  reboot to auto-deploy, because boot stops at the FileVault prompt. This
  also means *fully*-headless auto-restore on this Mac requires SOMETHING to
  unlock FileVault first (auto-login, stored recovery key, or remote
  unlock) — a tradeoff the auto-restart task must surface honestly.
- **Tailscale** is the network boundary and is already deployed.

## 8. Milestones (future — not scheduled)

- M-A: Service-user provisioning in the installer (`aimaestro` UID, service-
  owned toolchain prefix, PATH wiring, `0700` secret/ledger dirs).
- M-B: Server-mediated file import/export endpoints (replaces shared-FS
  assumption, §6).
- M-C: Linux host sandbox profiles (AppArmor/seccomp + egress allowlist).
- M-D: macOS host sandbox (`sandbox-exec` best-effort + egress proxy).
- M-E: Dependency-scan interceptor for package managers (§4.3.1-2).
- M-F: Plugin/MCP security-scan gate (extends CPV, §4.3.3).
- M-G: Per-agent process monitor → existing `lib/signed-ledger.ts` (§4.3.4-5).
- M-H: Optional container runner for non-GPU agents (Linux GPU-runtime
  default; mac non-GPU optional) — builds on
  `docs_dev/2026-04-20-agent-execution-containers.md` Model A.

## 9. Explicit non-goals / rejected approaches

- **Keychain/Secure-Enclave key custody for headless use** — empirically
  disproven (§2). Do not revisit without a provisioned, entitled, notarized
  `.app` restructuring AND a per-op human gate, which together defeat the
  headless requirement.
- **Helper-binary "only the helper can sign" pattern** — proxy-use (F10)
  makes it worthless within one UID.
- **Any scheme that keeps human and agents on the same UID and tries to
  cryptographically separate them** — the kernel does not enforce it; only
  a different UID does.

## 10. References

- Superseded TRDD: `design/tasks/TRDD-20260521_170844+0200-d77a7d6e-secure-auto-restore.md`
  (keychain approach; `status: superseded`, `superseded-by: [this TRDD]`).
- Empirical reports (gitignored, local only — findings inlined in §2):
  - `reports/secure-restore/20260521_173109+0200-m1-empirical.md` (F1-F6)
  - `reports/secure-restore/20260521_204908+0200-m1-cycle2.md` (F7-F12)
  - `reports/secure-restore/20260522_035457+0200-m1-cycle3.md` (F16-F19, verdict)
  - `reports/secure-restore/20260522_042347+0200-m1-cycle4-se-retry.md` (SE retry post-profile-renewal)
- Container design notes (gitignored): `docs_dev/2026-04-20-agent-execution-containers.md`.
- Existing signed ledger: `lib/signed-ledger.ts` (do not rebuild).
