# tldr-code

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
> The generic output-compression / read-interception layer is **lean-ctx** and
> **distill** (they wrap every tool call indiscriminately). `tldr` is the
> opposite: a precise instrument you reach for on purpose. The three coexist —
> lean-ctx/distill make every call cheaper; `tldr` makes you ask better
> questions. (If a shell call to `tldr` is ever blocked by lean-ctx's allowlist,
> run `lean-ctx allow tldr` once.)

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
(`fastedit-hook`) exist but are NOT enabled here — intentional-CLI use keeps
per-turn token cost at zero, and the Edit-redirect hook must not run alongside
lean-ctx.

## Coexistence with lean-ctx & distill

- **lean-ctx** and **distill** are generic, non-discriminating interceptors
  (they wrap/compress every tool call). `tldr` is a deliberate instrument — it
  does not duplicate or replace them, and it is not a Read-interceptor.
- `tldr` binaries (`tldr`, `tldr-daemon`, `tldr-mcp`, `fastedit`) are in
  lean-ctx's shell allowlist. If a future binary/alias is blocked: `lean-ctx allow <name>`.
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

---

## Reference: ast

# AST Analysis Commands (Layer 1)

Layer 1 commands extract structure from source code using tree-sitter AST parsing.

## tree

**Alias:** `t`

**Purpose:** Show file tree structure of a directory.

**Implementation:** `crates/tldr-cli/src/commands/tree.rs`

```rust
// Key code path (tree.rs:36-90)
pub fn run(&self, format: OutputFormat, quiet: bool) -> Result<()> {
    let tree = get_file_tree(
        &self.path,
        extensions.as_ref(),
        !self.include_hidden,
        Some(&IgnoreSpec::default()),
    )?;
    // Output as JSON or formatted text
}
```

**How it works:**
1. Traverses directory with `WalkDir`
2. Respects `.gitignore` and `.tldrignore`
3. Filters by extension if `--ext` specified
4. Returns hierarchical `FileTree` structure

**Example:**
```bash
# Basic tree
tldr tree src/

# Python files only
tldr tree src/ -e .py

# Include hidden files
tldr tree src/ -H
```

**Output (text format):**
```
src/
├── main.py
├── utils/
│   ├── __init__.py
│   └── helpers.py
└── tests/
    └── test_main.py
```

---

## structure

**Alias:** `s`

**Purpose:** Extract code structure — functions, classes, imports.

**Implementation:** `crates/tldr-cli/src/commands/structure.rs`

```rust
// Key code path
pub fn run(&self, format: OutputFormat, quiet: bool) -> Result<()> {
    let structure = get_code_structure(
        &self.path,
        self.language,
        self.max_results,
    )?;
}
```

**How it works:**
1. Walks directory finding files matching language extensions
2. Parses each file with tree-sitter
3. Extracts `ModuleInfo`: functions, classes, imports, constants
4. Returns per-file structure with caller/callee relationships

**Example:**
```bash
# Get structure
tldr structure src/

# Limit results
tldr structure src/ -m 50

# Text format for readability
tldr structure src/ -f text
```

**Output structure:**
```json
{
  "files": [
    {
      "path": "src/main.py",
      "functions": [
        {
          "name": "process_data",
          "params": ["input: str"],
          "line": 10,
          "is_async": false
        }
      ],
      "classes": [...],
      "imports": [...]
    }
  ]
}
```

---

## extract

**Alias:** `e`

**Purpose:** Extract complete module info from a single file.

**Implementation:** `crates/tldr-core/src/ast/extract.rs`

```rust
// Core extraction (tldr-core)
pub fn extract_file(path: &Path, base_path: Option<&Path>) -> TldrResult<ModuleInfo> {
    let tree = parser.parse_file(path)?;
    extract_from_tree(&tree, source, lang, path, base_path)
}
```

**How it works:**
1. Parses single file with tree-sitter
2. Extracts full `ModuleInfo` including docstrings
3. Resolves intra-file call graph
4. Returns detailed metadata per function/class

**Example:**
```bash
# Extract single file
tldr extract src/main.py

# Text output
tldr extract src/main.py -f text
```

---

## imports

**Purpose:** Parse import statements from a file.

**Implementation:** `crates/tldr-core/src/ast/imports.rs`

```rust
// Import parsing
pub fn get_imports(tree: &Tree, source: &str, language: Language) -> TldrResult<Vec<ImportInfo>>
```

**How it works:**
1. Parses file and extracts `import`/`from ... import` statements
2. Categorizes as standard library, third-party, or local
3. Returns source location for each import

**Example:**
```bash
tldr imports src/main.py
```

**Output:**
```json
{
  "imports": [
    {
      "module": "os",
      "names": ["path"],
      "line": 1,
      "is_from": true,
      "level": 0
    },
    {
      "module": "mymodule",
      "names": ["MyClass"],
      "line": 5,
      "is_from": true,
      "level": 1
    }
  ]
}
```

---

## importers

**Purpose:** Find files that import a given module.

**Implementation:** Uses call graph analysis to find importers.

**How it works:**
1. Scans all files for imports matching target module
2. Returns list of importing files

**Example:**
```bash
tldr importers os src/
tldr importers mymodule src/
```

---

## definition

**Alias:** `def`

**Purpose:** Go-to-definition — find where a symbol is defined.

**Implementation:** Uses AST analysis to resolve symbol definitions.

**How it works:**
1. Accepts file+line+column or --symbol flag
2. Traverses AST to find matching definition
3. Cross-file resolution via import graph

**Example:**
```bash
# By position
tldr definition src/main.py 10 5

# By symbol name
tldr definition --symbol process_data --file src/main.py
```

---

## references

**Alias:** `refs`

**Purpose:** Find all references to a symbol.

**How it works:**
1. Builds cross-file reference map
2. Searches for identifier matches
3. Filters by reference kind (call, read, write, type)

**Example:**
```bash
tldr references process_data src/

# Filter by kind
tldr references process_data src/ -t call,write
```

---

## Reference: callgraph

# Call Graph Commands (Layer 2)

Layer 2 commands analyze relationships between functions across files.

## calls

**Alias:** `c`

**Purpose:** Build cross-file call graph.

**Implementation:** `crates/tldr-cli/src/commands/calls.rs`

```rust
// From calls.rs
pub fn run(&self, format: OutputFormat, quiet: bool) -> Result<()> {
    let graph = build_project_call_graph(
        &self.path,
        self.language,
        None,
        self.respect_ignore,
    )?;
}
```

**How it works:**
1. Walks directory finding all source files
2. Parses each file with tree-sitter
3. Extracts function definitions
4. Resolves import statements to file paths
5. Builds edges: caller → callee relationships

**Example:**
```bash
# Build call graph
tldr calls src/

# Respect .gitignore
tldr calls src/ --respect-ignore

# Limit edges
tldr calls src/ --max-items 100
```

