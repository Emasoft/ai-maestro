/**
 * Send-only 2FA mailer (TRDD-P7XKV3N9 sibling — multi-channel password recovery).
 *
 * Delivers a one-shot verification code to a user's registered email so a REMOTE
 * device (iPad/iPhone) can complete a password reset, or verify its email at
 * registration. Runs entirely IN-PROCESS — no third-party SaaS — relaying through the
 * owner's OWN authenticated SMTP (mail sent directly from a residential Mac is rejected
 * or spam-foldered by iCloud/Gmail: no SPF/DKIM/DMARC, dynamic IP, no reverse DNS). It
 * is SEND-ONLY: never opens a mailbox, never reads mail, holds no IMAP credentials.
 *
 * AUTO-CONFIGURED FROM THE EMAIL (the "autoconfigure it based on the user email"
 * requirement): the owner registers their email and stores their provider app-password
 * ONCE; the SMTP host/port/TLS are then DERIVED from the email domain (lib/email-providers)
 * and the password read from the OS credential store (lib/smtp-credential). gmail →
 * Gmail SMTP, icloud → iCloud SMTP, and so on — no manual server config.
 *
 * Resolution is PER FIELD, not all-or-nothing. For each field:
 *   1. The AIM_SMTP_* env var for THAT field, when set — an independent override.
 *   2. Auto-config — detectProvider(accountEmail) + the stored app-password.
 *   3. The merged result must still be COMPLETE (host+port+user+pass). If it is not,
 *      the mailer is DORMANT: sendCodeEmail() is a no-op {ok:false, skipped:true} and
 *      the caller falls back to the console channel. So the feature builds, tests, and
 *      ships with NO credentials, lighting up the moment the owner adds them. Email is
 *      one recovery channel among three (console, email, passkey), never a hard dep.
 *
 * Every AIM_SMTP_* variable is INDEPENDENT: setting one overrides exactly its own field
 * and leaves the rest to the dashboard-configured relay. `AIM_SMTP_HOST=relay.internal`
 * alone now means "same account, different host". It previously meant NOTHING — the env
 * path required all four together, so a lone override was silently discarded while the
 * operator believed it had taken effect.
 *
 * Completeness is still enforced on the MERGED config, which preserves the property the
 * all-or-nothing shape was protecting: a partial override with no stored relay behind it
 * is incomplete, so it stays dormant rather than half-enabling a channel that would fail
 * at send time.
 *
 * Env vars (each optional and independent):
 *   AIM_SMTP_HOST, AIM_SMTP_PORT, AIM_SMTP_USER, AIM_SMTP_PASS, AIM_SMTP_FROM
 *   (defaults to the effective user), AIM_SMTP_SECURE ('true'/'false'; defaults to the
 *   stored value, or true on port 465 / STARTTLS elsewhere when the port is overridden).
 */
import nodemailer from 'nodemailer'
import { detectProvider } from './email-providers'
import { getSmtpPassword } from './smtp-credential'
import { getRecoveryEmail } from './governance'
import { resolveAuthUser } from './smtp-autodetect'

export interface MailerConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
  secure: boolean
}

/** The one port that means implicit TLS on connect; every other port means STARTTLS. */
const IMPLICIT_TLS_PORT = 465

/**
 * The per-field SMTP override read from the environment. Each AIM_SMTP_* var contributes
 * ONLY its own field; an unset var contributes nothing and leaves that field to the
 * dashboard config.
 *
 * THROWS on a malformed value rather than dropping it. A typo'd AIM_SMTP_PORT must not
 * quietly disable the recovery channel while the operator believes it is live — absence
 * is a legitimate "not configured", but a wrong value is a bug they need to see. This is
 * the fail-fast rule: the override either works as written or the process says why.
 */
function envOverride(): Partial<MailerConfig> {
  const ov: Partial<MailerConfig> = {}

  const host = process.env.AIM_SMTP_HOST?.trim()
  if (host) ov.host = host
  const user = process.env.AIM_SMTP_USER?.trim()
  if (user) ov.user = user
  const pass = process.env.AIM_SMTP_PASS
  if (pass) ov.pass = pass
  const from = process.env.AIM_SMTP_FROM?.trim()
  if (from) ov.from = from

  const portRaw = process.env.AIM_SMTP_PORT?.trim()
  if (portRaw) {
    const port = Number(portRaw)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`AIM_SMTP_PORT="${portRaw}" is not a valid TCP port (1-65535)`)
    }
    ov.port = port
  }

  const secureRaw = process.env.AIM_SMTP_SECURE?.trim()
  if (secureRaw) {
    if (secureRaw !== 'true' && secureRaw !== 'false') {
      throw new Error(`AIM_SMTP_SECURE="${secureRaw}" must be exactly "true" or "false"`)
    }
    ov.secure = secureRaw === 'true'
  }

  return ov
}

/**
 * Auto-config for a registered email: the app-password from the credential store, plus SMTP
 * settings that PREFER the stored autodetected config (correct for corporate/regional domains
 * and the local-part username quirk) and fall back to the curated table for a consumer
 * provider whose settings were never explicitly stored. Null when no password is stored yet.
 */
