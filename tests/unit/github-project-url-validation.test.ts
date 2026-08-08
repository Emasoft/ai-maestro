/**
 * ai-maestro#139 — validateProjectUrl must accept BOTH board shapes, parse them into the
 * fields consumers copy verbatim, and never let the org prefix shift into the owner slot.
 *
 * The three defects this pins against recurring:
 *  - D3 (live): the validator was org/user-only, so the repo-scoped shape — the one the model
 *    treats as CRUD-capable (`repo` present) — could never pass the wizard's validate step.
 *  - D2 (latent): the wizard's second parser fabricated repo=owner for org URLs; the fix makes
 *    the validator the ONLY parser and these tests assert the org result carries NO repo key —
 *    presence assertions alone pass happily while a fabricated repo rides beside them.
 *  - ordering: `orgs/<owner>/projects/<n>` is ALSO four segments with `projects` at index 2, so
 *    a repo-shaped parse tried first reads owner="orgs", repo=<real owner> — a link that
 *    validates and points nowhere. The org test asserts owner is the REAL owner and the repo
 *    slot is empty, which is exactly what reds if the match order is swapped.
 *
 * `getProject` is shell-backed (execSync → gh CLI); the seam is child_process. The mock returns
 * the minimal ghJson shape getProject parses for step 1 and a fields payload for step 2 — the
 * validator only consumes `.title`, but the real function must survive its own parse.
 *
 * NEUTER RUN (2026-08-08 — fix committed FIRST as 24ea80ec, mutations reverted to that blob):
 *   n1. swap the match order (try the repo shape first, org second) → 3 red / 2 green: the
 *       org-URL test (owner "orgs" ≠ "acme"), the users/ test (owner "users"), AND the
 *       not-accessible test (it too asserts the parsed owner). Every prefixed-URL owner
 *       assertion is an ordering guard; the repo-scoped and garbage tests stayed green.
 *   n2. re-add a fabricated repo on the org branch (`repo: owner`) → 2 red: BOTH absence
 *       assertions (orgs/ and users/), nothing else — the fabrication guard, same shape as
 *       #137's n2, third repo in one day.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const execSyncMock = vi.fn()
vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('child_process')>()
  return { ...real, execSync: (...a: unknown[]) => execSyncMock(...a) }
})

import { validateProjectUrl } from '@/lib/github-cli'

/** Minimal payloads for getProject's two shell steps (project view, then GraphQL fields). */
function stubProject(title: string) {
  execSyncMock.mockImplementation((cmd: string) => {
    if (String(cmd).includes('project view')) {
      return JSON.stringify({
        number: 7, title, url: 'x', shortDescription: null, closed: false,
        id: 'PVT_1', fields: { totalCount: 0 }, items: { totalCount: 0 },
      })
    }
    // GraphQL fields lookup (user, then org fallback inside getProject)
    return JSON.stringify({ data: { user: { projectV2: { fields: { nodes: [] } } } } })
  })
}

beforeEach(() => {
  execSyncMock.mockReset()
  stubProject('Board Seven')
})

describe('validateProjectUrl — both shapes (#139)', () => {
  it('org URL: owner is the REAL owner, number parsed, and NO repo key at all', () => {
    const r = validateProjectUrl('https://github.com/orgs/acme/projects/7')
    expect(r.valid).toBe(true)
    expect(r.owner).toBe('acme') // reds under n1: the swapped order yields owner="orgs"
    expect(r.number).toBe(7)
    expect(r.title).toBe('Board Seven')
    // The explicit absence — the fabrication guard (#137's acceptance criterion, same class):
    expect('repo' in r).toBe(false)
  })

  it('users/ URL parses identically to orgs/', () => {
    const r = validateProjectUrl('https://github.com/users/emasoft/projects/3')
    expect(r.valid).toBe(true)
    expect(r.owner).toBe('emasoft')
    expect('repo' in r).toBe(false)
  })

  it('repo-scoped URL: repo present beside owner and number — the CRUD-capable shape validates', () => {
    const r = validateProjectUrl('https://github.com/acme/widgets/projects/7')
    expect(r.valid).toBe(true)
    expect(r.owner).toBe('acme')
    expect(r.repo).toBe('widgets')
    expect(r.number).toBe(7)
  })

  it('garbage is refused with the format error, before any shell call', () => {
    const r = validateProjectUrl('https://example.com/not-a-project')
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/Invalid project URL format/)
    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it('a valid shape whose board the CLI cannot reach reports not-accessible, keeping the parse', () => {
    execSyncMock.mockImplementation(() => { throw new Error('gh: not found') })
    const r = validateProjectUrl('https://github.com/orgs/acme/projects/7')
    expect(r.valid).toBe(false)
    expect(r.owner).toBe('acme')
    expect(r.error).toMatch(/Project not accessible/)
  })
})
