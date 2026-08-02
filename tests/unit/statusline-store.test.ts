/**
 * The statusline store (TRDD-D8OYFG35).
 *
 * The property that matters most is not "a write lands" — it is **the write goes through
 * `lib/json-io.ts` and can never trip its key-loss tripwire.** `updateJson` REFUSES a mutation that
 * drops a top-level key, so a payload describing a session with no PR and no cost must still write
 * all seven keys (with nulls) rather than omitting them. Get that wrong and ingest starts throwing
 * `KeyLossRefused` for perfectly valid observations, intermittently, only for the sessions that
 * happen to have shed a field since the last tick.
 *
 * ⚠ EVERY TEST RUNS UNDER A TEMP `$HOME`. `statuslineStateDir()` resolves through
 * `statePath()` → `os.homedir()`, which honours `$HOME` on POSIX, and the store deliberately
 * computes the path PER CALL so the redirect works. `vi.resetModules()` is what makes it stick for
 * `ecosystem-constants`. Without both, this file would write into the developer's real
 * `~/.aimaestro/statusline-state/` — and a guard at the end asserts it did not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

let dir: string

/** The real store, which nothing in this file may touch. Read BEFORE $HOME is stubbed. */
const REAL_STORE = join(homedir(), '.aimaestro', 'statusline-state')
const realStoreExistedBefore = existsSync(REAL_STORE)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-statusline-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

async function store() {
  return import('@/lib/statusline-store')
}

/** A minimal but VALID snapshot: every top-level key present, optional sections null. */
function snapshot(sessionId: string, over: Record<string, unknown> = {}) {
  return {
    sessionId,
    capturedAt: 1_700_000_000_000,
    source: 'statusline' as const,
    rateLimits: {
      fiveHour: { usedPercentage: 23.5, resetsAtMs: 1738425600_000, source: 'statusline' as const },
      sevenDay: null,
    },
    session: {
      modelId: 'claude-opus-5',
      modelDisplayName: 'Opus',
      agentName: null,
      sessionName: null,
      version: '2.1.90',
      effortLevel: 'high',
      fastMode: false,
      outputStyle: null,
      cwd: '/tmp/x',
      projectDir: null,
      gitWorktree: null,
      repo: null,
      transcriptPath: null,
      pr: null,
    },
    context: null,
    cost: null,
    ...over,
  }
}

describe('writeStatuslineSnapshot', () => {
  it('lands the record under ~/.aimaestro/statusline-state/<sessionId>.json', async () => {
    const s = await store()
    await s.writeStatuslineSnapshot(snapshot('sess-1') as never)

    const path = join(dir, '.aimaestro', 'statusline-state', 'sess-1.json')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8')).sessionId).toBe('sess-1')
  })

  it('writes ALL SEVEN top-level keys, so json-io has nothing to lose', async () => {
    const s = await store()
    const { STATUSLINE_SNAPSHOT_KEYS } = await import('@/types/statusline')
    await s.writeStatuslineSnapshot(snapshot('sess-keys') as never)

    const raw = JSON.parse(readFileSync(join(dir, '.aimaestro', 'statusline-state', 'sess-keys.json'), 'utf-8'))
    expect(Object.keys(raw).sort()).toEqual([...STATUSLINE_SNAPSHOT_KEYS].sort())
  })

  it('NULLS a section a later tick no longer carries — never stale, never deleted', async () => {
    // Tick 1 has a cost; tick 2 does not. "Always write all seven keys" is what makes BOTH wrong
    // answers unreachable, and they are different bugs:
    //
    //   · DELETE the key   → `updateJson`'s key-loss tripwire throws KeyLossRefused, and a routine
    //     observation is rejected — intermittently, and only for sessions that shed a field.
    //   · SKIP the key     → tick 1's cost survives under tick 2's timestamp. Silent, and worse:
    //     the record now asserts a fact about a moment it does not describe.
    //
    // NEUTER (verified 2026-08-02): `if (snapshot[key] === null) continue` in the mutator reddens
    // exactly this test and the key-set test above — and it reddens on the SKIP branch (stale cost
    // survives), not on KeyLossRefused, because a skip leaves the key present. Both assertions
    // below are therefore load-bearing and they catch different halves.
    const s = await store()
    await s.writeStatuslineSnapshot(
      snapshot('sess-shed', { cost: { totalCostUsd: 1.5, totalDurationMs: 1, totalApiDurationMs: 1, totalLinesAdded: 1, totalLinesRemoved: 1 } }) as never,
    )
    await expect(s.writeStatuslineSnapshot(snapshot('sess-shed') as never)).resolves.toBeUndefined()

    const raw = JSON.parse(readFileSync(join(dir, '.aimaestro', 'statusline-state', 'sess-shed.json'), 'utf-8'))
    expect(raw.cost).toBeNull()
    expect('cost' in raw).toBe(true) // nulled, not deleted — that distinction IS the fix
  })

  it('REFUSES a session id that is not filename-safe, instead of sanitising it', async () => {
    const s = await store()
    await expect(s.writeStatuslineSnapshot(snapshot('../escape') as never)).rejects.toThrow(/invalid statusline session id/)
    // And nothing was written anywhere near the escape target.
    expect(existsSync(join(dir, '.aimaestro', 'escape.json'))).toBe(false)
  })
})

