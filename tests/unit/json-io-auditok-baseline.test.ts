import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TRDD-HF2DY4VT — the audit-mismatch BASELINE: what `updateJson` returns, and what the callers
 * that spread it therefore emit, when the post-commit audit disagrees.
 *
 * This card asks whether `success: true` beside `auditOk: false` is an honest response. That
 * question cannot be settled against a path nobody has ever executed, so this file makes the
 * mismatch REACHABLE and pins today's behaviour verbatim as the baseline the decision is measured
 * against. It asserts NO opinion about what the answer should be — options 1/2/3 are the USER's,
 * and whichever lands will change these expectations deliberately, with this file as the record of
 * what it changed FROM.
 *
 * HOW THE MISMATCH IS FORCED. `updateJson` writes a tmp file, `rename`s it over the target, then
 * re-reads and compares (`json-io.ts:427`). A real non-participating writer — the `claude` CLI,
 * which takes no lock of ours — can land in exactly that window. We simulate that writer at its
 * narrowest: wrap `rename` so the real rename happens and then one extra key is written to the
 * target, which is what the audit read then sees. Nothing about `updateJson` is stubbed; the
 * write, the lock, the backup and the audit all run for real.
 *
 * NEUTER — AND THE FIRST ONE RECORDED FOR THIS FILE WAS A TAUTOLOGY. Flipping the injection flag
 * off inside the test reddens the mismatch case, but that only proves the injection is
 * load-bearing for the injection; it says nothing about whether these assertions are pinned to the
 * audit comparison at `json-io.ts:427`. The real neuters mutate THAT line, and they come in a pair
 * with DISJOINT red sets, which is what proves each assertion is doing its own work:
 *   `const auditOk = true`  → reds ONLY the BASELINE case      (the mismatch is no longer detected)
 *   `const auditOk = false` → reds ONLY the POSITIVE CONTROL   (agreement is no longer reported)
 * Either mutation alone leaves the other case green, so neither assertion can be deleted without a
 * neuter noticing. Measured 2026-08-29; three json-io files run together 18/18, so the
 * `fs/promises` mock does not leak into the sibling suites that share this module.
 */

const mismatchAfterRename = { active: false }

vi.mock('fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('fs/promises')>()
  return {
    ...real,
    rename: async (from: string, to: string) => {
      await real.rename(from, to)
      if (mismatchAfterRename.active) {
        // The non-participating writer, landing between the swap and the audit read.
        const now = JSON.parse(await real.readFile(to, 'utf-8'))
        now.writtenByAnotherProcess = true
        await real.writeFile(to, JSON.stringify(now, null, 2), 'utf-8')
      }
    },
  }
})

let dir: string
let file: string

beforeEach(async () => {
  mismatchAfterRename.active = false
  dir = await mkdtemp(join(tmpdir(), 'auditok-baseline-'))
  file = join(dir, 'settings.json')
  await writeFile(file, JSON.stringify({ seed: 'original' }, null, 2), 'utf-8')
})

afterEach(async () => {
  mismatchAfterRename.active = false
  await rm(dir, { recursive: true, force: true })
})

describe('TRDD-HF2DY4VT — audit-mismatch baseline', () => {
  it('POSITIVE CONTROL — with no interfering writer the audit agrees', async () => {
    const { updateJson } = await import('@/lib/json-io')
    const r = await updateJson(file, d => { d.added = 'mine' })

    // Without this, the mismatch case below could be passing for an unrelated reason (a broken
    // audit that always reports false), and the baseline would be a fiction.
    expect(r.auditOk).toBe(true)
    expect(r.changed).toBe(true)
  })

  it('BASELINE — a write that does not land as intended returns changed:true AND auditOk:false, and does NOT throw', async () => {
    const { updateJson } = await import('@/lib/json-io')
    mismatchAfterRename.active = true
    const r = await updateJson(file, d => { d.added = 'mine' })

    // The shape the two spreading consumers inherit verbatim:
    //   app/api/settings/edit/route.ts     → NextResponse.json({ success: true, ...result })
    //   scripts/aimaestro-settings-cli.mjs → console.log(JSON.stringify({ success: true, ...result }))
    // So an HTTP client and a CLI are handed `success: true` and `auditOk: false` in ONE object.
    expect(r.auditOk).toBe(false)
    expect(r.changed).toBe(true)

    // This is the crux of the card, stated as an assertion rather than as prose: the audit
    // disagreeing is NOT an error today. Nothing throws, so no caller's catch block runs, and the
    // only signal is a field none of them reads.
    expect(r).toMatchObject({ changed: true, auditOk: false })

    // And the interfering write SURVIVES — the deliberate no-auto-rollback decision
    // (`json-io.ts:327-331`). If a future change starts restoring the backup here, this reddens,
    // which is the point: that decision is load-bearing and must not be reversed by accident.
    const onDisk = JSON.parse(await readFile(file, 'utf-8'))
    expect(onDisk.writtenByAnotherProcess).toBe(true)
    expect(onDisk.added).toBe('mine')
  })
})
