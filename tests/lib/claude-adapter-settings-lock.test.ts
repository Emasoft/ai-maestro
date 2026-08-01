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
import { updateJson } from '@/lib/json-io'
import type { StoredPlugin } from '@/lib/client-plugin-adapters/types'

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

  it('a concurrent writer on the element-management path does not lose the adapter\'s write', async () => {
    // THE test. `updateJson` here stands in for element-management-service, which reaches the same
    // file through `withSettingsLock` → `withJsonLock` → the lockdir at `<path>.lock`. Before the
    // migration the adapter took a string-keyed in-process lock instead, so these two contended for
    // nothing and whichever wrote second silently discarded the other's change.
    await mkdir(join(agentDir, '.claude'), { recursive: true })
    await writeFile(localSettings, JSON.stringify({ seed: 1 }, null, 2) + '\n', 'utf-8')

    await Promise.all([
      asTest(() => claudeAdapter.enable(plugin, agentDir)),
      updateJson(localSettings, s => { s.fromElementMgmt = true }),
      asTest(() => claudeAdapter.enable({ name: 'second', sourcePlugin: 'mkt' } as unknown as StoredPlugin, agentDir)),
      updateJson(localSettings, s => { s.alsoFromElementMgmt = true }),
    ])

    const after = await readSettings()
    expect(after.seed).toBe(1)
    expect(after.fromElementMgmt).toBe(true)
    expect(after.alsoFromElementMgmt).toBe(true)
    expect(after.enabledPlugins).toEqual({ [KEY]: true, 'second@mkt': true })
  })
})
