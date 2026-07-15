/**
 * Dynamic SMTP autodetection (TRDD-P7XKV3N9) — Thunderbird/Mozilla autoconfig style,
 * with the European-provider quirks (username format, auth-vs-reachability distinction).
 *
 * The curated table in lib/email-providers covers the big consumer providers instantly
 * and offline (and carries their app-password URLs). This module covers EVERYTHING ELSE
 * — corporate, self-hosted, and regional (e.g. Italian) domains — by discovery, in the
 * order Thunderbird uses:
 *
 *   1. Mozilla ISPDB   — GET autoconfig.thunderbird.net/v1.1/<domain> (fixed host: safe).
 *   2. DNS SRV         — _submission._tcp.<domain> (RFC 6186).
 *   3. MX fingerprint  — resolve MX, map the big infrastructures, else guess smtp.<domain>.
 *
 * TWO EU quirks folded in from field experience:
 *   - usernameFormat: some providers (Alice/TIM, …) authenticate with the LOCAL part
 *     only, not the full address. The ISPDB <username> template (%EMAILLOCALPART% vs
 *     %EMAILADDRESS%) says which; it must be carried to send time to build auth.user.
 *   - verifyCredentials returns SUCCESS | AUTH_REQUIRED | FAILED: an SMTP 535 means the
 *     host/port are RIGHT but the password was rejected — i.e. "you need an app-specific
 *     password", not "wrong server". That distinction drives the configure UX.
 *
 * SECURITY: the only HTTP fetch is the FIXED Mozilla host — no arbitrary
 * https://<user-domain> fetch, so no SSRF there. SRV/MX are DNS lookups of the owner's
 * own domain. The verify opens SMTP to the discovered host: it comes from the owner's own
 * published DNS or Mozilla's DB, and 127.0.0.1 is a LEGITIMATE target (Proton Bridge), so
 * there is deliberately no private-IP block.
 */
import dns from 'dns/promises'
import nodemailer from 'nodemailer'
import { detectProvider, emailDomain, type SmtpProvider } from './email-providers'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean // true = implicit TLS (465); false = STARTTLS (587/25)
  /** 'local' = authenticate with the address's local-part only (some EU providers); else 'full'. */
  usernameFormat: 'full' | 'local'
}

export type DetectSource = 'table' | 'ispdb' | 'srv' | 'mx' | 'guess'

export interface DetectedSmtp extends SmtpConfig {
  source: DetectSource
  label: string
  known: boolean
  appPasswordUrl?: string
  note?: string
}

/**
 * Parse a Thunderbird autoconfig XML for the SMTP submission server. Exported (pure) so
 * the regex — the exact thing the internet snippet got wrong — is unit-tested offline.
 * The real schema is `<outgoingServer type="smtp">` (NOT `<outgoing type="smtp">`), with
 * `<socketType>SSL|STARTTLS|plain</socketType>` (SSL = implicit TLS) and a `<username>`
 * template that reveals whether the local-part or the full address is the login name.
 */
