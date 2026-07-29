# Platforms and install — macOS, Windows, Linux/systemd, Docker/containers, iOS/Android, NAS/routers, agent integration

Covers install and platform-specific setup across macOS, Windows, Linux/systemd,
Docker/containers, iOS/Android, and NAS/routers, plus adjacent device-management,
agent-integration, security-hardening, troubleshooting, monitoring-health, mesh-topology, and
DNS/MagicDNS content. This is a UNION reference — every checklist, table, command, and gotcha is
kept, not summarized. Contradictions already arbitrated against the installed `tailscale 1.98.5`
binary are noted inline; do not re-litigate those here. Single-source or low-confidence claims are
marked `[unverified]` / `confidence: LOW|MED`.

---

## 1. Cross-platform quick install

**Linux (all distros with the official script):**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status
tailscale ip -4
tailscale ip -6
```

**Fresh-VPS install + authenticate, as the first layer of a defense-in-depth pattern** (framed
as "the first layer of invisibility" for hiding a self-hosted service from the public
internet): the same two commands above, spelled out as a minimal two-step recipe — install
(`curl -fsSL https://tailscale.com/install.sh | sh`), then authenticate
(`sudo tailscale up`, which prints a login URL to open in a browser and authorize the machine),
then confirm with `tailscale ip -4` and expect a `100.x.x.x` address (the VPS's private tailnet
address). Companion step: install the Tailscale client on the OTHER device that needs access
(a laptop or phone) via the app store, sign in with the SAME Tailscale account used on the VPS,
then test connectivity by opening the VPS's Tailscale-only URL from that device.

**macOS:**
```bash
brew install tailscale          # Homebrew FORMULA — headless CLI+daemon (see §2 split)
brew install --cask tailscale   # Homebrew CASK — full Tailscale.app GUI (RECOMMENDED)
```
Or direct download from `https://tailscale.com/download` / `https://tailscale.com/download/mac`.

**Windows:**
```powershell
choco install tailscale
winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
```
A **bare** `winget install tailscale` is ambiguous (matches multiple packages) and aborts — always
pass `--id Tailscale.Tailscale -e`. MSI download for enterprise/MDM deployment at
`https://tailscale.com/download/windows`. Corroborated across four independent sources.

**iOS/iPadOS/tvOS/Android/Roku/FireTV:** platform app store only. No CLI on iOS/Android — install
via the app store, authentication happens in-app.

**Per-distro one-liners** (Fedora/RHEL, Arch, Alpine, openSUSE, Debian/Ubuntu explicit-keyring
form):
```bash
# Fedora/RHEL
sudo dnf install dnf-plugins-core && sudo dnf config-manager --add-repo https://pkgs.tailscale.com/stable/fedora/tailscale.repo && sudo dnf install tailscale
# Arch
pacman -S tailscale
# Alpine (+ OpenRC)
apk add tailscale; rc-update add tailscaled; rc-service tailscaled start
# openSUSE
zypper addrepo -g -r https://pkgs.tailscale.com/stable/opensuse/tumbleweed/tailscale.repo
# Debian/Ubuntu (explicit keyring, avoids apt-key deprecation)
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
sudo apt-get update && sudo apt-get install tailscale
```
Uninstall: `apt remove tailscale` / `yum remove tailscale`.

**Static binaries** (no package manager): download from `https://pkgs.tailscale.com/stable/`,
`tar xvf tailscale_<version>_<arch>.tgz`, `sudo tailscaled --state=tailscaled.state`,
`sudo tailscale up`; a `systemd/` unit subdir ships in the archive.

**Update:** `tailscale update` (CLI, `--yes --track=stable|unstable --version --dry-run`), or via
the app/store/MDM policy on managed platforms. `tailscale logout` (requires re-auth to
rejoin), `tailscale switch --list` / `tailscale switch <account>`, `tailscale version` are the
adjacent account/version-lifecycle commands.

**Auto-detect install script pattern** (`ts-install.sh`): detects platform via
`command -v apt-get`/`/etc/debian_version` (debian), `brew`+Darwin (macos), `choco`+MINGW/CYGWIN
(windows), `dnf` (fedora), `yum` (rhel), `apk` (alpine), `brew`+Linux (linuxbrew); `--dry-run`
prints the install command without executing; `--json` emits
`{"status","message","platform","version","login_server"}`; reads `HEADSCALE_URL`/
`TAILSCALE_AUTHKEY` env defaults; idempotent — checks `command -v tailscale` first, skips
reinstall, still verifies version afterward. After install, starts `tailscaled` via systemd
(skipped on macOS/Windows) and, if `--login-server` is given, runs
`tailscale up --login-server=... [--authkey=...]`.

**Skill-declared binary dependency pattern** (framework-specific, `[unverified — framework
schema, not portable Tailscale knowledge]`):
```json
{"clawdis":{"emoji":"🧭","requires":{"bins":["tailscale"]},"install":[{"id":"brew","kind":"brew","formula":"tailscale","bins":["tailscale"],"label":"Install Tailscale CLI (brew)"}]}}
```
Shows a convention for a skill to self-declare its binary dependency and an install recipe in
frontmatter metadata so a host agent runtime can auto-install missing tools. `[confidence
LOW — framework-specific metadata schema, not portable Tailscale knowledge on its own]`

**Bootc/candy-packaged distros ship it pre-installed, disabled:**
- **Bluefin** (bootc Fedora-based): `sudo systemctl enable --now tailscaled` to enable+start,
  `sudo systemctl disable --now tailscaled` to fully disable (avoids an unnecessary background
  service if unused). Ships a GNOME system-tray applet that appears once `tailscaled` is running,
  for toggling connection/exit-node/status.
- **bootc/systemd "candy" packaging** (Fedora/Arch build-time): package sources — Fedora/RHEL from
  `https://pkgs.tailscale.com/stable/fedora/tailscale.repo`; Arch via `pac: tailscale`. Build time
  only runs `systemctl enable tailscaled.service` (suffixed `|| true` — "offline bootc assembly
  can't fully activate a live systemd"). **`tailscale up --authkey=...` is a RUNTIME concern,
  never baked into the image** — interactive SSH post-boot, or cloud-init/systemd drop-in reading
  a secret from `/etc/tailscale/authkey`. `[confidence MED — project packaging convention,
  not upstream doc, but internally consistent]`

**Cloud-init bootstrap for auth-key enrollment at scale:**
```yaml
#cloud-config
runcmd:
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --authkey=tskey-auth-... --hostname=$(hostname) --ssh
  - systemctl enable --now tailscaled
```
For subnet routers, enable IP forwarding BEFORE advertising routes in the same runcmd block.
Store auth keys in the cloud provider's OWN secret manager (AWS Secrets Manager / GCP Secret
Manager / Azure Key Vault) and retrieve at boot — never embed in the cloud-init template. AWS:
`tailscale set --advertise-routes=10.0.0.0/16 --advertise-exit-node` on an EC2 instance to expose
a whole VPC. GCP/Azure follow the same pattern. Fly.io/Railway/Render: use the Docker image with
an auth key; prefer EPHEMERAL keys for auto-scaling platforms so scaled-down instances don't
accumulate as stale tailnet devices. `[unverified — still-plausible platform guidance, not
independently re-confirmed]`

**Talos Linux — machine config extension** (add Tailscale as a Talos system extension):
```yaml
machine:
  install:
    image: factory.talos.dev/installer/<schematic-id>:v1.13.0
    extensions:
      - image: ghcr.io/siderolabs/tailscale:v1.62.0
```

**WSL2 detection MUST run before generic distro detection**, or the install script may install
the Linux package inside WSL2 while WSL2 shares the Windows host's network stack, creating
conflicting WireGuard tunnels:
```bash
grep -qi microsoft /proc/version 2>/dev/null && [ ! -f /.dockerenv ]   # excludes containers atop a WSL2 host
```

**Per-distro install one-liners plus Docker capability requirement** (second corroborating
source): Debian/Ubuntu adds a keyring + `.list` from `pkgs.tailscale.com/stable/ubuntu/$(lsb_release -cs)`;
Fedora/RHEL uses `dnf config-manager --add-repo https://pkgs.tailscale.com/stable/fedora/tailscale.repo`;
Arch `pacman -S tailscale`; Alpine `apk add tailscale` + OpenRC (`rc-update add`,
`rc-service start`); openSUSE `zypper addrepo -g -r https://pkgs.tailscale.com/stable/opensuse/tumbleweed/tailscale.repo`.
Docker requires `cap_add: [NET_ADMIN, NET_RAW]` + `/dev/net/tun` device + `TS_AUTHKEY`.

**CLI location + shell completion (Linux):**
```bash
tailscale --version   # confirms on PATH
tailscale completion bash | sudo tee /etc/bash_completion.d/tailscale; source ~/.bashrc
tailscale completion zsh | sudo tee /usr/share/zsh/site-functions/_tailscale; exec zsh
```

### Per-platform binary paths and daemon config

| Platform | Binary |
|---|---|
| Linux | `/usr/bin/tailscale` (client), `/usr/sbin/tailscaled` (daemon) |
| macOS (App Store) | `/Applications/Tailscale.app/Contents/MacOS/Tailscale` |
| macOS (Homebrew) | `/opt/homebrew/bin/tailscale` |
| Windows | `C:\Program Files\Tailscale\tailscale.exe` |

macOS alias: `alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"`. Linux daemon
config: `/etc/default/tailscaled` (Debian/Ubuntu) or `/etc/sysconfig/tailscaled` (RHEL/Fedora);
flags `--socket` (default `/run/tailscale/tailscaled.sock`), `--statedir` (`/var/lib/tailscale`),
`--port` (41641; 0=random), `--tun` (`tailscale0`), `--verbose` (0-2), `--no-logs-no-support`.

**Userspace/no-TUN mode (no root, no TUN device needed):**
```bash
tailscaled --tun=userspace-networking --socks5-server=localhost:1055 &
tailscale up --auth-key=tskey-auth-...
# apps use SOCKS5 at localhost:1055
```

### CLI reference — `up` vs `set` vs `login`, and `up`/`down` flags

| Command | When | Triggers re-auth? |
|---|---|---|
| `up` | initial connection, or changing `--login-server` | sometimes |
| `set` | runtime pref change on already-connected device | never |
| `login` | switch accounts / force fresh auth | always |

Notable `up`/`set` flags: `--auth-key`, `--hostname`, `--advertise-routes`,
`--advertise-exit-node`, `--accept-routes`, `--accept-dns`, `--exit-node`,
`--exit-node-allow-lan-access`, `--ssh`, `--shields-up` (block incoming connections from other
tailnet devices), `--stateful-filtering`, `--force-reauth`, `--login-server` (up-only),
`--operator` (which unprivileged Linux user may run `tailscale` without sudo), `--reset` (up-only,
resets prefs to default before applying flags), `--snat-subnet-routes=false`, `--key-expiry=off`,
`--advertise-tags=tag:x,tag:y`, `--advertise-connector`, `--advertise-peer-relay`,
`--netfilter-mode=on|off|nodivert` (Linux). `[unverified — not independently re-confirmed]`

`down` flags: `--accept-risk=<risk>` (`lose-ssh` accepts the SSH-loss warning, `all` accepts all
risks and skips confirmation) and `--reason="<message>"` (required if the
`AlwaysOn.OverrideWithReason` policy is enabled). `tailscale down --accept-risk=all` disconnects
without confirmation. `[unverified — carried from prior merge pass]`

Also present across the CLI surface: `switch [--list]`, `status [--json --active --peers=false
--self=false]`, `ping [--c N --until-direct --verbose --icmp]`, `netcheck
[--format=json --every=5s --verbose]`, `bugreport [--diagnose --record]`, `ip [--4 --6 --1 peer]`,
`whois [--json] <ip-or-host>`, `metrics print|write <file>`, `dns status|query`,
`exit-node list|suggest`, `configure kubeconfig|synology`, `serve`, `funnel`, `file cp|get`,
`drive share|unshare|list|rename`, `cert`, `lock <sub>`. `[unverified — carried from prior merge
pass]`

**Core CLI surface, corroborated independently** (a distinct source's own walkthrough of the same
surface): Install → verify (`tailscale version`) → connect (`sudo tailscale up`, opens browser auth
link; enable built-in SSH with `sudo tailscale up --ssh`) → status (`tailscale status` table of
all peers, `tailscale status --self`, `tailscale status --json`) → own IP (`tailscale ip -4`) →
exit node (advertise with `sudo tailscale up --advertise-exit-node`; use from another machine with
`sudo tailscale set --exit-node=exit-node-name`) → subnet routing
(`sudo tailscale up --advertise-routes=192.168.1.0/24`) → Tailnet Lock status
(`tailscale lock status`) → logs (macOS `tail -f /var/log/tailscaled.log`; Linux
`journalctl -u tailscaled -f`) → restart daemon (macOS `brew services restart tailscale`; Linux
`sudo systemctl restart tailscaled`).

