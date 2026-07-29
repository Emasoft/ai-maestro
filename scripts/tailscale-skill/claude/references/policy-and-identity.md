# Tailscale policy & identity — ACLs, grants, tags, posture, keys, tailnet lock

Covers ACL policy, tags and grants, device posture, OAuth clients, auth keys and key expiry,
tailnet lock, Tailscale SSH, subnet routers, Docker and the Kubernetes operator, device
management, audit logging, security hardening, Headscale, Terraform, agent integration, and
the policy side of the control API. Where sources contradict each other, **both sides** are
shown — never silently resolved — and marked **[unverified]** where the live schema or binary
could not be checked. Version-gated behaviour names the version it applies to.

---

## 1. Core concepts and the policy file — HuJSON, sections, deny-by-default

**Glossary**: a **tailnet** is a private network of authenticated devices/users;
**WireGuard** provides the underlying encryption (key management automatic); **MagicDNS**
gives every device a human-readable hostname (`ssh my-server`); every device gets a stable
`100.x.y.z` CGNAT-range IP; the **tailnet policy file** is the JSON/HuJSON config in the
admin console defining access controls, groups, tags, SSH rules — deny-by-default the moment
any rule exists.

The tailnet **policy file** (ACL file) is written in **HuJSON** = JSON + `//` and `/* */`
comments + trailing commas. Top-level sections:

```json
{
  "groups": {},
  "tagOwners": {},
  "hosts": {},
  "acls": [],
  "grants": [],
  "ssh": [],
  "autoApprovers": {},
  "postures": {},
  "defaultSrcPosture": [],
  "nodeAttrs": [],
  "ipSets": {},
  "tests": [],
  "sshTests": []
}
```

- **Default policy on a brand-new tailnet = ALLOW-ALL.** The moment ANY rule (`acls` or
  `grants`) is added, the policy becomes **deny-by-default** for everything not explicitly
  permitted — a fresh tailnet's default lets all members access all devices on all ports and
  SSH as non-root, and should be tightened before production use.
- `hosts` — named CIDR/IP aliases reusable across rules.
- Mixing `acls` and `grants` in one file is explicitly supported as an incremental
  migration path; **both are evaluated together**. On conflict, one source says the
  MORE RESTRICTIVE rule wins — not independently corroborated elsewhere.
- **Src/dst target/selector vocabulary**: `*` (everyone), a user email
  (`alice@example.com`), `group:name`, `tag:name`, `autogroup:member` (all tailnet members),
  `autogroup:self` (same device), `autogroup:admin`, `autogroup:tagged` (any tagged node),
  `autogroup:internet` (dst-only, exit-node traffic), `autogroup:nonroot` (non-root SSH
  users), `autogroup:shared` (src-only, per one source), a raw `100.x.x.x` IP, a CIDR, or a
  `hosts` alias.
- **Reading vs writing the ACL via API:** `GET /tailnet/-/acl` with
  `Accept: application/hujson` returns raw HuJSON (comments preserved — **not valid JSON**,
  never pipe to `jq`). With `Accept: application/json` it returns the normalized JSON object
  exposing `tagOwners`, `acls`, `grants`, `hosts`, `nodeAttrs`, `ssh`, `autoApprovers` at the
  TOP LEVEL — query directly, e.g. `.tagOwners`. **Do NOT add `?details=1`** — it wraps the
  response as `{acl, errors, warnings}` where `acl` is itself an unparseable HuJSON *string*,
  breaking any `jq` path that assumes top-level keys. One
  skill's ACL-WRITE recipe is explicitly deferred pending `If-Match` ETag handling to avoid a
  race-condition lockout risk — see §2.5 for the sibling skill that DOES implement ETag-safe
  writes.
- HTTP status codes for the policy-file API: `200` ok, `400` malformed HuJSON/invalid
  policy, `401` auth failed, `403` insufficient perms, `412` ETag mismatch (concurrent
  edit), `422` validation error (tests failed / semantic error), `429` rate limited, `500`
  server error.
- **Local syntax-only validation** (no network call): `go install
  github.com/tailscale/hujson/cmd/hujsonfmt@latest`; `hujsonfmt policy.hujson` (check) or
  `hujsonfmt -w policy.hujson` (format in place) — catches syntax/formatting only, not ACL
  semantics or `tests` failures.
- Canonical doc pointers: `tailscale.com/docs/reference/grants-vs-acls`
  and `tailscale.com/docs/reference/troubleshooting/grants` — check these before
  shipping any of the OPEN/`[unverified]` items below as fact.

---

## 2. ACLs (legacy) vs Grants (recommended) — the central model choice

The same acls-vs-grants shape, including the
minimal `{"grants": [{"src": ["*"], "dst": ["*"], "ip": ["*"]}]}` maximal-open example and the
`proto`/`via` fields, is confirmed independently across multiple sources. A third independent worked
example (ACL rules gating `*:*` and a specific `tag:db:5432` grant, alongside a `tagOwners`
map) confirms the same shape once more.

| | `acls` (legacy) | `grants` (modern, recommended for new rules) |
|---|---|---|
| Direction | bidirectional in spirit, `src`→`dst` shape | unidirectional `src`→`dst` |
| Action field | `"action": "accept"` always (no deny action exists — everything unlisted is implicitly denied) | none — a grant is always a permit; deny-by-default handles the rest |
| Port/protocol | embedded in `dst` string: `tag:server:22`, `tag:db:5432-5433` (range via hyphen), `tag:web:80,443` (list), `tag:x:*` (all ports), `:0` used for ICMP inside `tests` | separate `"ip"` array: `["tcp:443"]`, `["22","443"]` (see §2.1 contradiction), `["*"]` = all IP traffic when `ip`/`app` both omitted |
| Protocol | `"proto": "tcp"\|"udp"\|"icmp"` (optional; omitted = TCP+UDP) | folded into `ip` entries (`tcp:443`) or a separate `proto` field |
| App-layer capabilities | not supported | `"app"` field, e.g. `"tailscale.com/cap/ssh"`, `"tailscale.com/cap/drive"`, `"tailscale.com/cap/kubernetes"`, `"tailscale.com/cap/aperture"` (§12) — unifies network + app-layer capability in one rule |
| Device-posture gating | not supported | `"srcPosture": ["posture:x"]` |
| Forced-relay routing | not supported | `"via": [...]` — routes traffic through a specific gateway/exit-node tag or CIDR for inspection (§2.1b) |
| Removal | replaced by grant equivalent (see migration below) | — |
| Deprecation status | supported **indefinitely**, no forced migration; only `grants` receive new features going forward (app capabilities, posture checks) | RECOMMENDED for all new policies (one source dates GA to **May 2025**, MED confidence, not independently corroborated) |

**Grant/ACL scope note:** the grants-vs-legacy-ACL choice applies **only** to
network/app access rules. `ssh`, `autoApprovers`, `nodeAttrs`, `postures`, `groups`,
`tagOwners` all have their own dedicated top-level syntax and are **not** grants — SSH
access in particular is **never** controlled via a grant's `app` capability; it always goes
through the separate top-level `"ssh"` section (one source shows an `app:
"tailscale.com/cap/ssh"` capability inside a grant — treat as a documented app-capability
shape, distinct from the primary `ssh:` block which every other source uses). This same
scope split is confirmed independently by multiple sources.

### 2.1 `ip` field syntax — bare port numbers vs `proto:port` prefix [DECIDED-leaning, low confidence]

Most published examples use an explicit `proto:port` prefix: `"ip": ["tcp:443"]`,
`"ip": ["tcp:22","tcp:443"]`. One source instead shows bare port numbers with
no protocol: `"ip": ["22", "443"]` (also seen in a `postures` example:
`"ip": ["22"]`). **No source states outright that a bare port number is
accepted syntax.** This reference keeps this OPEN — do not treat bare-port as confirmed;
verify against current official grants docs before shipping it as canonical. Prefer the
`proto:port` form when authoring new policy.

### 2.1b `via` — forcing traffic through a gateway for inspection [MED confidence, single source]

`grants.via` restricts cross-subnet access by routing traffic through a specific gateway
subnet or tag, rather than allowing direct peer-to-peer:

```json
{"grants":[{"src":["tag:monitoring"],"dst":["tag:servers"],"app":["prometheus"],"via":["192.168.10.0/24"]}]}
```

This lets a gateway inspect/filter traffic with its own firewall policies. This is a
Headscale-specific framing of a Tailscale grants field.

### 2.2 Legacy ACL example (deny-all lockdown, minimal, and a full zero-trust example)

```json
// legacy ACL, minimal
{"acls": [{"action": "accept", "src": ["*"], "dst": ["*:*"]}]}
// deny-all lockdown
{"acls": []}   // or {"grants": []}
```

A minimal illustrative fragment (group-src, tag-scoped dst, port list — note this is a
FRAGMENT, no top-level `groups`/`tagOwners` shown alongside it, so treat as syntax-only, not
a deployable policy):

```json
{
  "acls": [
    {"action": "accept", "src": ["group:admins"], "dst": ["*:22", "*:80", "*:443"]},
    {"action": "accept", "src": ["group:developers"], "dst": ["tag:development:*"]}
  ]
}
```

Full zero-trust-style example (groups + tags + per-port dst + SSH `check` vs `accept` +
`nodeAttrs` funnel-deny) — this exact JSON appears byte-identical across two independent
sources:

```json
{
  "acls": [
    {"action":"accept","src":["group:engineering"],"dst":["tag:dev-server:*"]},
    {"action":"accept","src":["group:sre"],"dst":["tag:production:22,443,8080"]},
    {"action":"accept","src":["tag:backend"],"dst":["tag:database:5432,3306,27017"]},
    {"action":"accept","src":["group:employees"],"dst":["tag:internal-tools:443"]}
  ],
  "groups": {
    "group:engineering": ["user@company.com","dev@company.com"],
    "group:sre": ["sre@company.com","oncall@company.com"],
    "group:employees": ["autogroup:members"]
  },
  "tagOwners": {
    "tag:dev-server":["group:engineering"], "tag:production":["group:sre"],
    "tag:backend":["group:sre"], "tag:database":["group:sre"],
    "tag:internal-tools":["group:sre"], "tag:container":["group:sre"]
  },
  "ssh": [
    {"action":"check","src":["group:sre"],"dst":["tag:production"],"users":["root","admin"]},
    {"action":"accept","src":["group:engineering"],"dst":["tag:dev-server"],"users":["autogroup:nonroot"]}
  ],
  "nodeAttrs": [{"target":["autogroup:members"],"attr":["funnel:deny"]}]
}
```

`nodeAttrs` with `attr: ["funnel:deny"]` on `autogroup:members` blocks Funnel exposure
tailnet-wide by default — an explicit opt-in pattern; the inverse
`"target":["group:backend"],"attr":"funnel"` restricts *who may create* a Funnel to one
group instead of the default `autogroup:member`. The inverse pattern is confirmed
independently. The same nodeAttrs shape can additionally block Mullvad exit-node use:
`"attr": ["mullvad:deny", "funnel:deny"]`.

A second full-org example with per-service ports and SSH-scoped rules confirms the same
"untagged devices can't be referenced in policies — tag at provisioning time, not later"
lesson independently:

```json
{"acls":[
  {"action":"accept","src":["group:devs"],"dst":["tag:dev:*","tag:staging:*"]},
  {"action":"accept","src":["group:ops"],"dst":["tag:prod:*"]},
  {"action":"accept","src":["*"],"dst":["tag:shared:80,443,53"]},
  {"action":"accept","src":["group:ops"],"dst":["*:22"]}],
 "groups":{"group:devs":["user@example.com","dev2@example.com"],"group:ops":["ops@example.com"]},
 "tagOwners":{"tag:dev":["group:devs"],"tag:staging":["group:ops"],"tag:prod":["group:ops"],"tag:shared":["group:ops"]}}
```

### 2.3 Migration: ACLs → Grants (manual and scripted)

Manual conversion:
```
{"acls":[{"action":"accept","src":[...],"dst":["tag:dev:22","tag:dev:443"]}]}
→ {"grants":[{"src":[...],"dst":["tag:dev"],"ip":["22","443"]}]}
```
A second worked conversion example confirms the same shape independently:
```
{"action":"accept","proto":"tcp","src":["group:eng"],"dst":["tag:web:80","tag:web:443"]}
→ {"src":["group:eng"],"dst":["tag:web"],"ip":["tcp:80","tcp:443"]}
```
A scripted migrator (`migrate-acls-to-grants.py --input policy.hujson --output
policy-grants.hujson [--dry-run] [--json]`) parses HuJSON (strips `//` comments + trailing
commas while protecting string literals), splits each ACL's port-suffixed `dst` entries
(`"tag:webserver:80"`) on the last `:` into `(dst, port)`, and emits one grant per port
entry. **`action: "drop"` legacy rules cannot be auto-converted** — grants are accept-only;
the script warns and skips them, relying on deny-by-default instead.

### 2.4 Testing before you save — `tests` / `sshTests`

```json
{"tests": [
  {"src": "alice@example.com", "dst": "tag:staging", "accept": ["tcp:443"]},
  {"src": "alice@example.com", "dst": "tag:prod",    "deny":   ["tcp:22"]}
]}
```
An alternate shape seen elsewhere groups multiple targets per test entry:
```json
{"tests": [{"src": "alice@example.com", "accept": ["tag:dev:22","tag:dev:443"], "deny": ["tag:prod:*"]}]}
```
Evaluated **before** the policy is saved — a failing test blocks the save. API:
`POST /api/v2/tailnet/{tailnet}/acl/validate` runs the `tests`/`sshTests` block and returns
`{}` on full success, a JSON error otherwise; **nothing is written** by this call.
Because
everything not explicitly allowed is denied, the highest-value tests assert `deny:` on
sensitive resources — not just that intended access is `accept:`ed. (Write at least one
test per rule, including a negative test for every sensitive resource, so an ACL edit can
never silently lock out access.)

**Contradiction on runtime enforcement:** one source states plainly *"Tests are not enforced
at runtime — they only validate during PARSING; a passing test does not guarantee runtime
behavior."* No other source explicitly confirms or refutes this — treat the
`tests` block as a save-time guardrail, not a live runtime check, until independently
verified.