export function parseIspdbSmtp(xml: string): SmtpConfig | null {
  const block = xml.match(/<outgoingServer[^>]*type="smtp"[^>]*>([\s\S]*?)<\/outgoingServer>/i)?.[1]
  if (!block) return null
  const host = block.match(/<hostname>([^<]+)<\/hostname>/i)?.[1]?.trim()
  const portRaw = block.match(/<port>([^<]+)<\/port>/i)?.[1]?.trim()
  const socket = block.match(/<socketType>([^<]+)<\/socketType>/i)?.[1]?.trim()
  const rawUser = block.match(/<username>([^<]+)<\/username>/i)?.[1] ?? ''
  if (!host || !portRaw) return null
  const port = parseInt(portRaw, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  const usernameFormat: 'full' | 'local' =
    rawUser.includes('%EMAILLOCALPART%') && !rawUser.includes('%EMAILADDRESS%') ? 'local' : 'full'
  return { host, port, secure: socket === 'SSL', usernameFormat }
}

/**
 * Map the primary MX host to a known SMTP submission endpoint, else guess smtp.<domain>.
 * Exported (pure) so the fingerprint host strings — corrupted to `'://gmail.com'` in the
 * snippet — are unit-tested. Always returns a config (the smtp.<domain> guess is the floor).
 * All external infrastructures authenticate with the full address ('full').
 */
export function mapMxToSmtp(primaryMx: string, domain: string): SmtpConfig {
  const mx = primaryMx.toLowerCase()
  const full = 'full' as const
  if (mx.includes('google.com') || mx.includes('googlemail.com')) return { host: 'smtp.gmail.com', port: 465, secure: true, usernameFormat: full }
  if (mx.includes('outlook.com') || mx.includes('office365') || mx.includes('protection.outlook.com')) return { host: 'smtp.office365.com', port: 587, secure: false, usernameFormat: full }
  if (mx.includes('icloud.com') || mx.includes('mail.me.com') || mx.includes('apple.com')) return { host: 'smtp.mail.me.com', port: 587, secure: false, usernameFormat: full }
  if (mx.includes('secureserver.net')) return { host: 'smtpout.secureserver.net', port: 465, secure: true, usernameFormat: full }
  if (mx.includes('zoho.eu')) return { host: 'smtp.zoho.eu', port: 465, secure: true, usernameFormat: full } // EU datacenter
  if (mx.includes('zoho')) return { host: 'smtp.zoho.com', port: 465, secure: true, usernameFormat: full }
  if (mx.includes('yahoodns.net')) return { host: 'smtp.mail.yahoo.com', port: 465, secure: true, usernameFormat: full }
  return { host: `smtp.${domain}`, port: 587, secure: false, usernameFormat: full }
}

async function checkThunderbirdDB(domain: string): Promise<SmtpConfig | null> {
  try {
    const url = `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return parseIspdbSmtp(await res.text())
  } catch {
    return null // network/timeout/parse — fall through to the next step
  }
}

async function checkDNSSRV(domain: string): Promise<SmtpConfig | null> {
  try {
    const records = await dns.resolveSrv(`_submission._tcp.${domain}`)
    const usable = records.filter((r) => r.name && r.name !== '.') // RFC 2782: "." = not offered
    if (!usable.length) return null
    const best = usable.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
    return { host: best.name, port: best.port, secure: best.port === 465, usernameFormat: 'full' }
  } catch {
    return null
  }
}

async function checkMXFallback(domain: string): Promise<SmtpConfig | null> {
  try {
    const mx = await dns.resolveMx(domain)
    if (!mx.length) return null
    const primary = mx.sort((a, b) => a.priority - b.priority)[0].exchange
    return mapMxToSmtp(primary, domain)
  } catch {
    return null
  }
}

/**
 * Reachability check (NO auth): an EHLO handshake with short timeouts, plus the snippet's
 * clever 587→465 retry. Returns the working config (possibly port-switched) or null. Used
 * to DISAMBIGUATE discovered candidates; the real credential test is verifyCredentials.
 */
export async function verifyConnection(cfg: SmtpConfig): Promise<SmtpConfig | null> {
  const tryOne = async (c: SmtpConfig): Promise<boolean> => {
    const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, connectionTimeout: 2500, greetingTimeout: 2000 })
    try {
      await t.verify()
      return true
    } catch {
      return false
    } finally {
      t.close()
    }
  }
  if (await tryOne(cfg)) return cfg
  if (cfg.port === 587 && !cfg.secure) {
    const alt: SmtpConfig = { ...cfg, port: 465, secure: true }
    if (await tryOne(alt)) return alt
  }
  return null
}

export type SmtpAuthStatus = 'SUCCESS' | 'AUTH_REQUIRED' | 'FAILED'

/**
 * AUTHENTICATED verify — the real credential test the configure step runs before storing.
 * Distinguishes (per the EU-provider version): SUCCESS (host/port/creds all good),
 * AUTH_REQUIRED (host/port right but the password was rejected — SMTP 535 / "auth" — i.e.
 * an app-specific password is needed), and FAILED (host/port wrong or unreachable). Honors
 * usernameFormat when building auth.user, and keeps the 587→465 fallback. Returns the
 * (possibly port-switched) config so the caller stores exactly what worked.
 */
export async function verifyCredentials(config: SmtpConfig, email: string, password: string): Promise<{ status: SmtpAuthStatus; config: SmtpConfig }> {
  const localPart = email.slice(0, email.lastIndexOf('@'))
  const authUser = config.usernameFormat === 'local' ? localPart : email
  const t = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 3000,
    greetingTimeout: 2500,
    auth: { user: authUser, pass: password },
  })
  try {
    await t.verify()
    return { status: 'SUCCESS', config }
  } catch (e) {
    const err = e as { message?: string; responseCode?: number }
    const msg = err.message ?? ''
    const code = err.responseCode ?? 0
    // Host/port correct, password rejected → the owner likely needs an APP-specific
    // password (Gmail/iCloud/Yahoo with 2FA). This is the load-bearing UX distinction.
    if (code === 535 || /auth/i.test(msg)) return { status: 'AUTH_REQUIRED', config }
    // Port 587 blocked/timeout (some ISPs block submission) → immediate 465-SSL fallback.
    if (config.port === 587 && !config.secure) {
      return verifyCredentials({ ...config, port: 465, secure: true }, email, password)
    }
    return { status: 'FAILED', config }
  } finally {
    t.close()
  }
}

/**
 * Detect SMTP settings for an email. A curated KNOWN provider short-circuits instantly
 * (no network). Otherwise discovery runs ISPDB → SRV → MX and returns the first candidate
 * a reachability verify accepts; if none verify, the first discovered candidate is returned
 * (the configure step's authenticated verifyCredentials is the real gate), else the
 * smtp.<domain> guess. `opts.verify=false` skips the network EHLO (unit tests / previews).
 */
export async function autodetectSMTP(email: string, opts?: { verify?: boolean }): Promise<DetectedSmtp | null> {
  const domain = emailDomain(email)
  if (!domain) return null
  const doVerify = opts?.verify ?? true

  // Fast path: a curated known provider — trusted, offline, carries the app-password URL.
  // Consumer providers all authenticate with the full address.
  const table: SmtpProvider | null = detectProvider(email)
  if (table?.known) {
    return { host: table.host, port: table.port, secure: table.secure, usernameFormat: 'full', source: 'table', label: table.label, known: true, appPasswordUrl: table.appPasswordUrl, note: table.note }
  }

  const discovery: Array<{ fn: () => Promise<SmtpConfig | null>; source: DetectSource }> = [
    { fn: () => checkThunderbirdDB(domain), source: 'ispdb' },
    { fn: () => checkDNSSRV(domain), source: 'srv' },
    { fn: () => checkMXFallback(domain), source: 'mx' },
  ]
  let firstCandidate: DetectedSmtp | null = null
  for (const { fn, source } of discovery) {
    const cfg = await fn()
    if (!cfg) continue
    const cand: DetectedSmtp = { ...cfg, source, label: domain, known: false }
    firstCandidate ??= cand
    if (!doVerify) return cand
    const verified = await verifyConnection(cfg)
    if (verified) return { ...cand, ...verified }
  }

  if (firstCandidate) return firstCandidate
  // detectProvider always returns a guess for a valid domain, so this is the true floor.
  return table ? { host: table.host, port: table.port, secure: table.secure, usernameFormat: 'full', source: 'guess', label: table.label, known: false, note: table.note } : null
}
