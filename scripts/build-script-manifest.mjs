#!/usr/bin/env node
// build-script-manifest.mjs — the frozen-CLI script manifest (TRDD-7OJ4TEHV; #35 / #56 / #16).
//
// WHAT IT EMITS. `scripts/script-manifest.json`: for every SKILL-FACING script at scripts/ top
// level, its verb set and flag set parsed from the `case` dispatch arms, plus the `# Usage:`
// header carried as HUMAN TEXT. The core plugin greps what its skills CALL; this file is the
// authoritative other half — what this repo SHIPS — so full coverage (no script uncovered, no
// skill on a stale signature) becomes provable instead of asserted.
//
// WHY THE SOURCE OF TRUTH IS THE DISPATCH ARMS AND NOT `--help`. Measured before building
// (recorded on the card): `--help` covers 59/85 scripts vs 67/85 for `# Usage:`; a `--help`
// generator would have silently skipped scripts that shipped skills call (`amp-create-branch.sh`,
// `aid-auth.sh`), and `--help` PROSE drifts on documentation improvements while the flag set stays
// byte-identical — a drift check that cries wolf on a doc fix is a drift check people route
// around. The contract is the dispatch set; the prose is not. So `--check` diffs ONLY the parsed
// verb/flag sets and the included/excluded classification, never the usage text.
//
// WHY THE DISCRIMINATOR IS "DISPATCHES AT TOP LEVEL" AND NOT A NAME LIST. A script is
// skill-facing iff it has a top-level `case` on the CLI arguments (directly on `$1`/`${1…}`, or on
// a variable assigned from `$1`, or a `case "$1"` inside a top-level `while` arg loop — measured:
// `amp-kanban-create-task.sh` parses args at top level with no `main()`). The two cheaper tests
// both fail on the real corpus: `main "$@"` matches only 4/87, and "is sourced by another script"
// misses dynamic sourcing (`_source_module "${module}"`) while over-capturing `amp-send.sh`.
// A name list would rot; the discriminator excludes tomorrow's new module by construction —
// `aimaestro-agent.sh`'s SIX modules (agent-helper/core/commands/session/skill/plugin) hold their
// verbs' `cmd_*` bodies but dispatch nothing at top level, so they classify as internal here
// without anyone remembering to list them.
//
// EXIT CODES (grep trichotomy, the pillar-CLI convention): 0 clean · 1 drift · 2 COULD NOT RUN.
// A reader that returned "no drift" on an unreadable input would pass because it read nothing.

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MANIFEST_FILE = 'script-manifest.json'

// The four skill-facing FAMILY prefixes. A `.sh` outside them (installers, dev helpers) is out of
// scope entirely — neither included nor "excluded", it is simply not part of the frozen surface.
const FAMILY_PREFIXES = ['aimaestro-', 'amp-', 'aid-', 'agent-']

/** A line that STARTS a shell function: `name() {`, `function name {`, or `name()` with the brace
 *  on the next line. Tracked so a `case` inside a function body never reads as a dispatcher. */
