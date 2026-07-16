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
 * Resolution order (first that resolves wins):
 *   1. AIM_SMTP_* env — an explicit override for a custom/self-hosted relay.
 *   2. Auto-config — detectProvider(accountEmail) + the stored app-password.
 *   3. Not configured → DORMANT: sendCodeEmail() is a no-op {ok:false, skipped:true}
 *      and the caller falls back to the console channel. So the feature builds, tests,
 *      and ships with NO credentials, lighting up the moment the owner adds them. Email
 *      is one recovery channel among three (console, email, passkey), never a hard dep.
 *
 * Env override (ALL of host/port/user/pass required to enable it):
 *   AIM_SMTP_HOST, AIM_SMTP_PORT, AIM_SMTP_USER, AIM_SMTP_PASS
 * Optional: AIM_SMTP_FROM (defaults to AIM_SMTP_USER), AIM_SMTP_SECURE ('true' for
 *   implicit TLS; defaults to true on port 465, else STARTTLS).
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

/**
 * Explicit SMTP override from the environment, or null when it is not fully set. ALL of
 * host/port/user/pass must be present — a partial config is "not configured" rather
 * than half-enabling a channel that would fail at send time.
 */
function envConfig(): MailerConfig | null {
  const host = process.env.AIM_SMTP_HOST
  const portRaw = process.env.AIM_SMTP_PORT
  const user = process.env.AIM_SMTP_USER
  const pass = process.env.AIM_SMTP_PASS
  if (!host || !portRaw || !user || !pass) return null
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  return {
    host,
    port,
    user,
    pass,
    from: process.env.AIM_SMTP_FROM || user,
    secure: process.env.AIM_SMTP_SECURE ? process.env.AIM_SMTP_SECURE === 'true' : port === 465,
  }
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
 * Resolve the SMTP config: the env override first, else auto-config for `accountEmail`
 * (the owner's registered address), else null. Pass the registered email whenever you
 * want the auto-config path — without it only the env override can resolve.
 */
export function getMailerConfig(accountEmail?: string): MailerConfig | null {
  const env = envConfig()
  if (env) return env
  if (accountEmail) return autoConfig(accountEmail)
  return null
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
