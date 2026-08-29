// @vitest-environment jsdom
/**
 * AgentCreationWizard dismissal routes (TRDD-FY6I2MO2).
 *
 * The completion screen ("Your Agent is Ready! / Let's Go!") is a `fixed inset-0
 * z-50` overlay whose backdrop was inert for the whole of `isCreating` — and
 * `isCreating` is never set false on success. So a missed "Let's Go!" click left
 * the overlay covering the dashboard and blocking the Delete flow (seen in two
 * independent SCEN-031 runs).
 *
 * Two claims are pinned here, and they pull in opposite directions:
 *   1. Every route out of the modal goes through the shared `dismiss` handler.
 *   2. After success, `dismiss` routes to `onComplete` (which hands the parent
 *      the new agent id) and NEVER to `onClose` — dismissing without the id is
 *      the SCEN-005 wrong-agent-delete near-miss (Proposal 31).
 *
 * The pre-success half is driven behaviourally (a fresh mount is reachable).
 * The success half is NOT reachable from a unit test — it needs a full drive of
 * the wizard's six steps plus a 6.5 s animation and a POST /api/agents — so it
 * is pinned structurally against the source. Both halves carry a positive
 * control, because a source assertion that reads the wrong file, or a render
 * that produced nothing, passes silently.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AgentCreationWizard from '@/components/AgentCreationWizard'

const SOURCE = readFileSync(
  join(process.cwd(), 'components/AgentCreationWizard.tsx'),
  'utf8'
)

afterEach(() => cleanup())

describe('AgentCreationWizard — dismissal routes (TRDD-FY6I2MO2)', () => {
  it('positive control: the source under assertion is the wizard and is non-empty', () => {
    expect(SOURCE.length).toBeGreaterThan(10_000)
    expect(SOURCE).toContain("Your Agent is Ready!")
    expect(SOURCE).toContain("Let&apos;s Go!")
  })

  it('before creation: the backdrop dismisses, and routes to onClose', () => {
    let closed = 0
    let completed = 0
    render(
      <AgentCreationWizard onClose={() => { closed++ }} onComplete={() => { completed++ }} />
    )

    const backdrop = screen.getByTestId('agent-creation-wizard')
    fireEvent.click(backdrop)

    expect(closed).toBe(1)
    expect(completed).toBe(0)
  })

  it('before creation: the header X dismisses, and routes to onClose', () => {
    let closed = 0
    let completed = 0
    render(
      <AgentCreationWizard onClose={() => { closed++ }} onComplete={() => { completed++ }} />
    )

    fireEvent.click(screen.getByTestId('wizard-close'))

    expect(closed).toBe(1)
    expect(completed).toBe(0)
  })

  it('clicking inside the panel does NOT dismiss (the backdrop guard is not global)', () => {
    let closed = 0
    render(<AgentCreationWizard onClose={() => { closed++ }} onComplete={() => {}} />)

    fireEvent.click(screen.getByText('New Agent Setup'))

    expect(closed).toBe(0)
  })

  it('the backdrop is inert only while a creation is IN FLIGHT, not after it succeeds', () => {
    // `isCreating` alone would freeze the completion screen too — the whole bug.
    expect(SOURCE).toContain('onClick={isCreating && !creationSuccess ? undefined : dismiss}')
    expect(SOURCE).not.toContain('onClick={isCreating ? undefined : onClose}')
  })

  it('after success every route hands the parent the new agent id (never a bare close)', () => {
    expect(SOURCE).toMatch(
      /const dismiss = useCallback\(\(\) => \{\s*if \(creationSuccess\) onComplete\(createdAgentId\)\s*else onClose\(\)/
    )
    // The "Let's Go!" button must share that handler rather than call onComplete
    // itself — otherwise the backdrop and X remain a second, id-losing exit.
    expect(SOURCE).toContain('data-testid="wizard-lets-go"')
    expect(SOURCE).not.toContain('onClick={() => onComplete(createdAgentId)}')
  })
})
