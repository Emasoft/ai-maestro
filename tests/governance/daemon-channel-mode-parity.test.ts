/**
 * The daemon channel exists in BOTH server modes (TRDD-APN5WB2L; ai-maestro#60).
 *
 * WHY THIS FILE EXISTS AT ALL. This repo has a recurring, measured defect: a route added to one
 * mode and not the other. R10.6's parity suite exists because a restart gate was duplicated into a
 * Next route and two headless handlers and one drifted — full mode 403'd a restart headless
 * allowed, for weeks. And while designing THIS feature I measured a live instance of the same
 * thing: `POST /api/sessions/me/user-input` exists as a Next route and in NONE of the headless
 * router's entries.
 *
 * A daemon channel that silently vanished in headless mode would be worse than either, because the
 * janitor daemon's whole reason to call it is recovery — the failure would surface only during an
 * incident, on the host configured the way this test does not check.
 *
 * WHAT IT ASSERTS AND WHY IT IS A SOURCE SCAN. The routes cannot be DRIVEN here without standing
 * up both servers, so this pins the structural claim: each endpoint is declared in both surfaces,
 * and both delegate to the same service. The behavioural half is
 * `tests/services/daemon-inject-service.test.ts`, which drives that shared service directly — so
 * between the two files, "declared in both modes" and "behaves correctly" are both covered without
 * either file pretending to do the other's job.
 *
 * THE POSITIVE CONTROL IS MANDATORY, not decorative: a scan whose regex silently stops matching
 * reports a clean parity for a channel that no longer exists in either mode. `sendCommand`'s
 * long-standing pair is the control — if the scan cannot see IT, the scan is broken, not the code.
 *
 * NEUTER RUN (2026-08-06 — OBSERVED via scripts/dev/neuter, restore blob-verified):
 *   · rename the HEADLESS inject pattern (`/api/daemon/inject` → `/api/daemon/injectXX`), i.e.
 *     exactly the one-sided drift this file exists to catch → 1 red: 'POST /api/daemon/inject
 *     exists in Next AND in the headless router'. The Next route is untouched, so every other
 *     assertion stays green — which is the shape of the real bug, and the proof this file would
 *     have caught the `/api/sessions/me/user-input` asymmetry that motivated it.
 *
 * ITS OWN FIRST DRAFT WAS THE LESSON: the "verification lives in neither route" assertion failed
 * against a route whose DOC COMMENT explains that the verification lives in the service. A prose
 * explanation of a property read as a violation of it — see `codeOnly` below.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const HEADLESS = fs.readFileSync(path.join(REPO, 'services', 'headless-router.ts'), 'utf8')

function nextRouteExists(...segments: string[]): boolean {
  return fs.existsSync(path.join(REPO, 'app', 'api', ...segments, 'route.ts'))
}

/**
 * Strip comments before asking whether a file CALLS something.
 *
 * Not optional, and learned right here: the first version of the "no verification in the route"
 * assertion failed against a route whose DOC COMMENT explains that the verification lives
 * elsewhere. A module that documents its own design in prose matches every needle aimed at its
 * code — the "found in comments, not implementation" trap, in its purest form. The comment saying
 * "this happens in the service" is evidence FOR the property, and a raw text scan reads it as
 * evidence against.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the daemon channel is reachable in BOTH modes', () => {
  it('POSITIVE CONTROL — the scan can see a known-present pair (sendCommand)', () => {
    // If this fails, every "present in both" assertion below is meaningless.
    expect(nextRouteExists('sessions', '[id]', 'command')).toBe(true)
    expect(HEADLESS).toMatch(/\/api\\\/sessions\\\/\(\[\^\/\]\+\)\\\/command\$/)
  })

  it('POST /api/daemon/inject exists in Next AND in the headless router', () => {
    expect(nextRouteExists('daemon', 'inject')).toBe(true)
    expect(HEADLESS).toMatch(/\/\^\\\/api\\\/daemon\\\/inject\$\//)
  })

  it('POST /api/daemon/enroll exists in Next AND in the headless router', () => {
    expect(nextRouteExists('daemon', 'enroll')).toBe(true)
    expect(HEADLESS).toMatch(/\/\^\\\/api\\\/daemon\\\/enroll\$\//)
  })

  it('both surfaces delegate to the SAME service — no second implementation to drift', () => {
    // The parity that matters is not "two routes exist" but "two routes call one decision". A
    // second copy of the verification would pass this file's existence checks and still drift.
    const nextInject = fs.readFileSync(path.join(REPO, 'app', 'api', 'daemon', 'inject', 'route.ts'), 'utf8')
    const nextEnroll = fs.readFileSync(path.join(REPO, 'app', 'api', 'daemon', 'enroll', 'route.ts'), 'utf8')
    expect(nextInject).toContain("from '@/services/daemon-inject-service'")
    expect(nextEnroll).toContain("from '@/services/daemon-inject-service'")
    expect(HEADLESS).toContain("from '@/services/daemon-inject-service'")

    // And the verification itself is CALLED in neither surface: a signature check inside a route
    // handler is one the other mode cannot share. Compare code only — see codeOnly's docstring
    // for why the raw text is the wrong instrument here.
    expect(codeOnly(nextInject)).not.toContain('verifyDaemonRequest')
    expect(codeOnly(HEADLESS)).not.toContain('verifyDaemonRequest')
    // Positive control for codeOnly itself: it must not gut the file it is filtering, or the two
    // assertions above pass because they were handed an empty string.
    expect(codeOnly(nextInject)).toContain('daemonInject')
  })

  it('the enrollment route is classified STRICT — enrolling a key grants injection authority', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'security-registry.json'), 'utf8'))
    expect(registry.entries['POST_/api/daemon/enroll']).toBe('strict')
    // The inject route is deliberately NOT strict: its credential is the signature, and the
    // daemon holds no session cookie to earn a sudo token with. Pinned so a future "harden
    // everything" pass cannot lock the daemon out of its own channel without reading this.
    expect(registry.entries['POST_/api/daemon/inject']).toBeUndefined()
  })
})
