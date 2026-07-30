// The three startup guards that used to be unreachable (TRDD-L42SKUBW).
//
// R9.9, R17.17 and R17.20 all sat inline in `server.mjs::startServer`, whose import
// side effect is a LISTENING SERVER — so all three were recorded ENFORCED with an
// empty Test column, which is the honest record of a guard nobody can watch. They now
// live in three `.mjs` seams; this file drives them.
//
// 0-IMPACT BY CONSTRUCTION, not by mocking: `disableCorePluginAtUserScope` takes the
// home directory as a PARAMETER, so a test physically cannot reach the developer's own
// `~/.claude/settings.json` — there is no `$HOME` read to intercept. The two DI guards
// never touch the filesystem at all. (An earlier batch escaped containment because
// `vi.mock('os')` does not intercept a runtime `import('os')` inside a function body;
// injection removes that whole class of trap.)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  stripUserScopeCorePlugin,
  disableCorePluginAtUserScope,
} from '@/lib/startup-user-scope-guard.mjs'
import { ensureMarketplacesRegistered } from '@/lib/startup-marketplaces.mjs'
import { enforceStartupManagerGate } from '@/lib/startup-manager-gate.mjs'

describe('R17.17 — stripUserScopeCorePlugin (pure core)', () => {
  it('SCEN-012 regression: disables ONLY the core plugin, never a role-plugin whose MARKETPLACE name contains it', () => {
    // The original match was `k.includes('ai-maestro-plugin')`, which matched
    // `...@ai-maestro-plugins` — the marketplace name contains the plugin name as a
    // substring — so the startup guard disabled an agent's role-plugin. This is the
    // exact input that broke.
    const settings = {
      enabledPlugins: {
        'ai-maestro-autonomous-agent@ai-maestro-plugins': true,
        'ai-maestro-plugin@ai-maestro-plugins': true,
        'ai-maestro-programmer-agent@ai-maestro-plugins': true,
      },
    }
    const { changed, key, next } = stripUserScopeCorePlugin(settings)
    expect(changed).toBe(true)
    expect(key).toBe('ai-maestro-plugin@ai-maestro-plugins')
    expect(next.enabledPlugins).toEqual({
      'ai-maestro-autonomous-agent@ai-maestro-plugins': true,
      'ai-maestro-plugin@ai-maestro-plugins': false,
      'ai-maestro-programmer-agent@ai-maestro-plugins': true,
    })
  })

  it('matches a bare plugin key with no @marketplace suffix', () => {
    const { changed, key } = stripUserScopeCorePlugin({ enabledPlugins: { 'ai-maestro-plugin': true } })
    expect(changed).toBe(true)
    expect(key).toBe('ai-maestro-plugin')
  })

  it('leaves an already-false entry alone — a pointless write to the user settings every boot', () => {
    const settings = { enabledPlugins: { 'ai-maestro-plugin@ai-maestro-plugins': false } }
    const { changed, next } = stripUserScopeCorePlugin(settings)
    expect(changed).toBe(false)
    expect(next).toBe(settings) // untouched, same object
  })

  it('is a no-op when the core plugin is absent, or enabledPlugins is missing entirely', () => {
    expect(stripUserScopeCorePlugin({ enabledPlugins: { 'other@mkt': true } }).changed).toBe(false)
    expect(stripUserScopeCorePlugin({}).changed).toBe(false)
    expect(stripUserScopeCorePlugin({ model: 'sonnet' }).changed).toBe(false)
  })

  it('does not mutate its input', () => {
    const settings = { enabledPlugins: { 'ai-maestro-plugin@m': true } }
    stripUserScopeCorePlugin(settings)
    expect(settings.enabledPlugins['ai-maestro-plugin@m']).toBe(true)
  })
})

describe('R17.17 — disableCorePluginAtUserScope (I/O shell)', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aim-startup-guard-'))
    mkdirSync(join(home, '.claude'), { recursive: true })
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const settingsPath = () => join(home, '.claude', 'settings.json')

  it('writes settings.json — NOT settings.local.json, which the CLI never reads at user scope', () => {
    writeFileSync(settingsPath(), JSON.stringify({
      model: 'sonnet',
      enabledPlugins: { 'ai-maestro-plugin@ai-maestro-plugins': true },
    }, null, 2))

    expect(disableCorePluginAtUserScope(home)).toBe(true)

    const after = JSON.parse(readFileSync(settingsPath(), 'utf-8'))
    expect(after.enabledPlugins['ai-maestro-plugin@ai-maestro-plugins']).toBe(false)
    // Unrelated keys survive, in place: the guard rewrites one value, not the file.
    expect(after.model).toBe('sonnet')
    expect(Object.keys(after)).toEqual(['model', 'enabledPlugins'])
    // BUG-POLLUTION-001: writing the .local variant at user scope is a silent no-op.
    expect(existsSync(join(home, '.claude', 'settings.local.json'))).toBe(false)
  })

  it('returns false and writes nothing when the file does not exist', () => {
    expect(disableCorePluginAtUserScope(home)).toBe(false)
    expect(existsSync(settingsPath())).toBe(false)
  })

  it('a malformed settings.json is swallowed, not thrown — a broken file must not stop the boot', () => {
    writeFileSync(settingsPath(), '{ this is not json')
    expect(disableCorePluginAtUserScope(home)).toBe(false)
    expect(readFileSync(settingsPath(), 'utf-8')).toBe('{ this is not json') // left as-is
  })

  it('returns false without rewriting when the entry is already false', () => {
    const body = JSON.stringify({ enabledPlugins: { 'ai-maestro-plugin@m': false } }, null, 2)
    writeFileSync(settingsPath(), body)
    expect(disableCorePluginAtUserScope(home)).toBe(false)
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(body)
  })
})

