---
name: tldr-code
description: >
  Token-efficient code analysis (READ, via `tldr`) AND AST-scoped editing
  (WRITE, via `fastedit` — edit/insert/rename/move/delete/refactor a symbol
  without repeating old code) for 18 languages ( Python, TypeScript, JavaScript,
  Go, Rust, Java, C, C++, Ruby, Kotlin, Swift, C#, Scala, PHP, Lua, Luau,
  Elixir, OCaml). Reach for it BEFORE reading whole files or editing unfamiliar
  code: it extracts ONLY the lines that define a symbol, that it calls, or that
  call it — plus call graphs, reverse-impact, program slices, taint/security
  flows, complexity metrics, dead code, design patterns, and BM25 +
  natural-language semantic search. Invoke it INTENTIONALLY (you choose what to
  query) — it is dramatically cheaper than dumping source into context. Use when
  you need to understand, navigate, locate, or assess impact in a codebase:
  "where is X defined / who calls X / what breaks if I change X / show me only
  the code that affects line N / is this input tainted / what's the structure of
  this module / find dead code / find the function that does Y".
---

# tldr — surgical, token-efficient code analysis

`tldr` (repo: parcadei/tldr-code, Rust, AGPL-3.0) parses code with tree-sitter
into a knowledge graph and answers **structural** questions as compact JSON/text.
It is the single best tool for **exploring a codebase and extracting the exact
slice of code that matters** — instead of reading entire files into context.

**The core idea — intentional & surgical.** Do NOT dump a whole file to "see how
it works." Ask `tldr` the precise question and it returns ONLY the relevant
lines: the symbol's definition, the lines it depends on, the lines that depend on
it, the callers, the slice. You decide the query; `tldr` returns the signal.

> `tldr` is invoked **deliberately by you**. It is NOT a passive interceptor.
> The generic output-compression layer is **distill** (`cmd | distill "<prompt>"`),
> which wraps command OUTPUT indiscriminately. `tldr` is the opposite: a precise
> instrument you reach for on purpose. The two coexist — `distill` makes a call's
> output cheaper; `tldr` makes you ask a better question in the first place.

## When to reach for tldr (instead of Read/Grep)

| You want to… | Don't | Do |
|---|---|---|
| Understand a module | Read the whole file | `tldr structure <path>` |
| Find where X is defined | Grep + read | `tldr definition X <path>` |
| See every caller of X | Grep the name | `tldr references X <path>` / `tldr impact X <path>` |
| Know what breaks if you change X | Guess | `tldr whatbreaks X <path>` |
| Get only the code that affects line N | Read the file | `tldr slice <file> <fn> <N>` |
| Understand one function fully | Read around it | `tldr explain <fn> <path>` |
| Trace how data reaches a sink | Read everything | `tldr taint <path>` / `tldr vuln <path>` |
| Find the function that does Y | Grep keywords | `tldr semantic 'Y' <path>` |
| Assess a codebase's health | Skim files | `tldr health <path>` |
| Find dead code before deleting | Manual audit | `tldr dead <path>` |

**Default to `tldr` first when navigating or assessing code you don't already
have open.** Read the actual file only once `tldr` has pinned the exact lines.

## Killer intentional recipes

```bash
# BEFORE EDITING a symbol — get its definition, its callers, and blast radius:
tldr definition parse_config src/         # where is it
tldr impact parse_config src/             # who calls it (reverse call graph)
tldr whatbreaks parse_config src/         # what breaks if its behavior changes
tldr explain parse_config src/            # signature + purity + complexity + callers/callees

# EXTRACT ONLY the lines that affect a specific line (backward program slice):
tldr slice src/auth.py authenticate 142   # only the statements that influence L142
tldr chop src/auth.py authenticate 142    # intersection of forward+backward slice

# UNDERSTAND a subsystem without reading it:
tldr structure src/payments/              # functions, classes, imports per file
tldr context handle_request --project .   # LLM-ready context graph from an entry point
tldr calls src/                           # cross-file call graph

# FIND code by meaning (semantic feature — installed):
tldr semantic 'where do we validate the JWT signature' src/
tldr search 'retry.*backoff' src/         # BM25 + structure + call-graph context cards

# SECURITY / CORRECTNESS sweeps:
tldr taint src/                           # injection/XSS taint flows
tldr vuln src/                            # SQLi, XSS, command injection
tldr secure src/                          # security dashboard (taint+resources+bounds+contracts)
tldr resources src/                       # leaks, double-close, use-after-close
tldr api-check src/                       # missing timeouts, bare except, weak crypto, unclosed files

# QUALITY / REFACTOR triage:
tldr health src/                          # one-shot health dashboard
tldr smells src/ ; tldr complexity src/ ; tldr hotspots src/   # churn × complexity
tldr dead src/ ; tldr clones src/ ; tldr todo src/             # cleanup targets
```

