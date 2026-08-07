/**
 * USER RULING 2026-08-07 — "deduplicate but never deduplicate the signed ledger."
 *
 * Dedupe the VIEW, never the RECORD. A signed ledger records EVERY change; deduplication is a
 * READ-TIME function computed OVER the ledger and must never be a write-time gate.
 *
 * WHY A CHAIN CANNOT POLICE THIS ITSELF, which is the whole reason this test exists: a ledger
 * whose CONTENTS depend on a predicate still verifies PERFECTLY. Hash and signature are intact
 * over whatever was written, so an omission is undetectable by the very mechanism meant to detect
 * tampering — a verified chain that proves nothing. `verify()` can only ever answer "was what I
 * was given tampered with", never "was I given everything". So the only place to enforce
 * completeness is at the CALL SITES, statically, here.
 *
 * THE RULE IS AN ALLOWLIST OF ONE, not "never conditional". Measured 2026-08-07: 7 of 9 append
 * sites are guarded by `if (diff.length > 0)`. That is NOT deduplication — dedupe suppresses a
 * SECOND entry duplicating a real first one, while this suppresses an EMPTY diff, i.e. a
 * non-event. Appending "nothing changed" on every save would flood the chain until the real
 * entries were unfindable. So:
 *
 *   The ONLY predicate that may guard a signed-ledger `append` is an empty-change check.
 *   Any other — content-hash comparison, actor check, "we just wrote this", rate limit,
 *   sampling — is FORBIDDEN.
 *
 * RESIDUAL RISK, stated because this test makes it load-bearing: audit completeness now depends
 * on DIFF-COMPUTATION correctness. A real change whose diff computes empty is silently
 * unrecorded, and the chain still verifies. That argues for testing the diff computation, NOT for
 * removing the guard.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCAN_ROOTS = ['lib', 'services', 'app'] as const

/**
 * The one permitted guard. Deliberately keyed on `diff` BY NAME rather than on a generic
 * `.length > 0`: an empty-CHANGE check is the exemption, and `if (candidates.length > 0)` is a
 * different predicate that happens to share the shape. Narrow beats clever here — a guard whose
 * allowlist is loose stops being an allowlist.
 */
const EMPTY_CHANGE_GUARD = /^\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*diff\.length\s*>\s*0\s*\)/

/** A `.append(` whose RECEIVER names a ledger. Excludes archive.append / formData.append, which
 *  are zip and multipart writers and have nothing to do with the audit chain. */
const LEDGER_RECEIVER = /edger/i

export interface AppendSite {
  file: string
  line: number
  /** The enclosing guard's source text, or a sentinel describing why there is none. */
  guard: string
  allowed: boolean
}

/**
 * Classify every signed-ledger append in one source file.
 *
 * Walks BACK from each append to the nearest enclosing statement at a LOWER indent. Indentation
 * rather than a parser because this repo's ledger call sites are uniformly formatted and a
 * governance test that needs a TS parser is a governance test nobody runs. The positive control
 * below is what keeps that choice honest: the classifier is a pure function over source text, so
 * a synthetic violation can be fed to it directly.
 */
