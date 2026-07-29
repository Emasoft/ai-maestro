/**
 * TRDD-YLCTM8EU box 2 — pin the candidate-set INCLUSION of the janitor.
 *
 * The card's box 1 was verified by observation ("with a newer janitor release
 * available, a running server updates the cached plugin"). Box 2 stayed open
 * because the three corpus readers were module-private with no dep seam, so
 * the only way to exercise the decision was to run the real updates against
 * the real host — which is not a test.
 *
 * `collectUpdateCandidates` is that seam. These tests pass FAKE readers, so
 * they are 0-IMPACT by construction: no filesystem access at all, therefore
 * no path by which they could read or mutate the developer's real
 * ~/.claude/settings.json or agent registry. That is stronger than mocking
 * `os.homedir()` — there is nothing to contain.
 *
 * The fake corpus mirrors the LIVE host shape, verified 2026-07-29:
 *   ai-maestro-janitor@ai-maestro-plugins = true   (USER scope)
 */
import { describe, it, expect, vi } from 'vitest'
import {
  collectUpdateCandidates,
  type CandidateReaders,
  type UpdateCandidate,
} from '@/services/auto-update-service'
import { DEFAULT_SETTINGS, type AutoUpdateCategories, type AutoUpdateSettings } from '@/lib/auto-update-settings'
import { MARKETPLACE_NAME, MAIN_PLUGIN_NAME, LOCAL_MARKETPLACE_NAME } from '@/lib/ecosystem-constants'

const JANITOR = 'ai-maestro-janitor'

/** Settings built by OVERLAYING the shipped defaults, never by hand-listing
 *  them — so a test asserting "with default settings" keeps tracking the real
 *  default if someone flips one, instead of silently testing a stale copy. */
function settingsWith(overrides: Partial<AutoUpdateCategories> = {}): AutoUpdateSettings {
  return {
    ...DEFAULT_SETTINGS,
    categories: { ...DEFAULT_SETTINGS.categories, ...overrides },
  }
}

/** The live host's shape: the janitor and the core plugin both enabled at
 *  USER scope out of the ai-maestro-plugins marketplace, plus one
 *  agent-local plugin so the local-scope paths are exercised too. */
function fakeReaders(): CandidateReaders & { calls: Record<string, number> } {
  const calls: Record<string, number> = { user: 0, agentLocal: 0, byMarketplace: 0 }
  const userScope = [
    { name: JANITOR, marketplace: MARKETPLACE_NAME },
    { name: MAIN_PLUGIN_NAME, marketplace: MARKETPLACE_NAME },
  ]
  const agentLocal = [
    {
      name: 'ai-maestro-programmer-agent',
      marketplace: LOCAL_MARKETPLACE_NAME,
      agentDir: '/tmp/fake-agents/pedro',
      agentId: 'fake-agent-id',
      sessionName: 'pedro',
    },
  ]
  return {
    calls,
    listUserScopePlugins: async () => { calls.user++; return userScope },
    listAgentLocalScopePlugins: async () => { calls.agentLocal++; return agentLocal },
    listInstalledPluginsInMarketplace: async (mkt: string) => {
      calls.byMarketplace++
      // Mirror the real reader: it unions user + agent-local, FILTERED to the
      // requested marketplace. A fake that ignored the argument would make
      // the marketplace-scoped categories look broader than they are.
      const out: Array<{ name: string; scope: 'user' | 'local'; agentDir?: string; agentId?: string; sessionName?: string }> = []
      for (const u of userScope) if (u.marketplace === mkt) out.push({ name: u.name, scope: 'user' })
      for (const l of agentLocal) {
        if (l.marketplace === mkt) {
          out.push({ name: l.name, scope: 'local', agentDir: l.agentDir, agentId: l.agentId, sessionName: l.sessionName })
        }
      }
      return out
    },
  }
}

const names = (m: Map<string, UpdateCandidate>) => [...m.values()].map(c => c.name)
const find = (m: Map<string, UpdateCandidate>, name: string) => [...m.values()].filter(c => c.name === name)