`sshTests[].dst` **must be an array**, not a string — stricter matching than `ssh[].dst`:
host aliases (`"asuna"`) and selectors like `"autogroup:self"` can fail in `sshTests` even
when valid elsewhere; tag-based destinations are more reliable there. When a validator error
says `invalid dst ...`, reduce the rule to tag-based selectors first, then reintroduce host
aliases only where confirmed to work. This debugging heuristic is the source for
the whole "reduce to tags first" workflow. `grants` destination matching is easy to misuse
the same way when mixing host aliases and tags — keep explicit `hosts` aliases for `tests`,
but center `grants`/`ssh` on tags where possible.

**Validating against stale device-tag state (gotcha):** the API's `validateAndTestPolicyFile`
call is technically an HTTP `POST`, so some CLI wrappers require an explicit `--yes`/confirm
flag for it even though it is read-only. Prefer validating against the live tailnet
**AFTER** any tag changes, because `tests`/`sshTests` evaluate against **CURRENT** device
tags — stale tags in the live tailnet will make validation misleading.

**Validate-only smoke test:** `tailscale_acl_test` (MCP-style tool) called with an empty
array `[]` validates without modifying anything. The same tool is exercised in the
MCP live-test protocol, §13.

**Preview / lint in the admin console:** Access Controls → "Preview rules" tab → select a
user.

> **CORRECTED — there is no local CLI linter.** Two sources give
> `tailscale debug policy lint acl.json`. Measured on **1.98.5**:
> `tailscale debug: unknown subcommand: policy` — and no subcommand under `debug` matches
> `policy` or `lint`. (`tailscale debug` itself is real; it is a hidden subcommand absent from
> the top-level `--help`.) Lint through the API instead:
> `POST /tailnet/{tailnet}/acl/validate` — see §2.5.

### 2.5 Safe apply sequence — backup, validate, ETag-guarded write, and the wider policy-management API surface

```bash
ts-api.sh acl > backup.hujson                      # backup BEFORE any change
ts_call.sh validateAndTestPolicyFile --params-json '{"tailnet":"-"}' --body-file acl.hujson --dry-run
ts_call.sh validateAndTestPolicyFile --params-json '{"tailnet":"-"}' --body-file acl.hujson --yes
ts_call.sh setPolicyFile             --params-json '{"tailnet":"-"}' --body-file acl.hujson --dry-run
ts_call.sh setPolicyFile             --params-json '{"tailnet":"-"}' --body-file acl.hujson --yes
```
The same 4-command shape (backup → validate dry-run → validate yes → set dry-run → set yes)
recurs independently.

ETag-based safe update (prevents clobbering a concurrent edit): GET the current ACL,
capture its `ETag` header (`curl -si ... | grep -i "^etag:" | awk '{print $2}' | tr -d
'\r'`), then `POST` the candidate policy with `-H "If-Match: $ETAG"`. If someone else
changed the policy in between, the server returns **`412 Precondition Failed`** instead of
silently overwriting — recommended sequence: (1) validate via `acl/validate` (expect `{}`),
(2) GET for a fresh ETag, (3) POST with `If-Match`, branch on `200`/`412`/other.

**Pre-commit hook pattern:** a `pre-commit` (or team-shared `lefthook.yml`) hook posts to
`.../acl/validate` with `-u "$TS_API_KEY:" -H "Content-Type: application/hujson"
--data-binary "@policy.hujson"` before every commit; a `{}` response means valid.
The trailing colon on `-u "tskey-api-xxxxx:"` is HTTP Basic Auth with an empty password
(the key IS the username) — an OAuth alternative exchanges `client_id`/`client_secret`/
`grant_type=client_credentials` at `POST /api/v2/oauth/token` for a 1-hour-lived Bearer
token.

**The `ts_call.sh` wrapper pattern** (a generic REST-call CLI wrapping the same API):
`setPolicyFile` applies a full HuJSON policy document —
```bash
./scripts/ts_call.sh setPolicyFile --params-json '{"tailnet":"acme.ts.net"}' --body-file ./acl.hujson --yes
```
— and `validateAndTestPolicyFile` dry-runs the semantic effect (`tests`/`sshTests`) against
the live tailnet before committing:
```bash
./scripts/ts_call.sh validateAndTestPolicyFile --params-json '{"tailnet":"acme.ts.net"}' --body-file ./acl.hujson --yes
```
Always dry-run the same command first to inspect the resolved URL/body before applying with
`--yes`.

**SoT-first workflow with drift detection:** canonical policy lives as
`tailscale/acl-policy.hujson` in an infra repo. Flow: edit SoT → `tailscale_acl_validate` →
`tailscale_acl_preview` (diff vs live) → `tailscale_acl_test` (run `tests`) → require
explicit human confirmation → `tailscale_acl_set` (push to live) → `tailscale_acl_get`
(verify) → commit the SoT change via a feature-branch PR. A scheduled
health-check agent diffs SoT vs live and classifies drift 🟢 in sync / 🟡 drift detected
(rule/group/tag diffs) / 🔴 critical drift (missing groups, removed access rules). An
"Emergency Live Edit (bypass SoT)" escape hatch exists for urgent changes — apply directly
via `tailscale_acl_set` with explicit confirmation that it's an emergency override, then
**immediately** update the SoT file to match and flag that it was updated retroactively;
never leave live and SoT diverged. The emergency-override confirmation is a **separate,
distinct** prompt from the normal apply-confirmation — it confirms the bypass itself
("skip the file-first review this once"), not merely the resulting change; this is the
**only** sanctioned path that reverses the file-before-live ordering, and it is gated by
its own confirmation precisely because it is the dangerous exception to the
otherwise-mandatory SoT-first rule. Drift detection (SoT vs live) is not only an on-demand
check — the same comparison logic is reused by a scheduled/automated health-check job, so
drift is caught periodically, not just when a human happens to ask.

**Presenting a live ACL policy to a human reviewer** (a `tailscale_acl_get`-style read):
render it sectioned rather than as a raw JSON/HuJSON blob — **Groups** (group name ->
members), **ACL Rules** (src -> dst, action), **Tag Owners** (tag -> owners), **Auto
Approvers** (routes, exit nodes), **SSH Rules** (src -> dst, users), **Tests** (src,
accept/deny targets). This is the standard shape for presenting ANY Tailscale ACL policy to
a human: it separates identity/grouping concerns (Groups, Tag Owners) from access-control
concerns (ACL Rules, SSH Rules) from routing concerns (Auto Approvers) from verification
concerns (Tests).

**MCP-style tool-name variant of the SoT-first flow** — an alternate naming convention
seen alongside the CLI/API-script forms above, mapping directly onto the same
get/set/validate/preview/test policy surface:

| Tool | Purpose |
|---|---|
| `tailscale_acl_get` | Retrieve the current LIVE ACL policy |
| `tailscale_acl_set` | Replace the live ACL policy wholesale (requires explicit confirmation) |
| `tailscale_acl_validate` | Validate a policy's syntax before applying it |
| `tailscale_acl_preview` | Preview what would change vs. the current live policy, without applying |
| `tailscale_acl_test` | Run the ACL policy's own embedded test cases against the current policy |

`tailscale_acl_test` runs the test cases DEFINED INSIDE the ACL policy itself (a Tailscale
ACL policy can embed its own access-control test cases as part of its schema). Report
shape: tests PASSED, or tests FAILED with per-case detail — which user, what access was
EXPECTED, what access was the ACTUAL result. Suggest re-running the test suite after every
ACL change, as a standing habit, not a one-off.

An ACL "set" operation is a **full policy replacement/swap, not a partial patch** — always
show a diff of the complete resulting policy (not just the changed lines) before applying,
and require explicit user confirmation specifically before the `tailscale_acl_set` /
`set-policy` call.

### 2.5.1 Staged tag rollout — new tags must exist in `tagOwners` before assignment

Attempting to assign a tag the live policy doesn't yet own fails with:
```
requested tags [tag:server] are invalid or not permitted
```
Safe sequence: (1) apply a bootstrap policy that adds the new `tagOwners`
entries while preserving existing connectivity semantics; (2) retag devices with
`setDeviceTags`; (3) validate the final restrictive policy with `validateAndTestPolicyFile`;
(4) apply the final policy with `setPolicyFile`.

### 2.5.2 Device-management API recipes — list, filter, delete/expire/retag, composite audit

`GET /tailnet/-/devices?fields=all` (omit `fields=all` for a leaner subset) returns a device
record per node: `id` (use in API paths — NOT the internal `nodeId`), `name`, `hostname`,
`addresses`, `tags`, `lastSeen`, `expires`, `authorized`, `os`, `clientVersion`, `user`.
Filtering recipes:

- Stale (last seen > N days): `CUTOFF=$(date -u -v-30d +%s 2>/dev/null || date -u -d '30
  days ago' +%s); jq --argjson cutoff "$CUTOFF" '.devices[] | select((.lastSeen|fromdateiso8601)
  < $cutoff)'` — note `date` syntax differs macOS (`-v-30d`) vs Linux (`-d '30 days ago'`), a
  cross-platform script must branch or fall back.
- Untagged: `select((.tags // []) | length == 0)`.
- By tag: `select(.tags // [] | index("tag:sidecar"))`.
- By hostname regex: `select(.hostname | test("dokploy-sidecar"))`.

Three distinct **destructive** operations, always flagged "high-impact" — summarize the
resolved device (hostname, id, current tags) to the user before firing, never as bare
one-liners:
- `DELETE /device/{id}` — **permanently removes** the device; it cannot rejoin without a new
  auth key.
- `POST /device/{id}/expire` — kicks it offline immediately but **keeps the record**; the
  device must re-authenticate to reconnect. Use this instead of delete to preserve history
  or force a compromise-response disconnect.
- `POST /device/{id}/tags` with `{"tags":[...]}` — **wholesale-replaces** the entire tags
  array. Sending one tag silently drops all others. Always read-diff-write, and pre-verify
  every proposed tag is declared in `tagOwners` (else `400`).

**A composite tailnet audit needs only 3 API calls** (well under the 60/min rate limit):
`GET /tailnet/-/devices?fields=all`, `GET /tailnet/-/keys`, `GET /tailnet/-/acl` (`Accept:
application/json`, never `?details=1`). It computes device total/stale/untagged/by-tag
counts; key total/expired/reusable-(flag-for-review)/description-less-(flag-as-audit-blind)
counts; and the killer correlation — `tagOwners` keys DEFINED vs the union of all device
`.tags[]` IN USE, surfacing tags declared-but-unused as ACL cleanup candidates (`defined -
used` via `jq`). Recommended cadence: monthly, or before any cleanup project to baseline.

### 2.6 GitOps for the policy file — `tailscale/gitops-acl-action`

Official `tailscale/gitops-acl-action@v1`: `action: test` (validate + run tests, no apply —
for PRs) and `action: apply` (validate then push — on merge to main). Auth
escalation ladder, weakest to strongest:

1. **API key** (`api-key:`) — expires ≤90 days, needs rotation.
2. **OAuth client** scoped to the `policy_file` permission (`oauth-client-id:`/
   `oauth-secret:`) — does not expire.
3. **OIDC federated identity** — GitHub's OIDC provider issues short-lived tokens bound to
   the specific repo, **no stored secret at all**
   (`permissions: {id-token: write}` in the workflow, plus `oauth-client-id:` +
   `audience:` inputs; the Tailscale admin console's "Federated identity" setting trusts the
   repo as issuer).

Multi-tailnet setups run separate jobs with separate secret sets and `policy-file:` pointing
at per-tailnet `.hujson` files; GitHub Environments + protection rules can require manual
approval for prod while auto-applying staging.

A simpler, hand-rolled GitOps pipeline (no dedicated Action) instead curls the API directly
on a push-to-main trigger:
```yaml
on: {push: {paths: ['tailscale-acl.json'], branches: [main]}}
jobs:
  update-acls:
    steps:
      - uses: actions/checkout@v3
      - env: {TAILSCALE_API_KEY: ${{ secrets.TAILSCALE_API_KEY }}, TAILSCALE_TAILNET: ${{ secrets.TAILSCALE_TAILNET }}}
        run: |
          curl -X POST "https://api.tailscale.com/api/v2/tailnet/${TAILSCALE_TAILNET}/acl" -u "${TAILSCALE_API_KEY}:" -H "Content-Type: application/json" --data @tailscale-acl.json
```

### 2.7 Common mistakes / static-validator checklist / troubleshooting

- Don't grant a personal account `["*"]` dst `tag:prod` `ip:["*"]` — scope via a group +
  limited ports instead. Don't hardcode email lists in `src` — use `groups`.
- Don't add an `ssh` rule without a matching network `grants`/`ip` rule — **SSH needs BOTH**
  a network-layer allow and an `ssh:` rule.
- Don't hardcode email lists in `src` — use `groups`.
- **"Forget network-level access" is the #1 SSH failure mode** — Tailscale SSH intercepts
  only the Tailscale IP (`ssh user@100.x.y.z` or MagicDNS hostname), never the LAN/public IP,
  even if port 22 is open there too.
- Subnet-router over-exposure: `--advertise-routes=10.0.0.0/8` + `--accept-routes` can hand
  clients an entire datacenter — advertise the narrowest CIDR, gate behind
  `autoApprovers`/ACL `dst` tags. The same misconfiguration is independently flagged by
  another source's "common Tailscale ACL misconfigurations checklist."
- A wildcard `{"action":"accept","src":["*"],"dst":["*:*"]}` left in a "zero trust" tailnet
  means every node reaches every other node on every port — verify it's gone (grep the
  policy for `"*:*"`), then verify blocked traffic actually fails (`tailscale ping` +
  attempted connection from a denied node; check admin-console audit/flow logs).
- Common ACL mistakes generalized further: forgetting traffic must be allowed in
  BOTH directions (legacy `acls` are directional unless using `grants`, which are also
  directional but conceptually replace the paired-rule pattern); tag-based rules silently
  no-op when the device lacks the expected tag; a rule permitting the right PORT but wrong
  PROTOCOL (TCP vs UDP) still denies. Diagnose with `tailscale ping` first (Tailscale-layer
  up?) then the admin-console policy TEST TOOL (enter src/dst/port to see which rule
  matches).
