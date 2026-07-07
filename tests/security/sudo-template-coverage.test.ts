/**
 * TRDD-RF122HBJ — build-time guard that every `requireSudoToken` call site
 * is a REACHABLE strict-registry entry.
 *
 * SCEN-016 BUG-001 class: a route passed a path template to
 * requireSudoToken() that did NOT match the registry entry a mint-time
 * op-bound token normalizes to for that route's OWN literal request URL —
 * the entry existed (`PATCH_/api/agents/[id]/title`) but no request URL
 * could ever reach it (there was no such route file), so op-bound sudo
 * tokens permanently 403'd the real route (`PATCH /api/agents/[id]`).
 *
 * Two truths must hold for op-binding to work, and this file mechanically
 * enforces both, for every `requireSudoToken` call site under `app/api/`:
 *
 *   (a) FORWARD — the template a route passes to requireSudoToken() must be
 *       a `strict` entry in security-registry.json. If it isn't,
 *       `requiresSudo()` returns false and the guard silently no-ops — an
 *       auth hole, not just a UX bug.
 *   (b) DIRECTORY MATCH — that template must equal the route's OWN
 *       Next.js-file-routing-derived URL template (i.e. a real request to
 *       this handler can actually produce that path). Otherwise mint-time
 *       normalization (which binds against the LITERAL request URL) and
 *       verify-time comparison (against the STATIC template the route
 *       hard-codes) can never agree — the exact SCEN-016 BUG-001 mechanism.
 *
 *   (c) REVERSE (orphan detection) — every `strict` entry in
 *       security-registry.json must correspond to a route.ts file that
 *       actually exists at that template's path. A registered-but-
 *       unreachable entry (like the orphaned `/title` tag before this TRDD)
 *       is otherwise invisible — nothing else in the codebase would ever
 *       fail because of it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'

const PROJECT_ROOT = process.cwd()
const APP_API_DIR = path.join(PROJECT_ROOT, 'app', 'api')

interface RegistryFile {
  entries: Record<string, 'normal' | 'strict'>
}

function loadRegistryEntries(): Record<string, 'normal' | 'strict'> {
  const raw = readFileSync(path.join(PROJECT_ROOT, 'security-registry.json'), 'utf-8')
  const parsed = JSON.parse(raw) as RegistryFile
  return parsed.entries
}

/** Recursively find every `route.ts` file under app/api/. */
function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...findRouteFiles(full))
    } else if (entry === 'route.ts') {
      out.push(full)
    }
  }
  return out
}

/** Convert an absolute app/api/**\/route.ts path into its URL template,
 * e.g. .../app/api/agents/[id]/route.ts -> /api/agents/[id]. */
function deriveTemplateFromRouteFile(absPath: string): string {
  const rel = path.relative(path.join(PROJECT_ROOT, 'app'), absPath).replace(/\\/g, '/')
  return '/' + rel.replace(/\/route\.ts$/, '')
}

/** Convert a registry template (e.g. /api/agents/[id]/title) into the
 * app/api/**\/route.ts path it would have to live at for a real route to
 * ever produce that URL. */
function templateToRouteFilePath(template: string): string {
  // template starts with /api/... ; app/ + template + /route.ts
  return path.join(PROJECT_ROOT, 'app', template, 'route.ts')
}

interface CallSite {
  file: string
  methodExpr: string
  template: string
}

const HTTP_METHOD_RE = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g

function exportedMethodsIn(content: string): string[] {
  const methods: string[] = []
  let m: RegExpExecArray | null
  HTTP_METHOD_RE.lastIndex = 0
  while ((m = HTTP_METHOD_RE.exec(content)) !== null) {
    methods.push(m[1])
  }
  return methods
}

const CALL_SITE_RE = /requireSudoToken\(\s*[A-Za-z_$][\w$]*\s*,\s*([^,]+?)\s*,\s*'([^']+)'\s*\)/g

function findCallSites(file: string, content: string): CallSite[] {
  const sites: CallSite[] = []
  let m: RegExpExecArray | null
  CALL_SITE_RE.lastIndex = 0
  while ((m = CALL_SITE_RE.exec(content)) !== null) {
    sites.push({ file, methodExpr: m[1].trim(), template: m[2] })
  }
  return sites
}

