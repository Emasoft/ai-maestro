---
trdd-id: NB70FKKT
title: An unconfined process executing a script from the agent-writable tree defeats the sandbox entirely
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:57:22+0200
updated: 2026-08-26T20:22:55+0200
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
2. The harness CLI: `plugin_manage.py:55→175→194`, `terminal_trigger.py:1350`
   (grep-verified; this card said `:1378` and the source report said `:1357` — both wrong, both
   propagated without anyone opening the file),
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

## Box 1: the "656 subprocess sites" figure does not reproduce, and a grep cannot triage them

Measured first-hand in the installed janitor 3.3.26 (read-only slice, taken while the fix
decision was pending):

| what | count |
|---|---|
| `subprocess.` references, whole plugin tree | 1034 |
| CALL SITES of `run\|Popen\|check_output\|check_call\|call`, whole tree | **604** |
| the same, under `scripts/` only (excludes `tests/`) | **205** |

So **656 is not reproducible** — it is near 604 and not equal to it, and it was inherited into
this card without a population sentence. Use 604 tree-wide / 205 under `scripts/`, or re-derive.

**More useful than the count: a line-oriented needle CANNOT triage this population.** Profiling
the first argument of all 205 `scripts/` calls: **115 have nothing after the open paren** — the
call wraps and argv begins on the next line — plus 26 `# noqa` comments and 24 matches that are
the `subprocess.PIPE` kwarg of an outer call. Only a handful expose a first arg on the same line
(`cmd`, `argv`, `["git"…]`). A single-line grep therefore reports a small number for the
*dangerous* shape (mine said 6) that is an artifact of line-wrapping, not a measurement — the
same shape as every other false zero on this card.

**What box 1 actually needs is an AST pass** (`ast.parse` → walk `Call` nodes → classify argv[0]
as literal / name / expression), not another grep.

### The AST pass, run — box 1's janitor half is 77 sites, not 656

`reports/impersonation-audit/20260826_200812+0200-janitor-argv0-ast-census.md` (gitignored)
carries the full enumeration. Under `scripts/`:

| argv[0] shape | count |
|---|---|
| LITERAL (a constant first element) | 117 |
| NAME (argv is a bare variable) | 34 |
| NAME-in-list | 22 |
| EXPR-in-list | 11 |
| EXPR | 10 |
| **TOTAL call sites** | **194** |

**77 non-literal sites** — that is the real size of the remaining janitor triage, and it is
tractable by hand. (The AST also corrects my own grep from the previous slice: 194, not 205 —
grep counted an outer call's `subprocess.PIPE` kwarg as a site.)

**POSITIVE CONTROL — the instrument finds all three sites already known to be true:**
`plugin_manage.py:194` (the card's founding seed), `detectors/memory-librarian.py:490` (the
`$MEMGREP_BIN` rank-1 item), and `lib/terminal_trigger.py:1372` (the `$AIMAESTRO_CLI` path,
adjacent to `_resolve_aimaestro_cli` at `:1350`). A census that missed any of them would be
reporting a number about a set it cannot see.

**Not yet done, and NOT to be confused with the above:** non-literal argv[0] is a CANDIDATE
shape, not a finding — most of the 77 will resolve to `sys.executable`, a hardcoded `git`, or a
PATH lookup. Classifying each against "is the resolved target agent-writable, and is the caller
unconfined" is the remaining work, and it is per-site reading, not another sweep.

### Triage pass — 19 of the 77 auto-classify, 58 need a human read

`…-janitor-argv0-triage.md` (gitignored). A resolver follows a bare `NAME` back to its
assignments in the enclosing function: **19** land in `sys.executable` / PATH-`which` / env-var /
literal-via-assignment; **58 do not** and are enumerated for reading.

Shapes worth reading FIRST, because they are the card's own rank-1 class (a string becoming
argv) rather than a resolved binary:
`handoff_clear_verify.py:349` (`cmd.split()`), `lib/agentlens_probe.py:199`
(`shlex.split(command)`), `lib/fleet_inject.py:571` (`plan['argv']` — argv from a data
structure), `oauth_rotator/safe_storage.py:519/532/548` (argv built by a helper).

#### The six, READ — 2 new class-B sites, 1 already covered, 3 false positives

| site | what it is | verdict |
|---|---|---|
| `handoff_clear_verify.py:344-350` | `$CLAUDE_PLUGIN_OPTION_HANDOFF_VERIFY_CONTEXT_COMMAND`, `.split()` → argv | **NEW class B** |
| `lib/agentlens_probe.py:185,199` | `probe_json(command)` → `shlex.split(command)`; its own noqa says "argv from config" | **NEW class B** (same agentlensPro-command family) |
| `lib/fleet_inject.py:571` | `plan["argv"]`, a resolved CLI + validated session | already covered — this is a DOWNSTREAM consumer of the `$AIMAESTRO_CLI` chain the card already ranks at 2 |
| `oauth_rotator/safe_storage.py:519/532/548` | helpers returning a hardcoded `["secret-tool", …]` | **NOT hits** — argv[0] is a literal; my resolver simply could not follow it through a function return |