- **`tailscale ping` bypasses ACLs; `tailscale ping --icmp` respects them.** `tailscale ping
  machine-name` tests raw peer-to-peer connectivity at the WireGuard/DERP layer, BELOW policy
  enforcement — it will succeed even when the policy denies the traffic. `tailscale ping
  --icmp machine-name` additionally exercises ACL-gated ICMP, so it can fail even when the
  plain ping succeeds — useful to distinguish "peers can reach each other at all" from
  "policy actually permits this traffic." This is a single-source claim, not cross-verified
  elsewhere.
- **Route/exit-node approval is a SEPARATE gate from advertisement and acceptance.** A
  router can be online + advertising a subnet, and a client can have `--accept-routes=true`
  set — traffic still won't flow until the route is **APPROVED** in the admin console (or
  via ACL `autoApprovers`). Called out as "the single most commonly missed step during
  router deployment or replacement."

A reusable Python static-validator (`TailscaleACLGenerator.validate_policy()` /
`validate_policy()` dataclass pattern) runs 6 checks, seen independently in two sources
(the same 6-check shape is corroborated by a field reference naming a
`tests` field for ACL policy unit tests):

1. no `acls` rules at all → WARNING all traffic denied
2. any rule with `"*"` in BOTH `src` and `dst` → CRITICAL all-to-all
3. any `dst` ending `:*` → WARNING all-ports-to-dst
4. a group with zero members → WARNING
5. a `tagOwners` entry referencing an undefined `group:` → ERROR
6. an SSH rule granting `"root"` in `users` without `action: "check"` → WARNING (no
   re-auth on root access)

The generator side of the same library (`TailscaleACLGenerator`, `add_group`, `add_tag`,
`add_acl_rule`, `add_ssh_rule`, `add_auto_approver_route`, `add_auto_approver_exit_node`,
`generate_policy()`, `export_policy()`) is a reusable pattern for building a well-formed
policy programmatically instead of hand-editing JSON.

A companion `TailscaleMonitor` parses `tailscale status --json`'s `Peer` map into node
objects (`get_status()` runs `subprocess.run(["tailscale","status","--json"],
capture_output=True, text=True, timeout=10)`, tolerating `(subprocess.TimeoutExpired,
FileNotFoundError, json.JSONDecodeError)` and returning `{}` on failure — **a caller must
check for an empty `Peer` map rather than assuming success**, since the failure is silently
swallowed) and computes: expiring-key list (<30 days via `KeyExpiry`, parsed by replacing a
trailing `Z` with `+00:00` for `datetime.fromisoformat`), untagged/"ungoverned" nodes,
exit-node list, and a PASS/FAIL/REVIEW compliance report per zero-trust dimension
(encryption, identity-based access, least privilege, continuous verification, device trust).

A separate HuJSON structural validator (`validate-policy.py --policy policy.hujson [--json]
[--fix] [--dry-run]`) checks grants (`src`/`dst` required+array; tag-name format
`^[a-z0-9][a-z0-9-]*$`; known autogroups only — `autogroup:member|admin|tagged|internet`;
`ip` array of strings; `proto` in `tcp|udp|icmp`; `via` string/array), legacy ACLs (`action`
in `accept|drop`, `users`/`ports` arrays), tagOwners cross-reference (every tag used in
grants/acls must be tagOwners-defined **and vice versa** — flags both orphan-usage and
unused-definitions), autoApprovers (`routes` dict of CIDR→user-array, `exitNode` array), SSH
rules (`action` in `accept|check`, `src`/`dst`/`users` arrays). `--fix` auto-repairs missing
closing braces/brackets, trailing commas, UTF-8 BOM, uppercase tag names lowercased
(`tag:Foo`→`tag:foo`). **This script is destructive when `--fix` is passed without
`--dry-run`** — it overwrites the input policy file in place.

An ACL-development lifecycle process (MED confidence, corroborated independently by two
sources): (1) inventory access requirements (roles,
service deps, privileged paths, exception access) → (2) design policy structure (group/tag→
dst:port mapping, SSH policies with session recording) → (3) implement/test (write JSON,
deploy to a staging tailnet first, validate, verify deny rules actually block, security-team
review before prod) → (4) maintain/audit (quarterly review for stale rules, audit access
logs, update groups on membership change, remove deprecated tags/rules).

---

## 3. Groups, tags, autogroups, ipSets, SCIM, and just-in-time access

### 3.1 Groups vs Tags

The same dimensions and best-practice framing are confirmed independently across sources.

| Dimension | Tags | Groups |
|---|---|---|
| Applied to | Devices | Users |
| Assigned via | `tailscale up --advertise-tags=tag:x` (or at auth-key creation, or admin console, or `tailscale set --advertise-tags`) | Policy file only (`groups: {"group:x": [...]}`) |
| Survives the user leaving | Yes | No |
| Key expiry | **Disabled by default** | Normal expiry |
| Use case | Server/CI/service-account identity | Human access control |
| Nesting | a tag can own another tag (`"tag:worker": ["tag:server"]`) | groups **cannot** nest other groups (one source states this explicitly) |

- Tags **must** be prefixed `tag:`. An **empty `tagOwners` list `[]`** for a tag means only
  tailnet **admins** may assign it. The `tag:` prefix requirement is confirmed
  independently.
- A tagged device loses its user association entirely — traffic attributes to the **tag**,
  not the registering user.