**Output structure:**
```json
{
  "edges": [
    {
      "src_file": "src/main.py",
      "src_func": "main",
      "dst_file": "src/utils.py",
      "dst_func": "process",
      "call_type": "Direct"
    }
  ],
  "functions": {
    "src/main.py::main": {
      "line": 5,
      "is_public": true
    }
  }
}
```

---

## impact

**Alias:** `i`

**Purpose:** Analyze impact of changing a function — who calls it?

**Implementation:** `crates/tldr-cli/src/commands/impact.rs`

```rust
// From impact.rs
pub fn run(&self, format: OutputFormat, quiet: bool) -> Result<()> {
    let report = impact_analysis_with_ast_fallback(
        &self.path,
        &self.function,
        self.file.as_deref(),
        self.language,
        self.depth,
    )?;
}
```

**How it works:**
1. Takes function name + optional file filter
2. Builds reverse call graph (who → target)
3. Traverses up to `--depth` levels
4. Returns all functions that transitively call target

**Example:**
```bash
# Who calls parse_config?
tldr impact parse_config src/

# With depth limit
tldr impact parse_config src/ -d 3

# Type-aware resolution
tldr impact process_data src/ --type-aware
```

---

## dead

**Alias:** `d`

**Purpose:** Find dead (unreachable) code.

**Implementation:** `crates/tldr-cli/src/commands/dead.rs`

```rust
// Two analysis modes (dead.rs:111-145)
if self.call_graph {
    // Mode 1: Call graph based (slower, more accurate)
    dead_code_analysis(&graph, &all_functions, entry_points)
} else {
    // Mode 2: Reference counting (faster, single-pass)
    dead_code_analysis_refcount(&all_functions, &merged_ref_counts, entry_points)
}
```

**How it works:**

1. **Reference counting mode (default):**
   - Counts identifier occurrences per file
   - Functions with count=1 (only self-reference) are dead
   - Fast: single pass through AST

2. **Call graph mode:**
   - Builds full call graph
   - Marks entry points (main, public API)
   - Traverses call graph to find unreachable
   - More accurate but slower

**Example:**
```bash
# Default (reference counting)
tldr dead src/

# Call graph mode
tldr dead src/ --call-graph

# With custom entry points
tldr dead src/ -e main,api_v1,WebHandler
```

**Output:**
```json
{
  "total_functions": 150,
  "total_dead": 12,
  "dead_percentage": 8.0,
  "by_file": {
    "src/utils.py": ["unused_helper", "old_format"]
  }
}
```

---

## hubs

**Purpose:** Detect hub functions using centrality analysis.

**Implementation:** `crates/tldr-cli/src/commands/hubs.rs`

**How it works:**
1. Builds call graph from all files
2. Computes centrality metrics:
   - **In-degree**: Many functions call this
   - **Out-degree**: This calls many functions
   - **PageRank**: Important in call graph
   - **Betweenness**: Bridge between modules
3. Returns top N hub functions

**Example:**
```bash
tldr hubs src/

# Algorithm selection
tldr hubs src/ --algorithm pagerank

# Top 20
tldr hubs src/ --top 20
```

---

## whatbreaks

**Alias:** `wb`

**Purpose:** Analyze what breaks if a target is changed.

**Implementation:** `crates/tldr-cli/src/commands/whatbreaks.rs`

**How it works:**
1. Accepts target (function, file, or module)
2. Auto-detects target type
3. Runs appropriate analysis:
   - Function → impact analysis
   - File → importers + change-impact
   - Module → importers

**Example:**
```bash
tldr whatbreaks src/utils.py

# Force function type
tldr whatbreaks process_data -t function src/
```

---

## references

**Alias:** `refs`

**Purpose:** Find all references to a symbol.

**How it works:**
1. Builds cross-file reference index
2. Searches for identifier occurrences
3. Filters by reference kind

**Example:**
```bash
tldr references my_function src/ -t call,read
```

---

## Reference: command-overview

# tldr

Token-efficient code analysis for LLMs. 40+ commands across AST, call graph, data flow, security, and quality — output optimized for machine consumption.

## Why

LLMs waste context on raw source dumps. tldr extracts the signal: function signatures, call graphs, taint flows, complexity metrics, dead code — as structured JSON that fits in a fraction of the tokens.

**18 languages**: Python, TypeScript, JavaScript, Go, Rust, Java, C, C++, Ruby, Kotlin, Swift, C#, Scala, PHP, Lua, Luau, Elixir, OCaml.

## Installation

### Standard install (recommended)

```bash
cargo install tldr-cli
```

This gives you 60+ analysis commands — everything except natural-language semantic search.

### With semantic search

```bash
cargo install tldr-cli --features semantic
```

Adds three commands:

- `tldr semantic '<query>' <path>` — natural-language code search
- `tldr embed <path>` — build embedding index
- `tldr similar <file>` — find similar fragments

This pulls in `fastembed` + ONNX Runtime. On first run it downloads the arctic-embed-m model (~110MB, cached). Builds reliably on Mac. Other platforms are unverified — if it doesn't compile for you, a PR with the fix is very welcome.

## Quick start

```bash
# What's in this codebase?
tldr structure src/

# Who calls this function?
tldr impact parse_config src/

# Find dead code
tldr dead src/

# Security scan
tldr secure src/

# Full health dashboard
tldr health src/
```

## Commands

### AST Analysis (L1)
| Command | Description |
|---------|-------------|
| `tree` | File tree structure |
| `structure` | Code structure — functions, classes, imports |
| `extract` | Complete module info |
| `imports` | Parse import statements |
| `importers` | Find files importing a module |

### Call Graph (L2)
| Command | Description |
|---------|-------------|
| `calls` | Cross-file call graph |
| `impact` | Reverse call graph — who calls this? |
| `dead` | Dead code detection |
| `hubs` | Hub functions (centrality analysis) |
| `whatbreaks` | What breaks if target changes? |

### Data Flow (L3-L4)
| Command | Description |
|---------|-------------|
| `reaching-defs` | Reaching definitions |
| `available` | Available expressions (CSE detection) |
| `dead-stores` | Dead store detection (SSA-based) |

### Program Dependence (L5)
| Command | Description |
|---------|-------------|
| `slice` | Backward program slice |
| `chop` | Chop slice (forward + backward intersection) |
| `taint` | Taint flow analysis |

### Security
| Command | Description |
|---------|-------------|
| `secure` | Security dashboard |
| `taint` | Taint flows (injection, XSS) |
| `vuln` | Vulnerability scanning |
| `api-check` | API misuse patterns |
| `resources` | Resource leak detection |

### Quality & Metrics
| Command | Description |
|---------|-------------|
| `smells` | Code smells |
| `complexity` | Cyclomatic complexity |
| `cognitive` | Cognitive complexity |
| `halstead` | Halstead metrics |
| `loc` | Lines of code |
| `churn` | Git churn analysis |
| `debt` | Technical debt (SQALE) |
| `health` | Health dashboard |
| `hotspots` | Churn x complexity |
| `clones` | Code clone detection |
| `cohesion` | LCOM4 cohesion |
| `coupling` | Afferent/efferent coupling |