**The new site differs from the heartbeat-cost one in the way that matters: it is DEFAULT-ON.**
`CLAUDE_PLUGIN_OPTION_HEARTBEAT_COST_COMMAND` returns early when unset (opt-in). This one
defaults to a non-empty `agentlenspro get_burn_status`, so absent any config it runs and resolves
`agentlenspro` through PATH on every verify. Same class, strictly wider exposure.

**Instrument correction factor for the remaining 52:** 3 of these 6 were false positives from one
blind spot — the resolver cannot follow argv through a helper's RETURN, only through assignments
in the same function. Rather than carry that as a caveat over 52 hand-reads, the resolver was
fixed to follow returns (v3 report, gitignored). Deduped, the whole population reconciles:

| argv[0] resolves to | count |
|---|---|
| LITERAL | 117 |
| PATH-`which` | 11 |
| `sys.executable` | 7 |
| LITERAL via a helper's return | 3 |
| **UNRESOLVED — the human-read set** | **56** |
| total | **194** |

**Three controls, all passing** — recorded because a classifier's output is only worth its
controls: the totals sum to 194 and LITERAL is 117, both matching the authoritative census; the
3 safe_storage sites left the flagged set (the false-positive class is gone); and the 3 sites
already KNOWN true are **still flagged**, so the fix removed noise without losing a positive.

That last one is not luck and is worth stating: `memory-librarian.py:490` stays unresolved
because `binary = _find_memgrep()` returns a bare `override` name, so following one hop of
returns still does not reach `os.environ`. **A resolver that had "resolved" it would have been
the broken one.**

Box 1's janitor half is therefore **56 sites of hand-reading**, from an inherited 656.

Two instrument caveats, stated because the numbers are the deliverable:
- The triage script walks `Module` AND `FunctionDef`, so **its bucket counts are double-counted
  and must not be quoted** — only the deduplicated unresolved list is sound. Authoritative totals
  stay the AST census (194 / 117 / 77).
- I nearly wrote "47" here, inferred from a `head -50`-truncated view of the same list. Counted
  properly it is **58**. Estimating a count from a deliberately truncated screen is the same
  defect as reading a `tee`-truncated file — and I introduced the truncation myself.

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

   `route.ts:145` also EXPORTS the same unchecked value as `CLAUDE_PLUGIN_ROOT` into the child
   env (gated `if (configPath)`, so class C never carries it). **Nothing in this repo reads it on
   the exec path** — `mcp_discovery.py` has zero references — so it is a POTENTIAL carrier only,
   live iff the spawned third-party server reads that conventional var, which is not measured
   here. Fix it anyway: same one-line mistake, same expression.
   *(An earlier draft called it a confirmed second carrier and argued a `:95`-only fix would leave
   it live — backwards, and retracted. Narrative in the report; the tell is in the report too.)*

   **THE SAME DEFECT IS IN A SECOND ROUTE** — found only when the two-file grep behind that
   retraction was widened repo-wide.
   `app/api/settings/element-content/route.ts`, byte-for-byte:

   ```
   :42  const resolved = resolve(filePath)
   :48  realResolved = await realpath(resolved)      // containment-checked
   :52  if (!realResolved.startsWith(PLUGINS_BASE + '/')) 403
   :73  const pluginRoot = dirname(resolved)          // <- PRE-realpath, unchecked
   :78  mcpJsonContent.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
   :88  execFileSync('uv', ['run', scriptPath, tmpMcpJson, safeName, '--json'],
                     { env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } })
   ```

   Same `mcp_discovery.py`, same temp-JSON hand-off, same `Popen`. So the remedy is **two sites,
   not one** — and a fix to `mcp-discover` alone would read as complete while leaving an
   identical hole one route over.

   **The third candidate is NOT a hit — audited and ruled out.** `scripts/mcp-discover.sh` does
   carry the same shape (`:155 PLUGIN_ROOT="$(dirname "$CONFIG_PATH")"` → `:157` a `sed`
   substitution → `:167 CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" uv run "$DISCOVER_SCRIPT"`), but it
   has **no containment check to bypass**: `CONFIG_PATH` is a positional argument the operator
   types, and `PLUGINS_CACHE` (`:39`) is used only to resolve a plugin NAME to a config path
   (`:89`), never to constrain a path passed explicitly. Different trust model — a local CLI
   doing what its caller asked is not the two ROUTES, which accept a path from an authenticated
   HTTP caller AND implement the very check this defect walks around. **Remedy stays at two
   sites**; recorded as a negative rather than dropped, because a candidate silently removed from
   a list reads identically to one nobody checked.
   Secondary, non-finding: `:157`'s `sed "s|…|$PLUGIN_ROOT|g"` breaks (or injects into the sed
   expression) on a path containing `|`. Operator-supplied, so robustness rather than security.

   **Scope of the remedy, stated precisely because I twice overstated it:** using `realResolved`
   at both sites closes the **`${CLAUDE_PLUGIN_ROOT}` SUBSTITUTION route**. It is NOT established
   that it closes every route through the temp JSON — the other attacker-influenced fields of
   that file were never enumerated, and at least one shape is visible without enumerating them:
   `config_dir` is the TEMP DIR, so `_resolve_command_value` absolutises a relative
   `command: "./x"` against `<tmpdir>`, which is same-uid writable. Not claimed as exploitable;
   named so nobody reads "closes the route" as "closes the file".

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
