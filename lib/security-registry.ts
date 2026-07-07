/**
 * Security registry loader.
 *
 * Reads /security-registry.json (project root) at module load time and
 * exposes a typed lookup API used by the middleware and per-route wrappers
 * to decide whether a given API call requires sudo-mode (password re-entry
 * within the last 60 seconds) or plain cookie/Bearer auth.
 *
 * The JSON file is the SINGLE source of truth. To change the classification
 * of an endpoint, edit the JSON — no code change is required. The loader
 * caches the parsed map at module scope; restart the server to re-read.
 *
 * USAGE:
 *   import { getSecurityLevel, requiresSudo, SecurityLevel } from '@/lib/security-registry'
 *
 *   const level = getSecurityLevel('DELETE', '/api/agents/abc123')
 *   if (requiresSudo('DELETE', '/api/agents/abc123')) { ... }
 */

import { readFileSync, existsSync } from 'fs'
import path from 'path'

export type SecurityLevel = 'normal' | 'strict'

/** Entry format stored in security-registry.json `entries` map */
interface SecurityRegistryFile {
  entries: Record<string, SecurityLevel>
}

// Resolve the JSON next to the project root. process.cwd() is reliable
// because the server is always launched from the project directory.
const REGISTRY_PATH = path.join(process.cwd(), 'security-registry.json')

interface ParsedEntry {
  method: string
  /** Pattern with [param] placeholders replaced by a regex */
  pattern: RegExp
  /** Verbatim pathTemplate for diagnostics */
  raw: string
  level: SecurityLevel
  /**
   * Number of `[param]` wildcard segments in the raw path template
   * (TRDD-XTIOLWJH). Used to prefer the MORE SPECIFIC (fewer wildcards)
   * entry when a request matches more than one template — e.g. a wildcard
   * entry like `/api/agents/[id]` (`^/api/agents/[^/]+$`) also matches the
   * literal sibling routes `/api/agents/role-plugins` and
   * `/api/agents/cemetery`. Relying on JSON insertion order for this
   * disambiguation is fragile (a routine registry edit can silently
   * reorder the false match to win) and was caught live: a sudo token
   * minted for `DELETE /api/agents/role-plugins` normalized to the WRONG
   * template (`/api/agents/[id]`) and then 403'd with
   * `sudo_operation_mismatch` against the route's own
   * `/api/agents/role-plugins` guard template — the exact SCEN-016
   * BUG-001 mechanism, on different routes.
   */
  wildcardCount: number
}

let entries: ParsedEntry[] = []
let loaded = false

function compilePattern(rawPath: string): RegExp {
  // Replace [anyname] with [^/]+ (non-slash greedy segment)
  const escaped = rawPath
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // \\[ [param] \\] — undo escaping around [ ] and replace with segment matcher
    .replace(/\\\[[^\\\]]+\\\]/g, '[^/]+')
  return new RegExp(`^${escaped}$`)
}

function countWildcards(rawPath: string): number {
  const matches = rawPath.match(/\[[^\]]+\]/g)
  return matches ? matches.length : 0
}

/**
 * Among every entry whose method + pattern matches this request, return the
 * MOST SPECIFIC one — fewest wildcard segments first, then longest raw
 * template (more literal characters = more specific) as a tie-break.
 * Deterministic regardless of JSON declaration order (TRDD-XTIOLWJH).
 */
function findBestMatch(method: string, pathname: string): ParsedEntry | null {
  const m = method.toUpperCase()
  let best: ParsedEntry | null = null
  for (const entry of entries) {
    if (entry.method !== m || !entry.pattern.test(pathname)) continue
    if (
      !best ||
      entry.wildcardCount < best.wildcardCount ||
      (entry.wildcardCount === best.wildcardCount && entry.raw.length > best.raw.length)
    ) {
      best = entry
    }
  }
  return best
}

function parseKey(key: string): { method: string; rawPath: string } | null {
  // Expected format: METHOD_/api/path  (e.g. DELETE_/api/agents/[id])
  const match = key.match(/^([A-Z]+)_(.+)$/)
  if (!match) return null
  return { method: match[1], rawPath: match[2] }
}

function loadRegistry(): void {
  if (loaded) return
  loaded = true
  if (!existsSync(REGISTRY_PATH)) {
    console.warn('[security-registry] File not found:', REGISTRY_PATH, '— no routes will be marked strict.')
    return
  }
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as SecurityRegistryFile
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
      console.error('[security-registry] Invalid schema: missing `entries` object')
      return
    }
    for (const [key, level] of Object.entries(parsed.entries)) {
      if (level !== 'normal' && level !== 'strict') {
        console.warn('[security-registry] Invalid level', level, 'for', key, '— skipping')
        continue
      }
      const p = parseKey(key)
      if (!p) {
        console.warn('[security-registry] Invalid entry key', key, '— expected METHOD_/api/path')
        continue
      }
      entries.push({
        method: p.method,
        pattern: compilePattern(p.rawPath),
        raw: key,
        level,
        wildcardCount: countWildcards(p.rawPath),
      })
    }
    const strict = entries.filter(e => e.level === 'strict').length
    console.log('[security-registry] Loaded', entries.length, 'entries (', strict, 'strict )')
  } catch (err) {
    console.error('[security-registry] Parse error:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Look up the security level for a request. Matching is done by exact
 * METHOD + path (with `[param]` placeholders expanded to regex), preferring
 * the MOST SPECIFIC matching entry when more than one template matches
 * (TRDD-XTIOLWJH — see findBestMatch). Returns "normal" if no explicit
 * entry matches.
 */
export function getSecurityLevel(method: string, pathname: string): SecurityLevel {
  loadRegistry()
  return findBestMatch(method, pathname)?.level ?? 'normal'
}

/** Convenience predicate — returns true only if this route needs sudo-mode. */
export function requiresSudo(method: string, pathname: string): boolean {
  return getSecurityLevel(method, pathname) === 'strict'
}

/**
 * For diagnostics: return the matched registry entry key (or null). Used by
 * the sudo-mode failure response to tell the caller which rule rejected them,
 * AND by the sudo-password mint route to normalize a literal request URL to
 * its strict-route template before binding a sudo token (SUDO-01). MUST stay
 * consistent with getSecurityLevel's specificity preference (TRDD-XTIOLWJH)
 * — both resolve through the same findBestMatch, so mint-time normalization
 * and verify-time classification can never disagree on which entry "wins".
 */
export function matchedEntryKey(method: string, pathname: string): string | null {
  loadRegistry()
  return findBestMatch(method, pathname)?.raw ?? null
}

/** Test-only: reset the loader state so entries are re-parsed on next call. */
export function __resetForTest(): void {
  entries = []
  loaded = false
}
