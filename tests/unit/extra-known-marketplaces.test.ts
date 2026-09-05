/**
 * TRDD-Y0XEEUXN Part 3 — `lib/extra-known-marketplaces.ts`, the ONE owner of every
 * `extraKnownMarketplaces` read-modify-write, and the four services repointed to it.
 *
 * Two groups of tests:
 *   1. Direct tests of the owner module against a real temp settings.json — batch atomicity
 *      (a throwing op leaves the file untouched, proving "one transaction" rather than "N
 *      sequential writes"), the returned prior entries, absence-is-success, and
 *      `UnreadableTargetError` propagation on a corrupt file.
 *   2. One seam test per repointed writer — real files under a fake `$HOME` (the repo's
 *      established `os` + `@/lib/ecosystem-constants` containment, copied from
 *      tests/integration/change-marketplace-rollback.test.ts), asserting the ACTUAL settings.json
 *      content after calling each writer's nearest exported entry point. `ensureCustomClientMarketplace`
 *      and `registerMarketplaceGlobally`/`migrateDefaultPluginSettings` were unexported before this
 *      card; they are exported now FOR THESE TESTS ONLY (see their own doc comments).
 *
 * NEUTER RUN (recorded, not left wired into the suite): `registerMarketplaceGlobally`'s call to
 * `applyExtraKnownMarketplaceOps` was temporarily replaced with a no-op (`void
 * applyExtraKnownMarketplaceOps`) — 2 of the 10 tests below reddened: "writer 2 —
 * registerMarketplaceGlobally registers via the owner" (asserts the direct call) and "POSITIVE
 * CONTROL — bypassing the owner in ensureMarketplace() leaves nothing registered" (asserts the
 * same write reached through its real production entry point). The other 8 stayed green,
 * including writer 1/3/6's seam tests — confirming each seam test is specific to its own writer,
 * not to the module import succeeding. Restored immediately after; `git diff
 * services/role-plugin-service.ts` was empty before this file was finalized.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── Direct module tests: real temp settings.json, no mocks of the module under test ──

let dir: string
let settingsPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ekm-owner-'))
  mkdirSync(join(dir, '.claude'), { recursive: true })
  settingsPath = join(dir, '.claude', 'settings.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seed(obj: Record<string, unknown>): void {
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n')
}

function read(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf-8'))
}

describe('applyExtraKnownMarketplaceOps — direct', () => {
  it('applies a batch of ops as ONE all-or-nothing write — a malformed op leaves the file untouched', async () => {
    /** Proves the batch is one transaction, not N sequential writes: if it were N, the valid op
     *  ahead of the malformed one would already be on disk by the time the malformed one throws. */
    const { applyExtraKnownMarketplaceOps } = await import('@/lib/extra-known-marketplaces')
    seed({ extraKnownMarketplaces: { existing: { source: 'x' } } })
    const before = read()

    await expect(
      applyExtraKnownMarketplaceOps(
        [
          { name: 'valid-one', set: { source: { source: 'directory', path: '/x' } } },
          // Carries none of set/patch/delete — the runtime backstop throws INSIDE the mutator,
          // before `updateJson` ever serializes or renames anything.
          { name: 'broken' } as never,
        ],
        settingsPath,
      ),
    ).rejects.toThrow(/carries none of set\/patch\/delete/)

    expect(read()).toEqual(before) // nothing landed — not even 'valid-one'
  })

  it('applies a patch (one field, on an existing entry) and a whole-entry set for a different name in ONE call', async () => {
    seed({
      extraKnownMarketplaces: {
        known: { source: { source: 'github', repo: 'x/y' }, autoUpdate: false },
      },
    })
    const { applyExtraKnownMarketplaceOps } = await import('@/lib/extra-known-marketplaces')

    const priors = await applyExtraKnownMarketplaceOps(
      [
        { name: 'known', patch: { autoUpdate: true } },
        { name: 'brand-new', set: { source: { source: 'directory', path: '/z' } } },
      ],
      settingsPath,
    )

    const data = read()
    const ekm = data.extraKnownMarketplaces as Record<string, unknown>
    expect(ekm.known).toEqual({ source: { source: 'github', repo: 'x/y' }, autoUpdate: true })
    expect(ekm['brand-new']).toEqual({ source: { source: 'directory', path: '/z' } })
    // The patch left the sibling `source` field untouched — a whole-entry `set` built from the
    // partial patch would have dropped it.
    expect((ekm.known as { source: unknown }).source).toEqual({ source: 'github', repo: 'x/y' })

    expect(priors.known).toEqual({ source: { source: 'github', repo: 'x/y' }, autoUpdate: false })
    expect(priors['brand-new']).toBeUndefined()
  })

  it('returns undefined and leaves the file untouched when deleting an absent name (absence = success)', async () => {
    seed({ extraKnownMarketplaces: { keep: { a: 1 } } })
    const { applyExtraKnownMarketplaceOps } = await import('@/lib/extra-known-marketplaces')
    const before = read()

    const priors = await applyExtraKnownMarketplaceOps([{ name: 'nope', delete: true }], settingsPath)

    expect(priors.nope).toBeUndefined()
    expect(read()).toEqual(before)
  })

  it('deletes an existing name and returns its prior value', async () => {
    seed({ extraKnownMarketplaces: { gone: { source: 'x' }, stays: { source: 'y' } } })
    const { applyExtraKnownMarketplaceOps } = await import('@/lib/extra-known-marketplaces')

    const priors = await applyExtraKnownMarketplaceOps([{ name: 'gone', delete: true }], settingsPath)

    expect(priors.gone).toEqual({ source: 'x' })
    const ekm = read().extraKnownMarketplaces as Record<string, unknown>
    expect(ekm.gone).toBeUndefined()
    expect(ekm.stays).toEqual({ source: 'y' })
  })

  it('propagates UnreadableTargetError from a corrupt settings.json rather than treating it as absence', async () => {
    writeFileSync(settingsPath, '{ this is not json')
    const { applyExtraKnownMarketplaceOps } = await import('@/lib/extra-known-marketplaces')
    const { UnreadableTargetError } = await import('@/lib/json-io')

    await expect(
      applyExtraKnownMarketplaceOps([{ name: 'x', delete: true }], settingsPath),
    ).rejects.toBeInstanceOf(UnreadableTargetError)
    // The corrupt bytes are untouched — `updateJson` refuses to overwrite what it cannot read.
    expect(readFileSync(settingsPath, 'utf-8')).toBe('{ this is not json')
  })
})

