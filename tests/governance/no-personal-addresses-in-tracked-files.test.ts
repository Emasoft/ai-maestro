/**
 * THIS REPO IS PUBLIC. `Emasoft/ai-maestro` and upstream `23blocks-OS/ai-maestro` are both
 * `visibility: PUBLIC` — so every tracked file is world-readable, and a real mailbox written into
 * one is published, permanently, to anyone who clones or browses it.
 *
 * WHAT HAPPENED (2026-08-07, the incident this guard exists for). The OAuth-rotator work is
 * inherently per-account: the rotator holds N credential slots, each belonging to a mail account,
 * and debugging it means writing down WHICH account was dead, WHICH held a live cookie, WHICH
 * Chrome profile was logged in. Every agent that touched it wrote those addresses down as ordinary
 * technical detail — correctly, in the sense that the note was accurate and useful. Over ~10 days
 * that produced **12 occurrences of 5 real addresses across 3 cards**, one of them belonging to a
 * THIRD PARTY (a different first name at the owner's surname), all pushed to a public repo.
 *
 * Nobody decided to publish them. There was no rule against it, no reviewer sees a diff line about
 * a credential slot and thinks "that is PII", and the repo's own owner uses a `users.noreply`
 * address for commits — i.e. the one place the convention WAS enforced, it was enforced by tooling,
 * not by intent. That is the whole shape of the failure: a hazard that looks like documentation.
 *
 * WHY A TEST AND NOT A RULE. A rule is read once and then competes with the work in front of you;
 * the addresses went in because writing them was the natural way to record a true fact. Only a gate
 * that runs on every suite can catch the next one, and it has to run against the TRACKED set —
 * `git ls-files` — because that, exactly, is the population that gets published.
 *
 * THE LINE THIS DRAWS. Not "no email addresses" — the repo legitimately needs fixtures for its
 * mailer, SMTP autodetect, and password-reset suites. The line is:
 *
 *     a mailbox at a REAL consumer provider, whose local-part is not an obvious placeholder,
 *     is presumed to be a real person's, and may not appear in a tracked file.
 *
 * `@example.com` is RFC-2606 reserved and always fine. `me@gmail.com` is a fixture. A surname at
 * gmail is a person. When a genuinely new fixture trips this, widen PLACEHOLDER_LOCALS — do NOT
 * add the real address to an ignore list, which would put it in a tracked file, which is the bug.
 *
 * NOTE ON THIS FILE: it necessarily contains `@gmail.com` strings (the fixtures it allows and the
 * synthetic violation it seeds), so it EXCLUDES ITSELF from the scan. A detector that reports
 * itself is a detector people delete.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Consumer mailbox providers — an address here is a REAL account someone can receive mail at. */
const REAL_PROVIDERS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.jp', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me', 'aol.com', 'gmx.com', 'gmx.de', 'web.de',
  'yandex.ru', 'mail.ru', 'zoho.com', 'zoho.eu', 'zoho.in', 'fastmail.com', 'tutanota.com',
] as const

/**
 * Local-parts that are self-evidently stand-ins. Deliberately a CLOSED list of generic words:
 * the test's whole value is that a *name* cannot pass, so anything resembling a real identity
 * (a surname, an initial+surname, a handle) must fall through to the failure.
 */
const PLACEHOLDER_LOCALS = new Set([
  'me', 'you', 'us', 'user', 'users', 'someone', 'somebody', 'nobody', 'anyone', 'person',
  'test', 'tester', 'testing', 'example', 'sample', 'demo', 'dummy', 'fake', 'placeholder',
  'admin', 'root', 'owner', 'boss', 'manager', 'sender', 'recipient', 'from', 'to',
  'foo', 'bar', 'baz', 'qux', 'a', 'b', 'c', 'x', 'y', 'z', 'u', 'n',
  'alice', 'bob', 'carol', 'dave', 'eve', 'mallory', 'trent',
  'john.doe', 'jane.doe', 'first.last', 'firstname.lastname',
  'no-reply', 'noreply', 'donotreply', 'postmaster', 'webmaster', 'abuse', 'support', 'info',
  'peter-bot',
])

/** Extensions worth scanning — text a human authored. Binaries and lockfiles are noise. */
const TEXT_EXT = new Set([
  '.md', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sh',
  '.py', '.txt', '.html', '.css', '.toml', '.env', '.example',
])

/** This file necessarily contains the very strings it hunts. */
const SELF = 'tests/governance/no-personal-addresses-in-tracked-files.test.ts'

const ADDRESS = new RegExp(
  `[A-Za-z0-9._%+-]+@(?:${REAL_PROVIDERS.map(d => d.replace(/\./g, '\\.')).join('|')})\\b`,
  'gi',
)

export interface AddressHit {
  file: string
  line: number
  /** The local-part only. The full address is NEVER carried into a failure message — a test that
   *  prints the leak into CI logs has moved it, not caught it. */
  local: string
}

