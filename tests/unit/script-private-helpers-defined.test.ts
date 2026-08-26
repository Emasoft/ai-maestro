/**
 * TRDD-39OPYXQ9 — every `_private_helper` a script CALLS must be DEFINED somewhere it
 * can reach, or the verb dies `command not found` (exit 127) the first time a human runs it.
 *
 * `scripts/aimaestro-continuity.sh` shipped, was registered in docs/SCRIPT-LAYER.md "so CORE
 * can teach its skills against it", and passed shellcheck — while ALL THREE of its verbs
 * called `_api`, which nothing defined. shellcheck cannot see a call to a function it assumes
 * exists at runtime, so "shellcheck clean" was true and useless; the defect surfaced only when
 * someone finally ran the bare command with a real credential, five weeks later.
 *
 * The card asked for a smoke test driving every verb through PATH and asserting exit != 127.
 * That needs a live server, a credential and a deployed copy — three things a unit run does
 * not have, and each of them can make the test lie in the SAFE direction (skip/pass). This
 * check is the offline, deterministic core of the same property: resolve the call graph for
 * underscore-prefixed helpers (the repo's private-helper convention) and require a definition.
 * It runs against the REPO's scripts, never ~/.local/bin — a deployed dir is one machine's
 * snapshot (SCRIPT-MANIFEST.md §5).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const SCRIPTS = join(process.cwd(), 'scripts')
const COMMON = join(SCRIPTS, 'shell-helpers', 'common.sh')

/** Function names defined in a shell source: `name() {` or `function name`. */
function definedIn(src: string): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/gm)) out.add(m[1])
  for (const m of src.matchAll(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)) out.add(m[1])
  return out
}

/** Underscore-prefixed helpers invoked in command position (start of line / after `|`, `&&`, `;`, `(`). */
function calledIn(src: string): Set<string> {
  const out = new Set<string>()
  const stripped = src.replace(/^\s*#.*$/gm, '')
  for (const m of stripped.matchAll(/(?:^|[|;&(]|\$\()\s*(_[A-Za-z0-9_]+)(?=\s|$)/gm)) out.add(m[1])
  return out
}

/** Files this one pulls in via `source`/`.`/`_source_module` (basenames only). */
function sourcedBy(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/(?:^|\s)(?:source|\.)\s+[^\n]*?([A-Za-z0-9_.-]+\.sh)/gm)) out.push(m[1])
  // `_source_module "agent-helper.sh"` — the argument already carries .sh in this repo,
  // so normalize rather than blindly appending (that produced "agent-helper.sh.sh").
  for (const m of src.matchAll(/_source_module\s+"?([A-Za-z0-9_.-]+)"?/gm)) {
    out.push(m[1].endsWith('.sh') ? m[1] : `${m[1]}.sh`)
  }
  return out
}

const commonDefs = existsSync(COMMON) ? definedIn(readFileSync(COMMON, 'utf8')) : new Set<string>()
const shells = readdirSync(SCRIPTS).filter(f => f.endsWith('.sh'))
const srcOf = new Map(shells.map(f => [f, readFileSync(join(SCRIPTS, f), 'utf8')]))

/** Definitions reachable from `file`: its own, common.sh, everything it sources
 *  (transitively) — AND, when it is a MODULE, everything its PARENT sources, because
 *  the parent sources the whole family into ONE runtime namespace. Without that half a
 *  module like agent-core.sh looks broken for calling a helper agent-helper.sh defines. */
function reachableDefs(file: string): Set<string> {
  const seen = new Set<string>()
  const acc = new Set<string>(commonDefs)
  const visit = (f: string) => {
    if (seen.has(f) || !srcOf.has(f)) return
    seen.add(f)
    const src = srcOf.get(f)!
    for (const d of definedIn(src)) acc.add(d)
    for (const child of sourcedBy(src)) visit(child)
  }
  visit(file)
  for (const [parent, src] of srcOf) if (sourcedBy(src).includes(file)) visit(parent)
  return acc
}

describe('script layer: every private helper a script calls is defined', () => {
  it('has scripts to scan and a readable common.sh (non-vacuity: a broken scan must not read clean)', () => {
    expect(shells.length).toBeGreaterThan(5)
    expect(commonDefs.size).toBeGreaterThan(0)
  })

  it.each(shells)('%s calls no undefined _helper', (file) => {
    const src = readFileSync(join(SCRIPTS, file), 'utf8')
    const defs = reachableDefs(file)
    const missing = [...calledIn(src)].filter(
      // A name also assigned as a variable is not a function call site.
      fn => !defs.has(fn) && !new RegExp(`^\\s*${fn}=`, 'm').test(src),
    )
    expect(missing).toEqual([])
  })
})