describe('collectUpdateCandidates — the janitor is in the candidate set (TRDD-YLCTM8EU)', () => {
  it('includes the janitor under the SHIPPED DEFAULT settings, at user scope', async () => {
    // THE box-2 claim. This is the assertion the card could not make before
    // the seam existed.
    const r = fakeReaders()
    const got = await collectUpdateCandidates(settingsWith(), [MARKETPLACE_NAME], r)

    const janitor = find(got, JANITOR)
    expect(janitor).toHaveLength(1)
    expect(janitor[0]).toMatchObject({ name: JANITOR, marketplace: MARKETPLACE_NAME, scope: 'user' })
  })

  it('reaches the janitor through the aiMaestroMarketplace reader, not by accident', async () => {
    // Non-vacuity for the path, not just the outcome: with userScopePlugins
    // off (its shipped default), the ONLY route to the janitor is the
    // marketplace reader. Pin that it was actually consulted, so a future
    // refactor that stops calling it cannot keep this suite green by
    // surfacing the janitor from some other branch.
    const r = fakeReaders()
    expect(DEFAULT_SETTINGS.categories.userScopePlugins).toBe(false)

    const got = await collectUpdateCandidates(settingsWith(), [MARKETPLACE_NAME], r)

    expect(r.calls.byMarketplace).toBeGreaterThan(0)
    expect(r.calls.user).toBe(0)
    expect(names(got)).toContain(JANITOR)
  })

  it('also reaches the janitor via userScopePlugins when the marketplace category is off', async () => {
    const r = fakeReaders()
    const got = await collectUpdateCandidates(
      settingsWith({ aiMaestroMarketplace: false, userScopePlugins: true }),
      [MARKETPLACE_NAME],
      r,
    )

    expect(r.calls.user).toBeGreaterThan(0)
    expect(find(got, JANITOR)).toHaveLength(1)
  })

  it('de-dupes the janitor to ONE entry when both routes reach it', async () => {
    // Two categories, one plugin, same (name, marketplace, scope) → exactly
    // one update attempt. Without the de-dup the scheduler would run
    // ChangePlugin twice for the same plugin in one tick.
    const r = fakeReaders()
    const got = await collectUpdateCandidates(
      settingsWith({ aiMaestroMarketplace: true, userScopePlugins: true }),
      [MARKETPLACE_NAME],
      r,
    )

    expect(find(got, JANITOR)).toHaveLength(1)
  })

  it('does NOT reach the janitor when both of its categories are off — the coupling, stated', async () => {
    // The honest negative, and a finding rather than a nicety: the janitor is
    // USER-scope, `userScopePlugins` ships OFF, so its currency rests on the
    // single default-on `aiMaestroMarketplace` toggle. Turn that off in the
    // UI and the absorbed version-update chore silently stops keeping the
    // janitor current. That is the coupling ai-maestro#102 / TRDD-5X3P79Q6
    // is about; this test is its evidence, not its fix.
    const r = fakeReaders()
    const got = await collectUpdateCandidates(
      settingsWith({ aiMaestroMarketplace: false, userScopePlugins: false, dependencyPlugins: false, core: true }),
      [MARKETPLACE_NAME],
      r,
    )

    expect(names(got)).not.toContain(JANITOR)
    // Positive control: the set is non-empty and the function DID run, so the
    // absence above is a real exclusion and not a vacuous empty map.
    expect(names(got)).toContain(MAIN_PLUGIN_NAME)
  })

  it('carries agentId + sessionName on local-scope candidates', async () => {
    // These two fields are what let ChangePlugin resolve the agent and what
    // lets the scheduler queue a restart afterwards; dropping either is a
    // silent behaviour loss with no error.
    //
    // EVERY other category is off deliberately. The first version of this
    // test left `localMarketplaces` at its default (true), so the same plugin
    // was ALSO added by the marketplace branch — which passes agentId — and
    // addCandidate is first-write-wins, so that entry won. The test therefore
    // asserted through a branch it does not name, and a neuter that stripped
    // agentId from the agentLocalScopePlugins branch left it GREEN. Isolate
    // the route or the assertion is about the wrong code.
    const r = fakeReaders()
    const got = await collectUpdateCandidates(
      settingsWith({
        agentLocalScopePlugins: true,
        localMarketplaces: false,
        aiMaestroMarketplace: false,
        dependencyPlugins: false,
        core: false,
      }),
      [],
      r,
    )

    const local = [...got.values()].find(c => c.scope === 'local')
    expect(local).toMatchObject({ agentId: 'fake-agent-id', sessionName: 'pedro' })
    expect(local?.agentDir).toBe('/tmp/fake-agents/pedro')
  })

  it('consults NO real filesystem — the readers are the only I/O', async () => {
    // Containment proven, not assumed: if collectUpdateCandidates ever reads
    // the host directly again, this count stops matching the work done.
    const r = fakeReaders()
    const spy = vi.spyOn(r, 'listInstalledPluginsInMarketplace')
    await collectUpdateCandidates(settingsWith({ localMarketplaces: false, dependencyPlugins: false }), [], r)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(MARKETPLACE_NAME)
  })
})