const FUNC_START = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_.:-]*)\s*\(\s*\)\s*\{?\s*(?:#.*)?$|^\s*function\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*\{\s*(?:#.*)?$/

/** The convention every script in this corpus follows: a function's closing brace sits alone at
 *  column 0. Verified against the ground-truth set below; a corpus that breaks the convention
 *  breaks the ground-truth assertions loudly rather than silently. */
const FUNC_END = /^\}\s*$/

/** A heredoc opener. Tracked in EVERY state, because a heredoc body is data: a JSON heredoc's
 *  column-0 `}` would otherwise end function-skipping mid-body (measured: amp-helper.sh read as
 *  111 top-level lines through exactly this desync), and a usage heredoc's `--flag` lines would
 *  read as case arms. `[A-Za-z_]` after `<<` keeps arithmetic `<<` shifts from matching. */
const HEREDOC_OPEN = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/

const CASE_LINE = /\bcase\s+(.+?)\s+in\b/
/** A case-arm line: one or more `|`-separated tokens closed by `)`, no `$`, no `(` (which would be
 *  a subshell or command substitution, not an arm). */
const ARM_LINE = /^\s*((?:[A-Za-z0-9@_'".:*=|-]|\[|\])+)\)/

export function parseScript(content) {
  const rawLines = content.split('\n')

  // `# Usage:` header, carried as human text and NEVER compared by --check.
  const usage = []
  {
    let started = false
    for (const line of rawLines) {
      if (!started) {
        if (/^# Usage:/i.test(line)) {
          started = true
          usage.push(line)
        }
        continue
      }
      if (/^#/.test(line)) usage.push(line)
      else break
    }
  }

  // ── One structural walk. State priority: heredoc body > function body > top level. Full-line
  // comments are skipped in every state (a module that DOCUMENTS `|| exit 1` in prose must not
  // classify as a CLI — measured on agent-commands.sh).
  let heredocTerm = null
  let funcName = null
  const argVars = new Set() // top-level vars assigned from $1 / for-@ loop vars
  let fnArgVars = new Set() // per-FUNCTION vars assigned from that function's $1 (reset per function)
  let sawTopArgCase = false
  let sawMainCall = false // top-level `main "$@"`
  let sawTerminalExit = false // UNCONDITIONAL column-0 exit/exec — a sourced lib cannot carry one
  const verbs = new Set()
  // Verbs found in FUNCTION-scope arg-cases. Merged into `verbs` only when the file actually
  // calls `main "$@"` at top level: in such a file the argv flows into the function chain, and
  // the dispatch case sits on a function-local `$1` (measured: aimaestro-agent.sh's 19 verbs live
  // in dispatch()'s `case "$verb"`, where `local verb="$1"` is dispatch's OWN positional — the
  // `main`-only scope harvested exactly ['help'] and understated the whole surface).
  const fnVerbs = new Set()
  const flags = new Set()
  const caseStack = [] // { isArg, scope: 'top' | 'fn' }

  for (const raw of rawLines) {
    const line = raw.replace(/\t/g, '  ')

    if (heredocTerm !== null) {
      if (line.trim() === heredocTerm) heredocTerm = null
      continue
    }
    if (/^\s*(#|$)/.test(line)) continue

    const fdef = line.match(FUNC_START)
    if (funcName === null && fdef) {
      funcName = fdef[1] || fdef[2]
      fnArgVars = new Set()
      continue
    }
    if (funcName !== null && FUNC_END.test(line)) {
      funcName = null
      continue
    }

    const heredoc = line.match(HEREDOC_OPEN)
    const topLevel = funcName === null

    {
      const vars = topLevel ? argVars : fnArgVars
      const assign = line.match(/^\s*(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)=["']?\$\{?1\b/)
      if (assign) vars.add(assign[1])
      const forLoop = line.match(/^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+"?\$@/)
      if (forLoop) vars.add(forLoop[1])
    }
    if (topLevel) {
      if (/^\s*main\s+"?\$[@*]/.test(line)) sawMainCall = true
      if (/^(exit|exec)\b/.test(line)) sawTerminalExit = true
    }

    // An arm line may ALSO open a nested case on the same line (`list)  case "$mode" in` — the
    // real shape of aimaestro-agent.sh's dispatch), so arm-harvesting runs BEFORE case-opening
    // and the two are not exclusive: an else-if chain here silently dropped the `list` verb.
    const arm = caseStack.length ? line.match(ARM_LINE) : null
    if (arm) {
      const frame = caseStack[caseStack.length - 1]
      for (let tok of arm[1].split('|')) {
        tok = tok.replace(/^['"]|['"]$/g, '').replace(/=\*$/, '')
        if (!tok || tok.includes('*') || tok === '--' || tok === '-') continue
        if (tok.startsWith('-')) flags.add(tok)
        // Verbs come from DEPTH-1 arg-cases only: a NESTED arg-case is an internal mode switch
        // (dispatch()'s `case "$mode" in check|validate|run` — `mode` is assigned from $1, so the
        // subject test alone cannot tell it from the verb case; the depth can).
        else if (frame.isArg && frame.depth === 1 && frame.scope === 'top') verbs.add(tok)
        else if (frame.isArg && frame.depth === 1 && frame.scope === 'fn') fnVerbs.add(tok)
      }
    }
    const caseM = line.match(CASE_LINE)
    if (caseM) {
      const subject = caseM[1]
      const vars = topLevel ? argVars : fnArgVars
      const isArg =
        /\$\{?1\b/.test(subject) ||
        [...vars].some((v) => subject.includes(`$${v}`) || subject.includes(`\${${v}`))
      caseStack.push({ isArg, scope: topLevel ? 'top' : 'fn', depth: caseStack.length + 1 })
      if (isArg && topLevel) sawTopArgCase = true
    } else if (/^\s*esac\b/.test(line)) {
      caseStack.pop()
    }

    if (heredoc) heredocTerm = heredoc[2]
  }

  // The three tells, each earned by a real counterexample to the cheaper discriminators:
  //   argcase   — 44/58 scripts, incl. while-arg-loop parsers with no main() (amp-kanban-create-task)
  //   main      — aimaestro-agent.sh dispatches inside main(); its verbs merge in below
  //   terminal  — aid-auth.sh (env-driven emitter) and aimaestro-settings.sh (exec wrapper) have no
  //               case at all; an UNCONDITIONAL column-0 exit/exec is a statement no sourced lib
  //               can carry (it would end every sourcer, unconditionally). agent-helper.sh's
  //               CONDITIONAL indented `|| { exit 1 }` guards deliberately do NOT match.
  const skillFacing = sawTopArgCase || sawMainCall || sawTerminalExit
  if (sawMainCall) for (const v of fnVerbs) verbs.add(v)

  return {
    skillFacing,
    verbs: [...verbs].sort(),
    flags: [...flags].sort(),
    usage,
  }
}

export function buildManifest(scriptsDir) {
  let names
  try {
    names = fs.readdirSync(scriptsDir)
  } catch (err) {
    throw Object.assign(new Error(`cannot read scripts dir ${scriptsDir}: ${err.message}`), { couldNotRun: true })
  }
  const shFiles = names
    .filter((n) => n.endsWith('.sh') && FAMILY_PREFIXES.some((p) => n.startsWith(p)))
    .sort()
  if (shFiles.length === 0) {
    throw Object.assign(new Error(`no family .sh files found under ${scriptsDir} — refusing to certify an empty read`), {
      couldNotRun: true,
    })
  }

  const scripts = {}
  const excluded = {}
  for (const name of shFiles) {
    let content
    try {
      content = fs.readFileSync(path.join(scriptsDir, name), 'utf8')
    } catch (err) {
      // Unreadable is a FAULT, never a legal absence: a manifest that silently skipped an
      // unreadable script would certify coverage it does not have.
      throw Object.assign(new Error(`cannot read ${name}: ${err.message}`), { couldNotRun: true })
    }
    const parsed = parseScript(content)
    if (parsed.skillFacing) {
      scripts[name] = {
        family: FAMILY_PREFIXES.find((p) => name.startsWith(p)).replace(/-$/, ''),
        verbs: parsed.verbs,
        flags: parsed.flags,
        usage: parsed.usage,
      }
    } else {
      excluded[name] = 'no top-level dispatch — internal lib/module, not skill-facing'
    }
  }

  // The in-tool non-vacuity floor, derived from the walk itself (never a hand-written number):
  // every walked file must be classified, and a corpus this size yielding zero CLIs means the
  // PARSER broke, not the corpus.
  const classified = Object.keys(scripts).length + Object.keys(excluded).length
  if (classified !== shFiles.length) {
    throw Object.assign(new Error(`classified ${classified} of ${shFiles.length} walked scripts — parser dropped files`), {
      couldNotRun: true,
    })
  }
  if (Object.keys(scripts).length === 0) {
    throw Object.assign(new Error(`0 of ${shFiles.length} scripts classified skill-facing — a broken parser, not an empty surface`), {
      couldNotRun: true,
    })
  }

  return {
    v: 1,
    note: 'FROZEN-CLI manifest. verbs/flags are the contract --check diffs; usage is human text, never compared. Regenerate: node scripts/build-script-manifest.mjs',
    counts: { walked: shFiles.length, skillFacing: Object.keys(scripts).length, excluded: Object.keys(excluded).length },
    scripts,
    excluded,
  }
}

/** The comparable projection — everything EXCEPT the usage prose. */
function dispatchView(manifest) {
  const view = { scripts: {}, excluded: Object.keys(manifest.excluded).sort() }
  for (const [name, s] of Object.entries(manifest.scripts)) {
    view.scripts[name] = { verbs: s.verbs, flags: s.flags }
  }
  return view
}

export function diffManifests(committed, fresh) {
  const a = dispatchView(committed)
  const b = dispatchView(fresh)
  const drift = []
  const aNames = Object.keys(a.scripts)
  const bNames = Object.keys(b.scripts)
  for (const n of bNames.filter((n) => !aNames.includes(n))) drift.push(`NEW skill-facing script not in manifest: ${n}`)
  for (const n of aNames.filter((n) => !bNames.includes(n))) drift.push(`script in manifest but no longer skill-facing/present: ${n}`)
  for (const n of aNames.filter((n) => bNames.includes(n))) {
    for (const kind of ['verbs', 'flags']) {
      const was = a.scripts[n][kind]
      const now = b.scripts[n][kind]
      const gone = was.filter((x) => !now.includes(x))
      const added = now.filter((x) => !was.includes(x))
      if (gone.length) drift.push(`${n}: ${kind} removed: ${gone.join(', ')}`)
      if (added.length) drift.push(`${n}: ${kind} added: ${added.join(', ')}`)
    }
  }
  const exGone = a.excluded.filter((x) => !b.excluded.includes(x))
  const exAdded = b.excluded.filter((x) => !a.excluded.includes(x))
  for (const n of exGone) if (!bNames.includes(n)) drift.push(`excluded script vanished: ${n}`)
  for (const n of exAdded) if (!aNames.includes(n)) drift.push(`new internal module: ${n}`)
  return drift
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const scriptsDir = HERE
  const manifestPath = path.join(scriptsDir, MANIFEST_FILE)

  let fresh
  try {
    fresh = buildManifest(scriptsDir)
  } catch (err) {
    console.error(`COULD NOT RUN: ${err.message}`)
    process.exit(2)
  }

  if (!check) {
    fs.writeFileSync(manifestPath, JSON.stringify(fresh, null, 2) + '\n')
    console.log(
      `wrote ${path.relative(process.cwd(), manifestPath)} — ${fresh.counts.skillFacing} skill-facing, ${fresh.counts.excluded} internal, ${fresh.counts.walked} walked`,
    )
    process.exit(0)
  }

  let committed
  try {
    committed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    // No manifest (or unreadable/corrupt) is COULD-NOT-RUN, not "clean": there is nothing to
    // compare against, and exit 0 here would certify a diff that never happened.
    console.error(`COULD NOT RUN: cannot read ${MANIFEST_FILE} (${err.message}) — generate it first`)
    process.exit(2)
  }
  if (committed?.v !== 1) {
    console.error(`COULD NOT RUN: ${MANIFEST_FILE} has unknown schema (v=${committed?.v}) — treat as absent, regenerate`)
    process.exit(2)
  }

  const drift = diffManifests(committed, fresh)
  if (drift.length) {
    console.error(`DRIFT (${drift.length}):`)
    for (const d of drift) console.error(`  ${d}`)
    process.exit(1)
  }
  console.log(`clean — ${fresh.counts.skillFacing} skill-facing scripts match the manifest (usage prose not compared)`)
  process.exit(0)
}

// REALPATH both sides: on macOS the tmp dirs the tests copy this tool into live under
// /var/folders → a SYMLINK to /private/var, so `path.resolve(argv[1])` (lexical) and
// `import.meta.url` (real) disagree, main() silently never runs, and the process exits 0 having
// done nothing — an exit code indistinguishable from success.
function isDirectInvocation() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
if (isDirectInvocation()) {
  main()
}