**Account switch, logout, update, version (CLI table form):** `tailscale logout` (requires re-auth
to rejoin), `tailscale switch --list` / `tailscale switch <account>`, `tailscale update`
(Win/macOS/some Linux), `tailscale version`.

---

## 2. Taildrop — peer-to-peer file transfer, no cloud intermediary

**Send/receive CLI:**
```bash
tailscale file cp <file> [<file>...] <target>:     # colon after hostname REQUIRED
tailscale file cp report.pdf my-laptop:
tailscale file cp *.csv my-desktop:
tailscale file get [--conflict=skip|overwrite|rename] [--loop] [--wait] <dest-dir>
tailscale file get .                                # retrieve to cwd
```
No directory support — tar/zip first. Default conflict behavior renames with numeric suffix
`file (1).pdf`. `--loop` blocks and processes files as they arrive continuously (pair with a
process supervisor/`nohup`); `--wait` blocks until a file arrives (single-shot). macOS/iOS
integrate with the system share sheet; Linux/Windows use CLI only.

**Gotcha:** `tailscale file get` MOVES files out of the inbox — the inbox empties as files are
retrieved.

**Setup + platform integration:** Public alpha; sends files directly between PERSONAL devices,
encrypted P2P, no third-party servers. Enable in admin console **Settings > General > Send
Files**; macOS additionally needs System Settings > General > Login Items & Extensions > Sharing
(check Tailscale). macOS/Windows: right-click file → "Send with Tailscale". iOS/Android: native
Share menu → Tailscale.

