// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import RoleTab from '@/components/agent-profile/RoleTab'
import type { AgentLocalConfig } from '@/types/agent-local-config'
import type { GovernanceTitle } from '@/hooks/useGovernance'

// ENVIRONMENT, not the guard. `useSudo` is only reached from the switch HANDLER, which this test
// never fires — R11.6 is about which CONTROL is offered, not about what it does when clicked.
vi.mock('@/contexts/SudoContext', () => ({ useSudo: () => ({ requestSudoToken: async () => null }) }))

/**
 * `components/agent-profile/RoleTab.tsx:63-74` — R11.6.
 *
 * "The N:1 compatibility model allows multiple plugins to serve one title — the UI shows a
 * dropdown when 2+ plugins are compatible."
 *
 * WHY BOTH ARMS ARE THE RULE
 * --------------------------
 * The rule reads as one claim ("show a dropdown when 2+") but it is only meaningful against its
 * complement: a UI that ALWAYS shows the dropdown satisfies "2+ gets a dropdown" while offering a
 * choice that does not exist — the operator opens it, finds one entry, and learns nothing about
 * why. CLAUDE.md states the pair explicitly ("1 compatible plugin → fixed label (no choice
 * needed); 2+ → dropdown"), and the component implements it as a three-way branch whose FIRST arm
 * is the single-plugin lock. So the single case is not a bonus assertion; it is the half that
 * makes `> 1` load-bearing rather than decorative.
 *
 * The count comes from a real `fetch` to `/api/agents/role-plugins?title=…`, so the fixture stubs
 * `global.fetch` and the assertions wait for the effect to settle. Stubbing the network is what
 * lets the BRANCH be driven; the branch itself (`compatiblePlugins.length > 1`) is untouched.
 *
 * NOT ASSERTED HERE — the third arm is MEMBER's free choice (`isFreeChoice`), which is a
 * SUPERSET behaviour ("MEMBER always gets Change, whatever the count") and is not part of R11.6's
 * text. Asserting it under this row would claim the rule says something it does not; it belongs
 * to the MEMBER pool description in CLAUDE.md.
 *
 * NEUTER RECORD (2026-07-30) — and the first attempt was WRONG, which is the useful part:
 *
 *   A(bad). `hasMultipleOptions = compatiblePlugins.length > 0` — intended as "give a single
 *           plugin a dropdown too". It reddened NOTHING. The render is
 *           `isSingleLocked ? … : hasMultipleOptions ? … : …`, so with one plugin the FIRST arm
 *           already matches and `hasMultipleOptions` is never consulted. The single-plugin case
 *           is guarded by `isSingleLocked`, not by the `> 1` the rule's text points at.
 *   A. `isSingleLocked = false`   -> ONLY "locks to a fixed label …" fails (1 of 3): the single
 *      case falls through to the FREE-CHOICE arm, which has a "Change" button of its own.
 *   B. `hasMultipleOptions = false` -> "offers a Change control …" and the POSITIVE CONTROL fail
 *      (2 of 3; the control asserts the same "2 options" marker on purpose).
 *
 * A neuter that changes nothing is a finding about the TEST, not a clean bill of health — here it
 * said the expression I had named as the guard was shadowed by an earlier one in the same ternary.
 * Both expressions are inside the cited range (`:63-74`), so the citation was right and the
 * reasoning about which line does the work was not.
 */

const ARCHITECT: GovernanceTitle = 'architect' as GovernanceTitle

function makeConfig(): AgentLocalConfig {
  return {
    workingDirectory: '/fake/agents/tester',
    skills: [],
    agents: [],
    hooks: [],
    rules: [],
    commands: [],
    mcpServers: [],
    lspServers: [],
    outputStyles: [],
    plugins: [],
    // null so BOTH arms render their fallback copy rather than a plugin name — the assertions
    // then key on the branch's own markers ("N options" / "Only option for …") instead of on a
    // string both arms would print.
    rolePlugin: null,
    globalDependencies: null,
    settings: {},
    userGlobalSettings: null,
    keybindings: null,
    lastScanned: new Date(0).toISOString(),
  }
}

/** Stub the compatible-plugins endpoint the effect calls, with `n` plugins. */
function stubCompatible(n: number) {
  const plugins = Array.from({ length: n }, (_, i) => ({
    name: `role-plugin-${i + 1}`,
    marketplace: 'ai-maestro-plugins',
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ plugins }) })),
  )
}

function renderTab() {
  return render(<RoleTab config={makeConfig()} agentId="agent-1" agentTitle={ARCHITECT} agentClient="claude" />)
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('R11.6 — the role-plugin control reflects how many plugins actually fit the title', () => {
  it('offers a Change control when 2+ plugins are compatible', async () => {
    stubCompatible(2)
    renderTab()

    // The option COUNT is rendered, which is the visible evidence that N:1 is in play — a
    // dropdown that did not say how many options it holds would leave the operator guessing.
    await waitFor(() => expect(screen.getByText('2 options')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy()
  })

  it('locks to a fixed label when exactly 1 plugin is compatible', async () => {
    // The complement, and the half that makes `> 1` load-bearing: without it, a UI that always
    // showed the dropdown would satisfy the test above while offering a choice of one.
    stubCompatible(1)
    renderTab()

    await waitFor(() => expect(screen.getByText(/only option for/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    expect(screen.queryByText(/\d+ options/)).toBeNull()
  })

  it('POSITIVE CONTROL — the fetch was actually made and the component rendered', async () => {
    // Both assertions above wait on an async effect, and an effect that never ran would leave
    // the component in its initial state — where `compatiblePlugins` is empty and the FREE-CHOICE
    // arm renders a "Change" button of its own. That arm would satisfy the first test for
    // entirely the wrong reason, so the query the endpoint was actually asked has to be checked.
    stubCompatible(2)
    renderTab()

    await waitFor(() => expect(screen.getByText('2 options')).toBeTruthy())
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(String(calls[0][0])).toContain('/api/agents/role-plugins?title=ARCHITECT')
  })
})
