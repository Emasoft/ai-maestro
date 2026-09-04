import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW — `POST /api/agents/creation-helper/clear-banner` is system-owner only.
 *
 * Split out of `tests/unit/creation-helper-wizard-system-owner.test.ts` on 2026-09-04, and the
 * reason is the whole point of this file.
 *
 * This route reaches NO service — it shells out to tmux via `promisify(execFile)`. So in a unit
 * environment its owner path 500s ("Failed to clear banner"), and the only way to give it a
 * POSITIVE CONTROL is to stub the executor. In the six-route file that stub had to sit at module
 * scope, where it applied to every route in the loop.
 *
 * MEASURED, not assumed: that blast radius is TWO routes, not one —
 * `app/api/agents/creation-helper/cleanup/route.ts:49` also calls
 * `execFileAsync('tmux', ['kill-session', …])`. So a module-scope `child_process` mock silenced
 * the most common failure mode of another route in the same loop, sitting directly underneath the
 * assertion that had just been strengthened (`not.toBe(403)` → `< 400`) to catch exactly that kind
 * of blindness. Tightening one bound while removing a failure source behind it is not a net gain,
 * and it is indistinguishable from a fix at the point where the suite reports green.
 *
 * Removing the mock and re-running settled it: **only `clear-banner` 500s.** `cleanup` passes
 * unmocked — because `cleanup/route.ts:48-53` swallows its own tmux failure in a bare `catch`
 * ("Session didn't exist — that's fine") and returns `{cleaned:true}` regardless. So `cleanup`'s
 * positive control is INSENSITIVE to the executor either way, and an earlier version of this
 * comment claiming the mock "cost it a failure mode" was contradicted by the very run cited for
 * it. The mock was still wrong to have — an unaudited blast radius is a hazard whether or not it
 * fires — but that is the weaker, true claim. Hence this file: one route, one scoped stub, and
 * the other five keep their real executor.
 *
 * WHAT THIS FILE'S POSITIVE CONTROL IS AND IS NOT. It asserts the owner reaches the route body and
 * the body does not throw when its ONLY side effect is stubbed to succeed. That is the thinnest
 * control in this family, and it is the reason the file exists — worth knowing before treating it
 * as strong evidence about anything but the gate.
 *
 * LANDMINE FOR THE NEXT ROUTE ADDED HERE: the stub returns `undefined` where real `execFile`
 * returns a `ChildProcess`, so any caller doing `const cp = execFile(…); cp.on(…)` throws.
 * Nothing in `clear-banner` does. Anything else added to this file must be checked.
 *
 * THE 500 WAS ALSO INFERRED BEFORE IT WAS SEEN. The first diagnosis read the route source, saw
 * `execFile`, and reasoned that tmux fails under vitest — then changed the fixture until it went
 * green. That is the same evidence a genuinely-broken route body would have produced. The
 * distinguishing step, skipped then and run now, is one line: print `res.text()` on the failing
 * owner case BEFORE touching the fixture. It says `{"ok":false,"error":"Failed to clear banner"}`
 * — the route's own catch around the tmux call, which is the environment limit, not the gate.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

/**
 * Scoped to THIS file, which drives one route. The callback is taken as the LAST argument rather
 * than positionally: real `execFile` accepts `(file, cb)`, `(file, args, cb)` and
 * `(file, args, options, cb)`, so a hard-destructured position-3 callback throws
 * `cb is not a function` on the other two forms — a new failure wearing the old one's clothes.
 */
vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>()
  const execFile = (...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') (cb as (e: unknown, o: unknown) => void)(null, { stdout: '', stderr: '' })
    return undefined as never
  }
  // `promisify` reads the `util.promisify.custom` SYMBOL off the function it is given. The real
  // execFile carries one; this stub does not, so promisify falls back to the standard
  // error-first-callback wrapping — which is what the callback above satisfies.
  return { ...actual, execFile }
})

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

function req() {
  return new Request('http://localhost/api/agents/creation-helper/clear-banner', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: '{}',
  }) as never
}

describe('TRDD-DQVPODKW — clear-banner is owner-only', () => {
  beforeEach(() => mockAuthenticate.mockReset())

  it('refuses a MEMBER — an agent may not drive the owner\'s creation wizard', async () => {
    /** Validates that authentication no longer stands in for owner authority on this wizard route */
    mockAuthenticate.mockReturnValue(MEMBER)
    const { POST } = await import('@/app/api/agents/creation-helper/clear-banner/route')
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/system owner only/i)
  })

  it('refuses even a MANAGER — this is owner authority, not a governance title', async () => {
    /** Validates the guard is enforceSystemOwner and not a title check, which would still admit agents */
    mockAuthenticate.mockReturnValue(MANAGER)
    const { POST } = await import('@/app/api/agents/creation-helper/clear-banner/route')
    expect((await POST(req())).status).toBe(403)
  })

  it('POSITIVE CONTROL — the system owner reaches the route body and succeeds', async () => {
    /** Validates the gate can say yes, so the refusals above are a decision and not a blanket 403 */
    mockAuthenticate.mockReturnValue(OWNER)
    const { POST } = await import('@/app/api/agents/creation-helper/clear-banner/route')
    const res = await POST(req())
    // Bounded below 400, not merely `not.toBe(403)`: the weak form was satisfied by this route
    // returning 500 for a whole verification cycle.
    expect(res.status).toBeLessThan(400)
  })
})

/**
 * NEUTER (2026-09-04 — OBSERVED): replacing `const authErr = enforceSystemOwner(request)` with
 * `const authErr = null as never` in clear-banner/route.ts reds the two denials and leaves the
 * positive control green. Recorded at the bottom of the run below.
 */