**Gotcha:** personal devices ONLY (cannot send to another user's device, even same tailnet);
cannot use with TAGGED devices; both devices must run Tailscale; transfer resume NOT supported on
macOS/iOS as receivers.

---

## 3. Remote desktop over the tailnet (RDP, VNC, RustDesk)

Just a TCP connection over the tailnet — no port forwarding, no public exposure. Point the client
at the target's MagicDNS hostname or `100.x` IP.

- **RDP (Windows):** needs Pro/Enterprise/Education/Server edition with RDP enabled; clients:
  built-in Remote Desktop Connection, Windows App (macOS/iOS/Android), Remmina/GNOME Connections
  (Linux); port 3389 never exposed publicly since it rides the encrypted tailnet; disable key
  expiry on always-on targets.
- **RustDesk:** normally needs a relay/ID server — unnecessary over Tailscale (direct P2P, no
  RustDesk server needed); enable Direct IP access under Security (set permanent password for
  headless), connect to target's Tailscale IP/MagicDNS name.
- **VNC:** same pattern — connect viewer to target's Tailscale IP/MagicDNS name.
- Restrict via tailnet policy (e.g. allow only specific users/groups to reach `tcp:3389` on the
  target tag).

---

## 4. MagicDNS — resolution model and cross-platform troubleshooting

**Model:** auto-registers a DNS name per device; enabled by default on tailnets created after
2022-10-20. FQDN format: `<machine-name>.<tailnet-name>.ts.net` (e.g. `monitoring.yak-bebop.ts.net`);
short names resolve within the same tailnet via automatic search-domain config. If not enabled:
toggle in the admin console under **DNS**.

**Gotcha:** some macOS tools (`host`, `nslookup`) bypass system DNS and won't resolve MagicDNS
names — use `ping` or `dig` instead. Shared devices from OTHER tailnets must be accessed by full
domain name.

**Per-platform verification + cache-flush commands:**
```bash
tailscale status | grep MagicDNS
scutil --dns | grep 100.100.100.100          # macOS: confirm resolving via Tailscale
resolvectl status | grep 100.100.100.100     # Linux
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder   # macOS DNS cache flush
sudo systemd-resolve --flush-caches           # Linux
ipconfig /flushdns                            # Windows
```
**Gotcha:** name collisions across devices break resolution; must use the full
`machine-name.tailnet-name.ts.net` form if no search-domain is configured.

**Platform-specific breakage modes:**
- **Linux systemd-resolved**: verify `resolvectl status tailscale0` shows `100.100.100.100` +
  tailnet domain; `/etc/resolv.conf` must be a symlink to
  `/run/systemd/resolve/stub-resolv.conf` (`ls -la /etc/resolv.conf`) — if not:
  `sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf`.
- **NetworkManager conflict**: `cat /etc/NetworkManager/NetworkManager.conf | grep dns` —
  `dns=default` means NM overwrites `/etc/resolv.conf`; fix `dns=systemd-resolved` and restart NM.
- **macOS**: check `scutil --dns`; third-party VPN/DNS tools (dnsmasq, Little Snitch) can
  intercept DNS ahead of Tailscale's resolver.
- **Windows**: resolution follows interface-metric order; Tailscale sets a low metric to win, but
  another VPN/adapter with a lower metric wins instead — compare via `Get-NetIPInterface`.
- **DNS64/NAT64 (IPv6-only networks)**: synthesized AAAA records can conflict with `100.x.x.x`
  MagicDNS answers; symptom = MagicDNS resolves to a synthesized IPv6 address instead of the
  Tailscale IP, connection fails. iOS/Android handle this automatically; on Linux, explicitly
  route the tailnet domain to `100.100.100.100` in systemd-resolved.

---

## 5. Bug-report / support-escalation evidence checklist

Collect before filing a ticket:
- `tailscale bugreport` (generates a report ID linked to server-side logs, safe to share —
  excludes private keys/traffic content)
- `tailscale status --json`
- `tailscale netcheck`
- Platform logs: `journalctl -u tailscaled` (Linux-systemd); `/var/log/tailscaled.log`
  (Linux non-systemd); `log show --predicate 'process == "tailscaled"' --last 1h` (macOS);
  `~/Library/Logs/Tailscale/` (macOS); Windows Event Viewer /
  `%LOCALAPPDATA%\Tailscale\tailscale-ipn.log`; iOS Settings > Privacy > Analytics; Android
  `adb logcat -s Tailscale`
- Exact repro steps + timestamps

**Gotcha:** **NEVER share the contents of `/var/lib/tailscale/` (or equivalent state dir)** — it
contains private keys.

---

## 6. macOS — three distributions, and what each one LACKS

macOS has **three separate Tailscale distributions that FIGHT if mixed**:

| Distribution | Install | What it is | What it LACKS |
|---|---|---|---|
| **Mac App Store / TestFlight** | App Store | sandboxed GUI app | **no `tailscale ssh` subcommand** (`"not available on macOS builds distributed through the App Store or TestFlight"`); CLI not automatically on `$PATH` |
| **Standalone GUI (open-source-CLI variant)** | `https://tailscale.com/download/mac` or `https://pkgs.tailscale.com/stable/#macos` | full `Tailscale.app`, NOT sandboxed | full CLI surface incl. `tailscale ssh` — this is the variant **required** for the SSH server |
| **Homebrew CASK** (`brew install --cask tailscale`) | brew | = the Standalone GUI, packaged via brew; full `Tailscale.app` + NetworkExtension daemon (`IPNExtension`) + menu-bar + auto-start LaunchAgent — **RECOMMENDED**, including for Headscale | same full surface as Standalone |
| **Homebrew FORMULA** (`brew install tailscale`, no `--cask`) | brew | standalone headless `tailscaled` + CLI, modeled after the Linux client, NOT tied to any `.app` | GUI, menu-bar, native MagicDNS/split-DNS integration, Sparkle auto-update, seamless login — "a net loss; only go headless on a true headless server" |

**Tailscale SSH server on macOS ONLY works with the open-source-CLI / Standalone / Cask variant —
never the App Store build.** Errors on the App Store build: `The 'tailscale ssh' subcommand is not
available on macOS builds distributed through the App Store or TestFlight`. Fix for an App Store
install that needs `tailscale ssh`: uninstall the App Store app, install the Standalone build from
`https://pkgs.tailscale.com/stable/#macos` to `/Applications`, then alias the embedded CLI:
```bash
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"   # ~/.zshrc
```

**`tailscale funnel` is also unavailable on the macOS App Store variant** (as well as iOS and
Android) — only Linux + the macOS open-source variant support it. (See also §11 mobile.)

**macOS CLI access modes** (a second framing of the same split): Standalone (macOS 13+) — enable
via Tailscale menu → Settings → CLI integration → Install Now, installs
`/usr/local/bin/tailscale`. App Store variant — CLI is bundled inside the app, run via
`/Applications/Tailscale.app/Contents/MacOS/Tailscale <command>`; set `TAILSCALE_BE_CLI=1` in
scripts to force CLI mode.

**Binary location differs by install shape** — `which tailscale` returning nothing does **NOT**
mean Tailscale isn't running (App Store/Standalone builds are commonly not on `$PATH` by default);
check the menu-bar icon or call the full path. Homebrew puts `tailscale` on `$PATH`; if both a
brew install and the GUI app are present, their **versions can diverge**.

**Gotcha (jq masking a Tailscale failure):** if a `... | jq ...` pipeline throws
`jq: parse error: Invalid numeric literal at line 1, column N`, don't debug jq — the upstream
command (e.g. `tailscale`) almost certainly failed (command not found) and its error text merged
into stdout via `2>&1`; re-run the upstream command alone first.

**Architecture: the GUI is a controller, not the daemon.** The real daemon on macOS is a **system
extension** (`io.tailscale.ipn.macsys.network-extension`, runs as root, managed by macOS not
launchd) — NOT the headless brew `tailscaled`. `/Applications/Tailscale.app` is only a menu-bar
controller; the CLI it ships is a symlink that talks to the system extension directly. This is
why **`tailscale status` can succeed while the GUI fails** — they reach the extension by different
paths.

Standalone Tailscale.app (`io.tailscale.ipn.macsys`) bundles CLI+daemon in one binary and the CLI
talks to the in-process daemon over a TCP **LocalAPI on a random loopback port**. After certain
updates/partial-crash states, the GUI keeps running (other nodes still see the host reachable) but
the LocalAPI listener is gone, breaking every local CLI call including launchd jobs using
`tailscale file cp` (Taildrop), `tailscale ip`, `tailscale set`. Diagnostic error: `Failed to
connect to local Tailscale daemon for /localapi/v0/status; not running? Error: dial tcp
127.0.0.1:<port>: connect: can't assign requested address`.

Going headless (brew `tailscaled` as a launchd service) on a desktop Mac loses MagicDNS/split-DNS
native integration, Sparkle auto-update, and seamless login — "a net loss; only go headless on a
true headless server."

### Install / first-run permission dance (macOS Tahoe / macOS 26)

After `brew install --cask tailscale && open -a Tailscale`, walk 4 System Settings panes if the
daemon is absent from `pgrep -fl IPNExtension`:
1. Privacy & Security → Security (bottom) → click "Allow" next to the Tailscale message.
2. General → Login Items & Extensions → Network Extensions → toggle Tailscale ON.
3. Network → VPN (sidebar) → ensure the "Tailscale" VPN config toggle is on.
4. Privacy & Security → Local Network (if prompted) → allow Tailscale.

Then quit (menu-bar → Quit) and reopen (`open -a Tailscale`); the daemon should register within
seconds. Verify with `pgrep -fl IPNExtension`; `systemextensionsctl list` shows `waiting for user`
if a step was missed. **This first-install manual step cannot be automated.**

### Two-distribution conflict (cask+formula, or App Store+cask mixed)

Homebrew Cask `brew install --cask tailscale` = full Tailscale.app GUI + NetworkExtension daemon
(`IPNExtension`) + menu-bar + auto-start LaunchAgent — **RECOMMENDED, including for Headscale**.
Homebrew formula `brew install tailscale` = standalone `tailscaled`+CLI, separate from any `.app`,
modeled after the Linux client — discouraged on macOS, conflicts with the cask if both installed
(their daemons fight over the local IPC socket). The Mac App Store build is app-sandboxed and also
conflicts if mixed with the cask (same install path, override unpredictably).

Symptom: Tailscale.app GUI stuck "Starting...", `tailscale up` hangs indefinitely,
`tailscale status` returns `"failed to connect to local tailscale service"` even with the GUI
open — their daemons fight over the local IPC socket. Cleanup (as root):
```bash
brew services stop tailscale 2>/dev/null || true
sudo brew services stop tailscale 2>/dev/null || true
sudo launchctl bootout system /Library/LaunchDaemons/homebrew.mxcl.tailscale.plist 2>/dev/null || true
sudo launchctl bootout system /Library/LaunchDaemons/com.tailscale.tailscaled.plist 2>/dev/null || true
osascript -e 'tell application "Tailscale" to quit' 2>/dev/null || true
sleep 2
sudo pkill -x tailscaled 2>/dev/null || true
brew uninstall tailscale 2>/dev/null || true
open -a Tailscale
```
This stops both user/root brew-services modes, quits the cask cleanly to release the socket,
kills stragglers, removes the formula (keeps `Tailscale.app`), reopens the cask.

**Diagnostic table for "failed to connect to local tailscale service" on macOS:**

| Cause | Check | Fix |
|---|---|---|
| App not open | `pgrep -fl 'Tailscale.app/Contents/MacOS/Tailscale'` empty | `open -a Tailscale` |
| NetworkExtension not activated | `systemextensionsctl list` shows "waiting for user"/absent | walk the 4-pane permission dance above |
| Mixed cask+formula | `pgrep -fl tailscaled` returns a non-app path (`/opt/homebrew/...` or `/usr/local/...`) | run the cleanup script above |
| Daemon crashed | `pgrep -fl IPNExtension` empty despite GUI open | quit/reopen; check `log show --predicate 'subsystem == "io.tailscale.ipn"' --last 5m` |

**4-check macOS install health verification script:**
```bash
ls -d /Applications/Tailscale.app                                    # A. cask installed
pgrep -fl tailscaled | grep -v 'Tailscale.app' && echo PROBLEM || echo ok  # B. no formula daemon
pgrep -fl IPNExtension >/dev/null && echo ok || echo "daemon not running"  # C. daemon running
/Applications/Tailscale.app/Contents/MacOS/Tailscale status >/dev/null 2>&1 && echo ok || echo "CLI cannot reach daemon"  # D. CLI reaches daemon
```

**Ansible cask automation reference:** `brew_casks: [tailscale-app]` (NOT the bare `tailscale`
brew formula, which is the headless CLI); start-at-login idempotently via
`community.general.osx_defaults` domain `io.tailscale.ipn.macsys`, key `TailscaleStartOnLogin`,
type bool, value true.

Verify: `tailscale status` (talks to extension), `defaults read io.tailscale.ipn.macsys
TailscaleStartOnLogin` (→ 1), `ps aux | grep -i tailscale | grep -v grep` (extension as root + GUI
as user).

### Restarting the macOS daemon — via the App, never via `launchctl kickstart`

`launchctl kickstart system/com.tailscale.tailscaled` **FAILS** on macOS — the standalone/cask
Tailscale.app is not a plain launchd daemon in this configuration. Restart via `tailscale logout`
→ `tailscale up`, or quit+reopen the App:
```bash
osascript -e 'quit app "Tailscale"'; sleep 2; open -a Tailscale
# only if that fails — drops the tunnel briefly, needs sudo:
osascript -e 'quit app "Tailscale"'
sudo launchctl kickstart -k system/io.tailscale.ipn.macsys   # or reboot
open -a Tailscale
```
Fix rationale: "Could not connect to Tailscale / Invalid response from local service" is a
GUI↔extension handshake desync, NOT a config problem — no downtime, the tunnel stays up during
the quit/reopen.

### Fixing a stale LocalAPI port

Primary fix: `killall Tailscale; sleep 2; open -a Tailscale` (from a GUI session, or via SSH if a
GUI session is logged in). `open -a` over SSH only works if a GUI session is logged in; if it
silently no-ops, fall back to `launchctl asuser $(id -u) open -a Tailscale`. Verify:
`tailscale status` (peer list, not a LocalAPI error), `tailscale ip -4`.

**Self-lockout bootstrap trap:** if your remote session (SSH/VNC) reaches the affected Mac VIA
its own Tailscale IP, killing Tailscale severs your own control channel before relaunch — the most
common way to brick yourself out. Avoid it: use a NON-Tailscale recovery path (macOS built-in
Screen Sharing over Apple ID relay: System Settings → General → Sharing → Screen Sharing → "Allow
for Apple Account" — works without Tailscale; or LAN/Bonjour/`.local`/wired console). If you must
go over Tailscale, make kill+restart one self-contained detached command:
```bash
ssh affected-mac 'nohup sh -c "sleep 1; killall Tailscale; sleep 3; open -a Tailscale" >/dev/null 2>&1 </dev/null & disown'
```
then wait ~30s and reconnect. Test on a non-critical host first.

**Recovery from full lockout:** anyone with physical or local-LAN access can Cmd+Space →
"Tailscale" → Enter. The login-item helper also relaunches Tailscale on next user login, so a
reboot via smart plug recovers it (heavy hammer, `confidence MED`).

**Don't trust remote `tailscale status` as a health signal for the LOCAL daemon.** The control
plane caches each node's registration and reports `idle, tx X rx Y` even when that node's OWN
local CLI/LocalAPI is broken. The only reliable health signal is running a CLI command ON the
affected host itself. Distinct install paths on macOS produce different failure modes: standalone
(`io.tailscale.ipn.macsys`) has the stale-port bug above; Mac App Store build
(`io.tailscale.ipn.macos`) is sandboxed differently and doesn't expose the CLI the same way;
Homebrew `tailscaled` formula requires `sudo` and its LaunchAgent
(`homebrew.mxcl.tailscale.plist`) crash-loops with `tailscaled requires root; use sudo tailscaled`
if accidentally enabled alongside the GUI app.

### The single most common macOS connectivity bug

Symptom: remote→Mac ping/SSH both timeout, but `tailscale ping` from remote to the Mac **works**
(uses Tailscale UDP/TCP encapsulation, not ICMP); Mac→remote works fine (asymmetric). Fix: click
the Tailscale menu-bar icon → avatar/settings → ensure **"Allow Incoming Connections"** is
enabled. When disabled, Tailscale drops ALL inbound TCP/ICMP at the app level while the UDP tunnel
(`tailscale ping`) still works via Tailscale's internal protocol. **Try this FIRST** — it's the
fastest fix for the single most common asymmetric-connectivity cause.

### Clash TUN mode intercepting Tailscale traffic on macOS

Fully quit Clash Verge (menu bar → Quit, not just toggle TUN off — toggling off does NOT stop the
`mihomo` process); verify `ps aux | grep -i "clash\|mihomo" | grep -v grep` returns nothing. Or
exclude the Tailscale CIDR in the Clash TUN config:
```yaml
tun: {enable: true, auto-route: true, auto-detect-interface: true, dns-hijack: []}
```
If packets reach `utun` but macOS doesn't respond, try
`echo "pass in quick on utun26 proto { tcp, udp, icmp } all keep state" | sudo pfctl -f - -a com.apple/tailscale`
or `sudo pfctl -e; sudo pfctl -F all`.

**Gotcha:** pf "not enabled" is normal on macOS even so — macOS Application Firewall
(`socketfilterfw`) can independently block traffic; check
`/usr/libexec/ApplicationFirewall/socketfilterfw --listapps` includes `sshd-keygen-wrapper`.

### Userspace `tailscaled` fallback when only the CLI is installed (no system daemon/socket)

When `tailscale status` fails with a message OTHER than "Logged out."/"NeedsLogin"/"stopped; run"
(i.e. no reachable daemon at all — the Homebrew-CLI-without-system-daemon case, e.g. Codex on
macOS), start a TEMPORARY userspace `tailscaled` scoped entirely under `/private/tmp/`:
```bash
tailscaled --tun=userspace-networking \
  --socket=/private/tmp/remotehost-tailscaled.sock \
  --state=/private/tmp/remotehost-tailscaled.state \
  --statedir=/private/tmp/remotehost-tailscaled
```
`--statedir` specifically matters for HTTPS-Serve certificate material — omitting it can produce
an HTTPS Serve failure whose `tailscaled` log literally says `no TailscaleVarRoot`. If the
userspace node shows `offline` in `tailscale status` (stale prior state), fix with `--fresh`:
archive the old `state`/`statedir` with a timestamp suffix
(`mv "$state_path" "${state_path}.stale-<ts>"`) and start clean, then re-login.

**Gotcha:** a normal browser on the SAME Mac may still fail to open a Serve hostname when only
this CLI/userspace Tailscale is running — macOS host routing and MagicDNS aren't installed for a
plain browser process in that mode; verify same-host service health via `127.0.0.1:PORT` instead,
and test the actual Serve URL from a genuinely separate device on the tailnet.
`[unverified — not independently re-confirmed]`

### Homebrew brew-cask automation and start-at-login, restated

Ansible cask automation reference: `brew_casks: [tailscale-app]` (NOT the bare `tailscale` brew
formula, which is the headless CLI); start-at-login idempotently via
`community.general.osx_defaults` domain `io.tailscale.ipn.macsys`, key `TailscaleStartOnLogin`,
type bool, value true.

---

## 7. Windows

**Install:** `choco install tailscale`, or `winget install --id Tailscale.Tailscale -e
--accept-source-agreements --accept-package-agreements` (a bare `winget install tailscale` is
ambiguous and aborts). MSI at `https://tailscale.com/download/windows` for enterprise/MDM
deployment. WSL2 is supported as a client environment.

**No `tailscale up --ssh` on Windows.** The Tailscale SSH server component runs only on Linux and
the open-source macOS build — **never** the Windows client (feature request #14942 still open per
the source, `[unverified — time-sensitive FR status]`). Use Windows' own native OpenSSH Server
instead:
```powershell
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
```
Then cross-platform SSH works uniformly via `ssh user@100.x.x.x` regardless of OS on either end
(Linux/macOS use Tailscale SSH, Windows uses its own OpenSSH server, both riding the tailnet).

**Elevation matters, and silently fails without it.** Run PowerShell **ELEVATED** — the window
title must say "Administrator" and it opens in `C:\WINDOWS\system32` (opening in `C:\Users\you`
means NOT elevated, and `Add-WindowsCapability`/`New-NetFirewallRule` misbehave). Non-elevated
`Add-WindowsCapability` can **silently no-op** — verify with
`Get-WindowsCapability -Online -Name OpenSSH.Server* | Format-Table Name,State` (expect
`Installed`) and `Get-Service sshd` (must exist).

**CLI PATH gotcha:** after install, the `tailscale` CLI is **NOT** on PATH in the same shell —
open a new window, or use the GUI tray icon (Connected + a `100.x.y.z` address means `tailscale
up` already ran). Turn on "Run unattended" so the node comes up before login.

**SSH key placement for a Windows Administrator account:** OpenSSH reads
`C:\ProgramData\ssh\administrators_authorized_keys` (**NOT** `~\.ssh\authorized_keys`), and this
file must be locked down:
```powershell
icacls $f /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
```
SSH login name is the Windows account (`whoami` → part after `\`), usually different from the WSL
Linux user — mixing up the Windows account vs the WSL user in `~/.ssh/config` `User` fields fails
auth with no clear reason.

**Windows-as-anchor design (Mac↔Windows↔WSL chain):** put the always-on entry point on Windows
SERVICES (native OpenSSH + Tailscale, both boot before login, independent of WSL); reach WSL
behind that anchor via `ProxyJump win → 127.0.0.1:2222` (WSL sshd on a port different from
Windows's `:22`). This works because NAT networking + `localhostForwarding=true` (the default)
lets a Windows process reach a WSL listener at `127.0.0.1:<port>` — no mirrored networking, no
`netsh portproxy`, no Tailscale-inside-WSL needed. If WSL is down, `ssh win` still works and you
start WSL from there — the design's whole point is that WSL dying no longer blocks access, only
delays the inner hop. If `localhostForwarding` gets flaky, `wsl --shutdown` resets it; fallback is
`networkingMode=mirrored` (target `hostname:2222` directly) or a boot-time
`netsh interface portproxy` refresh — prefer fixing `localhostForwarding` first (fewest moving
parts).

**Scheduled-task trigger choice for WSL keep-alive:** `onlogon` runs in the real interactive
logon (needed because WSL gives each Windows user its own `LxssUserSession`, and inbound SSH rides
the logged-in user's instance), from a non-elevated shell, needs no stored credential ("Locked"
still counts as logged on). `onstart` fires at boot with no session but needs a **stored
password** for "run whether logged on or not" (fails for passwordless/Hello-only accounts) and
wants `powercfg /h off` to avoid hybrid-shutdown inconsistency. **NEVER use `SYSTEM`** —
`wsl.exe` from session 0 is unsupported (Access-denied or a throwaway temp instance, per
microsoft/WSL #9271, #9231), so a SYSTEM task can't pin the instance your interactive SSH session
actually uses.

**WSL idle-shutdown regression still suspends services even with `vmIdleTimeout=-1`.** `.wslconfig`
`[wsl2]`: `localhostForwarding=true`, `vmIdleTimeout=-1`. As of mid-2026 (through WSL 2.7.x,
verified 2.7.8.0) a regression introduced around 2.5.7 (microsoft/WSL #13291, #13416, open) still
suspends in-VM services despite `vmIdleTimeout=-1` — the VM needs a never-exiting in-distro
process to stay resident. Fix:
```powershell
schtasks /create /tn WSL-keepalive /sc onlogon /tr "C:\Windows\System32\wsl.exe -d <distro> -u root --exec /usr/bin/tail -f /dev/null"
```
**Gotcha:** an `onlogon` scheduled task does NOT fire when first created — trigger manually once
(`schtasks /run /tn WSL-keepalive`) or log out/in, then verify with `wsl.exe -l --running` +
`ss -tlnp | grep 2222`.

**Tailscale-inside-WSL as an additive convenience, not the primary anchor — two exposure paths.**
Path 1 (preferred) — plain `tailscale up` (no `--ssh`) so WSL gets its own `100.x` address; the
existing `0.0.0.0:2222` sshd becomes reachable at `<wsl-tailnet-ip>:2222` using the SAME
authorized_keys already configured — no new auth surface. Path 2 — `tailscale up --ssh` for
keyless tailnet-identity auth, but on a headless/automated box use ACL `action: "accept"`, NEVER
`"check"` (periodic IdP re-auth blocks non-interactive reconnects — Claude Code, tmux-resume,
cron), and NEVER tag the node (an untagged node is authorized via `autogroup:self`; adding any tag
silently drops that and the SSH rule evaporates — a no-error lockout). **Gotcha:** the in-WSL
Tailscale node lives in the VM that can suspend (idle-shutdown regression above) — it can't be the
always-on anchor; the Windows-anchor keep-alive is what keeps it reachable.

**Install `tailscaled` via apt, not Homebrew, inside WSL — systemd unit ownership matters.** apt
ships a root **system** unit (`/usr/lib/systemd/system/tailscaled.service`) that starts at boot —
required for a headless daemon. `brew services` on Linux defaults to a `--user` unit that can't
own the TUN device and needs `loginctl enable-linger` to survive logout. Install: source
`/etc/os-release` for `$VERSION_CODENAME`, download the Tailscale apt keyring + repo list for that
codename, `apt install tailscale`, `systemctl enable --now tailscaled`, `tailscale up` (add
`--ssh` only when that path is wanted).

**Tailscale FR #14942 — SSH server still can't run on the Windows client.** Tailscale SSH's server
component runs only on Linux and the open-source macOS build, never the Windows client — it can't
be the anchor on a Windows box, which is why the design above anchors on stock OpenSSH instead.
`[unverified — single-source, feature-request status is time-sensitive]`

**Windows-host TUN proxy can black-hole the whole machine including WSL and its Tailscale.** WSL2
in NAT mode has no network path of its own — every packet exits through the Windows host stack. A
host TUN proxy (v2rayN sing-box TUN, Clash TUN) owns the default route; if its upstream node is
dead, host traffic black-holes and WSL (including its own `tailscaled` control-plane connection)
goes down with it. Unlike the macOS split-brain (only one plane dies), on Windows **both**
domestic and overseas traffic fail at once, and "even Tailscale won't connect" is a symptom
entirely upstream of Tailscale itself. Fix: disable TUN mode in the proxy tool (recovery is
near-instant).

**Windows event-log forensics to determine which recovery action actually fixed a network
outage.** `Microsoft-Windows-NetworkProfile/Operational` event 10000 (connected)/10001
(disconnected) name the adapter (e.g. `singbox_tun` for v2rayN 7.x TUN); event 4004 marks
connectivity-level flaps.
```powershell
Get-WinEvent -FilterHashtable @{LogName="Microsoft-Windows-NetworkProfile/Operational"; StartTime=(Get-Date).Date} | Select-Object -First 30 TimeCreated,Id,Message
```
Align timestamps: if recovery follows action B (TUN disabled) within seconds while flaps
continued after action A (switched NICs), causation is pinned on B, not A. Users under outage
stress try multiple recovery actions at once and often credit the wrong one — event-log
timestamps settle it with evidence instead of assumption.

**Three WSL→Windows interop pitfalls that silently produce fake "no output" during diagnosis:**
1. Windows exes may not be on PATH inside WSL (`appendWindowsPath` disabled) — a bare
   `powershell.exe` call fails command-not-found, which inside an `cmd || echo "(none)"` pattern
   silently looks like "nothing found"; always call by full path
   (`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`).
2. Localized (e.g. Chinese/GBK) Windows output piped into `grep` can be treated as binary and
   print nothing — transcode with `iconv -f GBK -t UTF-8//IGNORE` and force PowerShell UTF-8
   (`[Console]::OutputEncoding=[Text.Encoding]::UTF8`).
3. In a no-tty SSH session, a Windows exe finishing can kill the output pipe, making subsequent
   commands in a multi-step script appear to "die" — redirect each Windows call to a file
   (`</dev/null >/tmp/out 2>&1`) then `cat` it from Linux.

**Disambiguating two independent Tailscale nodes on a Windows+WSL machine.** A Windows+WSL box can
run 2 separate `tailscaled` nodes (Windows client service, and Linux `tailscaled` inside WSL)
registered as separate devices. Disambiguate: inside WSL, `tailscale status` first line = the node
you're talking through; on Windows (from WSL via full path), `sc.exe query Tailscale` shows
RUNNING (proves nothing about login) and `tailscale.exe status` may show `NoState`/"starting".
Signature of an installed-but-never-logged-in Windows node: the Tailscale network adapter is Up
but holds a `169.254.x.x` APIPA address instead of a `100.x.y.z` CGNAT address
(`Get-NetIPConfiguration` is the fastest check) — the IPN engine never configured it.

**WSL2/Windows interop gotchas beyond the network layer:** enabling systemd in WSL can break
non-interactive `wsl.exe -e <cmd>` with `Wsl/Service/E_UNEXPECTED "Catastrophic failure"` — which
ALSO breaks VS Code Remote-WSL (shells out via `wsl -e`); interactive shells still work; fix with
`wsl --update`; prefer Remote-SSH to the `wsl` host over Remote-WSL since Remote-SSH rides
`localhostForwarding`, not `wsl -e`. `appendWindowsPath=false` means Windows tools (`code`,
`winget.exe`) are deliberately not on WSL's PATH — flip to true to inherit (Linux tools keep
precedence since it's *appended*). "Failed to start the systemd user session" warning is benign
(sshd is a system service). zsh does NOT treat `#` as an inline comment by default — a pasted
command with a trailing `# note` sends the comment as arguments. Editing WSL files when
`wsl -e` is broken: use `\\wsl.localhost\<distro>\home\<user>\…` (9p file share works even when
command-exec throws). Quoting through Windows→wsl→bash is lossy — pipe data over stdin instead of
inline `VAR="…"` args.

**Generic VPN-interface detection (PowerShell, not Tailscale-specific but the same regex family
surfaces a Tailscale WireGuard adapter):**
```powershell
Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'VPN|TAP|TUN|WireGuard' } | Select-Object Name, Status, InterfaceDescription
Get-VpnConnection | Select-Object Name, ServerAddress, ConnectionStatus   # won't list Tailscale — it's not a Windows-native VPN profile
```
`[unverified — confidence MED, generic Windows-maintenance skill, transferable but never mentions
Tailscale by name]`

---

## 8. Linux / systemd

**Daemon config files and flags:** `/etc/default/tailscaled` (Debian/Ubuntu) or
`/etc/sysconfig/tailscaled` (RHEL/Fedora). Flags: `--socket` (default
`/run/tailscale/tailscaled.sock`), `--statedir` (`/var/lib/tailscale`), `--port` (41641; 0 =
random), `--tun` (`tailscale0`), `--verbose` (0-2), `--no-logs-no-support`.

**`$FLAGS`/`$PORT` env-file vars, NOT `TS_EXTRA_ARGS`.** The default systemd unit reads
`ExecStart=/usr/sbin/tailscaled --state=... --socket=... --port=${PORT} $FLAGS`. Correct
`/etc/default/tailscaled`:
```
PORT=41641
FLAGS=--accept-dns=false --accept-routes --advertise-exit-node
```
`TS_EXTRA_ARGS` is **NOT** read by the default systemd unit — args set there get passed as-is to
`tailscaled` and fail as unrecognized daemon flags (`INVALIDARGUMENT`). Also: if `PORT` is
missing/empty, systemd expands `--port=""` and `tailscaled` refuses to start with `can't be the
empty string` — **always set `PORT=41641`** (or any valid port) even without a custom-port need.

**Userspace/no-TUN mode:**
```bash
tailscaled --tun=userspace-networking --socks5-server=localhost:1055 &
tailscale up --auth-key=tskey-auth-...
# apps use SOCKS5 at localhost:1055
```

**NixOS — full `services.tailscale` module surface:** `useRoutingFeatures =
"both"|"client"|"server"`, `openFirewall`, `extraDaemonFlags = ["--no-logs-no-support"]` (disable
telemetry), `port`, `interfaceName = "userspace-networking"`, `extraSetFlags =
["--netfilter-mode=nodivert"]` (prevent firewall bypass), `permitCertUid = "caddy"` (let a service
user read certs). Firewall: `checkReversePath = "loose"` + `trustedInterfaces =
["tailscale0"]` required for exit-node/router use.

**NixOS auto-connect systemd unit checks `BackendState` before `tailscale up`:** a
`tailscale-autoconnect` oneshot service sleeps 5s, then checks
`tailscale status --json | jq -r .BackendState`; runs `tailscale up --accept-routes` only if not
`"Running"` — an idempotent boot-time reconnect pattern. `[confidence MED]`

A second, thinner Nix example (personal dotfiles, `confidence MED — not vendor guidance`):
```nix
services.tailscale = { enable = true; useRoutingFeatures = "server"; };  # subnet router only
networking.firewall = {
  enable = true;
  trustedInterfaces = [ "tailscale0" ];
  allowedUDPPorts = [ config.services.tailscale.port ];
};
```
Notes explicitly that "per-interface `allowedTCPPorts` rules are NOT used" — the firewall model
here is interface-trust, not port-allowlist, for Tailscale traffic. macOS side of that same host
fleet is NOT declaratively managed by Nix — just `tailscale status` / `tailscale ip -4` via the
app/CLI. `mosh` sessions there are routed exclusively over the Tailscale IP, never LAN.
`[unverified — not independently re-confirmed]`

This exact shape is corroborated by a second, independently-worded source: `useRoutingFeatures
= "server"` (not `"both"`) deliberately restricts the node to subnet-router mode only — it
excludes exit-node use at the module level, not just by convention. The firewall pairing is
two-part: the whole `tailscale0` interface is trusted (covers the general LAN-facing traffic
the subnet router forwards), PLUS the Tailscale UDP port itself is explicitly opened
(`allowedUDPPorts = [ config.services.tailscale.port ]`, needed for the underlying
WireGuard/DERP traffic — the interface-trust rule alone doesn't cover the daemon's own listen
port before a peer session exists). Net effect: every service on the trusted Tailscale
interface gets implicit reachability with no per-service port allowlist to maintain, while the
node's own Tailscale role stays constrained to subnet-router only. Rationale for leaving the
macOS side of the same fleet unmanaged: a GUI-managed macOS app doesn't fit cleanly into a
declarative nix-darwin/Home-Manager module the way a NixOS `services.tailscale` module does —
so the fleet's Nix config manages the NixOS side declaratively and leaves macOS to be
maintained manually (installed once via the app/CLI, kept authenticated by logging in).

**Snap-packaged Tailscale on WSL can fail SSH shell exec with a sandbox restriction.** Symptom:
SSH connects, ACL passes, but fails with `be-child ssh` exit code 1 in `tailscaled` logs
(`sudo journalctl -u snap.tailscale.tailscaled -n 30`). Cause: snap sandbox restrictions prevent
SSH shell execution. Fix: `sudo snap remove tailscale`, install via the apt path instead
(`curl -fsSL https://tailscale.com/install.sh | sh`), `sudo tailscale up --ssh`. **Gotcha:** the
new install may assign a different Tailscale IP — check with `tailscale status --self`.

**WSL2 in general should run Tailscale on the WINDOWS HOST, not inside the WSL2 VM** — the shared
network stack causes conflicting WireGuard tunnels if both run Tailscale; access from inside
WSL2 via `tailscale.exe`, requiring `appendWindowsPath = true` under `[interop]` in
`/etc/wsl.conf`.

**Install `tailscaled` via apt, not Homebrew, inside WSL — systemd unit ownership matters.** apt
ships a root **system** unit (`/usr/lib/systemd/system/tailscaled.service`) that starts at boot —
required for a headless daemon. `brew services` on Linux defaults to a `--user` unit that can't
own the TUN device and needs `loginctl enable-linger` to survive logout. Install: source
`/etc/os-release` for `$VERSION_CODENAME`, download the Tailscale apt keyring + repo list for that
codename, `apt install tailscale`, `systemctl enable --now tailscaled`, `tailscale up` (add
`--ssh` only when that path is wanted).

**Ubuntu 23.10+/24.04 `ssh.socket` silently overrides a custom sshd `Port`** (general SSH
hardening fact tagged alongside Tailscale-host setups, not Tailscale-specific but load-bearing on
a Tailscale-fronted box): the package enables `ssh.socket` (socket activation on port 22), which
overrides any custom `Port` set in `sshd_config`. Fix:
```bash
sudo systemctl disable --now ssh.socket && sudo systemctl enable --now ssh.service
sudo ss -tlnp | grep <port>   # confirm
```
Silent failure mode — the drop-in config is accepted, the daemon just keeps listening on 22
anyway. Corroborated identically in two files of the same source unit. `[unverified — carried
from prior merge pass]`

**Unattended-boot readiness checks (dedicated always-on Tailscale worker):**
```bash
systemctl is-enabled tailscaled
systemctl is-active tailscaled
systemctl is-enabled NetworkManager
```
For a dedicated always-on worker, disable sleep only **after owner approval**:
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```
Undo with `systemctl unmask` on the same target list. `[unverified — carried from prior merge
pass]`

**Move a Wi-Fi credential from the user's secret-agent wallet to the system NetworkManager
profile for headless boot** (if the worker appears only after graphical login):
```bash
nmcli -g connection.id,connection.permissions,connection.autoconnect,802-11-wireless-security.psk-flags connection show '<connection>'
# psk-flags=1 means a user secret agent (KDE Wallet) owns the password — unavailable before login
read -rsp 'Wi-Fi password: ' WIFI_PSK; echo
sudo nmcli connection modify '<connection>' 802-11-wireless-security.psk "$WIFI_PSK" 802-11-wireless-security.psk-flags 0 connection.permissions '' connection.autoconnect yes; unset WIFI_PSK
```
**Gotcha:** only do this on a trusted, physically secure worker whose administrators may access
that credential. Prefer wired Ethernet for unattended servers. `[unverified — carried from prior
merge pass]`

**WSL2 and Docker container DNS inherit from — and can diverge from — the host.** WSL2
auto-generates `/etc/resolv.conf` per `/etc/wsl.conf`'s `[network] generateResolvConf` setting
(Windows-side DNS hooks like NRPT/AV don't propagate into WSL2 unless configured to share); fix
pattern is `generateResolvConf=false` + writing a static `/etc/resolv.conf`. Docker containers
inherit host DNS by default (`--network=host` follows host config exactly);
`docker exec <c> cat /etc/resolv.conf` shows what the container actually sees, separate from the
host's own resolution chain. Environment detection: check `/proc/sys/fs/binfmt_misc/WSLInterop`,
`grep -qi microsoft /proc/version`, `/.dockerenv`, or `docker|containerd|kubepods` in
`/proc/1/cgroup`.

**Serve persistence across reboot is conditional, not automatic** — `--bg` config persists via
`/var/lib/tailscale/serve-config.json`, but ONLY if `tailscaled` is an enabled system service
(`systemctl enable tailscaled`). See `../DECISIONS.md` D5 (this exact fact reconciled from two
sources that each stated only half the condition).

### Policy routing table 52 — the VRF analogy and Docker namespace caveat

Tailscale installs subnet routes into a separate routing table (52) plus `ip rule` entries
(priority-based, e.g. `5270: from all lookup 52`) so as not to conflict with existing main-table
routes to the same CIDR. Analogous to a Cisco/MPLS VRF but priority-rule-based rather than
interface-based. Inside a Docker container, table 52 lives in the container's own netns — check
with `docker exec <c> ip route show table 52`, not from the host.

### Subnet-router "iptables vs nftables" firewall backend mismatch

Symptom: route advertised, Tailscale overlay healthy, LAN services still unreachable through the
router. Root cause: container assumes iptables but host kernel uses nftables (or vice versa). Fix:
`TS_DEBUG_FIREWALL_MODE=nftables` (or `iptables`, matching host) set as a container env var. This
is a high-frequency root cause specific to containerized subnet routers.

### Container router diagnostic commands (Docker/Podman)

```bash
docker ps                                                          # or: podman ps
docker logs <ROUTER_CONTAINER> --tail 200
docker exec -it <ROUTER_CONTAINER> tailscale status
docker exec -it <ROUTER_CONTAINER> tailscale ip -4
docker exec -it <ROUTER_CONTAINER> ping -c 3 <LAN_TARGET_IP>
docker exec -it <ROUTER_CONTAINER> nc -vz <LAN_TARGET_IP> <TARGET_PORT>
docker exec -it <ROUTER_CONTAINER> sh -lc 'ip route'
docker exec -it <ROUTER_CONTAINER> sh -lc 'env | grep ^TS_'
docker exec -it <ROUTER_CONTAINER> sh -lc 'sysctl net.ipv4.ip_forward'
```
For Podman, substitute `podman` for `docker` throughout. This gives an inside-the-container view
that separates overlay health from LAN-forwarding health.

### Safe subnet-router replacement/cutover procedure

1. Keep the existing router available but STOPPED — do not delete until the replacement is proven
   stable.
2. Prepare the replacement with a distinct hostname + separate state volume — never reuse the
   same state path while testing a separate node identity.
3. Stop the existing router before starting the replacement (if both use host networking on the
   same host).
4. Start the replacement, verify route advertisement:
   `docker exec -it <ROUTER_CONTAINER> tailscale status` — confirm `<SUBNET_CIDR>` is advertised.
5. Approve the new node's route in the admin console — "this step is easy to miss and blocks real
   traffic."
6. Verify from a client: `tailscale ping <ROUTER_NODE>`, `tailscale status`, check the route
   table, `ping -c 3 <LAN_TARGET_IP>`, `nc -vz <LAN_TARGET_IP> <TARGET_PORT>`.
7. If the replacement fails, stop it and reactivate the previous router — "keep rollback simple
   and fast."

This is a zero-downtime, reversible router-swap procedure.

**Placeholder convention used in subnet-router playbooks:** `<SUBNET_CIDR>` (advertised private
subnet, e.g. `10.0.1.0/24`), `<LAN_TARGET_IP>` (known-reachable host on the subnet, e.g.
`10.0.1.50`), `<TARGET_PORT>` (service port, e.g. `443`), `<ROUTER_NODE>` (Tailscale node name or
`100.x.y.z` IP of the router, e.g. `subnet-router-1`), `<ROUTER_CONTAINER>` (Docker/Podman
container name, e.g. `ts-subnet-router`), `<ROUTER_LAN_IP>` (router host's LAN IP, e.g.
`10.0.1.1`) — resolvable variables an invoking agent must fill in from the user's environment
before executing any of the commands above.

---

## 9. Docker / containers

**`containerboot` (the official `tailscale/tailscale` image entrypoint) defaults to USERSPACE
networking regardless of granted capabilities**, unless `TS_USERSPACE=false` is explicitly set —
true even with `NET_ADMIN` + `/dev/net/tun` present. Symptom: `tailscale ping <peer>` works
(handled in userspace) but real `ping`/routes fail; no `tailscale0` interface appears. Capabilities
alone do NOT switch kernel mode.

**`/dev/net/tun` must use `devices:`, not `volumes:`, in Docker Compose.** `volumes:
[/dev/net/tun:/dev/net/tun]` bind-mounts a **file copy**, not the character device (major/minor
`10, 200`) — use `devices:` instead. Verify: `ls -la /dev/net/tun` expects
`crw-rw-rw- ... 10, 200`. Using the wrong directive silently falls back to userspace mode.

**Docker DNS resolver chain and why MagicDNS breaks in containers.** Docker always sets
`nameserver 127.0.0.11` (embedded DNS) in the container's `resolv.conf`. Without
`dns: [100.100.100.100]` in compose, ExtServers falls back to the host's `resolv.conf` (often
`127.0.0.53` systemd-resolved), which knows nothing about `.ts.net`. Even with `dns:` set, if the
container has no route for `100.100.100.100` (userspace/no TUN) it escapes via the Docker bridge
to the HOST's own Tailscale, which may answer wrong (different tailnet) or NXDOMAIN. **Gotcha:**
Docker also copies the host's `resolv.conf` `search` domain — short-name lookups append the WRONG
tailnet suffix if host and container are on different tailnets; fix with
`dns_search: [<correct-tailnet>.ts.net]`.

**Docker's embedded DNS intercepts container names that collide with Tailscale hostnames.** If a
Tailscale hostname matches a compose service name, Docker's embedded DNS answers with the Docker
bridge IP instead of forwarding to Tailscale. `ping <service-name>` → bridge IP (172.18.x.x);
`ping <service-name>.<tailnet>.ts.net` → correct Tailscale IP. This explains traffic silently
bypassing the encrypted tailnet tunnel between same-host containers.

**Minimum working Compose block for kernel-mode Tailscale + MagicDNS:**
```yaml
services:
  node:
    image: tailscale/tailscale:latest
    hostname: my-node
    dns: [100.100.100.100]
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_HOSTNAME=my-node
      - TS_EXTRA_ARGS=--advertise-tags=tag:lab
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_ACCEPT_DNS=true
      - TS_USERSPACE=false
    volumes: [node-state:/var/lib/tailscale]
    devices: [/dev/net/tun:/dev/net/tun]
    cap_add: [NET_ADMIN, SYS_MODULE]
```
Every listed setting fixes one specific failure mode if removed (a table in the source enumerates
which). `[unverified — the exact per-setting breakdown table is not included here]`

**Env-var union across sources** (official image, `containerboot`): `TS_AUTHKEY`, `TS_HOSTNAME`,
`TS_STATE_DIR` (default `/var/lib/tailscale/` — MUST be a Docker volume, see below),
`TS_EXTRA_ARGS`, `TS_ROUTES`, `TS_DEST_IP` (proxy mode: forward ALL traffic to this IP),
`TS_USERSPACE`, `TS_ACCEPT_DNS`, `TS_ENABLE_HEALTH_CHECK`, `TS_ENABLE_METRICS`, `TS_KUBE_SECRET`
(k8s — see below), `TS_AUTH_ONCE=true` (don't re-auth on restart), `TS_SNAT_SUBNET_ROUTES`,
`TS_DEBUG_FIREWALL_MODE` (e.g. `nftables`, explicit backend matching host kernel), `TS_SERVE_CONFIG`
(path to a serve-config JSON file).

**ALWAYS mount a named volume at `TS_STATE_DIR`.** Without persistence, the container
RE-AUTHENTICATES on every restart and creates a NEW device entry in the tailnet each time
(orphaning the old one). Persist for a long-running container that must keep a stable node
identity; use ephemeral mode only for genuinely disposable jobs. Never bake auth keys into
Dockerfiles or committed compose files — inject from the runtime platform's secret store.

**Docker container environment for `tailscale/tailscale` — persist state for stable identity, or
ephemeral for disposable jobs:**
```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}
      TS_STATE_DIR: /var/lib/tailscale
      TS_USERSPACE: "false"
    volumes:
      - tailscale-state:/var/lib/tailscale
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add: [NET_ADMIN, SYS_MODULE]
volumes:
  tailscale-state:
```
Userspace networking (`TS_USERSPACE: "true"`) is needed when the container can't create a TUN
device, but changes how traffic reaches local services.

**Sidecar pattern** — `network_mode: service:app` shares the app container's network namespace so
the app becomes reachable on the tailnet **without modifying its image**:
```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    network_mode: service:app
    environment: [TS_AUTHKEY=tskey-auth-..., TS_HOSTNAME=my-app, TS_STATE_DIR=/var/lib/tailscale]
    volumes: [tailscale-state:/var/lib/tailscale]
    cap_add: [NET_ADMIN]
  app: {image: nginx:alpine}
volumes: {tailscale-state:}
```
Mount `/dev/net/tun` + `cap_add: NET_ADMIN` for kernel-mode networking (subnet routing, exit
nodes, higher throughput) — WITHOUT these the container automatically falls back to userspace
mode.

A second sidecar shape shares a network namespace the other direction (app depends on the
tailscale container):
```yaml
services:
  tailscale:
    image: tailscale/tailscale
    cap_add: [NET_ADMIN, NET_RAW]
    volumes: [tailscale-state:/var/lib/tailscale, ./serve.json:/config/serve.json]
    environment: {TS_AUTHKEY: tskey-auth-..., TS_EXTRA_ARGS: --hostname=my-service, TS_SERVE_CONFIG: /config/serve.json}
  app:
    image: my-app:latest
    network_mode: service:tailscale
volumes: {tailscale-state: {}}
```

**Docker sidecar / Kubernetes DaemonSet deployment, restated with `cap_add` lowercase form:**
docker-compose sidecar: `image: tailscale/tailscale:latest`, env `TS_AUTHKEY`,
`TS_STATE_DIR=/var/lib/tailscale`, `TS_EXTRA_ARGS=--advertise-tags=tag:container`; volumes
`tailscale-state:/var/lib/tailscale`, `/dev/net/tun:/dev/net/tun`;
`cap_add: [net_admin, sys_module]`; `restart: unless-stopped`. K8s DaemonSet: Secret with
`TS_AUTHKEY`; container env `TS_AUTHKEY` (secretKeyRef), `TS_KUBE_SECRET: tailscale-state`,
`TS_USERSPACE: "true"`; `securityContext.capabilities.add: ["NET_ADMIN"]`.

**Userspace-only sidecar with no NET_ADMIN/TUN device at all** (`tailrelay` pattern): entrypoint
`tailscaled --tun=userspace-networking --socks5-server=localhost:1055`, health at
`:9002/healthz`, metrics at `:9002/metrics`.

**K8s DaemonSet:**
```yaml
env:
  - {name: TS_AUTHKEY, valueFrom: {secretKeyRef: {name: tailscale-auth, key: TS_AUTHKEY}}}
  - {name: TS_KUBE_SECRET, value: tailscale-state}
  - {name: TS_USERSPACE, value: "true"}
securityContext: {capabilities: {add: ["NET_ADMIN"]}}
```
`TS_USERSPACE=true` avoids the `NET_ADMIN`/`/dev/net/tun` requirement in restricted k8s
environments (paired with `sys_module` in some sources / no-tun setups).

**K8s sidecar Pod manifest (non-operator, `hostNetwork: true`):**
```yaml
apiVersion: v1
kind: Pod
metadata: {name: tailscale-proxy}
spec:
  hostNetwork: true
  containers:
    - name: tailscale
      image: tailscale/tailscale:latest
      env:
        - {name: TS_AUTHKEY, valueFrom: {secretKeyRef: {name: tailscale-auth, key: TS_AUTHKEY}}}
        - {name: TS_ROUTES, value: 10.244.0.0/16,10.96.0.0/12}
        - {name: TS_KUBE_SECRET, value: tailscale-proxy-state}
      securityContext: {capabilities: {add: [NET_ADMIN, SYS_MODULE]}}
```
`[unverified — carried from prior merge pass]`

**Subnet-router "known-good" configuration matrix** (diff a broken deployment against this):

| Setting | Value |
|---|---|
| Network mode | `host` (`--network=host` / `network_mode: host`) |
| Subnet advertisement | `TS_ROUTES=<SUBNET_CIDR>` (or `tailscale set --advertise-routes=<SUBNET_CIDR>`) |
| SNAT | enabled — `TS_SNAT_SUBNET_ROUTES=true` or default |
| Firewall backend | explicit, matching host kernel: `TS_DEBUG_FIREWALL_MODE=nftables` |
| IP forwarding | enabled on host: `sysctl -w net.ipv4.ip_forward=1` |
| State volume | dedicated, unique per router instance |
| Hostname | distinct per router instance |

**Safety invariant: never run two host-network, kernel-mode Tailscale router containers on one
host simultaneously.** Risks: competing packet-filter rule changes, ambiguous route ownership,
conflicting route advertisements, hard-to-diagnose intermittent failures. Only ONE such container
active per host at any time. `[unverified — carried from prior merge pass]`

**Docker services bound to `127.0.0.1` are still reachable via the host's Tailscale IP.**
`ports: ["127.0.0.1:8200:8200"]` restricts a service to localhost yet remains reachable at
`http://<tailscale-ip>:8200` from other tailnet members — this is a **deliberate hardening
pattern** (avoids full public exposure, since "Docker bypasses UFW"), not a bug. Separately, an
unmodified container also resolves tailnet MagicDNS hostnames + `100.x.x.x` IPs without any
`extra_hosts`/`network_mode: host` patch, because Docker copies the host's `resolv.conf` (pointing
at the Tailscale resolver) into the container by default.

**Docker bypasses UFW by manipulating iptables directly — published container ports can stay
publicly reachable.** Docker writes its own iptables rules that UFW does not see, so a
`docker run -p 3000:3000 ...` can remain publicly reachable even with UFW fully configured to deny
incoming. Mitigations: bind published container ports to loopback only
(`-p 127.0.0.1:3000:3000`); rely on the cloud provider's OWN firewall (Hetzner Firewall / AWS
Security Groups) as the outer, iptables-independent layer — allow UDP 41641 inbound for direct
Tailscale WireGuard, block everything else inbound, allow all outbound; or adopt `ufw-docker`
(github.com/chaifeng/ufw-docker) for tighter Docker+UFW integration. Also check
`/etc/default/ufw` has `IPV6=yes` — otherwise IPv6 traffic bypasses UFW entirely.

