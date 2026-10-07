/**
 * The public capability set (TRDD-TLSE2FEF, ai-maestro#88) — `lib/capabilities.ts`.
 *
 * Two things a hand-maintained map can silently get wrong, each pinned:
 *  1. a key that is not a real verb (typo, or a verb removed from the CLI) — checked against the
 *     CLI's OWN dispatch table via `aimaestro-agent.sh --capabilities`, the same source of truth
 *     the `--version` fingerprint reads; and
 *  2. a value that is not a positive integer revision (a semver string, 0, a float) — the shape
 *     #88 rejected in favour of per-verb integers.
 * Plus the route/whitelist wiring in both server modes: the headless mirror test drives the
 * router; `middleware.ts` is asserted by text because it runs only under Next.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CAPABILITIES, capabilitiesResponse } from '@/lib/capabilities'

const ROOT = process.cwd()

function cliVerbs(): string[] {
  const out = execFileSync('bash', [join(ROOT, 'scripts', 'aimaestro-agent.sh'), '--capabilities'], {
    stdio: 'pipe',
    timeout: 20_000,
    env: { ...process.env, AID_AUTH: '', AIMAESTRO_SESSION: '', AIMAESTRO_SUDO_TOKEN: '' },
  })
  return out.toString().trim().split('\n')
}

describe('lib/capabilities — the {verb: revision} map (TRDD-TLSE2FEF)', () => {
  it('every key is a verb the CLI actually dispatches, and every CLI verb is listed', () => {
    const verbs = cliVerbs()
    expect(verbs.length).toBeGreaterThanOrEqual(20) // positive control: the CLI answered
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...verbs].sort())
  })

  it('every revision is a positive integer — never a version string, 0, or a float', () => {
    for (const [verb, rev] of Object.entries(CAPABILITIES)) {
      expect(Number.isInteger(rev) && rev >= 1, `${verb}: ${String(rev)}`).toBe(true)
    }
  })

  it('the response body is the map and nothing else', () => {
    expect(Object.keys(capabilitiesResponse())).toEqual(['capabilities'])
    expect(capabilitiesResponse().capabilities).toBe(CAPABILITIES)
  })

  // Next mode half of "identical JSON in both modes": the route handler is called directly with no
  // credential; the headless half (same capabilitiesResponse()) is in headless-router-auth-mirror.test.ts.
  it('the Next route answers 200 with exactly {capabilities: {verb: integer}} and no credential', async () => {
    const { GET } = await import('@/app/api/capabilities/route')
    const res = await GET(new Request('http://localhost:23000/api/capabilities'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(JSON.parse(JSON.stringify(capabilitiesResponse())))
    expect(Object.keys(body)).toEqual(['capabilities'])
    for (const rev of Object.values(body.capabilities)) expect(Number.isInteger(rev)).toBe(true)
  })

  it('middleware.ts whitelists /api/capabilities (the Next-mode half of the public contract)', () => {
    const src = readFileSync(join(ROOT, 'middleware.ts'), 'utf8')
    expect(src).toMatch(/\/\^\\\/api\\\/capabilities\(\\\/\|\$\)\//)
  })
})