// ── Seam tests: one per repointed writer, real files under a fake $HOME ──
//
// Same containment idiom as tests/integration/change-marketplace-rollback.test.ts: `os.homedir`
// mocked for the services that capture it at module load (plugin-storage-service.ts,
// role-plugin-service.ts), plus `@/lib/ecosystem-constants`'s path FUNCTIONS overridden via the
// shared `fakeEcosystemPaths` helper (they re-`require('os')` at call time, which a static `os`
// mock alone does not reliably reach).

const H = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  return { FAKE_HOME: mk(j(root, 'aim-ekm-owner-seam-')) }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, join(H.FAKE_HOME, '.aimaestro'))
})

// Writer 3's production entry point (`syncDefaultRolePlugins`) spawns the `claude` CLI directly
// (Step 1) — this mock only needs to cover the ONE export `migrateDefaultPluginSettings` (called
// through its own export, not through `syncDefaultRolePlugins`) actually calls: `DeleteMarketplace`,
// via a dynamic `import('./element-management-service')` inside the function.
const mockDeleteMarketplace = vi.fn().mockResolvedValue({ success: false, operations: [], restartNeeded: false })
vi.mock('@/services/element-management-service', () => ({
  DeleteMarketplace: (...a: unknown[]) => mockDeleteMarketplace(...a),
}))

const FAKE_SETTINGS = join(H.FAKE_HOME, '.claude', 'settings.json')

function readFakeSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(FAKE_SETTINGS, 'utf-8'))
}

