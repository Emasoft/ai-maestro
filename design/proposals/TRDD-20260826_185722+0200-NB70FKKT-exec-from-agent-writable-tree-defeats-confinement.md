---
trdd-id: NB70FKKT
title: An unconfined process executing a script from the agent-writable tree defeats the sandbox entirely
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:57:22+0200
updated: 2026-08-26T19:44:57+0200
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
severity: high
labels: [security, impersonation, sandbox, cross-project]
external-refs: [TRDD-O0RHX7K6, TRDD-K4BEKT3L, TRDD-EVO7T245]
---

## Problem

Found by the ai-maestro-janitor session, applying this card set's own writable-guarantor
predicate to their tree. Verified first-hand here before filing.

A process running OUTSIDE the agent sandbox executes a script that lives INSIDE the
agent-writable tree. A confined agent writes the script; the unconfined process runs it. That
is a general-purpose escape from the confinement layer, available through a supported feature.

## Evidence (measured 2026-08-26, both sides)

Their exec site, read rather than grepped:

```
scripts/plugin_manage.py:55   agent_cli() -> ~/ai-maestro/scripts/aimaestro-agent.sh
scripts/plugin_manage.py:175  cli = agent_cli() if backend == BACKEND_AIMAESTRO
scripts/plugin_manage.py:194  subprocess.run(cmd)
```

Our side of it:

```
-rwxr-xr-x 1 <agent-uid> staff  scripts/aimaestro-agent.sh
writable by agent uid: True
```

Second exec path they flagged: `terminal_trigger._resolve_aimaestro_cli` resolves the CLI via
`$AIMAESTRO_CLI`, then `$HOME/.local/bin`, then PATH — an ENV VAR deciding what gets executed.

## Why this is a PREREQUISITE on TRDD-O0RHX7K6, not a follow-up

**Today it grants nothing.** Under single-uid, an agent that can write that script can already
do anything that uid can do, directly. No privilege boundary is crossed and this is NOT a live
vulnerability — the janitor was explicit about not overstating it, and that restraint is right.

**It becomes live the moment confinement exists.** The whole value of TRDD-O0RHX7K6 is that a
confined agent cannot reach another agent. This call site hands it a way: write the script,
wait for an unconfined process to execute it. Building the profile first and discovering this
after would mean shipping a boundary with a documented hole in it.

This is the general form and it is worth stating as a class rather than an instance:
**confinement is defeated by anything unconfined that consumes attacker-writable input** —
a script, a config that names a command, an env var that selects a binary.

## Task

1. INVESTIGATE — enumerate every site, in this repo AND in the fleet plugins, where an
   unconfined process executes or sources something from an agent-writable path, or resolves
   what to execute from agent-writable config or an env var.
2. ASSESS — for each, whether the executing process is inside any agent's sandbox.
3. SAFEGUARD — the exec'd artifact must live somewhere the agent uid cannot write (this is
   TRDD-K4BEKT3L's safeguard, which is why the two are linked), or the caller must verify it
   against a known digest before executing.

## Acceptance

- [ ] Exec-from-writable-tree sites enumerated across this repo and the fleet plugins, each
      with the executing process and whether it is sandboxed.
- [x] Env-var-selected exec paths (`$AIMAESTRO_CLI` and any sibling) included in that list.
      DONE 2026-08-26: `$AIMAESTRO_CLI`, `$MEMGREP_BIN` (6 call sites / 5 modules),
      `$CLAUDE_PLUGIN_OPTION_HEARTBEAT_COST_COMMAND` — every one READ in source, not grepped.
- [ ] A stated remedy per site: relocate the artifact, or verify before exec.
- [ ] TRDD-O0RHX7K6 does not ship its profile as a claimed boundary until this list is empty
      or every remaining entry is documented as an accepted hole.

## Re-ranked 2026-08-26 — the lead instance is NOT the one this card was filed on