function autoConfig(accountEmail: string): MailerConfig | null {
  const pass = getSmtpPassword(accountEmail)
  if (!pass) return null
  let host: string, port: number, secure: boolean, usernameFormat: 'full' | 'local'
  // The MAESTRO's explicit SMTP login id, when stored (TRDD-P7XKV3N9). Only the stored
  // recovery config can carry it; the curated table knows only usernameFormat.
  let explicitUsername: string | undefined
  const rec = getRecoveryEmail()
  if (rec && rec.email.toLowerCase() === accountEmail.toLowerCase() && rec.smtp) {
    ({ host, port, secure, usernameFormat } = rec.smtp)
    explicitUsername = rec.smtp.username
  } else {
    const provider = detectProvider(accountEmail)
    if (!provider) return null
    host = provider.host
    port = provider.port
    secure = provider.secure
    usernameFormat = provider.usernameFormat ?? 'full' // most providers use the full address; some regional telcos use the local part
  }
  // An explicit userid wins; else derive (local-part for a few EU telcos, full address otherwise).
  const user = resolveAuthUser(accountEmail, usernameFormat, explicitUsername)
  return { host, port, secure, user, from: accountEmail, pass }
}

/**
 * Resolve the effective SMTP config: the stored/auto-config for `accountEmail` (the owner's
 * registered address) with each env var layered over its own field, or null when the merged
 * result is incomplete. Pass the registered email whenever you want the stored relay as the
 * base — without it, only the env vars can supply a field, so they must supply all four.
 *
 * Throws if an env var is present but malformed (see envOverride).
 */
export function getMailerConfig(accountEmail?: string): MailerConfig | null {
  const base = accountEmail ? autoConfig(accountEmail) : null
  const ov = envOverride()

  const host = ov.host ?? base?.host
  const port = ov.port ?? base?.port
  const user = ov.user ?? base?.user
  const pass = ov.pass ?? base?.pass
  // Completeness is checked on the MERGE, not on either source: a lone override with no
  // stored relay behind it is still "not configured" and stays dormant.
  if (!host || !port || !user || !pass) return null

  // `secure` tracks the EFFECTIVE port unless stated outright. Keeping the stored value
  // when the port was NOT overridden preserves a provider's known-correct setting; deriving
  // it when the port WAS overridden is what stops AIM_SMTP_PORT=465 from inheriting a
  // stored STARTTLS and failing the handshake — the one field that cannot be varied
  // independently of the port without producing a config that never connects.
  const secure = ov.secure ?? (base && ov.port === undefined ? base.secure : port === IMPLICIT_TLS_PORT)

  return { host, port, user, pass, from: ov.from ?? base?.from ?? user, secure }
}

export function isMailerConfigured(accountEmail?: string): boolean {
  return getMailerConfig(accountEmail) !== null
}

export type SendResult =
  | { ok: true }
  | { ok: false; skipped: true } // mailer not configured — caller falls back to console
  | { ok: false; error: string } // configured but the send failed

/**
 * Send a one-shot verification code to `to`, using the owner's own SMTP account.
 * `accountEmail` defaults to `to` — the recovery case sends the owner a code at their
 * OWN registered address, which is also the SMTP account, so a single argument covers
 * it. Returns {ok:false, skipped:true} when the mailer is not configured (the caller
 * then delivers via the console channel instead).
 *
 * `code` is digits-only (setup-bootstrap.generateCode), so interpolating it into the
 * subject/body is injection-safe. `purpose` is a short caller-supplied literal noun
 * ("password reset", "email verification") — never user input.
 */
export async function sendCodeEmail(to: string, code: string, purpose: string, accountEmail: string = to): Promise<SendResult> {
  const cfg = getMailerConfig(accountEmail)
  if (!cfg) return { ok: false, skipped: true }
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    })
    await transport.sendMail({
      from: cfg.from,
      to,
      subject: `AI Maestro ${purpose} code: ${code}`,
      text:
        `Your AI Maestro ${purpose} code is ${code}.\n\n` +
        `It expires in 5 minutes. If you did not request this, you can ignore this email — ` +
        `no change is made without the code.\n`,
    })
    return { ok: true }
  } catch (e) {
    // Never throw: a send failure must degrade to the console channel, not 500 the
    // recovery flow. The caller inspects {ok:false, error} and falls back.
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Send a verification code to a NORMAL/FOREIGN user's own email THROUGH the MAESTRO relay
 * (TRDD-7U927FCM 2B — the role-split). The user supplied ONLY a destination address; the
 * host authenticates and sends as the MAESTRO's own mail provider — so `to` is the user and
 * the SMTP `from`/account is the MAESTRO's recovery email (autoConfig resolves the stored
 * relay because accountEmail === that email).
 *
 * Gated on a VERIFIED MAESTRO relay: `verified` means the MAESTRO already sent+received a
 * code through this provider, i.e. it is PROVEN to send. With no verified relay there is no
 * trustworthy way to reach the user by email, so this returns {ok:false, skipped:true} and
 * the caller MUST fall back to another factor — never a silent success on a relay that may
 * not work. (An unverified or unconfigured relay is treated the same as an unconfigured
 * mailer, matching sendCodeEmail's skipped contract.)
 */
export async function sendUserCodeEmail(userEmail: string, code: string, purpose: string): Promise<SendResult> {
  const relay = getRecoveryEmail()
  if (!relay?.email || !relay.verified) return { ok: false, skipped: true }
  return sendCodeEmail(userEmail, code, purpose, relay.email)
}