describe('TRDD-Y0XEEUXN Part 3 — seam tests (one per repointed writer)', () => {
  beforeEach(() => {
    mkdirSync(join(H.FAKE_HOME, '.claude'), { recursive: true })
    mockDeleteMarketplace.mockClear()
  })

  afterEach(() => {
    rmSync(join(H.FAKE_HOME, '.claude'), { recursive: true, force: true })
    rmSync(join(H.FAKE_HOME, 'agents'), { recursive: true, force: true })
  })

  it('writer 1 — plugin-storage-service.ts ensureCustomClientMarketplace registers via the owner', async () => {
    const { ensureCustomClientMarketplace } = await import('@/services/plugin-storage-service')
    const { CUSTOM_MARKETPLACE_NAME, getCustomMarketplacePathForClient } = await import('@/lib/ecosystem-constants')

    await ensureCustomClientMarketplace('claude')

    const marketplaceDir = getCustomMarketplacePathForClient('claude')
    const ekm = readFakeSettings().extraKnownMarketplaces as Record<string, unknown>
    expect(ekm[`${CUSTOM_MARKETPLACE_NAME}-claude`]).toEqual({
      source: { source: 'directory', path: marketplaceDir },
    })
  })

  it('writer 2 — role-plugin-service.ts registerMarketplaceGlobally registers via the owner', async () => {
    const { registerMarketplaceGlobally } = await import('@/services/role-plugin-service')
    const { LOCAL_MARKETPLACE_NAME, getLocalMarketplacePath } = await import('@/lib/ecosystem-constants')

    await registerMarketplaceGlobally()

    const ekm = readFakeSettings().extraKnownMarketplaces as Record<string, unknown>
    expect(ekm[LOCAL_MARKETPLACE_NAME]).toEqual({
      source: { source: 'directory', path: getLocalMarketplacePath() },
    })
  })

  it('writer 3 — role-plugin-service.ts migrateDefaultPluginSettings deletes via the owner (DeleteMarketplace mocked, no CLI spawn)', async () => {
    writeFileSync(
      FAKE_SETTINGS,
      JSON.stringify(
        {
          extraKnownMarketplaces: {
            'ai-maestro-local-marketplace': { source: { source: 'directory', path: '/stale' } },
            keep: { source: { source: 'github', repo: 'x/y' } },
          },
        },
        null,
        2,
      ) + '\n',
    )
    const { migrateDefaultPluginSettings } = await import('@/services/role-plugin-service')

    await migrateDefaultPluginSettings()

    // Step 1 tried DeleteMarketplace for both deprecated-name forms and got `{success:false}` from
    // the mock both times — no CLI was spawned, and the function fell through to its Step 1b
    // settings-side fallback, which is the one this card repoints.
    expect(mockDeleteMarketplace).toHaveBeenCalledTimes(2)

    const ekm = readFakeSettings().extraKnownMarketplaces as Record<string, unknown>
    expect(ekm['ai-maestro-local-marketplace']).toBeUndefined()
    expect(ekm['ai-maestro-local-agents-marketplace']).toBeUndefined()
    expect(ekm['role-plugins']).toBeUndefined()
    expect(ekm.keep).toEqual({ source: { source: 'github', repo: 'x/y' } }) // untouched sibling
  })

  it('writer 6 — auto-update-service.ts ensureMarketplaceAutoUpdate patches + adds via the owner in one call', async () => {
    // A separate temp settings.json (not FAKE_SETTINGS): `ensureMarketplaceAutoUpdate` takes an
    // explicit `settingsPath` and this proves it does NOT need the fake-$HOME containment above —
    // it never resolves through `os.homedir()` for the path it actually writes.
    const tmp = mkdtempSync(join(tmpdir(), 'ekm-auto-update-'))
    mkdirSync(join(tmp, '.claude'), { recursive: true })
    const p = join(tmp, '.claude', 'settings.json')
    writeFileSync(
      p,
      JSON.stringify(
        {
          extraKnownMarketplaces: {
            // Already declared, autoUpdate off — this is the PATCH half of the batch.
            declared: { source: { source: 'github', repo: 'a/b' }, autoUpdate: false },
            // Already true — must be left alone (zero ops for this one).
            already: { source: { source: 'github', repo: 'c/d' }, autoUpdate: true },
          },
        },
        null,
        2,
      ) + '\n',
    )

    const { ensureMarketplaceAutoUpdate } = await import('@/services/auto-update-service')
    const result = await ensureMarketplaceAutoUpdate(p)

    expect(result.status).toBe('updated')
    const ekm = JSON.parse(readFileSync(p, 'utf-8')).extraKnownMarketplaces as Record<string, unknown>
    // The patch flipped `autoUpdate` and left the sibling `source` field untouched.
    expect(ekm.declared).toEqual({ source: { source: 'github', repo: 'a/b' }, autoUpdate: true })
    // Already-true entry: zero ops, unchanged.
    expect(ekm.already).toEqual({ source: { source: 'github', repo: 'c/d' }, autoUpdate: true })

    rmSync(tmp, { recursive: true, force: true })
  })

  it('POSITIVE CONTROL — bypassing the owner in ensureMarketplace() leaves nothing registered (neuter target)', async () => {
    /** Same shape as the writer-2 test above, but calling `ensureMarketplace()` — which does the
     *  marketplace.json scaffolding AND THEN calls `registerMarketplaceGlobally()` — proves the
     *  registration is reached from the real production entry point, not only when the writer is
     *  invoked directly. */
    const { ensureMarketplace } = await import('@/services/role-plugin-service')
    const { LOCAL_MARKETPLACE_NAME, getLocalMarketplacePath } = await import('@/lib/ecosystem-constants')

    await ensureMarketplace()

    const ekm = readFakeSettings().extraKnownMarketplaces as Record<string, unknown>
    expect(ekm[LOCAL_MARKETPLACE_NAME]).toEqual({
      source: { source: 'directory', path: getLocalMarketplacePath() },
    })
  })
})
