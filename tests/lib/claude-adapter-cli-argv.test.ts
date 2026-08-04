/**
 * claudeAdapter's CLI argv — TRDD-RCL2HC9Y.
 *
 * WHY THIS FILE EXISTS. The adapter passed the target directory as
 * `--cwd <dir>`, an option the `claude` CLI does not have. It answers
 *
 *     error: unknown option '--cwd'
 *
 * and EXITS 0. `promisify(execFile)` rejects only on a non-zero exit, so it
 * RESOLVED, and install/uninstall both returned {success:true} having run
 * nothing at all. Every local-scope plugin operation through this adapter was
 * a silent no-op for as long as the flag was there.
 *
 * Nothing caught it because nothing tested the argv: the only test driving
 * this path (deleteagent-g08c-plugin-uninstall) uses a FAKE adapter and
 * asserts `targetDir` and `scope` at the adapter BOUNDARY. That is the right
 * altitude for testing the gate's ordering, and it is structurally incapable
 * of seeing that the adapter turns those into an invalid command line. The
 * mapping from (targetDir, scope) to argv is this file's job.
 *
 * So these tests assert the two halves separately, because the bug is exactly
 * a swap between them: the directory must appear in the SPAWN OPTIONS and must
 * NOT appear in the arguments.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { homedir } from 'os'

interface SpawnCall { cmd: string; args: string[]; opts: Record<string, unknown> }

const cli = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  /** Set to a message to make the fake CLI fail like a real non-zero exit. */
  fail: null as string | null,
}))

// The fake carries no util.promisify.custom symbol, so promisify() falls back
// to the (err, result) callback convention — which is what we implement here.
vi.mock('child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    opts: Record<string, unknown>,
    cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void,
  ) => {
    cli.calls.push({ cmd, args, opts })
    if (cli.fail) cb(new Error(cli.fail))
    else cb(null, { stdout: '', stderr: '' })
  },
}))

const { default: claudeAdapter } = await import('@/lib/client-plugin-adapters/claude-adapter')
const { inAdapterContext } = await import('@/lib/client-plugin-adapters/adapter-context')

const PLUGIN = {
  name: 'some-plugin',
  clientType: 'claude' as const,
  storageDir: '',
  providerId: 'claude-code' as const,
  sourcePlugin: 'some-marketplace',
}

const only = (): SpawnCall => {
  expect(cli.calls).toHaveLength(1)
  return cli.calls[0]
}

