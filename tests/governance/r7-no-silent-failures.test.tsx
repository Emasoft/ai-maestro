// @vitest-environment jsdom
/**
 * R7.3 — "Show **error messages** for all failures — no silent failures allowed."
 * Guard: `components/sidebar/TeamListView.tsx:636` (the `{error && …}` block).
 *
 * WHY THE CITED LINE IS NOT THE WHOLE RULE, AND WHAT THAT COSTS
 * ------------------------------------------------------------
 * :636 is the DISPLAY. On its own it proves nothing: a component that renders
 * `error` faithfully while three of its four failure paths never SET `error`
 * satisfies that line and violates the rule. R7.3's quantifier is "ALL
 * failures", so this file is MECHANISM + COVERAGE — the display works, AND
 * every way this dialog can fail reaches it. The failure paths were enumerated
 * from the source, not guessed:
 *
 *   server rejects        `:247` -> `data.error || 'Failed to create team'`
 *   body is unparseable   `:245` -> `.catch(() => ({ error: `HTTP ${status}` }))`
 *   the call throws       `:261` -> `'Network error'`
 *   client-side refusal   `:489` -> the GitHub-URL message, and submit is BLOCKED
 *   the LIST fails        `:63`/`:71` -> its own `fetchError` banner at `:277`
 *
 * Two of those are the classic silent-failure shapes and are the reason the rule
 * exists: a `res.json()` that throws, and a `fetch` that rejects, both end with
 * the user staring at an unchanged dialog unless something deliberately speaks.
 *
 * WHY THIS IS A `.tsx` TEST AND NOT A CATEGORY ERROR
 * -------------------------------------------------
 * R7.3 is a PRESENTATION rule: its entire content is what the operator SEES, so
 * the component is its only possible enforcement point. "A check in a client is
 * no check" governs AUTHORIZATION — every route is curl-able, so an authz check
 * must land in the route — and reading it as a blanket ban on `.tsx` guards
 * would wrongly gut this row. (Same ruling as r7-team-blocked-badge.test.tsx.)
 *
 * WHAT IS MOCKED, AND WHY IT IS NOT THE GUARD
 * -------------------------------------------
 * `sudoFetch` and `fetch` are the DATA SOURCES that produce the failures; making
 * them fail is how the guard is reached at all. `useGovernance` is stubbed to
 * report a MANAGER because the Create button is disabled without one (`:301`) —
 * a different rule's gate, and leaving it real would make every test here
 * unreachable rather than passing. The dialog, its state, and the error
 * rendering are all REAL.
 *
 * SWEEP (2026-07-30): NEGATIVE, in a shape already catalogued. `TeamListView` is
 * named in exactly one test — `tests/unit/password-dialog.test.tsx` — and only
 * in its HEADER COMMENT, listing it as one of five callers of the shared
 * PasswordDialog. That file tests PasswordDialog, which this dialog does not use
 * for creation. A comment naming a file is not coverage of it.
 *
 * NEUTER RECORD (2026-07-30) — three, complementary:
 *   A. delete the `{error && …}` block (:636)
 *      -> the four dialog-failure tests red; the SUCCESS and LIST tests stay green.
 *   B. make `if (err) setError(err)` (:521) a no-op
 *      -> only the three SERVER-side tests red; the client-validation test stays
 *         green, which is what proves the two `setError` sites are distinct
 *         guards and not one guard counted twice.
 *   C. delete the `{fetchError && …}` block (:277)
 *      -> only the LIST test reds.
 * Neuter B is the one that matters: with A alone, this file would look like five
 * assertions about a single `&&`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const { SUDO } = vi.hoisted(() => ({ SUDO: { impl: null as unknown as (...a: unknown[]) => unknown } }))

// The Create button is disabled without a MANAGER (`:301`) — a DIFFERENT rule's
// gate. Stubbed open so the dialog under test is reachable.
vi.mock('@/hooks/useGovernance', () => ({
  useGovernance: () => ({
    loading: false,
    hasManager: true,
    managerId: 'mgr-1',
    managerName: 'mgr',
    teams: [],
    requests: [],
  }),
}))

vi.mock('@/contexts/SudoContext', () => ({
  useSudo: () => ({ requestSudoToken: async () => 'sudo-token' }),
}))

// DATA SOURCE, not guard: producing the failure is how the guard is reached.
vi.mock('@/lib/sudo-fetch', () => ({
  sudoFetch: (...args: unknown[]) => SUDO.impl(...args),
}))

import TeamListView from '@/components/sidebar/TeamListView'

/** The teams LIST call. Separate from `sudoFetch`, which is the create call. */
function stubList(res: { ok: boolean; status?: number; body?: unknown } | 'throw') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (res === 'throw') throw new Error('offline')
      return { ok: res.ok, status: res.status ?? 200, json: async () => res.body ?? { teams: [] } }
    }),
  )
}

