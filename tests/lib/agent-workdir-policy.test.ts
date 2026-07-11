/**
 * Unit tests for lib/agent-workdir-policy.ts — the single authority for
 * "may an agent use this directory as its working directory?" (TRDD-WLWHVMKT).
 *
 * WHY THIS FILE EXISTS, STATED BLUNTLY: external folder adoption shipped
 * (TRDD-57EBNB72), was documented in CLAUDE.md, had a live-verification EHT and a UI
 * scenario — and never worked. Every one of those tests placed its "external" fixture
 * *inside* ~/agents/ (SCEN-028's fixture is ~/agents/scen028-import-fixture), so not
 * one of them could ever have failed on the thing they claimed to cover.
 *
 * Therefore the central case below — a workdir that genuinely lives OUTSIDE ~/agents/
 * — is the whole point of this file. If a future refactor makes that case impossible
 * to express, the coverage is gone again.
 *
 * The agent registry is mocked because it is an INPUT to the policy, not the code
 * under test (the same pattern as tests/agent-auth.test.ts et al.). The path rules,
 * the authorization decision and the fail-closed behaviour are all exercised for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import os from 'os'
import path from 'path'

vi.mock('@/lib/agent-registry', () => ({
  loadAgents: vi.fn(() => []),
  getAgentByNameAnyHost: vi.fn(() => null),
}))

import { loadAgents, getAgentByNameAnyHost } from '@/lib/agent-registry'
import {
  AGENTS_ROOT,
  checkAdoptableWorkdir,
  checkAuthorizedAgentWorkdir,
  assertAuthorizedAgentWorkdir,
} from '@/lib/agent-workdir-policy'

const HOME = os.homedir()
/** A project living outside ~/agents/ — exactly the shape of ~/Code/<project>. */
const EXTERNAL_PROJECT = path.join(HOME, 'Code', 'my-plugin')
const INSTALL_ROOT = path.resolve(process.cwd())

/** Minimal shape the policy reads off the registry. */
const agentAt = (name: string, workingDirectory: string) =>
  ({ id: `id-${name}`, name, workingDirectory, deletedAt: undefined }) as never

beforeEach(() => {
  vi.mocked(loadAgents).mockReturnValue([])
  vi.mocked(getAgentByNameAnyHost).mockReturnValue(null)
})

describe('checkAuthorizedAgentWorkdir — the ordinary ~/agents/ case', () => {
  it('allows a workdir under ~/agents/', () => {
    expect(checkAuthorizedAgentWorkdir(path.join(AGENTS_ROOT, 'peter-bot')).ok).toBe(true)
  })

  it('allows ~/agents itself', () => {
    expect(checkAuthorizedAgentWorkdir(AGENTS_ROOT).ok).toBe(true)
  })

  it('does not even read the registry for an ~/agents/ path (fast path)', () => {
    checkAuthorizedAgentWorkdir(path.join(AGENTS_ROOT, 'peter-bot'))
    expect(loadAgents).not.toHaveBeenCalled()
  })

  it('REFUSES an empty cwd — it would inherit the server\'s own directory', () => {
    // This test used to assert the opposite ("allows an empty cwd — tmux inherits the
    // server cwd — preserved behaviour"), and in doing so it pinned the bypass:
    // the server's cwd IS the ai-maestro install tree, the one directory an agent must
    // never own. So `/` was refused while "" quietly granted something strictly worse.
    // Inverted deliberately (TRDD-QMD7X3FB) — absence is a refusal, never a fallback.
    const v = checkAuthorizedAgentWorkdir('')
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/required/)
  })
})

describe('checkAuthorizedAgentWorkdir — external adoption (the case that was broken)', () => {
  it('ALLOWS an external workdir the registry records for a live agent', () => {
    vi.mocked(loadAgents).mockReturnValue([agentAt('my-plugin-maintainer', EXTERNAL_PROJECT)])
    const verdict = checkAuthorizedAgentWorkdir(EXTERNAL_PROJECT)
    expect(verdict.ok).toBe(true)
  })

  it('ALLOWS a subdirectory of a registered external workdir', () => {
    vi.mocked(loadAgents).mockReturnValue([agentAt('my-plugin-maintainer', EXTERNAL_PROJECT)])
    expect(checkAuthorizedAgentWorkdir(path.join(EXTERNAL_PROJECT, 'src', 'deep')).ok).toBe(true)
  })

  it('DENIES an external path no agent has registered', () => {
    vi.mocked(loadAgents).mockReturnValue([])
    const verdict = checkAuthorizedAgentWorkdir(path.join(HOME, 'Code', 'not-adopted'))
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/not the registered working/i)
  })

  it('DENIES a soft-deleted agent\'s workdir (tombstones do not authorize)', () => {
    vi.mocked(loadAgents).mockReturnValue([
      { id: 'x', name: 'gone', workingDirectory: EXTERNAL_PROJECT, deletedAt: '2026-07-01T00:00:00Z' } as never,
    ])
    expect(checkAuthorizedAgentWorkdir(EXTERNAL_PROJECT).ok).toBe(false)
  })

  it('binds to the named agent — agent A may not start in agent B\'s adopted project', () => {
    vi.mocked(getAgentByNameAnyHost).mockImplementation(((name: string) =>
      name === 'owner-agent' ? agentAt('owner-agent', EXTERNAL_PROJECT) : null) as never)
    expect(checkAuthorizedAgentWorkdir(EXTERNAL_PROJECT, 'owner-agent').ok).toBe(true)
    expect(checkAuthorizedAgentWorkdir(EXTERNAL_PROJECT, 'other-agent').ok).toBe(false)
  })

  it('FAILS CLOSED when the registry cannot be read', () => {
    vi.mocked(loadAgents).mockImplementation(() => {
      throw new Error('registry corrupt')
    })
    const verdict = checkAuthorizedAgentWorkdir(EXTERNAL_PROJECT)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/unreadable/i)
  })
})

