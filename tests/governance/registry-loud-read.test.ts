/**
 * TRDD-DQ6XN2VP — the LOUD registry read: three-valued, so an R51.7 invariant cannot act on UNKNOWN.
 *
 * WHY THIS IS ITS OWN FILE, not a `describe` in `r51-7-invariants.test.ts`: that file
 * `vi.mock('@/lib/agent-registry')` wholesale (it pins the pipelines' invariants hooks against the
 * SERVICE), so a test there would assert the MOCK. This file imports the REAL module — the reader
 * is the thing under test — and isolates it with the repo's fake-home pattern
 * (r1-r2-team-registry.test.ts): `os.homedir()` AND `@/lib/ecosystem-constants` both redirected to
 * mkdtemp'd dirs, because `agent-registry` resolves `$HOME` through both routes.
 *
 * The card's finding: R51.7 needs valid / contradicted / UNKNOWN, and `loadAgents` (lenient catch →
 * `[]`) plus `PluginAdapter.detectState` (`{installed}`) are both two-valued. `loadAgentsLoud` is
 * the registry half of the prerequisite. NOT a promotion of any pipeline invariant — that wants a
 * USER ruling per the card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fsSync from 'fs'
import * as osSync from 'os'
import * as pathSync from 'path'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'dq6x-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'dq6x-state-'))
  return { FAKE_HOME: home, FAKE_STATE: state }
})

// 0-IMPACT layer 1 — homedir() through a static import.
vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// 0-IMPACT layer 2 — the ecosystem PATH functions (runtime resolution inside function bodies).
vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// `withLock` in the migration path shells out to nothing, but a migration-triggering fixture would
// `void withLock(...)` a save against the REAL state dir — never reached here: fixtures are seeded
// directly on disk, and no save runs in this file.

const REGISTRY = pathSync.join(FAKE_STATE, 'agents', 'registry.json')

function seedRegistry(content: string): void {
  fsSync.mkdirSync(pathSync.dirname(REGISTRY), { recursive: true })
  fsSync.writeFileSync(REGISTRY, content)
}

describe('loadAgentsLoud — the three-valued registry read (TRDD-DQ6XN2VP)', () => {
  beforeEach(() => {
    // Fresh state dir per test: the registry module resolved REGISTRY_FILE at load time against
    // the mocked getStateDir(), so the fixture path is fixed — clearing CONTENT isolates tests.
    fsSync.rmSync(FAKE_HOME, { recursive: true, force: true })
    fsSync.rmSync(FAKE_STATE, { recursive: true, force: true })
    fsSync.mkdirSync(FAKE_HOME, { recursive: true })
    fsSync.mkdirSync(FAKE_STATE, { recursive: true })
  })

  afterEach(() => {
    fsSync.rmSync(FAKE_HOME, { recursive: true, force: true })
    fsSync.rmSync(FAKE_STATE, { recursive: true, force: true })
  })

  it('VALID — a well-formed registry array returns ok with its agents', async () => {
    seedRegistry(
      JSON.stringify([
        { id: 'agent-1', name: 'alpha', sessions: [] },
        { id: 'agent-2', name: 'beta', sessions: [] },
      ]),
    )
    const { loadAgentsLoud } = await import('@/lib/agent-registry')
    const read = await loadAgentsLoud()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.agents).toHaveLength(2)
    expect(read.agents[0].name).toBe('alpha')
  })

  it('UNKNOWN — corrupt JSON returns ok:false with reason unreadable, never []', async () => {
    seedRegistry('{ this is not json')
    const { loadAgentsLoud } = await import('@/lib/agent-registry')
    const read = await loadAgentsLoud()
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toBe('unreadable')
    expect(read.error).toBeTruthy()
  })

  it('UNKNOWN — a registry that is not an array (the lenient reader would call it empty) is ok:false', async () => {
    // THE discriminating case: loadAgents would answer [] for `{}` (no — it returns [] for a
    // non-array WITHOUT logging), silently reading "no agents". The loud read says WHY.
    seedRegistry('{"agents": []}')
    const { loadAgentsLoud } = await import('@/lib/agent-registry')
    const read = await loadAgentsLoud()
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toBe('unreadable')
    expect(read.error).toContain('not a JSON array')
  })

  it('UNKNOWN — missing file returns ok:false reason missing (an invariant must not read it as empty)', async () => {
    // No seedRegistry — the file does not exist. MISSING is a legal state for the lenient
    // dashboard read; for an invariant it is still UNKNOWN, so it must be ok:false here and let
    // the caller branch on reason === 'missing' if absence is legal for IT.
    const { loadAgentsLoud } = await import('@/lib/agent-registry')
    const read = await loadAgentsLoud()
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toBe('missing')
  })

  it('NEUTER-PROOF — the lenient loadAgents still returns [] on the SAME corrupt fixture (the two answers must differ, or the loud read is not loud)', async () => {
    // Differential: the whole reason the card asked for a second reader. If loadAgents and
    // loadAgentsLoud ever agree on a corrupt file, the new reader is decorative.
    seedRegistry('{ corrupt')
    const mod = await import('@/lib/agent-registry')
    const lenient = mod.loadAgents()
    const loud = await mod.loadAgentsLoud()
    expect(lenient).toEqual([])
    expect(loud.ok).toBe(false)
    if (!loud.ok) expect(loud.reason).toBe('unreadable')
  })

  it('SCOPE PIN — ok:true means "parsed as an array", NOT "elements are agents" (review finding #2)', async () => {
    // Pins the reader's honest claim so no invariant author over-reads it: an array of garbage
    // reads ok:true (element shape is NOT validated — same cast as loadAgents). An invariant
    // consuming this reader must treat a not-found agent id as a CONTRADICTION, never as
    // unknown. Tightening belongs to the USER ruling, not here.
    seedRegistry('["not-an-agent"]')
    const { loadAgentsLoud } = await import('@/lib/agent-registry')
    const read = await loadAgentsLoud()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.agents).toEqual(['not-an-agent'])
  })

  it('NO CACHE INTERACTION — a loud read leaves the lenient path untouched (loadAgents still re-reads by mtime afterwards)', async () => {
    // Pins the "this read observes, never rewires" claim: if the loud path ever populated
    // _cachedAgents/_cachedMtimeMs, loadAgents' mtime check would return the loud-read snapshot
    // instead of re-reading the file the next time the content changed underneath it.
    seedRegistry(JSON.stringify([{ id: 'a1', name: 'first', sessions: [] }]))
    const { loadAgents, loadAgentsLoud } = await import('@/lib/agent-registry')
    const loud1 = await loadAgentsLoud()
    expect(loud1.ok).toBe(true)

    // Change the file content WITHOUT changing mtime semantics the lenient cache keys on —
    // rewrite the file (mtime advances), then assert loadAgents sees the NEW content, i.e. the
    // loud read did not leave a stale cache entry that masked it.
    seedRegistry(JSON.stringify([{ id: 'a1', name: 'second', sessions: [] }]))
    const lenient = loadAgents()
    expect(lenient).toHaveLength(1)
    expect(lenient[0].name).toBe('second')
  })
})
