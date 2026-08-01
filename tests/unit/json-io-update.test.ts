/**
 * TRDD-RYFP030K — `updateJson`, the settings gate's read-modify-write contract.
 *
 * WHAT THIS IS DEFENDING. `loadJsonSafe(p)` then `saveJsonSafe(p, obj)` are TWO calls, so no
 * baseline travels between them: nothing can tell whether the file changed in the gap, and the
 * second write silently discards the other writer's change. The 33 read-modify-write call sites in
 * this server can already race each other IN-PROCESS today. `updateJson` closes that by running the
 * mutator inside the lock, against bytes it just read, and re-checking those bytes immediately
 * before the commit.
 *
 * WHY THESE TESTS TOUCH THE REAL FILESYSTEM. Every property here — atomic rename, fsync, lockdir
 * exclusion, backup pruning — IS filesystem behaviour. A mocked `writeFile` is a no-op, so a suite
 * built on one cannot discriminate a working gate from a gate that writes nothing; it would assert
 * the mock. Each test gets its own `mkdtemp` dir and removes it, so nothing leaks into the
 * developer's home (the module has no home-relative paths of its own — every path is a parameter).
 *
 * ⚠ NON-VACUITY. The concurrency tests below would pass trivially against an implementation that
 * simply serialised everything and lost nothing by accident, so each one names the neuter that reds
 * it. Recorded neuter runs are in the TRDD; the short version:
 *   - drop the `withJsonLock` wrapper in `updateJson`  → "concurrent writers do not lose each other's keys"
 *   - store `prev.then(...)` instead of `mine`          → "the in-process queue drains"
 *   - drop the `held?.has(filePath)` early return       → "a nested updateJson on the same file does not self-deadlock"
 *   - drop the `padStart` in `keepBackup`               → "pruning keeps the MOST RECENT backups"
 *   - drop the `lost.length` tripwire                   → "a rebuilt minimal object is refused"
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import {
  updateJson,
  KeyLossRefused,
  UnreadableTargetError,
  _inProcessQueueSizeForTests,
  _setAtomicWriteCounterForTests,
} from '@/lib/json-io'

// A neutered lock does not hang — it waits out `maxWaitMs` and throws — but the default is 20s per
// attempt, so a neuter run needs headroom the 5s default does not give.
vi.setConfig({ testTimeout: 60_000 })

let dir: string
let file: string

/** Every backup this module writes for `file`, oldest-name-first. */
async function backupsOf(target: string): Promise<string[]> {
  const prefix = `${basename(target)}.aim-bak-`
  return (await readdir(dirname(target))).filter(f => f.startsWith(prefix)).sort()
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true } catch { return false }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aim-json-io-'))
  file = join(dir, 'settings.json')
  await writeFile(file, JSON.stringify({ seed: 'original' }, null, 2) + '\n', 'utf-8')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('updateJson — concurrency', () => {
  it('concurrent writers do not lose each other\'s keys', async () => {
    const N = 12
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        updateJson(file, d => { d[`k${i}`] = i }),
      ),
    )

    const after = JSON.parse(await readFile(file, 'utf-8'))
    // The whole point: every writer's key survives, and so does the key none of them touched.
    for (let i = 0; i < N; i++) expect(after[`k${i}`]).toBe(i)
    expect(after.seed).toBe('original')

    // POSITIVE CONTROL. Without it, "every key is present" is also satisfied by an implementation
    // that never wrote at all and returned a cached object — these assert real commits happened.
    expect(results.every(r => r.changed)).toBe(true)
    expect(results.every(r => r.auditOk)).toBe(true)
  })

  it('one throwing mutator does not poison the other writers or the file', async () => {
    const N = 8
    const POISON = 3
    const settled = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        updateJson(file, d => {
          if (i === POISON) throw new Error('mutator exploded')
          d[`k${i}`] = i
        }),
      ),
    )

    expect(settled[POISON].status).toBe('rejected')
    expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(N - 1)

    // The file must still be VALID JSON — a throw between the tmp write and the rename that left a
    // half-file behind would surface here and nowhere else.
    const after = JSON.parse(await readFile(file, 'utf-8'))
    for (let i = 0; i < N; i++) {
      if (i === POISON) expect(after).not.toHaveProperty(`k${i}`)
      else expect(after[`k${i}`]).toBe(i)
    }
    expect(after.seed).toBe('original')
  })

  it('the in-process queue drains, and no lockdir or tmp file is left behind', async () => {
    await Promise.allSettled([
      updateJson(file, d => { d.a = 1 }),
      updateJson(file, d => { d.b = 2 }),
      updateJson(file, () => { throw new Error('boom') }),
    ])

    // A leaked entry per path is an unbounded map for the life of the process, and it is the only
    // observable tell for storing a DERIVED promise instead of `mine` (the identity compare in the
    // cleanup then never matches). Behaviour alone cannot distinguish the two.
    expect(_inProcessQueueSizeForTests()).toBe(0)

    expect(await exists(`${file}.lock`)).toBe(false)
    const leftovers = (await readdir(dir)).filter(f => f.includes('.tmp.'))
    expect(leftovers).toEqual([])
  })

  it('a nested updateJson on the same file does not self-deadlock, and both mutations land', async () => {
    // The reentrancy case: a pipeline that read-modify-writes the same settings file twice through a
    // nested helper. Without the held-set early return the inner call waits on the lock its OWN call
    // chain holds, times out, and throws — a deadlock that appears only under nesting.
    const outer = await updateJson(
      file,
      async d => {
        d.fromOuter = true
        await updateJson(file, inner => { inner.fromInner = true }, { maxWaitMs: 1_000 })
      },
      { maxWaitMs: 1_000 },
    )

    const after = JSON.parse(await readFile(file, 'utf-8'))
    expect(after.fromOuter).toBe(true)
    expect(after.fromInner).toBe(true)
    expect(after.seed).toBe('original')

    // EXACTLY 2, and the number is the documentation. The inner call commits to disk while the outer
    // still holds an older `rawBefore`, so the outer's staleness gate correctly refuses to clobber it
    // and re-reads. On the second pass the inner mutation is already present and is a no-op, the
    // bytes match, and the outer commits. Convergence-by-retry is the designed behaviour here, not a
    // wasted attempt — asserting `>= 1` would hide a regression to "the outer silently clobbers".
    expect(outer.attempts).toBe(2)
  })
})

