// TRDD-ARY3NRFC family guard — no bash-4-only constructs in shipped shell scripts.
//
// WHY a static guard when cli-help-exit-contract already spawns every CLI: that test runs
// under whatever `bash` PATH resolves, so on a homebrew-bash machine it is GREEN over a
// script that dies on every /bin/bash-3.2 machine — the defect is environment-shaped and
// the behavioural test only sees it on the environments that already suffer it. Measured
// twice in one day: `local -n` in common.sh (fixed f244b155) and `declare -g` + a second
// nameref in agent-helper.sh — the first sweep searched ONE spelling of the family and went
// blind to the others (the name-keyed-detector lesson, literally). This guard names the
// FAMILY, per pattern, so a new spelling must be added here deliberately.
//
// Comment lines are excluded — the fixes' own WHY-comments name the forbidden constructs in
// prose (a detector that fires on the documentation of the bug it hunts gets deleted).
//
// POSITIVE CONTROL: each pattern is proven against a synthetic hit inside the same scan
// function, so a broken regex reads as a red control, never as a clean corpus.

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')

/** Every construct that dies (or silently misbehaves) under macOS /bin/bash 3.2. */
const BASH4ISMS: { name: string; re: RegExp }[] = [
  { name: 'nameref (local -n / declare -n)', re: /\b(?:local|declare)\s+(-[a-zA-Z]*n[a-zA-Z]*)\s/ },
  { name: 'declare -g', re: /\bdeclare\s+(-[a-zA-Z]*g[a-zA-Z]*)\s/ },
  { name: 'associative array (declare -A / local -A)', re: /\b(?:local|declare)\s+(-[a-zA-Z]*A[a-zA-Z]*)\s/ },
  { name: 'mapfile / readarray', re: /\b(?:mapfile|readarray)\b/ },
  { name: 'case-conversion expansion (${x,,} / ${x^^})', re: /\$\{[A-Za-z_][A-Za-z0-9_]*(?:,,|\^\^)/ },
]

function listShippedScripts(): string[] {
  const dirs = [path.join(REPO, 'scripts'), path.join(REPO, 'scripts', 'shell-helpers')]
  const out: string[] = []
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.sh') && fs.statSync(path.join(d, f)).isFile()) out.push(path.join(d, f))
    }
  }
  return out.sort()
}

/** Scan one script's NON-COMMENT lines for the family. Returns `file:line pattern` hits. */
function scanText(text: string, label: string): string[] {
  const hits: string[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*#/.test(line)) continue // prose about the bug is not the bug
    for (const p of BASH4ISMS) {
      if (p.re.test(line)) hits.push(`${label}:${i + 1} ${p.name}`)
    }
  }
  return hits
}

describe('no bash-4isms in shipped shell scripts (ARY3NRFC family)', () => {
  it('POSITIVE CONTROL: every pattern catches a synthetic hit (and skips it as a comment)', () => {
    const synthetic = [
      'local -n out_ref="$1"',
      'declare -gx RESOLVED=""',
      'declare -A seen=()',
      'readarray -t rows < "$f"',
      'echo "${name,,}"',
    ].join('\n')
    const hits = scanText(synthetic, 'ctl')
    expect(hits).toHaveLength(5)
    // the same lines commented out must NOT match — the comment filter is load-bearing
    const commented = synthetic
      .split('\n')
      .map((l) => `# ${l}`)
      .join('\n')
    expect(scanText(commented, 'ctl')).toHaveLength(0)
  })

  it('the shipped corpus is clean, and the corpus is non-trivially large', () => {
    const files = listShippedScripts()
    // Non-vacuity: the walk found the real corpus (48+ skill-facing CLIs + helpers), not an
    // empty directory read as "clean".
    expect(files.length).toBeGreaterThan(30)
    const hits = files.flatMap((f) => scanText(fs.readFileSync(f, 'utf8'), path.relative(REPO, f)))
    expect(hits).toEqual([])
  })
})
