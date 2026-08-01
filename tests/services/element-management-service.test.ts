/**
 * Element Management Service Tests
 *
 * Tests the centralized element management service that consolidates
 * plugin install/uninstall/enable/disable operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgent, resetFixtureCounter } from '../test-utils/fixtures'

// ============================================================================
// Mocks — vi.hoisted() ensures availability before vi.mock() runs
// ============================================================================

const {
  mockExecFileAsync,
  mockFsReadFile,
  mockFsWriteFile,
  mockFsOpen,
  mockFsMkdir,
  mockFsExistsSync,
  mockFsCreated,
  mockFsDeleted,
  mockFsContent,
  mockFsReaddir,
  mockFsBehavior,
  mockAgentRegistry,
  mockClientCapabilities,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockFsReadFile: vi.fn().mockResolvedValue('{}'),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  // `updateJson` writes through a handle, so this is the verb that records a SERVICE write now.
  // Both spellings are kept so "did OUR code write this file?" cannot go blind on the next switch.
  mockFsOpen: vi.fn(),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
  mockFsExistsSync: vi.fn().mockReturnValue(false),
  // The BASELINE above answers "what was on disk before this test ran". These two sets record what
  // the test itself creates and deletes, so `existsSync` can answer post-condition questions the
  // baseline structurally cannot: an install needs `false` BEFORE (the "already exists" check) and
  // `true` AFTER (the G05 post-condition), and one fixed boolean can never be both. Modelling the
  // writes is what lets a real post-condition be tested at all.
  mockFsCreated: new Set<string>(),
  mockFsDeleted: new Set<string>(),
  // Path -> last written body. The overlay modelled EXISTENCE but not CONTENT, so a write never fed
  // back into a read and every read-back verification was unfalsifiable here — the same defect the
  // existence overlay was added to fix, one layer up (TRDD-RO90UCKQ).
  mockFsContent: new Map<string, string>(),
  mockFsReaddir: vi.fn().mockResolvedValue([]),
  // `silentWrites` models the failure G05 exists to catch: the write RESOLVES but produces nothing
  // (a dropped write on a network mount, a path race). Without a lever for it, G05 is unfalsifiable
  // in this fixture — which is how it stayed a WARN.
  mockFsBehavior: { silentWrites: false },
  mockAgentRegistry: {
    getAgent: vi.fn(),
    // 2026-05-06: ChangePlugin's G11b (rolePluginSwap programArgs rewrite)
    // calls loadAgents() to find an agent by workingDirectory when agentId
    // is null, and updateAgent() to persist the rewritten programArgs.
    // Default mocks return empty/no-op so tests that don't use G11b are
    // unaffected.
    loadAgents: vi.fn().mockReturnValue([]),
    updateAgent: vi.fn().mockResolvedValue(undefined),
  },
  mockClientCapabilities: {
    detectClientType: vi.fn().mockReturnValue('claude'),
  },
}))

// Mock child_process (execFile via promisify)
//
// A SUCCESSFUL `claude plugin <verb>` also applies the CLI's own side effect to the overlay. Without
// this, a user-scope install is a pure no-op here — the CLI does the settings write, and a mocked
// CLI writes nothing — so the fixture asserted an install "succeeded" while the settings file it
// was supposed to have updated still lacked the plugin. Modelling `writeFile` alone cannot fix that
// case, because nothing ever calls `writeFile` on the user-scope path (TRDD-RO90UCKQ).
const applyClaudeCliEffect = async (file: unknown, argv: unknown, opts: unknown) => {
  if (String(file) !== 'claude' || !Array.isArray(argv) || argv[0] !== 'plugin') return
  const a = argv as string[]
  const [, verb, name, marketplace] = a
  const scopeIdx = a.indexOf('--scope')
  const scope = scopeIdx === -1 ? 'local' : a[scopeIdx + 1]
  const key = marketplace && !marketplace.startsWith('--') ? `${name}@${marketplace}` : name

  // USER scope writes ~/.claude/settings.json; LOCAL scope writes the agent's
  // .claude/settings.local.json — and the agent dir arrives as the SPAWN CWD, not as a flag
  // (`claude` has no --cwd option; passing one exits 0 having done nothing).
  const cwd = (opts as { cwd?: string } | undefined)?.cwd
  if (scope !== 'user' && !cwd) return
  const path = scope === 'user'
    ? `${process.env.HOME}/.claude/settings.json`
    : `${cwd}/.claude/settings.local.json`

  // Read the CURRENT body the same way the readFile mock does — overlay first, per-test baseline
  // otherwise. Starting from `{}` would silently drop whatever else the fixture seeded.
  let raw = mockFsContent.get(path)
  if (raw === undefined) { try { raw = String(await mockFsReadFile(path, 'utf-8')) } catch { raw = '{}' } }
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) as Record<string, unknown> } catch { return }  // unparseable: leave it

  const ep = { ...((body.enabledPlugins || {}) as Record<string, boolean>) }
  if (verb === 'install' || verb === 'enable') ep[key] = true
  else if (verb === 'disable') ep[key] = false
  else if (verb === 'uninstall') delete ep[key]
  else return
  fsTrack.create(path, JSON.stringify({ ...body, enabledPlugins: ep }, null, 2))
}

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    // promisify wraps execFile to return a promise via a callback
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void
    mockExecFileAsync(args[0], args[1], args[2])
      .then(async (result: { stdout: string; stderr: string }) => {
        await applyClaudeCliEffect(args[0], args[1], args[2])
        cb(null, result)
      })
      .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
  },
}))

// ── The in-memory filesystem overlay ────────────────────────────────────────
// A mutating fs call records its effect; `existsSync` consults those records BEFORE falling back to
// the per-test baseline. Without this, a mocked write is a no-op, so no post-install/post-remove
// assertion in this file could ever discriminate — which is precisely why the pipelines' G05
// post-conditions were only WARNings for so long: they were unfalsifiable here.
// Scope of the model: exact paths, plus subtree removal (deleting a directory removes what is under
// it). It does NOT synthesise ancestors for `mkdir -p`; no pipeline gate checks a parent's existence.
const fsTrack = {
  create: (p: unknown, body?: unknown) => {
    if (mockFsBehavior.silentWrites) return
    const s = String(p); mockFsDeleted.delete(s); mockFsCreated.add(s)
    if (typeof body === 'string') mockFsContent.set(s, body)
  },
  destroy: (p: unknown) => {
    const s = String(p)
    for (const c of [...mockFsCreated]) if (c === s || c.startsWith(`${s}/`)) { mockFsCreated.delete(c); mockFsContent.delete(c) }
    mockFsContent.delete(s)
    mockFsDeleted.add(s)
  },
  // `saveJsonSafe` writes to `<path>.tmp.N` then renames — so the CONTENT has to travel with the
  // rename, or the atomic-write path lands an existing-but-empty file and every read-back sees the
  // stale baseline instead of what was just written.
  move: (from: unknown, to: unknown) => {
    const body = mockFsContent.get(String(from))
    fsTrack.create(to, body)
    fsTrack.destroy(from)
  },
}

vi.mock('fs/promises', () => ({
  // Consult the overlay FIRST so a write feeds back into the next read; fall back to the per-test
  // baseline for paths nothing has written. Without this a fixture asserts that an install
  // "succeeded" while the settings file it just wrote still lacks the plugin.
  readFile: vi.fn(async (p: unknown, ...rest: unknown[]) => {
    const s = String(p)
    if (mockFsContent.has(s)) return mockFsContent.get(s)
    return mockFsReadFile(p, ...rest)
  }),
  // Call THROUGH to the exported spy first (so `expect(mockFsWriteFile).toHaveBeenCalledWith(...)`
  // and any per-test `mockRejectedValue` still behave), and record the path only once it resolved —
  // a write that threw must NOT mark its target as existing.
  writeFile: vi.fn(async (p: unknown, ...rest: unknown[]) => {
    const r = await mockFsWriteFile(p, ...rest); fsTrack.create(p, rest[0]); return r
  }),
  mkdir: vi.fn(async (p: unknown, ...rest: unknown[]) => {
    const r = await mockFsMkdir(p, ...rest); fsTrack.create(p); return r
  }),
  readdir: mockFsReaddir,
  rm: vi.fn(async (p: unknown) => { fsTrack.destroy(p) }),
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
  // 2026-05-04: saveJsonSafe and the cross-process settings lock
  // (MAJ-01 + MAJ-02 fixes) now use rename + copyFile from fs/promises.
  // The mock must resolve them so the test path doesn't throw
  // "rename is not a function" before the assertion runs.
  rename: vi.fn(async (from: unknown, to: unknown) => { fsTrack.move(from, to) }),
  copyFile: vi.fn(async (from: unknown, to: unknown) => { fsTrack.create(to, mockFsContent.get(String(from))) }),
  // `updateJson` writes through a FILE HANDLE (open → writeFile → sync → close) rather than a bare
  // `writeFile`, because it fsyncs the tmp file before the rename. The overlay has to model that or
  // the tmp path stays empty and the existing `rename` handler carries NOTHING to the target — an
  // install would then "succeed" over a settings file that never gained the plugin, which is the
  // exact vacuous-fixture shape this overlay was built to remove. Recording at the tmp path makes
  // the bytes travel through `fsTrack.move` unchanged, like every other atomic write here.
  open: vi.fn(async (p: unknown, ...rest: unknown[]) => {
    // AWAITED, like `writeFile` calls through to its spy: a test that injects a delay or a
    // rejection here must be able to affect the write, which a fire-and-forget call would swallow.
    await mockFsOpen(p, ...rest)
    return {
      writeFile: async (data: unknown) => { fsTrack.create(p, data) },
      sync: async () => {},
      close: async () => {},
    }
  }),
  // Backup pruning past BACKUP_KEEP reaches for it; absent, the mock throws "No unlink export".
  unlink: vi.fn(async (p: unknown) => { fsTrack.destroy(p) }),
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => {
    const s = String(p)
    // Most recent effect wins; `destroy` clears the created entry, so the two sets cannot disagree.
    if (mockFsCreated.has(s)) return true
    if (mockFsDeleted.has(s)) return false
    return mockFsExistsSync(p) as boolean
  },
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/client-capabilities', () => mockClientCapabilities)

// ============================================================================
// authContext is mandatory on every Change*/Delete* entry point since the
// 2026-04-19 P0-001 refactor. Tests use this shared test-scope authContext
// and pass it explicitly at every call site.
// ============================================================================
const _tAuth = { isSystemOwner: true as const }

