// @vitest-environment jsdom
/**
 * R7.1 — "Prevent accidental multiple operations from fast repeated clicks —
 * all mutating buttons must have `submitting` guards."
 * Guards: `components/sidebar/TeamListView.tsx:661`,
 *         `components/governance/PasswordDialog.tsx:334`.
 *
 * THE RULE'S CONTENT IS A COUNT, SO THE ASSERTION MUST BE A COUNT
 * --------------------------------------------------------------
 * "Prevent accidental multiple operations" is not "the button looks greyed
 * out" — it is "N clicks produce ONE mutation". A test that only asserts
 * `disabled` passes against a handler that is re-entrant through some other
 * path (the Enter key, a second surface), which is exactly how a double-create
 * ships. Every mechanism test here clicks THREE times against a submit that is
 * still in flight and asserts the mutating call fired EXACTLY ONCE.
 *
 * WHY THE CITED :334 IS NOT THE LOAD-BEARING SITE
 * -----------------------------------------------
 * `PasswordDialog.tsx:334` is `disabled={busy}` on the password INPUT — one of
 * ~15 such sites in that file. R7.1 is about mutating BUTTONS, so the site that
 * actually enforces it is the submit button at `:487`
 * (`disabled={busy || !canSubmitPassword}`), and the Enter-key path at `:331`
 * (`&& !busy`) is a THIRD, independent re-entry the button's attribute cannot
 * cover. All three are now cited: a rule cited at one of its sites leaves the
 * others invisible, because the citation they lack names real working code and
 * nothing reddens.
 *
 * THE "ALL" IN "ALL MUTATING BUTTONS" IS COVERED BY A DOM SWEEP
 * ------------------------------------------------------------
 * A per-button test would go stale the day a button is added. Instead: while a
 * submit is in flight, EVERY button in the dialog must be disabled except the
 * four that are pure NAVIGATION (forgot-password, two Backs, Close) — those
 * mutate nothing, so R7.1 does not reach them, and naming them is what makes
 * the sweep meaningful. A new mutating button added without a guard reddens it;
 * a new navigation button forces a deliberate re-read of this list.
 *
 * WHAT IS MOCKED, AND WHY IT IS NOT THE GUARD
 * -------------------------------------------
 * The in-flight promise is the whole fixture — a submit that resolves
 * immediately can never be clicked "during". `sudoFetch` / `onSubmit` are the
 * DATA SINKS whose call COUNT is the assertion. `useGovernance` / `useSudo` are
 * stubbed because the Create button is disabled without a MANAGER (a different
 * rule's gate), which would make every test here unreachable rather than
 * passing.
 *
 * SWEEP (2026-07-30): NEGATIVE. `tests/unit/password-dialog.test.tsx` is the
 * only test of PasswordDialog and contains zero occurrences of `disabled`,
 * `busy`, `submitting`, or any repeated-click case — it drives the happy and
 * error paths only. TeamListView's dialog had no test at all before
 * r7-no-silent-failures.test.tsx, which asserts messages, never re-entry.
 *
 * NEUTER RECORD (2026-07-30) — three, complementary:
 *   A. drop `saving` from TeamListView's `disabled` (:661)
 *      -> only the TeamListView tests red.
 *   B. drop `busy` from PasswordDialog's submit `disabled` (:487)
 *      -> only the click-count and sweep tests red; the Enter test stays green.
 *   C. drop `&& !busy` from the Enter handler (:331)
 *      -> ONLY the Enter test reds — which is what proves the keyboard path is
 *         a separate guard and not the button's attribute counted twice.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PasswordDialog from '@/components/governance/PasswordDialog'

const { SUDO } = vi.hoisted(() => ({ SUDO: { impl: null as unknown as (...a: unknown[]) => unknown } }))

vi.mock('@/hooks/useGovernance', () => ({
  useGovernance: () => ({ loading: false, hasManager: true, managerId: 'm', managerName: 'm', teams: [], requests: [] }),
}))
vi.mock('@/contexts/SudoContext', () => ({
  useSudo: () => ({ requestSudoToken: async () => 'tok' }),
}))
vi.mock('@/lib/sudo-fetch', () => ({ sudoFetch: (...a: unknown[]) => SUDO.impl(...a) }))

import TeamListView from '@/components/sidebar/TeamListView'

/** A promise the test controls, so "in flight" is a state it can click during. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** Buttons R7.1 does NOT reach: they navigate between views and mutate nothing. */
const NAVIGATION_ONLY = [/forget your password/i, /back to sign in/i, /^← back$/i, /close/i]
const isNavigation = (b: HTMLButtonElement) =>
  NAVIGATION_ONLY.some(re => re.test(b.textContent || '') || re.test(b.getAttribute('aria-label') || ''))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  SUDO.impl = null as never
})