export function classifyAppendSites(source: string, file: string): AppendSite[] {
  const lines = source.split('\n')
  const out: AppendSite[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const at = line.indexOf('.append(')
    if (at < 0) continue

    // The receiver is whatever precedes `.append(` on this line; when that is empty the call is a
    // continuation (`registryLedger\n  .append(...)`), so the receiver is the previous non-blank
    // line. Missing this case would silently drop ledger-emit.ts, one of only two unguarded sites.
    let receiver = line.slice(0, at).trim()
    if (receiver === '') {
      for (let j = i - 1; j >= 0 && j > i - 4; j--) {
        if (lines[j].trim() !== '') { receiver = lines[j].trim(); break }
      }
    }
    if (!LEDGER_RECEIVER.test(receiver)) continue

    const indent = line.length - line.trimStart().length
    let guard = '(unconditional)'
    let allowed = true

    for (let j = i - 1; j >= 0 && j > i - 20; j--) {
      const prev = lines[j]
      if (prev.trim() === '') continue
      const prevIndent = prev.length - prev.trimStart().length
      if (prevIndent >= indent) continue

      if (/^\s*(?:\}\s*)?(?:else\s+)?if\s*\(/.test(prev)) {
        guard = prev.trim()
        allowed = EMPTY_CHANGE_GUARD.test(prev)
      } else if (/^\s*try\s*\{/.test(prev)) {
        // A try is error handling, not a skip — it cannot prevent the append from being attempted.
        guard = '(try — not a skip)'
      }
      break
    }

    out.push({ file, line: i + 1, guard, allowed })
  }
  return out
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkTsFiles(full, acc)
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

function scanRepo(): AppendSite[] {
  const sites: AppendSite[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(path.join(REPO_ROOT, root))) {
      const rel = path.relative(REPO_ROOT, file)
      sites.push(...classifyAppendSites(fs.readFileSync(file, 'utf-8'), rel))
    }
  }
  return sites
}

/**
 * Measured floor, 2026-08-07: 9 signed-ledger append sites. A ratchet, like AIO-TXN-10's — if a
 * site is legitimately removed, LOWER this. It exists because "0 violations" is the answer a
 * BROKEN scanner gives too, and a scanner that silently stops matching reports a clean repo.
 */
const MIN_KNOWN_SITES = 9

describe('signed-ledger appends — the USER ruling, enforced at the call sites', () => {
  it('finds the known ledger append sites (guards against a silently empty scan)', () => {
    const sites = scanRepo()
    expect(
      sites.length,
      `Found only ${sites.length} signed-ledger append site(s); at least ${MIN_KNOWN_SITES} were ` +
        `measured on 2026-08-07. Either a site was legitimately removed (LOWER MIN_KNOWN_SITES), ` +
        `or the detector stopped matching — which reports a CLEAN repo and is the failure this ` +
        `assertion exists to catch.`,
    ).toBeGreaterThanOrEqual(MIN_KNOWN_SITES)
  })

  it('no append is guarded by anything but an empty-change check', () => {
    const violations = scanRepo().filter(s => !s.allowed)
    expect(
      violations.map(v => `${v.file}:${v.line} guarded by \`${v.guard}\``),
      'USER RULING: never deduplicate the signed ledger. The ONLY predicate that may guard an ' +
        'append is an empty-change check (`if (diff.length > 0)`) — a non-event has nothing to ' +
        'record. Any other condition (content-hash, actor, "we just wrote this", rate limit, ' +
        'sampling) suppresses a REAL entry, and the chain would still verify perfectly over the ' +
        'filtered set: a verified chain that proves nothing. Dedupe at READ time instead.',
    ).toEqual([])
  })

  // POSITIVE CONTROL. Without this, both assertions above pass whenever the classifier returns
  // nothing for ANY reason, and "no violations" is exactly what a dead detector reports. Each
  // synthetic case is fed to the same pure function the repo scan uses.
  it('the detector actually FIRES on each forbidden guard shape', () => {
    const forbidden = [
      "  if (hash === lastWrittenHash) {\n    registryLedger.append(op, 'f', diff)\n  }",
      "  if (actor === 'system') {\n    teamsLedger.append(op, 'f', diff)\n  }",
      "  if (!seen.has(key)) {\n    usersLedger.append(op, 'f', diff)\n  }",
      "  if (Date.now() - last > 1000) {\n    groupsLedger.append(op, 'f', diff)\n  }",
    ]
    for (const src of forbidden) {
      const sites = classifyAppendSites(src, 'synthetic.ts')
      expect(sites, `detector missed the append entirely in:\n${src}`).toHaveLength(1)
      expect(sites[0].allowed, `detector ALLOWED a forbidden guard:\n${src}`).toBe(false)
    }
  })

  it('the detector allows the one permitted guard, and the unguarded forms', () => {
    const permitted = [
      "  if (diff.length > 0) {\n    registryLedger.append(op, 'f', diff)\n  }",
      "  registryLedger.append(op, 'f', diff)",
      "  registryLedger\n    .append(op, 'f', diff)", // continuation form — ledger-emit.ts's shape
      "  try {\n    const e = await portfolioLedger().append(op, 'f', diff)\n  } catch {}",
    ]
    for (const src of permitted) {
      const sites = classifyAppendSites(src, 'synthetic.ts')
      expect(sites, `detector missed the append entirely in:\n${src}`).toHaveLength(1)
      expect(sites[0].allowed, `detector REJECTED a permitted form:\n${src}`).toBe(true)
    }
  })

  // A detector that matches every `.append(` would flag zip and multipart writers as audit sites,
  // and the resulting noise is how a governance test gets deleted rather than fixed.
  it('ignores non-ledger appends (archive / formData)', () => {
    const src =
      "  archive.append(JSON.stringify(x), { name: 'a.json' })\n" +
      "  formData.append('file', blob, 'a.zip')"
    expect(classifyAppendSites(src, 'synthetic.ts')).toEqual([])
  })
})