/** Pure over source text, so the positive control can drive it with synthetic input. */
export function findPersonalAddresses(source: string, file: string): AddressHit[] {
  const out: AddressHit[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(ADDRESS)) {
      const local = m[0].slice(0, m[0].lastIndexOf('@')).toLowerCase()
      if (PLACEHOLDER_LOCALS.has(local)) continue
      out.push({ file, line: i + 1, local })
    }
  }
  return out
}

/** The tracked set — precisely what a clone or the GitHub file-view exposes. */
function trackedTextFiles(): string[] {
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
  return raw.toString('utf-8').split('\0')
    .filter(Boolean)
    .filter(f => f !== SELF)
    .filter(f => TEXT_EXT.has(path.extname(f).toLowerCase()))
}

function scanRepo(): { hits: AddressHit[]; scanned: number } {
  const hits: AddressHit[] = []
  let scanned = 0
  for (const rel of trackedTextFiles()) {
    let src: string
    try { src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8') } catch { continue }
    scanned++
    hits.push(...findPersonalAddresses(src, rel))
  }
  return { hits, scanned }
}

/** Measured 2026-08-07: 1 400+ tracked text files. A ratchet, because "0 violations" is also what
 *  a scanner that read NOTHING reports — and that failure is invisible without a floor. */
const MIN_SCANNED = 800

describe('no personal mail addresses in tracked files — this repo is PUBLIC', () => {
  it('actually scans the tracked corpus (guards against a silently empty scan)', () => {
    const { scanned } = scanRepo()
    expect(
      scanned,
      `Scanned only ${scanned} tracked text file(s); at least ${MIN_SCANNED} were expected. ` +
        `Either the repo shrank a lot (LOWER MIN_SCANNED), or git ls-files / the extension ` +
        `filter stopped matching — which reports a CLEAN repo and is the failure this exists to catch.`,
    ).toBeGreaterThanOrEqual(MIN_SCANNED)
  })

  it('contains no address that looks like a real person', () => {
    const { hits } = scanRepo()
    // Report file:line and the LOCAL-PART ONLY — never the full address. Printing it into CI logs
    // would republish the thing the test caught.
    expect(
      hits.map(h => `${h.file}:${h.line} — local-part "${h.local}" at a real provider`),
      'A tracked file carries what looks like a real personal mailbox, and THIS REPO IS PUBLIC.\n' +
        'Replace it with a stable role label (ACCOUNT-A, the live account, slot B) — the identity ' +
        'has never once been load-bearing in this corpus, and the mapping stays recoverable at the ' +
        'host. If this is a genuinely new TEST FIXTURE, add its local-part to PLACEHOLDER_LOCALS ' +
        'or move it to @example.com (RFC 2606). NEVER add a real address to an ignore list — that ' +
        'writes it into a tracked file, which is the bug itself.',
    ).toEqual([])
  })

  // POSITIVE CONTROL. Without it both assertions above pass whenever the detector returns nothing
  // for ANY reason, and "no violations" is exactly what a dead detector reports.
  it('DETECTS a name-shaped address at every real provider', () => {
    for (const provider of ['gmail.com', 'icloud.com', 'proton.me', 'yandex.ru']) {
      const seeded = `contact: j.smith1987@${provider} for details`
      const hits = findPersonalAddresses(seeded, 'synthetic.ts')
      expect(hits, `detector MISSED a personal address at ${provider}`).toHaveLength(1)
      expect(hits[0].local).toBe('j.smith1987')
    }
  })

  it('ALLOWS the fixture forms the mailer suites legitimately need', () => {
    const permitted = [
      'const to = "me@gmail.com"',           // the repo's most common fixture (38 uses)
      'expect(addr).toBe("boss@gmail.com")', // ditto (6 uses)
      'from: "nobody@gmail.com"',
      'reply: "alice@gmail.com"',
      'user@gmail.com',
      'u@zoho.in',
      'peter-bot@mac.lan',                   // not a real provider at all
      'noreply@example.com',                 // RFC 2606 — never flagged
      '713559+Emasoft@users.noreply.github.com', // the owner's own commit identity: not a mailbox
    ]
    for (const src of permitted) {
      expect(findPersonalAddresses(src, 'synthetic.ts'), `false positive on: ${src}`).toEqual([])
    }
  })

  // The failure message must not become the leak. A test that prints the address it caught has
  // moved it from a tracked file into every CI log that ran the suite.
  it('never puts a full address in its own failure output', () => {
    const hits = findPersonalAddresses('x: j.smith1987@gmail.com', 'synthetic.ts')
    const rendered = hits.map(h => `${h.file}:${h.line} — local-part "${h.local}" at a real provider`)
    expect(rendered.join('\n')).not.toContain('@gmail.com')
    expect(rendered.join('\n')).toContain('j.smith1987') // still actionable: names the site
  })
})