**Docker entrypoint gotchas for `tailscaled`:** add external DNS BEFORE starting `tailscaled` if
the entrypoint needs to resolve non-tailnet hosts:
```bash
echo "nameserver 8.8.8.8" >> /etc/resolv.conf
echo "nameserver 8.8.4.4" >> /etc/resolv.conf
```
Never `wait $TAILSCALED_PID` in the entrypoint (blocks `docker compose up -d`) — use
`sleep infinity` instead.

**Certificate provisioning can fail inside a container reaching Headscale/ACME.** `tailscale cert`
fails inside Docker with `500 ... acme.GetReg: dial tcp: lookup acme-v02... on
[fd7a:115c:a1e0::53]:53: server misbehaving` because Tailscale's MagicDNS has overwritten
`/etc/resolv.conf` to ONLY use `100.100.100.100`, making external ACME-server DNS unresolvable.
Fix: use `tailscale serve --bg "http://${FQDN} http://backend:8080"` (handles HTTPS/ACME
internally without external DNS for cert generation), OR add external nameservers (`8.8.8.8`,
`8.8.4.4`) to `/etc/resolv.conf` **before** `tailscaled` starts in the entrypoint. `[unverified —
not independently re-confirmed]`

### Docker containers on a Tailscale-enabled host reach tailnet hostnames + 100.x IPs WITHOUT any extra_hosts/network_mode changes

