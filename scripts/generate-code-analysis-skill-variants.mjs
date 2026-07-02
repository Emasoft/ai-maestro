/**
 * Regenerate the per-client tldr-code+fastedit skill variants from the SINGLE
 * canonical Claude source (`scripts/code-analysis-skill/claude/`) using the
 * ai-maestro cross-client converter (`lib/converter/convert.ts`). This is the
 * DRY source of truth for TRDD-ANYCPRTX: the 6 non-Claude variants are
 * machine-generated, never hand-maintained.
 *
 * Node-26 note (fork-verified): a static `import { convert }` fails under Node
 * 26; a dynamic `import()` works. tsx is lean-ctx-blocked, so run via:
 *
 *   TSX_TSCONFIG_PATH="$PWD/tsconfig.json" node --import tsx \
 *     scripts/generate-code-analysis-skill-variants.mjs [--check]
 *
 * `--check` regenerates in-memory and diffs against the committed variants,
 * exiting 1 on drift (for CI) — it writes nothing.
 *
 * Determinism: the frontmatter emitters (codex/gemini/opencode/kiro) inject a
 * `_converted` provenance block with a live date → we STRIP that block so the
 * committed artifact does not churn on every regen. github-copilot + kilocode
 * emit no frontmatter, so they are deterministic by construction.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
const CHECK = process.argv.includes('--check')
const SRC = path.join(REPO, 'scripts/code-analysis-skill/claude')
const STAGE = '/tmp/ca-skill-src-gen'
const OUT_BASE = path.join(REPO, 'scripts/code-analysis-skill')

// providerId → repo output dir name
const MAP = {
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
  kiro: 'kiro',
  'github-copilot': 'copilot',
  kilocode: 'kilocode',
}

/** Strip the `_converted:` provenance block (with its indented children) from a
 *  frontmatter fence so regenerated output is byte-stable across runs. */
function stripProvenance(content) {
  const lines = content.split('\n')
  if (lines[0] !== '---') return content
  const end = lines.indexOf('---', 1)
  if (end === -1) return content
  const out = []
  let skip = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i > 0 && i < end) {
      if (/^_converted:/.test(line)) { skip = true; continue }
      if (skip) {
        if (/^[ \t]+/.test(line) || line === '') continue // indented children / blank within block
        skip = false
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

/** Strip the emitter's client-dir prefix so `file.path` maps to the repo layout. */
function stripPrefix(p) {
  return p
    .replace(/^.*skills\/[^/]+\//, '') // codex/gemini/opencode/kiro → SKILL.md | references/x.md
    .replace(/^\.github\//, '')        // copilot → copilot-instructions.md
    .replace(/^\.kilocode\//, '')      // kilocode → rules/tldr-code.md
}

// Stage the Claude skill in the wrapped `skills/<name>/` layout the parser needs.
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(path.join(STAGE, 'skills/tldr-code'), { recursive: true })
cpSync(path.join(SRC, 'SKILL.md'), path.join(STAGE, 'skills/tldr-code/SKILL.md'))
cpSync(path.join(SRC, 'references'), path.join(STAGE, 'skills/tldr-code/references'), { recursive: true })

const { convert } = await import(path.join(REPO, 'lib/converter/convert.ts'))

let drift = false
let failed = false

for (const [to, dir] of Object.entries(MAP)) {
  const res = await convert({ dir: STAGE, from: 'claude-code', to, elements: ['skills'], scope: 'user', dryRun: true })
  if (!res.ok) {
    console.error(`FAIL ${to}: ${res.error}`)
    failed = true
    continue
  }
  const outRoot = path.join(OUT_BASE, dir)
  if (!CHECK) rmSync(outRoot, { recursive: true, force: true })

  for (const f of res.files) {
    const rel = stripPrefix(f.path)
    const content = stripProvenance(f.content)
    const dest = path.join(outRoot, rel)
    if (CHECK) {
      const cur = existsSync(dest) ? readFileSync(dest, 'utf-8') : null
      if (cur !== content) { drift = true; console.error(`DRIFT ${to}: ${rel}`) }
    } else {
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, content)
    }
  }
  console.log(`${CHECK ? 'checked' : 'OK'} ${to} → ${dir} (${res.files.length} files, ${res.warnings.length} warnings)`)
}

if (failed) process.exit(1)
if (CHECK && drift) { console.error('DRIFT: committed variants differ from the Claude source — re-run the generator.'); process.exit(1) }
console.log(CHECK ? 'no drift' : 'regenerated all 6 client variants from the Claude source')