## Full command catalog (65 commands; `[aliases]` shown)

Per-command flags & detail: run `tldr <cmd> --help`, or read `references/`.

**AST / structure (L1)**
- `tree` `[t]` — file tree structure
- `structure` `[s]` — functions, classes, imports per file
- `extract` `[e]` — complete module info for one file
- `imports` — parse import statements from a file
- `importers` — files that import a given module

**Call graph (L2)**
- `calls` `[c]` — cross-file call graph
- `impact` `[i]` — reverse call graph: who calls this function
- `dead` `[d]` — dead / unreachable code
- `hubs` — hub functions via centrality analysis
- `whatbreaks` `[wb]` — what breaks if a target changes
- `references` `[refs]` — all references to a symbol
- `deps` `[dep]` — module dependency analysis (import-level)

**Data flow (L3–L4)**
- `reaching-defs` `[rd]` — reaching definitions for a function
- `available` `[av]` — available expressions (CSE detection)
- `dead-stores` `[ds]` — dead stores (SSA-based)

**Program dependence / slicing (L5)**
- `slice` — backward program slice (only the lines affecting a target line)
- `chop` `[chp]` — chop slice (forward ∩ backward)
- `taint` `[ta]` — taint flow analysis (also a security command)

**Security**
- `secure` `[sec]` — security dashboard (taint, resources, bounds, contracts, behavioral, mutability)
- `vuln` — vulnerability scan (SQL injection, XSS, command injection)
- `api-check` `[ac]` — API misuse (missing timeouts, bare except, weak crypto, unclosed files)
- `resources` `[res]` — resource lifecycle (leaks, double-close, use-after-close)

**Quality & metrics**
- `smells` — code smells
- `complexity` — cyclomatic complexity per function
- `cognitive` `[cog]` — cognitive complexity (SonarQube algorithm)
- `halstead` `[hal]` — Halstead metrics per function
- `loc` — lines of code (code/comments/blanks)
- `churn` — git-based code churn
- `debt` — technical debt (SQALE)
- `health` `[h]` — comprehensive health dashboard
- `hotspots` `[hot]` — churn × complexity hotspots
- `clones` `[cl]` — code clone detection
- `cohesion` `[coh]` — class cohesion (LCOM4)
- `coupling` `[coup]` — afferent/efferent coupling + instability (call-edge based; use `deps`/`imports` for import-level)
- `coverage` `[cov]` — parse coverage reports (Cobertura XML, LCOV, coverage.py JSON)

**Patterns & architecture**
- `patterns` `[p]` — design pattern & convention detection
- `inheritance` `[inh]` — class inheritance hierarchies
- `surface` `[surf]` — machine-readable API surface of a library/package

**Contracts & verification**
- `contracts` `[con]` — infer pre/postconditions from guards/assertions/isinstance
- `specs` `[sp]` — extract behavioral specs from pytest test files
- `invariants` `[inv]` — infer invariants from test traces (Daikon-lite)
- `verify` `[ver]` — aggregated verification dashboard
- `interface` `[iface]` — interface contracts (public API signatures)
- `temporal` `[tem]` — mine temporal constraints (method call sequences)

**Search & context**
- `search` — enriched BM25 search with function-level context cards
- `semantic` `[sem]` * — natural-language code search
- `similar` `[sim]` * — find similar code fragments
- `dice` — similarity between two code fragments
- `context` — LLM-ready context from an entry point
- `definition` `[def]` — go-to-definition: where a symbol is defined
- `explain` `[exp]` — full function analysis (signature, purity, complexity, callers, callees)

**Aggregated / change**
- `todo` — aggregate improvement suggestions (dead code, complexity, cohesion, similar)
- `diff` `[df]` — AST-aware structural diff between two files
- `fix` `[fx]` — diagnose & auto-fix errors from compiler/runtime output
- `bugbot` — automated bug detection on code changes
- `change-impact` `[ci]` — find tests affected by code changes

**Diagnostics**
- `diagnostics` `[diag]` — type checking + linting
- `doctor` `[doc]` — check / install diagnostic tools (`tldr doctor --install python`)

**Daemon / cache / stats**
- `daemon` — daemon management (`start`, `stop`, `status`)
- `cache` — cache management (`stats`, `clear`)
- `warm` `[w]` — pre-warm the call-graph cache for fast repeats
- `stats` — tldr usage statistics
- `embed` `[emb]` * — generate embeddings for code chunks

\* `semantic`, `similar`, `embed` require the `semantic` build feature (installed
here). First semantic run downloads the arctic-embed-m model (~110 MB, cached).

## Global flags & output formats