"Test first. On any machine that runs Tailscale, [`extra_hosts`, `host.docker.internal` patching,
binding to `0.0.0.0`, `network_mode: host`] patches are typically unnecessary." Docker copies the
host's `/etc/resolv.conf` into the container by default (unless `--dns` overridden); on a
Tailscale host that `resolv.conf` points at the Tailscale userspace resolver
(`100.100.100.100`), so MagicDNS hostnames + `100.x.x.x` IPs resolve from inside an unmodified
container. This avoids hours of unnecessary docker-compose/infra changes. **Gotcha:** verify with
a diagnostic FIRST, not by assuming the textbook fix is needed. Reproduced with a concrete 3-URL
test returning 200 for all: MagicDNS hostname, tailnet IP, and `host.docker.internal`.

**Diagnostic one-liner: test container→host reachability before proposing infra patches**
```bash
docker exec <container> python3 -c \
  "import urllib.request, sys; \
   url=sys.argv[1]; \
   r=urllib.request.urlopen(url, timeout=3); \
   print(url, r.status)" \
  "http://<hostname-or-ip>:<port>/<healthcheck-path>"
```
If 200 → no infra change needed, fix the consumer config instead. If it fails → THEN consider
Tailscale-not-in-resolv-chain (`extra_hosts`), a container's own custom `dns:` override, or a
genuinely docker-internal-only bind.