/**
 * What actually LANDED at a path, whichever fs verb the writer used.
 *
 * Introspecting `mockFsWriteFile.mock.calls` asks WHICH VERB was called, and that question went
 * stale the moment TRDD-RYFP030K moved these writers to `updateJson` — which writes through a file
 * HANDLE (open → writeFile → sync) so `writeFile` is never called with `(path, data)` at all. The
 * truthy assertions failed loudly, which is fine; the danger was the ABSENCE assertion at
 * `installPluginLocally`, which would have gone on passing while checking nothing, because
 * `undefined` is exactly what it wants. Asserting on CONTENT is mechanism-independent: it holds for
 * `saveJsonSafe`, for `updateJson`, and for whatever replaces it next.
 *
 * `endsWith`, not `includes`: `updateJson` keeps a backup and writes through a tmp file, so
 * `<path>.backup.N` and `<path>.tmp.N` both live in the overlay and a substring match would happily
 * return one of those instead of the target.
 */
const writtenSettings = (suffix: string): string | undefined => {
  for (const [p, body] of mockFsContent) if (p.endsWith(suffix)) return body
  return undefined
}

/**
 * Did OUR OWN CODE write this file — as opposed to the `claude` CLI, whose effect the harness
 * models via `applyClaudeCliEffect`?
 *
 * CONTENT CANNOT ANSWER THIS, and that distinction is the whole claim of the
 * "…and write no settings itself" tests: `applyClaudeCliEffect` reaches `fsTrack` directly, so the
 * settings file ends up correct either way and a content check calls both cases identical. Only the
 * fs VERBS separate them, because the CLI mock touches none of them.
 *
 * Both `writeFile` and `open` are consulted: `saveJsonSafe` wrote the tmp file with the former,
 * `updateJson` opens a handle with the latter, and a check that knows only one of them silently
 * stops discriminating the day a writer switches — which is exactly how the old version of this
 * assertion turned into a guard that passed while measuring nothing.
 */
