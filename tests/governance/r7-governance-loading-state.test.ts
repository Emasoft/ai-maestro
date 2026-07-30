// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

/**
 * hooks/useGovernance.ts:48 — R7.2 + R7.9.
 *
 * Both rules are enforced by the SAME state declaration, which is why one file pins both:
 *
 *   R7.9 "when governance data is loading, show loading state — do NOT show stale/default
 *         'normal' role, which would be misleading"   -> `useState(true)`      (:48)
 *   R7.2 "show loading spinners for all async operations"
 *                                                     -> `setLoading(true)` on refresh (:142)
 *
 * WHY the initial value is the whole guard: the hook returns `agentTitle` alongside `loading`,
 * and before the fetch resolves that title is the DEFAULT. If `loading` started `false`, a
 * consumer would render the default as if it were authoritative for one paint — the exact
 * "misleading stale role" R7.9 names. The window is short, which is why it survives review and
 * why it needs a test rather than an eyeball.
 *
 * THE VACUITY CONTROL (test 2) is the load-bearing one. R7.9's guard is a SINGLE expression, so
 * a test that only asserts `loading === true` at first render also passes when `loading` is a
 * hardcoded constant `true` — which would be a WORSE bug (a spinner that never clears). Per the
 * project's own rule, a one-expression guard needs a vacuity control, not a second scenario:
 * test 2 proves the value can reach `false`, so test 1 is pinning an INITIAL STATE and not a
 * constant. Neither test alone is worth anything; the pair is.
 *
 * This suite renders the REAL hook. The sibling tests/use-governance-hook.test.ts exercises
 * standalone REPLICAS of two callbacks and says so in an MF-027 block — a workaround for
 * @testing-library/react being absent, which it no longer is (see the correction landed in that
 * file's header). A replica survives deleting the thing it replicates, so it can pin nothing.
 */

const PENDING = new Promise<never>(() => {}) // never settles — holds the hook in its loading state

function mockFetch(mode: 'pending' | 'resolve') {
  const fetchMock = vi.fn(() =>
    mode === 'pending'
      ? (PENDING as unknown as Promise<Response>)
      : Promise.resolve({ ok: true, json: async () => ({}) } as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.resetModules()
  // The hook calls useSudo() for its sudo-token retry; that context is irrelevant here and
  // would otherwise require a provider wrapper, so it is stubbed to a no-op resolver.
  vi.doMock('@/contexts/SudoContext', () => ({ useSudo: () => ({ requestSudoToken: vi.fn() }) }))
  vi.doMock('@/lib/sudo-fetch', () => ({ sudoFetch: vi.fn() }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function loadHook() {
  const mod = await import('@/hooks/useGovernance')
  return mod.useGovernance
}

describe('R7.9 — governance data in flight is reported as LOADING, never as a settled default', () => {
  it('reports loading on the very first render, before any request resolves', async () => {
    mockFetch('pending')
    const useGovernance = await loadHook()

    // MUST sample DURING render, not from `result.current`. React runs the first render and
    // THEN flushes effects, and this hook's effect calls setLoading(true) at :142 — so
    // `result.current.loading` reads `true` whatever the initial value was, and an assertion
    // on it passes with the guard inverted. (Measured: neutering `useState(true)` ->
    // `useState(false)` left that version of this test GREEN, i.e. vacuous.) The render
    // callback body runs during render, so seen[0] IS the pre-effect paint the rule governs.
    const seen: boolean[] = []
    renderHook(() => {
      const state = useGovernance('agent-1')
      seen.push(state.loading)
      return state
    })

    expect(seen.length, 'the hook must have rendered at least once').toBeGreaterThan(0)
    expect(
      seen[0],
      'the FIRST paint must report loading; otherwise the default agentTitle renders as settled',
    ).toBe(true)
  })

  it('VACUITY CONTROL — loading reaches false once the requests settle, so it is state and not a constant `true`', async () => {
    mockFetch('resolve')
    const useGovernance = await loadHook()

    const { result } = renderHook(() => useGovernance('agent-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })
})

describe('R7.2 — a refresh is an async operation and must re-enter the loading state', () => {
  it('returns to loading when refresh() is called after settling', async () => {
    // Start settled so the transition under test is unambiguous: false -> true.
    const fetchMock = mockFetch('resolve')
    const useGovernance = await loadHook()

    const { result } = renderHook(() => useGovernance('agent-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const callsBefore = fetchMock.mock.calls.length

    // Hold the refresh in flight, so `loading` is observable at `true` rather than settling
    // again within the same tick.
    mockFetch('pending')
    act(() => {
      result.current.refresh()
    })

    expect(
      result.current.loading,
      'refresh() is an async operation — R7.2 requires it to present a loading state',
    ).toBe(true)
    expect(fetchMock.mock.calls.length, 'the pre-refresh fetches must have already happened').toBeGreaterThan(0)
    expect(callsBefore).toBeGreaterThan(0)
  })
})
