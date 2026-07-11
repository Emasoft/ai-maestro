/**
 * TRDD-L1OYEVSN — the session env bag has ONE builder, and both session-creation
 * paths use it.
 *
 * The bug this pins: `AID_AUTH` (the secret an agent presents to the ai-maestro
 * API) was injected by `sessions-service::createSession` and NOT by
 * `agents-core-service::wakeAgent`. Since boot-restore restores every agent
 * through wakeAgent, every server restart stripped the credential from the whole
 * fleet — measured 8/8 live sessions with no AID_AUTH.
 *
 * Note what is tested where. The mint logic was never broken (it worked on the
 * create path); the DIVERGENCE was. So the load-bearing test here is the
 * structural one at the bottom — it fails the moment a session-creation path
 * hand-rolls its own env bag again. The unit tests above it guard the builder's
 * contract, using the REAL crypto so "the persisted hash validates the secret we
 * handed the agent" is an actual proof rather than a mock agreeing with itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// Collaborators are mocked; the SUBJECT (buildAgentSessionEnv) and the security-
// critical dependency (lib/session-secret — real crypto) are not.
//
// vi.hoisted: vi.mock factories are hoisted above the imports, so the spy must
// be created in a hoisted block or the factory would reference it before init.
// ---------------------------------------------------------------------------
type MetaResult = { success: boolean; error?: string }
const { changeMetadataMock } = vi.hoisted(() => ({
  changeMetadataMock: vi.fn(
    async (
      _agentId: string,
      _updates: { sessionSecretHash: string },
      _auth: unknown,
      _opts: unknown,
    ): Promise<MetaResult> => ({ success: true }),
  ),
}))

vi.mock('@/services/element-management-service', () => ({
  ChangeMetadata: changeMetadataMock,
}))

vi.mock('@/lib/amp-inbox-writer', () => ({
  initAgentAMPHome: vi.fn(async () => undefined),
  getAgentAMPDir: vi.fn(() => '/tmp/amp-home/test-agent'),
}))

import { buildAgentSessionEnv, SESSION_ENV_KEYS } from '@/lib/session-env'
import { validateSessionSecret } from '@/lib/session-secret'

describe('buildAgentSessionEnv — the single source of a session env bag', () => {
  beforeEach(() => {
    changeMetadataMock.mockClear()
    changeMetadataMock.mockImplementation(async () => ({ success: true }))
  })

  it('AID_AUTH is a declared member of the session env contract', () => {
    // Guards the enumeration itself: a comment in agents-core-service listed the
    // four vars it injected as though the set were complete. It was not.
    expect(SESSION_ENV_KEYS).toContain('AID_AUTH')
    expect(SESSION_ENV_KEYS).toContain('AGENT_WORK_DIR')
    expect(SESSION_ENV_KEYS).toContain('AIM_AGENT_NAME')
    expect(SESSION_ENV_KEYS).toContain('AIM_AGENT_ID')
  })

  it('always carries the workdir and the agent name', async () => {
    const { env } = await buildAgentSessionEnv({
      agentName: 'test-agent',
      agentId: 'agent-uuid-1',
      workingDirectory: '/Users/x/agents/test-agent',
    })
    expect(env.AGENT_WORK_DIR).toBe('/Users/x/agents/test-agent')
    expect(env.AIM_AGENT_NAME).toBe('test-agent')
    expect(env.AIM_AGENT_ID).toBe('agent-uuid-1')
  })

  it('mints AID_AUTH and persists a hash that actually validates the minted secret', async () => {
    const { env, aidAuthSet } = await buildAgentSessionEnv({
      agentName: 'test-agent',
      agentId: 'agent-uuid-1',
      workingDirectory: '/Users/x/agents/test-agent',
    })

    expect(aidAuthSet).toBe(true)
    expect(env.AID_AUTH).toBeTruthy()

    // The whole point of the credential: the hash the server stores must verify
    // the secret the agent was handed. Real crypto, not a mock nodding along.
    expect(changeMetadataMock).toHaveBeenCalledTimes(1)
    const persisted = changeMetadataMock.mock.calls[0][1]
    expect(validateSessionSecret(env.AID_AUTH!, persisted.sessionSecretHash)).toBe(true)
  })

  it('a fresh secret is minted per session (no reuse across sessions)', async () => {
    const a = await buildAgentSessionEnv({ agentName: 'a', agentId: 'id-a', workingDirectory: '/w/a' })
    const b = await buildAgentSessionEnv({ agentName: 'a', agentId: 'id-a', workingDirectory: '/w/a' })
    expect(a.env.AID_AUTH).not.toBe(b.env.AID_AUTH)
  })

  it('omits AID_AUTH — and says so — when the agent is not registered', async () => {
    // No agentId => nothing to bind the secret to. The session may still start
    // (a terminal is useful without API access), but it must not silently claim
    // to be authenticated.
    const { env, aidAuthSet } = await buildAgentSessionEnv({
      agentName: 'unregistered',
      agentId: undefined,
      workingDirectory: '/w/u',
    })
    expect(aidAuthSet).toBe(false)
    expect(env.AID_AUTH).toBeUndefined()
    expect(env.AIM_AGENT_ID).toBeUndefined()
    expect(env.AGENT_WORK_DIR).toBe('/w/u') // the rest of the bag still lands
  })

  it('a failed persist yields no AID_AUTH rather than an unverifiable one', async () => {
    // Fail-closed on the CREDENTIAL (never hand out a secret whose hash the
    // server did not store — that would 401 anyway, but opaquely), while staying
    // fail-open on the SESSION (the pane still opens).
    changeMetadataMock.mockImplementation(async () => ({ success: false, error: 'boom' }))
    const { env, aidAuthSet } = await buildAgentSessionEnv({
      agentName: 'test-agent',
      agentId: 'agent-uuid-1',
      workingDirectory: '/w/t',
    })
    expect(aidAuthSet).toBe(false)
    expect(env.AID_AUTH).toBeUndefined()
    expect(env.AGENT_WORK_DIR).toBe('/w/t')
  })
})

describe('both session-creation paths use the single builder (the divergence guard)', () => {
  // This is the test that would have caught TRDD-L1OYEVSN. The mint logic was
  // correct; one of the two call sites simply did not run it. A unit test of the
  // builder can never see that — only a check of the call sites can.
  const PATHS = [
    'services/sessions-service.ts',   // create path
    'services/agents-core-service.ts' // wake path (and therefore boot-restore)
  ]

  it.each(PATHS)('%s builds its session env via buildAgentSessionEnv', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf-8')
    expect(src).toContain('buildAgentSessionEnv')
  })

  it.each(PATHS)('%s does not hand-roll an env bag with AGENT_WORK_DIR', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf-8')
    // A literal `AGENT_WORK_DIR:` key is how both paths previously declared their
    // own bag. The builder owns that key now; a call site re-declaring it means
    // the two paths have started to diverge again — which is precisely the bug.
    expect(src).not.toMatch(/^\s*AGENT_WORK_DIR:\s/m)
  })
})
