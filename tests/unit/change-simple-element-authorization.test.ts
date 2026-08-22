import { describe, it, expect } from 'vitest'
import {
  ChangeAgentDef,
  ChangeCommand,
  ChangeRule,
  ChangeOutputStyle,
} from '@/services/element-management-service'
import type { AuthContext } from '@/lib/agent-auth'

/**
 * TRDD-JWE3CFLV — the four simple-element pipelines authorize at Gate 0.
 *
 * `changeSimpleElement` backs ChangeAgentDef / ChangeCommand / ChangeRule /
 * ChangeOutputStyle, and it was the ONLY element pipeline in
 * `services/element-management-service.ts` with no `gate0Auth` call at all —
 * 18 siblings have one. Its single production caller is
 * `POST /api/agents/[id]/remove-element`, whose own comment asserts
 *
 *     "The Change* pipelines run their own Gate 0 authorization on the
 *      resolved authContext."
 *
 * TRUE for the `ChangeSkill` and `ChangeMCP` arms of that same switch, FALSE
 * for these four. So any AUTHENTICATED agent of ANY title could delete another
 * agent's rules, commands, agent-definitions and output-styles — including the
 * `.claude/rules/` files that constrain that agent.
 *
 * WHY IT SURVIVED REVIEW: the IRON never-user-scope gate (G00b) sits where a
 * reader expects the authorization gate, but it is conditional on
 * `scope === 'user'` AND a state-ADDING action, while the removal route always
 * passes `scope: 'local', action: 'remove'`. On the one live path G00b is a
 * no-op. A conditional gate next to no gate looks exactly like a gate.
 *
 * NOTE ON THE EXISTING SUITE: every call in
 * `tests/services/element-management-service.test.ts` passes
 * `_tAuth = { isSystemOwner: true }`, which short-circuits `gate0Auth` on its
 * first line. Those tests stayed green through the whole defect and would stay
 * green if the gate were deleted again — which is why this file exists and why
 * it uses NON-system-owner contexts throughout.
 *
 * NEUTER RUN (2026-08-22 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/const g0err = await gate0Auth/const g0err = null && await gate0Auth/ if $. == 6226
 *   → 6 red / 0 green:
 *       ChangeAgentDef refuses a MEMBER removing an element from another agent
 *       ChangeCommand refuses a MEMBER removing an element from another agent
 *       ChangeOutputStyle refuses a MEMBER removing an element from another agent
 *       ChangeRule refuses a MEMBER removing an element from another agent
 *       POSITIVE CONTROL — a MANAGER clears Gate 0 and the pipeline proceeds past it
 *       refuses an agent reconfiguring ITSELF, whatever its title
 *
 * All SIX, including the positive control — which I had predicted at five, and
 * the prediction was wrong in an instructive direction: the control asserts the
 * ops trace carries `G00: Authorized`, and deleting the gate removes that line
 * too. So it is not a control against a blanket-refusal in the NEUTERED state;
 * it is a control that in the SHIPPED state the same gate can answer both ways
 * on the same input shape, with only the caller's title differing. The
 * line-anchored mutation matters: this expression appears at SIX sites in the
 * file (4632/6020/6226/6404/6535/6677), and a shape-matched neuter would have
 * hit every element pipeline at once and produced a plausible red set.
 */

const TARGET = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'

/** A MEMBER-title agent token — authenticated, and authorized for nothing here. */
const memberCtx: AuthContext = {
  agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  isSystemOwner: false,
  governanceTitle: 'member',
  teamId: null,
}

/** A MANAGER-title agent token — the positive control. */
const managerCtx: AuthContext = {
  agentId: 'cccccccc-3333-4333-8333-cccccccccccc',
  isSystemOwner: false,
  governanceTitle: 'manager',
  teamId: null,
}

/** The exact shape the removal route sends: local scope, action 'remove'. */
const removal = { name: 'some-element', action: 'remove' as const, scope: 'local' as const, agentDir: '/tmp/nonexistent-agent-dir' }

describe('TRDD-JWE3CFLV — changeSimpleElement authorizes at Gate 0', () => {
  const pipelines: Array<[string, (id: string | null, d: typeof removal, a: AuthContext) => Promise<{ success: boolean; error?: string; operations: string[] }>]> = [
    ['ChangeAgentDef', ChangeAgentDef],
    ['ChangeCommand', ChangeCommand],
    ['ChangeRule', ChangeRule],
    ['ChangeOutputStyle', ChangeOutputStyle],
  ]

  for (const [name, pipeline] of pipelines) {
    it(`${name} refuses a MEMBER removing an element from another agent`, async () => {
      /** Validates that an authenticated non-privileged agent cannot strip another agent's elements */
      const result = await pipeline(TARGET, removal, memberCtx)

      expect(result.success).toBe(false)
      // Pin the REASON, not just the refusal: `success === false` alone is
      // satisfied by any later gate failing (the agentDir above does not
      // exist), which would pass with the authorization gate deleted.
      expect(result.error).toMatch(/cannot manage-skills other agents/i)
      expect(result.operations.join('\n')).toMatch(/G00: DENIED/)
      // And prove it aborted AT G00 — no later gate may have run.
      expect(result.operations.join('\n')).not.toMatch(/G01:/)
    })
  }

  it('refuses an agent reconfiguring ITSELF, whatever its title', async () => {
    /** Validates the universal no-self-reconfiguration rule reaches this pipeline too */
    const selfCtx: AuthContext = { ...managerCtx }
    const result = await ChangeRule(managerCtx.agentId!, removal, selfCtx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/No agent can modify itself/i)
    expect(result.operations.join('\n')).not.toMatch(/G01:/)
  })

  it('POSITIVE CONTROL — a MANAGER clears Gate 0 and the pipeline proceeds past it', async () => {
    /** Validates the gate can say YES, so the denials above are a decision and not a blanket refusal */
    const result = await ChangeRule(TARGET, removal, managerCtx)

    // What happens after G00 is not this file's subject (the agentDir is
    // deliberately absent, so a later gate will refuse). What matters is that
    // G00 AUTHORIZED and execution continued past it.
    expect(result.operations.join('\n')).toMatch(/G00: Authorized/)
    expect(result.operations.join('\n')).not.toMatch(/G00: DENIED/)
  })
})
