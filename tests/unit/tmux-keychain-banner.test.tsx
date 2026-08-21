// @vitest-environment jsdom
/**
 * TmuxKeychainAlarmBanner (TRDD-GIA2LC83) — the dashboard half of the tmux-server
 * keychain watchdog (TRDD-78J4I4QS). Asserts: active alarm renders the banner with the
 * alarm's own remediation text; clear alarm renders nothing and leaves no residue.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import TmuxKeychainAlarmBanner from '@/components/TmuxKeychainAlarmBanner'

const okJson = (data: unknown) => ({ ok: true, json: async () => data })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TmuxKeychainAlarmBanner', () => {
  it('active alarm: renders the banner carrying the alarm message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okJson({ active: true, since: '2026-08-18T00:00:00Z', message: 'recreate the server now' })
      )
    )

    render(<TmuxKeychainAlarmBanner />)

    expect(await screen.findByText('recreate the server now')).toBeTruthy()
    expect(screen.getByText('Tmux server is keychain-blind')).toBeTruthy()
  })

  it('clear alarm (active: false): renders nothing, no residue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ active: false })))

    const { container } = render(<TmuxKeychainAlarmBanner />)

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(screen.queryByText('Tmux server is keychain-blind')).toBeNull()
  })
})