const routeFiles = findRouteFiles(APP_API_DIR)
const registry = loadRegistryEntries()

/** Every (method, template) pair a live requireSudoToken() call actually
 * asks the registry about — resolving a dynamic method expression (e.g.
 * `method`, not a literal) to every HTTP verb the same route file exports. */
function resolveCallSitePairs(): { method: string; template: string; file: string }[] {
  const pairs: { method: string; template: string; file: string }[] = []
  for (const file of routeFiles) {
    const content = readFileSync(file, 'utf-8')
    const sites = findCallSites(file, content)
    if (sites.length === 0) continue
    const literalMethodRe = /^'([A-Z]+)'$/
    for (const site of sites) {
      const literal = site.methodExpr.match(literalMethodRe)
      if (literal) {
        pairs.push({ method: literal[1], template: site.template, file })
      } else {
        // Dynamic method expression (e.g. a `method` variable) — the call
        // site can resolve to ANY HTTP verb the same file exports; require
        // the registry to cover all of them at this template.
        for (const verb of exportedMethodsIn(content)) {
          pairs.push({ method: verb, template: site.template, file })
        }
      }
    }
  }
  return pairs
}

describe('TRDD-RF122HBJ — sudo template coverage', () => {
  it('found at least one requireSudoToken call site to check', () => {
    /** Sanity check that the scanner is actually walking app/api/ */
    const pairs = resolveCallSitePairs()
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('every requireSudoToken template is a strict registry entry (forward)', () => {
    /** (a) FORWARD — the call site's template must exist as a strict entry,
     * else requiresSudo() silently returns false and the guard no-ops. */
    const pairs = resolveCallSitePairs()
    const failures: string[] = []
    for (const { method, template, file } of pairs) {
      const key = `${method}_${template}`
      if (registry[key] !== 'strict') {
        failures.push(
          `${path.relative(PROJECT_ROOT, file)}: requireSudoToken('${method}', '${template}') ` +
          `has no strict entry "${key}" in security-registry.json (found: ${registry[key] ?? 'undefined'})`
        )
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('every requireSudoToken template equals its route\'s own directory-derived URL (directory match)', () => {
    /** (b) DIRECTORY MATCH — the template passed to requireSudoToken() must
     * be a URL this exact route file can actually be reached at — otherwise
     * mint-time normalization (against the real request URL) and
     * verify-time comparison (against the hard-coded template) can never
     * agree (the precise SCEN-016 BUG-001 mechanism). */
    const failures: string[] = []
    for (const file of routeFiles) {
      const content = readFileSync(file, 'utf-8')
      const sites = findCallSites(file, content)
      if (sites.length === 0) continue
      const dirTemplate = deriveTemplateFromRouteFile(file)
      for (const site of sites) {
        if (site.template !== dirTemplate) {
          failures.push(
            `${path.relative(PROJECT_ROOT, file)}: requireSudoToken(..., '${site.template}') ` +
            `does not match this route's own URL template "${dirTemplate}"`
          )
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('every strict registry entry corresponds to a route file that actually exists (reverse / orphan detection)', () => {
    /** (c) REVERSE — a strict entry with no matching route.ts file can never
     * be reached by any real request; it is a silent, invisible mismatch
     * exactly like the pre-fix `PATCH_/api/agents/[id]/title` orphan. */
    const failures: string[] = []
    for (const [key, level] of Object.entries(registry)) {
      if (level !== 'strict') continue
      const match = key.match(/^([A-Z]+)_(.+)$/)
      if (!match) {
        failures.push(`Malformed registry key "${key}" (expected METHOD_/api/path)`)
        continue
      }
      const [, , template] = match
      // Dynamic-segment templates ([id], [...]) map 1:1 onto Next.js's
      // literal bracket-folder convention — the same folder name is used
      // whether the actual runtime value is a UUID or a session name.
      const routeFile = templateToRouteFilePath(template)
      if (!existsSync(routeFile)) {
        failures.push(`"${key}" (strict) has no route file at ${path.relative(PROJECT_ROOT, routeFile)} — unreachable/orphaned entry`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
