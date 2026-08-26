---
trdd-id: NWTTU0AQ
title: mcp-discover accepts an arbitrary inline serverConfig and spawns its command — any authenticated agent gets code execution
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T13:00:27+0200
updated: 2026-08-26T13:00:27+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
labels: [security, rce, route-authz]
external-refs: [TRDD-R268J32X]
---

## Problem

`POST /api/settings/mcp-discover` has **two** input modes, and only one of them is contained.

- **`configPath` mode — CONTAINED, not the bug.** `resolve()` → `realpath()` (so symlinks and
  `..` are collapsed *before* the check) → must start with `~/.claude/plugins/` or 403. Correct.
- **`serverConfig` mode — UNVALIDATED.** The caller supplies an arbitrary object, and the route
  does exactly this (`app/api/settings/mcp-discover/route.ts`):

  ```ts
  const mcpJson = { mcpServers: { [safeName]: serverConfig } }
  tmpFile = join(os.tmpdir(), `mcp-discover-${Date.now()}.json`)
  writeFileSync(tmpFile, JSON.stringify(mcpJson))
  ```

  `shellSafe()` is applied to `serverName`, `format`, `method`, `toolName` and each `toolArg` —
  **and never to `serverConfig`**, which is passed through whole.

**An MCP server config's whole purpose is to name a command to spawn**, and the script does spawn
it — verified first-hand rather than inferred from the shape,
`scripts_dev/mcp_discovery.py:127-165`:

```
command: list[str]                  # :127
if not command: raise MCPError(...)  # :141
popen_kwargs = { "args": command, … } # :148-149
self.proc = subprocess.Popen(**popen_kwargs)  # :165
```

So an authenticated caller posting
`{"serverName":"x","serverConfig":{"command":"/bin/sh","args":["-c","…"]}}` gets **arbitrary
command execution as the server user**. `execFileSync` on the route side prevents shell injection
into the *discovery script's* argv — it does nothing about a command the script is designed to
launch from its config file.

**Why authn-only is not a defence here.** The route's own header records the rationale: *"Any
authenticated caller may discover tools; agents legitimately need this for the mcp-discovery
skill."* That reasoning is sound for the **`configPath`** branch — discovering a plugin the
operator already installed. It does not extend to letting the caller **define** the server. The
comment is evidence the second branch was never considered under that ruling, not evidence it was
approved.

## Scope — one honest mitigating fact, and why it does not close the card

`SCRIPT_PATH` is `scripts_dev/mcp_discovery.py`, and **`scripts_dev/` is gitignored**
(`.gitignore:123`). On a clean deploy the file is absent and the route 500s at its own
`existsSync` check, so a fresh clone may not be exploitable. **This does not close it:** the file
is present on THIS host (112 KB, verified), the guard is an accident of packaging rather than a
control, and a route whose safety depends on a dev script being missing is one `git add -f` or one
dev-mode deploy away from live. Treat the absence as luck, not as a boundary.

## Proposed fix

1. **Validate `serverConfig` against an allowlist schema before writing it** — at minimum, refuse
   any config whose `command` is not on a known-good list, or drop the branch entirely if nothing
   needs it (the caller-enumeration step below decides which).
2. **Or require a stronger principal for the `serverConfig` branch only** (`enforceSystemOwner`),
   leaving `configPath` discovery available to agents as the header intends. This keeps the
   legitimate skill working and removes the arbitrary-command surface.
3. Anything that only hardens `shellSafe` is NOT a fix — the payload never passes through
   `shellSafe`, and it is a JSON object, not a shell string.

## Verification

- A test posting a `serverConfig` with a `command` must be REFUSED, with a neuter proving the test
  reddens when the check is removed.
- A test proving the `configPath` branch still works for an authenticated agent (the legitimate
  path the header describes).
- Assert **no subprocess was spawned** on the refusal, not merely the status — a 403 returned after
  the spawn is still execution.
- Re-check `tests/unit/agent-route-authorization-coverage.test.ts`: this route sits in
  `NON_AGENTS_AUTHN_ONLY`. Raising the branch to `enforceSystemOwner` makes `STRONG_AUTHZ` match
  the FILE, so the ledger entry must be removed in the SAME commit (R268J32X's own acceptance box
  records a 30-minute red suite from exactly that oversight).

## Acceptance

- [ ] Enumerate callers of the `serverConfig` branch specifically (the UI's standalone-MCP flow
      from `~/.claude.json`) — decides between fix 1 and fix 2, and must not be guessed
- [ ] Ruling recorded here
- [ ] Guard implemented per the ruling
- [ ] Refusal test asserting NO spawn + neuter recorded
- [ ] `configPath` legitimate-path test still green
- [ ] Ledger updated in the SAME commit if the guard becomes STRONG_AUTHZ

## Approval log

- 2026-08-26T13:00:27+0200 — FILED, `min-approval-requirement: manager`. Found while deciding
  `settings/mcp-discover` for TRDD-R268J32X. The route was read because its ledger neighbour
  `plugin-builder/scan-repo` had just been cleared on the "where does the fetched thing land"
  question; here the answer is `subprocess.Popen`.
