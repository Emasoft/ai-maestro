/**
 * The HUMAN's auth path through the script layer (ai-maestro#55).
 *
 * THE BUG. `scripts/shell-helpers/common.sh` emitted only the AID bearer, so every
 * `aimaestro-*.sh` and `amp-*.sh` returned 401 to a human at a terminal. The script
 * layer — the ONE sanctioned boundary to the API, the thing every plugin and every
 * agent is required to go through — was unusable by the person who owns the machine.
 * It is why the MANAGER could not run the #46 identity test from a dev session.
 *
 * THE FIX is two-sided, and this file pins the SERVER side: a `Cookie: aim_session=…`
 * header (the format `get_auth_args` now emits for a human) must authenticate exactly
 * as the browser's does. The bash side — the resolution order agent-bearer → session-env
 * → session-file — is exercised directly against the helper.
 *
 * NO PASSWORD APPEARS HERE, and that is deliberate rather than incidental.
 * `createSession()` is the POST-authentication issuance step, so the whole cookie path
 * is testable without the credential ever becoming data in a file, an argv, or an env
 * var. A test that needed the real password would be a test that leaked it.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-cli-session-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, tmpdir: actual.tmpdir },
    homedir: () => TMP_HOME,
    tmpdir: actual.tmpdir,
  }
})

type SessionModule = typeof import('@/lib/session-auth')
type AuthModule = typeof import('@/lib/agent-auth')

let session: SessionModule
let agentAuth: AuthModule

beforeAll(async () => {
  session = await import('@/lib/session-auth')
  agentAuth = await import('@/lib/agent-auth')
})

afterEach(() => {
  session.invalidateAllSessions()
})

/** Exactly the header `get_auth_args` now builds for a human caller. */
function cookieHeaderFor(token: string): string {
  return `aim_session=${token}`
}

describe('the human authenticates by cookie, as the CLI now sends it', () => {
  it('ACCEPTS the Cookie header the script layer emits', async () => {
    const token = await session.createSession('127.0.0.1')

    const result = agentAuth.authenticateAgent(null, null, cookieHeaderFor(token))

    expect(result.error).toBeUndefined()
    // A human is the system owner, and carries no agent id — this is the whole
    // distinction the script layer could not previously express.
    expect(result.agentId).toBeUndefined()
    const ctx = agentAuth.buildAuthContext(result)
    expect(ctx.isSystemOwner).toBe(true)
  })

  it('parses the cookie out of a REAL browser-style header with other cookies present', async () => {
    const token = await session.createSession('127.0.0.1')
    const header = `theme=dark; ${cookieHeaderFor(token)}; other=x`

    const result = agentAuth.authenticateAgent(null, null, header)
    expect(result.error).toBeUndefined()
    expect(agentAuth.buildAuthContext(result).isSystemOwner).toBe(true)
  })

  it('REFUSES an invented session token (a cookie is not a password to guess)', () => {
    const result = agentAuth.authenticateAgent(null, null, cookieHeaderFor('not-a-real-session'))
    expect(result.error).toBeTruthy()
  })

  it('REFUSES a session that was logged out (logout must actually end it)', async () => {
    const token = await session.createSession('127.0.0.1')
    expect(agentAuth.authenticateAgent(null, null, cookieHeaderFor(token)).error).toBeUndefined()

    session.invalidateSession(token)

    expect(agentAuth.authenticateAgent(null, null, cookieHeaderFor(token)).error).toBeTruthy()
  })

  it('REFUSES a caller with no credential at all (SF-058 stays closed)', () => {
    // The pre-login state of a human terminal. It must 401 — not silently fall back
    // to system-owner, which is the hole SF-058 closed and #55 must not reopen.
    const result = agentAuth.authenticateAgent(null, null, null)
    expect(result.error).toBeTruthy()
  })
})
