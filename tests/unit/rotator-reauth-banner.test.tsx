// @vitest-environment jsdom
/**
 * RotatorReauthBanner (TRDD-CVQJNW3A box 3, surface half) — the dashboard alarm for the OAuth
 * rotator's `reauth-needed` verdict. Asserts: it renders on `reauth-needed` naming the dead
 * account; it is silent on `ok`, on `null`, and on a non-ok response.
 *
 * THREE NEUTERS, RUN 2026-09-10, because no single one pins this file — cases 3 and 4 each fall
 * to a mutation the others survive:
 *
 *   (a) guard → `if (status?.tickNextAction !== 'ok') return null`
 *       → 2 red (cases 1, 2), 2 pass. Cases 3 and 4 SURVIVE it, which is why (b) and (c) exist.
 *
 *   (b) alarm-on-null → `if (status?.tickNextAction === 'ok') return null`
 *       → 4 red. It reddens everything, but case 3 is the one that falls ONLY to this: the
 *       component's silence-on-null is a FORCED decision (armed-but-dead and never-armed both
 *       arrive as null and this route cannot separate them), and case 3 is what holds it in
 *       place against exactly this lenient edit.
 *
 *   (c) delete `if (!response.ok) return`
 *       → EXACTLY 1 red, case 4 — which is the measurement proving case 4's fixture is the
 *       load-bearing one described below.
 *
 * Case 4's fixture is deliberately a body that WOULD render — `{tickNextAction: 'reauth-needed'}`
 * behind `ok: false`. With a plausible error body (`{error: '...'}`) the case passes whether or
 * not `if (!response.ok) return` exists, because `tickNextAction` would be undefined either way:
 * the test would be decoration. As written, deleting that guard reds it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import RotatorReauthBanner from '@/components/RotatorReauthBanner'

const HEADLINE = 'Claude account needs a re-login'

const okJson = (data: unknown) => ({ ok: true, json: async () => data })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RotatorReauthBanner', () => {
  it('reauth-needed: renders the alarm and names the dead account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okJson({
          tickNextAction: 'reauth-needed',
          accounts: [
            { email: 'live@example.com', refreshDead: false },
            { email: 'dead@example.com', refreshDead: true },
          ],
        })
      )
    )

    render(<RotatorReauthBanner />)

    expect(await screen.findByText(HEADLINE)).toBeTruthy()
    // The dead one is named and the healthy one is NOT — the route's own rationale is that a
    // "Re-login" button is useless without saying WHICH account needs one.
    expect(screen.getByText(/dead@example\.com/)).toBeTruthy()
    expect(screen.queryByText(/live@example\.com/)).toBeNull()
    // It announces itself: the banner appears dynamically to report a stranded system.
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('ok: renders nothing, no residue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ tickNextAction: 'ok', accounts: [] })))

    const { container } = render(<RotatorReauthBanner />)

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(screen.queryByText(HEADLINE)).toBeNull()
  })

  it('null verdict: SILENT — the tick is not beating, and this route cannot say why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ tickNextAction: null, accounts: [] })))

    const { container } = render(<RotatorReauthBanner />)

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(screen.queryByText(HEADLINE)).toBeNull()
  })

  it('non-ok response: SILENT even when the body would otherwise render', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          tickNextAction: 'reauth-needed',
          accounts: [{ email: 'dead@example.com', refreshDead: true }],
        }),
      }))
    )

    const { container } = render(<RotatorReauthBanner />)

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(screen.queryByText(HEADLINE)).toBeNull()
  })
})
