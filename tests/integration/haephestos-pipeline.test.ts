/**
 * Haephestos Pipeline — Integration Smoke Test
 *
 * SMOKE TEST ONLY — not exhaustive coverage.
 *
 * Covers the POST /api/agents/creation-helper/publish-plugin route, which is
 * step 8 of the 8-step Haephestos role-plugin creation pipeline (see
 * CLAUDE.md §"Haephestos v2 Architecture" and the R0 fourfold identity rule).
 *
 * Scope:
 *   - Quad-identity validation (plugin.json name ↔ folder ↔ .agent.toml ↔ main-agent.md)
 *   - Required AI Maestro compat fields (compatible-titles, compatible-clients)
 *   - Copy from ~/agents/haephestos/build/ to ~/agents/role-plugins/
 *   - Marketplace manifest registration
 *
 * Mocks (external deps only):
 *   - `fs` and `fs/promises` — in-memory fsStore (so we don't touch the real disk)
 *   - `@/services/role-plugin-service` — ensureMarketplace / updateMarketplaceManifest are spies
 *   - `@/lib/file-lock` — withLock passthrough (no real locking)
 *   - `@/lib/route-auth` — enforceAuth bypass (auth isn't what this test is about)
 *   - `child_process.execSync` — swallow the `claude plugin marketplace update` call
 *
 * The logic under test (quad-identity extraction/validation, copy orchestration) is the
 * REAL route code — we are NOT reimplementing it in the test.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

// ─── Mocks ────────────────────────────────────────────────────────────────

// In-memory fsStore. Keys are absolute paths (post-resolve). Values are file
// contents for files; directories are tracked by having their path present as
// an empty-string marker with trailing "/" suffix in a companion Set.
let fsStore: Record<string, string> = {}
let fsDirs: Set<string> = new Set()

function isDirInStore(p: string): boolean {
  // A path is "a directory" if either (a) it's explicitly in fsDirs, or (b)
  // any file in fsStore has this path as a strict prefix (ending in "/").
  if (fsDirs.has(p)) return true
  const prefix = p.endsWith('/') ? p : p + '/'
  for (const key of Object.keys(fsStore)) {
    if (key.startsWith(prefix)) return true
  }
  for (const dir of fsDirs) {
    if (dir.startsWith(prefix)) return true
  }
  return false
}

vi.mock('fs', () => {
  const fns = {
    existsSync: vi.fn((filePath: string) => {
      return filePath in fsStore || isDirInStore(filePath)
    }),
    readFileSync: vi.fn((filePath: string, _encoding?: string) => {
      if (filePath in fsStore) return fsStore[filePath]
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`)
    }),
    mkdirSync: vi.fn((dir: string) => {
      fsDirs.add(dir)
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => {
      fsStore[filePath] = data
    }),
  }
  return { default: fns, ...fns }
})

// fs/promises — cp, rm, mkdir are spies; we record the calls so tests can
// assert the correct source/dest were computed by the route.
const cpSpy = vi.fn(async (_src: string, _dest: string, _opts?: unknown) => {
  /* no-op — we only care that it was called with the right args */
})
const rmSpy = vi.fn(async (_path: string, _opts?: unknown) => {
  /* no-op */
})
const mkdirSpy = vi.fn(async (_path: string, _opts?: unknown) => {
  /* no-op */
})

vi.mock('fs/promises', () => ({
  cp: cpSpy,
  rm: rmSpy,
  mkdir: mkdirSpy,
}))

// role-plugin-service — marketplace registration is a spy so we can verify
// it was called with the expected name/description/version.
const ensureMarketplaceSpy = vi.fn(async () => undefined)
const updateMarketplaceManifestSpy = vi.fn(
  async (_name: string, _description: string, _version: string) => undefined,
)

vi.mock('@/services/role-plugin-service', () => ({
  ensureMarketplace: ensureMarketplaceSpy,
  updateMarketplaceManifest: updateMarketplaceManifestSpy,
}))

// file-lock — pass the callback through; no real lock in unit tests.
vi.mock('@/lib/file-lock', () => ({
  withLock: vi.fn(
    async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> =>
      Promise.resolve(fn()),
  ),
}))

// route-auth — auth is bypassed; this test is about the pipeline, not auth.
vi.mock('@/lib/route-auth', () => ({
  enforceAuth: vi.fn(() => null),
}))