**`lsof` showing a `127.0.0.1`-only bind does not mean unreachable from a container** (Lima/VM
port-forward case). On macOS, `lsof -nP -iTCP:11434` showing `ollama … TCP 127.0.0.1:11434
(LISTEN)` looks loopback-only, but it's still reachable from containers because Lima's VM
port-forward layer accepts the connection on the host's tailnet IP and forwards it into the VM.
"Don't treat the lsof bind address as authoritative for 'is this reachable from a container' —
test from the container."

### macOS/OrbStack Docker VM proxy propagation — 4 distinct sub-failures, each with its own fix

Applies when running Docker (OrbStack / Docker Desktop) on **macOS** while a host TUN proxy
(Shadowrocket/Clash/Surge) is also active. Root cause family: VM-based Docker runtimes run the
daemon inside a lightweight VM whose outbound traffic takes a **different** network path than host
processes (`Host curl: process → TUN → landing proxy → internet` vs
`VM Docker: daemon → VM bridge → host network → TUN → ???`), and the TUN may not correctly handle
VM-bridged traffic (different TCP stack/MTU/keepalive). **`docker pull` and `docker build` use
DIFFERENT proxy config paths — fixing one does NOT fix the other:**

| Operation | Proxy source |
|---|---|
| `docker pull` | Docker daemon config (`~/.orbstack/config/docker.json` or `docker info`) |
| `docker build` (`RUN apt/apk`) | Build-container env (`--build-arg http_proxy=` or `--network host`) |
| `docker run` | Container env (`-e http_proxy=` or inherited from daemon) |

`docker pull` is controlled by the Docker daemon config; `docker build`'s `RUN apt/apk` commands
are controlled by the BUILD CONTAINER's own env (`--build-arg http_proxy=...` or
`--network host`); `docker run` containers get env from `-e http_proxy=...` or inherit the
daemon's. Fixing `docker.json` alone does NOT fix `docker build` — `RUN` steps don't inherit
daemon proxy settings. Diagnose which is broken with three probes: `docker pull --quiet
alpine:latest`; `docker build --no-cache - <<EOF\nFROM alpine:latest\nRUN apk update...`;
`docker run --rm alpine:latest sh -c "apk update"`.

- **Sub-failure 1 — `docker build` RUN fails instantly.** `RUN apk add`/`apt-get install` inside
  `docker build` fails `Connection refused` in <0.2s even though host `curl` works. Cause:
  OrbStack's `network_proxy: auto` creates a TRANSPARENT proxy inside the VM that intercepts
  HTTPS; when the host TUN is also active, the transparent proxy's upstream breaks and redirects
  HTTPS to `127.0.0.1` inside the VM (nothing listening — smoking-gun diagnostic:
  `docker run --rm alpine:latest sh -c "wget -q --timeout=5 -O /dev/null https://dl-cdn.alpinelinux.org/"`
  → `can't connect to remote host (127.0.0.1): Connection refused`). Fix:
  `docker build --network host -f Dockerfile -t myimage .` bypasses the VM bridge entirely
  (trade-off: loses build-time network isolation — fine for local dev, prefer fixing daemon proxy
  config for CI/CD).
- **Sub-failure 2 — fix `docker pull` via `docker.json`, using `host.internal`, never
  `127.0.0.1` or `host.docker.internal`.**
  ```json
  {"proxies": {"http-proxy": "http://host.internal:1082", "https-proxy": "http://host.internal:1082",
   "no-proxy": "localhost,127.0.0.1,::1,192.168.128.0/24,100.64.0.0/10,host.internal,*.local"}}
  ```
  then a FULL restart: `orbctl stop && sleep 3 && orbctl start` (reload alone is insufficient).
  `host.internal` is OrbStack-specific and resolves to the real host IP from inside the VM;
  `127.0.0.1` inside the VM is VM-loopback (nothing listening there); `host.docker.internal`
  "may not resolve in all contexts." **`orbctl config set network_proxy none` does NOT clean up
  the cached `docker.json`** — the stale proxy persists (diagnose with `docker info | grep -i
  proxy` showing a proxy even though `orbctl config get network_proxy` says `none`).
- **Sub-failure 3 — decision matrix, and removing the proxy makes it WORSE:**

  | Docker config | Traffic path | Result |
  |---|---|---|
  | Proxy ON (`127.0.0.1`), no `no-proxy` | Docker→VM proxy→??? | pull may work, LOCALHOST PROBES BROKEN |
  | Proxy ON (`host.internal`) + `no-proxy` | external via host proxy; local direct | BOTH WORK |
  | Proxy OFF (`network_proxy: none`) | Docker→VM bridge→host→TUN→internet | TLS handshake TIMEOUT (counter-intuitive) |
  | `--network host` (build only) | build container→host network→TUN→internet | build WORKS |

- **Sub-failure 4 — healthchecks fail silently from lowercase `http_proxy` env leaking in.**
  Symptom: compose healthcheck shows `(unhealthy)` while the app runs fine; logs show `wget:
  can't connect to remote host (127.0.0.1): Connection refused` (a proxy port, not the app port).
  Docker inherits BOTH uppercase and lowercase proxy env vars from the host; clearing only
  `HTTP_PROXY=` forgets `http_proxy=`. Fix: clear both cases explicitly in compose —
  `HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= NO_PROXY=* no_proxy=*`. Prefer
  `curl http://127.0.0.1:PORT` over `curl http://localhost:PORT` in probe URLs — some proxy
  implementations only string-match the literal `"localhost"`, not its resolved IP. Verify with
  `docker exec <container> env | grep -i proxy` (expect nothing set).

`[confidence HIGH — 4-source convergent; an earlier revision had recommended keeping
\`127.0.0.1\` in the proxy config, but the corrected \`host.internal\` guidance above is the
current one]`

### Three coexisting "Tailscale in this repo" architectures — don't combine two of them for the same box

(1) OS-baked daemon (systemd service in the image — box owns its own tailnet identity), (2)
tailscale-as-a-tool inside a nested-container harness (rootless podman with Tailscale-backed
outbound), (3) deploy-time sidecar container giving the app pod a tailnet identity without baking
the daemon into the app image. "All three can coexist, but for most cases you want exactly one."
`[confidence MED]`

---

## 10. NAS / router / appliance integration

**Synology/QNAP native packages:** install from Package Center / App Center; auth via the
admin-console link shown in the package UI; enable subnet routing IN the package UI to advertise
the NAS's local network. ACL advice: target the NAS's tailnet IP directly rather than relying on
hostname resolution, since NAS services often run on non-standard ports.

