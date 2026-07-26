/**
 * The containment helper's own guarantee, pinned.
 *
 * `fakeEcosystemPaths` exists to stop a test writing into the developer's real `~/agents/`.
 * Its refusal is the whole point, so it needs a test that watches it refuse — an unexercised
 * validator is indistinguishable from a no-op, which is the failure mode the governance map
 * exists to end.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fakeEcosystemPaths } from './fake-ecosystem-home'
import * as actual from '@/lib/ecosystem-constants'

const tmp = () => mkdtempSync(join(tmpdir(), 'fake-eco-'))

describe('fakeEcosystemPaths — containment validator', () => {
  it('REFUSES a fake home that is not under a temp root', () => {
    // The catastrophic mis-wire: containment pointed at the real home. Silently allowing it
    // would let the suite create real directories in the developer's ~/agents.
    expect(() => fakeEcosystemPaths(actual, homedir(), tmp())).toThrow(/must be a temp directory/)
  })

  it('REFUSES a fake state dir that is not under a temp root', () => {
    expect(() => fakeEcosystemPaths(actual, tmp(), join(homedir(), '.aimaestro'))).toThrow(
      /must be a temp directory/,
    )
  })

  it('is not fooled by a path that merely starts with the same characters', () => {
    // `/tmpfoo` shares a prefix with `/tmp` but is not inside it. Matching on raw string
    // prefix rather than a path SEGMENT would wave this through.
    expect(() => fakeEcosystemPaths(actual, '/tmpfoo', tmp())).toThrow(/must be a temp directory/)
  })

  it('ACCEPTS temp roots and redirects every container path under the fake home', () => {
    const home = tmp()
    const state = tmp()
    const eco = fakeEcosystemPaths(actual, home, state)

    expect(eco.getStateDir()).toBe(state)
    expect(eco.statePath('agents', 'registry.json')).toBe(join(state, 'agents', 'registry.json'))
    for (const p of [
      eco.getRolePluginsContainerPath(),
      eco.getCustomPluginsContainerPath(),
      eco.getCorePluginsContainerPath(),
      eco.getLocalMarketplacePath(),
      eco.getRoleMarketplacePathForClient('codex'),
      eco.getCustomMarketplacePathForClient('codex'),
      eco.getCoreMarketplacePathForClient('codex'),
    ]) {
      expect(p.startsWith(join(home, 'agents'))).toBe(true)
    }
  })

  it('keeps the NON-path exports real, so guards under test read genuine values', () => {
    // Mocking the naming builders would test the mock instead of the code. Only paths move.
    const eco = fakeEcosystemPaths(actual, tmp(), tmp())
    expect(eco.rolesMarketplaceDirName('codex')).toBe(actual.rolesMarketplaceDirName('codex'))
    expect(eco.MAIN_PLUGIN_NAME).toBe(actual.MAIN_PLUGIN_NAME)
  })
})