```
--format json      # default — structured, machine-readable
--format text      # human-readable (best for quick reading)
--format compact   # minified JSON for piping
--format sarif      # GitHub / VS Code integration
--format dot       # Graphviz visualization (call graphs, inheritance)
```

JSON is the default and is the most token-efficient for downstream parsing; use
`--format text` when you just want to read the answer.

## Daemon mode (fast repeated queries)

For more than a couple of queries on the same tree, run the in-memory daemon —
subsequent commands become cache hits:

```bash
tldr daemon start
tldr warm src/          # pre-warm the call-graph cache
tldr impact foo src/    # fast — served from the daemon
tldr cache stats
tldr daemon stop
```

The daemon replaces the old file-cache model (`.claude/cache/tldr/*.json`); state
is in memory, queried automatically by the CLI when the daemon is running.

## Editing code with fastedit (the WRITE companion)

`tldr` is READ-ONLY. To CHANGE code, use **`fastedit`** — an AST-aware editor (it
uses `tldr-code` internally, so tldr must be installed first). It finds the target
by SYMBOL NAME via tree-sitter, so you write ONLY the change (plus a line or two of
context) — never the old code repeated back. ~74% of edits resolve
deterministically (0 tokens, <1 ms); a local 1.7B model merges the rest (~40 tok).
Same discipline as tldr: invoke it INTENTIONALLY, by symbol.

Three edit modes: `--after <symbol>` = text insert after it (0 tok, instant) ·
`--replace <symbol>` deterministic = context anchors splice new lines (0 tok) ·
`--replace <symbol>` model = the 1.7B SLM merges your snippet into the ~35-line body.

| Need | Command |
|---|---|
| File's symbols + line ranges | `fastedit read <file>` |
| Replace a function/class body | `fastedit edit <file> --replace <symbol> --snippet '<body; #... keeps untouched lines>'` |
| Insert code after a symbol | `fastedit edit <file> --after <symbol> --snippet '<code>'` |
| Many edits to one file | `fastedit batch-edit <file> --edits '[{"after":"x","snippet":"…"}]'` |
| Delete a symbol (caller-safe) | `fastedit delete <file> <symbol>` (refuses if cross-file callers; `--force`) |
| Move a symbol within a file | `fastedit move <file> <symbol> --after <other>` |
| Rename in one file (AST-verified) | `fastedit rename <file> <old> <new>` (`--dry-run`; skips strings/comments) |
| Rename across a tree | `fastedit rename-all <dir> <old> <new>` (`--dry-run`, `--only function`) |
| Move a symbol to another file (+rewrite importers) | `fastedit move-to-file <symbol> <src> <dst>` (`--dry-run`) |
| Verify / revert last edit | `fastedit diff <file>` · `fastedit undo <file>` |
| Diagnose setup | `fastedit doctor` |

Intentional read → check → edit loop:
```bash
fastedit read src/app.py                    # learn exact symbol names first
tldr impact handle_request src/             # blast radius before changing it
fastedit edit src/app.py --replace handle_request --snippet '
    validate(data)
    #...                                     # #... preserves the rest of the body
    logger.info("done")
'
fastedit diff src/app.py                     # confirm  ·  fastedit undo <file> to revert
```
`--replace` auto-preserves the signature; `#...` means "keep the untouched lines".
Prefer `fastedit rename`/`rename-all` over manual find-replace (AST-verified, skips
strings/comments). 13 languages (Python, JS, TS, Rust, Go, Java, C, C++, Ruby,
Swift, Kotlin, C#, PHP). Backend: local MLX (Apple Silicon) / vLLM (GPU), or any
OpenAI-compatible server via `FASTEDIT_BACKEND=llm` + `FASTEDIT_LLM_API_BASE=<url>`.
An optional MCP server (`fastedit-mcp`, 12 tools) + an Edit→fast_edit hook
(`fastedit-hook`) exist but are NOT enabled here: intentional-CLI use keeps the
per-turn token cost at zero, whereas a hook that fires on every tool call injects
text into the transcript and re-bills the cached prefix.

## Coexistence with distill

- **distill** is a generic, non-discriminating output-compression pipe. `tldr` is
  a deliberate instrument — it does not duplicate or replace distill, and it is
  not a Read-interceptor.
- An MCP server (`tldr-mcp`) is available for tool-style access — see
  `references/mcp-integration.md`.

## Per-command reference

`references/` holds the verbatim upstream docs — read the one for the category
you need:

- `references/command-overview.md` — the full README catalog
- `references/ast.md`, `callgraph.md`, `dataflow.md`, `metrics.md`,
  `patterns.md`, `quality.md`, `search.md`, `security.md`, `tools.md`,
  `daemon.md` — per-category command detail
- `references/mcp-integration.md` — using the `tldr-mcp` server

When the exact arguments of a command matter, prefer `tldr <cmd> --help` (ground
truth) over memory.
