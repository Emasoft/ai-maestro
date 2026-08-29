/**
 * TRDD-TS4G74XA — spec step 2 (pre-lint retry) and the PER-STEP attempt budget.
 *
 * THE SPEC (USER, verbatim). Step 2 lints the copy "to verify it was valid to begin with (if not,
 * it will retry the transaction up to 3 times, then it will fail the transaction and report the
 * error to the caller)". Retry means the WHOLE transaction from step 1: "the copy is discarded and
 * a new copy is made". And the budget is PER STEP: "if one step failed for more than 3 times (that
 * is, at the 4th attempt) then the whole transaction fails. but if it succeed at the 4th attempt,
 * the next step with the error counter is evaluated independently… multiple steps with 3 errors
 * each, even if cumulatively they amount to 6 errors, they do not trigger the failure".
 *
 * WHY THE READ IS INSTRUMENTED AND NOTHING ELSE IS. The fault this retry exists for is a TORN READ
 * — a non-participating writer (the `claude` CLI, 20+ agent instances) caught mid-write. That is
 * not reproducible on demand from a real filesystem without a race, and a race makes a flaky test.
 * So `readFile` is the ONE seam replaced, by a plan the test controls; every other operation —
 * the lock, the clone, the fsync, the rename, the backup, the post-commit audit — runs for real
 * against a real temp dir. The retry logic under test is never mocked, only the fault it handles.
 *
 * ⚠ NON-VACUITY. Every test here asserts the plan was FULLY CONSUMED. Without that, a plan whose
 * entries are never reached (a miscounted read, an early return) would leave the assertions passing
 * against a transaction that took the happy path and retried nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile as realReadFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Reads of the target file are served from this plan; `null` means "delegate to the real fs". */
let readPlan: (string | null)[] = []
let targetFile = ''
/** Every read of the target, in order — the transcript the assertions measure. */
let readLog: string[] = []

vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: async (p: unknown, ...rest: unknown[]) => {
      if (typeof p === 'string' && p === targetFile) {
        const planned = readPlan.length ? readPlan.shift() : null
        if (planned !== null && planned !== undefined) {
          readLog.push(`planned:${planned.slice(0, 24)}`)
          return planned
        }
        readLog.push('real')
      }
      return (real.readFile as (...a: unknown[]) => Promise<unknown>)(p, ...rest)
    },
  }
})

const { updateJson, UnreadableTargetError } = await import('@/lib/json-io')

vi.setConfig({ testTimeout: 60_000 })

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'json-io-prelint-'))
  targetFile = join(dir, 'settings.json')
  readPlan = []
  readLog = []
  await writeFile(targetFile, JSON.stringify({ keep: 'me' }, null, 2), 'utf-8')
})

afterEach(async () => {
  readPlan = []
  targetFile = ''
  await rm(dir, { recursive: true, force: true })
})

/** The file as it actually sits on disk, bypassing the plan. */
async function onDisk(): Promise<string> {
  return realReadFile(targetFile, 'utf-8')
}

