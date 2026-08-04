/**
 * TRDD-2U56TLBX — the ratchet. No AMP script may capture an http-code curl into a variable
 * without suspending `set -e` for that assignment.
 *
 * WHY A STRUCTURAL GUARD AND NOT SIX MORE BEHAVIOURAL TESTS. The mechanism is already pinned
 * behaviourally in `amp-network-failure.test.ts` for `amp-fetch.sh` and `amp-send.sh`. What
 * those cannot do is cover the other eleven sites, for two reasons:
 *
 *   1. The kanban scripts REFUSE to run without a resolvable AMP identity, and their refusal
 *      says in as many words not to pass an arbitrary `--id` — every registered uuid belongs
 *      to a real, possibly live agent. That guard is correct and must not be subverted for a
 *      test, so those six are not drivable in a contained fixture at all.
 *   2. `amp-helper.sh`'s six sites are inside the attachment upload/download path, reachable
 *      only through a full signed send with a real provider.
 *
 * So the honest instrument for the rest is the one that reads the source. It also outlives
 * the individual sites: it covers every FUTURE curl anyone adds to these scripts, which is
 * the actual failure this card is about — the trap is invisible at the call site, so the next
 * person will reintroduce it.
 *
 * THE BUG IT PINS. Under `set -e`, `VAR=$(cmd)` takes the whole script down with `cmd`'s exit
 * status. A curl that cannot connect exits 7, so the script dies AT THE ASSIGNMENT and every
 * `HTTP_CODE = "000"` branch below it is unreachable dead code. There is no ERR trap in any
 * of these scripts, so the caller gets a bare `exit 7` and no output whatsoever.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts')

interface Site {
  file: string
  line: number
  guarded: boolean
  text: string
}

/**
 * Find `VAR=$(curl … -w "…%{http_code}" …)` assignments and decide whether `set -e` is
 * suspended for each.
 *
 * "Guarded" means ANY of: a trailing `||`/`&&` on the statement, one INSIDE the substitution
 * (`$(curl … || echo '{}')` is a real guard), or the assignment used as an `if`/`while`
 * condition. All three genuinely suspend `set -e`; a classifier that knew only the first
 * would report already-correct code as broken.
 */
function scan(file: string): Site[] {
  const lines = fs.readFileSync(path.join(SCRIPTS, file), 'utf8').split('\n')
  const out: Site[] = []

  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:if\s+|while\s+|local\s+)?[A-Za-z_][A-Za-z0-9_]*=\$\(\s*curl\b/.test(lines[i])) continue

    // Walk to the line that closes the `$(`, by paren depth.
    let depth = 0
    let end = i
    outer: for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      for (const ch of lines[j]) {
        if (ch === '(') depth++
        else if (ch === ')' && --depth === 0) { end = j; break outer }
      }
    }

    const span = lines.slice(i, end + 1).join('\n')
    if (!span.includes('%{http_code}')) continue // a different family — see the card's phase 3

    out.push({
      file,
      line: i + 1,
      guarded: span.includes('||') || span.includes('&&') || /^\s*(if|while)\s/.test(lines[i]),
      text: lines[i].trim().slice(0, 60),
    })
  }
  return out
}

const ampScripts = fs.readdirSync(SCRIPTS).filter((f) => f.startsWith('amp-') && f.endsWith('.sh'))
const sites = ampScripts.flatMap(scan)

describe('no AMP script dies at a curl assignment before its own error handler (TRDD-2U56TLBX)', () => {
  it('the scan set is real — a broken scanner must FAIL here, not report a clean sweep', () => {
    // The floor that makes every assertion below non-vacuous. A regex that silently stopped
    // matching would otherwise report zero unguarded sites and read as a pass.
    //
    // MEASURED 2026-08-04 by running this exact scan: 31 amp-*.sh scripts, 20 http-code curl
    // sites. The floors sit below those so ordinary edits do not trip them, and far above
    // zero. (The first version of this comment carried 20/13 — numbers I wrote down without
    // running the scan. Re-derived here through the code that BUILDS the set, which is the
    // only count that means anything.)
    expect(ampScripts.length, 'no amp-*.sh scripts found — wrong directory?').toBeGreaterThan(25)
    expect(sites.length, 'the http-code curl scan found (almost) nothing — the regex broke')
      .toBeGreaterThan(15)
  })

  it('POSITIVE CONTROL: the classifier can actually say "unguarded"', () => {
    // Without this, every assertion in this file is satisfied by a classifier hard-wired to
    // return guarded=true. Seeded against a real, known-guarded neighbour so both verdicts
    // are exercised on the same code path.
    const tmp = path.join(SCRIPTS, `.ratchet-control-${process.pid}.sh`)
    try {
      fs.writeFileSync(
        tmp,
        [
          'BAD=$(curl -s -w "\\n%{http_code}" \\',
          '    -X GET "$URL")',
          '',
          'OK=$(curl -s -w "\\n%{http_code}" \\',
          '    -X GET "$URL") || true',
          '',
        ].join('\n'),
      )
      const control = scan(path.basename(tmp))
      expect(control.map((s) => s.guarded), 'the classifier cannot distinguish the two forms')
        .toEqual([false, true])
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  })

  it('every http-code curl assignment suspends set -e', () => {
    const unguarded = sites.filter((s) => !s.guarded).map((s) => `${s.file}:${s.line}  ${s.text}`)

    expect(
      unguarded,
      'These capture curl into a variable under `set -e`, so a network failure kills the\n' +
        'script AT THE ASSIGNMENT and the HTTP_CODE branch below is unreachable dead code —\n' +
        'a bare `exit 7` with no diagnostic. Append `|| true` (curl still writes 000 through\n' +
        '-w, so the existing branch reports honestly), and check whether the script\'s own\n' +
        'SUMMARY would also misreport — amp-fetch.sh additionally announced an empty inbox.\n' +
        'See TRDD-2U56TLBX.\n  ' +
        unguarded.join('\n  '),
    ).toEqual([])
  })
})