The janitor hand-audited their own tree (their TRDD-KHM8XOYN) and **corrected their own earlier
report**: the harness-CLI exec this card was filed on is not the sharpest instance, because it
only fires inside a harness agent (`backend == BACKEND_AIMAESTRO`).

**The sharper class is an env var, and it is VERIFIED HERE, not taken on report:**

```
wikimem_syntax_lint.py:74   override = os.environ.get("MEMGREP_BIN")   <- read FIRST, no path constraint
shutil.which('memgrep')  -> /Users/<user>/.cargo/bin/memgrep
  writable by agent uid : True
  its DIRECTORY writable: True
```

All three legs are agent-writable and the first is a bare env var with no constraint at all.
Read by 6 modules, **two of which run with nobody present**: a detector on every heartbeat, and
a hook on every edit. Every project, every beat, no harness required.

**Rank order for this card, corrected:**

1. `$MEMGREP_BIN` → `which(memgrep)` → `~/.cargo/bin/memgrep` — unattended, fleet-wide.
2. The harness CLI: `plugin_manage.py:55→175→194`, `terminal_trigger.py:1378`,
   `harness_backend.py:569`, and `$AIMAESTRO_CLI` → `~/.local/bin` → PATH.
3. ~45 `shutil.which` sites for gh/uv/git/jq/npx/claude. Reported by them as a CLASS and
   deliberately NOT enumerated — it is the generic PATH story, identical for every program on
   the machine, and **padding a security list with it is how the real entries get discounted.**
   Only relevant if the sandbox profile constrains PATH itself. `daemon_path.py:147` already
   passes an explicit `path=` instead of inheriting, i.e. it does the constrained thing.
4. Shell `source` / `sys.path.insert` from outside the repo — **EMPTY**, recorded as a negative
   result rather than omitted, because importing IS executing and that shape was the one most
   likely to be missed.

## The dispatcher stub is NOT the pattern to copy

They had told me the stub's verified-walk was "likely the ANSWER rather than a finding", then
withdrew it on closer reading. It is **FAIL-OPEN by cardinal rule** — verbatim: *"Every
uncertainty … is ACCEPTED — we never block what we cannot prove bad."* So an attacker need not
forge a manifest; deleting one suffices.

**That is correct for the problem the stub solves and is NOT a defect** — a bricked heartbeat
needs a human to recover, which is strictly worse in the single-uid world we actually inhabit.
The narrow point that matters here: the verified walk is an **AVAILABILITY mechanism, not a
confinement boundary**, and must not be cited as the pattern for a hard-fail exec gate. Building
one means accepting the bricked-heartbeat risk this design explicitly refuses — a trade for the
owner, not something to inherit by leaving the earlier sentence unchallenged.

## Enumeration status — PARTIAL, and the worker said so

`reports/impersonation-audit/20260826_185951+0200-exec-from-writable-tree.md` (gitignored):
2 seeds confirmed, +5 Class-A, +4 Class-B, 1 Class-C. **The janitor's 656 subprocess sites were
only partly reviewed.**

### VERIFIED hit-by-hit 2026-08-26T19:28 — every reported hit is REAL; one NEGATIVE is not

`reports/impersonation-audit/20260826_192745+0200-exec-from-writable-tree-VERIFICATION.md`.
Every cited line read in its source file. **10/10 positives CONFIRMED** (A1-A5, B1-B4, C1) —
the worker inflated nothing. Lead item re-measured here: `which memgrep` →
`~/.cargo/bin/memgrep`, file W_OK **True**, dir W_OK **True**.

Three corrections, all pushing the same direction the report did not look:

