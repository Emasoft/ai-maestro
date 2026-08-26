// TRDD-MFTDMSJY — the credential path must never print a `security` argv.
//
// WHY A SOURCE SCAN AND NOT A UNIT TEST. `describeSecurityArgv` has unit tests proving IT is
// leak-proof, and those tests are satisfied by a module that never calls it: a future caller can
// `console.error(argv)` two lines away and nothing goes red. The unit tests pin the HELPER; this
// pins the FILE. Both leaks shipped today were a log line, not a helper.
//
// WHAT MAKES A RAW ARGV LOG A LEAK, both established first-hand on 2026-08-26:
//   - `macosStoreArgv` carries the SECRET on argv (`-w <secret>`), deliberately — the stdin form
//     truncates at 128 bytes via getpass() (TRDD-5539cd6e). `macosRetrieveArgv`'s `-w` is a
//     VALUELESS flag. Same flag, opposite meaning, one function apart.
//   - the ACCOUNT is PII on every call: an email for a slot, `$USER` for the live family
//     (live.ts::keychainAccount), and this output lands in pm2-error.log, whose lines get quoted
//     into PUBLIC GitHub issues.
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const SAFE_STORAGE = path.join(process.cwd(), 'lib/oauth-rotator/safe-storage.ts')

/** Source lines that both LOG and mention `argv`, minus the one sanctioned form. */
function rawArgvLogSites(src: string): string[] {
  return src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /console\.(error|warn|log|info)/.test(line) || /\$\{argv/.test(line))
    .filter(({ line }) => /\bargv\b/.test(line))
    // The ONLY sanctioned way to put argv-derived text in a log.
    .filter(({ line }) => !/describeSecurityArgv\(argv\)/.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`)
}

describe('TRDD-MFTDMSJY — safe-storage must never log a raw `security` argv', () => {
  const src = fs.readFileSync(SAFE_STORAGE, 'utf8')

  // POSITIVE CONTROL. A scan that reports "clean" because it read the wrong file, or because its
  // needle matches nothing, is indistinguishable from a clean file. This proves the scanner can
  // SEE the thing it hunts before any absence is believed.
  it('the detector actually fires on a seeded violation (positive control)', () => {
    const seeded = src.replace(
      'const t0 = Date.now()',
      'const t0 = Date.now()\n  console.error(`leak ${argv.join(" ")}`)',
    )
    expect(seeded).not.toBe(src) // the seed anchored — else the control proves nothing
    expect(rawArgvLogSites(seeded).length).toBeGreaterThan(0)
  })

  it('reads the real module and it is non-trivial (the scan set is not empty)', () => {
    expect(src.length).toBeGreaterThan(5_000)
    expect(src).toContain('export function runSecurity')
  })

  it('logs no argv except through describeSecurityArgv', () => {
    expect(rawArgvLogSites(src)).toEqual([])
  })

  it('the module still routes its slow-op log through the allowlist helper', () => {
    // Guards the complement: a file with NO argv logging at all would pass the test above
    // vacuously, including one where the instrumentation was deleted outright.
    expect(src).toContain('describeSecurityArgv(argv)')
  })
})