**TrueNAS SCALE:** community app via TrueCharts. **TrueNAS CORE (FreeBSD):**
```sh
pkg install tailscale
sysrc tailscaled_enable="YES"
service tailscaled start
tailscale up --authkey=tskey-auth-...
```
Configure the app's data path to a PERSISTENT location (e.g. `/mnt/pool/tailscale`) so state
survives app updates.

**OpenWrt:** `opkg update && opkg install tailscale`, enable+start via init.d, enable IP
forwarding + add a firewall zone for `tailscale0` forwarding to `lan` (via LuCI Network >
Firewall). **pfSense has NO official Tailscale package** — the recommended workaround is a
dedicated Linux VM acting as a subnet router, with pfSense routing the tailnet CIDR
`100.64.0.0/10` to that VM. **OPNsense DOES have a community plugin** (`os-tailscale`) — configure
via Services > Tailscale in the OPNsense UI, then approve routes in the admin console as usual.

---

## 11. iOS / Android / mobile

**Coverage is THIN here — treat everything in this section as a starting point, not exhaustive
mobile guidance.**

- **Always use the `https://<node>.<tailnet>.ts.net` Serve URL on mobile, never `127.0.0.1`,
  `localhost`, or a LAN IP** — repeated across sources as the standard client-verification
  pattern for a Serve-exposed service:
  - iOS checklist: connect the phone to the SAME tailnet, confirm it's online (`tailscale status`
    or admin console), open ONLY the HTTPS `.ts.net` URL from `tailscale serve status` (never
    `127.0.0.1`/`localhost`/LAN IP on the phone unless intentionally targeting itself/LAN); if the
    URL fails on both phone and serving machine, run `tailscale cert` on the serving machine
    before assuming an app bug.
  - "On Android, keep Tailscale connected, open the reported HTTPS URL, authenticate, and add the
    page to the home screen. Android Always-on VPN can keep Tailscale connected; do not enable
    'block connections without VPN' unless that is explicitly desired [it can prevent the
    Tailscale app itself from reconnecting]." `[confidence MED — single-source, Android-specific]`

  **Caution on over-generalizing this into an HTTP-is-blocked claim:** nothing here asserts that
  iOS Safari refuses plain-HTTP requests to non-localhost hosts, and that broader claim should NOT
  be inferred from "always use the HTTPS `.ts.net` URL" — the guidance above is about
  identity/cert correctness through Tailscale Serve, not a browser secure-context
  restriction. (In fact iOS Safari loads plain-HTTP pages fine; it withholds only *secure-context*
  browser APIs — WebAuthn, clipboard, camera, service workers — not page loads.) If any other
  source is later found asserting iOS blocks HTTP outright, record it here as
  `[unverified — contradicted]` rather than repeating it as fact.

- **Android via Termux — GPU-host access setup:** use the **F-Droid** build of Termux, not the
  Play Store version ("unmaintained and won't `pkg update` cleanly"). Install the official
  Tailscale Android app from the Play Store, sign in with the tailnet's owning account, then in
  the admin console tag the device `tag:mobile` (optionally enable subnet routing if the phone
  needs to reach another tag's LAN). Verify with `tailscale status` inside Termux listing the GPU
  host, then `ping -c 3 <gpu-host-tailscale-ip>`. `tailscale ping`'s "Direct" vs "Relay" indicator
  in the app distinguishes NAT-traversal success from fallback DERP relay.

- **Wireless ADB deploy over Tailscale (Android) — TCP mode must be fixed via USB once per
  boot.** Android's Developer-Options "Wireless Debugging" only works over the SAME WiFi network.
  To deploy over ANY network (including cellular, via Tailscale), the ADB daemon must first be
  switched to TCP mode over a one-time USB connection:
  ```bash
  adb devices          # confirm state=device
  adb tcpip 5555
  # disconnect USB — the phone now listens on port 5555 over any network reachable via its Tailscale IP
  ```
  This must be repeated after every phone reboot (TCP mode does not survive a reboot). If no USB
  device is detected, the skill surfaces a mandatory notice and lets the user either confirm
  `adb tcpip 5555` was already run, explicitly opt into the WiFi-only Wireless-Debugging path
  instead, or cancel — it never silently assumes either path.

- **Resolving an Android device's Tailscale IP for ADB:** `resolve-device.sh <hostname>` first
  queries `tailscale status --json`, matches the peer whose `.Peer[].HostName == <hostname>`, and
  returns `.TailscaleIPs[0]` if `Online == true` (exit 2 if found-but-offline, distinct from exit 1
  not-found). If no exact peer match, falls back to `tailscale ip -4 <hostname>` (MagicDNS) — this
  also means `adb connect my-phone.tailnet-name.ts.net 5555` works directly without any prior IP
  lookup, useful for manual debugging. `tailscale ping <device_hostname>` from the Mac is the quick
  "is it actually reachable" sanity check independent of ADB. On macOS, the App Store Tailscale
  build does not put the CLI on PATH by default — fix once:
  `sudo ln -s /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale`.

- **Auto-discovering Android peers for ADB tooling:** filter `tailscale status --json` by
  `.OS == "android"` (to auto-suggest candidate device hostnames instead of asking the user to
  type one blind):
  ```bash
  tailscale status --json | jq -r '(.Peer // {}) | to_entries[] | .value | select(.OS == "android") | "\(.HostName)|\(if .Online then "online" else "offline" end)"'
  ```
  Each `Peer` entry's `.OS` field (`"android"`, `"linux"`, `"macos"`, `"windows"`, `"ios"`, etc. —
  confirmed independently across a separate device-record field table in another unit) is the
  general discriminator for OS-specific device tooling built on top of `tailscale status --json`.

- **iOS device install — two paths (Xcode direct vs Tailscale-served OTA link):** Path 1
  (preferred, requires the Mac to recognize the real device): run `./run-local-device-fast.sh`
  (build+install+launch), optionally `CONSOLE=1 ./run-local-device-fast.sh` for live logs. Path 2
  (manual link install via Tailscale OTA, for when Xcode can't see the device or the user only
  wants a link): export a `.ipa`, serve it via Tailscale HTTPS with a Safari-openable install
  link. Decision rule: if the user says "direct install" but `xcodebuild -showdestinations` shows
  no concrete device UDID (only "Any iOS Device"), device pairing/trust/Developer-Mode/Wi-Fi
  debugging isn't set up — fall back to OTA. **If ambiguous, always ASK the user which path before
  proceeding, never assume.**

- **iOS OTA install script — `tailscale serve` as the HTTPS front for an `itms-services`
  manifest.** Full pipeline: `xcodebuild archive` (generic/platform=iOS destination) →
  `xcodebuild -exportArchive` with an `ExportOptionsPlist` (`method: debugging`,
  `signingStyle: automatic`, explicit `teamID`) → extract `CFBundleIdentifier`/
  `CFBundleVersion`/display name from the exported `.ipa`'s `Info.plist` via Python
  `zipfile`+`plistlib` → generate `manifest.xml` (a plist, NOT XML markup, describing
  `software-package`/`display-image`/`full-size-image` asset URLs) + an `index.html` with an
  `itms-services://?action=download-manifest&url=https://<host>/manifest.xml` link → serve
  locally with `launchctl submit ... python3 -m http.server <port> --bind 127.0.0.1`
  (loopback-only) → `tailscale serve --yes --bg <port>` exposes it as HTTPS over the tailnet →
  curl-verify both `manifest.xml` and the `.ipa` are reachable over `https://$TAILSCALE_DNS/`
  before printing the install URL. Discovers the tailnet HTTPS hostname via
  `tailscale status --json | jq -r '.Self.DNSName // empty'`. `tailscale serve` here turns an ad
  hoc local HTTP server into a TLS-terminated tailnet-only URL Safari can install an
  unsigned/dev-provisioned app from, with zero public exposure (loopback bind + tailnet-only
  serve). **Gotcha:** iOS "unable to install/verify" almost always means the device's UDID isn't
  in the development provisioning profile (needs re-registration + re-signing) — the script
  prints exactly that hint on failure. Download failure after the link opens → check the iPhone's
  Tailscale connection and `tailscale serve status`.

  *Serve-vs-direct scope note:* this `tailscale serve` use is a purpose-built, narrow case —
  exposing a LOOPBACK-bound local HTTP server as a tailnet-only HTTPS endpoint for exactly two
  static files (`manifest.xml`, the `.ipa`) plus an `index.html`, so an iPhone's Safari can trigger
  an OTA install via `itms-services://`. No reverse-proxy of a dynamic app, no websockets, no SPA
  routing involved — so none of the well-known `tailscale serve` incompatibilities (static asset
  rewriting, websocket upgrade issues, SPA client-side routing) are exercised or reported here. The
  script verifies reachability post-serve with `curl -fsSI https://$TAILSCALE_DNS/manifest.xml`
  and the `.ipa` URL before declaring success — a good pattern to carry forward generally.

- **Funnel is unavailable on iOS, Android, and the macOS App Store build** — only Linux and the
  macOS open-source variant support `tailscale funnel`. (Cross-referenced from §6 — repeated here
  because it directly bounds what a mobile client can host.)
  `[unverified — not independently re-confirmed]`

- **Taildrop on iOS/Android:** native Share menu → select Tailscale.

- **Taildrive on iOS/Android:** ACCESS-ONLY via the Tailscale app — cannot act as the
  server/share side.

- **Subnet routing on Android:** app > Settings > Subnet routing > Add route > enter CIDR.

- **Android devices in Tailnet Lock:** can RECEIVE signatures but CANNOT sign.

- **Remote desktop:** the Windows App client is available on iOS/Android for RDP.

- **Exit node role possible on Android** (Tailscale app > Exit Node > Run as exit node) —
  battery-intensive, keep plugged in; performance limited by userspace routing. Using an exit
  node client-side works from iOS/Android via the in-app Exit Node selector.

---

## 12. Agent / automation integration patterns

**tmux persistent sessions + read-only monitoring pattern for remote agents:**
```bash
tmux new -s issue-123
# detach: Ctrl-b then d
tmux ls
tmux attach -t issue-123
tmux kill-session -t issue-123
# read-only monitoring that doesn't interrupt an agent:
tmux capture-pane -p -t issue-123 -S -100
git -C <worktree> status --short --branch
```
Do not send keys/signals merely to check progress.

