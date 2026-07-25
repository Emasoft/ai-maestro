/**
 * R50 ratchet — one operation, one all-in-one function.
 *
 * "THERE MUST BE ONLY ONE FUNCTION FOR EACH OPERATION, AND THAT FUNCTION MUST BE AN ALL-IN-ONE."
 * (USER, 2026-07-25.)
 *
 * The store primitives in lib/agent-registry.ts are implementation details of the pipeline that
 * owns them. A service calling one directly performs the operation while skipping every gate —
 * no cemetery archive, no team-slot clearing, no credential revocation, no session unpersist, no
 * post-condition. That is not a hypothetical: the PersistedSession row that outlived every deleted
 * agent and kept resurrecting its workdir survived because one store had no owner in the pipeline.
 *
 * This test does NOT demand zero bypasses today — 11 exist, and converging them is real work
 * (TRDD-YB4T4RTL). It is a RATCHET: the known set is pinned, so the list can only SHRINK. A new
 * bypass fails the build with the exact file and symbol, at the moment it is introduced, which is
 * the only time it is cheap to avoid.
 *
 * Removing an entry here when you converge a call site is the intended edit. ADDING one is not:
 * if you believe a new bypass is justified, it needs an R50 exception in docs/GOVERNANCE-RULES.md
 * first, because the next reader will otherwise copy it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'

/** Store primitives that only the owning all-in-one may call. */
const PRIMITIVES = ['createAgent', 'deleteAgentBySession', 'renameAgent', 'renameAgentSession', 'saveAgents']

/** The pipeline that owns them, plus the module that defines them. */
const OWNERS = new Set(['services/element-management-service.ts', 'lib/agent-registry.ts'])

/**
 * KNOWN bypasses as of 2026-07-25. Each is an operation performed outside its all-in-one.
 * Convergence is tracked in TRDD-YB4T4RTL. This list may only get shorter.
 */
const KNOWN_BYPASSES = [
  'services/agents-core-service.ts::createAgent',
  'services/agents-docker-service.ts::createAgent',
  'services/agents-docker-service.ts::saveAgents',
  'services/agents-repos-service.ts::saveAgents',
  'services/agents-transfer-service.ts::saveAgents',
  'services/amp-service.ts::createAgent',
  'services/creation-helper-service.ts::createAgent',
  'services/help-service.ts::createAgent',
  'services/sessions-service.ts::createAgent',
  'services/sessions-service.ts::deleteAgentBySession',
  'services/sessions-service.ts::renameAgentSession',
]

function scanBypasses(): string[] {
  const root = join(__dirname, '..', '..')
  const files = [
    ...globSync('services/**/*.ts', { cwd: root }),
    ...globSync('app/api/**/*.ts', { cwd: root }),
    ...globSync('lib/**/*.ts', { cwd: root }),
  ]
  const found = new Set<string>()
  for (const rel of files) {
    if (OWNERS.has(rel) || rel.endsWith('.externbak')) continue
    const src = readFileSync(join(root, rel), 'utf8')
    // Drop comment lines so a symbol NAMED in prose is not counted as a call site.
    const code = src
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
      })
      .join('\n')
    for (const sym of PRIMITIVES) {
      if (new RegExp(`(?<![A-Za-z0-9_])${sym}\\s*\\(`).test(code)) found.add(`${rel}::${sym}`)
    }
  }
  return [...found].sort()
}

describe('R50 — one operation, one all-in-one function', () => {
  it('introduces NO new store-primitive bypass', () => {
    const actual = scanBypasses()
    const added = actual.filter((x) => !KNOWN_BYPASSES.includes(x))
    // A new bypass is a new way to leave the system invalid. Route the operation through its
    // all-in-one (CreateAgent / DeleteAgent / ChangeName / …) instead of touching the store.
    expect(added).toEqual([])
  })

  it('the known-bypass list may only shrink — remove entries as you converge them', () => {
    const actual = scanBypasses()
    const stale = KNOWN_BYPASSES.filter((x) => !actual.includes(x))
    // Not a failure to celebrate silently: a converged call site must be deleted from the pin, or
    // the ratchet quietly loosens by one notch and the next bypass slips in unnoticed.
    expect(stale, `converged — delete these from KNOWN_BYPASSES: ${stale.join(', ')}`).toEqual([])
  })

  it('pins the current count so convergence progress is visible', () => {
    expect(scanBypasses().length).toBe(KNOWN_BYPASSES.length)
  })
})