describe('R17.20 — ensureMarketplacesRegistered', () => {
  type Call = { fn: string; name: string; auth: unknown; source?: unknown }

  function fakes(overrides: Record<string, () => unknown> = {}) {
    const calls: Call[] = []
    const logs: string[] = []
    const record = (fn: string) => async (input: Record<string, unknown>, auth: unknown) => {
      calls.push({ fn, name: input.name as string, auth, source: input.source })
      const override = overrides[`${fn}:${input.name as string}`]
      if (override) return override()
      return { success: true }
    }
    return {
      calls,
      logs,
      deps: {
        CreateMarketplace: record('create'),
        UpdateMarketplace: record('update'),
        DeleteMarketplace: record('delete'),
        homedir: () => '/fake/home',
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
      },
    }
  }

  it('attempts all six registrations, in order, and reports success', async () => {
    const { calls, logs, deps } = fakes()
    const attempted = await ensureMarketplacesRegistered(deps)

    expect(attempted).toEqual([
      'add-remote', 'add-roles', 'update-roles', 'add-custom', 'update-custom', 'remove-stale-core',
    ])
    expect(calls.map(c => `${c.fn} ${c.name}`)).toEqual([
      'create ai-maestro-plugins',
      'create ai-maestro-local-roles-marketplace',
      'update ai-maestro-local-roles-marketplace',
      'create ai-maestro-local-custom-marketplace',
      'update ai-maestro-local-custom-marketplace',
      'delete ai-maestro-local-core-marketplace',
    ])
    expect(logs.some(l => l.includes('Marketplaces registered via AIOs'))).toBe(true)
  })

  it('passes the system-owner auth on EVERY call — these are unattended boot-time AIO calls', async () => {
    const { calls, deps } = fakes()
    await ensureMarketplacesRegistered(deps)
    expect(calls).toHaveLength(6)
    for (const c of calls) expect(c.auth).toEqual({ isSystemOwner: true })
  })

  it('resolves the two local containers under the injected home', async () => {
    const { calls, deps } = fakes()
    await ensureMarketplacesRegistered(deps)
    expect(calls.find(c => c.name === 'ai-maestro-local-roles-marketplace' && c.fn === 'create')?.source)
      .toEqual({ path: '/fake/home/agents/role-plugins' })
    expect(calls.find(c => c.name === 'ai-maestro-local-custom-marketplace' && c.fn === 'create')?.source)
      .toEqual({ path: '/fake/home/agents/custom-plugins' })
    expect(calls[0].source).toEqual({ repo: 'Emasoft/ai-maestro-plugins' })
  })

  it('BEST EFFORT: a THROW from one registration does not prevent the remaining five', async () => {
    // The contract that cannot be checked any other way — every call is wrapped so a
    // boot-time failure can never block startup, which makes a real failure and a
    // normal no-op indistinguishable to the caller BY DESIGN.
    const { calls, logs, deps } = fakes({
      'create:ai-maestro-local-roles-marketplace': () => { throw new Error('marketplace already registered') },
    })
    const attempted = await ensureMarketplacesRegistered(deps)
    expect(attempted).toHaveLength(6)
    expect(calls).toHaveLength(6)
    expect(logs.some(l => l.includes('[Startup/add-roles] threw:'))).toBe(true)
    expect(logs.some(l => l.includes('Marketplaces registered via AIOs'))).toBe(true)
  })

  it('BEST EFFORT: a {success:false} result is logged as a noop and the sequence continues', async () => {
    const { calls, logs, deps } = fakes({
      'delete:ai-maestro-local-core-marketplace': () => ({ success: false, error: 'marketplace not found' }),
    })
    await ensureMarketplacesRegistered(deps)
    expect(calls).toHaveLength(6)
    expect(logs.some(l => l.includes('[Startup/remove-stale-core] noop:') && l.includes('not found'))).toBe(true)
  })
})

describe('R9.9 — enforceStartupManagerGate', () => {
  it('does nothing when a MANAGER exists — and never even loads the team registry', async () => {
    let blockCalls = 0
    const logs: string[] = []
    const result = await enforceStartupManagerGate({
      getManagerId: () => 'mgr-1',
      blockAllTeams: async () => { blockCalls++; return [] },
      log: (m: string) => logs.push(m),
    })
    expect(result).toEqual({ blocked: false, hibernated: 0 })
    expect(blockCalls).toBe(0)
    expect(logs).toEqual([])
  })

  it('blocks every team and reports the hibernation count when no MANAGER is detected', async () => {
    const logs: string[] = []
    const result = await enforceStartupManagerGate({
      getManagerId: () => null,
      blockAllTeams: async () => ['agent-a', 'agent-b'],
      log: (m: string) => logs.push(m),
    })
    expect(result).toEqual({ blocked: true, hibernated: 2 })
    expect(logs).toEqual(['[Startup] No MANAGER detected — blocked all teams, hibernated 2 team agent(s)'])
  })

  it('still blocks when there was nothing live to hibernate — the block is the point, not the count', async () => {
    const logs: string[] = []
    const result = await enforceStartupManagerGate({
      getManagerId: () => undefined,
      blockAllTeams: async () => [],
      log: (m: string) => logs.push(m),
    })
    expect(result).toEqual({ blocked: true, hibernated: 0 })
    expect(logs).toEqual(['[Startup] No MANAGER detected — all teams blocked (no active team agents to hibernate)'])
  })
})
