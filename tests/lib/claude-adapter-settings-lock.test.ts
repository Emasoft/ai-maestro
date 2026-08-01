/**
 * TRDD-RYFP030K — `claudeAdapter.enable`/`disable` write settings.local.json through THE shared lock.
 *
 * WHAT WAS WRONG, measured 2026-08-01. This module guarded its read-modify-write with
 * `withLock(settingsLockKey(path))` — a string key in `lib/file-lock.ts`'s in-process Map — while
 * `services/element-management-service.ts` builds the IDENTICAL path
 * (`join(<agentDir>, '.claude', 'settings.local.json')`, five sites) and guards it with a `mkdir`
 * lock DIRECTORY at `<path>.lock`. A string key and a lockdir share nothing, so the two modules
 * excluded each other NOWHERE — not even inside one process. And `lib/file-lock.ts` is process-local
 * by construction; its own header says it "provides NO protection against PM2 cluster mode /
 * headless + full mode / test harnesses". The file that decides which plugins an agent loads had the
 * weakest of the three locks this codebase had grown.
 *
 * THE POINT OF THESE TESTS is the third one. The first two would pass under the old code too — they
 * pin behaviour that never broke. Only "a concurrent writer on the OTHER path does not lose the
 * adapter's write" can tell the shared lock from the private one, because that is the only
 * difference between them.
 *
 * NEUTER (recorded): restore `enable` to `loadJsonSafe` → mutate → `saveJsonSafe` inside
 * `withLock(settingsLockKey(...))`. The two behaviour tests stay GREEN; the concurrency test reds.
 *
 * These run against a real `mkdtemp` dir: the properties under test (lockdir exclusion, directory
 * auto-creation, atomic rename) ARE filesystem behaviour, and a mocked write is a no-op that cannot
 * discriminate a working adapter from one that writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import claudeAdapter from '@/lib/client-plugin-adapters/claude-adapter'
import { inAdapterContext } from '@/lib/client-plugin-adapters/adapter-context'
import { withJsonLock } from '@/lib/json-io'
import type { StoredPlugin } from '@/lib/client-plugin-adapters/types'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let agentDir: string
let localSettings: string

const plugin = { name: 'demo-plugin', sourcePlugin: 'demo-marketplace' } as unknown as StoredPlugin
const KEY = 'demo-plugin@demo-marketplace'

/** The adapter refuses to run outside an adapter context (R21.4). The bypass is deliberately
 *  audit-visible rather than silent, so tests name themselves. */
const asTest = <T>(fn: () => Promise<T>) => inAdapterContext('TEST:claude-adapter-settings-lock', fn)

async function readSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(localSettings, 'utf-8'))
}

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), 'aim-adapter-'))
  localSettings = join(agentDir, '.claude', 'settings.local.json')
})

afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true })
})

describe('claudeAdapter.enable / disable', () => {
  it('creates .claude/settings.local.json on a fresh agent dir', async () => {
    // No `.claude/` exists yet. The explicit `mkdir` these functions used to call was removed with
    // the migration, on the grounds that the lock acquisition already creates the parent — this is
    // the assertion that makes that claim checkable rather than asserted.
    const res = await asTest(() => claudeAdapter.enable(plugin, agentDir))
    expect(res.success).toBe(true)
    expect(await readSettings()).toEqual({ enabledPlugins: { [KEY]: true } })
  })

  it('preserves every key it did not come to change', async () => {
    await mkdir(join(agentDir, '.claude'), { recursive: true })
    await writeFile(localSettings, JSON.stringify({
      permissions: { allow: ['Bash'] },
      env: { FOO: 'bar' },
      enabledPlugins: { 'other@mkt': true },
    }, null, 2) + '\n', 'utf-8')

    await asTest(() => claudeAdapter.enable(plugin, agentDir))
    let after = await readSettings()
    expect(after.permissions).toEqual({ allow: ['Bash'] })
    expect(after.env).toEqual({ FOO: 'bar' })
    expect(after.enabledPlugins).toEqual({ 'other@mkt': true, [KEY]: true })

    await asTest(() => claudeAdapter.disable(plugin, agentDir))
    after = await readSettings()
    // disable writes `false`, it does not delete the entry — Claude Code distinguishes
    // "explicitly off" from "never mentioned", so preserving the shape matters.
    expect(after.enabledPlugins).toEqual({ 'other@mkt': true, [KEY]: false })
    expect(after.permissions).toEqual({ allow: ['Bash'] })
    expect(after.env).toEqual({ FOO: 'bar' })
  })

  it('BLOCKS while the element-management lock is held on the same file', async () => {
    // THE test — and it asserts MUTUAL EXCLUSION DIRECTLY rather than hoping a race reproduces.
    //
    // The first version of this test fired four concurrent writers and asserted that every write
    // survived. It passed under the neuter: whether the interleaving that loses an update actually
    // occurs is up to the scheduler, and `updateJson`'s own staleness gate absorbs many of the
    // orderings that would otherwise lose one. A race test that depends on natural scheduling is a
    // lottery — it cannot fail reliably, so it cannot pass meaningfully either.
    //
    // What IS deterministic: hold the lockdir, then observe whether the adapter can finish. It can
    // only be blocked if it contends for the same physical lock, which is the entire property the
    // migration buys.
    await mkdir(join(agentDir, '.claude'), { recursive: true })
    await writeFile(localSettings, JSON.stringify({ seed: 1 }, null, 2) + '\n', 'utf-8')

    let release!: () => void
    const held = new Promise<void>(r => { release = r })
    // `withJsonLock` here stands in for element-management-service, which reaches this same file
    // through `withSettingsLock` → `withJsonLock` → the lockdir at `<path>.lock`.
    const holder = withJsonLock(localSettings, async () => { await held })
    await sleep(50) // let the holder actually acquire before we start the adapter

    // ⚠ STARTED OUTSIDE the holder's callback ON PURPOSE. `withJsonLock` is reentrant via
    // AsyncLocalStorage, so an adapter call made INSIDE that callback would inherit the held set,
    // skip the lock entirely, and complete immediately — the test would then pass no matter what
    // the adapter does. It has to run in a sibling async context to contend for real.
    let adapterDone = false
    const adapter = asTest(() => claudeAdapter.enable(plugin, agentDir)).then(r => { adapterDone = r.success })

    await sleep(200)
    expect(adapterDone).toBe(false) // ← blocked by a lock it must be sharing

    release()
    await holder
    await adapter

    // POSITIVE CONTROL, and it is not optional: without it, `adapterDone === false` above is equally
    // satisfied by an adapter that threw, hung forever, or was never called.
    expect(adapterDone).toBe(true)
    const after = await readSettings()
    expect(after.seed).toBe(1)
    expect(after.enabledPlugins).toEqual({ [KEY]: true })
  })
})