/** Render, wait out the initial load, open the Create Team dialog. */
async function openCreateDialog() {
  const view = render(<TeamListView agents={[]} searchQuery="" />)
  await waitFor(() => expect(screen.queryByText(/loading teams/i)).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /create team/i }))
  const form = view.container.querySelector('form')
  expect(form, 'the create dialog did not open').toBeTruthy()
  return { view, form: form! }
}

/** Fill the required name and submit. `github` exercises the client-side path. */
function submitForm(form: HTMLFormElement, opts: { name?: string; github?: string } = {}) {
  fireEvent.change(form.querySelector('input[placeholder="Backend Squad"]')!, {
    target: { value: opts.name ?? 'r73-team' },
  })
  if (opts.github !== undefined) {
    fireEvent.change(form.querySelector('input[type="url"]')!, { target: { value: opts.github } })
  }
  fireEvent.submit(form)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  SUDO.impl = null as never
})

describe('R7.3 — every failure speaks; none of them is silent', () => {
  it("renders the SERVER's own message verbatim, not a generic one", async () => {
    SUDO.impl = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'A team named "r73-team" already exists' }),
    })
    stubList({ ok: true })
    const { form } = await openCreateDialog()
    submitForm(form)

    // Verbatim matters: a UI that swallows the server's reason and prints
    // "Failed to create team" has technically shown an error and has told the
    // operator nothing about the 409 they can actually act on.
    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy())
    expect(screen.getByText(/A team named "r73-team" already exists/)).toBeTruthy()
  })

  it('still speaks when the error BODY is unparseable — the classic silent failure', async () => {
    SUDO.impl = async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    })
    stubList({ ok: true })
    const { form } = await openCreateDialog()
    submitForm(form)

    // An HTML error page from a proxy lands here. Without the `.catch` fallback
    // at `:245` the throw escapes into the outer catch and the user sees
    // "Network error" for a server-side 500 — or, before it existed, nothing.
    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeTruthy())
  })

  it('still speaks when the request THROWS — the other classic silent failure', async () => {
    SUDO.impl = async () => {
      throw new Error('Failed to fetch')
    }
    stubList({ ok: true })
    const { form } = await openCreateDialog()
    submitForm(form)

    // A rejected fetch is the shape that leaves a dialog sitting there looking
    // like nothing was ever clicked.
    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy())
  })

  it('refuses client-side WITH a message — it does not just quietly not-submit', async () => {
    SUDO.impl = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ team: {} }) }))
    stubList({ ok: true })
    const { form } = await openCreateDialog()
    submitForm(form, { github: 'https://example.com/not-a-project' })

    // BOTH halves. "Blocked" alone is the silent failure R7.3 forbids — the
    // button appears to do nothing — and "spoke" alone would mean junk was
    // still sent to the server.
    await waitFor(() => expect(screen.getByText(/not in a recognized format/i)).toBeTruthy())
    expect(SUDO.impl).not.toHaveBeenCalled()
  })

  it('shows NOTHING on success — so the four assertions above are about a real conditional', async () => {
    SUDO.impl = async () => ({
      ok: true,
      status: 201,
      json: async () => ({ team: { id: 't1', name: 'r73-team', agentIds: [] } }),
    })
    stubList({ ok: true })
    const { form } = await openCreateDialog()
    submitForm(form)

    // The complementary half: an error box rendered unconditionally would
    // satisfy every test above while screaming at the operator on every
    // successful create.
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
    expect(screen.queryByText(/failed|error|HTTP/i)).toBeNull()
  })

  it('a failure to LOAD the list speaks too — an empty list is not an error report', async () => {
    stubList({ ok: false, status: 503, body: { error: 'teams store unavailable' } })
    render(<TeamListView agents={[]} searchQuery="" />)

    // Its own state and its own banner (`:277`), reached by a path that never
    // touches the dialog — which is why neuter C reds only this test. Silently
    // rendering "no teams" for a 503 is the most misleading failure in the file.
    await waitFor(() => expect(screen.getByText(/teams store unavailable/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})
