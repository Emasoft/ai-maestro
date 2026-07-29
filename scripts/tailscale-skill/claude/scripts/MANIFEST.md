# Bundled scripts — inventory and safety notes

## Written for this skill (executable, self-tested)

| script | what it does |
|---|---|
| `ts_call.sh` | Catalog-driven request builder — one script for every API operation. Resolves `{path}` params, URL-encodes them, and validates everything BEFORE any network call. **Refuses any non-GET operation unless `--yes` is passed**; `--dry-run` is always allowed and never touches the network. The gate keys on the HTTP method, so a read-only `POST` (`validateAndTestPolicyFile`) is gated too — deliberately. |
| `ts_catalog.sh` | Read-only discovery over the local operation catalog: `--search`, `--tag`, `--method`, `--json`. No network, no API key. |
| `ts_toolkit_selftest.sh` | 16 checks against a throwaway fixture catalog — no network, no API key. Most are NEGATIVE (the gate must REFUSE), so the suite fails if the mutation gate is ever removed. |

These three read the catalog from `$TS_CATALOG`, else `../references/operation_catalog.json`,
which `ts_build_catalog.sh` generates from an OpenAPI spec **you supply** — no catalog ships here.
A missing catalog is reported as a hard error, never as an empty result set.

## Third-party scripts

**These are THIRD-PARTY scripts, copied verbatim from their source projects. They are UNVETTED
and UNTRUSTED.** Read one before you run it. They ship non-executable (mode 0644) on
purpose: running one must be a deliberate act, not an accident.

Selected from 97 candidate scripts that mention Tailscale, deduped to one copy per filename
(the largest, i.e. most complete, of each). Excluded: 6 files from unrelated projects
(artifact gallery, doc-preview) that merely mention Tailscale in passing.

A secret scan found only PLACEHOLDERS (`--authkey tskey-auth…` in usage comments beside
`headscale.example.com`) — no live credentials. No prompt-injection text was found.

**Two of these carry their original project's assumptions, and both were patched to fail safe
rather than act on the wrong tree:**

- `prepare-ota-install.sh` computes its working root as three levels above itself and `cd`s
  there, then `rm -rf`s its output dir. Inside this skill that path is NOT the iOS project it
  was written for, so it now refuses to run unless that project is actually present. It also
  hardcodes a third party's Apple `TEAM_ID` — treat it as a worked example of exposing an OTA
  install page over `tailscale serve`, not as a script to run.
- `ts-api.sh` used to source a helper library from another project's home directory and exit
  when it was absent — which is always, here. It now uses that helper when present and falls
  back to `TAILSCALE_API_KEY` / `TAILSCALE_TAILNET` from the environment, so it works standalone.

`dns-audit.sh` and `resolver-clean.sh` also reference a sibling `_lib` from their origin
project, but both already guard the lookup and degrade cleanly when it is missing.

| script | tailscale refs | source project |
|---|---|---|
| `tailscale_manager.py` | 49 | tailscale-sshsync-agent |
| `remotehost.sh` | 42 | remotehost |
| `ts-install.sh` | 40 | tailscale-19 |
| `quick_diagnose.py` | 36 | tunnel-doctor-3 |
| `ts-up.sh` | 32 | tailscale-19 |
| `setup_exit_node.sh` | 24 | tailscale-17 |
| `connection_validator.py` | 23 | tailscale-sshsync-agent |
| `setup_subnet_router.sh` | 23 | tailscale-17 |
| `tailscale-hosting-helper.sh` | 21 | tailscale-hosting |
| `ts-diagnostics.sh` | 21 | tailscale-19 |
| `process.py` | 19 | deploying-tailscale-for-zero-trust-vpn-2 |
| `resolve-device.sh` | 17 | tailscale-deploy-adb |
| `tailscale-status-json.sh` | 15 | tailscale-19 |
| `hs-advertise-routes.sh` | 14 | tailscale-19 |
| `prepare-ota-install.sh` | 12 | ios-device-install |
| `server-setup.sh` | 12 | cali-ops-deploy-github-tailscale |
| `test_integration.py` | 11 | tailscale-sshsync-agent |
| `agent.py` | 10 | deploying-tailscale-for-zero-trust-vpn-2 |
| `test-derp-latency.sh` | 9 | tailscale-19 |
| `status.sh` | 9 | share-server-control-2 |
| `audit.sh` | 9 | server-audit-2 |
| `taildrop-get.sh` | 8 | taildrop |
| `check_tailscale.sh` | 8 | server-audit-2 |
| `ts-connectivity-report.py` | 7 | tailscale-19 |
| `ts_build_catalog.sh` | 7 | tailscale-13 |
| `mac-node-ops.sh` | 7 | mac-node-ops |
| `helpers.py` | 6 | tailscale-sshsync-agent |
| `ts-api.sh` | 6 | tailscale-22 |
| `tailscale-diag.sh` | 6 | tailscale-15 |
| `netmap.py` | 6 | netmap |
| `ts_common.sh` | 5 | tailscale-admin |
| `readiness-check.sh` | 5 | operating-tailscale-agent-hosts |
| `verify_setup.sh` | 4 | secure-vps-setup |
| `mac-security-audit.sh` | 4 | mac-security-audit-skill-main |
| `__init__.py` | 3 | tailscale-sshsync-agent |
| `deploy-derp.sh` | 3 | tailscale-19 |
| `test-all.sh` | 3 | tailscale-19 |
| `validate-policy.py` | 3 | tailnet-policy |
| `disable-viewer.sh` | 3 | share-server-control-2 |
| `resolver-clean.sh` | 3 | net-ops-2 |
| `host_validator.py` | 2 | tailscale-sshsync-agent |
| `probe.sh` | 2 | net-ops-2 |
| `redact.sh` | 2 | net-ops-2 |
| `workflow_executor.py` | 1 | tailscale-sshsync-agent |
| `parameter_validator.py` | 1 | tailscale-sshsync-agent |
| `sshsync_wrapper.py` | 1 | tailscale-sshsync-agent |
| `load_balancer.py` | 1 | tailscale-sshsync-agent |
| `ts_smoke.sh` | 1 | tailscale-admin |
| `enable-viewer.sh` | 1 | share-server-control-2 |
| `remotehost-gate.sh` | 1 | remotehost |
| `dns-audit.sh` | 1 | net-ops-2 |