### Patterns & Architecture
| Command | Description |
|---------|-------------|
| `patterns` | Design pattern detection |
| `inheritance` | Class hierarchies |
| `surface` | API surface extraction |

### Contracts & Verification
| Command | Description |
|---------|-------------|
| `contracts` | Pre/postcondition inference |
| `specs` | Extract test specs |
| `invariants` | Infer invariants from tests |
| `verify` | Verification dashboard |
| `interface` | Interface contracts |

### Search & Context
| Command | Description |
|---------|-------------|
| `search` | BM25 search with structural context |
| `semantic` | Natural language code search * |
| `similar` | Find similar code fragments * |
| `context` | LLM-ready context from entry point |
| `definition` | Go-to-definition |
| `explain` | Comprehensive function analysis |

\* Requires the `semantic` feature: `cargo install tldr-cli --features semantic`

### Aggregated
| Command | Description |
|---------|-------------|
| `todo` | Improvement suggestions |
| `diff` | AST-aware structural diff |
| `fix` | Diagnose and auto-fix errors |
| `bugbot` | Automated bug detection on changes |

## Output formats

```bash
--format json      # Default — structured, machine-readable
--format text      # Human-readable
--format compact   # Minified JSON for piping
--format sarif     # GitHub/VS Code integration
--format dot       # Graphviz visualization
```

## Daemon mode

For repeated queries, the daemon caches results in memory:

```bash
tldr daemon start
tldr warm src/          # Pre-warm cache
tldr calls src/         # Fast — cache hit
tldr daemon stop
```

## Documentation

