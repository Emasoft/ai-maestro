import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// getAgent must be mocked before we import the service module.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(),
}))

// Avoid spawning the real reader during ensureOpenForPath tests.
vi.mock('@/lib/jsonl-reader', () => ({
  getJsonlReader: vi.fn(),
}))

import {
  slugifyWorkingDirectory,
  projectDirForWorkingDirectory,
  listSessionsInProjectDir,
  getSessionsForAgent,
  resolveSessionPath,
  recordSessionMapping,
  clearSessionMappings,
  hasSessionCookie,
  ensureOpenForPath,
} from '@/services/sessions-browser-service'
import { getAgent } from '@/lib/agent-registry'
import { getJsonlReader } from '@/lib/jsonl-reader'

// ---------------------------------------------------------------------------
// slugifyWorkingDirectory
// ---------------------------------------------------------------------------

describe('slugifyWorkingDirectory', () => {
  it('replaces / with - and strips leading -', () => {
    expect(slugifyWorkingDirectory('/Users/e/code/ai-maestro')).toBe(
      'Users-e-code-ai-maestro',
    )
  })

  it('strips multiple leading dashes (nested absolute paths)', () => {
    // Input that already starts with '-' should still have only leading dashes stripped.
    expect(slugifyWorkingDirectory('/a/b')).toBe('a-b')
  })

  it('returns null for empty input', () => {
    expect(slugifyWorkingDirectory('')).toBeNull()
    expect(slugifyWorkingDirectory('/')).toBeNull()
  })

  it('normalizes Windows-style separators', () => {
    expect(slugifyWorkingDirectory('C:\\Users\\e')).toBe('C:-Users-e')
  })
})

// ---------------------------------------------------------------------------
// projectDirForWorkingDirectory
// ---------------------------------------------------------------------------

