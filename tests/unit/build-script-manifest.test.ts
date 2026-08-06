/**
 * scripts/build-script-manifest.mjs — the frozen-CLI manifest generator (TRDD-7OJ4TEHV).
 *
 * WHAT MUST BE PINNED, per the card:
 *   · the DISCRIMINATOR (not a name list): top-level arg-dispatch OR `main "$@"` OR an
 *     unconditional column-0 exit/exec classifies a script skill-facing; a functions-only module
 *     is excluded BY CONSTRUCTION — so tomorrow's new module needs nobody to remember a list;
 *   · the exclusion OUTCOME as data, asserted against the REAL corpus (the 10 internal libs);
 *   · a renamed FLAG reddens `--check` while a reworded `# Usage:` line does NOT — without the
 *     second half, the whole point of choosing the dispatch set over the prose is unpinned;
 *   · the grep trichotomy: 0 clean · 1 drift · 2 COULD-NOT-RUN, with unreadable/absent inputs
 *     landing on 2, never on 0.
 *
 * The subprocess fixture copies the TOOL ITSELF into a temp `scripts/` dir (the tool derives its
 * scan dir from its own file location — no path argument exists, deliberately), so every exit
 * code is driven end-to-end against controlled fixtures without ever mutating the real tree.
 *
 * NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash; a
 * complementary pair with DISJOINT red sets):
 *   · A (first attempt, a finding about the aim, kept as a lesson): adding `usage` to
 *     dispatchView's projection alone reddened NOTHING — the projection is SHADOWED by
 *     diffManifests' own `['verbs', 'flags']` kinds list, which is the actual guard.
 *   · A2 — mutate BOTH (projection + kinds list) so usage is genuinely compared →
 *     exactly 1 red: 'a reworded `# Usage:` line is NOT drift'. Everything else green.
 *   · B — `if (tok.startsWith('-')) flags.add(tok)` → `if (false)` (flag arms dropped) →
 *     exactly 3 red: 'a renamed flag IS drift' (drift undetected), 'parses verbs and flags from
 *     a top-level arg-case', and 'the committed manifest is CURRENT' (fresh parse loses its
 *     flags against the committed artifact). The real-corpus DATA test stays green — it reads
 *     the committed FILE, not the live parser, which is exactly its job.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const TOOL = path.join(REPO, 'scripts', 'build-script-manifest.mjs')

// ── Fixture scripts, one per discriminator branch ────────────────────────────────────────────────
const CLI_TOPCASE = `#!/bin/bash
# Usage:
#   amp-fix.sh <verb> [--force]
#   Original usage prose.
while [[ $# -gt 0 ]]; do
  case "$1" in
    start|stop) VERB="$1" ;;
    --force) FORCE=1 ;;
    -q|--quiet) QUIET=1 ;;
    *) break ;;
  esac
  shift
done
`
const CLI_MAIN = `#!/bin/bash
# Usage:
#   amp-mainy.sh <verb>
dispatch() {
    local verb="$1"; shift
    case "$verb" in
        greet)  echo hi ;;
        leave)  echo bye ;;
        *) return 1 ;;
    esac
}
main() {
    case "\${1:-help}" in
        help|--help) echo usage; return 0 ;;
    esac
    dispatch "$@"
}
main "$@"
`
const CLI_TERMINAL = `#!/bin/bash
# Usage:
#   aid-emit.sh   (no arguments — env-driven)
if [ -n "\${SOME_VAR:-}" ]; then
  echo "$SOME_VAR"
  exit 0
fi
exit 1
`
const LIB_MODULE = `#!/bin/bash
# A sourced module: functions only. Its heredoc's column-0 brace and its documented
# \`|| exit 1\` prose must not classify it — both were measured misclassifiers.
emit_config() {
    cat <<EOF
{
  "key": "value"
}
EOF
}
helper_fn() {
    case "$1" in
        --inner) return 0 ;;
    esac
    return 1
}
`
const LIB_GUARDED = `#!/bin/bash
# A lib that validates its environment at source time — its exits are CONDITIONAL and
# indented, which must NOT read as a standalone program's terminal exit.
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)" || {
    echo "cannot locate" >&2
    exit 1
}
some_fn() {
    echo ok
}
`

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-fix-'))
  const dir = path.join(root, 'scripts')
  fs.mkdirSync(dir)
  fs.copyFileSync(TOOL, path.join(dir, 'build-script-manifest.mjs'))
  fs.writeFileSync(path.join(dir, 'amp-fix.sh'), CLI_TOPCASE)
  fs.writeFileSync(path.join(dir, 'amp-mainy.sh'), CLI_MAIN)
  fs.writeFileSync(path.join(dir, 'aid-emit.sh'), CLI_TERMINAL)
  fs.writeFileSync(path.join(dir, 'agent-mod.sh'), LIB_MODULE)
  fs.writeFileSync(path.join(dir, 'amp-lib.sh'), LIB_GUARDED)
  return root
}

function run(root: string, args: string[] = []): { exit: number; out: string } {
  const r = spawnSync('node', [path.join(root, 'scripts', 'build-script-manifest.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { exit: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function readManifest(root: string) {
  return JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'script-manifest.json'), 'utf8'))
}

describe('build-script-manifest — the discriminator (not a name list)', () => {
  let root: string
  beforeAll(() => {
    root = makeFixture()
    expect(run(root).exit).toBe(0)
  })
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('parses verbs and flags from a top-level arg-case', () => {
    const m = readManifest(root)
    expect(m.scripts['amp-fix.sh'].verbs).toEqual(['start', 'stop'])
    expect(m.scripts['amp-fix.sh'].flags).toEqual(['--force', '--quiet', '-q'])
  })

  it('a `main "$@"` dispatcher is skill-facing and its function-scope verbs are harvested', () => {
    const m = readManifest(root)
    expect(m.scripts['amp-mainy.sh'].verbs).toEqual(expect.arrayContaining(['greet', 'leave', 'help']))
  })

  it('an env-driven script with an unconditional column-0 exit is skill-facing (empty contract)', () => {
    const m = readManifest(root)
    expect(m.scripts['aid-emit.sh']).toBeDefined()
    expect(m.scripts['aid-emit.sh'].verbs).toEqual([])
  })

  it('a functions-only module is excluded BY CONSTRUCTION — heredoc braces and documented exits included', () => {
    const m = readManifest(root)
    expect(m.excluded['agent-mod.sh']).toMatch(/internal/)
    // and its function-internal `--inner` flag never leaks into anyone's contract
    expect(JSON.stringify(m.scripts)).not.toContain('--inner')
  })

  it('a lib whose source-time guards exit CONDITIONALLY (indented) is still a lib', () => {
    const m = readManifest(root)
    expect(m.excluded['amp-lib.sh']).toMatch(/internal/)
  })

  it('usage prose is carried as human text', () => {
    const m = readManifest(root)
    expect(m.scripts['amp-fix.sh'].usage.join('\n')).toContain('Original usage prose')
  })
})

describe('build-script-manifest --check — drift is the dispatch set, never the prose', () => {
  let root: string
  beforeAll(() => {
    root = makeFixture()
    expect(run(root).exit).toBe(0) // generate the committed manifest
  })
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('clean when nothing changed', () => {
    const r = run(root, ['--check'])
    expect(r.exit).toBe(0)
    expect(r.out).toMatch(/clean/)
  })

  it('a renamed flag IS drift (exit 1, both directions named)', () => {
    const p = path.join(root, 'scripts', 'amp-fix.sh')
    const orig = fs.readFileSync(p, 'utf8')
    fs.writeFileSync(p, orig.replace('--force)', '--forcibly)'))
    const r = run(root, ['--check'])
    fs.writeFileSync(p, orig)
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/flags removed: --force/)
    expect(r.out).toMatch(/flags added: --forcibly/)
  })

  it('a reworded `# Usage:` line is NOT drift (exit 0) — the whole reason the source is the dispatch set', () => {
    const p = path.join(root, 'scripts', 'amp-fix.sh')
    const orig = fs.readFileSync(p, 'utf8')
    fs.writeFileSync(p, orig.replace('Original usage prose.', 'Completely reworded documentation prose.'))
    const r = run(root, ['--check'])
    fs.writeFileSync(p, orig)
    expect(r.exit).toBe(0)
    expect(r.out).toMatch(/clean/)
  })

  it('a NEW skill-facing script is drift until the manifest is regenerated', () => {
    const p = path.join(root, 'scripts', 'amp-new.sh')
    fs.writeFileSync(p, CLI_TOPCASE)
    const r = run(root, ['--check'])
    fs.rmSync(p)
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/NEW skill-facing script.*amp-new\.sh/)
  })

  it('COULD-NOT-RUN when the manifest is absent — never "clean about nothing"', () => {
    const p = path.join(root, 'scripts', 'script-manifest.json')
    const orig = fs.readFileSync(p, 'utf8')
    fs.rmSync(p)
    const r = run(root, ['--check'])
    fs.writeFileSync(p, orig)
    expect(r.exit).toBe(2)
    expect(r.out).toMatch(/COULD NOT RUN/)
  })

  it('COULD-NOT-RUN when the corpus yields zero CLIs (the in-tool non-vacuity floor)', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-bare-'))
    const dir = path.join(bare, 'scripts')
    fs.mkdirSync(dir)
    fs.copyFileSync(TOOL, path.join(dir, 'build-script-manifest.mjs'))
    fs.writeFileSync(path.join(dir, 'agent-only-mod.sh'), LIB_MODULE)
    const r = run(bare)
    fs.rmSync(bare, { recursive: true, force: true })
    expect(r.exit).toBe(2)
    expect(r.out).toMatch(/COULD NOT RUN.*broken parser/)
  })

  it('COULD-NOT-RUN when there is nothing to walk at all', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-empty-'))
    const dir = path.join(bare, 'scripts')
    fs.mkdirSync(dir)
    fs.copyFileSync(TOOL, path.join(dir, 'build-script-manifest.mjs'))
    const r = run(bare)
    fs.rmSync(bare, { recursive: true, force: true })
    expect(r.exit).toBe(2)
    expect(r.out).toMatch(/COULD NOT RUN/)
  })
})

describe('build-script-manifest — the REAL corpus (the exclusion outcome as data)', () => {
  // The card's box: "internal libs explicitly excluded, and the exclusion list is data the test
  // asserts". The DISCRIMINATOR is pinned above on fixtures; this pins the outcome on the live
  // corpus, so a parser regression that flips a real module shows its name here.
  const KNOWN_INTERNAL = [
    'agent-commands.sh',
    'agent-core.sh',
    'agent-helper.sh',
    'agent-plugin.sh',
    'agent-session.sh',
    'agent-skill.sh',
    'aid-helper.sh',
    'amp-helper.sh',
    'amp-name-resolve.sh',
    'amp-security.sh',
  ]

  it('the committed manifest classifies exactly the known internal libs as excluded', () => {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'script-manifest.json'), 'utf8'))
    expect(Object.keys(m.excluded).sort()).toEqual(KNOWN_INTERNAL)
    // spot checks on the included side — the hand-verified ground truth from the card's STATE
    expect(m.scripts['aimaestro-trdd.sh'].verbs).toContain('verify')
    expect(m.scripts['aimaestro-agent.sh'].verbs).toEqual(expect.arrayContaining(['create', 'wake', 'hibernation']))
    expect(m.scripts['amp-kanban-create-task.sh'].flags).toEqual(expect.arrayContaining(['--parent', '--npt', '--eht']))
    expect(m.counts.walked).toBeGreaterThan(50) // the walk floor: 58 measured at authoring
  })

  it('the committed manifest is CURRENT — `--check` against the live scripts dir is clean', () => {
    const r = spawnSync('node', [TOOL, '--check'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 })
    expect(r.status).toBe(0)
  })
})