For detailed documentation, see the [docs/](docs/) folder:
- [Installation Guide](docs/INSTALL.md)
- [Setup Guide](docs/SETUP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [MCP Integration](docs/MCP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Command Reference](docs/commands/)

## License

AGPL-3.0

---

## Reference: daemon

# Daemon Commands

Daemon commands manage the persistent cache daemon for faster repeated queries.

## daemon

**Purpose:** Daemon management commands.

**Implementation:** `crates/tldr-cli/src/commands/daemon/`

**Subcommands:**

### daemon start

Start the TLDR daemon for caching.

```bash
tldr daemon start

# With custom project
tldr daemon start --project /path/to/project

# TCP mode (Windows)
tldr daemon start --tcp --port 7890

# Custom idle timeout (seconds)
tldr daemon start --idle-timeout 600
```

**How it works:**
1. Creates Unix socket at `~/.cache/tldr/<project_hash>.sock`
2. Starts HTTP server on socket
3. Background process caches analysis results

### daemon stop

Stop the running daemon.

```bash
tldr daemon stop
```

### daemon status

Check if daemon is running.

```bash
tldr daemon status
```

### daemon query

Send raw query to daemon.

```bash
tldr daemon query '{"cmd":"stats"}'
```

### daemon notify

Notify daemon of file changes (invalidates cache).

```bash
tldr daemon notify src/main.py
tldr daemon notify src/
```

---

## cache

**Purpose:** Cache management commands.

### cache stats

Show cache statistics.

```bash
tldr cache stats
```

### cache clear

Clear all cache files.

```bash
tldr cache clear
```

---

## warm

**Alias:** `w`

**Purpose:** Pre-warm call graph cache for faster subsequent queries.

**Implementation:** `crates/tldr-cli/src/commands/daemon/warm.rs`

```bash
tldr warm src/

# Background warming
tldr warm src/ -b
```

**How it works:**
1. Builds call graph in background
2. Caches results in daemon memory
3. Subsequent queries hit cache (~35x faster)

---

## stats

**Purpose:** Show TLDR usage statistics.

```bash
tldr stats
```

Shows:
- Total queries run
- Cache hit rate
- Average query time
- Most used commands

---

## Reference: dataflow

# Data Flow Commands (Layers 3-5)

Data flow commands track how values move through code.

## reaching-defs

**Alias:** `rd`

**Purpose:** Analyze reaching definitions for a function.

**Implementation:** `crates/tldr-cli/src/commands/reaching_defs.rs`

```rust
// Reaching definitions analysis
pub struct ReachingDefsArgs {
    pub file: PathBuf,
    pub function: String,
    pub var: Option<String>,
    pub line: Option<u32>,
    pub show_chains: bool,
    pub show_uninitialized: bool,
    pub show_in_out: bool,
}
```

**How it works:**
1. Builds CFG for function
2. Computes IN/OUT sets per block using dataflow framework
3. Tracks where each variable definition reaches

**Example:**
```bash
tldr reaching-defs src/process.py process_data

# Filter by variable
tldr reaching-defs src/process.py process_data --var user_input

# Show at specific line
tldr reaching-defs src/process.py process_data --line 25

# Show def-use chains
tldr reaching-defs src/process.py process_data --show-chains
```

**Output:**
```json
{
  "function": "process_data",
  "blocks": [...],
  "def_use_chains": [
    {
      "variable": "result",
      "definition": {"line": 10, "block": 1},
      "uses": [{"line": 15}, {"line": 20}]
    }
  ]
}
```

---

## available

**Alias:** `av`

**Purpose:** Analyze available expressions for CSE (Common Subexpression Elimination).

**Implementation:** `crates/tldr-cli/src/commands/available.rs`

**How it works:**
1. Builds CFG for function
2. Computes available expressions per block
3. An expression is "available" if all paths to a point have computed it
4. Identifies CSE opportunities

**Example:**
```bash
tldr available src/process.py process_data

# Check specific expression
tldr available src/process.py process_data --check "a + b"

# At specific line
tldr available src/process.py process_data --at-line 50

# Show what kills an expression
tldr available src/process.py process_data --killed-by "x + y"
```

---

## dead-stores

**Alias:** `ds`

**Purpose:** Find dead stores using SSA-based analysis.

**Implementation:** `crates/tldr-cli/src/commands/contracts/dead_stores.rs`

**How it works:**
1. Converts function to SSA form
2. Identifies assignments that are never read
3. Returns lines where value is stored but never used

**Example:**
```bash
tldr dead-stores src/process.py process_data

# Compare with live-variables approach
tldr dead-stores src/process.py process_data --compare
```

---

## slice

**Purpose:** Compute program slice (backward or forward).

**Implementation:** `crates/tldr-cli/src/commands/slice.rs`

```rust
// Program slicing
pub struct SliceArgs {
    pub file: PathBuf,
    pub function: String,
    pub line: u32,
    pub direction: Direction,  // backward or forward
    pub variable: Option<String>,
}
```

**How it works:**
1. Builds PDG (Program Dependence Graph)
2. **Backward slice**: All statements affecting this line
3. **Forward slice**: All statements affected by this line
4. Optionally filter by variable

**Example:**
```bash
tldr slice src/process.py process_data 25

# Forward slice
tldr slice src/process.py process_data 25 -d forward

# Filter by variable
tldr slice src/process.py process_data 25 --variable result
```

---

## chop

**Alias:** `chp`

**Purpose:** Compute chop slice — intersection of forward and backward slices.

**How it works:**
1. Computes backward slice from source
2. Computes forward slice from target
3. Returns intersection: statements that affect target AND are affected by source

**Example:**
```bash
# Statements from line 10 that affect line 50
tldr chop src/process.py process_data 10 50
```

---

## Reference: mcp-integration

# MCP Server Integration

TLDR includes a Model Context Protocol (MCP) server for integration with GitHub Copilot Code and other MCP-compatible clients.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is a standard interface for connecting AI assistants to external tools and data sources. TLDR's MCP server exposes code analysis capabilities to any MCP client.

## Architecture

```
┌─────────────────┐     JSON-RPC 2.0      ┌─────────────────┐
│   GitHub Copilot Code   │ ◄──────────────────► │    tldr-mcp     │
│   (or other    │     stdio transport   │   (MCP server)  │
│   MCP client)   │                       │                 │
└─────────────────┘                       └────────┬────────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │   tldr-core     │
                                           │  (analysis engine)│
                                           └─────────────────┘
```

## Installation

### 1. Build the MCP Server

```bash
cargo build --release -p tldr-mcp
```

The binary will be at: `target/release/tldr-mcp`

### 2. Configure Your MCP Client

#### GitHub Copilot Code

Add to your GitHub Copilot Code MCP configuration:

```json
{
  "mcpServers": {
    "tldr": {
      "command": "/path/to/tldr-mcp",
      "args": ["--project", "/path/to/your/codebase"]
    }
  }
}
```

Or using environment variable in config file:

```json
{
  "mcpServers": {
    "tldr": {
      "command": "tldr-mcp",
      "env": {
        "TLDR_PROJECT_ROOT": "/path/to/your/codebase"
      }
    }
  }
}
```

#### Other MCP Clients

The server uses stdio transport and JSON-RPC 2.0 protocol, making it compatible with any MCP client.

## Available Tools

The MCP server exposes these tool categories:

### AST Analysis (L1)

| Tool | Description | Arguments |
|------|-------------|-----------|
| `tldr_tree` | Show file tree structure | `path?`, `extensions?`, `include_hidden?` |
| `tldr_structure` | Extract code structure | `path?`, `max_results?` |
| `tldr_extract` | Complete module info | `file` |
| `tldr_imports` | Parse imports | `file` |

### Call Graph (L2)

| Tool | Description | Arguments |
|------|-------------|-----------|
| `tldr_calls` | Build call graph | `path?`, `max_items?` |
| `tldr_impact` | Find callers of function | `function`, `path?`, `depth?` |
| `tldr_dead` | Find dead code | `path?` |
| `tldr_refs` | Find symbol references | `symbol`, `path?` |

### Data Flow (L3-L4)

| Tool | Description | Arguments |
|------|-------------|-----------|
| `tldr_reaching_defs` | Reaching definitions | `file`, `function` |
| `tldr_available` | Available expressions | `file`, `function` |
| `tldr_dead_stores` | Dead store detection | `file`, `function` |
| `tldr_slice` | Program slice | `file`, `function`, `line` |

### Search

| Tool | Description | Arguments |
|------|-------------|-----------|
| `tldr_search` | BM25 search | `query`, `path?` |
| `tldr_semantic` | Natural language search | `query`, `path?` |
| `tldr_context` | LLM context from entry | `entry`, `project?` |

### Quality

| Tool | Description | Arguments |
|------|-------------|-----------|
| `tldr_smells` | Code smell detection | `path?` |
| `tldr_complexity` | Cyclomatic complexity | `file`, `function` |
| `tldr_health` | Health dashboard | `path?` |
| `tldr_hotspots` | Churn x complexity | `path?` |

### Security

| Tool | Description | Arguments |
|------|-------------|-----------|
| `tldr_taint` | Taint flow analysis | `file`, `function` |
| `tldr_vuln` | Vulnerability scan | `path?` |
| `tldr_api_check` | API misuse patterns | `path?` |
| `tldr_secure` | Security dashboard | `path?` |

## Tool Definitions

Tool definitions are in [`crates/tldr-mcp/src/tools/`](https://github.com/parcadei/tldr-code/tree/main/crates/tldr-mcp/src/tools):

| File | Category |
|------|----------|
| `ast.rs` | L1 AST analysis |
| `callgraph.rs` | L2 call graph analysis |
| `flow.rs` | L3-L4 data flow analysis |
| `search.rs` | Search commands |
| `quality.rs` | Quality metrics |
| `security.rs` | Security analysis |

## Usage Examples

### GitHub Copilot Code

Once configured, use natural language:

```
What's the call graph for the auth module?
What functions call parse_config?
Find dead code in the utils directory.
Analyze taint flows in the user input handler.
```

### Direct JSON-RPC

The MCP server accepts standard JSON-RPC 2.0 requests:

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | tldr-mcp

# List tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | tldr-mcp

# Call a tool
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tldr_structure","arguments":{"path":"src"}}}' | tldr-mcp
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TLDR_PROJECT_ROOT` | Default project root | Current directory |
| `TLDR_LOG` | Log level (debug, info, warn, error) | `info` |
| `TLDR_CACHE_DIR` | Cache directory | Platform-specific |

### Tool Filtering

You can limit which tools are exposed via MCP config:

```json
{
  "mcpServers": {
    "tldr": {
      "command": "tldr-mcp",
      "env": {
        "TLDR_PROJECT_ROOT": "/path/to/project",
        "TLDR_TOOLS": "ast,callgraph,security"
      }
    }
  }
}
```

## Caching

The MCP server uses a two-level cache:

1. **L1 In-process cache** (memory) — Tool results cached for session
2. **L2 Persistent cache** (disk) — Shared across sessions via daemon

Cache key: `hash(tool_name + arguments + file_mtimes)`

Invalidation: Automatic on file modification (via `tldr daemon notify`)

## Error Handling

Errors are returned as JSON-RPC error responses:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Failed to parse file",
    "data": {
      "file": "src/main.py",
      "error": "Unsupported syntax in Python 3.12"
    }
  }
}
```

Error codes:
- `-32603` — Internal error (parse failed, etc.)
- `-32602` — Invalid arguments
- `-32600` — Invalid request

## Development

### Adding a New Tool

1. Add tool definition in `tools/*.rs`:

```rust
#[derive(Tool)]
pub struct MyTool {
    pub name: String,
    pub description: String,
    pub arguments: Vec<Argument>,
}

impl Tool for MyTool {
    fn execute(&self, args: HashMap<String, serde_json::Value>) -> Result<serde_json::Value> {
        // Call tldr-core function
        // Return JSON result
    }
}
```

2. Register in `tools/mod.rs`

3. Rebuild: `cargo build -p tldr-mcp`

### Testing MCP Server

```bash
# Run tests
cargo test -p tldr-mcp

# Manual test with echo
echo '{"jsonrpc":"2.0","id":0,"method":"initialize"}' | target/debug/tldr-mcp
```

## Troubleshooting

### Server won't start

1. Check binary exists and is executable:
```bash
ls -la target/release/tldr-mcp
./target/release/tldr-mcp --version
```

2. Check logs:
```bash
TLDR_LOG=debug ./target/release/tldr-mcp 2>&1
```

### Tools not appearing

1. Verify JSON-RPC connection:
```bash
echo '{"jsonrpc":"2.0","id":0,"method":"initialize"}' | tldr-mcp
```

2. Check tool registry initialization logs

### Slow tool execution

1. Pre-warm the cache:
```bash
tldr daemon start
tldr warm /path/to/project
```

2. MCP client should then hit L1 cache

## See Also

- [TLDR Architecture](ARCHITECTURE.md) — How the analysis engine works
- [Command Reference](commands/) — Detailed command documentation
- [MCP Protocol Spec](https://modelcontextprotocol.io/spec) — Protocol specification

---

## Reference: metrics

# Metrics Commands

Metrics commands analyze code size, complexity, coverage, and similarity.

## coverage

**Alias:** `cov`

**Purpose:** Parse coverage reports (Cobertura XML, LCOV, coverage.py JSON).

**Implementation:** `crates/tldr-cli/src/commands/coverage.rs`

**Supported formats:**
- `cobertura` — GitLab/Jenkins standard
- `lcov` — llvm-cov, gcov
- `coveragepy` — coverage.py JSON

**Example:**
```bash
tldr coverage coverage.xml

# Per-file breakdown
tldr coverage coverage.xml --by-file

# Uncovered only
tldr coverage coverage.xml --uncovered

# Sort by coverage
tldr coverage coverage.xml --sort asc
```

---

## dice

**Purpose:** Compare similarity between two code fragments using Dice coefficient.

**Implementation:** `crates/tldr-cli/src/commands/dice.rs`

**Dice coefficient:** `(2 * |intersection|) / (|a| + |b|)`

**Example:**
```bash
# Compare two files
tldr dice src/utils.py src/helpers.py

# Compare specific functions
tldr dice src/utils.py::process src/helpers.py::process

# Compare line ranges
tldr dice src/utils.py:10:50 src/helpers.py:20:60

# No normalization
tldr dice src/utils.py src/helpers.py --normalize none
```

---

## similar

**Alias:** `sim`

**Purpose:** Find similar code fragments using embeddings.

**Example:**
```bash
tldr similar src/utils.py

# Specific function
tldr similar src/utils.py -F process_data

# Top 10 results
tldr similar src/utils.py -n 10
```

---

## definition

**Alias:** `def`

**Purpose:** Go-to-definition for symbols.

**Example:**
```bash
tldr definition src/main.py 10 5

# By symbol name
tldr definition --symbol process_data --file src/main.py
```

---

## explain

**Alias:** `exp`

**Purpose:** Comprehensive function analysis.

**Analysis includes:**
- Function signature (name, params, return type)
- Purity (side-effect analysis)
- Complexity metrics
- Callers (functions that call this)
- Callees (functions this calls)

**Example:**
```bash
tldr explain src/process.py process_data

# Deeper call graph
tldr explain src/process.py process_data --depth 5
```

---

## loc

**Purpose:** Count lines of code.

**Breakdown:**
- Code lines (executable)
- Comment lines
- Blank lines

**Example:**
```bash
tldr loc src/

# Per file
tldr loc src/ --by-file

# By directory
tldr loc src/ --by-dir
```

---

## cognitive

**Alias:** `cog`

**Purpose:** Calculate cognitive complexity.

**Example:**
```bash
tldr cognitive src/

# Per function
tldr cognitive src/ --function process_data

# With contributors
tldr cognitive src/ --function process_data --show-contributors
```

---

## halstead

**Alias:** `hal`

**Purpose:** Calculate Halstead metrics.

**Metrics:**
- **n1**: Unique operators
- **n2**: Unique operands
- **N1**: Total operators
- **N2**: Total operands
- **Volume**: N * log2(n)
- **Difficulty**: n1/2 * N2/n2
- **Effort**: Volume * Difficulty

**Example:**
```bash
tldr halstead src/process.py

# Show operators/operands lists
tldr halstead src/process.py --show-operators --show-operands
```

---

## hotspots

**Alias:** `hot`

**Purpose:** Find churn x complexity hotspots.

**Example:**
```bash
tldr hotspots src/

# Function level
tldr hotspots src/ --by-function

# Different time window
tldr hotspots src/ --days 180
```

---

## Reference: patterns

# Patterns Commands

Pattern commands detect design patterns, contracts, and behavioral specifications.

## patterns

**Alias:** `p`

**Purpose:** Detect design patterns and coding conventions.

**Implementation:** `crates/tldr-cli/src/commands/detect_patterns.rs`

**How it works:**
1. Single-pass signal extraction across codebase
2. Aggregates `PatternSignals` for each function/class
3. Detects known design patterns:
   - **Creational**: Singleton, Factory, Builder
   - **Structural**: Adapter, Decorator, Facade
   - **Behavioral**: Observer, Strategy, Command
   - **Architectural**: MVC, Repository, Service
   - **Anti-patterns**: God class, Spaghetti code

**Example:**
```bash
tldr patterns src/

# Category filter
tldr patterns src/ -c behavioral

# Confidence threshold
tldr patterns src/ --min-confidence 0.8
```

---

## inheritance

**Alias:** `inh`

**Purpose:** Extract class inheritance hierarchies.

**Implementation:** `crates/tldr-cli/src/commands/inheritance.rs`

**How it works:**
1. Parses class declarations
2. Resolves base classes (ABC, Protocol, mixins)
3. Builds inheritance graph
4. Detects diamond inheritance patterns

**Example:**
```bash
tldr inheritance src/

# Focus on specific class
tldr inheritance src/ -c DataProcessor

# Limit depth
tldr inheritance src/ -c BaseHandler -d 3
```

---

## contracts

**Alias:** `con`

**Purpose:** Infer pre/postconditions from guard clauses, assertions, isinstance checks.

**Implementation:** `crates/tldr-cli/src/commands/contracts/contracts.rs`

**How it works:**
1. Parses function body
2. Extracts guard clauses (if-raise patterns)
3. Finds isinstance/type checks
4. Builds precondition/postcondition model

**Example:**
```bash
tldr contracts src/process.py process_data

# Limit results
tldr contracts src/process.py process_data --limit 50
```

---

## specs

**Alias:** `sp`

**Purpose:** Extract behavioral specifications from pytest test files.

**Implementation:** `crates/tldr-cli/src/commands/contracts/specs.rs`

**How it works:**
1. Parses pytest test functions
2. Extracts test names, fixtures, assertions
3. Generates formal spec from tests

**Example:**
```bash
tldr specs --from-tests tests/test_process.py

# Filter to specific function
tldr specs --from-tests tests/test_process.py --function process_data
```

---

## invariants

**Alias:** `inv`

**Purpose:** Infer invariants from test execution traces (Daikon-lite).

**Implementation:** `crates/tldr-cli/src/commands/contracts/invariants.rs`

**How it works:**
1. Runs tests to generate execution traces
2. Analyzes variable states at each point
3. Infers patterns (e.g., "x > 0", "len(list) < 100")

**Example:**
```bash
tldr invariants --from-tests tests/ src/process.py

# Specific function
tldr invariants --from-tests tests/ src/process.py --function process_data

# Minimum observations
tldr invariants --from-tests tests/ src/process.py --min-obs 3
```

---

## verify

**Alias:** `ver`

**Purpose:** Aggregated verification dashboard combining multiple analyses.

**Implementation:** `crates/tldr-cli/src/commands/contracts/verify.rs`

**How it works:**
1. Runs contracts analysis
2. Runs invariants analysis
3. Runs patterns analysis
4. Aggregates into verification score

**Example:**
```bash
tldr verify src/

# Quick mode
tldr verify src/ --quick

# Detail specific
tldr verify src/ --detail contracts
```

---

## temporal

**Alias:** `tem`

**Purpose:** Mine temporal constraints (method call sequences).

**Implementation:** `crates/tldr-cli/src/commands/patterns/temporal.rs`

**How it works:**
1. Analyzes method call sequences in classes
2. Mines frequent patterns (2-method, 3-method sequences)
3. Reports required/optional ordering

**Example:**
```bash
tldr temporal src/

# Filter to specific method
tldr temporal src/ --query connect

# Minimum support
tldr temporal src/ --min-support 5
```

---

## interface

**Alias:** `iface`

**Purpose:** Extract interface contracts (public API signatures, contracts).

**Implementation:** `crates/tldr-cli/src/commands/patterns/interface.rs`

**How it works:**
1. Extracts public functions/classes
2. Builds API surface
3. Infers contracts from signatures and usage

**Example:**
```bash
tldr interface src/
```

---

## Reference: quality

# Quality Commands

Quality commands analyze code maintainability, complexity, and technical debt.

## smells

**Purpose:** Detect code smells.

**Implementation:** `crates/tldr-cli/src/commands/smells.rs`

```rust
pub struct SmellsArgs {
    pub path: PathBuf,
    pub threshold: ThresholdPreset,
    pub smell_type: Option<SmellType>,
    pub suggest: bool,
    pub deep: bool,
}
```

**How it works:**
1. Analyzes structure for known anti-patterns
2. Computes metrics per smell type
3. Compares against threshold presets
4. `--deep` runs additional cohesion/coupling/dead analysis

**Smell types:**
- `god-class` — >20 methods or >500 LOC
- `long-method` — >50 LOC or cyclomatic >10
- `long-parameter-list` — >5 parameters
- `feature-envy` — method accessing too much foreign data
- `data-clumps` — same parameters always grouped
- `high-cognitive-complexity` — >= 15
- `deep-nesting` — nesting depth >= 5
- `data-class` — many fields, few methods
- And more...

**Example:**
```bash
tldr smells src/

# Strict thresholds
tldr smells src/ -t strict

# Specific smell type
tldr smells src/ -s god-class

# With suggestions
tldr smells src/ --suggest

# Deep analysis
tldr smells src/ --deep
```

---

## complexity

**Purpose:** Calculate function complexity metrics.

**Implementation:** `crates/tldr-cli/src/commands/complexity.rs`

**How it works:**
1. Parses function and builds CFG
2. Counts decision points (if, while, for, &&, ||, ?, etc.)
3. Returns cyclomatic complexity = edges - nodes + 2

**Example:**
```bash
tldr complexity src/process.py process_data

# Text output
tldr complexity src/process.py process_data -f text
```

---

## cognitive

**Alias:** `cog`

**Purpose:** Calculate cognitive complexity (SonarQube algorithm).

**Implementation:** `crates/tldr-cli/src/commands/cognitive.rs`

**How it works:**
1. Increments complexity for nesting depth
2. Increments for control flow structures
3. Does NOT increment for structured breaks (early returns)
4. Higher = more difficult to understand

**Example:**
```bash
tldr cognitive src/

# Per function
tldr cognitive src/ --function process_data

# Threshold filtering
tldr cognitive src/ --threshold 15
```

---

## halstead

**Alias:** `hal`

**Purpose:** Calculate Halstead complexity metrics per function.

**Metrics:**
- **Volume**: Size of implementation
- **Difficulty**: Operator count / operand count ratio
- **Effort**: Cognitive work to understand

**Example:**
```bash
tldr halstead src/process.py

# Show operators/operands
tldr halstead src/process.py --show-operators --show-operands
```

---

## loc

**Purpose:** Count lines of code with type breakdown.

**How it works:**
1. Counts total lines per file
2. Categorizes as code, comment, or blank
3. Aggregates by file or directory

**Example:**
```bash
tldr loc src/

# Per file
tldr loc src/ --by-file

# By directory
tldr loc src/ --by-dir
```

---

## churn

**Purpose:** Analyze git-based code churn.

**How it works:**
1. Scans git history (default: 365 days)
2. Counts commits per file
3. Tracks modification frequency

**Example:**
```bash
tldr churn src/

# Last 30 days
tldr churn src/ --days 30

# Top 50
tldr churn src/ --top 50

# With author stats
tldr churn src/ --authors
```

---

## debt

**Purpose:** Analyze technical debt using SQALE method.

**SQALE categories:**
- `reliability` — Bugs, error handling
- `security` — Vulnerabilities
- `maintainability` — Code quality
- `efficiency` — Performance
- `changeability` — Dependencies
- `testability` — Test coverage

**Example:**
```bash
tldr debt src/

# Category filter
tldr debt src/ -c security

# With cost estimation
tldr debt src/ --hourly-rate 150
```

---

## health

**Alias:** `h`

**Purpose:** Comprehensive code health dashboard.

**Implementation:** `crates/tldr-cli/src/commands/health.rs`

**How it works:**
1. Runs multiple analyzers in parallel:
   - Complexity (cyclomatic + cognitive)
   - Cohesion (LCOM4)
   - Dead code
   - Similarity
   - Coupling
2. Aggregates into health score

**Example:**
```bash
tldr health src/

# Quick mode
tldr health src/ --quick

# Detailed sub-analyzer
tldr health src/ --detail complexity

# Summary only
tldr health src/ --summary
```

---

## hotspots

**Alias:** `hot`

**Purpose:** Identify churn x complexity hotspots.

**How it works:**
1. Combines churn analysis with complexity metrics
2. Scores files/functions by risk (high churn + high complexity)
3. Applies recency weighting (recent changes count more)

**Example:**
```bash
tldr hotspots src/

# Function level
tldr hotspots src/ --by-function

# Include trends
tldr hotspots src/ --show-trend

# Different time window
tldr hotspots src/ --days 90 --recency-halflife 30
```

---

## clones

**Alias:** `cl`

**Purpose:** Detect code clones in a codebase.

**Clone types:**
- **Type 1**: Identical code (whitespace differences)
- **Type 2**: Same structure, different literals
- **Type 3**: Modified statements

**Example:**
```bash
tldr clones src/

# Minimum thresholds
tldr clones src/ --min-lines 10 --min-tokens 50

# Similarity threshold
tldr clones src/ -t 0.8

# Exclude tests
tldr clones src/ --exclude-tests
```

---

## cohesion

**Alias:** `coh`

**Purpose:** Analyze class cohesion using LCOM4 metric.

**LCOM4:** Number of connected components in method-field graph. Higher = lower cohesion.

**Example:**
```bash
tldr cohesion src/

# Minimum methods filter
tldr cohesion src/ --min-methods 3
```

---

## coupling

**Alias:** `coup`

**Purpose:** Analyze coupling between modules/classes.

**Metrics:**
- **Afferent**: Incoming dependencies (what depends on this)
- **Efferent**: Outgoing dependencies (what this depends on)
- **Instability**: efferent / (afferent + efferent)

**Example:**
```bash
tldr coupling src/

# Pair mode
tldr coupling src/module_a.py src/module_b.py

# Cycles only
tldr coupling src/ --cycles-only
```

---

## Reference: search

# Search Commands

Search commands find code by content or semantic similarity.

## search

**Purpose:** Enriched search with function-level context cards (BM25 + structure + call graph).

**Implementation:** `crates/tldr-cli/src/commands/search.rs`

```rust
pub struct SmartSearchArgs {
    pub query: String,
    pub path: PathBuf,
    pub top_k: usize,
    pub no_callgraph: bool,
    pub regex: bool,
    pub hybrid: Option<String>,
}
```

**How it works:**
1. **BM25 ranking**: Text search with TF-IDF weighting
2. **Structural context**: Enriches results with function signatures
3. **Call graph**: Adds callers/callees to result cards
4. **Hybrid mode**: Combine BM25 + regex filtering

**Example:**
```bash
tldr search "parse config" src/

# Return top 5
tldr search "error handling" src/ -k 5

# Skip call graph (faster)
tldr search "validate" src/ --no-callgraph

# Regex mode
tldr search "get.*user" src/ --regex

# Hybrid: BM25 ranking with regex filtering
tldr search "handler" src/ --hybrid ".*_handler"
```

**Output:**
```json
{
  "results": [
    {
      "file": "src/handlers.py",
      "function": "handle_user_request",
      "line": 42,
      "snippet": "def handle_user_request(config):",
      "score": 0.85,
      "callers": ["main", "router"],
      "callees": ["validate", "process"]
    }
  ]
}
```

---

## semantic

**Alias:** `sem`

**Purpose:** Semantic code search using natural language.

**Implementation:** `crates/tldr-cli/src/commands/semantic.rs`

```rust
pub struct SemanticArgs {
    pub query: String,
    pub path: PathBuf,
    pub top: usize,
    pub threshold: f32,
    pub model: String,
    pub lang: Option<Language>,
    pub no_cache: bool,
}
```

**How it works:**
1. Embeds query using FastEmbed model (arctic-s/m/l)
2. Embeds code chunks (function-level granularity)
3. Computes cosine similarity
4. Returns top N semantically similar results

**Example:**
```bash
tldr semantic "how is user authentication handled" src/

# Custom threshold
tldr semantic "session management" src/ -t 0.7

# Top 5
tldr semantic "database queries" src/ -n 5

# Different model
tldr semantic "caching" src/ -m arctic-l
```

---

## similar

**Alias:** `sim`

**Purpose:** Find similar code fragments to a given file/function.

**Implementation:** `crates/tldr-cli/src/commands/similar.rs`

**How it works:**
1. Embeds target function/file
2. Compares against all functions in scope
3. Returns ranked list of similar code

**Example:**
```bash
tldr similar src/utils.py

# Specific function
tldr similar src/utils.py -F process_data

# Different search path
tldr similar src/utils.py -p src/

# No cache
tldr similar src/utils.py --no-cache
```

---

## context

**Purpose:** Build LLM-ready context from entry point.

**Implementation:** `crates/tldr-cli/src/commands/context.rs`

```rust
pub struct ContextArgs {
    pub entry: String,
    pub project: PathBuf,
    pub depth: usize,
    pub include_docstrings: bool,
    pub file: Option<String>,
}
```

**How it works:**
1. Starts from entry function
2. Recursively collects:
   - Function signature
   - Docstring
   - Local context (variables, helpers)
   - Called functions (up to depth N)
3. Formats for LLM consumption (token-efficient)

**Example:**
```bash
tldr context main src/

# Deeper context
tldr context main src/ -d 5

# Include docstrings
tldr context main src/ --include-docstrings

# Specific file disambiguation
tldr context render src/ --file src/renderer.py
```

**Output:**
```
=== Function: main ===
def main() -> None:
    processes user input

=== Callee: parse_input (line 10) ===
def parse_input(data: str) -> dict:
    validates and parses input

=== Callee: process (line 25) ===
def process(config: dict) -> None:
    ...
```

---

## Reference: security

# Security Commands

Security commands detect vulnerabilities, taint flows, and API misuse.

## taint

**Alias:** `ta`

**Purpose:** Analyze taint flows to detect security vulnerabilities.

**Implementation:** `crates/tldr-cli/src/commands/taint.rs`

```rust
pub struct TaintArgs {
    pub file: PathBuf,
    pub function: String,
    pub lang: Option<Language>,
    pub verbose: bool,
}
```

**How it works:**
1. Builds CFG and DFG for function
2. Marks sources as tainted (user input, files, network)
3. Propagates taint through operations
4. Checks for sanitizers along paths
5. Reports taint flows to sensitive sinks

**Taint sources:**
- Function parameters
- File reads
- Network input
- Environment variables

**Taint sinks:**
- SQL queries (`execute`, `query`)
- Command execution (`exec`, `system`)
- File operations (`open`, `write`)
- HTML/JS output (`innerHTML`, `document.write`)

**Example:**
```bash
tldr taint src/process.py handle_request

# Verbose output
tldr taint src/process.py handle_request -v
```

---

## vuln

**Purpose:** Vulnerability scanning via taint analysis.

**Implementation:** `crates/tldr-cli/src/commands/remaining/vuln.rs`

**How it works:**
1. Scans all functions in scope
2. Runs taint analysis per function
3. Categorizes by vulnerability type
4. Filters by severity

**Vulnerability types:**
- `sql_injection` — Unescaped SQL
- `xss` — Unescaped HTML/JS output
- `command_injection` — Unsanitized command execution
- `ssrf` — Server-side request forgery
- `path_traversal` — Unsanitized file paths
- `deserialization` — Unsafe deserialization
- `unsafe_code` — Memory unsafe operations
- `memory_safety` — Buffer overflow, use-after-free
- And more...

**Example:**
```bash
tldr vuln src/

# High severity only
tldr vuln src/ --severity high

# Specific type
tldr vuln src/ --vuln-type sql_injection
```

---

## secure

**Alias:** `sec`

**Purpose:** Security analysis dashboard (aggregate of multiple analyses).

**Implementation:** `crates/tldr-cli/src/commands/remaining/secure.rs`

**How it works:**
1. Runs multiple security analyses:
   - `taint` — Taint flow analysis
   - `resources` — Resource lifecycle
   - `bounds` — Buffer bounds
   - `contracts` — Pre/postcondition violations
   - `behavioral` — Behavioral patterns
   - `mutability` — Mutable state issues
2. Aggregates into security score

**Example:**
```bash
tldr secure src/

# Quick mode
tldr secure src/ --quick

# Detail specific sub-analysis
tldr secure src/ --detail taint
```

---

## api-check

**Alias:** `ac`

**Purpose:** Detect API misuse patterns.

**Implementation:** `crates/tldr-cli/src/commands/remaining/api_check.rs`

**Categories:**
- `call-order` — Wrong sequence (e.g., use before init)
- `error-handling` — Missing try/catch, bare except
- `parameters` — Wrong types, missing required
- `resources` — Unclosed files, unclosed connections
- `crypto` — Weak crypto, missing IVs
- `concurrency` — Race conditions, deadlocks
- `security` — Auth bypasses, etc.

**Example:**
```bash
tldr api-check src/

# Specific category
tldr api-check src/ --category error-handling

# Severity filter
tldr api-check src/ --severity high
```

---

## resources

**Alias:** `res`

**Purpose:** Analyze resource lifecycle (leaks, double-close, use-after-close).

**Implementation:** `crates/tldr-cli/src/commands/patterns/resources.rs`

**Checks:**
- **R2**: Memory/file descriptor leaks
- **R3**: Double-close detection
- **R4**: Use-after-close
- **R6**: Suggest context manager usage
- **R7**: Detailed leak paths

**Example:**
```bash
tldr resources src/database.py

# All checks
tldr resources src/database.py --check-all

# Leak paths
tldr resources src/database.py --show-paths

# With suggestions
tldr resources src/database.py --suggest-context
```

---

## Reference: tools

# Tools Commands

Miscellaneous tools for development workflow integration.

## doctor

**Alias:** `doc`

**Purpose:** Check and install diagnostic tools for each language.

**Implementation:** `crates/tldr-cli/src/commands/doctor.rs`

**How it works:**
1. Detects installed tools per language
2. Reports missing tools
3. Optionally installs via `--install`

**Example:**
```bash
tldr doctor

# Install tools
tldr doctor --install python
tldr doctor --install rust
tldr doctor --install go
```

**Supported languages and tools:**
- Python: pyright, ruff, mypy
- TypeScript: typescript-language-server, tsc
- Go: gopls, golangci-lint
- Rust: rustc, cargo
- Java: checkstyle, spotbugs

---

## diagnostics

**Alias:** `diag`

**Purpose:** Run type checking and linting using external tools.

**Implementation:** `crates/tldr-cli/src/commands/diagnostics.rs`

**Example:**
```bash
tldr diagnostics src/

# Specific tools
tldr diagnostics src/ --tools pyright,ruff

# Skip type checking (linters only)
tldr diagnostics src/ --no-typecheck

# Output for GitHub Actions
tldr diagnostics src/ --output github-actions
```

---

## fix

**Alias:** `fx`

**Purpose:** Diagnose and auto-fix errors from compiler/runtime output.

**Subcommands:**

### fix diagnose

Parse error output and produce structured diagnosis.

```bash
tldr fix diagnose "error: ..."
tldr fix diagnose < build.log
```

### fix apply

Apply fix edits to source code.

```bash
tldr fix apply < fix.json
```

### fix check

Run test command, diagnose failures, apply fixes, re-run in a loop.

```bash
tldr fix check -- cargo test
tldr fix check -- pytest
```

---

## bugbot

**Purpose:** Automated bug detection on code changes.

**Subcommands:**

### bugbot check

Run bugbot check on uncommitted changes.

```bash
tldr bugbot check

# Staged files only
tldr bugbot check --staged

# All uncommitted
tldr bugbot check --uncommitted
```

**Checks performed:**
- Syntax errors introduced
- Type errors from changes
- API contract violations
- Known bug patterns

---

## diff

**Alias:** `df`

**Purpose:** AST-aware structural diff between two files.

**Implementation:** `crates/tldr-cli/src/commands/diff.rs`

**Granularity levels:**
- `token` (L1) — Token-level diff
- `expression` (L2) — Expression-level diff
- `statement` (L3) — Statement-level diff
- `function` (L4) — Function-level diff (default)
- `class` (L5) — Class-level diff
- `file` (L6) — File-level diff
- `module` (L7) — Module-level diff
- `architecture` (L8) — Architecture-level diff

**Example:**
```bash
tldr diff src/v1/utils.py src/v2/utils.py

# Expression-level diff
tldr diff src/v1/main.py src/v2/main.py -g expression

# Exclude formatting-only changes
tldr diff src/v1/main.py src/v2/main.py --semantic-only
```

---

## surface

**Alias:** `surf`

**Purpose:** Extract machine-readable API surface for a library/package.

**Example:**
```bash
tldr surface requests

# Lookup specific API
tldr surface requests --lookup requests.Session

# Include private APIs
tldr surface mylib --include-private
```

---

## deps

**Alias:** `dep`

**Purpose:** Analyze module dependencies.

**Example:**
```bash
tldr deps src/

# Include external deps
tldr deps src/ --include-external

# Show cycles only
tldr deps src/ --show-cycles

# Limit depth
tldr deps src/ -d 3
```

---

## change-impact

**Alias:** `ci`

**Purpose:** Find tests affected by code changes.

**Example:**
```bash
tldr change-impact src/

# Explicit changed files
tldr change-impact src/ -F src/main.py,src/utils.py

# Base branch
tldr change-impact src/ -b origin/main

# pytest format
tldr change-impact src/ --runner pytest-k

# Jest format
tldr change-impact src/ --runner jest
```

---

## todo

**Purpose:** Aggregate improvement suggestions.

**Aggregates from:**
- `dead` — Dead code
- `complexity` — High complexity functions
- `cohesion` — Low cohesion classes
- `similar` — Similar code fragments

**Example:**
```bash
tldr todo src/

# Quick mode
tldr todo src/ --quick

# Specific detail
tldr todo src/ --detail dead_code
```
