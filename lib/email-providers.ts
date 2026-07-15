/**
 * SMTP provider auto-detection (TRDD-P7XKV3N9 sibling — email recovery channel).
 *
 * AI Maestro derives the SMTP host/port/TLS from the user's email DOMAIN so the owner
 * never hand-configures a mail server: they register their email and enter their
 * provider app-password ONCE, and every future 2FA send uses these settings. This is
 * the "autoconfigure it based on the user email" requirement — gmail → Gmail SMTP,
 * icloud → iCloud SMTP, etc.
 *
 * Most consumer providers (Gmail, iCloud, Yahoo, AOL, Fastmail) require an
 * APP-SPECIFIC password because the account has 2FA — the normal login password will
 * NOT authenticate to SMTP. `appPasswordUrl` is where the owner generates one; the
 * setup UI links to it so the owner isn't left guessing.
 */
export interface SmtpProvider {
  /** Human label for the UI (e.g. "Gmail"). */
  label: string
  host: string
  port: number
  /** true = implicit TLS (465); false = STARTTLS (587). */
  secure: boolean
  /** true when the domain is a known provider; false for a best-effort guess. */
  known: boolean
  /** Where to generate an app-specific password, when the provider requires one. */
  appPasswordUrl?: string
  /** Short UI note (e.g. "requires an app password"). */
  note?: string
}

// Keyed by the lowercased email domain. Aliases (googlemail, me.com, hotmail…) point
// at the same provider settings. Ports/hosts verified against each provider's current
// SMTP submission docs (2026-07); STARTTLS-on-587 vs implicit-TLS-on-465 matches what
// each provider actually accepts, which is why they are not uniform.
const PROVIDERS: Record<string, Omit<SmtpProvider, 'known'>> = {
  'gmail.com': { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true, appPasswordUrl: 'https://myaccount.google.com/apppasswords', note: 'requires an app password (2-step verification must be on)' },
  'googlemail.com': { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true, appPasswordUrl: 'https://myaccount.google.com/apppasswords', note: 'requires an app password (2-step verification must be on)' },
  'icloud.com': { label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, secure: false, appPasswordUrl: 'https://account.apple.com/account/manage', note: 'requires an app-specific password' },
  'me.com': { label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, secure: false, appPasswordUrl: 'https://account.apple.com/account/manage', note: 'requires an app-specific password' },
  'mac.com': { label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, secure: false, appPasswordUrl: 'https://account.apple.com/account/manage', note: 'requires an app-specific password' },
  'outlook.com': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, note: 'may require an app password if 2FA is on' },
  'hotmail.com': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, note: 'may require an app password if 2FA is on' },
  'live.com': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, note: 'may require an app password if 2FA is on' },
  'msn.com': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'yahoo.com': { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, secure: true, appPasswordUrl: 'https://login.yahoo.com/account/security/app-passwords', note: 'requires an app password' },
  'ymail.com': { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, secure: true, appPasswordUrl: 'https://login.yahoo.com/account/security/app-passwords', note: 'requires an app password' },
  'aol.com': { label: 'AOL', host: 'smtp.aol.com', port: 465, secure: true, appPasswordUrl: 'https://login.aol.com/account/security/app-passwords', note: 'requires an app password' },
  'fastmail.com': { label: 'Fastmail', host: 'smtp.fastmail.com', port: 465, secure: true, appPasswordUrl: 'https://app.fastmail.com/settings/security/apppassword', note: 'requires an app password' },
  'fastmail.fm': { label: 'Fastmail', host: 'smtp.fastmail.com', port: 465, secure: true, appPasswordUrl: 'https://app.fastmail.com/settings/security/apppassword', note: 'requires an app password' },
  'gmx.com': { label: 'GMX', host: 'mail.gmx.com', port: 587, secure: false },
  'gmx.net': { label: 'GMX', host: 'mail.gmx.net', port: 587, secure: false },
  'zoho.com': { label: 'Zoho', host: 'smtp.zoho.com', port: 465, secure: true },
  'proton.me': { label: 'Proton Mail', host: '127.0.0.1', port: 1025, secure: false, note: 'requires the Proton Mail Bridge running locally' },
  'protonmail.com': { label: 'Proton Mail', host: '127.0.0.1', port: 1025, secure: false, note: 'requires the Proton Mail Bridge running locally' },
}

/**
 * Extract the lowercased domain from an email address, or null when the string is not
 * a plausible `local@domain` shape (no `@`, empty local part, or empty domain).
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return null
  const domain = email.slice(at + 1).toLowerCase().trim()
  // A bare domain with no dot (e.g. "user@localhost") can't be an SMTP provider lookup.
  return domain.includes('.') ? domain : null
}

/**
 * Resolve SMTP settings for an email. Returns a KNOWN provider from the table, or a
 * best-effort guess (`smtp.<domain>:587` STARTTLS — the most widely-supported
 * submission profile) for an unrecognized domain, or null when the string isn't a
 * usable email. The owner can override a wrong guess via AIM_SMTP_* env (see mailer.ts).
 */
export function detectProvider(email: string): SmtpProvider | null {
  const domain = emailDomain(email)
  if (!domain) return null
  const known = PROVIDERS[domain]
  if (known) return { ...known, known: true }
  return {
    label: domain,
    host: `smtp.${domain}`,
    port: 587,
    secure: false,
    known: false,
    note: 'guessed SMTP settings — set AIM_SMTP_* if sending fails',
  }
}