describe('claudeAdapter CLI argv (TRDD-RCL2HC9Y)', () => {
  beforeEach(() => {
    cli.calls = []
    cli.fail = null
  })

  describe('local scope passes the directory as the spawn cwd', () => {
    it('install: argv carries NO --cwd', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'local', marketplace: 'some-marketplace' }))
      expect(only().args).not.toContain('--cwd')
    })

    it('install: the directory arrives as the spawn cwd option', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'local', marketplace: 'some-marketplace' }))
      expect(only().opts.cwd).toBe('/tmp/agent-dir')
    })

    it('install: the directory appears in NO argument, under any spelling', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'local', marketplace: 'some-marketplace' }))
      // Broader than the --cwd check on purpose: re-introducing the directory
      // as a positional, or under a differently-named flag, is the same bug.
      expect(only().args).not.toContain('/tmp/agent-dir')
    })

    it('uninstall: argv carries NO --cwd', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '/tmp/agent-dir', { scope: 'local' }))
      expect(only().args).not.toContain('--cwd')
    })

    it('uninstall: the directory arrives as the spawn cwd option', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '/tmp/agent-dir', { scope: 'local' }))
      expect(only().opts.cwd).toBe('/tmp/agent-dir')
    })

    it('uninstall: passes -y, because --prune prompts when stdout is not a TTY', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '/tmp/agent-dir', { scope: 'local' }))
      expect(only().args).toContain('-y')
    })
  })

  describe('the arguments that are NOT the directory are still correct', () => {
    // Positive controls: without these, every assertion above is satisfied by
    // an adapter that spawns nothing recognisable at all.
    // The marketplace is EMBEDDED in the single positional, exactly as `uninstall` below
    // already did. `claude plugin install --help` reads
    // `Usage: claude plugin install|i [options] <plugin>` … "use plugin@marketplace for
    // specific marketplace" — one positional, no more. This test previously pinned the
    // two-positional form (`… 'some-plugin', 'some-marketplace'`), which froze the bug: the
    // second argument was dropped by the CLI, so an install asking for a SPECIFIC
    // marketplace silently resolved the bare name across all of them and stamped a
    // different `<plugin>@<marketplace>` settings key than the caller asked for.
    it('install spawns `claude plugin install <name@marketplace> --scope local`', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'local', marketplace: 'some-marketplace' }))
      const call = only()
      expect(call.cmd).toBe('claude')
      expect(call.args.slice(0, 3)).toEqual(['plugin', 'install', 'some-plugin@some-marketplace'])
      expect(call.args).toEqual(expect.arrayContaining(['--scope', 'local']))
    })

    it('install at user scope also embeds the marketplace in the one positional', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'user', marketplace: 'some-marketplace' }))
      expect(only().args.slice(0, 3)).toEqual(['plugin', 'install', 'some-plugin@some-marketplace'])
    })

    it('install with NO marketplace passes the bare name, never an empty positional', async () => {
      // The old form appended `marketplace || ''` unconditionally, so a marketplace-less
      // install spawned `claude plugin install some-plugin ""` — an empty string is not a
      // plugin name, and it is the shape a `slice(0, 4)` assertion could not see.
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'local' }))
      const call = only()
      expect(call.args.slice(0, 3)).toEqual(['plugin', 'install', 'some-plugin'])
      expect(call.args).not.toContain('')
    })

    it('uninstall spawns `claude plugin uninstall <name@marketplace> --scope local`', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '/tmp/agent-dir', { scope: 'local' }))
      const call = only()
      expect(call.args.slice(0, 3)).toEqual(['plugin', 'uninstall', 'some-plugin@some-marketplace'])
      expect(call.args).toEqual(expect.arrayContaining(['--scope', 'local']))
    })
  })

  describe('user scope is a different command and must not gain a cwd', () => {
    it('install at user scope spawns --scope user with no cwd', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'user', marketplace: 'some-marketplace' }))
      const call = only()
      expect(call.args).toEqual(expect.arrayContaining(['--scope', 'user']))
      expect(call.opts.cwd).toBeUndefined()
    })

    it('uninstall at user scope spawns --scope user with no cwd', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '/tmp/agent-dir', { scope: 'user' }))
      const call = only()
      expect(call.args).toEqual(expect.arrayContaining(['--scope', 'user']))
      expect(call.opts.cwd).toBeUndefined()
    })
  })

  describe('a ~ in the target directory is expanded before it becomes the cwd', () => {
    // A literal '~' as a spawn cwd is a directory that does not exist, so the
    // spawn fails — a different silent-failure shape than the one above, and
    // the reason resolveDir() must still run on this path.
    it('install expands ~ into the real home', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '~/agents/bob', { scope: 'local', marketplace: 'm' }))
      expect(only().opts.cwd).toBe(`${homedir()}/agents/bob`)
    })

    it('uninstall expands ~ into the real home', async () => {
      await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '~/agents/bob', { scope: 'local' }))
      expect(only().opts.cwd).toBe(`${homedir()}/agents/bob`)
    })
  })

  describe('a real CLI failure is still reported as failure', () => {
    // The original bug was failure-reported-as-success. Pin the honest path so
    // a future "make it resilient" edit cannot restore the silent no-op.
    it('install returns success:false when the CLI exits non-zero', async () => {
      cli.fail = 'boom'
      const res = await inAdapterContext('test', () =>
        claudeAdapter.install(PLUGIN, '/tmp/agent-dir', { scope: 'local', marketplace: 'm' }))
      expect(res.success).toBe(false)
      expect(res.error).toContain('boom')
    })

    it('uninstall returns success:false when the CLI exits non-zero', async () => {
      cli.fail = 'boom'
      const res = await inAdapterContext('test', () =>
        claudeAdapter.uninstall(PLUGIN, '/tmp/agent-dir', { scope: 'local' }))
      expect(res.success).toBe(false)
      expect(res.error).toContain('boom')
    })
  })
})
