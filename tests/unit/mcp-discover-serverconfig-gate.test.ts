import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-NWTTU0AQ — POST /api/settings/mcp-discover spawned an arbitrary caller-supplied command.
 *
 * The route had two input modes and only one was contained. `configPath` mode resolves through
 * `realpath()` and requires the real path to be under `~/.claude/plugins/` — correct. `serverConfig`
 * mode took an arbitrary object, wrapped it as `{ mcpServers: { [name]: serverConfig } }`, wrote it
 * to a temp file, and handed that file to `scripts_dev/mcp_discovery.py`, which does
 * `subprocess.Popen(command)` from the config it is given. An MCP server config's whole purpose is
 * to name a command to spawn, so the inline branch was command execution as the server user for ANY
 * authenticated caller:
 *   `{"serverName":"x","serverConfig":{"command":"/bin/sh","args":["-c","…"]}}`.
 *
 * `shellSafe()` never covered it: the payload is a JSON OBJECT, not a shell string, so hardening
 * `shellSafe` was never a fix — and the branch was never considered under the header's
 * "any authenticated caller" ruling, which was written for the `configPath` branch.
 *
 * Fix, per the card's ruling: `enforceSystemOwner` on the inline branch only (the sole caller is the
 * operator UI, and the `configPath` branch stays agent-available as the header intends), PLUS a
 * `.strict()` two-key schema as defence in depth. Both run BEFORE the temp file is written, so a
 * refused request never produces a config for the script to read — and the assertion below checks
 * that `execFileSync` never ran, because a 403 returned after the spawn is still execution.
 *
 * NEUTER RUN — recorded at the bottom of this file.
 */

const mockAuthenticate = vi.fn()
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

const mockExecFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>()
  return { ...actual, execFileSync: (...a: unknown[]) => mockExecFileSync(...a) }
})
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  return {
    ...actual,
    existsSync: () => true,
    writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
    unlinkSync: () => {},
  }
})

const AGENT = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' }
const OWNER = { agentId: undefined }

function req(body: Record<string, unknown>) {
  return new Request('http://localhost/api/settings/mcp-discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  }) as never
}

describe('TRDD-NWTTU0AQ — mcp-discover inline serverConfig cannot reach a spawn', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockExecFileSync.mockReset()
    mockWriteFileSync.mockReset()
    mockExecFileSync.mockReturnValue(Buffer.from('{"tools":[]}'))
  })

  it('REFUSES an AGENT posting an inline serverConfig, and NO subprocess is spawned', async () => {
    /** Validates that the command-execution branch is owner-only, not merely authenticated */
    mockAuthenticate.mockReturnValue(AGENT)
    const { POST } = await import('@/app/api/settings/mcp-discover/route')
    const res = await POST(req({ serverName: 'evil', serverConfig: { command: '/bin/sh', args: ['-c', 'id'] } }))

    expect(res.status).toBe(403)
    // The REASON, not merely the non-200: a missing serverName is 400 and a missing script is 500,
    // so a status-only assertion would pass for the wrong reason with the owner gate deleted.
    expect((await res.json()).error).toMatch(/system owner only/i)
    // A 403 returned AFTER the spawn is still execution — assert the spawn did not happen.
    expect(mockExecFileSync).not.toHaveBeenCalled()
    // And no config was ever written for the discovery script to read.
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('REFUSES even the owner when the config carries a key the branch does not expect', async () => {
    /** Validates the .strict() schema is defence in depth, refusing env/cwd rather than forwarding them */
    mockAuthenticate.mockReturnValue(OWNER)
    const { POST } = await import('@/app/api/settings/mcp-discover/route')
    const res = await POST(
      req({ serverName: 'x', serverConfig: { command: 'node', args: ['s.js'], env: { LD_PRELOAD: '/tmp/evil.so' } } }),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/command.*args/i)
    expect(mockExecFileSync).not.toHaveBeenCalled()
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the owner echoing the two legitimate keys still discovers', async () => {
    /** Validates the gate can say yes, so the refusals above are a narrowing and not a removal */
    mockAuthenticate.mockReturnValue(OWNER)
    const { POST } = await import('@/app/api/settings/mcp-discover/route')
    const res = await POST(req({ serverName: 'legit', serverConfig: { command: 'node', args: ['server.js'] } }))

    expect(res.status).toBe(200)
    // The spawned config carries EXACTLY the two echoed keys — nothing the caller added rides along.
    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]))
    expect(written.mcpServers.legit).toEqual({ command: 'node', args: ['server.js'] })
  })

  it('POSITIVE CONTROL — an AGENT may still use the contained configPath branch', async () => {
    /** Validates the agent-available half of the route the header describes still works */
    mockAuthenticate.mockReturnValue(AGENT)
    const { POST } = await import('@/app/api/settings/mcp-discover/route')
    const res = await POST(req({ serverName: 'plugin-server', configPath: `${process.env.HOME}/.claude/plugins/x/.mcp.json` }))

    // Not 403: the owner gate must sit on the INLINE branch only. (The plugin file is absent on
    // this fixture, so the read fails — what matters is that it was not the owner gate refusing.)
    const body = await res.json()
    expect(body.error ?? '').not.toMatch(/system owner only/i)
  })

  it('a forged credential never reaches discovery', async () => {
    /** Validates the authentication half: the handler, not the structural gate, refuses */
    mockAuthenticate.mockReturnValue({ error: 'Invalid or expired token', status: 401 })
    const { POST } = await import('@/app/api/settings/mcp-discover/route')
    const res = await POST(req({ serverName: 'x', serverConfig: { command: 'node' } }))

    expect(res.status).toBe(401)
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })
})
/**
 * NEUTER RUN — 2026-10-04, OBSERVED by the same copy-mutate-run-restore method, restore verified by
 * sha1. TWO mutations, one per defence layer, each reddening exactly ONE test and leaving the
 * other four green:
 *
 *   1. app/api/settings/mcp-discover/route.ts
 *      s/if \(ownerErr\) return ownerErr/if (false) return ownerErr/  (1 line, the inline branch only)
 *      → 1 red: "REFUSES an AGENT posting an inline serverConfig, and NO subprocess is spawned".
 *        The `AGENT` refusal is the gate's, so with the gate disabled only that test falls — which
 *        is what proves the refusal is the OWNER check and not the schema, whose `command`/`args`
 *        payload the schema would have accepted.
 *
 *   2. app/api/settings/mcp-discover/route.ts
 *      remove `.strict()` from HOST_ECHO_SERVER_CONFIG  (1 line)
 *      → 1 red: "REFUSES even the owner when the config carries a key the branch does not expect".
 *        The owner gate passes that caller, so ONLY the schema can refuse it — the complementary
 *        half, and the reason the two layers are not redundant.
 *
 * A 403 returned after the spawn is still execution, so every refusal test asserts
 * `execFileSync` was never called AND no temp config was written; the owner-gate neuter reddens
 * on that assertion rather than on the status alone.
 */
