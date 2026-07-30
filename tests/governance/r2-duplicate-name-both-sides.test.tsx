// @vitest-environment jsdom
/**
 * R2.2 — "Duplicate name check must be enforced BOTH server-side (API rejects
 * with 409) AND client-side (UI shows inline error BEFORE POST)."
 * Guards: `lib/team-registry.ts:107`,
 *         `components/teams/TeamCreationWizard.tsx:201`.
 *
 * THE RULE'S WHOLE CONTENT IS THE WORD "BOTH", SO ONE HALF IS NOT A PIN
 * --------------------------------------------------------------------
 * The two halves defend different failures and neither substitutes for the
 * other. The SERVER half is the only real gate — every route is curl-able, so
 * a client check alone is no check at all. The CLIENT half is not security: it
 * is the difference between "the field turns red as you type" and "you fill in
 * five wizard steps, hit Create, and get a 409". A test that covers one half
 * and leaves the other uncited reports the rule as pinned while half of it is
 * invisible to every instrument.
 *
 * WHAT THE SWEEP FOUND (2026-07-30) — a genuine half, already covered
 * ------------------------------------------------------------------
 * The SERVER half IS tested: `tests/validate-team-mutation.test.ts` drives the
 * real `validateTeamMutation` and asserts `{valid:false, error:'A team named
 * "Alpha Squad" already exists', code:409}` for the case-insensitive duplicate.
 * So R2.2's row cites BOTH test files, and this file adds only what was
 * missing.
 *
 * The CLIENT half had NO vitest coverage at all: the only mentions of
 * `TeamCreationWizard` in the whole test tree are inside `.scen.md` scenario
 * documents, which are prose, not tests. (This is the sixth distinct
 * false-positive shape catalogued in this campaign — a file "covered" only by
 * documents that describe driving it.)
 *
 * "BEFORE POST" IS AN ASSERTION ABOUT THE NETWORK, NOT ABOUT A RED BORDER
 * ----------------------------------------------------------------------
 * The rule says the error appears BEFORE the POST, so the tests assert `fetch`
 * was never called, and that the step-advance gate refuses to move on while the
 * error stands (`:324` — `!nameValidation.error`). An inline message that still
 * let the wizard proceed would satisfy a naive "the error is visible" check and
 * violate the rule.
 *
 * THE CLIENT MUST MIRROR THE SERVER'S COMPARISON, NOT JUST HAVE ONE
 * ----------------------------------------------------------------
 * `lib/team-registry.ts:106` lowercases both sides. A client check that is
 * case-SENSITIVE would pass a "shows an inline error" test on an exact match
 * and still hand the user a 409 on "alpha squad" — the two halves must agree,
 * which is why the case-insensitive case is asserted here and not only server-side.
 *
 * NEUTER RECORD (2026-07-30) — three, complementary:
 *   A. delete the `teamDupe` check (`:200-201`)
 *      -> only the team-duplicate tests red; the agent-collision test stays green.
 *   B. delete the `agentDupe` check (`:202-203`)
 *      -> only the agent-collision test reds.
 *   C. drop `!nameValidation.error` from the step gate (`:324`)
 *      -> ONLY the "cannot advance" test reds — which is what proves the gate is
 *         a separate guard from the message, and that "before POST" is not just
 *         a restatement of "shows an error".
 *
 * WHAT NEUTER C FOUND — IN THIS TEST, NOT IN THE CODE
 * --------------------------------------------------
 * On its first run neuter C reddened NOTHING. Step 0's gate is
 * `name.length >= 4 && !nameValidation.error && password.length > 0`, and the
 * test never filled the password — so Next was disabled for the PASSWORD, and
 * `expect(disabled).toBe(true)` passed for a reason that had nothing to do with
 * the duplicate. The test now fills the password AND asserts Next is ENABLED on
 * a clean name first, so the duplicate is provably the only thing that can
 * block it. A neuter that reddens nothing is a finding about the test.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// The wizard's POST is sudo-gated, so it reads SudoContext at render. Stubbed
// because it is a DIFFERENT rule's gate (R12/sudo-mode) and its provider is not
// what R2.2 is about — without it the component throws before any name is typed.
vi.mock('@/contexts/SudoContext', () => ({
  useSudo: () => ({ requestSudoToken: async () => 'tok' }),
}))

import TeamCreationWizard from '@/components/teams/TeamCreationWizard'

const RESERVED = { teamNames: ['Alpha Squad'], agentNames: ['tatiana'] }

function openWizard() {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <TeamCreationWizard isOpen onClose={() => {}} onCreated={() => {}} reservedNames={RESERVED} />,
  )
  return { nameInput: screen.getByPlaceholderText(/e\.g\. Backend Squad/i), fetchMock }
}

const nextButton = () =>
  Array.from(document.querySelectorAll('button')).find(b => /^next$/i.test((b.textContent || '').trim())) as HTMLButtonElement

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('R2.2 (client half) — the duplicate is refused inline, before any POST', () => {
  it('an existing TEAM name turns into an inline error, with no network call', async () => {
    const { nameInput, fetchMock } = openWizard()
    fireEvent.change(nameInput, { target: { value: 'Alpha Squad' } })

    await waitFor(() => expect(screen.getByText(/A team named "Alpha Squad" already exists/)).toBeTruthy())
    // "BEFORE POST", asserted against the network rather than against a colour.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the comparison is case-INSENSITIVE, matching the server', async () => {
    const { nameInput } = openWizard()
    fireEvent.change(nameInput, { target: { value: 'alpha squad' } })

    // lib/team-registry.ts:106 lowercases both sides. A case-SENSITIVE client
    // check would pass the test above and still hand the user a 409 here — the
    // two halves have to agree, not merely both exist.
    await waitFor(() => expect(screen.getByText(/A team named "Alpha Squad" already exists/)).toBeTruthy())
  })

  it('an existing AGENT name is refused too — a separate reserved namespace', async () => {
    const { nameInput } = openWizard()
    fireEvent.change(nameInput, { target: { value: 'Tatiana' } })

    await waitFor(() => expect(screen.getByText(/"tatiana" is already used by an agent/i)).toBeTruthy())
  })

  it('cannot ADVANCE while the duplicate stands — the message alone is not the rule', async () => {
    const { nameInput } = openWizard()

    // Step 0's gate is `name.length >= 4 && !nameValidation.error && password`.
    // The password MUST be filled or Next is disabled for that reason instead,
    // and the assertion below passes for the wrong one — neuter C reddened
    // NOTHING until this line existed. (Not a secret: any non-empty string
    // satisfies `length > 0`; the real governance password never enters a test.)
    fireEvent.change(screen.getByPlaceholderText(/governance password/i), { target: { value: 'x' } })

    fireEvent.change(nameInput, { target: { value: 'Beta Squad' } })
    await waitFor(() => expect(nextButton().disabled).toBe(false))

    // Now the ONLY thing that can block Next is the duplicate.
    fireEvent.change(nameInput, { target: { value: 'Alpha Squad' } })
    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy())

    // An inline message that still let the wizard proceed would satisfy "shows
    // an inline error" and violate "before POST".
    expect(nextButton().disabled).toBe(true)
  })

  it('a clean name clears the error and unblocks the wizard', async () => {
    const { nameInput } = openWizard()
    fireEvent.change(nameInput, { target: { value: 'Alpha Squad' } })
    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy())

    // The complementary half: a validator that rejected EVERY name, or a gate
    // wired permanently shut, would pass all four assertions above.
    fireEvent.change(nameInput, { target: { value: 'Beta Squad' } })
    await waitFor(() => expect(screen.queryByText(/already exists/)).toBeNull())
  })
})