**sc-sync — Tailscale as the rsync transport for gitignored files between two machines, role
determined by an explicit env var, never `hostname`.** `SYNC_ROLE=vps|local` (explicit, never
sniffed from `hostname` — "leaks a real, personally-identifying hostname into logs and breaks the
moment either machine is renamed") crossed with a requested direction (`vps-local`/`local-vps`)
via a pure `route()` function determines push vs pull. Requires SSH reachable over Tailscale on
the non-invoking side; explicitly calls out that **Windows OpenSSH Server is NOT on by default**
and must be enabled (`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`) before a
sync targeting a Windows box will connect. Useful for rsync over Tailscale between machines that
can't reach each other via plain scp (NAT/dynamic IP/firewall).

**macOS Keychain pattern to avoid passwords in shell history/argv:**
```bash
security add-generic-password -U -a "<account>" -s "<service>" -w   # keep -w LAST so it prompts interactively
security find-generic-password -a "<account>" -s "<service>"        # verify existence without reading the secret
```

**Remotehost skill: an explicit invocation gate before ANY Tailscale sharing action.** A skill that
will run `tailscale up`/`serve`/`funnel` on the user's behalf gates itself behind an explicit
invocation check: use ONLY when the user explicitly asked for remote-access sharing, OR the user
asked for a shareable link/API/preview AND `remotehost-gate.sh --requested-share` exits 0. The gate
script only recognizes HIGH-CONFIDENCE remote-session signals as "strong" (`SSH_CONNECTION`/
`SSH_CLIENT`/`SSH_TTY` env vars, `CODESPACES=true`, `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`,
`GITPOD_WORKSPACE_ID`, `CODER_WORKSPACE_NAME`, `CDE_WORKSPACE_ID`, `IDX_WORKSPACE_ID`,
`GOOGLE_CLOUD_WORKSTATIONS`, `CLOUD_SHELL`); a bare container marker (`/.dockerenv` or a
docker/kubepods/containerd/podman cgroup) is explicitly classified WEAK and, alone, is NOT
sufficient to auto-proceed — exit code 10 with "ask the user before spinning up remotehost". If
the gate fails, the skill must NOT install Tailscale, run `tailscale up`, `serve`, or `funnel` — it
should offer the normal local URL or ask one concise clarifying question instead. The rationale:
the gate script literally cannot read user intent or verify which physical device someone is
holding; it can only raise/lower confidence heuristically, so a weak signal alone must never
silently trigger exposing a local service.

**Border0 by Tailscale — PAM (beta).** Next-gen Privileged Access Management on the Tailscale
platform: application-aware, identity-based, auditable access to Linux servers/databases/K8s/HTTP
services etc. Same identity layer + WireGuard as Tailscale (no new IdP/passwords). Adds:
application-aware access (policy = "can this person run this SSH command / query this DB / use
this K8s resource", scoped to application not whole host), no shared/static creds (Border0 holds
upstream creds, users authenticate via Tailscale identity re-checked per connection), JIT
time-bound access, session auditing/recording, browser-or-client access
(`https://tailscale.client.border0.com` no-install option). Core concepts: Connector (a registered
device — Linux/EC2/Docker/K8s — that auto-joins tailnet and brokers access), Socket (app-aware
proxy for ONE resource: SSH server, DB, K8s cluster, HTTP service — the unit you secure/grant). Two
consoles at initial release: Tailscale admin console (enable integration) AND Border0 portal
`portal.border0.com` (create connectors/sockets). Enable per-tailnet: **Settings > Feature
previews > Border0 by Tailscale (Beta)** (requires Owner/Admin/IT admin role); gated availability
(free trial via PAM waitlist, or Sales). This is a broader PAM surface than `tsrecorder` covers
(SSH/K8s/RDP/VNC/databases with command/query-level visibility) — for a NEW deployment needing
more than SSH/kubectl or PAM features (JIT, approvals, credential elimination), use Border0; for
SSH/kubectl recording TODAY, `tsrecorder` is "the current, generally-available method". Both are
complementary, not conflicting — a reader skimming either source in isolation could wrongly
conclude one supersedes the other. `[confidence MED — explicitly beta; setup flow (two consoles,
feature-preview toggle) is changing, don't assert exact UI steps from memory]`

**Tailscale internals — Android embedding (TailSocks), userspace daemon, patch points.**
`tailscaled` runs as a PIE binary (`libtailscale.so`) in userspace mode: `--tun=userspace-networking`.
Bridged via an `appctr` Go module (process lifecycle, env vars, log filtering) using
`pathControl` for socket/state/binary paths on Android. Patches: SOCKS5 inbound auth is added at
`tailscale_src/cmd/tailscaled/proxy.go` (`Username: os.Getenv("TS_SOCKS5_USER")`,
`Password: os.Getenv("TS_SOCKS5_PASS")` inside the `&socks5.Server` struct — stock Tailscale's
`proxy.go` does not support inbound SOCKS5 auth); `patches/fix_android_netmon.go` swaps in `anet`
for Android network-change detection. Binary-size reduction build tags: `ts_omit_ssh`,
`ts_omit_kube`, `ts_omit_taildrop`; linker flags `-s -w -checklinkname=0` for Android-linker
compatibility. Logging: `appctr` filters noisy subsystems (magicsock, netcheck, ratelimit) by
default; `TS_LOGS_DIR` must point to a writable app-data dir; `TS_NO_LOGS_NO_SUPPORT=true` reduces
disk I/O. Custom DNS proxy on port 1053 wraps UDP over SOCKS5 to bypass Android's UDP
restrictions; `RestartDNS` in `appctr` gives it an independent lifecycle. `registerMachineWithAuthKey`
(ReUp) is used for initial login + tag sync. **Gotcha:** re-applying `sed`-based patches from
`build.sh` is required every time `tailscale_src` is synced with upstream — a manual,
easy-to-forget step. `[confidence MED — very specific to one Android integration project's fork of
Tailscale source, not general Tailscale API, but concrete and traceable]`

---

## 13. Tailscale-SSH-specific failure modes — a cross-platform taxonomy

Four distinct root causes for superficially similar "SSH doesn't connect" symptoms:

1. **ACL "check" mode blocking non-interactive SSH**: connects but returns `operation not
   permitted` — the SSH policy uses `"action":"check"` (forces per-connection browser re-auth);
   fix by setting `"action":"accept"` for automation use-cases.
2. **WSL snap sandbox**: connects, ACL passes, but `tailscaled` logs show
   `be-child ssh ... Wait: code=1` — snap-installed Tailscale's sandbox forbids the SSH shell-exec;
   fix by removing the snap and installing via the official `install.sh` (apt-based) instead —
   note the new install MAY assign a DIFFERENT Tailscale IP, verify with `tailscale status --self`.
3. **Tailscale SSH proxy silent failure on WSL** (distinct from #2, happens even with apt-installed
   Tailscale): `nc -z` succeeds on port 22 but SSH fails immediately with
   `kex_exchange_identification: Connection closed by remote host`, no banner ever sent —
   `tcpdump -i any port 22` on the WSL host shows ZERO packets during the attempt, proving
   Tailscale's built-in SSH proxy intercepts at the APPLICATION layer, above the kernel network
   stack, and is malfunctioning; fix: `sudo tailscale up --ssh=false` and rely on regular `sshd`
   instead (verify `service ssh status`/`start`); ACL `"action":"accept"` becomes irrelevant once
   Tailscale's own SSH proxy is disabled — auth reverts to normal `sshd` key/password auth.
4. **App Store macOS build lacks `tailscale ssh` entirely** ("not available on macOS builds
   distributed through the App Store or TestFlight" — sandboxing restriction): must uninstall the
   App Store version and install the Standalone build from `pkgs.tailscale.com/stable/#macos`; the
   CLI binary then lives inside the app bundle and needs an alias (same pattern as §6).

`[confidence HIGH — each mode independently diagnosed with distinct symptom signatures]`

---

## 14. Platform-specific gotchas — quick reference

**macOS:** system extension needs manual approval if MDM-blocked (System Settings > Privacy &
Security > Network Extensions); App Store build and standalone build CANNOT coexist (different
bundle IDs/entitlements — the App Store build also lacks `tailscale ssh`, see §13); macOS allows
only ONE active VPN config in some setups — check for Cisco AnyConnect/GlobalProtect conflicts;
CLI not on PATH for App Store version → alias into the app bundle.

**Windows:** firewall rules can be stripped by security software/group policy — verify with
`netsh advfirewall firewall show rule name="Tailscale"`; some ops need Administrator elevation;
antivirus can intercept WireGuard UDP — add binary + `tailscale0` to AV exclusions.

**Linux:** `/dev/net/tun` missing → `modprobe tun` + persist via `/etc/modules-load.d/tun.conf`;
in containers the HOST must pass through `/dev/net/tun` or grant `NET_ADMIN`; iptables conflicts
with Docker/firewalld/ufw — check `iptables -L -n -v | grep tailscale`; if firewalld active,
`firewall-cmd --zone=trusted --add-interface=tailscale0 --permanent && --reload`; kernel <5.6
falls back to a slower userspace WireGuard implementation.

**iOS/Android:** background-app suspension can disconnect Tailscale — enable Background App
Refresh (iOS) / disable battery optimization (Android; some OEM skins like MIUI/One UI need
ADDITIONAL manufacturer-specific exemptions); deleting the iOS VPN profile drops connectivity —
re-enable from the app to reinstall it.

---

## 15. Adjacent network diagnostics (general VPN/DNS residue detection, Tailscale-inclusive)

This material is NOT specifically about Tailscale but comes from generic cross-platform
network-troubleshooting guidance that explicitly lists Tailscale (its process name, its
`100.100.100.100` resolver, its adapter type) among several VPN products. Kept here because the
same scripts are what an agent will reach for when diagnosing "is Tailscale actually the active
network path" on a box that might also run other VPN/proxy tooling. Low priority relative to the
Tailscale-specific material above.

**macOS `/etc/resolver/<domain>` orphan files = VPN residue, the Windows-NRPT equivalent.** VPN
clients (Cisco AnyConnect/Secure Client, Proton, occasional Mullvad) write per-domain resolver
override files to `/etc/resolver/`. Cleanup on disconnect is supposed to remove them but often
doesn't. Detect: `ls /etc/resolver/` + `scutil --dns | head -40` (shows extra "resolver #N"
entries with `domain :` lines). Same telltale gateway IPs as Windows (`10.2.0.x`=Proton,
`10.64.0.x`=Mullvad, `10.211.x.x`=Cisco AnyConnect), plus `127.0.0.1`=local DNS proxy
(NextDNS/AdGuard).

**Linux `/etc/resolv.conf` not symlinked to the systemd-resolved stub.** systemd-resolved expects
`/etc/resolv.conf` to be a symlink to `/run/systemd/resolve/stub-resolv.conf`. VPN scripts or
manual edits can replace it with a static file, causing libc-resolver apps to see a stale snapshot
while `resolvectl` operates independently. Detect: `readlink /etc/resolv.conf`. Fix:
`sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf && sudo systemctl restart systemd-resolved`.

**NRPT/resolver attribution-by-IP pattern-matching, consistent across macOS/Linux/Windows audit
scripts:** `10.2.0.x`→Proton VPN, `10.64.0.x`→Mullvad, `10.211.x.x`/`10.212.x.x`→Cisco AnyConnect,
`10.5.0.x`→NordVPN (Windows-only in this set), **`100.100.100.100`→Tailscale MagicDNS
(EXPECTED, not a residue)**, `127.0.0.1`/`127.0.0.2`/`::1`→local DNS proxy
(NextDNS/AdGuard/dnsmasq), `1.1.1.1`/`1.0.0.1`→Cloudflare, `8.8.8.8`/`8.8.4.4`→Google,
`9.9.9.9`/`149.112.112.112`→Quad9, `127.0.0.53`→systemd-resolved stub (Linux-expected). This turns
a raw list of nameserver IPs into an immediately actionable diagnosis without manual lookup.

**Known VPN/DNS-client footprint detection by installed-app + running-process signature.**
macOS: check `/Applications/*.app` paths for Proton/Mullvad/Tailscale/Cisco/NordVPN/NextDNS/Little
Snitch/Lulu, plus `kextstat` grep for
`cisco|anyconnect|proton|mullvad|nord|littlesnitch|lulu|nextdns|warp`, plus
`networksetup -listallnetworkservices` grep for the same vendor names. Linux: check
`/etc/openvpn`, `/etc/wireguard`, `/opt/cisco`, `/etc/proton-vpn`, `/etc/mullvad-vpn`,
`/opt/nordvpn`, `/etc/cloudflared`, `/etc/nextdns.conf` existence, plus
`pgrep -af 'openvpn|wireguard|wg-quick|mullvad|proton|nordvpn|cloudflared|nextdns|dnsmasq|stubby|dnscrypt'`.
Confirms/refutes a suspected VPN-residue diagnosis independent of the DNS-config forensics.

**Generic macOS "is a VPN client running" check, explicitly listing `tailscaled` by name:**
```bash
ps aux | grep -E "(openvpn|wireguard|tailscaled)" | grep -v grep
```
Paired with `ifconfig | grep -A1 "utun"` (lists all utun interfaces) and `scutil --nc list` for
configured macOS-native VPN profiles. `[confidence MED — generic macOS maintenance skill, single
mention of tailscaled in a broader multi-VPN grep, no Tailscale-specific diagnosis beyond that]`

---

## GAPS

The following are plausibly important but not covered here. This file deliberately does not
guess at them from general knowledge — verify against Tailscale's own documentation instead:

- Not covered: the **iOS/iPadOS Tailscale app's own install/setup UX** in any depth (only its
  role as a Serve *client*, never as a host/server — consistent with iOS having no daemon mode).
- Not covered: **Android as a Tailscale exit node or subnet router** beyond the single
  "run as exit node, battery-intensive" line — no depth on subnet routing FROM Android as a
  router role (only the client/peer-side "Add route" UI step is documented).
- Not covered: **Windows Store vs standalone-installer Tailscale variants** the way macOS's
  three-way split is documented — unclear whether Windows has an equivalent feature-parity gap.
- Not covered: **ChromeOS** support.
- Not covered: **Docker Desktop on Windows** (WSL2-backed) TUN/proxy interaction — only the
  macOS/OrbStack case is documented in detail.
- Not covered: uninstalling/cleanly removing Tailscale on **Windows** (macOS has a detailed
  cask/formula cleanup recipe; Linux has plain `apt remove`/`yum remove`; Windows has neither).
- Not covered here: the exact per-setting breakdown table for the "minimum working Compose block"
  (§9) — the claim that "every listed setting fixes one specific failure mode if removed" is kept
  as `[unverified]` until that detail can be confirmed.
- Several claims in this file (CLI flag tables for `up`/`set`/`down`, the NixOS `mosh`-over-Tailscale
  dotfiles example, the safety-invariant against two host-network router containers, the Ubuntu
  `ssh.socket` override, the unattended-boot readiness checks, the Wi-Fi-credential NetworkManager
  migration, the K8s sidecar Pod manifest, and the ACME/`tailscale cert` Docker failure) are marked
  `[unverified]` — they are retained because they reflect real, previously-verified content, but a
  future pass should re-confirm them against current Tailscale documentation.

**Credential-shaped strings:** every `tskey-auth-...` example in this file is the literal
placeholder string used by Tailscale's own documentation (not a real key) — reproduced verbatim
as `tskey-auth-...` per common Tailscale-doc convention, not redacted, since it carries no real
secret material.