const serviceWroteSettings = (needle: string): boolean =>
  [...mockFsWriteFile.mock.calls, ...mockFsOpen.mock.calls]
    .some((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes(needle))

// ============================================================================
// Tests
// ============================================================================

describe('element-management-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFixtureCounter()
    mockFsExistsSync.mockReturnValue(false)
    mockFsReadFile.mockResolvedValue('{}')
    // The overlay is per-test state, and vi.clearAllMocks() cannot know about it.
    mockFsCreated.clear()
    mockFsDeleted.clear()
    mockFsContent.clear()
    mockFsBehavior.silentWrites = false
    mockFsReaddir.mockResolvedValue([])
  })

  describe('installPluginLocally', () => {
    it('should reject invalid plugin names', async () => {
      /** Validates that plugin names containing invalid characters are rejected */
      const { installPluginLocally } = await import('@/services/element-management-service')
      await expect(installPluginLocally('bad/name', '/tmp/test')).rejects.toThrow('Invalid plugin name')
    })

    it('should reject path traversal in agentDir', async () => {
      /** Validates that directory paths with ".." are rejected for security */
      const { installPluginLocally } = await import('@/services/element-management-service')
      await expect(installPluginLocally('test-plugin', '/tmp/../etc')).rejects.toThrow('must not contain ".."')
    })

    it('should use Claude CLI for predefined marketplace plugins', async () => {
      /** Validates that predefined plugins are installed via claude CLI with --scope local */
      const { installPluginLocally } = await import('@/services/element-management-service')
      await installPluginLocally('ai-maestro-architect-agent', '/tmp/agent-dir', 'ai-maestro-plugins')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'install', 'ai-maestro-architect-agent', 'ai-maestro-plugins', '--scope', 'local'],
        expect.objectContaining({ cwd: '/tmp/agent-dir' }),
      )
    })

    it('should use Claude CLI for local/custom-marketplace plugins TOO, and write no settings itself', async () => {
      /** Validates R20.29 case (c): a local-marketplace source installs through the client protocol */
      // This test asserted the OPPOSITE until TRDD-RCL2HC9Y — that a local marketplace was
      // installed by hand-writing settings.local.json and never calling the CLI. R20.29 names
      // "(c) one of the 3 AI Maestro local marketplaces" among the sources for which "the install
      // step ALWAYS invokes the client's own protocol", so the old assertion pinned a violation.
      // The live spike also disproved the branch's premise: the CLI resolves a directory
      // marketplace fine. Note this is the same argv as the predefined-marketplace test above —
      // that identity IS the property.
      const { installPluginLocally } = await import('@/services/element-management-service')
      await installPluginLocally('my-custom-plugin', '/tmp/agent-dir', 'ai-maestro-local-roles-marketplace')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'install', 'my-custom-plugin', 'ai-maestro-local-roles-marketplace', '--scope', 'local'],
        expect.objectContaining({ cwd: '/tmp/agent-dir' }),
      )
      // …and we no longer hand-write the agent's settings for it: the CLI owns that file now,
      // exactly as it already did for every other marketplace.
      expect(serviceWroteSettings('settings.local.json'), 'installPluginLocally must not write settings.local.json itself').toBe(false)
    })

    it('should resolve ~ in agentDir', async () => {
      /** Validates that tilde paths are expanded to the home directory */
      const { installPluginLocally } = await import('@/services/element-management-service')
      await installPluginLocally('my-plugin', '~/agents/test', 'ai-maestro-local-roles-marketplace')

      // Should not throw — tilde was resolved
      expect(mockFsMkdir).toHaveBeenCalled()
    })
  })

  describe('uninstallPluginLocally', () => {
    it('should reject invalid plugin names', async () => {
      /** Validates that plugin names with invalid characters are rejected on uninstall */
      const { uninstallPluginLocally } = await import('@/services/element-management-service')
      await expect(uninstallPluginLocally('bad!name', '/tmp/test')).rejects.toThrow('Invalid plugin name')
    })

    it('should use Claude CLI for predefined marketplace plugins', async () => {
      /** Validates that predefined plugins are uninstalled via claude CLI */
      const { uninstallPluginLocally } = await import('@/services/element-management-service')
      await uninstallPluginLocally('ai-maestro-architect-agent', '/tmp/agent-dir', 'ai-maestro-plugins')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'uninstall', 'ai-maestro-architect-agent', 'ai-maestro-plugins', '--scope', 'local'],
        expect.objectContaining({ cwd: '/tmp/agent-dir' }),
      )
    })

    it('should clean up settings.local.json for local/custom plugins', async () => {
      /** Validates the OUTCOME of an uninstall: the plugin key is gone, its neighbour survives */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@local-marketplace': true, 'other-plugin@local-marketplace': true },
      }))

      const { uninstallPluginLocally } = await import('@/services/element-management-service')
      await uninstallPluginLocally('my-plugin', '/tmp/agent-dir', 'local-marketplace')

      // Assert the END STATE, not which layer produced it. This used to assert that a `writeFile`
      // call happened — true only because the CLI mock was a no-op, so the service's belt-and-braces
      // fallback was the ONLY thing that could remove the key. Now that the mock models what
      // `claude plugin uninstall` really does (it DOES drop the settings entry; SCEN-019 BUG-001 is
      // that it leaves the CACHE FOLDER), the happy path no longer needs the fallback — so the
      // fallback gets its own test below rather than being smuggled in here.
      const settings = JSON.parse(mockFsContent.get('/tmp/agent-dir/.claude/settings.local.json')!)
      expect(settings.enabledPlugins['my-plugin@local-marketplace']).toBeUndefined()
      expect(settings.enabledPlugins['other-plugin@local-marketplace']).toBe(true)
    })

    it('belt-and-braces: removes the key even when the CLI uninstall FAILS', async () => {
      /** Validates the safeguard sweep — the CLI errored, so only the service can remove the key */
      // The one case the safeguard exists for. `execFileAsync` throwing is caught and swallowed
      // (the catch only downgrades to a warn), and the sweep then runs anyway — so with the CLI
      // dead this key can ONLY disappear via the service's own cleanup. Delete that block and this
      // test is the thing that reds; the happy-path test above would not, because there the CLI
      // does the removal itself.
      //
      // NOT asserted: that the sweep removes a DIFFERENTLY-spelled key. It does not, by design —
      // it deletes exactly `pluginName@marketplaceName`, "a second writer that can only ever
      // converge on the CLI's own outcome". An earlier draft of this test asserted that and failed,
      // correctly: it was a requirement I invented, not one the service ever had.
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@local-marketplace': true, 'other-plugin@local-marketplace': true },
      }))
      // ...Once, NOT mockRejectedValue: an implementation override is NOT undone by
      // `vi.clearAllMocks()` (it clears CALLS, not IMPLEMENTATIONS), so the persistent form leaked a
      // rejecting `claude` into all 24 later tests that shell out. Scoped to the one call under test.
      mockExecFileAsync.mockRejectedValueOnce(new Error('claude: command failed'))

      const { uninstallPluginLocally } = await import('@/services/element-management-service')
      await uninstallPluginLocally('my-plugin', '/tmp/agent-dir', 'local-marketplace')

      const settings = JSON.parse(mockFsContent.get('/tmp/agent-dir/.claude/settings.local.json')!)
      expect(settings.enabledPlugins['my-plugin@local-marketplace']).toBeUndefined()
      expect(settings.enabledPlugins['other-plugin@local-marketplace']).toBe(true)
    })
  })

  describe('uninstallAllRolePlugins', () => {
    it('should attempt to uninstall all title-mapped plugins', async () => {
      /** Validates that all predefined role-plugins are uninstalled from agent dir */
      const { uninstallAllRolePlugins } = await import('@/services/element-management-service')
      await uninstallAllRolePlugins('/tmp/agent-dir')

      // Should attempt to uninstall each title-mapped plugin (9 titles in TITLE_PLUGIN_MAP:
      // MANAGER, CHIEF-OF-STAFF, ARCHITECT, INTEGRATOR, ORCHESTRATOR, MEMBER, MAINTAINER,
      // AUTONOMOUS, and ASSISTANT — the R39.2 user-assistant role-plugin added with the
      // R36/R37/R38 user-authority model).
      expect(mockExecFileAsync).toHaveBeenCalledTimes(9)
    })
  })

  describe('syncRolePlugin', () => {
    it('should return null and warn when agent not found', async () => {
      /** Validates graceful handling when agent ID does not exist in registry */
      mockAgentRegistry.getAgent.mockReturnValue(null)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { syncRolePlugin } = await import('@/services/element-management-service')
      const result = await syncRolePlugin('non-existent-id', 'manager')

      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('should return null and warn when agent has no working directory', async () => {
      /** Validates graceful handling when agent has no working directory */
      mockAgentRegistry.getAgent.mockReturnValue(makeAgent({ workingDirectory: undefined, sessions: [] }))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { syncRolePlugin } = await import('@/services/element-management-service')
      const result = await syncRolePlugin('agent-1', null)

      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('should uninstall all role-plugins when title is null', async () => {
      /** Validates that clearing a title removes all role-plugins */
      const agent = makeAgent({ workingDirectory: '/tmp/agent-dir' })
      mockAgentRegistry.getAgent.mockReturnValue(agent)

      const { syncRolePlugin } = await import('@/services/element-management-service')
      const result = await syncRolePlugin(agent.id, null)

      expect(result).toBeNull()
      // Should have tried to uninstall title-mapped plugins
      expect(mockExecFileAsync).toHaveBeenCalled()
    })

    it('should install required plugin for a title like manager', async () => {
      /** Validates that setting MANAGER title installs the manager role-plugin */
      const agent = makeAgent({ workingDirectory: '/tmp/agent-dir', program: 'claude-code' })
      mockAgentRegistry.getAgent.mockReturnValue(agent)
      mockClientCapabilities.detectClientType.mockReturnValue('claude')

      const { syncRolePlugin } = await import('@/services/element-management-service')
      const result = await syncRolePlugin(agent.id, 'manager')

      expect(result).toBe('ai-maestro-assistant-manager-agent')
    })

    it('should install programmer plugin for MEMBER title', async () => {
      /** Validates that MEMBER title installs the programmer role-plugin */
      const agent = makeAgent({ workingDirectory: '/tmp/agent-dir', program: 'claude-code' })
      mockAgentRegistry.getAgent.mockReturnValue(agent)
      mockClientCapabilities.detectClientType.mockReturnValue('claude')

      const { syncRolePlugin } = await import('@/services/element-management-service')
      const result = await syncRolePlugin(agent.id, 'member')

      // MEMBER now maps to ai-maestro-programmer-agent
      expect(result).toBe('ai-maestro-programmer-agent')
    })
  })

  describe('autoAssignRolePluginForTitle', () => {
    it('should return programmer plugin for MEMBER title', async () => {
      /** Validates that MEMBER title now returns the programmer role-plugin */
      mockAgentRegistry.getAgent.mockReturnValue(makeAgent({ workingDirectory: '/tmp/agent-dir', program: 'claude-code' }))
      mockClientCapabilities.detectClientType.mockReturnValue('claude')
      const { autoAssignRolePluginForTitle } = await import('@/services/element-management-service')
      const result = await autoAssignRolePluginForTitle('member' as never, 'agent-1')
      expect(result).toBe('ai-maestro-programmer-agent')
    })

    it('should throw when agent is not found', async () => {
      /** Validates that auto-assign fails for non-existent agents */
      mockAgentRegistry.getAgent.mockReturnValue(null)
      const { autoAssignRolePluginForTitle } = await import('@/services/element-management-service')
      await expect(autoAssignRolePluginForTitle('manager' as never, 'ghost')).rejects.toThrow('not found')
    })

    it('should attempt conversion for non-Claude agents with title-locked roles', async () => {
      /** Validates that non-Claude agents use the adapter system for role-plugin installation */
      mockAgentRegistry.getAgent.mockReturnValue(makeAgent({ program: 'codex', workingDirectory: '/tmp/test-codex-agent' }))
      mockClientCapabilities.detectClientType.mockReturnValue('codex')

      const { autoAssignRolePluginForTitle } = await import('@/services/element-management-service')
      // Will throw because the source plugin dir doesn't exist in test env,
      // but it should NOT throw "Cannot assign" — it should attempt conversion
      await expect(autoAssignRolePluginForTitle('manager' as never, 'agent-1')).rejects.not.toThrow('Cannot assign')
    })
  })

  describe('installPlugin (new wrapper)', () => {
    it('should reject role-plugin names to enforce syncRolePlugin path', async () => {
      /** Validates that role-plugins cannot be installed via the generic installPlugin function */
      const { installPlugin } = await import('@/services/element-management-service')
      await expect(
        installPlugin('ai-maestro-architect-agent', 'ai-maestro-plugins', { scope: 'local', agentDir: '/tmp/test' })
      ).rejects.toThrow('syncRolePlugin')
    })

    it('should install non-role plugins via Claude CLI for user scope', async () => {
      /** Validates that generic plugins with user scope use claude CLI install */
      const { installPlugin } = await import('@/services/element-management-service')
      await installPlugin('my-generic-plugin', 'some-marketplace', { scope: 'user' })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'install', 'my-generic-plugin', 'some-marketplace', '--scope', 'user'],
        expect.any(Object),
      )
    })

    it('should install non-role plugins locally by writing settings for local scope', async () => {
      /** Validates that generic plugins with local scope write to settings.local.json */
      const { installPlugin } = await import('@/services/element-management-service')
      await installPlugin('my-generic-plugin', 'some-marketplace', { scope: 'local', agentDir: '/tmp/test' })

      expect(writtenSettings('settings.local.json')).toBeTruthy()
    })

    it('should require agentDir for local scope', async () => {
      /** Validates that local scope requires an agentDir parameter */
      const { installPlugin } = await import('@/services/element-management-service')
      await expect(
        installPlugin('my-plugin', 'some-marketplace', { scope: 'local' })
      ).rejects.toThrow('agentDir is required')
    })
  })

  describe('uninstallPlugin (new wrapper)', () => {
    it('should use Claude CLI for user scope', async () => {
      /** Validates that user-scope uninstall uses claude CLI */
      const { uninstallPlugin } = await import('@/services/element-management-service')
      await uninstallPlugin('my-plugin', 'some-marketplace', { scope: 'user' })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'uninstall', 'my-plugin', 'some-marketplace', '--scope', 'user'],
        expect.any(Object),
      )
    })
  })

  describe('enablePlugin', () => {
    it('should use Claude CLI for user scope', async () => {
      /** Validates that enabling a user-scope plugin uses claude CLI */
      const { enablePlugin } = await import('@/services/element-management-service')
      await enablePlugin('my-plugin@some-marketplace', { scope: 'user' })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'enable', 'my-plugin@some-marketplace', '--scope', 'user'],
        expect.any(Object),
      )
    })

    it('should write settings.local.json for local scope', async () => {
      /** Validates that enabling a local-scope plugin writes to settings */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@marketplace': false },
      }))

      const { enablePlugin } = await import('@/services/element-management-service')
      await enablePlugin('my-plugin@marketplace', { scope: 'local', agentDir: '/tmp/test' })

      const written = writtenSettings('settings.local.json')
      expect(written).toBeTruthy()
      const writtenData = JSON.parse(written!)
      expect(writtenData.enabledPlugins['my-plugin@marketplace']).toBe(true)
    })

    it('should require agentDir for local scope', async () => {
      /** Validates that local scope enable requires agentDir */
      const { enablePlugin } = await import('@/services/element-management-service')
      await expect(
        enablePlugin('my-plugin@marketplace', { scope: 'local' })
      ).rejects.toThrow('agentDir is required')
    })
  })

  describe('disablePlugin', () => {
    it('should use Claude CLI for user scope', async () => {
      /** Validates that disabling a user-scope plugin uses claude CLI */
      const { disablePlugin } = await import('@/services/element-management-service')
      await disablePlugin('my-plugin@some-marketplace', { scope: 'user' })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'disable', 'my-plugin@some-marketplace', '--scope', 'user'],
        expect.any(Object),
      )
    })

    it('should write settings.local.json for local scope', async () => {
      /** Validates that disabling a local-scope plugin writes false to settings */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@marketplace': true },
      }))

      const { disablePlugin } = await import('@/services/element-management-service')
      await disablePlugin('my-plugin@marketplace', { scope: 'local', agentDir: '/tmp/test' })

      const written = writtenSettings('settings.local.json')
      expect(written).toBeTruthy()
      const writtenData = JSON.parse(written!)
      expect(writtenData.enabledPlugins['my-plugin@marketplace']).toBe(false)
    })
  })

  describe('withSettingsLock (mutex)', () => {
    it('should serialize concurrent writes to the same settings file', async () => {
      /** Validates that concurrent settings operations are serialized via mutex */
      const callOrder: string[] = []

      // Track call order with a delay on the verb that PERFORMS the payload write. That is `open`
      // since TRDD-RYFP030K moved these writers to `updateJson` — hooking `writeFile` here now
      // records nothing at all, and `settingsWrites.length` would be 0 rather than interleaved,
      // i.e. the test would report a serialization failure that never happened.
      mockFsOpen.mockImplementation(async (path: string) => {
        callOrder.push(`start:${path}`)
        await new Promise(r => setTimeout(r, 10))
        callOrder.push(`end:${path}`)
      })

      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))

      const { enablePlugin, disablePlugin } = await import('@/services/element-management-service')

      // Fire two operations concurrently on the SAME settings file
      await Promise.all([
        enablePlugin('plugin-a@mp', { scope: 'local', agentDir: '/tmp/test' }),
        disablePlugin('plugin-b@mp', { scope: 'local', agentDir: '/tmp/test' }),
      ])

      // The writes should be serialized (not interleaved)
      // We should see start1, end1, start2, end2 pattern for the SAME file
      // `.json.tmp` isolates the PAYLOAD write. `updateJson` also opens a tmp file for the backup
      // it keeps (`…settings.local.json.aim-bak-<stamp>.tmp`), so matching the bare filename would
      // count two opens per operation and the expected 4 would silently become 8.
      const settingsWrites = callOrder.filter(c => c.includes('settings.local.json.tmp'))
      expect(settingsWrites.length).toBe(4) // 2 starts + 2 ends
      // First operation completes before second starts
      expect(settingsWrites[0]).toMatch(/^start:/)
      expect(settingsWrites[1]).toMatch(/^end:/)
      expect(settingsWrites[2]).toMatch(/^start:/)
      expect(settingsWrites[3]).toMatch(/^end:/)
    })
  })

  describe('ChangePlugin', () => {
    it('should reject invalid plugin name format', async () => {
      /** Validates G01: plugin names must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ */
      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'bad/name',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid plugin name/)
    })

    it('should reject role-plugin names with guidance to use ChangeTitle', async () => {
      /** Validates G02: role-plugins must use ChangeTitle, not ChangePlugin */
      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'ai-maestro-architect-agent',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/ChangeTitle/)
    })

    it('should resolve agent context from agentId for local scope', async () => {
      /** Validates G03: agent lookup and workingDirectory extraction */
      const agent = makeAgent({ workingDirectory: '/tmp/agent-dir' })
      mockAgentRegistry.getAgent.mockReturnValue(agent)
      mockFsExistsSync.mockReturnValue(false)

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(agent.id, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'local',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockAgentRegistry.getAgent).toHaveBeenCalledWith(agent.id)
    })

    it('should fail when local scope has no agentDir', async () => {
      /** Validates G04: local scope requires agentDir */
      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'local',
      }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/agentDir/)
    })

    it('should build correct plugin key', async () => {
      /** Validates G05: pluginKey is name@marketplace */
      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.pluginKey).toBe('my-plugin@some-marketplace')
    })

    it('should detect no-op for already-installed plugin', async () => {
      /** Validates G07: install when already enabled is a no-op */
      // User scope: ~/.claude/settings.json has the plugin enabled
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('no-op')
      // Should NOT have called execFileAsync
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('should detect no-op for uninstall when not installed', async () => {
      /** Validates G07: uninstall when not present is a no-op */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'uninstall',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('no-op')
    })

    it('should detect no-op for enable when already enabled', async () => {
      /** Validates G07: enable when already true is a no-op */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'enable',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('no-op')
    })

    it('should detect no-op for disable when already disabled', async () => {
      /** Validates G07: disable when already false is a no-op */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': false },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'disable',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('no-op')
    })

    it('should reject uninstall of title-required plugin', async () => {
      /** Validates G08: cannot uninstall plugin required by agent title */
      const agent = makeAgent({
        workingDirectory: '/tmp/agent-dir',
        governanceTitle: 'chief-of-staff' as never,
      })
      mockAgentRegistry.getAgent.mockReturnValue(agent)
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'ai-maestro-chief-of-staff@ai-maestro-plugins': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      // Note: this would normally be blocked by G02, but G08 handles the case
      // where a non-predefined plugin happens to be the required plugin for a title.
      // For testing, we'll test with a plugin that is not in PREDEFINED but is
      // returned by getRequiredPluginForTitle. However since all title-required
      // plugins ARE predefined, G02 would catch them first.
      // So this test validates that even when called for a generic plugin on an
      // agent with a title, G08 does not false-positive block.
      const result = await ChangePlugin(agent.id, {
        name: 'my-custom-plugin',
        marketplace: 'some-marketplace',
        action: 'uninstall',
        scope: 'local',
      }, _tAuth)
      // my-custom-plugin is NOT the required plugin for chief-of-staff
      // so G08 should pass and uninstall should proceed
      expect(result.success).toBe(true)
    })

    it('should install user-scope plugin via Claude CLI', async () => {
      /** Validates G09: install+user dispatches to execFileAsync */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('install')
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'install', 'my-plugin', 'some-marketplace', '--scope', 'user'],
        expect.objectContaining({ timeout: 120000 }),
      )
      expect(result.restartNeeded).toBe(true)
    })

    it('should install local-scope plugin via installPluginLocally', async () => {
      /** Validates G09: install+local uses installPluginLocally helper */
      mockFsExistsSync.mockReturnValue(false)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'local',
        agentDir: '/tmp/agent-dir',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.restartNeeded).toBe(true)
    })

    it('should enable user-scope plugin via Claude CLI', async () => {
      /** Validates G09: enable+user dispatches to execFileAsync */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': false },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'enable',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('enable')
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'enable', 'my-plugin@some-marketplace', '--scope', 'user'],
        expect.objectContaining({ timeout: 30000 }),
      )
    })

    it('should disable user-scope plugin via Claude CLI', async () => {
      /** Validates G09: disable+user dispatches to execFileAsync */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'disable',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('disable')
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'disable', 'my-plugin@some-marketplace', '--scope', 'user'],
        expect.objectContaining({ timeout: 30000 }),
      )
    })

    it('should enable local-scope plugin by writing settings.local.json', async () => {
      /** Validates G09: enable+local writes to settings.local.json */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': false },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'enable',
        scope: 'local',
        agentDir: '/tmp/agent-dir',
      }, _tAuth)
      expect(result.success).toBe(true)
      const written = writtenSettings('settings.local.json')
      expect(written).toBeTruthy()
      const writtenData = JSON.parse(written!)
      expect(writtenData.enabledPlugins['my-plugin@some-marketplace']).toBe(true)
    })

    it('should disable local-scope plugin by writing settings.local.json', async () => {
      /** Validates G09: disable+local writes false to settings.local.json */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'disable',
        scope: 'local',
        agentDir: '/tmp/agent-dir',
      }, _tAuth)
      expect(result.success).toBe(true)
      const written = writtenSettings('settings.local.json')
      expect(written).toBeTruthy()
      const writtenData = JSON.parse(written!)
      expect(writtenData.enabledPlugins['my-plugin@some-marketplace']).toBe(false)
    })

    it('should update local plugin via uninstall+reinstall', async () => {
      /** Validates G09: update+local uninstalls then reinstalls */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'update',
        scope: 'local',
        agentDir: '/tmp/agent-dir',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(result.action).toBe('update')
      expect(result.restartNeeded).toBe(true)
    })

    it('should set restartNeeded=true for install/uninstall/update', async () => {
      /** Validates G12: install/uninstall/update always need restart */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.restartNeeded).toBe(true)
    })

    it('should set restartNeeded=true for enable/disable', async () => {
      /** Validates G12: enable/disable also need restart (plugin list changed) */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': false },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'enable',
        scope: 'user',
      }, _tAuth)
      expect(result.restartNeeded).toBe(true)
    })

    it('should return operations log with gate names', async () => {
      /** Validates that result.operations includes gate prefixes */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.operations.length).toBeGreaterThan(0)
      // First op is the authzAndAudit G00 entry (system-owner authorization).
      // All subsequent ops also begin with a gate prefix (G\d\d or PG\d\d).
      expect(result.operations[0]).toMatch(/^G\d{2}:/)
    })

    it('should handle errors gracefully and return success=false', async () => {
      /** Validates that execution errors are caught and returned in result.error */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }))
      mockExecFileAsync.mockRejectedValueOnce(new Error('CLI crashed'))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'install',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/CLI crashed/)
    })

    it('should use update action for user scope via Claude CLI', async () => {
      /** Validates G09: update+user dispatches update command to CLI */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { 'my-plugin@some-marketplace': true },
      }))

      const { ChangePlugin } = await import('@/services/element-management-service')
      const result = await ChangePlugin(null, {
        name: 'my-plugin',
        marketplace: 'some-marketplace',
        action: 'update',
        scope: 'user',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'update', 'my-plugin', 'some-marketplace', '--scope', 'user'],
        expect.objectContaining({ timeout: 120000 }),
      )
    })

    // ── G11b: rolePluginSwap programArgs rewrite ─────────────
    // Verifies the gate added 2026-05-06 that prevents the RoleTab N:1
    // dropdown from leaving an agent's --agent flag pointing at the OLD
    // role-plugin's main-agent file (which no longer exists post-swap),
    // so the next /api/sessions/[id]/restart relaunches claude with the
    // CORRECT --agent flag without the UI having to do a separate PATCH.
    describe('G11b: rolePluginSwap programArgs rewrite', () => {
      it('rewrites --agent flag when rolePluginSwap=true and action=install', async () => {
        // Set up: a claude agent currently using the old role-plugin
        const agent = makeAgent({
          id: 'agent-swap-1',
          program: 'claude',
          programArgs: '--agent old-plugin-main-agent --name my-bot',
          workingDirectory: '/tmp/agent-swap-1',
        })
        mockAgentRegistry.getAgent.mockReturnValue(agent)
        mockAgentRegistry.loadAgents.mockReturnValue([agent])
        mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
        // Plugin install path: the current settings.local.json doesn't
        // contain the new plugin yet, so install proceeds (no idempotent skip).
        mockFsExistsSync.mockReturnValue(false)

        const { ChangePlugin } = await import('@/services/element-management-service')
        const result = await ChangePlugin(agent.id, {
          name: 'new-role-plugin',
          marketplace: 'some-marketplace',
          action: 'install',
          scope: 'local',
          agentDir: agent.workingDirectory,
          rolePluginSwap: true,
        }, _tAuth)

        expect(result.success).toBe(true)
        expect(result.restartNeeded).toBe(true)
        // updateAgent should have been called with the rewritten args:
        // --agent <newPlugin>-main-agent --name my-bot
        expect(mockAgentRegistry.updateAgent).toHaveBeenCalledWith(
          agent.id,
          expect.objectContaining({
            programArgs: expect.stringContaining('--agent new-role-plugin-main-agent'),
          }),
        )
      })

      it('does NOT rewrite when rolePluginSwap is false (regular install)', async () => {
        const agent = makeAgent({
          id: 'agent-noswap-1',
          program: 'claude',
          programArgs: '--agent existing-main-agent --name my-bot',
          workingDirectory: '/tmp/agent-noswap-1',
        })
        mockAgentRegistry.getAgent.mockReturnValue(agent)
        mockAgentRegistry.loadAgents.mockReturnValue([agent])
        mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
        mockFsExistsSync.mockReturnValue(false)

        const { ChangePlugin } = await import('@/services/element-management-service')
        const result = await ChangePlugin(agent.id, {
          name: 'just-a-normal-plugin',
          marketplace: 'some-marketplace',
          action: 'install',
          scope: 'local',
          agentDir: agent.workingDirectory,
          // rolePluginSwap omitted (default false)
        }, _tAuth)

        expect(result.success).toBe(true)
        // Plain install must NOT touch programArgs — that flag is reserved
        // for role-plugin swaps (RoleTab N:1) and ChangeTitle's internal
        // role-plugin transition (which has its own G16b).
        expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
      })

      it('does NOT rewrite for non-claude agents (codex, gemini, etc.)', async () => {
        // --agent is a claude-specific CLI flag. Codex/Gemini/Kiro pick
        // their persona from per-client manifest files installed by the
        // adapter, so a programArgs rewrite would be both useless AND
        // potentially harmful (mangling a codex-specific arg string).
        const agent = makeAgent({
          id: 'agent-codex-1',
          program: 'codex',
          programArgs: '--profile some-profile',
          workingDirectory: '/tmp/agent-codex-1',
        })
        mockAgentRegistry.getAgent.mockReturnValue(agent)
        mockAgentRegistry.loadAgents.mockReturnValue([agent])
        mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
        mockFsExistsSync.mockReturnValue(false)

        const { ChangePlugin } = await import('@/services/element-management-service')
        const result = await ChangePlugin(agent.id, {
          name: 'new-role-plugin',
          marketplace: 'some-marketplace',
          action: 'install',
          scope: 'local',
          agentDir: agent.workingDirectory,
          rolePluginSwap: true,
        }, _tAuth)

        expect(result.success).toBe(true)
        expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
      })

      it('does NOT rewrite on uninstall (no new --agent target exists)', async () => {
        const agent = makeAgent({
          id: 'agent-swap-uninstall-1',
          program: 'claude',
          programArgs: '--agent some-plugin-main-agent --name my-bot',
          workingDirectory: '/tmp/agent-swap-uninstall-1',
        })
        mockAgentRegistry.getAgent.mockReturnValue(agent)
        mockAgentRegistry.loadAgents.mockReturnValue([agent])
        mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
        // Settings file MUST exist for the uninstall to proceed past the
        // idempotency check (otherwise it short-circuits as "nothing to
        // remove" and never reaches G11b).
        mockFsExistsSync.mockReturnValue(true)
        mockFsReadFile.mockResolvedValue(JSON.stringify({
          enabledPlugins: { 'some-plugin@some-marketplace': true },
        }))

        const { ChangePlugin } = await import('@/services/element-management-service')
        const result = await ChangePlugin(agent.id, {
          name: 'some-plugin',
          marketplace: 'some-marketplace',
          action: 'uninstall',
          scope: 'local',
          agentDir: agent.workingDirectory,
          rolePluginSwap: true,
        }, _tAuth)

        // Uninstall path doesn't have a "new" plugin to point --agent at,
        // so G11b skips the rewrite even though rolePluginSwap=true.
        expect(result.success).toBe(true)
        expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
      })
    })
  })

  describe('re-exports from role-plugin-service', () => {
    it('should re-export GITHUB_MARKETPLACE_NAME', async () => {
      /** Validates backward-compatible re-exports exist */
      const rps = await import('@/services/role-plugin-service')
      expect(rps.GITHUB_MARKETPLACE_NAME).toBeDefined()
      expect(typeof rps.GITHUB_MARKETPLACE_NAME).toBe('string')
    })

    it('should re-export installPluginLocally', async () => {
      /** Validates installPluginLocally is still importable from role-plugin-service */
      const rps = await import('@/services/role-plugin-service')
      expect(typeof rps.installPluginLocally).toBe('function')
    })

    it('should re-export uninstallPluginLocally', async () => {
      /** Validates uninstallPluginLocally is still importable from role-plugin-service */
      const rps = await import('@/services/role-plugin-service')
      expect(typeof rps.uninstallPluginLocally).toBe('function')
    })

    it('should re-export syncRolePluginForTitle (alias for syncRolePlugin)', async () => {
      /** Validates backward-compatible syncRolePluginForTitle alias exists */
      const rps = await import('@/services/role-plugin-service')
      expect(typeof rps.syncRolePluginForTitle).toBe('function')
    })

    it('should re-export uninstallAllRolePlugins', async () => {
      /** Validates uninstallAllRolePlugins is still importable from role-plugin-service */
      const rps = await import('@/services/role-plugin-service')
      expect(typeof rps.uninstallAllRolePlugins).toBe('function')
    })

    it('should re-export autoAssignRolePluginForTitle', async () => {
      /** Validates autoAssignRolePluginForTitle is still importable from role-plugin-service */
      const rps = await import('@/services/role-plugin-service')
      expect(typeof rps.autoAssignRolePluginForTitle).toBe('function')
    })
  })

  // ============================================================================
  // ChangeResult interface + new Change* functions (Steps 2-6)
  // ============================================================================

  describe('ChangeResult type', () => {
    it('should export ChangeResult interface', async () => {
      /** Validates the shared ChangeResult type is exported */
      const mod = await import('@/services/element-management-service')
      // TypeScript type — verify via a function that uses it
      expect(typeof mod.ChangeMarketplace).toBe('function')
    })
  })

  describe('ChangeMarketplace', () => {
    it('should reject invalid marketplace name format', async () => {
      /** Validates that marketplace names with slashes are rejected */
      const { ChangeMarketplace } = await import('@/services/element-management-service')
      const result = await ChangeMarketplace({ action: 'add', name: 'bad/name', source: { repo: 'org/repo' } }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid marketplace name/)
    })

    it('should reject add without source', async () => {
      /** Validates that add action requires a source */
      const { ChangeMarketplace } = await import('@/services/element-management-service')
      const result = await ChangeMarketplace({ action: 'add', name: 'my-marketplace' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/source.*required/i)
    })

    it('should add marketplace via CLI with repo source', async () => {
      /** Validates that add dispatches to claude CLI with repo source */
      const { ChangeMarketplace } = await import('@/services/element-management-service')
      const result = await ChangeMarketplace({ action: 'add', name: 'my-mp', source: { repo: 'org/repo' } }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['plugin', 'marketplace', 'add']),
        expect.objectContaining({ timeout: 120000 }),
      )
    })

    it('should remove marketplace via CLI', async () => {
      /** Validates that remove dispatches to claude CLI */
      const { ChangeMarketplace } = await import('@/services/element-management-service')
      const result = await ChangeMarketplace({ action: 'remove', name: 'my-mp' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'marketplace', 'remove', 'my-mp'],
        expect.objectContaining({ timeout: 120000 }),
      )
    })

    it('should update marketplace via CLI', async () => {
      /** Validates that update dispatches to claude CLI */
      const { ChangeMarketplace } = await import('@/services/element-management-service')
      const result = await ChangeMarketplace({ action: 'update', name: 'my-mp' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'marketplace', 'update', 'my-mp'],
        expect.objectContaining({ timeout: 120000 }),
      )
    })

    it('should handle CLI errors gracefully', async () => {
      /** Validates that CLI errors return success=false with error message */
      mockExecFileAsync.mockRejectedValueOnce(new Error('CLI exploded'))
      const { ChangeMarketplace } = await import('@/services/element-management-service')
      const result = await ChangeMarketplace({ action: 'add', name: 'my-mp', source: { repo: 'org/repo' } }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/CLI exploded/)
    })
  })

  describe('ChangeSkill', () => {
    it('should reject names with path traversal', async () => {
      /** Validates that skill names containing .. are rejected */
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: '../hack', action: 'install', scope: 'user', sourcePath: '/tmp/skill' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid.*name|path traversal/i)
    })

    it('should reject names with slashes', async () => {
      /** Validates that skill names containing / are rejected */
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'bad/name', action: 'install', scope: 'user', sourcePath: '/tmp/skill' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid.*name/i)
    })

    it('should reject install without sourcePath', async () => {
      /** Validates that install action requires sourcePath */
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'my-skill', action: 'install', scope: 'user' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/sourcePath.*required/i)
    })

    it('should reject install when sourcePath does not exist', async () => {
      /** Validates that install fails when source directory is missing */
      mockFsExistsSync.mockReturnValue(false)
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'my-skill', action: 'install', scope: 'user', sourcePath: '/tmp/nonexistent' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found|not exist/i)
    })

    it('should reject install when target already exists', async () => {
      /** Validates that install rejects name conflict */
      mockFsExistsSync.mockReturnValue(true)
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'my-skill', action: 'install', scope: 'user', sourcePath: '/tmp/skill' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/already exists|conflict/i)
    })

    it('should remove skill by deleting directory', async () => {
      /** Validates that remove action deletes the skill directory */
      mockFsExistsSync.mockReturnValue(true)
      const { rm: mockRm } = await import('fs/promises')
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'my-skill', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockRm).toHaveBeenCalled()
    })

    it('should reject remove when skill does not exist', async () => {
      /** Validates that remove fails when skill directory is missing */
      mockFsExistsSync.mockReturnValue(false)
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'my-skill', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found|not exist/i)
    })

    it('should resolve agent context for local scope', async () => {
      /** Validates that agentId resolves to workingDirectory for local scope */
      const agent = makeAgent({ workingDirectory: '/tmp/agent-dir' })
      mockAgentRegistry.getAgent.mockReturnValue(agent)
      mockFsExistsSync.mockReturnValue(true)
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(agent.id, { name: 'my-skill', action: 'remove', scope: 'local' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockAgentRegistry.getAgent).toHaveBeenCalledWith(agent.id)
    })
  })

  // ══════════════════════════════════════════════════════════════
  // R50/R51 — element installs are all-or-nothing (TRDD-DQ6XN2VP)
  // ══════════════════════════════════════════════════════════════
  describe('R51.4 — a failed element install leaves NO residue', () => {
    it('ChangeSkill::G04 compensates a half-done copy, so the retry is not blocked', async () => {
      /** Validates that a copy failing mid-way is rolled back rather than leaving a partial skill dir */
      mockFsExistsSync.mockReturnValue(false)
      mockFsCreated.add('/tmp/src-skill') // the source exists; the target must not
      const desired = { name: 'half-copied', action: 'install' as const, scope: 'user' as const, sourcePath: '/tmp/src-skill' }
      const { ChangeSkill } = await import('@/services/element-management-service')

      // copyDirRecursive mkdir's the target, THEN readdir's the source — so a readdir failure is
      // exactly the "target created, contents not copied" shape that used to strand a directory.
      mockFsReaddir.mockRejectedValueOnce(new Error('EIO: simulated mid-copy failure'))
      const failed = await ChangeSkill(null, desired, _tAuth)
      expect(failed.success).toBe(false)

      // THE POINT: before the compensation existed, the orphaned target dir made this retry fail
      // with "already exists" forever, with no UI path to clear it.
      const retry = await ChangeSkill(null, desired, _tAuth)
      expect(retry.success).toBe(true)
      expect(retry.error).toBeUndefined()
    })

    it('ChangeSkill::G05 refuses to report success when the skill is not there afterwards', async () => {
      /** Validates that a silently-dropped copy is reported as a failure, not logged as a warning */
      mockFsExistsSync.mockReturnValue(false)
      mockFsCreated.add('/tmp/src-skill')
      mockFsBehavior.silentWrites = true
      const { ChangeSkill } = await import('@/services/element-management-service')
      const result = await ChangeSkill(null, { name: 'phantom', action: 'install', scope: 'user', sourcePath: '/tmp/src-skill' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/does not exist|NOT installed/i)
    })

    it('changeSimpleElement::G05 refuses to report success when the file is not there afterwards', async () => {
      /** Validates the same post-condition on the shared agent/command/rule/output-style handler */
      mockFsExistsSync.mockReturnValue(false)
      mockFsBehavior.silentWrites = true
      const { ChangeAgentDef } = await import('@/services/element-management-service')
      const result = await ChangeAgentDef(null, { name: 'phantom-agent', action: 'install', scope: 'user', content: '# x' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/does not exist|NOT installed/i)
    })
  })

  describe('ChangeAgentDef', () => {
    it('should reject names with path traversal', async () => {
      /** Validates that agent definition names containing .. are rejected */
      const { ChangeAgentDef } = await import('@/services/element-management-service')
      const result = await ChangeAgentDef(null, { name: '../hack', action: 'install', scope: 'user', content: '# test' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid.*name|path traversal/i)
    })

    it('should install agent definition by writing content', async () => {
      /** Validates that install with content writes the .md file */
      mockFsExistsSync.mockReturnValue(false)
      const { ChangeAgentDef } = await import('@/services/element-management-service')
      const result = await ChangeAgentDef(null, { name: 'my-agent', action: 'install', scope: 'user', content: '# My Agent' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockFsWriteFile).toHaveBeenCalled()
    })

    it('should remove agent definition file', async () => {
      /** Validates that remove deletes the .md file */
      mockFsExistsSync.mockReturnValue(true)
      const { rm: mockRm } = await import('fs/promises')
      const { ChangeAgentDef } = await import('@/services/element-management-service')
      const result = await ChangeAgentDef(null, { name: 'my-agent', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockRm).toHaveBeenCalled()
    })
  })

  describe('ChangeCommand', () => {
    it('should install command by writing content', async () => {
      /** Validates that install with content writes the .md file for commands */
      mockFsExistsSync.mockReturnValue(false)
      const { ChangeCommand } = await import('@/services/element-management-service')
      const result = await ChangeCommand(null, { name: 'my-cmd', action: 'install', scope: 'user', content: '# Command' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockFsWriteFile).toHaveBeenCalled()
    })

    it('should remove command file', async () => {
      /** Validates that remove deletes the command .md file */
      mockFsExistsSync.mockReturnValue(true)
      const { rm: mockRm } = await import('fs/promises')
      const { ChangeCommand } = await import('@/services/element-management-service')
      const result = await ChangeCommand(null, { name: 'my-cmd', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockRm).toHaveBeenCalled()
    })
  })

  describe('ChangeRule', () => {
    it('should install rule by writing content', async () => {
      /** Validates that install with content writes the .md file for rules */
      mockFsExistsSync.mockReturnValue(false)
      const { ChangeRule } = await import('@/services/element-management-service')
      const result = await ChangeRule(null, { name: 'my-rule', action: 'install', scope: 'user', content: '# Rule' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockFsWriteFile).toHaveBeenCalled()
    })

    it('should remove rule file', async () => {
      /** Validates that remove deletes the rule .md file */
      mockFsExistsSync.mockReturnValue(true)
      const { rm: mockRm } = await import('fs/promises')
      const { ChangeRule } = await import('@/services/element-management-service')
      const result = await ChangeRule(null, { name: 'my-rule', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockRm).toHaveBeenCalled()
    })
  })

  describe('ChangeOutputStyle', () => {
    it('should install output style by writing content', async () => {
      /** Validates that install with content writes the .md file for output styles */
      mockFsExistsSync.mockReturnValue(false)
      const { ChangeOutputStyle } = await import('@/services/element-management-service')
      const result = await ChangeOutputStyle(null, { name: 'my-style', action: 'install', scope: 'user', content: '# Style' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockFsWriteFile).toHaveBeenCalled()
    })

    it('should remove output style file', async () => {
      /** Validates that remove deletes the output style .md file */
      mockFsExistsSync.mockReturnValue(true)
      const { rm: mockRm } = await import('fs/promises')
      const { ChangeOutputStyle } = await import('@/services/element-management-service')
      const result = await ChangeOutputStyle(null, { name: 'my-style', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockRm).toHaveBeenCalled()
    })
  })

  describe('ChangeMCP', () => {
    it('should reject invalid server name', async () => {
      /** Validates that MCP server names with path traversal are rejected */
      const { ChangeMCP } = await import('@/services/element-management-service')
      const result = await ChangeMCP(null, { name: '../evil', action: 'add', scope: 'user', config: {} }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid.*name/i)
    })

    it('should reject add without config', async () => {
      /** Validates that add action requires config */
      const { ChangeMCP } = await import('@/services/element-management-service')
      const result = await ChangeMCP(null, { name: 'my-mcp', action: 'add', scope: 'user' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/config.*required/i)
    })

    it('should add MCP server via CLI', async () => {
      /** Validates that add dispatches to claude mcp add-json */
      const { ChangeMCP } = await import('@/services/element-management-service')
      const result = await ChangeMCP(null, {
        name: 'my-mcp',
        action: 'add',
        scope: 'user',
        config: { command: 'node', args: ['server.js'] },
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['mcp', 'add-json']),
        expect.objectContaining({ timeout: 120000 }),
      )
    })

    it('should remove MCP server via CLI', async () => {
      /** Validates that remove dispatches to claude mcp remove */
      const { ChangeMCP } = await import('@/services/element-management-service')
      const result = await ChangeMCP(null, { name: 'my-mcp', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['mcp', 'remove', 'my-mcp']),
        expect.objectContaining({ timeout: 120000 }),
      )
    })

    it('should use scope flag for project scope', async () => {
      /** Validates that project scope passes --scope project to CLI */
      const { ChangeMCP } = await import('@/services/element-management-service')
      const result = await ChangeMCP(null, { name: 'my-mcp', action: 'remove', scope: 'project', agentDir: '/tmp/project' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--scope', 'project']),
        expect.any(Object),
      )
    })

    it('should handle CLI errors gracefully', async () => {
      /** Validates that CLI errors return success=false */
      mockExecFileAsync.mockRejectedValueOnce(new Error('MCP failed'))
      const { ChangeMCP } = await import('@/services/element-management-service')
      const result = await ChangeMCP(null, { name: 'my-mcp', action: 'remove', scope: 'user' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/MCP failed/)
    })
  })

  describe('ChangeLSP', () => {
    it('should reject invalid LSP name', async () => {
      /** Validates that LSP server names with path traversal are rejected */
      const { ChangeLSP } = await import('@/services/element-management-service')
      const result = await ChangeLSP(null, { name: '../evil', action: 'add', config: {} }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid.*name/i)
    })

    it('should reject add without config', async () => {
      /** Validates that add action requires config */
      const { ChangeLSP } = await import('@/services/element-management-service')
      const result = await ChangeLSP(null, { name: 'my-lsp', action: 'add' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/config.*required/i)
    })

    it('should add LSP by writing .lsp.json', async () => {
      /** Validates that add writes LSP config to .lsp.json */
      mockFsExistsSync.mockReturnValue(false)
      mockFsReadFile.mockResolvedValue('{}')
      const { ChangeLSP } = await import('@/services/element-management-service')
      const result = await ChangeLSP(null, {
        name: 'my-lsp',
        action: 'add',
        config: { command: 'pylsp', args: [] },
        agentDir: '/tmp/project',
      }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockFsWriteFile).toHaveBeenCalled()
    })

    it('should remove LSP entry from .lsp.json', async () => {
      /** Validates that remove deletes the LSP entry from .lsp.json */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({ 'my-lsp': { command: 'pylsp' } }))
      const { ChangeLSP } = await import('@/services/element-management-service')
      const result = await ChangeLSP(null, { name: 'my-lsp', action: 'remove', agentDir: '/tmp/project' }, _tAuth)
      expect(result.success).toBe(true)
      expect(mockFsWriteFile).toHaveBeenCalled()
    })

    it('restores the prior .lsp.json when the write dies part-way (R51 G04 compensation)', async () => {
      /** Pins ChangeLSP's G04 undo: a torn writeFile must put the original bytes back, not leave a truncated file */
      const prior = JSON.stringify(
        { 'py-lsp': { command: 'pylsp' }, 'ts-lsp': { command: 'tsserver' } },
        null,
        2,
      )
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(prior)
      // The default implementation is set EXPLICITLY, not inherited: `vi.clearAllMocks()` clears
      // calls but NOT implementations, and the withSettingsLock test below installs a persistent
      // one. Only the FIRST write (the mutation) fails; the compensation's write must succeed.
      mockFsWriteFile.mockResolvedValue(undefined)
      mockFsWriteFile.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))

      const { ChangeLSP } = await import('@/services/element-management-service')
      const result = await ChangeLSP(
        null,
        { name: 'new-lsp', action: 'add', config: { command: 'x' }, agentDir: '/tmp/project' },
        _tAuth,
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/NO CHANGES WERE MADE TO THE SYSTEM/)
      expect(result.error).toMatch(/ENOSPC/)

      const writes = mockFsWriteFile.mock.calls.filter(c => String(c[0]).endsWith('.lsp.json'))
      expect(writes).toHaveLength(2)
      // POSITIVE CONTROL — without it both assertions below are satisfied by a mutation that never
      // mutated, i.e. by two identical writes of the prior content.
      expect(String(writes[0][1])).toContain('new-lsp')
      // THE claim: the compensation restored the ORIGINAL bytes, not the post-mutation ones. An
      // undo that writes `lspConfig` back would still produce a second write and still pass a
      // length check — this is the assertion that tells the two apart.
      expect(String(writes[1][1])).toBe(prior)
      expect(String(writes[1][1])).not.toContain('new-lsp')
    })
  })

  describe('ChangeHook', () => {
    it('should reject invalid event name', async () => {
      /** Validates that hook event names with invalid chars are rejected */
      const { ChangeHook } = await import('@/services/element-management-service')
      const result = await ChangeHook(null, {
        event: '../evil',
        action: 'add',
        scope: 'user',
        hookConfig: { command: 'echo test' },
      }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid.*event/i)
    })

    it('should reject add without hookConfig', async () => {
      /** Validates that add action requires hookConfig */
      const { ChangeHook } = await import('@/services/element-management-service')
      const result = await ChangeHook(null, { event: 'PreToolUse', action: 'add', scope: 'user' }, _tAuth)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/hookConfig.*required/i)
    })

    it('should add hook by writing to settings.json', async () => {
      /** Validates that add writes hook config to settings.json hooks array */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({}))
      const { ChangeHook } = await import('@/services/element-management-service')
      const result = await ChangeHook(null, {
        event: 'PreToolUse',
        action: 'add',
        scope: 'user',
        hookConfig: { command: 'echo test' },
      }, _tAuth)
      expect(result.success).toBe(true)
      // Asserts WHAT LANDED, not that some fs verb fired. The old `toHaveBeenCalled()` on
      // `mockFsWriteFile` was satisfied by any write anywhere — a backup, a lockfile — and went
      // silent entirely when the writer moved to a file handle. The hook itself is the claim.
      const settings = JSON.parse(writtenSettings('settings.json')!)
      expect(settings.hooks.PreToolUse).toContainEqual({ command: 'echo test' })
    })

    it('should remove hook entry from settings.json', async () => {
      /** Validates that remove deletes the hook from settings.json hooks array */
      mockFsExistsSync.mockReturnValue(true)
      mockFsReadFile.mockResolvedValue(JSON.stringify({
        hooks: { PreToolUse: [{ command: 'echo test' }, { command: 'echo other' }] },
      }))
      const { ChangeHook } = await import('@/services/element-management-service')
      const result = await ChangeHook(null, {
        event: 'PreToolUse',
        action: 'remove',
        scope: 'user',
        hookConfig: { command: 'echo test' },
      }, _tAuth)
      expect(result.success).toBe(true)
      // The REMOVED entry is gone and the SIBLING survives — "a write happened" could not tell a
      // correct removal from one that dropped both, or from one that rewrote the file empty.
      const settings = JSON.parse(writtenSettings('settings.json')!)
      expect(settings.hooks.PreToolUse).toEqual([{ command: 'echo other' }])
    })
  })
})
