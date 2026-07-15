/**
 * Send-only 2FA mailer (TRDD-P7XKV3N9 sibling — multi-channel password recovery).
 *
 * Delivers a one-shot verification code to a user's registered email so a REMOTE
 * device (iPad/iPhone) can complete a password reset, or verify its email at
 * registration. It runs entirely IN-PROCESS — no third-party SaaS — but it must relay
 * through an AUTHENTICATED SMTP endpoint (your own email provider), because mail sent
 * directly from a residential Mac is rejected or spam-foldered by iCloud/Gmail (no
 * SPF/DKIM/DMARC, dynamic IP, no reverse DNS). It is SEND-ONLY: it never opens a
 * mailbox, never reads mail, holds no IMAP credentials.
 *
 * DORMANT UNTIL CONFIGURED: with the SMTP env vars unset, isMailerConfigured() is
 * false and sendCodeEmail() is a no-op returning {ok:false, skipped:true}. Callers
 * then fall back to the console channel — so the feature builds, tests, and ships with
 * NO credentials, and the email channel lights up the moment the owner provides them.
 * This is deliberate: email is one recovery channel among three (console, email,
 * passkey), never a hard dependency.
 *
 * Config (ALL of host/port/user/pass required to enable):
 *   AIM_SMTP_HOST, AIM_SMTP_PORT, AIM_SMTP_USER, AIM_SMTP_PASS
 * Optional:
 *   AIM_SMTP_FROM   — envelope From (defaults to AIM_SMTP_USER)
 *   AIM_SMTP_SECURE — 'true' for implicit TLS; defaults to true on port 465, else
 *                     STARTTLS. Set explicitly when your provider is non-standard.
 */
import nodemailer from 'nodemailer'

export interface MailerConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
  secure: boolean
}

/**
 * Resolve SMTP config from the environment, or null when it is not fully configured.
 * ALL of host/port/user/pass must be present — a partial config is treated as
 * "not configured" rather than half-enabling a channel that would fail at send time.
 */
export function getMailerConfig(): MailerConfig | null {
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
    // Implicit TLS on 465; STARTTLS otherwise. An explicit AIM_SMTP_SECURE wins.
    secure: process.env.AIM_SMTP_SECURE ? process.env.AIM_SMTP_SECURE === 'true' : port === 465,
  }
}

export function isMailerConfigured(): boolean {
  return getMailerConfig() !== null
}

export type SendResult =
  | { ok: true }
  | { ok: false; skipped: true } // mailer not configured — caller falls back to console
  | { ok: false; error: string } // configured but the send failed

/**
 * Send a one-shot verification code to `to`. Returns {ok:false, skipped:true} when the
 * mailer is not configured (the caller then delivers via the console channel instead).
 *
 * `code` is digits-only (see setup-bootstrap.generateCode), so interpolating it into
 * the subject/body is injection-safe. `purpose` is a short caller-supplied noun
 * ("password reset", "email verification") — keep it a literal, never user input.
 */
export async function sendCodeEmail(to: string, code: string, purpose: string): Promise<SendResult> {
  const cfg = getMailerConfig()
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
