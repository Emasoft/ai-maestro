/**
 * R51.7 — a pipeline declares its INVARIANTS, not only its gates.
 *
 * "Every gate ran" and "the system is valid" are different claims (lib/gate-transaction.ts). A
 * run where each gate succeeded can still leave a CONTRADICTION, and the residue check only ever
 * catches LEFTOVERS. The runner's `invariants` hook is where the second claim is asserted: a
 * violation is treated exactly like a gate failure — same reverse compensation, same R51.3 message.
 *
 * THE FAMILY THIS COMES FROM. Several pipelines ended with a trailing `// Verify final state` block
 * that pushed a `WARN` and then reported SUCCESS anyway — a log line dressed as a verification.
 * `ChangeSkill` and `changeSimpleElement` were promoted to hard DENIALs earlier; `ChangeTitle`'s
 * G22 became the first `invariants` hook; `ChangeName`'s G06 is the second and is what this file
 * pins behaviourally.
 *
 * NOT PROMOTED, AND THE REASON IS A MEASUREMENT — `ChangePlugin`'s G11 (`:4888`). It reads the
 * settings file through `loadJsonSafe`, which returns `{}` on a PARSE FAILURE (`:362-370`), so it
 * cannot distinguish "the plugin key is absent" from "the file is unreadable". Promoted, a corrupt
 * `settings.local.json` would roll back a correct plugin change. That is the same blind spot that
 * kept `InstallElement`'s PG01 outside its R51 window (TRDD-YAGRX7W3) — two independent instances,
 * which is why `loadJsonSafe`'s swallowing catch is its own task and not a drive-by here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const { mockGetAgent, mockUpdateAgent, mockEmitAgentOp } = vi.hoisted(() => ({
  mockGetAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockEmitAgentOp: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: mockGetAgent,
  updateAgent: mockUpdateAgent,
  loadAgents: vi.fn(() => []),
}))

// The ledger append writes to the REAL ~/.aimaestro store. Mocked so the happy-path control cannot
// leave state behind on the developer's machine — this repo has already paid for a suite that
// wrote its own state dir.
vi.mock('@/lib/ledger-emit', () => ({ emitAgentOp: mockEmitAgentOp }))

const AGENT_ID = 'agent-r517'
const OLD = { id: AGENT_ID, name: 'old-name', sessions: [] }
const NEW = { id: AGENT_ID, name: 'new-name', sessions: [] }
const AUTH = { isSystemOwner: true as const, agentId: undefined, governanceTitle: 'system' as const, teamId: null }

describe('R51.7 — ChangeName verifies the rename LANDED, and reverts when it did not', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateAgent.mockResolvedValue(NEW)
  })

  it('POSITIVE CONTROL — a rename that lands is verified and succeeds', async () => {
    // G02 sees the old name; the invariants hook sees the new one.
    mockGetAgent.mockReturnValueOnce(OLD).mockReturnValue(NEW)

    const { ChangeName } = await import('@/services/element-management-service')
    const result = await ChangeName(AGENT_ID, 'new-name', AUTH)

    expect(result.success, result.error).toBe(true)
    expect(result.operations.some(op => op.startsWith('G06: Final name verified'))).toBe(true)
    // Exactly one write: the rename itself, with no compensation behind it.
    expect(mockUpdateAgent).toHaveBeenCalledTimes(1)
    expect(mockEmitAgentOp).toHaveBeenCalledTimes(1)
  })

  it('a rename that did NOT stick fails the operation and REVERTS — it used to WARN and report success', async () => {
    // `updateAgent` reports success, but the registry still shows the old name: the write was
    // silently clobbered (a concurrent writer, a failed persist). Before R51.7 this pushed
    // `G06: WARN` and returned success, having also renamed every live tmux session.
    mockGetAgent.mockReturnValue(OLD)

    const { ChangeName } = await import('@/services/element-management-service')
    const result = await ChangeName(AGENT_ID, 'new-name', AUTH)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Final name "old-name" != expected "new-name"')
    // R51.3 — the caller is told the system was left alone, in the wording every pipeline uses.
    expect(result.error).toContain('NO CHANGES WERE MADE TO THE SYSTEM')

    // THE COMPENSATION: a second write putting the prior name back, through `updateAgent` so the
    // tmux sessions come back with it.
    expect(mockUpdateAgent).toHaveBeenCalledTimes(2)
    expect(mockUpdateAgent.mock.calls[1]).toEqual([AGENT_ID, { name: 'old-name' }])

    // …and no ledger entry for a rename that did not happen.
    expect(mockEmitAgentOp).not.toHaveBeenCalled()
  })
})

// ── The ratchet ────────────────────────────────────────────────────────────────────────────────

const SERVICE = join(process.cwd(), 'services', 'element-management-service.ts')

/**
 * Pipelines that pass an `invariants` callback to the runner, found by AST rather than by grep:
 * the word appears in prose comments and in `enforceAgentInvariants` (CreateAgent's G05), which is
 * the agent-invariant REGISTRY — a gate, not the runner's success-path hook. The two are one grep
 * apart, and counting the wrong one would report a coverage that does not exist.
 */
function pipelinesWithInvariants(): string[] {
  const text = readFileSync(SERVICE, 'utf-8')
  const src = ts.createSourceFile(SERVICE, text, ts.ScriptTarget.Latest, true)
  const found = new Set<string>()

  for (const stmt of src.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue
    const fnName = stmt.name.text
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'runGateSequence' || node.expression.text === 'runAioPipeline')
      ) {
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue
          for (const p of arg.properties) {
            const key =
              (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p)) &&
              ts.isIdentifier(p.name)
                ? p.name.text
                : null
            if (key === 'invariants') found.add(fnName)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(stmt.body)
  }
  return [...found].sort()
}

/**
 * THE RATCHET — it rises as pipelines declare their post-conditions, and must never fall.
 *
 * Deliberately NOT "all 19": an invariant is a judgement about what makes THIS pipeline's result
 * valid, and a wrong one aborts a correct operation. They go in one at a time, each with the
 * evidence that its check cannot false-positive — see the `ChangePlugin` G11 note at the top of
 * this file for one that did not qualify.
 */
const MIN_WITH_INVARIANTS = 2

/** Pinned BY NAME: a count alone cannot see one pipeline losing its hook while another gains one. */
const MUST_DECLARE_INVARIANTS = ['ChangeName', 'ChangeTitle']

describe('R51.7 — the invariants ratchet', () => {
  const declared = pipelinesWithInvariants()

  it('keeps every pipeline that declares invariants, by name', () => {
    for (const required of MUST_DECLARE_INVARIANTS) {
      expect(
        declared.includes(required),
        `${required} no longer passes an \`invariants\` callback — its success-path check is gone, ` +
          `or has decayed back into a WARN. Declaring now: ${declared.join(', ') || '(none)'}`,
      ).toBe(true)
    }
  })

  it(`has at least ${MIN_WITH_INVARIANTS} pipelines declaring invariants (ratchet — it never falls)`, () => {
    expect(
      declared.length,
      `declaring: ${declared.join(', ') || '(none)'}. If you added one, RAISE MIN_WITH_INVARIANTS.`,
    ).toBeGreaterThanOrEqual(MIN_WITH_INVARIANTS)
  })
})