describe('checkAuthorizedAgentWorkdir — hard denials (these must never regress)', () => {
  it('denies a path outside $HOME even if an agent claims it', () => {
    vi.mocked(loadAgents).mockReturnValue([agentAt('rogue', '/tmp/evil')])
    const verdict = checkAuthorizedAgentWorkdir('/tmp/evil')
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/outside \$HOME/i)
  })

  it('denies $HOME itself', () => {
    vi.mocked(loadAgents).mockReturnValue([agentAt('rogue', HOME)])
    expect(checkAuthorizedAgentWorkdir(HOME).ok).toBe(false)
  })

  it('denies protected user-data roots (Desktop/Documents/Downloads/Library)', () => {
    for (const dir of ['Desktop', 'Documents', 'Downloads', 'Library']) {
      const p = path.join(HOME, dir)
      vi.mocked(loadAgents).mockReturnValue([agentAt('rogue', p)])
      expect(checkAuthorizedAgentWorkdir(p).ok).toBe(false)
    }
  })

  it('denies the ai-maestro install tree — THE RECURSION GUARD', () => {
    // An agent whose workdir is the server's own source tree would rebuild and
    // restart the very server managing it. Developing ai-maestro from an agent
    // requires an isolated container, never an in-place workdir.
    vi.mocked(loadAgents).mockReturnValue([agentAt('self-host', INSTALL_ROOT)])
    const verdict = checkAuthorizedAgentWorkdir(INSTALL_ROOT)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/ai-maestro installation/i)
  })

  it('denies a subdirectory of the ai-maestro install tree too', () => {
    const inside = path.join(INSTALL_ROOT, 'services')
    vi.mocked(loadAgents).mockReturnValue([agentAt('self-host', inside)])
    expect(checkAuthorizedAgentWorkdir(inside).ok).toBe(false)
  })

  it('denies traversal that escapes via ..', () => {
    vi.mocked(loadAgents).mockReturnValue([])
    expect(checkAuthorizedAgentWorkdir(path.join(AGENTS_ROOT, '..', '..', 'etc')).ok).toBe(false)
  })
})

describe('assertAuthorizedAgentWorkdir — throwing form', () => {
  it('throws with the real reason, not an opaque message', () => {
    vi.mocked(loadAgents).mockReturnValue([])
    expect(() => assertAuthorizedAgentWorkdir(path.join(HOME, 'Code', 'nope'))).toThrow(
      /not the registered working directory/i
    )
  })

  it('does not throw for a legitimate ~/agents/ workdir', () => {
    expect(() => assertAuthorizedAgentWorkdir(path.join(AGENTS_ROOT, 'ok'))).not.toThrow()
  })
})

describe('checkAdoptableWorkdir — creation-time gate (no agent exists yet)', () => {
  it('allows ~/agents/<name> without the external flag', () => {
    expect(checkAdoptableWorkdir(path.join(AGENTS_ROOT, 'new-agent'), false).ok).toBe(true)
  })

  it('DENIES an external folder when allowExternalFolder was not set', () => {
    const verdict = checkAdoptableWorkdir(EXTERNAL_PROJECT, false)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/allowExternalFolder was not set/i)
  })

  it('ALLOWS an external folder when allowExternalFolder is set', () => {
    expect(checkAdoptableWorkdir(EXTERNAL_PROJECT, true).ok).toBe(true)
  })

  it('DENIES the ai-maestro install tree EVEN WITH allowExternalFolder', () => {
    // The flag is an escape hatch for user projects, never for self-hosting.
    expect(checkAdoptableWorkdir(INSTALL_ROOT, true).ok).toBe(false)
  })

  it('DENIES outside $HOME even with allowExternalFolder', () => {
    expect(checkAdoptableWorkdir('/tmp/anywhere', true).ok).toBe(false)
  })

  it('DENIES an empty workdir', () => {
    expect(checkAdoptableWorkdir('', true).ok).toBe(false)
  })
})
