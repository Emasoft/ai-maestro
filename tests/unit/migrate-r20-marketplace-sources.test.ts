/**
 * TRDD-DP2HI2MP — `scripts/migrate_r20_marketplace_sources.py`, the R20 migration's
 * marketplace-source rewrite.
 *
 * Why this file exists. The rewrite used to be an inline `python3 -c` heredoc inside
 * `migrate-r20-disk-layout.sh`, so nothing could test it, and three defects had accumulated
 * behind that: it wrote a source with no `./` prefix (which Claude Code rejects, failing the
 * WHOLE manifest and making every plugin in that marketplace uninstallable); its skip guard
 * tested for a shape the write never produced, so every re-run rewrote the file while the
 * script's own header claimed idempotence; and a non-string source raised AttributeError into
 * a discarded stderr. Extracting it is what makes any of that assertable.
 *
 * A real subprocess, not a port of the logic into TS: the thing shipped and run by an operator
 * is the python file, and a reimplementation would pass while the shipped script was broken.
 *
 * The second-run assertion is the load-bearing one. A test that only checks the WRITTEN VALUE
 * passes with the contradictory guard still in place — the value was always stable, it was the
 * "did anything change" answer that was wrong. And its positive control is the already-correct
 * case: without it, "reports no change" is equally satisfied by a script that never reports one.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'migrate_r20_marketplace_sources.py')

const CHANGED = '[R20] Updated source paths'
const UNCHANGED = '[R20] marketplace.json paths already correct'

let dir: string
let manifest: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-r20-manifest-'))
  manifest = path.join(dir, 'marketplace.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function seed(plugins: unknown[]): void {
  fs.writeFileSync(manifest, JSON.stringify({ name: 'role-plugins', plugins }, null, 2))
}

function run(target: string = manifest) {
  const r = spawnSync('python3', [SCRIPT, target], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function sourcesOf(): unknown[] {
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).plugins.map((p: { source: unknown }) => p.source)
}

describe('migrate_r20_marketplace_sources — the prefix', () => {
  it('rewrites a prefix-less source to the ./ form Claude Code accepts', () => {
    // The exact shape found live on 2026-08-04, which failed `claude plugin validate` with
    // `plugins.N.source: Invalid input` and took the whole manifest down with it.
    seed([{ name: 'scenario-test-agent', source: 'roles-marketplace/scenario-test-agent' }])

    const r = run()

    expect(r.status).toBe(0)
    expect(r.stdout).toContain(CHANGED)
    expect(sourcesOf()).toEqual(['./roles-marketplace/scenario-test-agent'])
  })

  it('rewrites a bare plugin name into the roles-marketplace subdirectory', () => {
    seed([{ name: 'genny-bot', source: 'genny-bot' }])

    expect(run().status).toBe(0)
    expect(sourcesOf()).toEqual(['./roles-marketplace/genny-bot'])
  })

  it('leaves an already-correct source alone and REPORTS no change (the positive control)', () => {
    // Without this case, "a second run reports no change" is satisfied by a script that never
    // reports a change at all.
    seed([{ name: 'luckas-bot', source: './roles-marketplace/luckas-bot' }])

    const r = run()

    expect(r.status).toBe(0)
    expect(r.stdout).toContain(UNCHANGED)
    expect(r.stdout).not.toContain(CHANGED)
    expect(sourcesOf()).toEqual(['./roles-marketplace/luckas-bot'])
  })
})

describe('migrate_r20_marketplace_sources — idempotence', () => {
  it('a SECOND run over its own output is a no-op, in the report as well as the value', () => {
    // This is the defect the value-only assertion cannot see. The old guard tested for
    // `/roles-marketplace/` while writing `roles-marketplace/…` — no `/` before it — so the
    // guard never matched its own output and every re-run rewrote the file and announced a
    // change, on a script whose header promises "IDEMPOTENT — safe to run multiple times".
    seed([{ name: 'scenario-test-agent', source: 'roles-marketplace/scenario-test-agent' }])

    const first = run()
    expect(first.stdout).toContain(CHANGED)

    const before = fs.readFileSync(manifest, 'utf8')
    const second = run()

    expect(second.status).toBe(0)
    expect(second.stdout).toContain(UNCHANGED)
    expect(second.stdout).not.toContain(CHANGED)
    expect(fs.readFileSync(manifest, 'utf8')).toBe(before)
  })

  it('leaves no temp file behind (the write is a replace, not an in-place truncate)', () => {
    seed([{ name: 'genny-bot', source: 'genny-bot' }])

    expect(run().status).toBe(0)

    // An interrupted `open(path,'w')` + `json.dump` truncates the very file whose corruption
    // makes every plugin in the marketplace uninstallable, so the rewrite goes through a temp
    // file + os.replace. Nothing but the manifest may survive the run.
    expect(fs.readdirSync(dir)).toEqual(['marketplace.json'])
  })
})

describe('migrate_r20_marketplace_sources — inputs it must survive rather than mangle', () => {
  it('leaves a non-string (object) source untouched instead of crashing on it', () => {
    // `services/role-plugin-service.ts` legitimately writes `{ source: 'url', url: … }`. The
    // inline version called `.rstrip` on it, raised AttributeError, and the caller discarded
    // stderr — so one object-form entry silently skipped the rewrite for the WHOLE manifest.
    seed([
      { name: 'remote-plugin', source: { source: 'url', url: 'https://example.invalid/x.git' } },
      { name: 'scenario-test-agent', source: 'roles-marketplace/scenario-test-agent' },
    ])

    const r = run()

    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(sourcesOf()).toEqual([
      { source: 'url', url: 'https://example.invalid/x.git' },
      './roles-marketplace/scenario-test-agent',
    ])
  })

  it('fails with the READ reason on stderr when the manifest is not valid JSON', () => {
    // Asserting only a non-zero exit would pass on any failure, including the argument-count
    // check — so the reason is the assertion, not the status.
    fs.writeFileSync(manifest, '{ "plugins": [ ')

    const r = run()

    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/cannot read .*marketplace\.json/)
    expect(r.stdout).toBe('')
  })

  it('fails with a reason when the top level is JSON but not an object', () => {
    // json.load succeeds for a list, a string, a number. `.get('plugins')` on a list would
    // raise AttributeError — the same class of crash defect 3 was.
    fs.writeFileSync(manifest, '[]')

    const r = run()

    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/expected an object/)
  })

  it('fails with a reason when the manifest does not exist', () => {
    const r = run(path.join(dir, 'absent.json'))

    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/cannot read .*absent\.json/)
  })
})