- **Untagged devices cannot be referenced in policies** — tag at provisioning time, not
  later (one source's explicit "why").
- Groups can be synced from an IdP: `"group:engineering@example.com": []` synced from Google
  Workspace/Okta — best practice: groups for **people**, tags for **machines**. A worked
  example combining `groups`/`tagOwners`/`grants` with the same "people vs machines" rule
  and IdP-sync naming appears independently:
  ```json
  {
    "groups": {"group:engineering": ["alice@example.com","bob@example.com"], "group:ops": ["ops@example.com"]},
    "tagOwners": {"tag:dev": ["group:engineering"], "tag:prod": ["group:ops"], "tag:monitoring": ["autogroup:admin"]},
    "grants": [
      {"src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"]},
      {"src": ["group:engineering"], "dst": ["tag:dev-servers"], "ip": ["*"]}
    ]
  }
  ```
- Best-practice pattern: dev/staging/prod isolation via per-env tags + group scoping;
  site-to-site connectivity via `tagOwners` on each subnet-router tag +
  `autoApprovers.routes`.
- **Tag naming convention:** `tag:role-environment-location` (e.g. `tag:server-prod-us`) or
  `tag:prod-app`/`tag:staging-db`/`tag:prod-emea-web`. Never log in to a
  server with a personal account — use auth keys + tags instead.
- **Cost model note** (MED confidence, billing specifics unverified beyond this
  source): personal devices count toward plan limits; devices **behind** a subnet router
  do not count; properly tagged infrastructure does not count toward the free tier.

**`groups:` Premium-gating — OPEN, [unverified] (DECISIONS D6):** one source
states flatly "Groups are available on Premium plans. Use tags and autogroups on free/basic
plans." Another source presents `groups` as a plain, universally-usable policy-file feature
with no plan restriction anywhere. Only one can be current truth, or this reflects a genuine
pricing-tier change between when each source was authored — **verify against the current
pricing page before relying on either.**

### 3.2 Autogroups (built-in, need no declaration)

`autogroup:admin`, `autogroup:member` (all tailnet members), `autogroup:tagged` (any tagged
node), `autogroup:self` (same device), `autogroup:internet` (exit-node traffic; dst-only),
`autogroup:nonroot` (non-root SSH users), `autogroup:shared` (src-only, per one source).
Headscale's autogroup set: `autogroup:member`, `autogroup:admin`, `autogroup:tagged`,
`autogroup:internet`.

### 3.3 `ipSets` — named CIDR groups

```json
{"ipSets": {"office-networks": ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]}}
```

**Casing contradiction — OPEN, [unverified] (DECISIONS D6):** one source writes lowercase
`ipsets`, another writes camelCase `ipSets` (one file uses lowercase in one place and
camelCase in another). At most one matches the live schema; do **not** ship either as definitively
correct without checking current official docs or a live policy push. (Worked examples here use
`ipSets` only because it is the more common spelling among the sources consulted,
**not** as a resolution of the contradiction.)

**Headscale gap:** `ipSets` (like `postures` and OIDC-group ACLs) is Tailscale-SaaS-only —
Headscale does **not** support it. This is an explicit vendor-gap statement that also flags
that Headscale's policy-reload via SIGHUP "returns no error on failure — always validate
first," and that ACL `users`/legacy fields are NOT interchangeable with Grant `src`/`dst`. A
Headscale-flavored huJSON authoring example (grants, autogroups, SSH) confirms Headscale's
own autogroup set and tag-name format independently:
```hujson
{
  "grants": [
    {"src": ["tag:monitoring"], "dst": ["tag:webserver","tag:database"], "ip": ["*:*"]},
    {"src": ["tag:webserver"], "dst": ["tag:database"], "ip": ["tcp:5432"]}
  ],
  "tagOwners": {"tag:ci-runner": ["autogroup:admin"]},
  "autoApprovers": {"routes": {"10.0.0.0/8": ["autogroup:admin"]}, "exitNode": ["autogroup:admin"]},
  "ssh": [{"action": "accept", "src": ["autogroup:admin"], "dst": ["tag:webserver"], "users": ["root","ubuntu"]}]
}
```
**Gotcha:** Headscale tag names must be lowercase alphanumeric + hyphens after `tag:`.
Neither source says what Headscale does when it encounters an unsupported
policy key (parse error vs silently-ignored) — that gap is
preserved, not smoothed over.

### 3.4 SCIM provisioning (identity-lifecycle sync)

Enable in admin console under user management → generate a SCIM API key (case-sensitive) →
paste into the IdP's (Okta/Entra/Google Workspace) SCIM config. Once synced, policy-file
group names typically match the IdP group format `group:<name>@<domain>`:
```json
"tagOwners": {"tag:logging": ["group:security-team@example.com"]},
"grants": [{"src": ["group:security-team@example.com"], "dst": ["tag:logging"], "ip": ["*"]}]
```
Role changes in the IdP propagate to access automatically. **Gotcha:** DEACTIVATE users in
the IdP, not suspend — a suspended user retains access until their device keys expire.

### 3.5 Just-in-time / least-privilege access

Least-privilege model = narrow standing access (tags/groups) + time-bound elevation on top,
not broad standing admin. Mechanisms include:
- **Accessbot** — a Slack request-and-approve JIT workflow, time-bound and auto-expiring.
- Device posture attributes gating a grant on device state (§6).
- SSH check-mode (`"action":"check"`), which forces re-auth for risky sessions, tuned via
  `checkPeriod`.

### 3.6 Enterprise rollout sequence (order to introduce identity features)

An 8-step ordered playbook for org-scale rollout (MED confidence — recommended sequence, not
a hard requirement): (1) IdP/SSO (Okta/Entra/Google Workspace) → (2) SCIM
provisioning → (3) Device approval (admin review required for new devices) → (4) Tags+groups
modeling (groups=humans, tags=machines/services) → (5) Device posture baselines via
`srcPosture` → (6) MDM push with pre-approved+tagged auth keys for silent enrollment → (7)
Session recording for SSH audit (§12.2) → (8) Tailnet Lock for cryptographic node signing
(§9).

---

## 4. SSH rules

```json
{"ssh": [
  {"action": "accept", "src": ["autogroup:member"], "dst": ["autogroup:self"],
   "users": ["autogroup:nonroot", "root"]}
]}
```

The "`check` forces re-auth, `accept`
is for headless/non-interactive" split is the primary rule shape here. The identical rule and lesson recur near-verbatim
across at least four further independent units (one adds a `checkPeriod` example
`"8h"`) — strong corroboration, not treated as separate content.

- `"action": "check"` requires **interactive browser re-authentication** on every
  connection — appropriate for production tags needing re-auth + session recording.
  `"action": "accept"` allows non-interactive SSH — needed for unattended/headless/scripted
  access (cron, CI). **This is context-dependent, not a universal winner** (DECISIONS D5):
  `accept` suits an unattended CI/agent host under a narrowly-scoped rule; `check` is the
  safer default for interactive production access. Ship both, with the context that selects
  each.
- **Explicit named CONTRADICTION**: one source recommends
  `"accept"` for non-interactive access as the general answer; a sibling source
  recommends the **OPPOSITE default for
  production** — treat `accept` as a security concern ("grants a shell with no re-auth or
  session recording") and use `check` for production tags specifically. Both are right in
  their own context (automation host vs. interactive production access) — see the D5
  resolution above.
- **Security-boundary clarification:** disabling Tailscale SSH check mode removes periodic
  browser re-authentication; it does **NOT** remove tailnet identity or WireGuard encryption.
  Only use an `accept` rule when source identity, destination device, and destination user
  are **ALL** narrowly restricted (one trusted tailnet identity/device → one worker → one
  non-root Linux account, check mode off). Never broaden the default
  `autogroup:member → autogroup:self → root` rule into `accept` just for convenience — keep
  periodic check mode when stronger interactive assurance is desired, and add a narrow
  `accept` rule scoped as above only to avoid recurring browser checks for one specific,
  tightly-bound automation path. These come from the same source file, corroborating each
  other.
- An `ssh` rule with `"users": ["root", ...]` and `action != "check"` is flagged by the
  static validator above as a WARNING (root access without re-auth).
- `checkPeriod` controls how often `check` re-prompts (e.g. `"8h"`, `"12h"`), with concrete
  values given independently by more than one source.
- SSH access is **never** granted through the primary `grants`/`acls` mechanism alone — it
  needs its **own** `ssh:` rule in addition to the underlying network-level allow (§2.7).
- **Deny-all trailer rule** seen in one policy: `{"action":"deny","src":["*"],"dst":["*"],
  "users":["*"]}` as the final SSH rule, alongside `check`/`accept` rules above it.
- **Platform support gotcha:** Linux/macOS get full SSH support (server+client); Windows is
  server-only; iOS/Android are client-only.
- **Admin-console propagation delay:** an ACL/SSH rule change saved via the admin console
  "can take a few dozen seconds" to propagate — don't assume instant effect when testing
  immediately after saving (MED confidence — a personal note, not official docs,
  but consistent with the JSON shape used elsewhere in this reference). ACLs apply tailnet-wide and are
  **not** managed via per-host config (e.g. NixOS) — always set them via the admin console
  or the API.
- **Narrow single-user/single-destination SSH accept rule** (as distinct from the
  `autogroup:member`/`autogroup:self` default above) — an explicit rule permitting one
  specific user to SSH, as themselves, into one specific tagged/named destination:
  ```json
  {
    "ssh": [
      {
        "action": "accept",
        "src": ["<username>"],
        "dst": ["<destination-host-or-tag>"],
        "users": ["<username>"]
      }
    ]
  }
  ```
  After changing the policy, save AND apply it in the Admin Console (propagation is not
  instant — see above). Reference: <https://tailscale.com/kb/1018/acls/>.

#### Justifying passwordless sudo over SSH by treating Tailscale as the outer security layer

Context: a non-interactive SSH session (e.g. `ssh host "sudo nixos-rebuild switch ..."`) has
no TTY for `sudo` to prompt for a password:

```bash
$ ssh host "sudo some-privileged-command"
sudo: a terminal is required to read the password; either use ssh's -t option or configure an askpass helper
```

One resolution is to allow passwordless sudo for a specific group (e.g. a NixOS
`security.sudo.wheelNeedsPassword = false;` declaration), justified as SAFE by stacking it
underneath two independent gates — Tailscale network membership, and SSH public-key
authentication:

```
public internet
     |  (must be on the Tailscale network)
Tailscale network
     |  (must present a valid SSH private key)
SSH access to the host
     |  (NOPASSWD)
sudo execution
```

Security reasoning documented alongside this pattern:

| Concern | Why it's considered acceptable |
|---|---|
| The passwordless-sudo config is visible in a public repo | It's a policy setting, not a secret |
| "Can anyone use sudo?" | No — Tailscale network membership AND an SSH private key are both required first |
| "Isn't skipping the password dangerous?" | Authentication already happened via the SSH key; a second password on top is redundant, not defense-in-depth |

An attacker who learns the sudo policy still needs BOTH Tailscale network access AND the
SSH private key to do anything with it — knowing the policy alone is not exploitable. This
is a documented rationale pattern for a design REVIEW, not a hardening technique in itself:
it argues that trusting Tailscale-network-membership + SSH-key-auth as the authentication
boundary, and treating `sudo` as authorization-only (no additional secret), is an
acceptable, common practice (cited as widely used across public NixOS dotfiles
repositories). `[unverified]` — treat this trade-off as a design decision to evaluate per
deployment, not a universally endorsed default.
- **`--accept-app-caps` forwards Tailscale identity headers to a local app.** `tailscale
  serve --accept-app-caps=com.example.app/read,com.example.app/write 3000` forwards Tailscale
  identity information (and, per app capability, additional grants) to the local service —
  for apps that need to know the authenticated tailnet identity of the connecting peer.
  Treat these identity/capability headers as trusted **only** when they arrive via the local
  Tailscale Serve proxy path — do **NOT** expose the same upstream directly on an untrusted
  interface where a client could forge the same header names themselves.
- Who may reach a Serve-exposed resource is governed by the ordinary tailnet ACL — same
  mechanism as any other tailnet traffic, no special Serve-only grant type: `{"acls":[
  {"action":"accept","src":["group:developers"],"dst":["group:team-servers"]}]}`
  (MED confidence, illustrative not from official docs).
- **Third-party tool note (out-of-scope for policy/identity, mentioned for completeness):**
  `sshsync` is a fleet SSH/file-transfer CLI wrapper (`sshsync ls`, `sshsync all "<cmd>"`,
  `sshsync group <name> "<cmd>"`, `sshsync push/pull`) that is entirely SSH-config-driven
  (`~/.ssh/config` for connection details) — no separate inventory system, so it composes
  directly with any Tailscale-hostname-based SSH setup. It uses the SSH config **Host
  alias**, not the actual `HostName`, so aliases must be distinct and meaningful; pulling
  from a GROUP creates one subdirectory per host. This is a generic SSH tool, not a
  Tailscale-specific mechanism.

**Session recording** for SSH (and Kubernetes `kubectl` sessions) is a large enough topic to
get its own subsection — see §12.2.

---

## 5. Auto-approvers, subnet routers, and App connectors

```json
{"autoApprovers": {
  "routes": {"10.0.0.0/8": ["tag:infra"]},
  "exitNode": ["tag:exit"]
}}
```

Auto-approves route/exit-node advertisements from tagged (or grouped) devices, skipping the
manual admin-console approval click — the same shape is confirmed independently across
sources. Example with narrower per-CIDR scoping, combined with a device-posture example and
a named `ipSets` block in the same source:

```json
{"ipSets": {"office-networks": ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]},
 "autoApprovers": {"routes": {"192.168.0.0/16": ["tag:subnet-router"]}, "exitNode": ["tag:exit-nodes"]},
 "postures": {"posture:secure": ["node:os == 'linux' || node:os == 'darwin'", "node:tsVersion >= '1.50.0'"]},
 "grants": [{"src": ["group:engineering"], "dst": ["tag:prod"], "ip": ["22"], "capabilities": {"posture": ["posture:secure"]}}]}
```
(Note the `"capabilities": {"posture": [...]}` shape above differs from the `"srcPosture":
[...]` shape used everywhere else here for the same purpose — not reconciled;
treat `srcPosture` as the majority/canonical spelling per §6.) A narrower per-CIDR variant:

```json
{"autoApprovers":{"routes":{"10.0.0.0/24":["group:sre"],"192.168.0.0/16":["group:sre"]},
                  "exitNode":["group:sre"]}}
```

**Approving a route only makes the PATH exist — it is a separate concern from access
policy.** `autoApprovers` auto-approves a device's advertised subnet-route or exit-node
status; `grants`/`acls` still gate **who may actually use** the resulting path.
And — the single most commonly missed step per one source's field experience — **a router
can be online + advertising a subnet, and a client can have `--accept-routes=true` set, and
traffic will STILL not flow until the route is APPROVED** in the admin console (or via
`autoApprovers`). See §2.7 for the same gotcha framed as a checklist item.

Gotcha to check when auditing a "zero trust" policy: confirm exit nodes aren't
unintentionally present in `autoApprovers`.

**App connectors** are a distinct mechanism from a general exit node: they route only
CONFIGURED-DOMAIN traffic through a tagged connector node (`tailscale up
--advertise-tags=tag:app-connector --advertise-connector --auth-key=file:/run/secrets/ts_authkey`)
— useful for SaaS allowlisting or scoped private access to specific internet destinations.
Domain routing itself is a control-plane concern, not a CLI flag. Do not treat an app
connector as a general exit node; keep its routes specific. Connector auth-key/OAuth
credential expiry breaks routing — production reviews should include expiry checks.
An app connector is DNS-based routing (vs the CIDR-based routing of a subnet
router) toward SaaS/cloud-managed services, for predictable egress IPs / SaaS IP
allowlisting.

**Service-mesh integration pattern**: each service gets its own Tailscale identity (as a
sidecar), and ACLs enforce service-to-service access — e.g. `tag:api → tag:database:5432` —
achieving a zero-trust service mesh without a separate mesh product (Istio/Linkerd). (MED
confidence.)

---

## 6. Device posture

Postures gate device compliance (OS version, disk
encryption, third-party EDR); the `IN [...]`/comparison-operator schema and the
"explicit `srcPosture` REPLACES, not adds to, `defaultSrcPosture`" gotcha are corroborated
independently.

```json
{
  "postures": {
    "posture:compliantDevice": [
      "node:os IN ['macos', 'windows']",
      "node:tsVersion >= '1.60'",
      "node:tsAutoUpdate == true"
    ],
    "posture:geoRestricted": ["ip:country IN ['US', 'CA']"]
  },
  "grants": [{
    "src": ["group:dev"], "dst": ["tag:production"], "ip": ["*"],
    "srcPosture": ["posture:compliantDevice", "posture:geoRestricted"]
  }],
  "defaultSrcPosture": ["posture:compliantDevice"]
}
```

Alternate posture-attribute schema seen in another source (comparison-operator form rather
than `IN`/array form — both appear in real-world sources, not reconciled):

```json
{"postures": {"posture:compliant": {
  "tailscale.com/device/os-version": {"minimum": "14.0"},
  "tailscale.com/device/fde": {"eq": true}
}}}
```

- Multiple postures in one `srcPosture` list are **OR'd** (match any one).
- `defaultSrcPosture` applies to grants that don't specify their own `srcPosture` — an
  explicit `srcPosture` on a grant **REPLACES** the default, it does **not add to it**. This
  is called out **independently by two sources** as a common authoring mistake.
- Built-in attrs seen: `node:os`, `node:osVersion`, `node:tsVersion`, `node:tsAutoUpdate`,
  `node:tsReleaseTrack`, `ip:country`. Custom attributes (API/EDR-integration-set, e.g.
  CrowdStrike, Kolide) are available on Premium/Enterprise tiers.
- Requires a plan tier that includes device-posture features.
- Data can be sourced from device registration itself, or third-party EDR integrations.

**Headscale gap:** device posture is Tailscale-SaaS-only; unsupported on Headscale (same gap
noted for `ipSets` above).

---

## 7. OAuth clients vs auth keys vs API keys vs tsnet — which to use, and when

### 7.1 The automation-identity preference ladder (strongest → weakest)

1. **Workload identity federation (OIDC)** — exchange an existing strong identity-provider
   token for Tailscale auth with **no long-lived Tailscale secret stored at all**:
   ```
   tailscale up --client-id=<id> --audience=<aud> --id-token=file:/run/secrets/oidc_token \
     --advertise-tags=tag:ci
   ```
   (provider-specific flows vary — check current CLI/docs for exact flags). This ladder is
   independently corroborated as the "recommended
   auth = workload identity federation, zero long-lived secrets" pattern.
2. **OAuth clients** scoped narrowly to the needed API operations/tags; secrets stored in
   the platform's secret store, never in a repo file.
3. **Reusable auth keys** only when the environment cannot support a stronger identity —
   prefer `file:` inputs over inline flags so the key never appears in shell
   history/process listings:
   ```
   sudo tailscale up --auth-key=file:/run/secrets/ts_authkey --advertise-tags=tag:ci \
     --hostname=ci-${GITHUB_RUN_ID}
   ```

### 7.2 OAuth clients

Admin console: Settings → OAuth clients → Generate. Scopes seen: `devices:read`,
`devices:write`, `keys:write`, `acl:write` (also labeled `Auth Keys: Write` in one
admin-console walkthrough); a `policy_file` scope is used for GitOps ACL pushes (§2.6).
**OAuth client secrets do NOT expire by default** — rotate on a schedule or on suspected
exposure.

```bash
TOKEN=$(curl -s -X POST https://api.tailscale.com/api/v2/oauth/token \
  -d "client_id=$ID&client_secret=$SECRET&grant_type=client_credentials" | jq -r .access_token)
curl -s -X POST https://api.tailscale.com/api/v2/tailnet/-/keys -H "Authorization: Bearer $TOKEN" \
  -d '{"capabilities":{"devices":{"create":{"ephemeral":true,"preauthorized":true,"tags":["tag:ci"]}}}}'
```

`tailscale/github-action@v4` uses an OAuth client id+secret to mint a **short-lived ephemeral
auth key on every run** — it therefore needs the `Auth Keys: Write` scope specifically, not
just `devices:write` (confirmed by a real production walkthrough). Official pattern:

```yaml
- uses: tailscale/github-action@v3   # v2 and v4 also attested elsewhere — see version-note below
  with:
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
    audience: ${{ secrets.TS_OIDC_AUDIENCE }}
    tags: tag:ci
  # permissions: {id-token: write, contents: read}  # required at workflow level
```

**Version-drift note:** sources cite `@v2` (older), `@v3`,
and `@v4` (in a real production example) for the same official Action —
treat as version history, not a conflict; use the current major and check for the latest
release before pinning. Prefer OAuth clients over static auth keys for CI specifically
because they support automatic key rotation and don't expire; the action tears the
connection down automatically at job end. Tag CI runners with a dedicated tag and scope ACL
rules to exactly the hosts/ports the pipeline needs. **GitLab CI pattern**:
install in `before_script`, `tailscale logout` in `after_script`, pass
`--hostname=gitlab-runner-$CI_JOB_ID` to disambiguate concurrent runners.

**GitHub OIDC + ACL tag-owner combo for a CI deploy** (a fuller worked example, corroborated
byte-for-byte across two independent units):
```json
"tagOwners": {"tag:continuous-integration": ["autogroup:admin"]}
```
```json
{"src":["autogroup:member","tag:continuous-integration"],"dst":["<SERVER_IP>"],"ip":["tcp:22","tcp:2222"]}
```
OIDC credential setup at `login.tailscale.com/admin/settings/oauth`: Issuer=GitHub,
Subject=`repo:{owner}/{repo}:ref:refs/heads/{branch}`, Scope=`Auth Keys:Write`,
Tag=`tag:continuous-integration`.

**Browser-driven OAuth registration** (fragile automation detail, MED confidence — two
independent sources describe overlapping but not identical flows):
navigate `https://tailscale.com/register` → click GitHub SSO → if the GitHub "Authorize"
consent button renders disabled, force-enable via JS:
`document.querySelector('button[data-testid="authorize-app"]').disabled = false;
btn.click();` → on the Tailscale device-confirmation page, if "Connect" doesn't respond to
a real click, dispatch a synthetic event:
`btn.dispatchEvent(new MouseEvent('click', {bubbles:true}))`. The registration survey at
`login.tailscale.com` requires: Use case ("Personal or At-Home Use"), Role ("Personal
user"), VPN provider ("I don't use a VPN" — required to enable the Next button). **Gotcha:**
GitHub login may open in a POPUP that gets silently blocked by the browser — check for a
separately-created tab; if the auth URL shows "OAuth state has expired," re-navigate to
`https://login.tailscale.com/login` for a fresh URL. The Tailscale account **name** is
derived from the OAuth provider identity (e.g. `user-handle@github`); the device's
registered **name** comes from the local `tailscaled` hostname — check `hostname` first if
you want a specific device name. Headless-server fallback (called "the most reliable method
for headless servers" by one source): generate an auth key from
`https://tailscale.com/machine/<device>/authkey` and run
`tailscale up --authkey=<key>` — bypasses OAuth entirely.

### 7.3 Auth keys — type matrix and creation

The same four-way type split — one-off /
reusable / ephemeral (~30-60 min auto-removal) / pre-approved / tagged — is confirmed
independently across sources (one gives the concrete provisioning commands
`sudo tailscale up --auth-key=$TS_AUTHKEY --advertise-tags=tag:worker --ssh` and
`--hostname=worker-01` for the MagicDNS name at join time; another frames reusable = same key
for multiple machines / fleet provisioning; ephemeral = machine removed on disconnect,
CI runners/containers; pre-approved = skips admin approval).

| Type | Reusable | Ephemeral | Pre-authorized | Use case |
|---|---|---|---|---|
| One-time | No | No | No | single enrollment |
| Reusable | Yes | No | Optional | batch/fleet provisioning |
| Ephemeral | Yes | Yes | Yes | CI/CD, containers, short-lived workers |
| Tagged | Yes | Optional | Optional | automated servers — device gets tag identity, not user identity |

Create via API (`POST /tailnet/-/keys`, body shape consistent across sources):
```bash
curl -X POST -u "$TS_CLIENT_ID:$TS_CLIENT_SECRET" -H "Content-Type: application/json" \
  "https://api.tailscale.com/api/v2/tailnet/$TS_TAILNET/keys" \
  -d '{"capabilities":{"devices":{"create":{"reusable":true,"ephemeral":false,"preauthorized":true,"tags":["tag:server"]}}},"expirySeconds":86400}'
```
Or the Bearer-token form (also attested, likely both valid — Tailscale's API genuinely
supports either Basic-with-empty-password and Bearer auth, not a true conflict):
```bash
curl -X POST "https://api.tailscale.com/api/v2/tailnet/-/keys" \
  -H "Authorization: Bearer $TS_API_KEY" \
  -d '{"Reusable": true, "Ephemeral": false, "Tags": ["tag:agl-server"], "ExpirySeconds": 86400}'
```
A third variant confirms `expirySeconds` maxing at `7776000` (90 days) with an explicit
`description` field flagged as important — **undescribed keys are "audit-blind"**:
```json
{"capabilities":{"devices":{"create":{"reusable":false,"ephemeral":false,"preauthorized":true,"tags":["tag:dokploy"]}}},"expirySeconds":7776000,"description":"..."}
```
Field semantics: `reusable:true` lets one key mint multiple devices (riskier —
prefer `false` per-device unless provisioning a fleet); `ephemeral:true` auto-deletes
devices on going offline (sidecars/short-lived containers); `preauthorized:true` is
**REQUIRED** for headless provisioning — without it the device sits unauthorized pending
manual admin approval.

CLI wrapper pattern: `./scripts/ts-api.sh create-key --reusable --tags tag:server`,
`--ephemeral`, `--expiry 7d`; `./scripts/ts-api.sh keys` (list); revoke:
`DELETE /tailnet/-/keys/{id}` (existing device sessions are unaffected — only NEW
registrations using that key are blocked afterward).

Use the minted key: `sudo tailscale up --auth-key=tskey-auth-<redacted>` (also spelled
`--authkey=` in several sources — **spelling inconsistency**, see §7.5). Containers commonly
pass it via the `TS_AUTHKEY` env var (this env-var spelling, one word, is consistently
correct across all sources regardless of which CLI-flag spelling they use).

- **The key value is shown only once and cannot be retrieved later** — display prominently
  and save immediately. This is corroborated independently — the auth-key secret (`tskey-auth-...`)
  is returned ONLY ONCE in the `POST /tailnet/-/keys` creation response body; after that only
  metadata (id, capabilities, expiry) is retrievable, and if lost the only recovery is
  delete+recreate.
- Revoked keys **cannot be un-revoked** — require explicit confirmation before revoking.
- Long-lived reusable **and** non-ephemeral keys are flagged as a security concern; rotate,
  and create the replacement key before revoking the old one.
- **Ephemeral device auto-removal:** removed from the tailnet automatically on disconnect
  (one source says "within minutes"; another says "~30-60 min after going
  offline") — IP released,
  disappears from peers' `tailscale status`. Good fit: CI/CD runners (fresh identity per
  job), Docker containers, Kubernetes pods (pod restart = new identity), time-limited
  temporary access. Devices created from `ephemeral: true` auth keys auto-delete from the
  tailnet when they go offline — "a lost device may just be a stopped ephemeral, not a bug."
  A minimal ephemeral CI/CD pattern with hostname templating by job id, confirmed
  independently across two units:
  ```bash
  export TS_AUTHKEY=tskey-auth-xxxxx-ephemeral
  tailscale up --authkey=$TS_AUTHKEY --hostname=ci-runner-$CI_JOB_ID
  # node auto-removed from tailnet when the container stops
  ```
  (A variant templates the hostname by timestamp instead: `--hostname=ci-runner-$(date
  +%s)`.)
- **In-memory ephemeral node pattern** for a batch/CI worker that should leave zero trace:
  ```bash
  sudo tailscaled --state=mem: &
  sudo tailscale up --auth-key=$TS_EPHEMERAL_KEY --hostname=batch-$(date +%s)
  # ... do work ...
  sudo tailscale logout   # immediately removes from tailnet
  ```
  `--state=mem:` keeps daemon state entirely in memory. For persistent servers instead:
  `sudo systemctl enable tailscaled && sudo systemctl start tailscaled`, and disable key
  expiry for critical infra in the admin console.
- **When an auth key expires**, already-enrolled devices are unaffected — the key just can't
  enroll NEW devices going forward.
- **When a device's key expires**, the device loses connectivity until re-auth/re-enroll,
  but stays visible in the admin console until manually removed. Regenerating requires
  updating **every** stored copy of the key (a common recurring failure for ephemeral/
  automated nodes that bake the key at container/pod creation time — may require re-creating
  the pod/service if the platform bakes it in at build time). This is corroborated
  independently: "an expired key is a common recurring failure mode for ephemeral/automated
  nodes; must update EVERY stored copy, not just one env file."
- Talos/Kubernetes `ExtensionServiceConfig` pattern for baking an auth key into a node
  image (byte-identical across two independent units):
  ```yaml
  apiVersion: v1alpha1
  kind: ExtensionServiceConfig
  metadata: {name: tailscale}
  spec:
    environment:
      - TS_AUTHKEY=<redacted>
      - TS_EXTRA_ARGS=--advertise-tags=tag:talos,tag:k8s --accept-dns=false
      - TS_HOSTNAME=talos-cp-1
  ```
  (alternative: `machine.files` writing `/var/etc/tailscale/auth.env` mode `0o600`).

### 7.4 API keys vs OAuth clients — the distinguishing constraint

An API key (personal access token) is tied to a *user*, expires in ≤90 days, and needs
manual rotation. An OAuth client is scoped and does not expire by default, so it is
preferred for long-running automation. Both can mint auth keys; the ladder in §7.1 ranks
OIDC federation above either.

### 7.5 Flag-spelling inconsistency — `--auth-key=` vs `--authkey=` [unverified]

Two consistent "families" of sources disagree on CLI flag spelling: one
consistently writes the two-word hyphenated `--auth-key=tskey-auth-...`; the other
consistently writes the one-word `--authkey=tskey-auth-...` (also seen in `cloud_exec`-style
wrappers and in the Docker/Kubernetes env var name `TS_AUTHKEY`, which **is** the correct
env-var form regardless). These sources do not reconcile which CLI flag spelling is
authoritative — **verify against a live `tailscale up --help` before shipping either form as
canonical** (this was checkable on the reference host per DECISIONS' arbiter policy but was
not in scope for this policy-and-identity slice; treat as unverified here and confirm in the
CLI-reference slice of this skill).

### 7.6 `tsnet` — embedding a Tailscale node directly inside a process (no system daemon)

```go
import "tailscale.com/tsnet"
srv := &tsnet.Server{Hostname: "my-tool", AuthKey: os.Getenv("TS_AUTHKEY"), Dir: "/var/lib/my-tool/tailscale"}
defer srv.Close()
ln, err := srv.Listen("tcp", ":8080")
http.Serve(ln, myHandler())
```

`srv.Listen` returns a `net.Listener` bound directly to the tailnet IP — the process joins
the tailnet as a **first-class device** with **no external `tailscaled` daemon or system
install required**.

| Aspect | tsnet | System Tailscale |
|---|---|---|
| Installation | library dependency only | package install required |
| Isolation | per-process tailnet identity | shared system identity |
| Subnet routing | NOT supported | supported |
| State | app-managed directory | `/var/lib/tailscale` |

Use for: internal CLI tools, custom proxies, edge devices, integration-test harnesses
distributed as a single Go binary with zero user-side Tailscale setup.

### 7.7 Terraform provider — full pattern

```hcl
terraform { required_providers { tailscale = { source = "tailscale/tailscale", version = "~> 0.13" } } }
provider "tailscale" { oauth_client_id = var.oauth_client_id; oauth_client_secret = var.oauth_client_secret; tailnet = var.tailnet }
resource "tailscale_tailnet_key" "server_key" { reusable = true; ephemeral = false; preauthorized = true; tags = ["tag:server"] }
resource "tailscale_acl" "main" { acl = jsonencode({ groups = {...}, tagOwners = {...}, grants = [...] }) }
resource "tailscale_dns_nameservers" "main" { nameservers = ["1.1.1.1","8.8.8.8"] }
resource "tailscale_dns_search_paths" "main" { search_paths = [var.domain] }
output "server_auth_key" { value = tailscale_tailnet_key.server_key.key; sensitive = true }
```

**Resource-name contradiction [unverified]:** a second independent source uses a
differently-named key resource, `tailscale_key` rather than `tailscale_tailnet_key`:
```hcl
resource "tailscale_key" "ci_key" {
  reusable = true; ephemeral = true; preauthorized = true; tags = ["tag:ci"]; expiry = 3600
}
resource "tailscale_acl" "policy" {
  acl = jsonencode({grants = [{src = ["tag:ci"], dst = ["tag:staging"], ip = ["*:*"]}]})
}
```
This is plausibly a provider-version naming change over time (not independently dated in
here) — do not assume either resource name without checking the current Terraform
Registry docs for the `tailscale/tailscale` provider version pinned in your project.

**Ephemeral nodes via Terraform/OAuth, and site-to-site subnet routing**:
ephemeral nodes auto-remove after ~30-60min idle; created via ephemeral auth keys or OAuth
clients with `?ephemeral=true` appended to the client secret. OAuth clients are tag-scoped
credentials minting short-lived auth keys, used by the GitHub Action / K8s operator /
Terraform; scopes are tag-restricted. Auth keys combine flags: `reusable` × `ephemeral` ×
`preauthorized` × `tagged`; default expiry 90 days, max 90. Site-to-site subnet router
(Linux):
```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24 --snat-subnet-routes=false --accept-routes
```
`--snat-subnet-routes=false` preserves source IPs so the remote site can reply; CIDRs must
not overlap between sites; each site needs return routes pointing at its subnet router for
the remote CIDR.

---

## 8. Key expiry and rotation

- **Default expiry:** most-cited figure is **180 days** for regular (non-tagged) devices —
  corroborated independently across at least four sources; one source's API example caps
  `expirySeconds` at `7776000` = **90 days**
  as the API-side maximum for a single key request. **These are not necessarily
  contradictory** (DECISIONS D6): a *device's* key-expiry default and a
  *provisioning key's* max `expirySeconds` may be two different knobs — but the sources do
  not state this distinction explicitly, and one skill's own "hardening advice" halves the
  platform default to 90 days for its own recommendation (confirmed as a named
  CONTRADICTION within that skill itself: `SKILL.md`'s Security Hardening section states
  the admin-console default is 180 days with no explicit change recommendation, while that
  same source's own workflow and template documents
  explicitly recommend setting key expiry to **90 days** — not strictly contradictory, 180 =
  platform default and 90 = the skill's own hardening recommendation, but a reader skimming
  only `SKILL.md` would miss that the skill's OWN best practice halves the default). **Ship
  both numbers, and say they may refer to different things**, rather than picking one as
  *the* default.
- **Tagged devices have key expiry DISABLED BY DEFAULT** (consistent across every source
  that mentions it).
- Disable expiry for a specific device: admin console → Machines page → device menu →
  "Disable key expiry"; API: `POST /api/v2/device/{deviceId}/key {"keyExpiryDisabled": true}`
  or CLI `tailscale set --key-expiry=off`.
- **Node key rotation** (the underlying WireGuard keypair, distinct from the *auth-key*
  expiry concept above) happens automatically roughly every 180 days and is described as
  "seamless" starting **v1.90+**.
- **Force re-auth / extend expiry one-liner:**
  ```sh
  sudo tailscale up --force-reauth --accept-risk=lose-ssh --authkey <the-new-key>
  ```
  Generate the one-use key first at the admin console's Keys page, then verify the new
  expiry on the Machines tab. `--accept-risk=lose-ssh` is required and named for a reason —
  a Tailscale-SSH-only remote box could lock you out mid-reauth if something goes wrong.
  One source notes: "extend the node key expiry, or disable then enable key expiry on the node,
  which effectively extends it for another 30m." A cron-based re-auth workaround also
  appears (`0 0 * * * tailscale up --force-reauth`) but is explicitly called a workaround,
  **not recommended** over disabling expiry outright for infra nodes.
- **Rotation script pattern:** generate new key via API → push to secrets manager → revoke
  the old key ID via `DELETE /tailnet/$TS_TAILNET/keys/$OLD_KEY_ID` only **after** every
  consuming system has been updated to the new key.
- **Lockout risk when public SSH is already disabled:** if the device's Tailscale key
  expires on a box whose public SSH is already firewalled off (e.g. by UFW), the operator is
  locked out entirely. Mitigation for critical servers: disable key expiry in the admin
  console, and keep the cloud provider's own out-of-band console (Hetzner Console,
  DigitalOcean Droplet Console, IPMI/iDRAC, etc.) as the emergency fallback path.
- **Key/credential expiry can fail-closed for routers, connectors, CI, and service
  proxies** — expired auth keys prevent replacement routers/connectors/CI jobs from joining;
  expired OAuth client secrets or under-scoped permissions break automation that mints keys
  or updates policy. Production runbooks for app connectors, subnet routers, the Kubernetes
  operator, GitHub Actions, and long-running containers should explicitly include expiry
  checks. Prefer tagged, ephemeral, short-lived, scoped automation identities over long-lived
  reusable keys checked into CI environments or shared repos.
- **Never pair key-expiry-disabled with no other admission control** — one source's explicit
  guidance: key expiry disabled on `--authkey` servers never forces re-auth on its own, so
  **pair it with Tailnet Lock** (§9) so an unauthorized node still can't silently join even
  though this node's own key never expires. The same source also independently flags SSH
  `accept` (not `check`) as "granting a shell with no re-auth or session recording" — use
  `check` for production tags — and reminds to confirm exit nodes aren't unintentionally
  present in `autoApprovers`, echoing §5.
- **Cloning a VM/container requires resetting the Tailscale identity.** After cloning a
  container or VM (e.g. `CT179` → `CT185`), the clone will conflict with / duplicate the
  source's tailnet identity unless reset explicitly:
  ```bash
  ssh root@<ip> "tailscale down && tailscale up --hostname=<new-name> --authkey=<new-key>"
  ```
- **RunPod / community-pod persisted-state pattern:** to keep the SAME node identity across
  pod stop/start (rather than re-registering each time), persist `--state=` to a
  workspace-mounted path:
  ```bash
  TAILSCALE_SOCKET=/tmp/tailscaled.sock
  tailscaled --state=/workspace/tailscale.state \
    --socket="${TAILSCALE_SOCKET}" \
    --tun=userspace-networking >/tmp/tailscaled.log 2>&1 &
  sleep 8
  tailscale --socket="${TAILSCALE_SOCKET}" up --authkey=<redacted> \
    --accept-routes=false --hostname=airco-gpu
  ```
  Userspace-networking mode is used because "kernel-TUN mode is not reliable" in that
  community-pod environment. **Gotcha:** if `/workspace/tailscale.state` references a node
  already removed from the admin console, `tailscale up` fails — fix by `rm
  /workspace/tailscale.state` then re-`up` with a fresh authkey. (MED confidence —
  single environment-specific source, but concrete and reproduced.)

---

## 9. Tailnet Lock (Network Lock, TKA)

Cryptographic node-join signing: prevents an unauthorized node from joining the tailnet even
if the coordination server itself is compromised — every new node's WireGuard public key
must be signed by an existing trusted signing key first.

**Core pieces:**
- **TLK** (Tailnet Lock Key) — an Ed25519 keypair on the signing node.
- **TKA** (Tailnet Key Authority) — a local, signed hash chain ("like git") tracking
  trusted TLKs + signed node keys.
- **AUM** (Authority Update Message) — a signed state-mutating message.
- **Disablement secrets** — **10 generated at `lock init`**; **any ONE** disables Tailnet
  Lock — the ONLY way to disable it besides Tailscale support. Losing all 10 (without
  contacting Tailscale support) means the tailnet is **permanently locked**, with no
  recovery. Store them offline, in separate secure locations (e.g. a safe / password
  manager, split across custodians).

```bash
tailscale lock init                          # or: tailscale lock init --gen-disablement-secrets=3
tailscale lock status                        # nodes awaiting signature + trusted keys; check on MULTIPLE nodes after init
tailscale lock sign nodekey:<key>
tailscale lock sign tskey-auth-<key>         # pre-sign an auth key for automated deployment
tailscale lock add tlpub:<key>
tailscale lock remove tlpub:<key>
tailscale lock revoke-keys tlpub:<key>       # revoke compromised signing keys — needs co-signing
tailscale lock disable <disablement-secret>
tailscale lock local-disable                 # emergency: THIS node only ignores TL — recovery-only
tailscale lock log                           # TKA audit / change log
```

A simpler two-command form seen independently confirms the basic init+sign shape:
```bash
tailscale lock init
tailscale lock add nodekey:<redacted>
```

**Constraints:**
- Up to **20 signing nodes** per tailnet.
- Rotate TLKs **at most once per year** (bounds TKA chain growth).
- **Mutually exclusive with "Device Approval"** — pick one, not both.
- **Android devices can receive signatures but cannot BE a signing node.**
- Initial trust is "trust on first use" from the coordination server — verify
  `tailscale lock status` on multiple nodes after init to confirm consistency.
- **Not supported on Headscale.**

**GA-date claim — OPEN, [unverified] (DECISIONS D6):** one source dates Tailnet Lock's GA
explicitly to **June 2025** in a "What's New" note; other sources present it as a
long-established, undated feature with no version gate anywhere in their otherwise-detailed
security-features references. Possibly both are true (a long beta predating a formal GA
announcement), but the sources do not resolve it — do not assert a GA date without
independent confirmation.

---

## 10. Containers and Kubernetes

### 10.1 Docker

Minimum working Docker Compose block for kernel-mode Tailscale + MagicDNS — every listed
setting fixes one specific failure mode if removed (per source's own table):
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

Sidecar deployment variant:
```yaml
version: '3.8'
services:
  tailscale:
    image: tailscale/tailscale:latest
    container_name: tailscale
    hostname: my-service
    environment:
      - TS_AUTHKEY=<redacted>  # Pre-auth key
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_EXTRA_ARGS=--advertise-tags=tag:container
    volumes:
      - tailscale-state:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - net_admin
      - sys_module
    restart: unless-stopped
volumes:
  tailscale-state:
```
**Gotcha:** requires the host `/dev/net/tun` bind-mount and both `net_admin` + `sys_module`
capabilities; the auth key is a long-lived secret baked into `TS_AUTHKEY` unless rotated.

Plain `docker run` form and a second compose variant confirm the same environment
variables:
```bash
docker run -d --name=tailscale --cap-add=NET_ADMIN --device=/dev/net/tun \
  -e TS_AUTH_KEY=tskey-auth-... -e TS_ROUTES=192.168.1.0/24 tailscale/tailscale
```
```yaml
# docker-compose
services:
  tailscale:
    image: tailscale/tailscale:latest
    environment: [TS_AUTHKEY=tskey-auth-xxxxx, TS_STATE_DIR=/var/lib/tailscale, TS_EXTRA_ARGS=--advertise-tags=tag:container]
    volumes: [tailscale-state:/var/lib/tailscale, /dev/net/tun:/dev/net/tun]
    cap_add: [net_admin, sys_module]
```
**Docker `TS_ROUTES` is silently skipped if first-boot auth fails** — if the auth key used
by `containerboot` has invalid/missing tags (`requested tags are invalid` in logs — the tag
must exist in ACL `tagOwners` and the key's creator must be an owner of that tag), route
advertisement via `TS_ROUTES` is skipped **without a clear top-level error**, and subsequent
restarts may re-auth but not re-advertise. Fix at runtime: `tailscale set
--advertise-routes=<CIDR>`.

### 10.2 Kubernetes

**DaemonSet with userspace networking** — `TS_USERSPACE=true` avoids the `NET_ADMIN`/
`/dev/net/tun` requirement in restricted k8s environments (used with `sys_module`/no-tun
setups), confirmed byte-identical independently across sources:
```yaml
apiVersion: v1
kind: Secret
metadata: {name: tailscale-auth, namespace: tailscale}
type: Opaque
stringData: {TS_AUTHKEY: "<redacted>"}
---
apiVersion: apps/v1
kind: DaemonSet
metadata: {name: tailscale, namespace: tailscale}
spec:
  selector: {matchLabels: {app: tailscale}}
  template:
    metadata: {labels: {app: tailscale}}
    spec:
      containers:
      - name: tailscale
        image: tailscale/tailscale:latest
        env:
          - {name: TS_AUTHKEY, valueFrom: {secretKeyRef: {name: tailscale-auth, key: TS_AUTHKEY}}}
          - {name: TS_KUBE_SECRET, value: tailscale-state}
          - {name: TS_USERSPACE, value: "true"}
        securityContext: {capabilities: {add: ["NET_ADMIN"]}}
```

**Kubernetes Operator (GA April 2025)** — `helm repo add tailscale
https://pkgs.tailscale.com/helmcharts && helm upgrade --install tailscale-operator
tailscale/tailscale-operator --namespace tailscale --create-namespace --set-string
oauth.clientId=<> --set-string oauth.clientSecret=<>` (OAuth client needs `devices:write`).
Expose a `LoadBalancer` service via annotations:
```yaml
metadata:
  annotations: {tailscale.com/expose: "true", tailscale.com/hostname: "my-app-k8s", tailscale.com/tags: "tag:k8s-service"}
spec: {type: LoadBalancer}
```
(For HTTPS+MagicDNS use an `Ingress` with `ingressClassName: tailscale` instead.) Subnet
routing without a dedicated VM via the `Connector` CRD:
```yaml
apiVersion: tailscale.com/v1alpha1
kind: Connector
spec: {hostname: k8s-subnet-router, subnetRouter: {advertiseRoutes: [10.96.0.0/12, 10.244.0.0/16]}, tags: [tag:k8s-connector]}
```
For HA egress (cluster pods reaching tailnet resources) use the `ProxyGroup` CRD (operator
v1.60+) for multiple proxy replicas. Deployment modes: operator-managed proxy pod (per
service, for exposing/egress), sidecar (per-pod isolation, no operator), DaemonSet (one
Tailscale pod per node, node-level subnet routing). Requirements: Kubernetes v1.23.0+;
operator and proxy image versions should match (proxies may lag up to 4 MINOR versions);
most CNIs work but Cilium in kube-proxy-replacement mode needs special config; EKS Fargate
supports only Ingress and API-proxy modes.

**Operator prerequisites, and the RBAC/tailnet-policy orthogonality:** the operator needs a
Tailscale credential (normally an OAuth client) and tag ownership for the tags it will
assign; the tailnet policy must **separately** allow the operator+proxy tags to act.
Kubernetes RBAC controls what the operator can do **inside** the cluster — tailnet policy
controls **who can reach** the resulting Tailscale identities; these are **orthogonal
layers**, do not assume one substitutes for the other:
```json
{"tagOwners":{"tag:k8s-operator":["autogroup:admin"],"tag:k8s":["tag:k8s-operator"]},"grants":[{"src":["group:platform"],"dst":["tag:k8s"],"ip":["tcp:443"]}]}
```
Read-only checks: `kubectl get pods -n tailscale`, `kubectl get crd | rg 'tailscale'`,
`kubectl get ingress,svc -A`, `kubectl get proxygroup,proxyclass,connector,recorder -A`.

**K8s Operator vs OS extension — tradeoffs** (Talos-specific but generalizes): an
OS extension is persistent across K8s outages, node reachable via `talosctl` even before the
API server, but requires a schematic rebuild per Talos version. The K8s Operator (Helm)
gives native K8s/Ingress integration and auto-cleanup, but dies if the control plane is
down and gives no node-level access. Install: `helm repo add tailscale
https://pkgs.tailscale.com/helmcharts && helm install tailscale-operator
tailscale/tailscale-operator --namespace tailscale --create-namespace --set-string
oauth.clientId=<id> --set-string oauth.clientSecret=<secret>`.

**Talos-specific subnet routing** (advertise pod/service CIDRs):
```yaml
machine:
  files:
    - content: |
        TS_AUTHKEY=<redacted>
        TS_ROUTES=10.244.0.0/16,10.96.0.0/12
        TS_EXTRA_ARGS=--advertise-tags=tag:talos --snat-subnet-routes=false --accept-routes
      path: /var/etc/tailscale/auth.env
      permissions: 0o600
      op: create
machine:
  sysctls:
    net.ipv4.ip_forward: "1"
    net.ipv6.conf.all.forwarding: "1"
```
`--snat-subnet-routes=false` preserves the original client IP for audit/logging;
`--accept-routes` lets the node use routes from other tailnet devices; IP-forwarding
sysctls are required for subnet routing to work at all. Routes must be approved in the
admin console unless auto-approvers are configured.

### 10.3 Subnet routers — manual, scripted, and Ansible

```bash
sudo tailscale up --advertise-routes=192.168.1.0/24
# admin console: Machines > device > Edit route settings > approve
sudo tailscale up --accept-routes     # Linux clients only — other platforms auto-accept
```
Script `setup_subnet_router.sh <cidr> [auth_key]` (idempotent): installs
tailscale if missing, enables IPv4+IPv6 forwarding via `/etc/sysctl.d/99-tailscale.conf`
(falls back to `/etc/sysctl.conf`), verifies `/proc/sys/net/ipv4/ip_forward == 1` (exits 1 if
not), optionally enables UDP GRO forwarding via `ethtool -K $NETDEV rx-udp-gro-forwarding on
rx-gro-list off` for perf, starts `tailscaled` via systemd, runs `tailscale up
--advertise-routes=$SUBNET [--auth-key=... --advertise-tags=tag:subnet-router]`.

Ansible playbook equivalent:
```yaml
- name: Setup Tailscale Subnet Router
  hosts: routers
  become: yes
  tasks:
    - name: Install Tailscale
      shell: curl -fsSL https://tailscale.com/install.sh | sh
      args: {creates: /usr/bin/tailscale}
    - name: Enable IP forwarding
      sysctl: {name: "{{ item }}", value: "1", sysctl_file: /etc/sysctl.d/99-tailscale.conf, reload: yes}
      loop: [net.ipv4.ip_forward, net.ipv6.conf.all.forwarding]
    - name: Configure Tailscale
      command: >
        tailscale up --auth-key={{ tailscale_auth_key }} --advertise-routes={{ advertised_routes }}
        --advertise-tags=tag:subnet-router --hostname={{ inventory_hostname }}
      changed_when: "'Success' in result.stdout"
```

**Bash fleet-provisioning script** — tagged reusable auth key + parallel SSH install:
```bash
SERVERS=("10.0.1.10" "10.0.1.11" ...); TAGS="tag:prod,tag:api"
AUTH_KEY=$(curl -s -X POST "https://api.tailscale.com/api/v2/tailnet/$TAILNET/keys" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"capabilities\":{\"devices\":{\"create\":{\"reusable\":true,\"tags\":[\"$TAGS\"]}}}}" | jq -r '.key')
for server in "${SERVERS[@]}"; do
  ssh "$server" "sudo apt-get update && sudo apt-get install -y tailscale && \
    sudo tailscale up --authkey=$AUTH_KEY --hostname=api-\$(hostname -s)" &
done
wait
```

---

## 11. Device management via API/CLI/MCP tooling

Beyond the raw REST recipes in §2.5.2, several sources wrap the same operations as a
named tool/CLI set:

- **Tool set names**: `tailscale_device_list`, `tailscale_device_get`,
  `tailscale_device_authorize`, `tailscale_device_routes_get/set`,
  `tailscale_device_tags_set`, `tailscale_device_posture_get/set`, `tailscale_device_delete`
  (requires `confirm=true`). Equivalent CLI-style form: `cloud_exec('tailscale', 'device
  list|get <ID>|authorize <ID>|delete <ID>|tag <ID> tag:server')`. Route changes affect
  network topology and ACL-tag changes affect access permissions — both require an explicit
  warning to the user before applying, and any destructive action (delete) requires
  explicit confirmation plus a warning if the device is currently online (removing an
  active device disconnects it immediately). Always re-verify with a read op after any
  mutation.
- **Enumerating from `tailscale status --json` directly** (no API call): iterate
  `data['Peer']` for `HostName`/`Online`/`TailscaleIPs`; key expiry by iterating self+peers
  for `KeyExpiry` (empty = "no key expiry, pre-auth or disabled"); ACL via API:
  `curl -s -H "Authorization: Bearer $TAILSCALE_API_KEY"
  "https://api.tailscale.com/api/v2/tailnet/$TAILNET/acl"`; exit nodes: filter peers with
  `ExitNodeOption` truthy, mark `ACTIVE` if `ExitNode` is set, else `available` (current exit
  node = the peer with `ExitNode` true); subnet routes: `peer['PrimaryRoutes']`.
- **Full device onboarding workflow** — key-type decision table + MCP tool sequence:
  fleet deployment → reusable key; single device → single-use key;
  containers/CI → ephemeral key; automated setup → preauthorized key. Default expiry 90
  days, ephemeral devices 1 day. Sequence: create key → `tailscale up --authkey=<key>` on
  target → poll `tailscale_device_list` for it to appear → `tailscale_device_authorize` if
  not preauthorized → `tailscale_device_tags_set` → (if subnet router)
  `tailscale_device_routes_get`/`_set` → (if exit node) enable exit-node route via
  `routes_set` → `tailscale_device_posture_set` if needed → verify via
  `tailscale_device_get` + `tailscale_acl_test`. **Gotcha:** "Auth key value is shown only
  once — warn the user to save it immediately." Tag changes affect ACL permissions; route
  changes affect network topology — both should be surfaced to the user before applying.
- **Headscale device lifecycle**: `headscale preauthkeys create --user <user>
  --tags <tag> --expiration <duration> --reusable --ephemeral`. Tagged nodes belong to the
  special auto-created `tagged-devices` user. Delete: `headscale nodes delete -i <node-id>`
  or `DELETE /api/v1/node/<node-id>`. **Gotcha:** default auth-key expiration is 1 hour;
  ephemeral nodes vanish entirely (no record) on disconnect.

---

## 12. Enterprise and compliance features

### 12.1 Aperture — AI gateway (beta)

A centralized AI gateway between LLM clients (coding agents, apps, scripts) and upstream
providers (OpenAI/Anthropic/Google/Bedrock/Vertex/OpenRouter/others), gated through the
tailnet identity model. Four mechanisms:
- **Identity** — Tailscale identity per connection, no separate API keys.
- **Routing** — client names a model, Aperture looks up the provider and injects
  credentials.
- **Telemetry** — async request/response/tokens/duration/tool-use/session capture.
- **Session tracking** — auto-detects Claude Code/Codex session IDs.

Deny-by-default, same as the rest of the policy model. **Grant shapes are NOT
interchangeable as written between the two places Aperture is configured**: the same
capability `tailscale.com/cap/aperture` appears in EITHER Aperture's own config (no `dst`
field — destination is implicit) OR the tailnet policy file (`dst` **REQUIRED**, e.g.
`["tag:aperture"]`):
```json
{"grants": [{"src": ["group:engineering"], "app": {"tailscale.com/cap/aperture": [
  {"role": "user"}, {"models": "anthropic/**"}]}}]}
```
`role` and `models` are separate objects inside the array; `models` is a **single glob
string** (not an array — add more `{"models":...}` entries for multiple patterns); `role`
is **REQUIRED** (missing → HTTP 403 even with a matching `models`). A `connectors` entry
(array of FQN globs) grants MCP tool/HTTP connector access. Roles: `user`, `admin`.
`group:` sources require visible groups enabled for the Aperture device.

Spending quota (token-bucket):
```json
{"quotas": {"daily:<user>": {"capacity": "$10.00", "rate": "$5.00/day", "on_exceed": "reject"}}}
```
`<user>` = per-person bucket, `<node>` = per-device; `on_exceed:"reject"` → HTTP 429.

Provider config:
```json
{"providers": {"anthropic": {"baseurl": "https://api.anthropic.com", "apikey": "<redacted>",
  "models": ["claude-sonnet-4-6","claude-opus-4-7","claude-haiku-4-5"],
  "authorization": "x-api-key", "compatibility": {"anthropic_messages": true}}}}
```

Quickstart: create instance `open https://aperture.tailscale.com`; dashboard from tailnet
device `open http://ai/ui/`; smoke-test `curl -s http://ai/v1/messages -H "Content-Type:
application/json" -d '{"model":"claude-haiku-4-5","max_tokens":25,"messages":[{"role":
"user","content":"hello"}]}'`; hostname `ai` resolves via MagicDNS (use `http://`, not
`https://`). **Gotcha:** beta, docs drift fast — treat as orientation, fetch live docs for
specifics; the `dst`-field difference between the two grant locations is a common config
error. (MED confidence, explicitly beta per source.)

### 12.2 Session recording (`tsrecorder`) — SSH and kubectl audit trail

Records Tailscale SSH sessions (stdout/stderr) and Kubernetes `kubectl
exec`/`attach`/`debug`/`run` sessions (+ optionally all K8s API requests) to a `tsrecorder`
node. Output format: asciinema `.cast` (newline-delimited JSON, grep-able/replayable). **What
is NOT captured:** stdin/keystrokes (typed passwords not recorded); output IS captured.

A `tsrecorder` node joins the tailnet like any device (Docker container or K8s `Recorder`
CR). The SSH server / K8s operator **STREAM** session data over WireGuard to the recorder.
Writes to local disk or S3-compatible storage (S3, MinIO, GCS, Wasabi, R2). Wired by
**POLICY**, not per-host config: SSH → `recorder` field on an `ssh` access rule; K8s →
`tailscale.com/cap/kubernetes` grant pointing at the recorder tag. `enforceRecorder: true` =
fail-closed (deny session if recorder unreachable); **DEFAULT IS FAIL-OPEN**. Multiple
recorders sharing one tag = automatic failover (lowest tailnet IP first).

Deploy (Docker, S3 backend):
```bash
docker run --name tsrecorder --rm -it \
  -e TS_AUTHKEY=$TS_AUTHKEY -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -v $HOME/tsrecorder:/data tailscale/tsrecorder:stable \
  /tsrecorder --dst='s3://s3.us-east-2.amazonaws.com' --bucket=$S3_BUCKET_NAME --statedir=/data/state --ui
```
Drop AWS vars + use `--dst=/data/recordings` for local storage. `--ui` = web viewer (needs
HTTPS on tailnet). On EC2 with an IAM role attached, omit access/secret keys. K8s deploy via
`Recorder` CRD:
```yaml
apiVersion: tailscale.com/v1alpha1
kind: Recorder
metadata: {name: recorder}
spec:
  enableUI: true
  tags: ["tag:k8s-recorder"]
  storage: {s3: {endpoint: s3.us-east-1.amazonaws.com, bucket: tsrecorder-bucket, credentials: {secret: {name: s3-auth}}}}
```
Requires the operator installed + `tag:k8s-recorder` owned by `tag:k8s-operator`. Enable SSH
recording:
```json
"tagOwners": {"tag:session-recorder": ["<owner>"]},
"ssh": [{"action": "check", "src": ["group:engineering"], "dst": ["tag:server"], "users": ["autogroup:nonroot"],
  "recorder": ["tag:session-recorder"], "enforceRecorder": true}]
```
Enable K8s recording:
```json
"grants": [{"src": ["group:engineering"], "dst": ["tag:k8s-operator"], "app": {"tailscale.com/cap/kubernetes": [
  {"recorder": ["tag:tsrecorder"], "enforceRecorder": true, "enableEvents": true}]}}]
```
`enableEvents: true` additionally records K8s API requests (not just kubectl sessions) —
**ALPHA feature (v1.90+)**, ALSO requires `TS_EXPERIMENTAL_KUBE_API_EVENTS=true` on the API
server proxy AND an `acls` rule allowing `tag:k8s-operator:443` (so `enableEvents` alone is
**insufficient**). Viewing: admin console review, web UI at
`https://<recorder-name>.<tailnet-dns>.ts.net` (needs `--ui`+tailnet HTTPS), CLI `asciinema
play <file.cast>` or grep the file. Storage layout: `<stablenodeid>/<timestamp>.cast`.
**Gotcha:** `enableEvents` alone is NOT sufficient for K8s API event recording — needs the
env var + ACL rule too; `enforceRecorder` defaults to fail-OPEN, not fail-closed.

### 12.3 Zero-trust posture — layered security model, and automated compliance reports

**Three-layer mental model** for explaining/auditing the zero-trust posture (MED
confidence): **Identity layer** — OIDC-compatible IdP auth, SSO (Okta/Azure AD/Google
Workspace/GitHub), MFA via IdP policy, key expiry forces periodic re-auth. **Network layer**
— default-deny ACL, per-connection authZ by identity+tags, no implicit trust by network
location, all traffic WireGuard-encrypted (256-bit keys). **Device layer** — unique
WireGuard keypair per device, device authorization required before network access, Network
Lock prevents unauthorized node addition, ephemeral nodes for temp workloads.

**Automated compliance report generator** (5 named `zero_trust_checks`, MED
confidence): `encryption` (**always PASS** — "All connections use WireGuard end-to-end
encryption"), `identity_based_access` (PASS iff ALL nodes have non-empty `tags`, else FAIL),
`least_privilege` (**always REVIEW** — manual ACL review required), `continuous_verification`
(PASS iff no node has empty `key_expiry`, else WARNING), `device_trust` (**always REVIEW** —
verify device authorization + Network Lock status manually). **Gotcha:** the "encryption
always PASS" check is **not actually verifying anything at runtime** — it's a static claim,
not a real check. Template for a periodic automated zero-trust posture report combining
automatable checks (tags, key expiry) with flagged-for-manual-review items.

### 12.4 Enterprise rollout sequence, deployment planning template

See §3.6 for the 8-step identity-first rollout order. A parallel **initial network
deployment** sequence (5 steps) is documented independently — see §15.

---

## 13. Safety rules for an agent/automation driving Tailscale management

**Default to READ-ONLY.** A Tailscale-management agent should default to safe, read-only
commands: `tailscale status`, `tailscale ping`, `tailscale netcheck`. **FORBIDDEN without
explicit request:** `tailscale down`, `tailscale logout`, ACL policy changes. Never expose
auth keys (they grant network access). Exit-node changes route **ALL** traffic through that
node — confirm intent. Subnet-route advertisement affects routing for **ALL** peers.

**Live-testing an API-driving tool safely.** For every MCP/API tool: call it, verify the
response shape; for WRITE tools, verify the entry was created then **CLEANUP** and verify
removal. Explicitly SKIPPED (destructive) tools across domains in one such live-test
protocol: `device_delete`, `device_authorize`, `device_routes_set`, `device_tags_set`,
`device_posture_set`, all `dns_*_set` tools, `acl_set`, `acl_preview`,
`tailnet_contacts_set`, `log_stream_set`. The **only** full write+cleanup cycle exercised is
**auth-key create → get → delete → list-confirm-gone**, using
`capabilities.devices.create.reusable=false`, `capabilities.devices.create.ephemeral=true`,
`expirySeconds=3600`, `description="mcp-live-test"`. This is the safe pattern for testing an
API-driving tool against a **LIVE** tailnet without risking real device/ACL/DNS state.
`tailscale_acl_test` called with `[]` validates ACL behavior non-destructively.

**Every listed set of pitfalls above (§2.7, §7.5, §8) generalizes to:** auth keys expire by
default — nodes lose access after expiry unless set non-expiring; MagicDNS overrides system
DNS for tailnet domains — can conflict with corporate DNS; exit-node routing routes **ALL**
traffic, not just tailnet traffic; overlapping subnet routes from multiple nodes cause
routing ambiguity; ACLs are deny-by-default — **removing** a rule **BLOCKS** access, it does
not open it; `tailscale down` disconnects but keeps auth, `tailscale logout` removes the
node entirely; key rotation requires re-authentication — schedule during maintenance
windows.

---

## 14. Worked production examples

### 14.1 Hetzner/Debian deploy stack — Tailscale-SSH-only, zero public port :22, ACL + OAuth + GitHub Actions end-to-end

The most complete, fully-wired, real-production reference for "zero-trust SSH via
Tailscale, driven end-to-end from CI" documented here. The reference architecture
explicitly locks: **NO public port :22 ever** — SSH reachable ONLY via `tailscale up --ssh`
(outbound WireGuard tunnel from the VPS, invisible to any inbound firewall). Admin-console
ACL used in production:
```jsonc
{"tagOwners": {"tag:ci": ["autogroup:admin"], "tag:prod": ["autogroup:admin"]},
 "acls": [{"action":"accept","src":["autogroup:admin"],"dst":["*:*"]},
          {"action":"accept","src":["tag:ci"],"dst":["tag:prod:22"]}],
 "ssh": [{"action":"accept","src":["autogroup:admin","tag:ci"],"dst":["tag:prod"],"users":["deploy"]}]}
```
**Explicit named footgun:** omitting the `autogroup:admin` SSH rule means **ONLY** `tag:ci`
can reach the VPS — the human operator's OWN `ssh deploy@<host>` gets refused by Tailscale
SSH, because `autogroup:admin` is what grants the human's interactive access alongside the
CI pipeline's tag-scoped access. On the VPS: `tailscale up --ssh --hostname=<name>
--auth-key=tskey-auth-<reusable=false,ephemeral=false,tags=tag:prod>`. GitHub Actions:
`tailscale/github-action@v4` with `oauth-client-id`/`oauth-secret` (scope `Auth Keys:
Write` — the action mints a **short-lived ephemeral auth-key on EVERY run**, hence needing
key-CREATE authority, not just device-read/write), `tags: tag:ci`. The deploy step then
SSHes to `deploy@$SSH_HOST` (the Tailscale hostname) with a hardened non-interactive session
(`StrictHostKeyChecking=accept-new`, `ConnectTimeout=30`, `ServerAliveInterval=15`,
`ServerAliveCountMax=4`) to pull the new image and `docker compose up -d`. A separate CI
step (Prisma-specific, but the pattern generalizes) tunnels a DB migration **THROUGH** the
same Tailscale-SSH session rather than exposing Postgres — Postgres is bound to
`127.0.0.1:5432` on the VPS (loopback only), reachable for migration **ONLY** via the SSH
session, never on the tailnet or the public internet at all.

### 14.2 Host-nftables fallback — `iifname` vs `iif` boot-ordering footgun

For a provider with **NO** upstream cloud firewall (OVH, bare VPS), the admin-access rule in
a host nftables ruleset for the Tailscale interface **MUST** be `iifname "tailscale0"
accept` — **NOT** `iif "tailscale0"`. `iif` resolves the interface **INDEX** at
ruleset-**LOAD** time; since nftables starts (at boot) **BEFORE** `tailscaled` has created
the `tailscale0` interface, `iif "tailscale0"` fails to load at all with "Interface does not
exist" — and the **ENTIRE** firewall then fails to load, leaving the box either fully open
or (depending on the `flush ruleset`/policy ordering) locked. `iifname` matches the
interface **NAME** at packet-arrival time (runtime), not the index at load time, so it
tolerates the interface not existing yet at boot.

```nft
table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    ct state invalid drop
    ct state established,related accept
    iifname "tailscale0" accept    # NAME match — NOT `iif`, which fails at boot
    tcp dport { 80, 443 } accept   # the only public-facing ports
    ip protocol icmp accept
    ip6 nexthdr ipv6-icmp accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
  chain output  { type filter hook output  priority 0; policy accept; }
}
```

**Mandatory verification**: validate persistence with a **REAL** reboot (not just `nft -f`/
reload), then `systemctl is-active nftables` must report `active`; separately confirm from
**OUTSIDE** the box that port 22 **TIMES OUT** (`nc -zvw3 <public-ip> 22`). **Docker-bypasses-
nftables caveat (compounding gotcha):** Docker inserts its own DNAT/FORWARD rules evaluated
**BEFORE** the host nftables INPUT chain — so this host firewall protects **ONLY**
non-Docker-published ports; it is **NOT** a substitute for binding Docker-published services
to `127.0.0.1`/the Tailscale IP instead of `0.0.0.0`. **Why this matters:** "Interface does
not exist" at boot is a **SILENT** failure mode — the ruleset simply never loads, and
depending on `policy drop`/`policy accept` defaults this can mean either total lockout or
(worse) an unprotected box, discovered only much later. *(Author states this was
empirically validated with a real reboot test.)*

### 14.3 Multi-cloud provisioning at scale

Cloud-init runcmd pattern, corroborated by two independent sources with matching structure:
```yaml
#cloud-config
runcmd:
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --authkey=tskey-auth-... --hostname=$(hostname) --ssh
  - systemctl enable --now tailscaled
```
For subnet routers, enable IP forwarding **BEFORE** advertising routes in the same `runcmd`
block. Store auth keys in the cloud provider's OWN secret manager (AWS Secrets Manager / GCP
Secret Manager / Azure Key Vault) and retrieve at boot — never embed in the cloud-init
template itself. AWS example: `tailscale set --advertise-routes=10.0.0.0/16
--advertise-exit-node` on an EC2 instance to expose the whole VPC. GCP/Azure follow the same
pattern (install → enable cloud-provider-level IP forwarding → advertise routes). Fly.io/
Railway/Render: use the Docker image with an auth key; prefer **EPHEMERAL** keys for
auto-scaling platforms so scaled-down instances don't accumulate as stale tailnet devices.

**Hetzner-specific notes**: use `cx22` or higher (RAM headroom); allow UDP 41641
inbound in the Hetzner cloud firewall for **DIRECT** WireGuard connections (avoids
DERP-relay latency); after Tailscale is up, remove all other Hetzner firewall rules. A full
Hetzner example additionally provisions a `deploy` sudo user, installs `ufw`/`curl`/`jq`,
then locks down with UFW (`default deny incoming` / `allow outgoing` / `allow in on
tailscale0` / `--force enable`) as part of the same cloud-init `runcmd`.

### 14.4 "Never Funnel" hard invariant — Mercury tailnet ACL model

A per-device-tag ACL model mapping `tag:gpu/mobile/cloud/mac` all to one owner email, with
port-scoped grants (e.g. `tag:mobile,tag:mac → tag:gpu:8765,5173,8766`), applied via
`tailscale set --policy-file=acls.hujson`. The distinctive feature: a hard invariant stated
**TWICE** in the skill (and matching `CLAUDE.md` rule): **never `tailscale serve
--funnel`** for this app — if public access is needed, proxy through a separate
public-facing service (Cloud Run) that calls back into the tailnet, never expose the app
itself. An identity-aware-proxy trust-model example.

---

## 15. Deployment and rollout workflows, checklists, and planning templates

**5-step initial tailnet rollout** (MED confidence — recommended sequence): (1)
Plan Network Architecture (inventory devices, map topology, plan subnet routing, plan
exit-node placement) → (2) Configure Identity Provider (SSO, MFA enforcement, map IdP groups
to Tailscale groups, set key expiry — recommended 90 days, see §8's contradiction note) → (3)
Deploy Nodes (critical infra first, then endpoints, subnet routers, exit nodes, MagicDNS) →
(4) Configure ACLs (deny-all baseline, groups matching org structure, tag-based policies,
test in audit mode before enforcement, document business justification) → (5) Validate and
Monitor (test connectivity, verify ACL enforcement blocks, enable audit logging, configure
alerts).

**3-workflow phased checklist** (a template, not vendor-verified procedure): (1)
Initial Tailnet Deployment — plan architecture → configure IdP/SSO/MFA + 90-day key-expiry
policy → deploy nodes (infra first, then endpoints, then subnet routers/exit nodes/MagicDNS)
→ configure ACLs (deny-all baseline, audit-mode test before enforcement) → validate +
monitor. (2) ACL Policy Development — inventory access needs → design groups/tags →
implement in test/staging first, review with security team → maintain (quarterly review,
prune stale rules). (3) Headscale Self-Hosted Deployment — provision server + TLS (Let's
Encrypt) + Postgres/SQLite + firewall (443 + DERP ports) → install/configure Headscale +
OIDC + DERP → onboard users/pre-auth-keys → operational maintenance (rotate pre-auth keys,
backup DB, update versions).

**Production review checklist**: least-privilege policy with
groups/tags/grants-or-acls/`tests`/`sshTests`; narrow `tagOwners` (ordinary users must not
self-assign production tags); scoped+rotated+expiry-monitored auth keys/OAuth
clients/workload-identity-federation; device approval + posture matching the org's trust
model; subnet routes/exit nodes/app connectors/Serve/Funnel/Services all having **EXPLICIT**
owners and rollback steps; public Funnel exposure reviewed as intentional with app-layer
auth; HA for routers/connectors where downtime matters; logs/network-flow-logs/audit-logs/
webhooks wired into monitoring; an update policy for clients and routers; and incident
responders who know how to collect `tailscale bugreport`/local logs **WITHOUT** leaking
secrets.

**Deployment planning template** (checklists for network/groups/tags/routes/exit-nodes/
rollout phases): Network Architecture (org, tailnet name, IdP, key-expiry policy,
self-hosted Y/N), User Groups table (group name / description / member count / access
level, pre-filled with `group:engineering`, `group:sre`, `group:security`,
`group:management`), Infrastructure Tags table (`tag:production`, `tag:staging`,
`tag:development`, `tag:database`, `tag:monitoring` with owner group + environment), Subnet
Routes table (CIDR / description / router node / auto-approved), Exit Nodes table (hostname
/ location / purpose / auto-approved), a 10-item Security Checklist (IdP+MFA, 90-day key
expiry, deny-all ACL default, Network Lock, SSH re-auth for privileged users, audit logging,
subnet-route approval restriction, exit-node approval restriction, untagged-node policy,
ephemeral keys for CI/CD), and a 3-phase Rollout Plan (Phase 1 Infrastructure:
servers/subnet-routers/exit-nodes/ACL test; Phase 2 User Onboarding: pilot → full rollout →
legacy VPN decommission → training; Phase 3 Hardening: Network Lock, Tailscale SSH with
session recording, auto-approvers, monitoring/alerting).

---

## 16. Audit script patterns

- **`scripts/agent.py`** (identical across multiple real-world deployments) — "Tailscale zero trust
  VPN deployment audit agent." Uses `requests` to hit the live Tailscale API v2
  (`https://api.tailscale.com/api/v2`) with a Bearer-token API key. Fetches devices, ACL,
  DNS nameservers, keys, webhooks; runs `audit_devices()` and `audit_acl()` to flag
  HIGH/MEDIUM/INFO/CRITICAL findings (disabled key expiry, missed updates, shields-up mode,
  allow-all ACL rule, unrestricted SSH accept). CLI: `--api-key` (required, **plaintext
  argv** — a credential-hygiene footgun), `--tailnet` (default `-`), `--output` (optional
  JSON dump). Not destructive (read-only GETs), no sudo required — a pure API-audit script.
- **`scripts/process.py`** (identical across multiple real-world deployments) — "Tailscale Zero Trust
  VPN Management and Monitoring." Three parts: (1) `TailscaleACLGenerator` — builds and
  validates ACL policy dicts from Python calls, exports to a JSON file (§2.7); (2)
  `TailscaleMonitor` — shells out to local `tailscale status --json` via `subprocess.run`
  (10s timeout, tolerant of missing binary / timeout / bad JSON → returns `{}`), parses the
  peer list into `TailscaleNode` dataclasses, computes a health report (online/offline
  counts, keys expiring <30 days, untagged nodes, exit nodes) and a canned zero-trust
  compliance report (§2.7, §12.3); (3) `generate_example_policy()` — a runnable demo that
  builds a 4-group / 6-tag / 4-ACL-rule / 2-SSH-rule policy and writes it to
  `tailscale_acl_policy.json` in the CWD. Reusable technique: `validate_policy()`'s explicit
  permissive-rule / undefined-group / root-without-reauth checks are a concrete lint you can
  lift wholesale. Not destructive; the only local-system interaction is the read-only
  `tailscale status --json` subprocess call and writing a JSON file to disk — no sudo
  needed.
- **`ts_call.sh`** (§2.5) — a generic REST-call CLI wrapping the policy-file API
  (`createKey`, `setPolicyFile`, `validateAndTestPolicyFile`), always dry-runnable before
  `--yes`.
- **`migrate-acls-to-grants.py`** (§2.3) and **`validate-policy.py`** (§2.7) — see their
  respective sections for full detail.

---

## GAPS

- **`ipsets` vs `ipSets` casing** — unresolved; needs current official docs
  or a live policy-file push to settle (DECISIONS D6).
- **`groups:` Premium-gating** — unresolved; may reflect a genuine pricing-tier change over
  time rather than a true disagreement (DECISIONS D6).
- **Tailnet Lock GA date** — unresolved; the available sources give no way to distinguish "beta long
  before GA" from "no GA gate at all" (DECISIONS D6).
- **Grants `ip` bare-port-number syntax** (`["22"]` vs `["tcp:22"]`) — only one source uses
  the bare form; not corroborated (DECISIONS D6).
- **`--auth-key=` vs `--authkey=` CLI flag spelling** — two internally-consistent but
  mutually exclusive "families" of sources; not reconciled (§7.5).
- **Node-key-expiry default (180d) vs API `expirySeconds` cap (90d, 7776000s)** — likely two
  different knobs (device default vs per-request key maximum) but no source states this
  distinction explicitly; do not collapse them into one number.
- **What Headscale does with an unsupported policy key** (`postures`, `ipSets`,
  OIDC-group-based ACLs) — no source says whether it's a parse error or a silent no-op. A
  policy author porting a Tailscale-SaaS policy to Headscale should not assume either
  behavior without testing against the target Headscale version.
- **Whether `acls`+`grants` conflicts truly resolve "more restrictive wins"** — stated by
  one source's troubleshooting doc, not independently corroborated elsewhere.
- **Whether `srcPosture`'s comparison-operator form (`{"minimum": "14.0"}`) and the
  `IN [...]`/`>=` string-expression form are the same schema version or two different
  Tailscale policy-schema generations** — both appear verbatim across sources with no
  reconciliation.
- **`tailscale_tailnet_key` vs `tailscale_key` Terraform resource naming** — two sources
  give different resource names for the same auth-key-creation purpose; not reconciled,
  possibly a provider-version difference (§7.7).
- **`tailscale/github-action` version drift** — `@v2`/`@v3`/`@v4` all appear across
  sources for the same official Action; treated as version history here, not verified
  against the current release (§7.2).
- **`tailscale serve`/`tailscale funnel` command usage itself** — no unit in this
  policy-and-identity slice describes what `serve`/`funnel` DO, how they interact with a
  reverse proxy, TLS/cert behavior, or client-IP/header visibility to a backend service
  beyond the ACL `nodeAttrs` gating keys (`funnel:deny`, `mullvad:deny`) and the
  `--accept-app-caps` identity-header forwarding flag. No mention of `X-Forwarded-For` or
  `Tailscale-User-*` header passthrough here — that belongs in a
  networking/serve-focused reference slice, not here.
- **iOS/Android/mobile-specific behavior** — iOS and Android are supported OSes for device
  installation, but MagicDNS-on-mobile behaviour, HTTPS/secure-context requirements, and
  Safari specifics are not documented here.
- **`sshsync`'s relationship to Tailscale identity** — the tool is generic SSH-config
  tooling that happens to compose with Tailscale hostnames; nothing establishes a deeper,
  Tailscale-specific integration beyond that (§4).