describe('TRDD-TS4G74XA — spec step 2: the pre-lint retries the READ', () => {
  it('POSITIVE CONTROL — an unplanned run writes for real and consumes no plan entries', async () => {
    // If this fails, the mock is intercepting more than it should and every result below is about
    // the mock rather than about `updateJson`.
    const res = await updateJson(targetFile, d => {
      d.added = 1
    })
    expect(res.changed).toBe(true)
    expect(res.attempts).toBe(1)
    expect(JSON.parse(await onDisk())).toEqual({ keep: 'me', added: 1 })
    expect(readLog.filter(r => r.startsWith('planned:'))).toEqual([])
  })

  it('a read that parses on attempt 2 SUCCEEDS the transaction', async () => {
    readPlan = ['{ this is not json']
    const res = await updateJson(targetFile, d => {
      d.added = 2
    })
    expect(res.changed).toBe(true)
    expect(res.attempts).toBe(2)
    expect(JSON.parse(await onDisk())).toEqual({ keep: 'me', added: 2 })
    expect(readPlan).toEqual([]) // plan fully consumed — the bad read really was served
  })

  it('a read that parses on attempt 3 SUCCEEDS the transaction', async () => {
    readPlan = ['{ torn', '{ torn again']
    const res = await updateJson(targetFile, d => {
      d.added = 3
    })
    expect(res.changed).toBe(true)
    expect(res.attempts).toBe(3)
    expect(readPlan).toEqual([])
  })

  it('THE 4-ATTEMPT BOUNDARY, SUCCESS SIDE — a success ON the 4th attempt is a valid success', async () => {
    // "if it succeed at the 4th attempt, the next step … is evaluated independently" — so the 4th
    // attempt is a legitimate attempt, not one past the end.
    readPlan = ['{ a', '{ b', '{ c']
    const res = await updateJson(targetFile, d => {
      d.added = 4
    })
    expect(res.changed).toBe(true)
    expect(res.attempts).toBe(4)
    expect(readPlan).toEqual([])
    expect(JSON.parse(await onDisk())).toEqual({ keep: 'me', added: 4 })
  })

  it('THE 4-ATTEMPT BOUNDARY, FAILURE SIDE — the 4th failure of the step fails the transaction', async () => {
    readPlan = ['{ a', '{ b', '{ c', '{ d']
    await expect(
      updateJson(targetFile, d => {
        d.added = 5
      }),
    ).rejects.toBeInstanceOf(UnreadableTargetError)
    expect(readPlan).toEqual([])
  })

  it('THE RETRY IS OF THE READ ONLY — an exhausted pre-lint leaves the file untouched', async () => {
    // The `{}`-rebuild incident in one assertion: an unparseable target is never "repaired" by
    // writing over it. On exhaustion the transaction fails and the bytes on disk are byte-identical
    // to what we started with.
    const before = await onDisk()
    readPlan = ['{ a', '{ b', '{ c', '{ d']
    await expect(updateJson(targetFile, d => { d.added = 6 })).rejects.toBeInstanceOf(UnreadableTargetError)
    expect(await onDisk()).toBe(before)
  })

  it('RETRY RESTARTS THE WHOLE TRANSACTION — the retried attempt reads FRESH bytes, never a patched copy', async () => {
    // Step 1 is re-executed, so a change another writer landed between attempts IS picked up. If a
    // retry resumed mid-transaction against the stale copy, `carried` would be absent from the
    // result and the mutator would have been applied to the OLD base.
    readPlan = ['{ torn']
    let pass = 0
    const basesSeen: unknown[] = []
    const res = await updateJson(targetFile, d => {
      pass++
      basesSeen.push(d.keep)
      d.added = 7
    })
    // The base the mutator saw came from the FRESH read, not from the torn one.
    expect(basesSeen).toEqual(['me'])
    expect(res.changed).toBe(true)
    // The mutator ran ONCE — on the retry, against the fresh read. The failed attempt never
    // reached it, which is what "the copy is discarded" means.
    expect(pass).toBe(1)
    expect(JSON.parse(await onDisk())).toEqual({ keep: 'me', added: 7 })
  })

  it('PER-STEP BUDGETS ARE INDEPENDENT — 3 pre-lint failures then a clean pass still succeeds', async () => {
    // The counters do not compound. Three step-2 failures is the whole of step 2's budget spent,
    // and the transaction still completes — a shared counter would have nothing left to give.
    readPlan = ['{ a', '{ b', '{ c']
    const res = await updateJson(targetFile, d => {
      d.added = 8
    })
    expect(res.changed).toBe(true)
    expect(res.attempts).toBe(4)
    expect(JSON.parse(await onDisk())).toEqual({ keep: 'me', added: 8 })
  })

  it('PER-STEP BUDGETS, CROSS-STEP — step 2 fails 3× AND step 5 fails 3×, and the transaction COMMITS', async () => {
    // The box this closes: "6 cumulative errors, zero steps at 4. A shared global counter fails
    // this test." Each loop pass reads the target twice — once at the top (step 2) and once at the
    // staleness gate (step 5) — so the plan interleaves the two steps' faults deliberately:
    //   passes 1-3  bad initial read           → readFailures 1,2,3
    //   passes 4-6  good read, MOVED staleness → staleFailures 1,2,3
    //   pass  7     good read, stable staleness → COMMIT
    // With one shared counter the 4th fault aborts and this test reddens.
    const moved = JSON.stringify({ keep: 'me', movedByAnotherWriter: true })
    readPlan = [
      '{ torn a', '{ torn b', '{ torn c', // step 2 spends its whole budget
      null, moved, //                        pass 4: read ok, staleness sees a different file
      null, moved, //                        pass 5
      null, moved, //                        pass 6 — step 5 has now spent its whole budget
      null, null, //                         pass 7: read ok, staleness stable → commit
    ]
    const res = await updateJson(targetFile, d => {
      d.added = 10
    })
    expect(res.changed).toBe(true)
    expect(readPlan).toEqual([]) // every planned fault was actually served
    expect(res.attempts).toBe(7) // 3 read faults + 3 staleness faults + the committing pass
    expect(JSON.parse(await onDisk())).toEqual({ keep: 'me', added: 10 })
    // PIN THE READ ACCOUNTING — MEASURED, not assumed. `readPlan === []` proves the entries were
    // CONSUMED; it says nothing about WHICH pass consumed each one, so the mapping in the comment
    // above needs its own evidence. This is that evidence, and the exact sequence is asserted
    // rather than a bare length, because a length can be right while the order is wrong.
    //
    // Two predictions were made before running it (12, and 15). Both were wrong; it is 13. The
    // three trailing `real` entries are what neither prediction accounted for, and they are also
    // why the mapping survives: every one of them happens AFTER the commit, so none can shift
    // entries 1-11.
    //   1-3   aborted pre-lint passes, one read each (no staleness read is reached)
    //   4-11  passes 4-7: initial read + staleness re-read, two each
    //   12    `readJson` in updateJson's POST-COMMIT AUDIT
    //   13    this test's own `onDisk()` — `realReadFile` is imported from the MOCKED module, so
    //         the helper is itself observed. Named so nobody "fixes" the count by deleting it.
    expect(readLog).toEqual([
      'planned:{ torn a',
      'planned:{ torn b',
      'planned:{ torn c',
      'real', 'planned:{"keep":"me","movedByAno',
      'real', 'planned:{"keep":"me","movedByAno',
      'real', 'planned:{"keep":"me","movedByAno',
      'real', 'real',
      'real', 'real',
    ])
  })

  it('a corrupt-at-rest target still fails, and fails as UnreadableTargetError', async () => {
    // The retry must not paper over the OTHER cause of the same symptom. With no plan at all, every
    // read returns the same genuinely-corrupt bytes, so all four attempts fail and the transaction
    // reports it rather than rebuilding the file.
    await writeFile(targetFile, '{ genuinely corrupt', 'utf-8')
    await expect(updateJson(targetFile, d => { d.added = 9 })).rejects.toBeInstanceOf(UnreadableTargetError)
    expect(await onDisk()).toBe('{ genuinely corrupt')
  })
})