1. **A claimed-CONTAINED gate is not contained.** The report marked `mcp-discover` `configPath`
   mode *"CONTAINED, not a hit — Verified correct"*. The 403 prefix check IS correct about the
   file it READS, and the line below it derives `pluginRoot = dirname(resolved)` from the
   **pre-`realpath`** path, never containment-checked. That value replaces
   `${CLAUDE_PLUGIN_ROOT}` in the temp `.mcp.json`, which becomes `argv` at
   `mcp_discovery.py:147` (`Popen(args=command)`). A real host `.mcp.json` uses it in argv
   (`node ${CLAUDE_PLUGIN_ROOT}/dist/index.js`), so a symlink from anywhere → a legitimate
   plugin `.mcp.json` passes the gate and picks the attacker's directory as the exec root.
   Grants nothing under single-uid, and it is a gate the sandbox would be resting on.
   Remedy: use `realResolved` for BOTH the read and the `pluginRoot`.

   **Chain read FRONT-TO-BACK, after two adversarial reviews each caught a different unread
   segment** (the first the middle, the second the front — closing a gap RELOCATES it unless you
   walk to a named endpoint):
   `route execFileSync('uv',['run',SCRIPT,tmpFile,safeName,…])` → `:2326` one flat parser, no
   subcommands, positionals `config_path`/`server_name` → `:2698 main` → `:2709
   merge_config_into_args` → `:1213 detect_transport_from_server_config` → `:1096 "command" in
   config ⇒ "stdio"` (true of a real plugin config) → `:1219 get("command")` → `:1222
   _resolve_command_value` → `:1066 an absolute path returned VERBATIM` · `:1224 get("args")` →
   **no resolution at all** → `:1367 [command, *args]` → `:1324 StdioMCPClient` → `:164
   Popen(args=)`. **No containment check on any hop** — including `:2079 validate_args`, the one
   hop that could have REFUTED this and was therefore read last when it should have been first.
   `:2079-:2122`, read whole: argument COHERENCE only (timeouts, transport/option compatibility,
   auth combos, `--method` dependencies), never the VALUE of `command`/`args`.
   **`validate_args` validates `--url` syntactically and does not validate the stdio command at
   all.** (Stated flat, as evidence. An earlier draft added *"the code knows how to constrain a
   target and does not constrain this one"* — an imputation of OVERSIGHT, which is a claim about
   intent no reading of the file can support: a URL has a closed grammar and a local command path
   has none, so the asymmetry is equally consistent with "URLs are checkable, commands are not".
   The finding needs no motive, and one disputable sentence is how a reviewer discounts a whole
   card. It survives in the message of commit `a0a0c337`, which cannot be edited.)

   Three further hops read afterwards, so no route to `Popen` is left assumed: the
   `merge_config_into_args` **tail** (`:1228-:1264` — `cwd` type-checked then
   `_resolve_path_like_value`, `env` type-checked; **no late containment guard**),
   `determine_secret` (`:1162-:1182` — secret prompting only), and
   `split_argv_for_server_command` (`no "--" in argv ⇒ server_command = []`, so the route cannot
   reach `build_stdio_command`'s verbatim-passthrough branch). That last one rested on a PARTIAL
   read of `execArgs`; read whole (`route.ts:109-144`) every push is a known flag with a
   `shellSafe`-scrubbed value and **no `--` appears anywhere**, so the third route to `Popen` is
   closed by measurement rather than by likelihood. All 7 pushes enumerated: `--format`,
   `--dangerously-output-the-raw-response`, `--timeout`, `--no-prompt-key`, `--method`,
   `--tool-name`, `--tool-arg`. **No `--command` and no `--transport`** — which is the half that
   actually mattered: either would have made `merge_config_into_args`'s guard
   (`if args.command is None and not args.server_command:`) FALSE and stopped `:1219-:1227`,
   the block this whole finding rests on, from executing at all. Their absence is what makes the
   measured branch the taken one.

   Second spelling of the same landing: `_resolve_command_value` absolutises any `command`
   carrying a separator, but **`args` are never resolved** — so `command: "node"`,
   `args: ["./payload.js"]`, `cwd: <attacker dir>` reaches the same place. Precisely: `Popen`
   chdirs the child, then NODE resolves the relative script arg against its own cwd — the
   resolution is the interpreter's, not `exec`'s, so this spelling holds only for interpreters
   that behave that way. It adds nothing the absolute-path spelling does not already carry;
   kept only because it shows the unresolved `args` list is the durable half.

   **A POTENTIAL second carrier of the same pre-`realpath` defect — `route.ts:145`
   (DOWNGRADED, see below; first written as a confirmed second instance):**

   ```ts
   env: { ...process.env, ...(configPath ? { CLAUDE_PLUGIN_ROOT: dirname(resolve(configPath)) } : {}) },
   ```

   The attacker-chosen directory is not only substituted TEXTUALLY into the temp `.mcp.json`; it
   is EXPORTED as `CLAUDE_PLUGIN_ROOT` to the child — again from `resolve()`, never
   `realResolved`. `mcp_discovery.py` copies `os.environ` into `merged_env` and passes it to
   `Popen(env=merged_env)`, so the spawned MCP server inherits it.

   **DOWNGRADED IN THE SAME SESSION — INHERITING IS NOT CONSUMING, and my "fix both or it stays
   live" line was BACKWARDS.** I promoted this to a confirmed carrier on the strength of the
   value being PRESENT in the child env, never having found anything that READS it.
   `grep -rn CLAUDE_PLUGIN_ROOT scripts_dev/mcp_discovery.py app/api/settings/mcp-discover/route.ts`
   returns **three hits, all in the route, none in the script**: `:92` a comment, `:95` the
   textual `.replace()`, `:145` this env export. **The only measured consumer is the route's own
   substitution — carrier ONE.** So fixing `:95` closes the measured route; it does not, as I
   wrote, leave a second one open.
   The env export is worth fixing as the same one-line mistake (a third-party MCP server reading
   `CLAUDE_PLUGIN_ROOT` is a real Claude-Code convention), but that consumer is **outside this
   repo and unmeasured**, so it is a POTENTIAL carrier, not a second finding.
   Scope note: the export is gated `if (configPath)`, so **class C / serverConfig mode never
   carries it** — it applies only to the symlink escape, the mode where an attacker had to work
   for it.

   BOTH routes are uncontained — the `args` list is not *stronger*, only simpler to demonstrate,
   since the resolver hands back an absolute `command` unchanged. And `_build_client` (`:1442`,
   `:1485`) is a SECOND entrypoint with the same shape, so this is not one call site to relocate.
2. **The unattended reach is UNDERSTATED.** "Two run with nobody present" measures as four, and
   the widest is every PROMPT: `hooks/on-prompt-submit-autorecall.py:346` (inside `main()`, the
   module entrypoint) → `user_mem_lib:524` → `$MEMGREP_BIN`. Plus
   `hooks/post-edit-wikimem-lint.py` (every edit), `memory-librarian` (every beat),
   `detectors/wikimem-syntax.py`. QUALIFIED after a review caught me asserting "past ONLY a
   length guard" over 37 lines I had not read: the call is reached on an ordinary prompt while
   `CLAUDE_PLUGIN_OPTION_MEMORY_AUTORECALL` is on (opt-out, default ON), excluding slash
   commands, `[janitor-` markers, and very short prompts. Reach stands; "only" did not.
3. **"Read by 6 modules" is 6 CALL SITES across 5 modules** (`user_mem_lib` holds two).
   Not load-bearing; recorded so the number is not re-quoted wrong.

Also: A5's exec target lives in **gitignored `scripts_dev/`** — an exec'd script no review or
CI gate ever sees. Coverage is unchanged by this pass (656 still partial), so box 1 stays open.

Method note worth keeping: they tried to delegate their sweep and the worker wedged at 182 bytes
with no output. They caught it and hand-audited instead. **A wedged agent's silence and a clean
sweep are indistinguishable**, so an unnoticed wedge would have produced an empty report written
with total confidence.