describe('projectDirForWorkingDirectory', () => {
  it('builds the full ~/.claude/projects/<slug> path', () => {
    const result = projectDirForWorkingDirectory('/Users/e/code/a')
    expect(result).toBe(
      path.join(os.homedir(), '.claude', 'projects', 'Users-e-code-a'),
    )
  })

  it('returns null when slug fails', () => {
    expect(projectDirForWorkingDirectory('/')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listSessionsInProjectDir
// ---------------------------------------------------------------------------

describe('listSessionsInProjectDir', () => {
  const tmpDir = path.join(os.tmpdir(), `aim-sb-test-${Date.now()}`)

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array for missing directory', () => {
    const missing = path.join(tmpDir, 'does-not-exist')
    expect(listSessionsInProjectDir(missing)).toEqual([])
  })

  it('returns .jsonl files sorted by mtime DESC with messageCount null', () => {
    const aPath = path.join(tmpDir, 'aaa.jsonl')
    const bPath = path.join(tmpDir, 'bbb.jsonl')
    fs.writeFileSync(aPath, 'a\n')
    fs.writeFileSync(bPath, 'b\n')
    // Force bbb to be newer.
    const older = new Date(Date.now() - 60_000)
    fs.utimesSync(aPath, older, older)

    const result = listSessionsInProjectDir(tmpDir)
    expect(result).toHaveLength(2)
    expect(result[0].displayName).toBe('bbb')
    expect(result[1].displayName).toBe('aaa')
    expect(result[0].messageCount).toBeNull()
    expect(result[0].size).toBeGreaterThan(0)
    expect(result[0].id).toBe('bbb')
  })

  it('ignores non-.jsonl files, hidden files, and .aimidx sidecars', () => {
    fs.writeFileSync(path.join(tmpDir, 'x.jsonl'), 'x')
    fs.writeFileSync(path.join(tmpDir, 'x.jsonl.aimidx'), '')
    fs.writeFileSync(path.join(tmpDir, '.hidden.jsonl'), '')
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hi')

    const result = listSessionsInProjectDir(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].displayName).toBe('x')
  })
})

// ---------------------------------------------------------------------------
// getSessionsForAgent
// ---------------------------------------------------------------------------

describe('getSessionsForAgent', () => {
  beforeEach(() => {
    clearSessionMappings()
    vi.mocked(getAgent).mockReset()
  })

  it('returns 404 when agent does not exist', () => {
    vi.mocked(getAgent).mockReturnValue(null)
    const res = getSessionsForAgent('ghost', {
      agentFetcher: () => null,
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(res.error).toBe('agent_not_found')
  })

  it('returns empty list (200) for agent with no workingDirectory', () => {
    const res = getSessionsForAgent('a1', {
      agentFetcher: () => ({ id: 'a1' }),
    })
    expect(res.ok).toBe(true)
    expect(res.data?.projectDir).toBeNull()
    expect(res.data?.sessions).toEqual([])
  })

  it('populates the sid→path reverse map on success', () => {
    const fakeSessions = [
      {
        path: '/abs/sess-abc.jsonl',
        size: 100,
        messageCount: null,
        lastModified: '2026-04-20T00:00:00.000Z',
        displayName: 'sess-abc',
        id: 'sess-abc',
      },
    ]
    const res = getSessionsForAgent('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: '/Users/e/x' }),
      lister: () => fakeSessions,
    })
    expect(res.ok).toBe(true)
    expect(res.data?.sessions).toHaveLength(1)
    expect(resolveSessionPath('sess-abc')).toBe('/abs/sess-abc.jsonl')
  })
})

// ---------------------------------------------------------------------------
// Cookie parser
// ---------------------------------------------------------------------------

describe('hasSessionCookie', () => {
  it('returns false for null/empty/absent', () => {
    expect(hasSessionCookie(null)).toBe(false)
    expect(hasSessionCookie(undefined)).toBe(false)
    expect(hasSessionCookie('')).toBe(false)
  })

  it('returns true when aim_session is present with a non-empty value', () => {
    expect(hasSessionCookie('aim_session=abc123')).toBe(true)
    expect(hasSessionCookie('other=x; aim_session=abc123; yet=y')).toBe(true)
  })

  it('returns false when aim_session is empty', () => {
    expect(hasSessionCookie('aim_session=')).toBe(false)
    expect(hasSessionCookie('aim_session= ')).toBe(false)
  })

  it('does not false-match substring names', () => {
    expect(hasSessionCookie('my_aim_session=abc')).toBe(false)
    expect(hasSessionCookie('aim_session_x=abc')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// recordSessionMapping / clearSessionMappings
// ---------------------------------------------------------------------------

describe('recordSessionMapping', () => {
  beforeEach(() => clearSessionMappings())

  it('stores and retrieves path by session id', () => {
    recordSessionMapping('sid-1', '/abs/1.jsonl')
    recordSessionMapping('sid-2', '/abs/2.jsonl')
    expect(resolveSessionPath('sid-1')).toBe('/abs/1.jsonl')
    expect(resolveSessionPath('sid-2')).toBe('/abs/2.jsonl')
  })

  it('clearSessionMappings wipes everything', () => {
    recordSessionMapping('sid-x', '/abs/x.jsonl')
    clearSessionMappings()
    expect(resolveSessionPath('sid-x')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ensureOpenForPath
// ---------------------------------------------------------------------------

describe('ensureOpenForPath', () => {
  it('delegates to getJsonlReader().open() and returns the Rust sessionId', async () => {
    const openMock = vi.fn().mockResolvedValue({
      ok: true,
      sessionId: 'rust-sid-xyz',
      lineCount: 100,
      indexed: false,
    })
    vi.mocked(getJsonlReader).mockReturnValue({
      open: openMock,
    } as any)

    const sid = await ensureOpenForPath('/abs/a.jsonl')
    expect(sid).toBe('rust-sid-xyz')
    expect(openMock).toHaveBeenCalledWith(path.resolve('/abs/a.jsonl'))
  })
})