// child_process.execSync — used to fire `claude plugin marketplace update`.
// We don't have `claude` on PATH in the test env, and the route wraps it in a
// try/catch anyway, but stubbing it makes the test deterministic.
vi.mock('child_process', () => ({
  execSync: vi.fn(() => Buffer.from('')),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────

import { POST } from '@/app/api/agents/creation-helper/publish-plugin/route'
import { NextRequest } from 'next/server'

// ─── Path fixtures ────────────────────────────────────────────────────────

const HOME = homedir()
const HAEPHESTOS_BUILD = join(HOME, 'agents', 'haephestos', 'build')
const ROLE_PLUGINS_DIR = join(HOME, 'agents', 'role-plugins')

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Seed the in-memory fsStore with a complete, valid Haephestos-built plugin
 * directory under HAEPHESTOS_BUILD. This is what a plugin looks like AFTER
 * Haephestos has run PSS make-plugin AND added the compat fields to the
 * `.agent.toml` (step 6 of the 8-step pipeline). Individual tests override
 * specific files to drive validation branches.
 */
function seedValidPluginInBuildDir(pluginName: string): string {
  const pluginDir = join(HAEPHESTOS_BUILD, pluginName)
  const mainAgentName = `${pluginName}-main-agent`

  // 1. .claude-plugin/plugin.json — the canonical identity
  fsStore[join(pluginDir, '.claude-plugin', 'plugin.json')] = JSON.stringify({
    name: pluginName,
    version: '1.2.3',
    description: `Smoke-test role plugin ${pluginName}`,
  })

  // 2. <name>.agent.toml — required at plugin root, must have matching
  //    [agent].name AND the AI Maestro compat fields.
  fsStore[join(pluginDir, `${pluginName}.agent.toml`)] =
    `[agent]\n` +
    `name = "${pluginName}"\n` +
    `compatible-titles = ["MEMBER", "ARCHITECT"]\n` +
    `compatible-clients = ["claude-code", "codex"]\n` +
    `\n[description]\n` +
    `short = "Smoke test"\n`

  // 3. agents/<name>-main-agent.md with matching frontmatter name
  fsStore[join(pluginDir, 'agents', `${mainAgentName}.md`)] =
    `---\n` +
    `name: ${mainAgentName}\n` +
    `model: sonnet\n` +
    `---\n\n` +
    `# ${pluginName} main agent\n`

  // Track the dir explicitly (so existsSync on the bare folder works even
  // before any child file is touched by the route).
  fsDirs.add(pluginDir)

  return pluginDir
}

/** Construct a NextRequest with a JSON body pointing at a plugin dir. */
function makePublishRequest(pluginDir: string | undefined): NextRequest {
  return new NextRequest(
    new URL('/api/agents/creation-helper/publish-plugin', 'http://localhost:23000'),
    {
      method: 'POST',
      body: JSON.stringify({ pluginDir }),
      headers: { 'content-type': 'application/json' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  )
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  fsStore = {}
  fsDirs = new Set()
  cpSpy.mockClear()
  rmSpy.mockClear()
  mkdirSpy.mockClear()
  ensureMarketplaceSpy.mockClear()
  updateMarketplaceManifestSpy.mockClear()
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Haephestos pipeline — POST /api/agents/creation-helper/publish-plugin', () => {
  test('TOML → plugin.json name alignment (quad-identity rule)', async () => {
    // Aim: when plugin.json `name` matches the folder name AND [agent].name in
    // .agent.toml, the quad-identity check must accept the plugin. This is
    // the core rule that keeps the canonical identity unambiguous across all
    // four files.
    const pluginDir = seedValidPluginInBuildDir('test-agent')

    // Sanity: plugin.json and toml BOTH carry the same `test-agent` name,
    // matching the folder name. If the route's name-alignment logic were to
    // compare against the persona or something else, this test would break.
    const res = await POST(makePublishRequest(pluginDir))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pluginName).toBe('test-agent')

    // And now prove the route actually USES the plugin.json name for the
    // alignment check: if we change plugin.json `name` to something else
    // while keeping the folder name "test-agent", it should FAIL.
    fsStore[join(pluginDir, '.claude-plugin', 'plugin.json')] = JSON.stringify({
      name: 'completely-different-name',
      version: '1.2.3',
      description: 'Smoke-test role plugin test-agent',
    })
    const resBad = await POST(makePublishRequest(pluginDir))
    expect(resBad.status).toBe(422)
    const bodyBad = await resBad.json()
    expect(bodyBad.error).toMatch(/validation failed/i)
    expect(bodyBad.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/plugin\.json name.*does not match directory name/),
      ]),
    )
  })

  test('compatible-titles and compatible-clients are required in .agent.toml before publish', async () => {
    // Aim: Haephestos step 6 writes `compatible-titles` and `compatible-clients`
    // to the .agent.toml. If either is missing at publish time, the route must
    // reject with HTTP 422 and a clear issue message. This protects against
    // the "Haephestos forgot to add the compat fields" failure mode.
    const pluginDir = seedValidPluginInBuildDir('compat-test-agent')

    // Strip both compat fields from the .agent.toml — simulates a PSS-generated
    // plugin that hasn't been through step 6 yet.
    fsStore[join(pluginDir, `${'compat-test-agent'}.agent.toml`)] =
      `[agent]\n` +
      `name = "compat-test-agent"\n` +
      `\n[description]\n` +
      `short = "missing compat fields"\n`

    const res = await POST(makePublishRequest(pluginDir))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/compatible-titles/),
        expect.stringMatching(/compatible-clients/),
      ]),
    )

    // Now re-seed with ONLY compatible-titles missing — should still fail but
    // only for that one field.
    fsStore[join(pluginDir, `${'compat-test-agent'}.agent.toml`)] =
      `[agent]\n` +
      `name = "compat-test-agent"\n` +
      `compatible-clients = ["claude-code"]\n`
    const res2 = await POST(makePublishRequest(pluginDir))
    expect(res2.status).toBe(422)
    const body2 = await res2.json()
    const titlesIssue = (body2.issues as string[]).find((i) => /compatible-titles/.test(i))
    const clientsIssue = (body2.issues as string[]).find((i) => /compatible-clients/.test(i))
    expect(titlesIssue).toBeDefined()
    expect(clientsIssue).toBeUndefined()

    // Finally, with BOTH present (the normal post-Haephestos-step-6 state),
    // publish must succeed.
    fsStore[join(pluginDir, `${'compat-test-agent'}.agent.toml`)] =
      `[agent]\n` +
      `name = "compat-test-agent"\n` +
      `compatible-titles = ["MEMBER"]\n` +
      `compatible-clients = ["claude-code"]\n`
    const res3 = await POST(makePublishRequest(pluginDir))
    expect(res3.status).toBe(200)
  })

  test('publishPlugin rejects missing quad-identity (no main-agent.md)', async () => {
    // Aim: quad-identity rule #4 requires `agents/<name>-main-agent.md` to
    // exist. If Haephestos forgot to emit it (or PSS make-plugin failed
    // silently), the route must refuse to publish with a clear error.
    const pluginName = 'no-main-agent'
    const pluginDir = seedValidPluginInBuildDir(pluginName)

    // Delete the main-agent.md file from the fake fs.
    const mainAgentPath = join(pluginDir, 'agents', `${pluginName}-main-agent.md`)
    delete fsStore[mainAgentPath]

    const res = await POST(makePublishRequest(pluginDir))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Missing agents\/no-main-agent-main-agent\.md/),
      ]),
    )
    // And verify that on a rejected publish, nothing was copied to the
    // marketplace. This is a critical invariant — validation failures must
    // be fully upstream of any filesystem mutation.
    expect(cpSpy).not.toHaveBeenCalled()
    expect(rmSpy).not.toHaveBeenCalled()
    expect(ensureMarketplaceSpy).not.toHaveBeenCalled()
    expect(updateMarketplaceManifestSpy).not.toHaveBeenCalled()
  })

  test('publishPlugin copies build/ to ~/agents/role-plugins/ and registers in manifest', async () => {
    // Aim: on a valid plugin, the route must (a) copy the build dir to the
    // role-plugins marketplace path, (b) call ensureMarketplace, and (c)
    // register the plugin in the manifest with the right name/description/
    // version. This is the "happy path" that confirms the publish pipeline
    // orchestration is wired correctly.
    const pluginDir = seedValidPluginInBuildDir('happy-path-agent')

    const res = await POST(makePublishRequest(pluginDir))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pluginName).toBe('happy-path-agent')
    expect(body.pluginDir).toBe(join(ROLE_PLUGINS_DIR, 'happy-path-agent'))

    // Copy happened from the build dir to the role-plugins marketplace dir.
    expect(cpSpy).toHaveBeenCalledTimes(1)
    const [cpSrc, cpDest] = cpSpy.mock.calls[0]
    expect(cpSrc).toBe(pluginDir)
    expect(cpDest).toBe(join(ROLE_PLUGINS_DIR, 'happy-path-agent'))

    // Marketplace ensured AND the manifest was updated with the values
    // extracted from plugin.json (description + version).
    expect(ensureMarketplaceSpy).toHaveBeenCalledTimes(1)
    expect(updateMarketplaceManifestSpy).toHaveBeenCalledTimes(1)
    expect(updateMarketplaceManifestSpy).toHaveBeenCalledWith(
      'happy-path-agent',
      'Smoke-test role plugin happy-path-agent',
      '1.2.3',
    )
  })

  test('publishPlugin rejects pluginDir outside Haephestos build dir (path traversal guard)', async () => {
    // Aim: G1 of the publish pipeline is a path-traversal guard — only paths
    // inside ~/agents/haephestos/build/ are allowed. If Haephestos (or any
    // caller) passes a path outside that root, the route must refuse with
    // HTTP 403 BEFORE any validation or copy happens. This prevents a
    // compromised caller from publishing arbitrary directories as plugins.
    const outsidePath = join(HOME, 'not-haephestos', 'malicious-plugin')
    fsDirs.add(outsidePath)
    fsStore[join(outsidePath, '.claude-plugin', 'plugin.json')] = JSON.stringify({
      name: 'malicious-plugin',
      version: '9.9.9',
    })

    const res = await POST(makePublishRequest(outsidePath))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/must be inside.*haephestos\/build/i)
    expect(cpSpy).not.toHaveBeenCalled()
    expect(ensureMarketplaceSpy).not.toHaveBeenCalled()
  })

  test('publishPlugin rejects missing pluginDir in request body', async () => {
    // Aim: input-validation sanity check. Missing `pluginDir` in the POST
    // body must return HTTP 400 and NOT invoke any filesystem or marketplace
    // logic. This is the earliest-failing branch of the route and should be
    // exercised by every PR.
    const res = await POST(makePublishRequest(undefined))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/pluginDir is required/i)
    expect(cpSpy).not.toHaveBeenCalled()
  })
})