describe('updateJson — backups', () => {
  it('pruning keeps the MOST RECENT backups, not merely the right number of them', async () => {
    // 13 writes inside one second, so the second-precision stamp is identical across them and the
    // ordering rests entirely on the counter. Unpadded, "10" sorts before "2" and the prune discards
    // the middle of the range while retaining the oldest.
    //
    // ⚠ THE PIN IS WHAT MAKES THIS TEST DISCRIMINATE. The counter is module-global and shared with
    // tmp filenames, so by the time this test runs it is already past 40 — thirteen 2-digit counters
    // that sort correctly whether or not the padding is there. Measured: without this line the test
    // passed with the padding DELETED. Pinned to 5, the run spans 6..18 and straddles 9 → 10, which
    // is the only boundary where padding changes anything.
    _setAtomicWriteCounterForTests(5)
    const taken: string[] = []
    for (let i = 0; i < 13; i++) {
      const r = await updateJson(file, d => { d.n = i })
      expect(r.backupPath).not.toBeNull()
      taken.push(r.backupPath as string)
    }

    expect(await backupsOf(file)).toHaveLength(10)
    // The three oldest are gone and the ten newest survive — which is the guarantee "recoverable
    // from a kept backup" actually depends on. A count-only assertion passes either way.
    for (const gone of taken.slice(0, 3)) expect(await exists(gone)).toBe(false)
    for (const kept of taken.slice(3)) expect(await exists(kept)).toBe(true)
  })

  it('the backup holds the bytes that were replaced, not the bytes that replaced them', async () => {
    const r = await updateJson(file, d => { d.added = 'new' })
    const backed = JSON.parse(await readFile(r.backupPath as string, 'utf-8'))
    expect(backed).toEqual({ seed: 'original' })
    expect(backed).not.toHaveProperty('added')
  })
})

