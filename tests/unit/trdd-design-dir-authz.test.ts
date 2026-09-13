import { describe, it, expect, vi, beforeEach } from 'vitest'

// resolveDesignDir must never let a caller-supplied `requestedAgentId` point
// an AUTHENTICATED AGENT at another agent's TRDD corpus -- authorizeTrddVerb()
// trusts whatever frontmatter (min-approval/assignee/created-by) it finds in
// the resolved corpus, so choosing the corpus effectively chose the
// authorization outcome. See lib/trdd-design-dir.ts.

vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(),
}))
vi.mock('@/lib/trdd-store', () => ({
  defaultDesignDir: vi.fn(() => '/server/own/design'),
}))

import { getAgent } from '@/lib/agent-registry'
import { resolveDesignDir } from '@/lib/trdd-design-dir'

const ATTACKER_AGENT_ID = 'attacker-agent'
const ATTACKER_WORKDIR = '/agents/attacker'
const VICTIM_AGENT_ID = 'victim-agent'
const VICTIM_WORKDIR = '/agents/victim'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAgent).mockImplementation((id: string) => {
    if (id === ATTACKER_AGENT_ID) return { workingDirectory: ATTACKER_WORKDIR } as ReturnType<typeof getAgent>
    if (id === VICTIM_AGENT_ID) return { workingDirectory: VICTIM_WORKDIR } as ReturnType<typeof getAgent>
    return null
  })
})

describe('resolveDesignDir -- authorization bypass fix', () => {
  it('an authenticated AGENT naming ANOTHER agent id reads its OWN corpus, never the others', () => {
    const auth = { agentId: ATTACKER_AGENT_ID }
    const dir = resolveDesignDir(auth, VICTIM_AGENT_ID)
    expect(dir).toBe(ATTACKER_WORKDIR + '/design')
    expect(dir).not.toBe(VICTIM_WORKDIR + '/design')
  })

  it('an authenticated AGENT with no requested agentId still reads its OWN corpus', () => {
    const auth = { agentId: ATTACKER_AGENT_ID }
    const dir = resolveDesignDir(auth, null)
    expect(dir).toBe(ATTACKER_WORKDIR + '/design')
  })

  it('the OWNER (no auth.agentId) naming an agent still reads THAT agent corpus (the --all-agents fan-out path)', () => {
    const auth = { agentId: undefined }
    const dir = resolveDesignDir(auth, VICTIM_AGENT_ID)
    expect(dir).toBe(VICTIM_WORKDIR + '/design')
  })

  it('the OWNER with no requested agentId reads the server own repo', () => {
    const auth = { agentId: undefined }
    const dir = resolveDesignDir(auth, null)
    expect(dir).toBe('/server/own/design')
  })

  it('a null auth (no verified identity) behaves like the OWNER -- honors requestedAgentId', () => {
    const dir = resolveDesignDir(null, VICTIM_AGENT_ID)
    expect(dir).toBe(VICTIM_WORKDIR + '/design')
  })
})
