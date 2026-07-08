/**
 * POST /api/agents zod schema (TRDD-57EBNB72) — the .strict() schema was
 * silently 400-ing the wizard's folder-adoption flow because
 * allowExternalFolder was never added to it. This suite pins the contract:
 * the flag parses, and .strict() still rejects unknown keys.
 */
import { describe, it, expect } from 'vitest'
import { CreateAgentSchema } from '@/lib/create-agent-schema'

describe('POST /api/agents schema', () => {
  it('accepts allowExternalFolder alongside workingDirectory (the wizard adoption payload)', () => {
    const parsed = CreateAgentSchema.safeParse({
      name: 'adopted-plugin-dev',
      workingDirectory: '/Users/someone/agents/adopted-plugin-repo',
      allowExternalFolder: true,
      governanceTitle: 'maintainer',
      githubRepo: 'Emasoft/some-plugin',
      createSession: false,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.allowExternalFolder).toBe(true)
    }
  })

  it('rejects a non-boolean allowExternalFolder', () => {
    const parsed = CreateAgentSchema.safeParse({ name: 'x', allowExternalFolder: 'yes' })
    expect(parsed.success).toBe(false)
  })

  it('still rejects unknown keys (.strict() preserved)', () => {
    const parsed = CreateAgentSchema.safeParse({ name: 'x', totallyUnknownKey: 1 })
    expect(parsed.success).toBe(false)
  })
})
