'use client'

/**
 * Revoke the governance password (TRDD-P7XKV3N9) — now a thin config over the unified
 * PasswordDialog (Phase D), the fifth and last surface off the bespoke pattern.
 *
 * Revoke's distinct 2-step flow (enter the CURRENT password → a console code → the
 * password is DESTROYED, not replaced) maps onto PasswordDialog's general password→code
 * machine: onSubmit runs the invalidate call-1 (password) and, when the server has
 * dispatched a code, returns `{ secondStep }` to advance to the code view; onSecondStep
 * runs call-2 (password + code) and finishes the revoke.
 *
 * Carries NO POLICY. It collects input, POSTs, and renders whatever the server says —
 * including the refusals. Every gate (console presence, the one-shot code, rate-limit)
 * lives in the endpoint, because every route is curl-able: a check placed in a client
 * is skippable with one curl, so it is not a weak check, it is no check. Notably absent
 * on purpose: no "are you at the console?" check here (the server decides from the
 * socket), no password pre-validation (that would require this code to HOLD the secret),
 * and the confirmation code is never in a response body — it arrives on the desktop.
 */
import PasswordDialog from './PasswordDialog'

interface Props {
  onClose: () => void
  onRevoked: () => void
}

/** Turn the server's error codes into something a human can act on. */
function explain(err: string, message?: string): string {
  switch (err) {
    case 'console_required':
      return message ?? 'This can only be done from the machine running AI Maestro.'
    case 'presence_channel_unavailable':
      return 'AI Maestro could not put a confirmation code on this machine’s desktop, so it cannot confirm you are here. Revocation refused.'
    case 'invalid_password':
      return 'That is not the current password.'
    case 'too_many_attempts':
      return 'Too many attempts. Wait a while and try again.'
    case 'code_mismatch':
      return 'That code is not correct.'
    case 'code_expired':
      return 'That code expired. Start again.'
    case 'code_rate_limited':
      return 'Too many wrong codes. Start again.'
    case 'no_password_set':
      return 'There is no password to revoke.'
    default:
      return message ?? err
  }
}

async function post(body: Record<string, string>) {
  const res = await fetch('/api/governance/password/invalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, data: await res.json().catch(() => ({})) }
}

export default function RevokePasswordDialog({ onClose, onRevoked }: Props) {
  return (
    <PasswordDialog
      purpose="confirm"
      variant="modal"
      destructive
      allowReset={false}
      title="Revoke governance password"
      description="The current password will be DESTROYED, not replaced. The next login will ask you to create a new one. Use this if the password may have leaked."
      submitLabel="Continue"
      secondStepSubmitLabel="Revoke password"
      onCancel={onClose}
      onSubmit={async (password) => {
        const { ok, data } = await post({ password })
        if (!ok) return { ok: false, error: explain(data.error ?? 'unknown', data.message) }
        if (!data.codeRequired) return { ok: false, error: explain(data.error ?? 'unknown', data.message) }
        // Password accepted, a console code was dispatched — advance to the code step.
        return { ok: true, secondStep: { hint: 'delivered to this machine’s desktop' } }
      }}
      onSecondStep={async (code, password) => {
        const { ok, data } = await post({ password, code })
        if (!ok || !data.invalidated) return { ok: false, error: explain(data.error ?? 'unknown', data.message) }
        return { ok: true }
      }}
      onSuccess={onRevoked}
    />
  )
}