describe('readStatuslineSnapshot', () => {
  it('round-trips a written snapshot', async () => {
    const s = await store()
    await s.writeStatuslineSnapshot(snapshot('rt') as never)
    expect((await s.readStatuslineSnapshot('rt'))?.rateLimits.fiveHour?.resetsAtMs).toBe(1738425600_000)
  })

  it('answers null for an absent session, and does not create the file by asking', async () => {
    const s = await store()
    expect(await s.readStatuslineSnapshot('never-seen')).toBeNull()
    expect(existsSync(join(dir, '.aimaestro', 'statusline-state', 'never-seen.json'))).toBe(false)
  })

  it('answers null — never a throw — for a CORRUPT file', async () => {
    const s = await store()
    await s.writeStatuslineSnapshot(snapshot('corrupt') as never)
    writeFileSync(join(dir, '.aimaestro', 'statusline-state', 'corrupt.json'), '{not json', 'utf-8')
    expect(await s.readStatuslineSnapshot('corrupt')).toBeNull()
  })

  it('answers null for an invalid id without ever building a path from it', async () => {
    const s = await store()
    expect(await s.readStatuslineSnapshot('../../etc/passwd')).toBeNull()
  })
})

describe('listStatuslineSnapshots', () => {
  it('is EMPTY, not an error, before the first ingest has created the directory', async () => {
    const s = await store()
    expect(await s.listStatuslineSnapshots()).toEqual([])
  })

  it('returns every snapshot, newest first', async () => {
    const s = await store()
    await s.writeStatuslineSnapshot(snapshot('old', { capturedAt: 1000 }) as never)
    await s.writeStatuslineSnapshot(snapshot('new', { capturedAt: 9000 }) as never)
    expect((await s.listStatuslineSnapshots()).map((x) => x.sessionId)).toEqual(['new', 'old'])
  })

  it('IGNORES the .tmp / .bak siblings json-io leaves beside the real files', async () => {
    // json-io writes `<path>.tmp.<pid>.<n>` and keeps `<path>.bak.<n>`. Reading those as sessions
    // would double-count every record and invent session ids nobody can query.
    const s = await store()
    await s.writeStatuslineSnapshot(snapshot('real') as never)
    const d = join(dir, '.aimaestro', 'statusline-state')
    writeFileSync(join(d, 'real.json.tmp.999.1'), '{}', 'utf-8')
    writeFileSync(join(d, 'real.json.bak.01'), '{}', 'utf-8')
    expect((await s.listStatuslineSnapshots()).map((x) => x.sessionId)).toEqual(['real'])
  })
})

describe('pruneStatuslineSnapshots — the store must not grow without bound', () => {
  it('drops the OLDEST files once the cap is exceeded, and keeps the newest', async () => {
    const s = await store()
    const d = join(dir, '.aimaestro', 'statusline-state')
    for (const id of ['a', 'b', 'c', 'd']) {
      await s.writeStatuslineSnapshot(snapshot(id) as never)
    }
    // mtime is the ordering key, so pin it rather than relying on write order resolution.
    const t = 1_700_000_000
    utimesSync(join(d, 'a.json'), t + 1, t + 1)
    utimesSync(join(d, 'b.json'), t + 2, t + 2)
    utimesSync(join(d, 'c.json'), t + 3, t + 3)
    utimesSync(join(d, 'd.json'), t + 4, t + 4)

    expect(await s.pruneStatuslineSnapshots(2)).toBe(2)
    expect(existsSync(join(d, 'a.json'))).toBe(false)
    expect(existsSync(join(d, 'b.json'))).toBe(false)
    expect(existsSync(join(d, 'c.json'))).toBe(true)
    expect(existsSync(join(d, 'd.json'))).toBe(true)
  })

  it('does nothing at or below the cap', async () => {
    const s = await store()
    await s.writeStatuslineSnapshot(snapshot('only') as never)
    expect(await s.pruneStatuslineSnapshots(2)).toBe(0)
    expect(existsSync(join(dir, '.aimaestro', 'statusline-state', 'only.json'))).toBe(true)
  })

  it('is a no-op — never a throw — when the directory does not exist', async () => {
    const s = await store()
    await expect(s.pruneStatuslineSnapshots(1)).resolves.toBe(0)
  })
})

describe('containment', () => {
  it('nothing in this file touched the REAL ~/.aimaestro/statusline-state', () => {
    // The positive control for the $HOME redirect: if the stub had failed, every write above would
    // have landed in the developer's real store, and this is the only assertion that could see it.
    expect(existsSync(REAL_STORE)).toBe(realStoreExistedBefore)
    if (realStoreExistedBefore) {
      // It pre-existed; assert we did not add any of our fixture ids to it.
      const { readdirSync } = require('fs') as typeof import('fs')
      const names = readdirSync(REAL_STORE)
      for (const fixture of ['sess-1.json', 'sess-keys.json', 'rt.json', 'real.json', 'a.json']) {
        expect(names, `fixture leaked into the real store: ${fixture}`).not.toContain(fixture)
      }
    }
  })
})