describe('R7.1 — the team-create dialog fires ONE mutation per submit', () => {
  async function openDialogMidFlight() {
    const gate = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>()
    SUDO.impl = vi.fn(() => gate.promise)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ teams: [] }) })))

    const view = render(<TeamListView agents={[]} searchQuery="" />)
    await waitFor(() => expect(screen.queryByText(/loading teams/i)).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /create team/i }))
    const form = view.container.querySelector('form')!
    fireEvent.change(form.querySelector('input[placeholder="Backend Squad"]')!, {
      target: { value: 'r71-team' },
    })
    return { form, submit: form.querySelector('button[type="submit"]') as HTMLButtonElement, gate }
  }

  it('three fast clicks produce exactly ONE create call', async () => {
    const { submit } = await openDialogMidFlight()

    fireEvent.click(submit)
    await waitFor(() => expect(SUDO.impl).toHaveBeenCalledTimes(1))
    // The rule, literally: the operator mashes the button while the first
    // request is still open. Asserting `disabled` alone would not catch a
    // handler that stays reachable by some other route.
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(SUDO.impl).toHaveBeenCalledTimes(1)
  })

  it('says it is working, and says so on the button the operator is clicking', async () => {
    const { submit } = await openDialogMidFlight()
    fireEvent.click(submit)

    // Disabled is the mechanism; the label is how the operator learns WHY the
    // button stopped responding. A guard with no feedback reads as a hang.
    await waitFor(() => expect(submit.disabled).toBe(true))
    expect(submit.textContent).toMatch(/saving/i)
  })
})

describe('R7.1 — PasswordDialog fires ONE submit, from either input path', () => {
  function renderMidFlight() {
    const gate = deferred<{ ok: false; error: string }>()
    const onSubmit = vi.fn(() => gate.promise)
    render(<PasswordDialog purpose="sudo" title="Confirm" onSubmit={onSubmit} onSuccess={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/governance password/i), { target: { value: 'pw' } })
    return { onSubmit, gate }
  }

  const submitButton = () =>
    Array.from(document.querySelectorAll('button')).find(b => /confirm|working/i.test(b.textContent || '')) as HTMLButtonElement

  it('three fast clicks produce exactly ONE submit', async () => {
    const { onSubmit } = renderMidFlight()

    fireEvent.click(submitButton())
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    fireEvent.click(submitButton())
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('the ENTER key is guarded too — a keyboard user can double-fire as easily', async () => {
    const { onSubmit } = renderMidFlight()
    const input = screen.getByPlaceholderText(/governance password/i)

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    // A THIRD re-entry path, independent of the button's `disabled` attribute:
    // the handler is `canSubmitPassword && !busy && submitPassword()`, and
    // without the `!busy` term the attribute guards nothing here.
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('ALL mutating buttons are disabled in flight — navigation is exempt, and named', async () => {
    const { onSubmit } = renderMidFlight()
    fireEvent.click(submitButton())
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    expect(buttons.length).toBeGreaterThan(1) // non-vacuity: the sweep saw a real dialog
    for (const b of buttons) {
      if (isNavigation(b)) continue
      expect(b.disabled, `mutating button "${b.textContent}" is NOT guarded while busy`).toBe(true)
    }
  })
})
