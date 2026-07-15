// @vitest-environment jsdom
/**
 * PasswordDialog — the ONE unified governance-password / auth dialog (TRDD-P7XKV3N9).
 * Five surfaces (LoginGate, SudoContext, GovernancePasswordDialog, RevokePasswordDialog,
 * TeamListView) now share this component — "we cannot debug five versions of the same
 * code" — so these tests pin the behaviour they all depend on:
 *   - the native `login` path (POST /api/auth/login, error rendering, onSuccess gating);
 *   - the built-in "forgot password" → multi-channel reset state machine;
 *   - the generic password→one-time-code two-step shape the destructive revoke flow needs;
 *   - the caller-supplied `onSubmit` error path and the destructive/custom-label styling.
 *
 * The component only collects input, POSTs, and renders whatever the server says — policy
 * lives in the routes — so every case here mocks `fetch` (or the caller `onSubmit`) and
 * asserts on what the UI does with the response. No real endpoint is hit.
 *
 * NOTE (JSX runtime): the app's components are authored for the automatic JSX runtime (no
 * `import React`), so the vitest run that loads a `.tsx` test MUST set
 * `esbuild: { jsx: 'automatic' }` (and broaden `include` to `.tsx`) — see the report for
 * the exact one-time config change the repo needs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PasswordDialog from '@/components/governance/PasswordDialog'

const okJson = (data: unknown = {}) => ({ ok: true, json: async () => data })
const badJson = (data: unknown = {}) => ({ ok: false, json: async () => data })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PasswordDialog', () => {
  it('login: submits the password to /api/auth/login and calls onSuccess when the server says ok', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okJson({}))
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi.fn()

    render(<PasswordDialog purpose="login" onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Governance password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.password).toBe('hunter2')
  })

  it('login: renders the server error and does NOT call onSuccess when login is rejected', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => badJson({ error: 'Access denied XYZ' }))
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi.fn()

    render(<PasswordDialog purpose="login" onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Governance password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Access denied XYZ')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('login: "Did you forget your password?" reveals the two reset methods', () => {
    vi.stubGlobal('fetch', vi.fn())

    render(<PasswordDialog purpose="login" onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Did you forget your password?' }))

    expect(screen.getByRole('button', { name: /This machine/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Recovery email/ })).toBeTruthy()
  })

  it('reset: choosing "This machine" posts method=console and reveals the code + new-password inputs', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okJson({ channel: 'file', hint: '~/x', expiresAt: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<PasswordDialog purpose="login" onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Did you forget your password?' }))
    fireEvent.click(screen.getByRole('button', { name: /This machine/ }))

    expect(await screen.findByPlaceholderText('6-digit code')).toBeTruthy()
    expect(screen.getByPlaceholderText('New governance password (min 8)')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/governance/password/reset', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.method).toBe('console')
  })

  it('two-step: an onSubmit that returns secondStep advances to the code view, then onSecondStep(code, password) → onSuccess', async () => {
    const onSubmit = vi.fn(async (_pw: string, _confirm?: string) => ({ ok: true as const, secondStep: {} }))
    const onSecondStep = vi.fn(async (_code: string, _pw: string) => ({ ok: true as const }))
    const onSuccess = vi.fn()

    render(
      <PasswordDialog
        purpose="confirm"
        onSubmit={onSubmit}
        onSecondStep={onSecondStep}
        onSuccess={onSuccess}
        secondStepSubmitLabel="Revoke now"
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Governance password'), { target: { value: 'pw123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    const codeInput = await screen.findByPlaceholderText('6-digit code')
    expect(onSubmit).toHaveBeenCalledWith('pw123', undefined)

    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke now' }))

    await waitFor(() => expect(onSecondStep).toHaveBeenCalledWith('123456', 'pw123'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('non-login: an onSubmit that returns ok:false renders the error and does NOT call onSuccess', async () => {
    const onSubmit = vi.fn(async (_pw: string, _confirm?: string) => ({ ok: false as const, error: 'custom_failure_123' }))
    const onSuccess = vi.fn()

    render(<PasswordDialog purpose="sudo" onSubmit={onSubmit} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Governance password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('custom_failure_123')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('destructive + submitLabel: renders the custom primary label with red styling', () => {
    render(
      <PasswordDialog
        purpose="confirm"
        destructive
        submitLabel="Revoke password"
        onSuccess={vi.fn()}
        onSubmit={vi.fn(async () => ({ ok: true as const }))}
      />,
    )

    const btn = screen.getByRole('button', { name: 'Revoke password' })
    expect(btn).toBeTruthy()
    expect(btn.className).toContain('bg-red-700')
  })
})
