// TRDD-F1SL03CK EHT-2: POST /api/agents became sudo-gated (strict). Every UI
// site that creates an agent must route the POST through sudoFetch, or the
// call is rejected with no password modal. Source scan, not a runtime test —
// no React renderer involved.
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const ROOT = join(__dirname, '..', '..')

const CREATING_SITES = [
  'components/AgentCreationWizard.tsx',
  'components/onboarding/FirstAgentWizard.tsx',
  'components/AgentList.tsx',
]

// Positive control: an already-compliant strict route (POST /api/teams via
// TeamCreationWizard) must pass the same scan, proving the assertion shape
// is achievable and not tautologically true.
const POSITIVE_CONTROL = 'components/teams/TeamCreationWizard.tsx'

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

describe('POST /api/agents creation sites use sudoFetch (TRDD-F1SL03CK EHT-2)', () => {
  for (const relPath of CREATING_SITES) {
    it(`${relPath} creates agents via sudoFetch, not plain fetch`, () => {
      const src = readSource(relPath)
      expect(src).toContain("import { sudoFetch } from '@/lib/sudo-fetch'")
      expect(src).toMatch(/await sudoFetch\('\/api\/agents'/)
      // No plain fetch('/api/agents', ...) POST left in the file.
      expect(src).not.toMatch(/await fetch\('\/api\/agents',\s*\{/)
    })
  }

  it('positive control: TeamCreationWizard already routes its strict POST via sudoFetch', () => {
    const src = readSource(POSITIVE_CONTROL)
    expect(src).toContain("import { sudoFetch } from '@/lib/sudo-fetch'")
    expect(src).toMatch(/await sudoFetch\(/)
  })


})