describe('updateJson — refusals', () => {
  it('a rebuilt minimal object is refused instead of silently wiping the file', async () => {
    // The 2026-07-07 shape that wiped a 57.8 KB config: the caller builds a fresh minimal object
    // instead of mutating in place.
    await expect(
      updateJson(file, d => { for (const k of Object.keys(d)) delete d[k]; d.only = 'mine' }),
    ).rejects.toBeInstanceOf(KeyLossRefused)

    // Refused means REFUSED — the file is untouched, not partially written.
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({ seed: 'original' })
  })

  it('a mutator that RETURNS an object is refused, because its change would vanish silently', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateJson(file, (() => ({ rebuilt: true })) as any),
    ).rejects.toBeInstanceOf(TypeError)
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({ seed: 'original' })
  })

  it('an unparseable target is refused rather than rebuilt from {}', async () => {
    await writeFile(file, '{ this is not json', 'utf-8')
    await expect(updateJson(file, d => { d.x = 1 })).rejects.toBeInstanceOf(UnreadableTargetError)
    // The corrupt bytes are still there. Overwriting them is the destructive half of the incident
    // this module exists to prevent — the readable half is answering `{}` to an unreadable file.
    expect(await readFile(file, 'utf-8')).toBe('{ this is not json')
  })

  it('a missing target is refused unless the caller opts in to creating it', async () => {
    const missing = join(dir, 'nope.json')
    await expect(updateJson(missing, d => { d.x = 1 })).rejects.toThrow(/does not exist/)
    expect(await exists(missing)).toBe(false)

    const r = await updateJson(missing, d => { d.x = 1 }, { createIfMissing: true })
    expect(r.changed).toBe(true)
    expect(r.backupPath).toBeNull() // nothing existed to back up
    expect(JSON.parse(await readFile(missing, 'utf-8'))).toEqual({ x: 1 })
  })

  it('createIfMissing creates the parent directory too, not just the file', async () => {
    // The migration of `element-management-service`'s call sites off `saveJsonSafe` (which always
    // mkdir'd) depends on this: an agent's `<workdir>/.claude/` does not exist on first run, and a
    // `createIfMissing` that cannot create the directory is a promise this function only keeps when
    // someone else happened to make the directory first.
    //
    // ⚠ THE MKDIR THAT MAKES THIS WORK IS IN `acquireLock`, NOT in `updateJson` — the lockdir lives
    // beside the target, so taking the lock necessarily creates the parent first. That is why
    // `updateJson` has no mkdir of its own and MUST NOT GROW ONE: I added exactly that during this
    // migration and the neuter reddened nothing, because the lock had already done the work.
    // Neuter that pins this: delete `mkdir(dirname(filePath))` in `acquireLock` → ONLY this test
    // reds (the other 11 stay green, so nothing else covers it).
    const nested = join(dir, 'fresh-agent', '.claude', 'settings.local.json')
    expect(await exists(join(dir, 'fresh-agent'))).toBe(false)

    const r = await updateJson(nested, d => { d.enabledPlugins = { 'a@b': true } }, { createIfMissing: true })
    expect(r.changed).toBe(true)
    expect(JSON.parse(await readFile(nested, 'utf-8'))).toEqual({ enabledPlugins: { 'a@b': true } })
  })

  it('RE-RUNS the mutator when a non-participating writer lands mid-write', async () => {
    // THE PREMISE BEHIND `staged` / `committed` IN element-management-service (TRDD-RYFP030K).
    // Three call sites there record R51 undo state while mutating, and they stage it into a local
    // that RESETS on each attempt rather than pushing into the shared ledger — which is only
    // correct, and only necessary, because the mutator can run more than once. Nothing else states
    // that contract, so removing it there would look like harmless simplification.
    //
    // The mutator performs the foreign write itself: it runs inside the lock, and a bare `writeFile`
    // is precisely a writer that never took that lock (the `claude` CLI is the real one).
    const attempts: string[] = []
    let foreignWritten = false

    const r = await updateJson(file, async d => {
      attempts.push('attempt')
      if (!foreignWritten) {
        foreignWritten = true
        await writeFile(file, JSON.stringify({ seed: 'original', theirs: 1 }, null, 2) + '\n', 'utf-8')
      }
      d.mine = true
    })

    expect(attempts.length, 'the mutator ran once — the staleness gate never fired, so this test proves nothing').toBeGreaterThan(1)
    expect(r.attempts).toBeGreaterThan(1)

    // AND NO LOST UPDATE: the re-run re-applies our change to THEIR bytes, so both survive. A gate
    // that retried but re-applied to the stale base would still show `mine` and would have silently
    // dropped `theirs` — which is the failure the retry exists to prevent, not merely the retry.
    const final = JSON.parse(await readFile(file, 'utf-8'))
    expect(final.theirs).toBe(1)
    expect(final.mine).toBe(true)
  })

  it('a no-op mutation writes nothing and takes no backup', async () => {
    const before = await backupsOf(file)
    const r = await updateJson(file, d => { d.seed = 'original' })
    expect(r.changed).toBe(false)
    expect(r.backupPath).toBeNull()
    expect(await backupsOf(file)).toEqual(before)
  })
})
